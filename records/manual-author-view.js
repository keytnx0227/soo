import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { getTokenCountAsync } from '../../../../../scripts/tokenizers.js';
import { generateSummary } from '../connection/generation.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { createId, escapeHtml } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { buildSummaryPrompt } from '../prompts/prompt-builder.js';
import { createSummaryChunks } from '../summary/chunking.js';
import { DEFAULT_SUMMARY_SECTIONS, DEFAULT_MEMORY_SECTIONS, renderStructuredSummary } from '../summary/summary-format.js';
import { getAtlasProjection } from '../memory/atlas-projection-service.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';
import { composeAuthorPrompt, parseAuthorDraft } from './manual-author-engine.js';
import { renderManualInfo } from './manual-record-settings.js';

export async function openManualAuthor({ session, initialDraft, getRange }) {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    const metadata = context.chatMetadata;
    const check = () => {
        const current = SillyTavern.getContext();
        if (current.chat !== chat || current.chatMetadata !== metadata) throw new Error('채팅이 변경되었습니다. 작성창을 다시 열어주세요.');
    };
    session.history ||= [];
    const signature = JSON.stringify(initialDraft);
    if (!session.draft || session.baseSignature !== signature) {
        session.draft = structuredClone(initialDraft);
        session.hasCandidate = false;
        session.baseSignature = signature;
    }
    session.mode ||= 'consult';
    session.outputTokens ||= 5000;
    session.inputBudget ||= 30000;
    const form = document.createElement('div');
    form.className = 'stsm-manual-author';
    form.innerHTML = `<header class="stsm-manual-heading"><h3>AI와 작성</h3><div class="stsm-manual-heading-actions">
        <button type="button" class="menu_button" data-author-clear title="초안을 유지하고 대화 기록 비우기" aria-label="초안을 유지하고 대화 기록 비우기"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
        ${renderManualInfo('AI와 작성', '기존 요약 프리셋과 확장의 연결 설정을 사용합니다. 원본 메시지는 선택한 경우에만 포함합니다. 프리셋의 도감·캐릭터 등 다른 문맥은 유지됩니다. 작성창에 반영한 후에도 추가하기를 눌러야 저장됩니다. 대화는 이 생성창을 열어둔 동안 유지됩니다. 입력 한도와 최대 출력의 합이 사용 모델의 컨텍스트 한도 이내가 되도록 설정해주세요.')}</div></header>
        <fieldset class="stsm-author-modes"><legend class="sr-only">응답 모드</legend>
            <label><input type="radio" name="stsm-author-mode" value="consult" />상담</label>
            <label><input type="radio" name="stsm-author-mode" value="write" />초안 작성</label></fieldset>
        <div class="stsm-author-history" data-author-history aria-live="polite"></div>
        <details class="stsm-author-preview" data-author-preview><summary>현재 초안 <span data-author-version></span></summary><div data-author-render></div></details>
        <details class="stsm-author-options"><summary>참고 자료·요청 설정</summary>
            <label class="stsm-field"><span>참고 자료</span><textarea class="text_pole" data-author-material rows="5" placeholder="기존 수동 요약 등"></textarea></label>
            <label><input type="checkbox" data-author-source /> 선택 범위 원본 메시지 포함</label>
            <div class="stsm-author-token-fields"><label class="stsm-field"><span>입력 토큰 한도</span><input type="number" class="text_pole" data-author-budget min="1000" max="200000" /></label>
            <label class="stsm-field"><span>최대 출력 토큰</span><input type="number" class="text_pole" data-author-output min="1" max="200000" /></label></div>
            <button type="button" class="menu_button" data-author-inspect><i class="fa-solid fa-eye" aria-hidden="true"></i> 전송 내용 확인</button></details>
        <label class="stsm-field"><span>요청</span><textarea class="text_pole" data-author-input rows="3" placeholder="어떻게 작성할까요?"></textarea></label>
        <div class="stsm-author-status" role="status" data-author-status></div>
        <div class="stsm-author-actions"><button type="button" class="menu_button" data-author-stop hidden><i class="fa-solid fa-stop" aria-hidden="true"></i> 중단</button>
        <button type="button" class="menu_button" data-author-send><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> 보내기</button></div>`;
    const $ = selector => form.querySelector(selector);
    $('[data-author-material]').value = session.material || '';
    $('[data-author-input]').value = session.input || '';
    $('[data-author-budget]').value = session.inputBudget;
    $('[data-author-output]').value = session.outputTokens;
    form.querySelector(`input[value="${session.mode}"]`).checked = true;
    let sourceAvailable = false;
    try { sourceAvailable = getRange().startId !== null; } catch { /* Invalid ranges cannot be sent. */ }
    $('[data-author-source]').disabled = !sourceAvailable;
    $('[data-author-source]').checked = sourceAvailable && Boolean(session.includeSource);
    if (!sourceAvailable) $('[data-author-source]').parentElement.title = '생성창에서 유효한 메시지 범위를 먼저 지정해주세요.';
    let busy = false;
    let stopped = false;
    let requestActive = false;
    const remember = () => {
        session.input = $('[data-author-input]').value;
        session.material = $('[data-author-material]').value;
        session.mode = form.querySelector('input[name="stsm-author-mode"]:checked').value;
        session.includeSource = $('[data-author-source]').checked;
        session.inputBudget = Number($('[data-author-budget]').value);
        session.outputTokens = Number($('[data-author-output]').value);
    };
    const render = () => {
        $('[data-author-history]').innerHTML = session.history.map(turn => `<article class="stsm-author-turn"><small>${turn.role === 'user' ? '나' : turn.mode === 'write' ? '초안 작성' : '상담'}</small><div>${escapeHtml(turn.text)}</div></article>`).join('');
        const settings = getSettings().summarization;
        let range = { startId: null, endId: null };
        try { range = getRange(); } catch { /* A draft can be authored without valid message IDs. */ }
        $('[data-author-render]').innerHTML = `<pre>${escapeHtml(renderStructuredSummary(session.draft, { ...range, template: settings.summaryContentTemplate, outputSections: settings.summaryOutputSections }))}</pre>
            ${renderRecordMemoryUpdateDetails({ structuredSummary: { data: session.draft } })}`;
        $('[data-author-version]').textContent = session.version ? `v${session.version}` : '';
        $('[data-author-history]').scrollTop = $('[data-author-history]').scrollHeight;
    };
    const setBusy = value => {
        busy = value;
        form.querySelectorAll('input,textarea,button').forEach(element => { element.disabled = value; });
        $('[data-author-source]').disabled = value || !sourceAvailable;
        $('[data-author-stop]').hidden = !value;
        $('[data-author-stop]').disabled = false;
    };
    const prepare = async () => {
        check(); remember();
        if (!session.input.trim()) throw new Error('요청을 입력해주세요.');
        if (!Number.isInteger(session.outputTokens) || session.outputTokens < 1 || session.outputTokens > 200000
            || !Number.isInteger(session.inputBudget) || session.inputBudget < 1000 || session.inputBudget > 200000) throw new Error('토큰 한도를 올바르게 입력해주세요.');
        let chunk = { messages: [], startId: null, endId: null };
        if (session.includeSource) {
            const range = getRange();
            if (range.startId === null) throw new Error('원본을 보낼 메시지 범위를 지정해주세요.');
            chunk = createSummaryChunks(chat, range.startId, range.endId, range.endId - range.startId + 1)[0];
            if (!chunk) throw new Error('선택 범위에 보낼 메시지가 없습니다.');
        }
        const basePrompt = await buildSummaryPrompt(chunk);
        const prompt = composeAuthorPrompt({ mode: session.mode, basePrompt, draft: session.draft, history: session.history, request: session.input.trim(), material: session.material });
        const tokens = await getTokenCountAsync(prompt);
        check();
        $('[data-author-status]').textContent = `입력 약 ${tokens.toLocaleString()} tokens · 출력 최대 ${session.outputTokens.toLocaleString()}`;
        return { prompt, tokens };
    };
    $('[data-author-inspect]').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
            const { prompt } = await prepare();
            const pre = document.createElement('pre'); pre.className = 'stsm-author-prompt'; pre.textContent = prompt;
            await new Popup(pre, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true }).show();
        } catch (error) { $('[data-author-status]').textContent = error.message; }
        finally { setBusy(false); }
    });
    $('[data-author-clear]').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
            const message = document.createElement('p');
            message.textContent = '현재 초안과 참고 자료는 유지하고 대화 기록만 비울까요?';
            const result = await new Popup(message, POPUP_TYPE.CONFIRM, '', { okButton: '비우기', cancelButton: '취소' }).show();
            if (result === POPUP_RESULT.AFFIRMATIVE) { session.history = []; render(); }
        } finally { setBusy(false); }
    });
    $('[data-author-send]').addEventListener('click', async () => {
        if (busy) return;
        let operation;
        stopped = false; setBusy(true);
        try {
            operation = beginOperation('authoring', '레코드 초안 작성');
            const { prompt, tokens } = await prepare();
            if (tokens > session.inputBudget) throw new Error('입력 토큰 한도를 초과했습니다. 참고 자료·대화 길이를 줄이거나 한도를 조정해주세요.');
            if (stopped) return;
            requestActive = true;
            const response = await generateSummary(prompt, { maxTokens: session.outputTokens });
            requestActive = false;
            check();
            if (stopped) return;
            if (!response.trim()) throw new Error('응답이 비어 있습니다.');
            let text = response;
            if (session.mode === 'write') {
                const draft = parseAuthorDraft(response, session.draft, getAtlasProjection(), createId);
                session.draft = draft;
                session.version = (session.version || 0) + 1;
                text = `초안 v${session.version}을 작성했어요. 현재 초안에서 확인해주세요.`;
                session.hasCandidate = true;
                $('[data-author-preview]').open = true;
            }
            session.history.push({ role: 'user', mode: session.mode, text: session.input.trim() }, { role: 'assistant', mode: session.mode, text });
            session.input = ''; $('[data-author-input]').value = '';
            render();
        } catch (error) { $('[data-author-status]').textContent = stopped ? '요청을 중단했습니다. 기존 초안은 유지됩니다.' : error.message; }
        finally { requestActive = false; if (operation) endOperation(operation); setBusy(false); }
    });
    $('[data-author-stop]').addEventListener('click', () => {
        stopped = true;
        $('[data-author-status]').textContent = '중단 요청 중입니다. 응답은 초안에 반영하지 않습니다.';
        if (!requestActive) return;
        Promise.resolve(context.eventSource.emit(context.eventTypes.GENERATION_STOPPED))
            .catch(error => { $('[data-author-status]').textContent = error.message; });
    });
    render();
    const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '작성창에 반영', cancelButton: '닫기', wide: true, large: true, allowVerticalScrolling: true,
        onClosing: popup => {
            if (busy) { $('[data-author-status]').textContent = '요청을 중단하거나 완료된 뒤 닫아주세요.'; return false; }
            remember();
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try { check(); if (!session.hasCandidate) throw new Error('초안 작성 모드로 초안을 먼저 생성해주세요.'); return true; }
            catch (error) { $('[data-author-status]').textContent = error.message; return false; }
        },
    }).show();
    return result === POPUP_RESULT.AFFIRMATIVE ? structuredClone(session.draft) : null;
}
