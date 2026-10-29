import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { getTokenCountAsync } from '../../../../../scripts/tokenizers.js';
import { generateSummary } from '../connection/generation.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { escapeHtml } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { parseStructuredSummaryResponse, renderStructuredSummary } from '../summary/summary-format.js';
import { applySummaryRegenerationDraft, createRegenerationRecordSignature } from '../summary/summary-service.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';
import { showSummaryRegenerationPreview } from './summary-regeneration-preview.js';
import {
    composeGenerationConversation, getGenerationOwner, checkGenerationOwner, checkGenerationRecord,
    readGenerationConversation, saveGenerationConversation, createConversationDraft, changeGenerationTurn,
    getRecentGenerationConversations, deleteRecentGenerationConversation,
} from './generation-conversation.js';

export async function openGenerationConversation(session, onApplied = () => {}) {
    const owner = getGenerationOwner();
    const form = document.createElement('div');
    form.className = 'stsm-generation-dialog stsm-generation-chat';
    form.innerHTML = `<header><h3>요약과 대화</h3><span>#${Number(session.startId)} ~ #${Number(session.endId)}</span></header>
        <fieldset class="stsm-generation-modes"><legend class="sr-only">응답 모드</legend>
            <label><input type="radio" name="generation-mode" value="consult"><span><i class="fa-solid fa-comment" aria-hidden="true"></i> 상담</span></label>
            <label><input type="radio" name="generation-mode" value="write"><span><i class="fa-solid fa-pen" aria-hidden="true"></i> 수정안 생성</span></label></fieldset>
        <div class="stsm-generation-history" data-history aria-live="polite" tabindex="0" role="region" aria-label="요약 대화 내역"></div>
        <details class="stsm-generation-request-settings"><summary>요청 설정</summary><div class="stsm-author-token-fields">
            <label class="stsm-field"><span>입력 토큰 한도</span><input class="text_pole" type="number" data-budget min="1000" max="200000"></label>
            <label class="stsm-field"><span>최대 출력 토큰</span><input class="text_pole" type="number" data-output min="1" max="200000"></label></div>
            <button type="button" class="menu_button" data-inspect><i class="fa-solid fa-eye" aria-hidden="true"></i> 전송 내용</button></details>
        <textarea class="text_pole" data-input rows="2" aria-label="요약에 대한 요청" placeholder="궁금한 점이나 수정할 내용을 적어주세요"></textarea>
        <div class="stsm-generation-status" role="status" data-status></div>
        <div class="stsm-generation-actions"><button type="button" class="menu_button" data-apply disabled><i class="fa-solid fa-check" aria-hidden="true"></i> 수정안 검토</button>
            <button type="button" class="menu_button" data-send><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> 보내기</button></div>`;
    const $ = selector => form.querySelector(selector);
    $('[data-input]').value = session.input || '';
    $('[data-budget]').value = session.inputBudget;
    $('[data-output]').value = session.outputTokens;
    form.querySelector(`input[value="${session.mode === 'write' ? 'write' : 'consult'}"]`).checked = true;
    let busy = false;
    const remember = () => {
        session.input = $('[data-input]').value;
        session.inputBudget = Number($('[data-budget]').value);
        session.outputTokens = Number($('[data-output]').value);
        session.mode = form.querySelector('input[name="generation-mode"]:checked').value;
    };
    const check = () => { checkGenerationOwner(owner); checkGenerationRecord(session); };
    const render = (scrollToEnd = true) => {
        const previousScrollTop = $('[data-history]').scrollTop;
        const settings = getSettings().summarization;
        $('[data-history]').innerHTML = session.history.map((turn, index) => {
            let body = `<div class="stsm-generation-text">${escapeHtml(turn.text)}</div>`;
            let structured = false;
            if (turn.role === 'assistant') {
                try {
                    const data = parseStructuredSummaryResponse(turn.text, session.configuration.sections, session.configuration.memorySections);
                    const rendered = renderStructuredSummary(data, { startId: session.startId, endId: session.endId,
                        template: settings.summaryContentTemplate, outputSections: settings.summaryOutputSections });
                    structured = true;
                    body = `<section class="stsm-generation-result"><strong>요약 · 도감</strong><div class="stsm-generation-text">${escapeHtml(rendered)}</div>${renderRecordMemoryUpdateDetails({ structuredSummary: { data } })}</section>
                        <details class="stsm-generation-json"><summary><i class="fa-solid fa-code" aria-hidden="true"></i> JSON 원문</summary><pre>${escapeHtml(turn.text)}</pre></details>`;
                } catch { /* Keep malformed responses available for a follow-up request. */ }
            }
            const actions = index > 0 ? `<div class="stsm-generation-turn-actions"><button type="button" class="menu_button" data-turn-edit="${index}" title="${turn.role === 'user' ? '메시지 수정 후 다시 보내기' : '응답 수정'}" aria-label="메시지 수정"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button type="button" class="menu_button" data-turn-delete="${index}" title="이 메시지부터 이후 대화 삭제" aria-label="이 메시지부터 이후 대화 삭제"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>` : '';
            return `<article class="stsm-generation-turn ${turn.role === 'user' ? 'is-user' : 'is-assistant'}${structured ? ' is-structured' : ''}"><div class="stsm-generation-turn-heading"><small>${turn.role === 'user' ? '나' : index === 0 ? '최초 요약' : structured ? '수정안' : '상담'}</small>${actions}</div><div class="stsm-generation-bubble">${body}</div></article>`;
        }).join('');
        $('[data-history]').scrollTop = scrollToEnd ? $('[data-history]').scrollHeight : previousScrollTop;
        $('[data-apply]').disabled = busy || !session.candidate;
    };
    const setBusy = value => {
        busy = value;
        form.querySelectorAll('input,textarea,button').forEach(element => { element.disabled = value; });
        $('[data-apply]').disabled = value || !session.candidate;
    };
    const acceptCandidate = (response, strict = false) => {
        try {
            createConversationDraft(session, response, owner);
            session.candidate = response;
            $('[data-status]').textContent = '수정안을 받았습니다. 본문과 도감 변경안을 검토할 수 있어요.';
        } catch (error) {
            if (strict) { delete session.candidate; throw error; }
        }
    };
    $('[data-history]').addEventListener('click', async event => {
        const button = event.target.closest('[data-turn-edit], [data-turn-delete]');
        if (!button || busy) return;
        const deleting = button.hasAttribute('data-turn-delete');
        const index = Number(deleting ? button.dataset.turnDelete : button.dataset.turnEdit);
        const turn = session.history[index];
        const editor = document.createElement('div'); editor.className = 'stsm-generation-dialog';
        const notice = document.createElement('p');
        notice.textContent = deleting ? '이 메시지와 이후 대화를 모두 삭제할까요? 이미 적용한 요약·도감은 되돌리지 않습니다.' : '수정하면 이후 대화는 삭제됩니다. 이미 적용한 요약·도감은 유지됩니다.';
        editor.append(notice);
        const input = document.createElement('textarea'); input.className = 'text_pole'; input.rows = 8; input.value = turn.text; input.setAttribute('aria-label', '메시지 수정');
        if (!deleting) editor.append(input);
        let resend = false;
        setBusy(true);
        try {
            await new Popup(editor, POPUP_TYPE.CONFIRM, '', {
                okButton: deleting ? '이후 대화까지 삭제' : turn.role === 'user' ? '수정 후 다시 보내기' : '수정', cancelButton: '취소',
                wide: true, allowVerticalScrolling: true,
                onClosing: popup => {
                    if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
                    try {
                        checkGenerationOwner(owner);
                        if (!deleting && !input.value.trim()) throw new Error('메시지를 입력해주세요.');
                        if (!deleting && turn.role === 'user') {
                            check();
                            changeGenerationTurn(session, index);
                            session.input = input.value.trim(); $('[data-input]').value = session.input;
                            form.querySelector(`input[value="${turn.mode === 'write' ? 'write' : 'consult'}"]`).checked = true;
                            resend = true;
                        } else {
                            changeGenerationTurn(session, index, deleting ? null : input.value);
                            $('[data-status]').textContent = deleting ? '선택한 메시지부터 이후 대화를 삭제했습니다.' : '응답을 수정했습니다.';
                            if (!deleting) acceptCandidate(input.value);
                        }
                        return true;
                    } catch (error) { toastr.error(error.message); return false; }
                },
            }).show();
        } finally { setBusy(false); render(false); }
        if (resend) $('[data-send]').click();
    });
    const prepare = async () => {
        check(); remember();
        if (!session.input.trim()) throw new Error('요청을 입력해주세요.');
        if (!Number.isInteger(session.inputBudget) || session.inputBudget < 1000 || session.inputBudget > 200000
            || !Number.isInteger(session.outputTokens) || session.outputTokens < 1 || session.outputTokens > 200000) {
            throw new Error('토큰 한도를 올바르게 입력해주세요.');
        }
        const prompt = composeGenerationConversation(session, session.input.trim());
        const tokens = await getTokenCountAsync(prompt);
        check();
        $('[data-status]').textContent = `입력 약 ${tokens.toLocaleString()} tokens · 출력 최대 ${session.outputTokens.toLocaleString()}`;
        return { prompt, tokens };
    };
    $('[data-inspect]').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
            const { prompt } = await prepare();
            const pre = document.createElement('pre'); pre.className = 'stsm-author-prompt'; pre.textContent = prompt;
            await new Popup(pre, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true }).show();
        } catch (error) { $('[data-status]').textContent = error.message; }
        finally { setBusy(false); }
    });
    $('[data-send]').addEventListener('click', async () => {
        if (busy) return;
        let operation;
        setBusy(true);
        try {
            operation = beginOperation('generation-conversation', '요약과 대화');
            const { prompt, tokens } = await prepare();
            if (tokens > session.inputBudget) throw new Error('입력 토큰 한도를 초과했습니다. 한도를 조정해주세요. 원본 프롬프트와 대화는 임의로 잘라내지 않습니다.');
            const response = await generateSummary(prompt, { maxTokens: session.outputTokens });
            check();
            if (!response?.trim()) throw new Error('응답이 비어 있습니다.');
            session.history.push({ role: 'user', text: session.input.trim(), mode: session.mode },
                { role: 'assistant', text: response, mode: session.mode });
            session.input = ''; $('[data-input]').value = '';
            acceptCandidate(response, session.mode === 'write');
        } catch (error) { $('[data-status]').textContent = error.message; }
        finally { if (operation) endOperation(operation); setBusy(false); render(); }
    });
    $('[data-apply]').addEventListener('click', async () => {
        if (busy || !session.candidate) return;
        let operation;
        setBusy(true);
        try {
            operation = beginOperation('generation-conversation', '요약 수정안 검토');
            const draft = createConversationDraft(session, session.candidate, owner);
            await showSummaryRegenerationPreview(draft, async resolved => {
                check();
                // Preview resolution clones the draft; restore the live chat identity.
                const updated = await applySummaryRegenerationDraft({ ...resolved, sourceChat: owner.chat });
                session.baseline = createRegenerationRecordSignature(updated);
                delete session.candidate;
                $('[data-status]').textContent = '수정안을 적용했습니다.';
                await onApplied();
            });
        } catch (error) { $('[data-status]').textContent = error.message; }
        finally { if (operation) endOperation(operation); setBusy(false); }
    });
    render();
    await new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '나중에 이어가기', cancelButton: '저장 없이 닫기', wide: true, large: true, allowVerticalScrolling: true,
        onClosing: async popup => {
            if (busy) { $('[data-status]').textContent = '요청이 끝난 뒤 닫아주세요.'; return false; }
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                checkGenerationOwner(owner); remember();
                const previous = owner.store?.generationConversation;
                if (previous && previous.id !== session.id) {
                    const message = document.createElement('p'); message.textContent = '이 채팅에 저장된 이전 요약 대화를 현재 대화로 바꿀까요?';
                    if (await new Popup(message, POPUP_TYPE.CONFIRM, '', { okButton: '바꾸기', cancelButton: '취소' }).show() !== POPUP_RESULT.AFFIRMATIVE) return false;
                }
                await saveGenerationConversation(owner, session);
                return true;
            } catch (error) { $('[data-status]').textContent = error.message; return false; }
        },
    }).show();
}

export async function openGeneratedConversations(sessions, onApplied) {
    if (!sessions.length) return;
    if (sessions.length === 1) return openGenerationConversation(sessions[0], onApplied);
    const owner = getGenerationOwner();
    const list = document.createElement('div'); list.className = 'stsm-generation-dialog';
    const heading = document.createElement('h3'); heading.textContent = '대화할 요약 선택'; list.append(heading);
    for (const session of sessions) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'menu_button';
        button.textContent = `#${session.startId} ~ #${session.endId}`;
        button.addEventListener('click', async () => {
            try { checkGenerationOwner(owner); await openGenerationConversation(session, onApplied); }
            catch (error) { toastr.error(error.message); }
        });
        list.append(button);
    }
    await new Popup(list, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true }).show();
}

export async function openSavedGenerationConversation(onApplied) {
    if (!getRecentGenerationConversations().length) return openExplicitlySavedConversation(onApplied);
    const owner = getGenerationOwner();
    const content = document.createElement('div'); content.className = 'stsm-generation-dialog';
    const render = () => {
        content.innerHTML = '<h3>보관된 요약 대화</h3>';
        if (owner.store?.generationConversation) {
            const saved = document.createElement('button'); saved.type = 'button'; saved.className = 'menu_button';
            saved.textContent = '직접 저장한 대화'; saved.dataset.generationSaved = '';
            saved.addEventListener('click', async () => {
                try { checkGenerationOwner(owner); await openExplicitlySavedConversation(onApplied); render(); }
                catch (error) { toastr.error(error.message); }
            });
            content.append(saved);
        }
        const heading = document.createElement('strong'); heading.textContent = '최근 요약 · 자동 보관'; content.append(heading);
        for (const session of [...getRecentGenerationConversations()].reverse()) {
            const row = document.createElement('div'); row.className = 'stsm-generation-archive-row';
            const open = document.createElement('button'); open.type = 'button'; open.className = 'menu_button';
            open.dataset.generationRecent = session.id;
            open.textContent = `#${session.startId} ~ #${session.endId}`;
            open.title = '생성 당시 프롬프트와 응답으로 상담 시작';
            open.addEventListener('click', async () => {
                try { checkGenerationOwner(owner); await openGenerationConversation(structuredClone(session), onApplied); render(); }
                catch (error) { toastr.error(error.message); }
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'menu_button';
            remove.title = '자동 보관 원본 삭제'; remove.setAttribute('aria-label', remove.title);
            remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
            remove.addEventListener('click', async () => {
                const message = document.createElement('p'); message.textContent = '이 자동 보관 원본을 삭제할까요? 요약 레코드와 직접 저장한 대화는 유지됩니다.';
                if (await new Popup(message, POPUP_TYPE.CONFIRM, '', { okButton: '삭제', cancelButton: '취소' }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
                try { await deleteRecentGenerationConversation(owner, session.id); render(); }
                catch (error) { toastr.error(error.message); }
            });
            row.append(open, remove); content.append(row);
        }
    };
    render();
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true }).show();
}

async function openExplicitlySavedConversation(onApplied) {
    const owner = getGenerationOwner();
    if (!owner.store?.generationConversation) { toastr.info('저장된 요약 대화가 없습니다.'); return; }
    const content = document.createElement('div'); content.className = 'stsm-generation-dialog';
    const label = document.createElement('strong'); label.textContent = '최근 요약 대화';
    const remove = document.createElement('button'); remove.className = 'menu_button'; remove.type = 'button';
    remove.title = '저장된 대화 삭제'; remove.setAttribute('aria-label', remove.title);
    remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
    content.append(label, remove);
    remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
            const message = document.createElement('p'); message.textContent = '저장된 요약 대화를 삭제할까요? 요약 레코드는 유지됩니다.';
            if (await new Popup(message, POPUP_TYPE.CONFIRM, '', { okButton: '삭제', cancelButton: '취소' }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
            await saveGenerationConversation(owner, null); label.textContent = '저장된 대화 없음';
        } catch (error) { toastr.error(error.message); }
        finally { remove.disabled = false; }
    });
    await new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '이어가기', cancelButton: '닫기', onClosing: async popup => {
        if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
        try {
            checkGenerationOwner(owner);
            const session = readGenerationConversation();
            if (session) await openGenerationConversation(session, onApplied);
            return true;
        } catch (error) { toastr.error(error.message); return false; }
    } }).show();
}
