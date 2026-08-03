import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../scripts/popup.js';
import { generateSummary } from './generation.js';
import { buildRevisionPrompt } from './prompt-builder.js';
import {
    getRecentRevisionConversation,
    getSummaryRecord,
    setRecentRevisionConversation,
    updateSummaryRecordContent,
} from './summary-store.js';
import { escapeHtml } from './utils.js';

let activeSession = null;
let revisionPopup = null;
let revisionRoot = null;

export async function openRevisionChat(recordId, { onApplied } = {}) {
    if (revisionPopup) return;

    const record = getSummaryRecord(recordId);
    if (!record) {
        toastr.warning('수정할 요약 기록을 찾지 못했습니다.');
        return;
    }

    if (!isSessionValidForRecord(activeSession, record)) {
        await persistActiveSession();
        activeSession = createSession(record);
    }

    revisionRoot = buildRevisionPopup();
    bindRevisionEvents(revisionRoot);
    renderRevisionSession();

    revisionPopup = new Popup(revisionRoot, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        leftAlign: true,
        okButton: '닫기',
        customButtons: [{
            text: '현재 수정안 적용',
            result: POPUP_RESULT.CUSTOM1,
            classes: ['popup-button-ok'],
        }],
        onOpen: () => {
            renderRevisionSession();
            scrollMessagesToBottom();
        },
        onClosing: async popup => {
            if (popup.result === POPUP_RESULT.CUSTOM1) {
                return await applyLatestRevision(onApplied);
            }
            await persistActiveSession();
            return true;
        },
    });

    try {
        await revisionPopup.show();
    } finally {
        revisionPopup = null;
        revisionRoot = null;
    }
}

export function clearRevisionSession() {
    activeSession = null;
    revisionPopup?.completeCancelled();
}

export async function buildCurrentRevisionPromptPreview() {
    const session = activeSession
        ? {
            ...activeSession,
            messages: [...activeSession.messages],
        }
        : { baseContent: '', messages: [] };
    const pendingFeedback = revisionRoot?.querySelector('.stsm-revision-input')?.value?.trim();
    if (pendingFeedback) session.messages.push({ role: 'user', text: pendingFeedback });
    return await buildRevisionPrompt(session);
}

function createSession(record) {
    return {
        chatRef: SillyTavern.getContext().chat,
        recordId: record.id,
        startId: record.startId,
        endId: record.endId,
        baseContent: record.content,
        baseHash: record.contentHash,
        messages: [],
        isGenerating: false,
    };
}

function buildRevisionPopup() {
    const root = document.createElement('div');
    root.className = 'stsm-revision-popup';
    root.innerHTML = `
        <header class="stsm-revision-header">
            <strong class="stsm-revision-title"></strong>
            <button class="stsm-revision-recent menu_button menu_button_icon interactable" type="button" title="최근 수정 대화" aria-label="최근 수정 대화">
                <i class="fa-solid fa-clock-rotate-left"></i>
            </button>
        </header>
        <div class="stsm-revision-messages"></div>
        <div class="stsm-revision-input-row">
            <textarea class="stsm-revision-input text_pole" rows="3" placeholder="요약 수정에 대한 피드백을 입력하세요."></textarea>
            <button class="stsm-revision-send menu_button menu_button_icon interactable" type="button" title="피드백 전송" aria-label="피드백 전송">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </div>
    `;
    return root;
}

function bindRevisionEvents(root) {
    root.querySelector('.stsm-revision-send').addEventListener('click', sendFeedback);
    root.querySelector('.stsm-revision-recent').addEventListener('click', restoreRecentConversation);
    root.querySelector('.stsm-revision-input').addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        sendFeedback();
    });
}

async function sendFeedback() {
    if (!revisionRoot || activeSession?.isGenerating) return;
    const session = activeSession;
    const input = revisionRoot.querySelector('.stsm-revision-input');
    const feedback = input.value.trim();
    if (!feedback) {
        toastr.info('수정 피드백을 입력해주세요.');
        return;
    }

    session.messages.push({ role: 'user', text: feedback });
    input.value = '';
    session.isGenerating = true;
    renderRevisionSession();

    try {
        await persistSession(session);
        const prompt = await buildRevisionPrompt(session);
        if (!prompt.trim()) throw new Error('현재 설정으로 조립된 수정 프롬프트가 비어 있습니다.');
        const text = await generateSummary(prompt);
        if (!text) throw new Error('수정 대화 응답이 비어 있습니다.');
        if (activeSession !== session || SillyTavern.getContext().chat !== session.chatRef) return;
        session.messages.push({ role: 'assistant', text, prompt });
        await persistSession(session);
    } catch (error) {
        console.error('[Chat Summarizer] Revision generation failed:', error);
        toastr.error(error.message || '수정 대화 생성에 실패했습니다.');
    } finally {
        session.isGenerating = false;
        renderRevisionSession();
        scrollMessagesToBottom();
    }
}

function renderRevisionSession() {
    if (!revisionRoot || !activeSession) return;
    revisionRoot.querySelector('.stsm-revision-title').textContent = `#${activeSession.startId} ~ #${activeSession.endId} 요약 수정`;
    const messages = revisionRoot.querySelector('.stsm-revision-messages');
    messages.innerHTML = activeSession.messages.length
        ? activeSession.messages.map(renderMessage).join('')
        : '<div class="stsm-revision-empty">수정할 내용을 피드백으로 전달해주세요.</div>';
    if (activeSession.isGenerating) {
        messages.insertAdjacentHTML('beforeend', `
            <div class="stsm-revision-entry stsm-revision-entry-assistant">
                <div class="stsm-revision-role">수정안</div>
                <div class="stsm-revision-message stsm-revision-message-assistant">생성 중...</div>
            </div>
        `);
    }

    const input = revisionRoot.querySelector('.stsm-revision-input');
    const send = revisionRoot.querySelector('.stsm-revision-send');
    input.disabled = activeSession.isGenerating;
    send.disabled = activeSession.isGenerating;
    revisionRoot.querySelector('.stsm-revision-recent').disabled = activeSession.isGenerating || !getRecentRevisionConversation();
    updateApplyControl();
}

function renderMessage(message) {
    const role = message.role === 'user' ? '피드백' : '수정안';
    return `
        <div class="stsm-revision-entry stsm-revision-entry-${message.role}">
            <div class="stsm-revision-role">${role}</div>
            <div class="stsm-revision-message stsm-revision-message-${message.role}">
                <div class="stsm-revision-text">${escapeHtml(message.text)}</div>
            </div>
        </div>
    `;
}

function updateApplyControl() {
    if (!revisionPopup) return;
    const control = revisionPopup.dlg.querySelector(`[data-result="${POPUP_RESULT.CUSTOM1}"]`);
    if (!control) return;
    const disabled = activeSession.isGenerating || !getLatestAssistantMessage();
    control.classList.toggle('disabled', disabled);
    control.setAttribute('aria-disabled', String(disabled));
}

async function applyLatestRevision(onApplied) {
    if (activeSession?.isGenerating) return false;
    const latest = getLatestAssistantMessage();
    if (!latest) {
        toastr.info('적용할 수정안이 없습니다.');
        return false;
    }

    try {
        await persistActiveSession();
        const updatedRecord = await updateSummaryRecordContent(activeSession.recordId, latest.text, { prompt: latest.prompt });
        if (!updatedRecord) throw new Error('수정안을 적용할 요약 기록을 찾지 못했습니다.');
        activeSession = null;
        onApplied?.(updatedRecord);
        toastr.success('수정안을 요약에 적용했습니다.');
        return true;
    } catch (error) {
        console.error('[Chat Summarizer] Failed to apply revision:', error);
        toastr.error(error.message || '수정안 적용에 실패했습니다.');
        return false;
    }
}

async function restoreRecentConversation() {
    if (activeSession?.isGenerating) return;
    const recent = getRecentRevisionConversation();
    if (!recent) return;

    const content = document.createElement('div');
    content.className = 'stsm-recent-revision-popup';
    content.innerHTML = `
        <strong>최근 수정 대화 · #${recent.startId} ~ #${recent.endId}</strong>
        <div class="stsm-recent-revision-messages">${recent.messages.map(renderMessage).join('')}</div>
    `;
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '불러오기',
        cancelButton: '닫기',
        wide: true,
        large: true,
        leftAlign: true,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) return;

    const sourceRecord = getSummaryRecord(recent.recordId);
    if (!sourceRecord) {
        toastr.warning('최근 수정 대화의 원본 요약 기록이 삭제되었습니다.');
        return;
    }
    if (sourceRecord.contentHash !== recent.baseHash) {
        toastr.warning('원본 요약이 변경되어 최근 수정 대화를 불러올 수 없습니다.');
        return;
    }
    if (!await Popup.show.confirm('현재 수정 대화를 최근 대화로 교체할까요?', `#${recent.startId} ~ #${recent.endId}`)) return;

    activeSession = {
        ...structuredClone(recent),
        chatRef: SillyTavern.getContext().chat,
        isGenerating: false,
    };
    renderRevisionSession();
    scrollMessagesToBottom();
}

async function persistActiveSession() {
    await persistSession(activeSession);
}

async function persistSession(session) {
    if (!session?.messages.length || SillyTavern.getContext().chat !== session.chatRef) return;
    try {
        await setRecentRevisionConversation({
            ...session,
            savedAt: Date.now(),
        });
    } catch (error) {
        console.error('[Chat Summarizer] Failed to save recent revision conversation:', error);
        toastr.warning('최근 수정 대화를 저장하지 못했습니다.');
    }
}

function getLatestAssistantMessage() {
    return activeSession?.messages.findLast(message => message.role === 'assistant') || null;
}

function isSessionValidForRecord(session, record) {
    return Boolean(
        session
        && session.chatRef === SillyTavern.getContext().chat
        && session.recordId === record.id
        && session.baseHash === record.contentHash
    );
}

function scrollMessagesToBottom() {
    const messages = revisionRoot?.querySelector('.stsm-revision-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
}
