import { createId } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { getSummaryRecord } from '../summary/summary-store.js';
import { createRegenerationRecordSignature } from '../summary/summary-service.js';
import { parseStructuredSummaryResponse, renderStructuredSummary } from '../summary/summary-format.js';
import { isolateCreatedIds } from './regeneration-review.js';

const KEY = 'generationConversation';
const RECENT_KEY = 'recentGenerationConversations';

export function getRecentGenerationConversations() {
    const stored = getGenerationOwner().store?.[RECENT_KEY];
    return (Array.isArray(stored) ? stored : []).filter(item => item?.version === 1
        && typeof item.originalPrompt === 'string' && item.recordId && item.configuration
        && Array.isArray(item.history)).slice(-5);
}

function findRecordGenerationConversation(recordId) {
    const saved = getGenerationOwner().store?.[KEY];
    const session = saved?.recordId === recordId ? saved
        : getRecentGenerationConversations().find(item => item.recordId === recordId);
    return session || null;
}

export function hasRecordGenerationConversation(recordId) {
    return Boolean(findRecordGenerationConversation(recordId));
}

export function getRecordGenerationConversation(recordId) {
    const session = findRecordGenerationConversation(recordId);
    return session ? structuredClone(session) : null;
}

export async function saveRecentGenerationConversation(owner, session) {
    checkGenerationOwner(owner);
    if (!owner.store) throw new Error('저장할 요약 데이터가 없습니다.');
    const previous = owner.store[RECENT_KEY];
    const next = [...getRecentGenerationConversations().filter(item => item.recordId !== session.recordId), structuredClone(session)].slice(-5);
    owner.store[RECENT_KEY] = next;
    try { await SillyTavern.getContext().saveMetadata(); }
    catch (error) {
        if (owner.store[RECENT_KEY] === next) {
            if (previous === undefined) delete owner.store[RECENT_KEY];
            else owner.store[RECENT_KEY] = previous;
        }
        throw error;
    }
}

export async function deleteRecentGenerationConversation(owner, id) {
    checkGenerationOwner(owner);
    const previous = owner.store?.[RECENT_KEY];
    if (!Array.isArray(previous)) return;
    const next = previous.filter(item => item.id !== id);
    owner.store[RECENT_KEY] = next;
    try { await SillyTavern.getContext().saveMetadata(); }
    catch (error) { if (owner.store[RECENT_KEY] === next) owner.store[RECENT_KEY] = previous; throw error; }
}

export function captureGenerationConversation({ record, prompt, response, outputConfiguration }) {
    return {
        version: 1, id: createId('generation-chat'), recordId: record.id,
        startId: record.startId, endId: record.endId,
        originalPrompt: prompt, configuration: structuredClone(outputConfiguration),
        baseline: createRegenerationRecordSignature(record),
        sourceFingerprint: structuredClone(record.sourceFingerprint),
        history: [{ role: 'assistant', mode: 'write', text: response }],
        mode: 'consult', input: '', inputBudget: 30000, outputTokens: 5000,
    };
}

export function composeGenerationConversation(session, request) {
    const instruction = session.mode === 'write'
        ? 'Generate the complete revised summary JSON using the original output schema, not a patch. Follow the latest user request and the agreed changes in this conversation. Preserve unrelated content and atlas identifiers. Return only the complete JSON.'
        : 'Discuss the summary naturally in the user\'s language. Answer the latest question using the original input, generated summary, and subsequent conversation. This is consultation: the original JSON-only output requirement does not apply by default. When the user asks for revised JSON, return only the complete revised summary JSON using the original schema, not a patch. Both summary content and this record\'s memoryUpdates may be revised. Preserve unrelated content and atlas identifiers.';
    return `${session.originalPrompt}\n\n---\n# Summary follow-up conversation\nThe original request above is preserved as context. The following log contains the original assistant response and subsequent discussion, not a new source story.\n<chatSessionLog>\n${JSON.stringify(session.history)}\n</chatSessionLog>\n\n# Current turn\n${instruction}\nFor this turn, the latest user request and this mode instruction take precedence over conflicting general summary instructions above. Keep the original output schema when generating a revision.\n\n# Latest user request\n${request}`;
}

export function changeGenerationTurn(session, index, text = null) {
    if (!Number.isInteger(index) || index < 1 || index >= session.history.length) throw new Error('변경할 대화 메시지를 찾지 못했습니다.');
    if (text !== null && !text.trim()) throw new Error('메시지를 입력해주세요.');
    const turn = session.history[index];
    session.history = session.history.slice(0, index);
    if (text !== null) session.history.push({ ...turn, text: text.trim() });
    delete session.candidate;
}

export function getGenerationOwner() {
    const context = SillyTavern.getContext();
    return { chat: context.chat, metadata: context.chatMetadata, store: context.chatMetadata?.sumi_chat_summarizer };
}

export function checkGenerationOwner(owner) {
    const current = getGenerationOwner();
    if (current.chat !== owner.chat || current.metadata !== owner.metadata || current.store !== owner.store) {
        throw new Error('채팅이나 저장 데이터가 변경되었습니다. 대화창을 다시 열어주세요.');
    }
}

export function checkGenerationRecord(session) {
    const record = getSummaryRecord(session.recordId);
    if (!record || record.llmHidden || record.compressedBy || record.segmentedCompressedBy
        || createRegenerationRecordSignature(record) !== session.baseline) {
        throw new Error('대상 레코드가 변경·삭제·압축되었거나 숨겨졌습니다. 이 대화에서는 더 이상 요청하거나 적용할 수 없습니다.');
    }
    return record;
}

export function readGenerationConversation() {
    const value = getGenerationOwner().store?.[KEY];
    if (!value) return null;
    if (value.version !== 1 || typeof value.originalPrompt !== 'string' || !value.recordId
        || !value.configuration || !Array.isArray(value.history)
        || value.history.some(turn => !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string')) {
        throw new Error('저장된 요약 대화 형식을 읽을 수 없습니다. 삭제 후 다시 생성해주세요.');
    }
    return structuredClone(value);
}

export async function saveGenerationConversation(owner, session) {
    checkGenerationOwner(owner);
    if (!owner.store) throw new Error('저장할 요약 데이터가 없습니다.');
    const previous = owner.store[KEY];
    if (session) owner.store[KEY] = structuredClone(session);
    else delete owner.store[KEY];
    try { await SillyTavern.getContext().saveMetadata(); }
    catch (error) {
        if (previous === undefined) delete owner.store[KEY];
        else owner.store[KEY] = previous;
        throw error;
    }
}

export function createConversationDraft(session, response, owner) {
    checkGenerationOwner(owner);
    const record = checkGenerationRecord(session);
    const configuration = session.configuration;
    const data = parseStructuredSummaryResponse(response, configuration.sections, configuration.memorySections);
    // Reuse regeneration's explicit reference review; never match atlas entries by name.
    data.memoryUpdates = isolateCreatedIds(data.memoryUpdates);
    const settings = getSettings().summarization;
    return {
        id: createId('summary-regeneration-draft'), recordId: record.id, sourceChat: owner.chat,
        baselineRecordSignature: session.baseline,
        sourceFingerprint: structuredClone(session.sourceFingerprint), previousRecord: structuredClone(record),
        content: renderStructuredSummary(data, { startId: record.startId, endId: record.endId,
            template: settings.summaryContentTemplate, outputSections: settings.summaryOutputSections }),
        structuredSummary: { ...structuredClone(record.structuredSummary), ...structuredClone(configuration), data },
    };
}
