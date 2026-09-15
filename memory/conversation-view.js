import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { getTokenCount, getTokenCountAsync } from '../../../../../scripts/tokenizers.js';
import { getStringHash } from '../../../../../scripts/utils.js';
import { generateSummary } from '../connection/generation.js';
import { getSettings } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { getSummaryRecords, getSummaryRecordIndex, filterLlmVisibleSummaryRecords } from '../summary/summary-store.js';
import { openSummaryRecordDetail } from '../records/record-detail-view.js';
import { planConversationAsync, runConversation } from './conversation-engine.js';

let opened = false;
const KEY = 'stsmMemoryConversation';

export async function openMemoryConversation() {
    if (opened) return;
    const context = SillyTavern.getContext();
    if (!context.chatId) { toastr.info('먼저 채팅을 열어주세요.'); return; }
    opened = true;
    try { await showConversation(context); } finally { opened = false; }
}

async function showConversation(context) {
    const owner = context.chatMetadata;
    const state = owner[KEY] ||= { draft: '', budget: 30000, turns: [], evidence: '', pending: null };
    state.outputTokens ??= 5000;
    const draftKey = `stsm-memory-draft:${JSON.stringify([context.groupId, context.characterId, context.chatId])}`;
    try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey));
        if (draft && !state.pending) state.draft = String(draft.text || '');
    } catch { /* Browser storage may be unavailable. The in-memory draft remains usable. */ }
    const root = document.createElement('div');
    root.className = 'stsm-memory-chat';
    root.innerHTML = `
        <header><strong>기억과 대화</strong><button type="button" class="menu_button menu_button_icon" data-new title="새 대화" aria-label="새 대화"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></header>
        <div class="stsm-memory-messages" aria-live="polite"></div>
        <details class="stsm-memory-options"><summary>요청 설정·진행 내역</summary>
            <label>요청당 입력 예산 <input data-budget class="text_pole" type="number" min="2000" max="200000" step="1000" /></label>
            <label>요청당 최대 출력 토큰 <input data-output class="text_pole" type="number" min="1" max="200000" step="100" /></label>
            <div data-connection></div>
            <div>기존 요약 연결 사용 · 출력 토큰은 이 대화 전용</div>
            <div>예상 횟수는 기본 검토·답변 기준입니다. 자료 정리·추가 확인·재시도로 늘어날 수 있습니다.</div>
            <div>대화와 완료 결과는 이 채팅에 저장됩니다.</div>
            <div data-log></div>
            <details data-results-disclosure><summary>최근 요청 결과</summary><div data-results></div></details>
        </details>
        <textarea data-question class="text_pole" rows="3" aria-label="기억에 질문" placeholder="어떤 장면이 궁금하세요?"></textarea>
        <div class="stsm-memory-estimate-row"><div class="stsm-memory-estimate" data-estimate></div><button type="button" class="menu_button menu_button_icon" data-recalculate title="예상 요청 횟수 다시 계산" aria-label="예상 요청 횟수 다시 계산"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div>
        <div data-status role="status"></div>
        <footer><button type="button" class="menu_button" data-stop hidden><i class="fa-solid fa-stop" aria-hidden="true"></i> 현재 요청 후 중단</button>
        <button type="button" class="menu_button" data-retry hidden><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> 이어서 시도</button>
        <button type="button" class="menu_button" data-discard hidden>진행 취소</button>
        <button type="button" class="menu_button" data-send><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> 질문하기</button></footer>`;
    const $ = selector => root.querySelector(selector);
    const question = $('[data-question]');
    const budget = $('[data-budget]');
    const output = $('[data-output]');
    question.value = state.draft;
    budget.value = state.budget;
    output.value = state.pending?.outputTokens || state.outputTokens;
    const settings = getSettings();
    const connection = settings.connection[settings.connectionMode] || settings.connection.profile;
    $('[data-connection]').textContent = settings.connectionMode === 'custom' ? connection.model || connection.provider : '현재 연결 프로필';
    let busy = false;
    let stopped = false;
    let timer;
    let estimateVersion = 0;
    let closed = false;
    let writes = Promise.resolve();
    const sameChat = () => SillyTavern.getContext().chatMetadata === owner;
    const save = () => {
        writes = writes.catch(() => {}).then(async () => {
            if (!sameChat()) throw new Error('채팅이 바뀌었습니다. 원래 채팅에서 다시 열어주세요.');
            await context.saveMetadata();
        });
        return writes;
    };
    const records = () => filterLlmVisibleSummaryRecords(getSummaryRecords())
        .filter(record => record.type === 'summary' && String(record.content || '').trim())
        .sort((a, b) => a.startId - b.startId || a.endId - b.endId)
        .map(record => ({ id: String(record.id), startId: record.startId, endId: record.endId, content: record.content }));
    const check = () => {
        if (!sameChat()) throw new Error('채팅이 바뀌었습니다. 원래 채팅에서 이어서 시도해주세요.');
        if (stopped) throw new Error('중단했습니다. 완료 결과는 보관되어 있습니다.');
    };
    const render = () => {
        const references = new Map((state.pending?.records || getSummaryRecordIndex()).map(record => [escapeHtml(record.id), record]));
        $('.stsm-memory-messages').innerHTML = state.turns.map(turn => `
            <article class="stsm-memory-message" data-role="${turn.role}"><strong>${turn.role === 'user' ? '나' : '기억 도우미'}</strong><div>${renderAnswer(turn.content, references)}</div></article>`).join('');
        if (state.pending) {
            const item = document.createElement('article');
            item.className = 'stsm-memory-message';
            item.textContent = `질문: ${state.pending.question}`;
            $('.stsm-memory-messages').append(item);
        }
        $('[data-send]').disabled = busy || Boolean(state.pending);
        $('[data-new]').disabled = busy;
        question.disabled = busy || Boolean(state.pending);
        budget.disabled = busy || Boolean(state.pending);
        output.disabled = busy;
        $('[data-recalculate]').disabled = busy || Boolean(state.pending);
        $('[data-retry]').hidden = busy || !state.pending;
        $('[data-discard]').hidden = busy || !state.pending;
        $('[data-stop]').hidden = !busy;
        const job = state.pending;
        $('[data-log]').textContent = job ? `요청 시도 ${job.attempts}회 · 보관 결과 ${Object.keys(job.cache).length}개` : `최근 질문 요청 ${state.lastAttempts || 0}회`;
        renderResults();
    };
    const renderResults = () => {
        if (!$('[data-results-disclosure]').open) return;
        $('[data-results]').innerHTML = (state.pending ? Object.values(state.pending.cache) : state.lastResults || []).map((result, index) => `<details><summary>응답 ${index + 1}</summary><pre>${escapeHtml(result)}</pre></details>`).join('');
    };
    $('[data-results-disclosure]').addEventListener('toggle', renderResults);
    const estimate = async () => {
        const version = ++estimateVersion;
        const active = () => !closed && version === estimateVersion && sameChat();
        try {
            check();
            if (state.pending) { $('[data-estimate]').textContent = '완료 결과를 재사용하여 중단된 질문을 이어갑니다.'; return; }
            if (state.turns.length) {
                $('[data-estimate]').textContent = '후속 질문: 기본 1회 · 원문 추가 확인 2회 · 전체 검토 시 배치 수 + 2회';
            } else {
                $('[data-estimate]').textContent = '예상 요청 횟수 계산 중…';
                await new Promise(resolve => setTimeout(resolve, 0));
                if (!active()) return;
                const source = records();
                if (!source.length) throw new Error('검토할 원본 요약 레코드가 없습니다.');
                const count = async text => {
                    if (!active()) throw new Error('계산 취소');
                    return await getTokenCountAsync(text);
                };
                const plan = await planConversationAsync(source, question.value.trim(), Number(budget.value), count);
                let total = 0;
                for (const record of source) total += await count(record.content);
                if (!active()) return;
                $('[data-estimate]').textContent = `원본 ${source.length}개 · ${total.toLocaleString()} tokens · 예상 ${plan.requests}회 (검토 ${plan.batches.length} + 답변 1)`;
            }
        } catch (error) { if (active()) $('[data-estimate]').textContent = error.message; }
    };
    const execute = async () => {
        if (busy) return;
        busy = true; stopped = false; render();
        try {
            const job = state.pending;
            const result = await runConversation(job, {
                generate: prompt => generateSummary(prompt, { maxTokens: job.outputTokens || state.outputTokens }), count: getTokenCount, save, check,
                fingerprint: prompt => `${prompt.length}:${getStringHash(prompt)}:${getStringHash(prompt, 731)}`,
                progress: label => { $('[data-status]').textContent = label; render(); },
            });
            check();
            state.turns.push({ role: 'user', content: job.question }, { role: 'assistant', content: result.answer });
            state.evidence = result.evidence;
            state.lastAttempts = job.attempts;
            state.lastResults = Object.values(job.cache);
            state.pending = null;
            state.draft = ''; question.value = '';
            try { sessionStorage.removeItem(draftKey); } catch { /* Optional draft cache. */ }
            clearTimeout(timer);
            await save();
            $('[data-status]').textContent = '답변 완료';
            estimate();
        } catch (error) {
            $('[data-status]').textContent = error.message || '요청에 실패했습니다. 이어서 시도해주세요.';
        } finally { busy = false; render(); $('.stsm-memory-messages').scrollTop = $('.stsm-memory-messages').scrollHeight; }
    };
    $('[data-send]').addEventListener('click', async () => {
        try {
            stopped = false; check();
            if (busy || state.pending) return;
            const value = question.value.trim();
            const limit = Number(budget.value);
            const outputLimit = Number(output.value);
            if (!value) return;
            if (!Number.isInteger(limit) || limit < 2000 || limit > 200000) throw new Error('입력 예산은 2,000~200,000 사이로 설정해주세요.');
            if (!Number.isInteger(outputLimit) || outputLimit < 1 || outputLimit > 200000) throw new Error('출력 토큰은 1~200,000 사이의 정수로 설정해주세요.');
            const source = records();
            if (!source.length) throw new Error('검토할 원본 요약 레코드가 없습니다.');
            // Request planning is asynchronous so tokenizer I/O cannot freeze the popup.
            busy = true; ++estimateVersion; render();
            await planConversationAsync(source, value, limit, getTokenCountAsync);
            check();
            state.pending = { question: value, budget: limit, outputTokens: outputLimit, records: source, history: structuredClone(state.turns), evidence: state.evidence, first: !state.turns.length, cache: {}, attempts: 0 };
            await save();
            busy = false;
            await execute();
        } catch (error) { busy = false; $('[data-status]').textContent = error.message; render(); }
    });
    $('[data-retry]').addEventListener('click', () => {
        const value = Number(output.value);
        if (!Number.isInteger(value) || value < 1 || value > 200000) { $('[data-status]').textContent = '출력 토큰은 1~200,000 사이의 정수로 설정해주세요.'; return; }
        state.pending.outputTokens = value;
        execute();
    });
    $('[data-stop]').addEventListener('click', () => { stopped = true; $('[data-status]').textContent = '현재 요청이 끝나면 중단합니다.'; });
    $('[data-discard]').addEventListener('click', async () => {
        state.draft = state.pending.question; question.value = state.draft; state.pending = null;
        try { await save(); } catch (error) { $('[data-status]').textContent = error.message; }
        stopped = false; render(); estimate();
    });
    $('[data-new]').addEventListener('click', async () => {
        if (!await Popup.show.confirm('새 대화', '현재 기억 대화 내역을 비우고 새로 시작할까요?')) return;
        state.turns = []; state.evidence = ''; state.pending = null; state.lastResults = []; state.lastAttempts = 0;
        stopped = false;
        try { await save(); } catch (error) { $('[data-status]').textContent = error.message; }
        render(); estimate();
    });
    const changed = () => {
        ++estimateVersion;
        state.draft = question.value;
        state.budget = Number(budget.value) || 30000;
        clearTimeout(timer);
        $('[data-estimate]').textContent = state.turns.length ? '후속 질문: 기본 1회 · 추가 확인 시 요청 증가' : '입력 변경됨 · 오른쪽 버튼으로 예상 횟수 갱신';
        timer = setTimeout(() => {
            try { sessionStorage.setItem(draftKey, JSON.stringify({ text: state.draft })); } catch { /* Draft is also saved on close/send. */ }
        }, 500);
    };
    question.addEventListener('input', changed); budget.addEventListener('input', changed);
    output.addEventListener('input', () => {
        const value = Number(output.value);
        if (Number.isInteger(value) && value >= 1 && value <= 200000) state.outputTokens = value;
    });
    $('[data-recalculate]').addEventListener('click', estimate);
    root.addEventListener('click', event => {
        const id = event.target.closest('[data-record-id]')?.dataset.recordId;
        if (id && sameChat()) openSummaryRecordDetail(id).catch(error => toastr.error(error.message));
    });
    render();
    $('[data-estimate]').textContent = '예상 요청 횟수 계산 중…';
    try {
        await new Popup(root, POPUP_TYPE.TEXT, '', {
            okButton: '닫기', wider: true, allowVerticalScrolling: true,
            onOpen: () => { timer = setTimeout(estimate, 0); },
            onClosing: async () => {
                if (busy) { stopped = true; $('[data-status]').textContent = '현재 요청이 끝난 후 닫을 수 있습니다.'; return false; }
                clearTimeout(timer);
                try {
                    await save();
                    try { sessionStorage.removeItem(draftKey); } catch { /* Metadata now holds the latest draft. */ }
                } catch (error) { if (sameChat()) { $('[data-status]').textContent = error.message; return false; } }
                return true;
            },
        }).show();
    } finally { closed = true; ++estimateVersion; clearTimeout(timer); }
}

function renderAnswer(text, byId) {
    return escapeHtml(text).replace(/\[\[([^\]\n]+)\]\]/g, (_, id) => {
        const record = byId.get(id);
        return record ? `<button class="stsm-memory-citation" type="button" data-record-id="${id}">#${record.startId}~${record.endId}</button>` : `[${id}]`;
    });
}
