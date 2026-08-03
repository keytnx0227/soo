import { createId } from './utils.js';
import { getStringHash } from '../../../../scripts/utils.js';

const METADATA_KEY = 'st_chat_summarizer';

export function getSummaryRecords() {
    return getStore().records;
}

export function getSummaryRecord(recordId) {
    return getSummaryRecords().find(record => record.id === String(recordId)) || null;
}

export function getRecentRevisionConversation() {
    const conversation = getStore().recentRevisionConversation;
    return conversation ? structuredClone(conversation) : null;
}

export async function setRecentRevisionConversation(conversation) {
    const store = getStore();
    const previousConversation = store.recentRevisionConversation;
    const normalized = normalizeRevisionConversation(conversation);
    if (!normalized) return null;

    store.recentRevisionConversation = normalized;
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.recentRevisionConversation = previousConversation;
        throw error;
    }
    return structuredClone(normalized);
}

export async function addSummaryRecord({ startId, endId, content, prompt }) {
    const record = {
        id: createId('summary'),
        startId: Number(startId),
        endId: Number(endId),
        content: String(content || '').trim(),
        contentHash: createContentHash(content),
        prompt: String(prompt || ''),
        createdAt: new Date().toISOString(),
    };
    const store = getStore();
    store.records = [...store.records, record];
    await SillyTavern.getContext().saveMetadata();
    notifyRecordsChanged();
    return record;
}

export async function deleteSummaryRecord(recordId) {
    const store = getStore();
    const previousRecords = store.records;
    const records = store.records.filter(record => record.id !== String(recordId));
    if (records.length === store.records.length) return false;

    store.records = records;
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return true;
}

export async function updateSummaryRecordContent(recordId, content, { prompt } = {}) {
    const normalizedId = String(recordId);
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) throw new Error('요약 내용은 비워둘 수 없습니다.');

    const store = getStore();
    const previousRecords = store.records;
    let updatedRecord = null;

    store.records = store.records.map(record => {
        if (record.id !== normalizedId) return record;

        const contentHash = createContentHash(normalizedContent);
        updatedRecord = {
            ...record,
            content: normalizedContent,
            contentHash,
            prompt: prompt === undefined ? record.prompt : String(prompt),
            translation: contentHash === record.contentHash ? record.translation : null,
            updatedAt: new Date().toISOString(),
        };
        return updatedRecord;
    });

    if (!updatedRecord) return null;

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return updatedRecord;
}

export async function setSummaryRecordTranslation(recordId, translation) {
    const normalizedId = String(recordId);
    const store = getStore();
    const previousRecords = store.records;
    let updatedRecord = null;

    store.records = store.records.map(record => {
        if (record.id !== normalizedId) return record;
        updatedRecord = {
            ...record,
            translation: normalizeTranslation(translation, record.contentHash, record.contentHash),
        };
        return updatedRecord;
    });

    if (!updatedRecord) return null;

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    return updatedRecord;
}

export async function clearAllSummaryTranslations() {
    const store = getStore();
    const previousRecords = store.records;
    const translatedCount = store.records.filter(record => record.translation).length;
    if (!translatedCount) return 0;

    store.records = store.records.map(record => ({
        ...record,
        translation: null,
    }));

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    return translatedCount;
}

function getStore() {
    const context = SillyTavern.getContext();
    const metadata = context.chatMetadata;

    if (!metadata[METADATA_KEY] || typeof metadata[METADATA_KEY] !== 'object') {
        metadata[METADATA_KEY] = { records: [] };
    }

    const store = metadata[METADATA_KEY];
    store.records = normalizeRecords(store.records);
    store.recentRevisionConversation = normalizeRevisionConversation(store.recentRevisionConversation);
    return store;
}

function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];

    return records
        .filter(record => record && String(record.content || '').trim())
        .map(record => {
            const content = String(record.content);
            const contentHash = createContentHash(content);
            return {
                id: String(record.id || createId('summary')),
                startId: Math.max(0, Number(record.startId) || 0),
                endId: Math.max(0, Number(record.endId) || 0),
                content,
                contentHash,
                prompt: String(record.prompt || ''),
                createdAt: String(record.createdAt || new Date().toISOString()),
                updatedAt: record.updatedAt ? String(record.updatedAt) : null,
                translation: normalizeTranslation(record.translation, contentHash, record.contentHash),
            };
        });
}

function normalizeTranslation(translation, contentHash, previousContentHash) {
    if (!translation || typeof translation !== 'object' || !String(translation.content || '').trim()) {
        return null;
    }

    const sourceHash = translation.sourceHash ?? previousContentHash;
    if (sourceHash !== undefined && String(sourceHash) !== contentHash) return null;

    return {
        content: String(translation.content).trim(),
        sourceHash: contentHash,
        provider: ['google', 'bing'].includes(translation.provider) ? translation.provider : 'google',
        targetLanguage: String(translation.targetLanguage || 'ko'),
        translatedAt: String(translation.translatedAt || new Date().toISOString()),
    };
}

function createContentHash(content) {
    return String(getStringHash(String(content || '').trim()));
}

function notifyRecordsChanged() {
    window.dispatchEvent(new CustomEvent('stsm:records-changed'));
}

function normalizeRevisionConversation(conversation) {
    if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.messages)) return null;

    const messages = conversation.messages
        .filter(message => message && ['user', 'assistant'].includes(message.role) && String(message.text || '').trim())
        .map(message => ({
            role: message.role,
            text: String(message.text).trim(),
            ...(message.role === 'assistant' ? { prompt: String(message.prompt || '') } : {}),
        }));
    if (!messages.length) return null;

    return {
        savedAt: Number(conversation.savedAt) || Date.now(),
        recordId: String(conversation.recordId || ''),
        startId: Math.max(0, Number(conversation.startId) || 0),
        endId: Math.max(0, Number(conversation.endId) || 0),
        baseContent: String(conversation.baseContent || ''),
        baseHash: String(conversation.baseHash || ''),
        messages,
    };
}
