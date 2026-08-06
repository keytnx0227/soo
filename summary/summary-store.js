import { createId } from '../core/utils.js';
import { getStringHash } from '../../../../../scripts/utils.js';
import { normalizeSourceFingerprint } from './source-tracking.js';
import { renderStructuredSummary } from './summary-format.js';
import { renderCompressionSummary } from './compression-format.js';

const METADATA_KEY = 'sumi_chat_summarizer';

export function getSummaryRecords() {
    return getStore().records;
}

export function getActiveSummaryRecords() {
    return getSummaryRecords().filter(record => !record.compressedBy);
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

export async function addSummaryRecord({ batchId, startId, endId, content, prompt, sourceFingerprint, structuredSummary }) {
    const record = {
        id: createId('summary'),
        type: 'summary',
        compressedBy: null,
        batchId: normalizeOptionalId(batchId),
        startId: Number(startId),
        endId: Number(endId),
        content: String(content || '').trim(),
        contentHash: createContentHash(content),
        contentEdited: false,
        sourceFingerprint: normalizeSourceFingerprint(sourceFingerprint),
        structuredSummary: normalizeStructuredSummary(structuredSummary),
        searchTags: null,
        prompt: String(prompt || ''),
        createdAt: new Date().toISOString(),
    };
    const store = getStore();
    const previousRecords = store.records;
    store.records = [...store.records, record];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return record;
}

export async function addCompressedSummaryRecord({ sourceRecordIds, content, prompt, compressionData, languageMode }) {
    const store = getStore();
    const normalizedSourceIds = [...new Set((Array.isArray(sourceRecordIds) ? sourceRecordIds : []).map(String))];
    const sources = normalizedSourceIds.map(id => store.records.find(record => record.id === id));
    if (sources.length < 2 || sources.some(record => !record)) {
        throw new Error('압축할 원본 요약 레코드를 두 개 이상 찾지 못했습니다.');
    }
    if (sources.some(record => record.compressedBy)) {
        throw new Error('이미 다른 압축본에 포함된 요약 레코드는 다시 직접 압축할 수 없습니다.');
    }

    const sortedSources = [...sources].sort((left, right) => left.startId - right.startId || left.endId - right.endId);
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) throw new Error('압축 요약 내용은 비워둘 수 없습니다.');
    const record = {
        id: createId('compression'),
        type: 'compressed',
        compressedBy: null,
        batchId: null,
        startId: sortedSources[0].startId,
        endId: sortedSources.at(-1).endId,
        content: normalizedContent,
        contentHash: createContentHash(normalizedContent),
        contentEdited: false,
        sourceFingerprint: null,
        structuredSummary: null,
        searchTags: null,
        prompt: String(prompt || ''),
        compression: {
            version: 1,
            level: Math.max(...sortedSources.map(source => Number(source.compression?.level) || 0)) + 1,
            sourceRecordIds: sortedSources.map(source => source.id),
            languageMode: String(languageMode || 'english'),
            data: compressionData && typeof compressionData === 'object' ? structuredClone(compressionData) : {},
        },
        createdAt: new Date().toISOString(),
    };

    const previousRecords = store.records;
    store.records = [
        ...store.records.map(source => normalizedSourceIds.includes(source.id)
            ? { ...source, compressedBy: record.id }
            : source),
        record,
    ];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return structuredClone(record);
}

export async function deleteSummaryRecord(recordId) {
    const store = getStore();
    const target = store.records.find(record => record.id === String(recordId));
    if (!target) return false;
    if (target.compressedBy) {
        throw new Error('압축본에 포함된 원본은 해당 압축본을 먼저 삭제해야 합니다.');
    }
    const previousRecords = store.records;
    const childIds = new Set(target.compression?.sourceRecordIds || []);
    const records = store.records
        .filter(record => record.id !== String(recordId))
        .map(record => childIds.has(record.id) && record.compressedBy === target.id
            ? { ...record, compressedBy: null }
            : record);

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

export async function updateSummaryRecordContent(recordId, content, {
    prompt,
    sourceFingerprint,
    structuredSummary,
    compressionData,
    contentEdited,
} = {}) {
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
            contentEdited: contentEdited === undefined ? record.contentEdited : Boolean(contentEdited),
            sourceFingerprint: sourceFingerprint === undefined
                ? record.sourceFingerprint
                : normalizeSourceFingerprint(sourceFingerprint),
            structuredSummary: structuredSummary === undefined
                ? record.structuredSummary
                : normalizeStructuredSummary(structuredSummary),
            compression: compressionData === undefined || !record.compression
                ? record.compression
                : {
                    ...record.compression,
                    data: compressionData && typeof compressionData === 'object' ? structuredClone(compressionData) : {},
                },
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

export async function applySummaryContentTemplateToRecords(template, { includeEdited = false } = {}) {
    return applyContentTemplateToRecords({
        template,
        includeEdited,
        emptyTemplateMessage: '적용할 요약 레코드 내용 템플릿이 비어 있습니다.',
        matches: record => record.type === 'summary' && Boolean(record.structuredSummary?.data),
        render: record => renderStructuredSummary(record.structuredSummary.data, {
            startId: record.startId,
            endId: record.endId,
            template,
        }),
    });
}

export async function applyCompressionContentTemplateToRecords(template, { includeEdited = false } = {}) {
    return applyContentTemplateToRecords({
        template,
        includeEdited,
        emptyTemplateMessage: '적용할 압축 레코드 내용 템플릿이 비어 있습니다.',
        matches: record => record.type === 'compressed' && Boolean(record.compression?.data),
        render: record => renderCompressionSummary(record.compression.data, {
            startId: record.startId,
            endId: record.endId,
            template,
        }),
    });
}

async function applyContentTemplateToRecords({ template, includeEdited, emptyTemplateMessage, matches, render }) {
    const normalizedTemplate = String(template || '');
    if (!normalizedTemplate.trim()) throw new Error(emptyTemplateMessage);

    const store = getStore();
    const previousRecords = store.records;
    let appliedCount = 0;
    let skippedEditedCount = 0;

    const nextRecords = store.records.map(record => {
        if (!matches(record)) return record;
        if (record.contentEdited && !includeEdited) {
            skippedEditedCount += 1;
            return record;
        }

        const content = render(record);
        if (!content.trim()) throw new Error(`#${record.startId} ~ #${record.endId} 레코드의 적용 결과가 비어 있습니다.`);
        const contentHash = createContentHash(content);
        appliedCount += 1;
        return {
            ...record,
            content,
            contentHash,
            contentEdited: false,
            translation: contentHash === record.contentHash ? record.translation : null,
            updatedAt: new Date().toISOString(),
        };
    });

    if (!appliedCount) return { appliedCount, skippedEditedCount };
    store.records = nextRecords;

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return { appliedCount, skippedEditedCount };
}

export async function updateSummaryRecordTags(recordId, tags) {
    const normalizedId = String(recordId);
    const normalizedTags = normalizeRecordTags(tags);
    const store = getStore();
    const previousRecords = store.records;
    let updatedRecord = null;

    store.records = store.records.map(record => {
        if (record.id !== normalizedId) return record;
        updatedRecord = {
            ...record,
            searchTags: normalizedTags,
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
    return structuredClone(updatedRecord);
}

export async function updateSummaryRecordRanges(updates) {
    const normalizedUpdates = new Map((Array.isArray(updates) ? updates : []).map(update => [
        String(update.id),
        {
            startId: Number(update.startId),
            endId: Number(update.endId),
        },
    ]));
    if (!normalizedUpdates.size) return [];
    for (const range of normalizedUpdates.values()) {
        if (!Number.isInteger(range.startId) || !Number.isInteger(range.endId)
            || range.startId < 0 || range.startId > range.endId) {
            throw new Error('저장할 요약 범위가 올바르지 않습니다.');
        }
    }

    const store = getStore();
    const previousRecords = store.records;
    const previousRecentConversation = store.recentRevisionConversation;
    const existingIds = new Set(store.records.map(record => record.id));
    if ([...normalizedUpdates.keys()].some(id => !existingIds.has(id))) {
        throw new Error('범위를 변경할 요약 기록을 찾지 못했습니다.');
    }

    const updatedRecords = [];
    store.records = store.records.map(record => {
        const range = normalizedUpdates.get(record.id);
        if (!range) return record;
        const updatedRecord = { ...record, ...range };
        updatedRecords.push(updatedRecord);
        return updatedRecord;
    });

    const recentRange = normalizedUpdates.get(store.recentRevisionConversation?.recordId);
    if (recentRange) {
        store.recentRevisionConversation = {
            ...store.recentRevisionConversation,
            ...recentRange,
        };
    }

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        store.recentRevisionConversation = previousRecentConversation;
        throw error;
    }
    notifyRecordsChanged();
    return updatedRecords;
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

    const normalized = records
        .filter(record => record && String(record.content || '').trim())
        .map(record => {
            const content = String(record.content);
            const contentHash = createContentHash(content);
            return {
                id: String(record.id || createId('summary')),
                type: record.type === 'compressed' || record.compression ? 'compressed' : 'summary',
                compressedBy: normalizeOptionalId(record.compressedBy),
                batchId: normalizeOptionalId(record.batchId),
                startId: Math.max(0, Number(record.startId) || 0),
                endId: Math.max(0, Number(record.endId) || 0),
                content,
                contentHash,
                contentEdited: Boolean(record.contentEdited),
                sourceFingerprint: normalizeSourceFingerprint(record.sourceFingerprint),
                structuredSummary: normalizeStructuredSummary(record.structuredSummary),
                searchTags: Array.isArray(record.searchTags) ? normalizeRecordTags(record.searchTags) : null,
                compression: normalizeCompression(record.compression),
                prompt: String(record.prompt || ''),
                createdAt: String(record.createdAt || new Date().toISOString()),
                updatedAt: record.updatedAt ? String(record.updatedAt) : null,
                translation: normalizeTranslation(record.translation, contentHash, record.contentHash),
            };
        });
    const byId = new Map(normalized.map(record => [record.id, record]));
    return normalized.map(record => {
        const compression = record.compression ? {
            ...record.compression,
            sourceRecordIds: record.compression.sourceRecordIds.filter(id => byId.has(id) && id !== record.id),
        } : null;
        const parent = record.compressedBy ? byId.get(record.compressedBy) : null;
        const compressedBy = parent?.compression?.sourceRecordIds.includes(record.id) ? parent.id : null;
        return {
            ...record,
            type: compression ? 'compressed' : 'summary',
            compression,
            compressedBy,
        };
    });
}

function normalizeCompression(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.sourceRecordIds)) return null;
    const data = value.data && typeof value.data === 'object' ? structuredClone(value.data) : {};
    delete data.relationships;
    return {
        version: Math.max(1, Number(value.version) || 1),
        level: Math.max(1, Number(value.level) || 1),
        sourceRecordIds: [...new Set(value.sourceRecordIds.map(String).filter(Boolean))],
        languageMode: String(value.languageMode || 'english'),
        data,
    };
}

function normalizeStructuredSummary(value) {
    if (!value || typeof value !== 'object' || !value.data || typeof value.data !== 'object') return null;
    const version = Number(value.version);
    if (!Number.isInteger(version) || version < 1) return null;
    return {
        version,
        languageMode: String(value.languageMode || 'english'),
        sections: value.sections && typeof value.sections === 'object' ? structuredClone(value.sections) : {},
        memorySections: value.memorySections && typeof value.memorySections === 'object' ? structuredClone(value.memorySections) : {},
        data: structuredClone(value.data),
    };
}

function normalizeRecordTags(tags) {
    if (!Array.isArray(tags)) return [];
    const merged = new Map();
    for (const tag of tags) {
        if (!tag || typeof tag !== 'object') continue;
        const canonical = String(tag.canonical || '').trim();
        if (!canonical) continue;
        const key = canonical.toLocaleLowerCase();
        const current = merged.get(key) || { canonical, matchTerms: [] };
        const terms = Array.isArray(tag.matchTerms) ? tag.matchTerms : [];
        const knownTerms = new Set(current.matchTerms.map(term => term.toLocaleLowerCase()));
        for (const term of terms) {
            const normalized = String(term || '').trim();
            const termKey = normalized.toLocaleLowerCase();
            if (!normalized || knownTerms.has(termKey)) continue;
            current.matchTerms.push(normalized);
            knownTerms.add(termKey);
        }
        merged.set(key, current);
    }
    return [...merged.values()];
}

function normalizeOptionalId(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
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
