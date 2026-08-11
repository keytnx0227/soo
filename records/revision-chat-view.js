import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    beginOperation,
    endOperation,
    getExtensionState,
    subscribeExtensionState,
} from '../core/extension-state.js';
import { generateSummary } from '../connection/generation.js';
import { getSettings } from '../core/settings.js';
import { buildRevisionPrompt } from '../prompts/prompt-builder.js';
import { createSummaryChunks } from '../summary/chunking.js';
import {
    buildCompressionJsonContract,
    parseCompressionResponse,
    renderCompressionSummary,
} from '../summary/compression-format.js';
import {
    buildSummaryJsonContract,
    getEnabledSummarySections,
    parseStructuredSummaryResponse,
    renderStructuredSummary,
} from '../summary/summary-format.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import {
    getRecentRevisionConversation,
    getSummaryRecord,
    setRecentRevisionConversation,
    updateSummaryRecordContent,
} from '../summary/summary-store.js';
import { escapeHtml } from '../core/utils.js';

let activeSession = null;
let revisionPopup = null;
let revisionRoot = null;
let unsubscribeRevisionState = null;

const NO_MEMORY_SECTIONS = Object.freeze({
    people: false,
    items: false,
    commitments: false,
    events: false,
    world: false,
});

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
    unsubscribeRevisionState = subscribeExtensionState(renderRevisionSession);
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
        unsubscribeRevisionState?.();
        unsubscribeRevisionState = null;
        revisionPopup = null;
        revisionRoot = null;
    }
}

export function clearRevisionSession() {
    activeSession = null;
    revisionPopup?.completeCancelled();
}

export function synchronizeRevisionSessionRanges(updates) {
    if (!activeSession || !Array.isArray(updates)) return;
    const range = updates.find(update => String(update.id) === activeSession.recordId);
    if (!range) return;
    activeSession.startId = Number(range.startId);
    activeSession.endId = Number(range.endId);
    renderRevisionSession();
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
    return await buildRevisionPrompt(createRevisionPromptInput(session));
}

function createSession(record) {
    return {
        chatRef: SillyTavern.getContext().chat,
        recordId: record.id,
        recordType: record.type,
        startId: record.startId,
        endId: record.endId,
        baseContent: record.content,
        baseHash: record.contentHash,
        baseStructuredData: getRecordStructuredData(record),
        structuredSections: record.structuredSummary?.sections || null,
        summarySource: buildSummarySource(record),
        compressionSourceContent: buildCompressionSourceContent(record),
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

    let operationToken = null;
    try {
        operationToken = beginOperation('revising', `#${session.startId} ~ #${session.endId} 수정안 생성 중`);
        session.messages.push({ role: 'user', text: feedback });
        input.value = '';
        session.isGenerating = true;
        renderRevisionSession();
        await persistSession(session);
        const prompt = await buildRevisionPrompt(createRevisionPromptInput(session));
        if (!prompt.trim()) throw new Error('현재 설정으로 조립된 수정 프롬프트가 비어 있습니다.');
        const response = await generateSummary(prompt);
        if (!response) throw new Error('수정 대화 응답이 비어 있습니다.');
        const result = parseRevisionResult(session, response);
        const text = renderRevisionResult(session, result);
        if (activeSession !== session || SillyTavern.getContext().chat !== session.chatRef) return;
        session.messages.push({ role: 'assistant', text, result });
        await persistSession(session);
    } catch (error) {
        console.error('[Chat Summarizer] Revision generation failed:', error);
        addExtensionErrorLog(error, {
            operation: 'revision-generation',
            title: '요약 수정 대화 생성 실패',
            message: '수정 대화 응답을 생성하지 못했습니다.',
            context: { range: getSessionRange(session) },
        });
        toastr.error(error.message || '수정 대화 생성에 실패했습니다.');
    } finally {
        if (operationToken) {
            session.isGenerating = false;
            endOperation(operationToken);
        }
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
    const extensionState = getExtensionState();
    const canGenerate = extensionState.enabled && !extensionState.operation && !activeSession.isGenerating;
    input.disabled = !canGenerate;
    send.disabled = !canGenerate;
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
    const disabled = Boolean(getExtensionState().operation) || activeSession.isGenerating || !getLatestStructuredAssistantMessage();
    control.classList.toggle('disabled', disabled);
    control.setAttribute('aria-disabled', String(disabled));
}

async function applyLatestRevision(onApplied) {
    if (activeSession?.isGenerating) return false;
    const latest = getLatestStructuredAssistantMessage();
    if (!latest) {
        toastr.info('적용할 수정안이 없습니다.');
        return false;
    }

    try {
        await persistActiveSession();
        const record = getSummaryRecord(activeSession.recordId);
        if (!record) throw new Error('수정안을 적용할 요약 기록을 찾지 못했습니다.');
        const content = renderRevisionResult(activeSession, latest.result);
        const update = latest.result.type === 'compressed'
            ? {
                contentEdited: false,
                compressionData: latest.result.data,
            }
            : {
                contentEdited: false,
                structuredSummary: {
                    ...record.structuredSummary,
                    data: latest.result.data,
                },
            };
        const updatedRecord = await updateSummaryRecordContent(activeSession.recordId, content, update);
        if (!updatedRecord) throw new Error('수정안을 적용할 요약 기록을 찾지 못했습니다.');
        activeSession = null;
        onApplied?.(updatedRecord);
        toastr.success('수정안을 요약에 적용했습니다.');
        return true;
    } catch (error) {
        console.error('[Chat Summarizer] Failed to apply revision:', error);
        addExtensionErrorLog(error, {
            operation: 'revision-apply',
            title: '수정안 적용 실패',
            message: '생성된 수정안을 요약 기록에 적용하지 못했습니다.',
            context: { range: getSessionRange(activeSession) },
        });
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
        recordType: sourceRecord.type,
        baseStructuredData: getRecordStructuredData(sourceRecord),
        structuredSections: sourceRecord.structuredSummary?.sections || null,
        summarySource: buildSummarySource(sourceRecord),
        compressionSourceContent: buildCompressionSourceContent(sourceRecord),
        chatRef: SillyTavern.getContext().chat,
        isGenerating: false,
    };
    renderRevisionSession();
    scrollMessagesToBottom();
}

function buildCompressionSourceContent(record) {
    if (record?.type !== 'compressed' || !Array.isArray(record.compression?.sourceRecordIds)) return '';
    return record.compression.sourceRecordIds
        .map(getSummaryRecord)
        .filter(Boolean)
        .map(source => `[#${source.startId}-#${source.endId}]\n${String(source.content || '').trim()}`)
        .filter(Boolean)
        .join('\n\n');
}

function buildSummarySource(record) {
    if (record?.type !== 'summary') return null;
    const chat = SillyTavern.getContext().chat;
    if (!Array.isArray(chat)) return null;
    const startId = Number(record.startId);
    const endId = Number(record.endId);
    if (!Number.isInteger(startId) || !Number.isInteger(endId) || startId < 0 || endId < startId) return null;
    return createSummaryChunks(chat, startId, Math.min(endId, chat.length - 1), endId - startId + 1)[0] || null;
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
        addExtensionErrorLog(error, {
            operation: 'revision-save',
            title: '최근 수정 대화 저장 실패',
            message: '최근 수정 대화를 저장하지 못했습니다.',
            context: { range: getSessionRange(session) },
        });
        toastr.warning('최근 수정 대화를 저장하지 못했습니다.');
    }
}

function getSessionRange(session) {
    const startId = Number(session?.startId);
    const endId = Number(session?.endId);
    return Number.isInteger(startId) && Number.isInteger(endId) ? { startId, endId } : null;
}

function getLatestAssistantMessage() {
    return activeSession?.messages.findLast(message => message.role === 'assistant') || null;
}

function getLatestStructuredAssistantMessage() {
    const message = getLatestAssistantMessage();
    return isRevisionResultCompatible(message?.result, activeSession?.recordType) ? message : null;
}

function createRevisionPromptInput(session) {
    if (!session?.recordType || !session.baseStructuredData) return session;
    const currentData = getCurrentStructuredData(session);
    const isCompressed = session.recordType === 'compressed';
    const sections = isCompressed ? null : getRevisionSections(session);
    const sourceData = isCompressed
        ? currentData
        : parseStructuredSummaryResponse(JSON.stringify(currentData), sections, NO_MEMORY_SECTIONS);
    return {
        ...session,
        structuredSourceContent: JSON.stringify(sourceData, null, 2),
        revisionOutputContract: isCompressed
            ? buildCompressionJsonContract()
            : buildSummaryJsonContract(sections, NO_MEMORY_SECTIONS),
    };
}

function parseRevisionResult(session, response) {
    if (session.recordType === 'compressed') {
        return { type: 'compressed', data: parseCompressionResponse(response) };
    }

    const currentData = getCurrentStructuredData(session);
    const parsed = parseStructuredSummaryResponse(response, getRevisionSections(session), NO_MEMORY_SECTIONS);
    return {
        type: 'summary',
        data: {
            ...parsed,
            tags: structuredClone(currentData.tags || []),
            memoryUpdates: structuredClone(currentData.memoryUpdates || {}),
        },
    };
}

function renderRevisionResult(session, result) {
    const settings = getSettings().summarization;
    if (result.type === 'compressed') {
        return renderCompressionSummary(result.data, {
            startId: session.startId,
            endId: session.endId,
            template: settings.compressionContentTemplate,
        });
    }
    return renderStructuredSummary(result.data, {
        startId: session.startId,
        endId: session.endId,
        template: settings.summaryContentTemplate,
        outputSections: settings.summaryOutputSections,
    });
}

function getCurrentStructuredData(session) {
    const latest = session.messages.findLast(message => (
        message.role === 'assistant' && isRevisionResultCompatible(message.result, session.recordType)
    ));
    return structuredClone(latest?.result?.data || session.baseStructuredData);
}

function getRevisionSections(session) {
    return {
        ...getEnabledSummarySections(session.structuredSections || {}),
        tags: false,
    };
}

function getRecordStructuredData(record) {
    if (record?.type === 'compressed') return structuredClone(record.compression?.data || null);
    return structuredClone(record?.structuredSummary?.data || null);
}

function isRevisionResultCompatible(result, recordType) {
    const expectedType = recordType === 'compressed' ? 'compressed' : 'summary';
    return Boolean(result && result.type === expectedType && result.data && typeof result.data === 'object');
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
