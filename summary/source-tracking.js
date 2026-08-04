import { getStringHash } from '../../../../../scripts/utils.js';
import { isMessageAutoHiddenBySummarizer } from '../visibility/message-visibility-state.js';

const SOURCE_FINGERPRINT_VERSION = 1;

export const SOURCE_STATES = Object.freeze({
    CURRENT: 'current',
    MOVED: 'moved',
    STALE: 'stale',
    UNTRACKED: 'untracked',
});

export function createSourceFingerprint(messages) {
    const messageHashes = (Array.isArray(messages) ? messages : [])
        .map(entry => createMessageFingerprint(entry?.message));

    return {
        version: SOURCE_FINGERPRINT_VERSION,
        messageCount: messageHashes.length,
        hash: hashValues(messageHashes),
        messageHashes,
    };
}

export function normalizeSourceFingerprint(source) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.messageHashes)) return null;

    const messageHashes = source.messageHashes.map(value => String(value));
    const messageCount = Number(source.messageCount);
    if (!messageHashes.length || !Number.isInteger(messageCount) || messageCount !== messageHashes.length) return null;

    return {
        version: SOURCE_FINGERPRINT_VERSION,
        messageCount,
        hash: hashValues(messageHashes),
        messageHashes,
    };
}

export function getSummaryRecordSourceStatus(record, chat = SillyTavern.getContext().chat) {
    const statuses = getSummaryRecordSourceStatuses(record ? [record] : [], chat);
    return statuses.get(record?.id) || createSourceStatus(SOURCE_STATES.UNTRACKED, record?.startId, record?.endId);
}

export function getSummaryRecordSourceStatuses(records, chat = SillyTavern.getContext().chat) {
    const messages = Array.isArray(chat) ? chat : [];
    const chatHashes = messages.map(createMessageFingerprint);
    const statuses = new Map();

    for (const record of Array.isArray(records) ? records : []) {
        const source = normalizeSourceFingerprint(record?.sourceFingerprint);
        if (!source) {
            statuses.set(record.id, createSourceStatus(SOURCE_STATES.UNTRACKED, record.startId, record.endId));
            continue;
        }

        const storedStartId = Number(record.startId);
        if (sequenceMatches(chatHashes, storedStartId, source.messageHashes)) {
            statuses.set(record.id, createSourceStatus(
                SOURCE_STATES.CURRENT,
                storedStartId,
                storedStartId + source.messageCount - 1,
            ));
            continue;
        }

        const movedStartId = findClosestSequence(chatHashes, source.messageHashes, storedStartId);
        statuses.set(record.id, movedStartId === null
            ? createSourceStatus(SOURCE_STATES.STALE, record.startId, record.endId)
            : createSourceStatus(SOURCE_STATES.MOVED, movedStartId, movedStartId + source.messageCount - 1));
    }

    return statuses;
}

function createMessageFingerprint(message) {
    if (!message) return hashValues(['missing']);

    const sendDate = String(message.send_date ?? '');
    if (message.is_system && !isMessageAutoHiddenBySummarizer(message)) {
        return hashValues(['excluded-system', sendDate]);
    }

    const role = message.is_user ? 'user' : 'assistant';
    const content = String(message.mes || '');
    if (!content.trim()) return hashValues(['excluded-empty', role, sendDate]);

    return hashValues([
        'message',
        role,
        String(message.name || ''),
        sendDate,
        content,
    ]);
}

function sequenceMatches(chatHashes, startId, expectedHashes) {
    if (!Number.isInteger(startId) || startId < 0 || startId + expectedHashes.length > chatHashes.length) return false;
    return expectedHashes.every((hash, index) => chatHashes[startId + index] === hash);
}

function findClosestSequence(chatHashes, expectedHashes, preferredStartId) {
    const matches = [];
    const lastStartId = chatHashes.length - expectedHashes.length;
    for (let startId = 0; startId <= lastStartId; startId += 1) {
        if (sequenceMatches(chatHashes, startId, expectedHashes)) matches.push(startId);
    }
    if (!matches.length) return null;

    return matches.reduce((closest, candidate) => (
        Math.abs(candidate - preferredStartId) < Math.abs(closest - preferredStartId) ? candidate : closest
    ));
}

function createSourceStatus(state, startId, endId) {
    return {
        state,
        startId: Number(startId),
        endId: Number(endId),
    };
}

function hashValues(values) {
    return String(getStringHash(JSON.stringify(values)));
}
