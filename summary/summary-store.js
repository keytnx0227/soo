import { createId } from '../core/utils.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { getStringHash } from '../../../../../scripts/utils.js';
import { normalizeSourceFingerprint } from './source-tracking.js';
import { renderStructuredSummary } from './summary-format.js';
import { renderCompressionSummary } from './compression-format.js';
import { createRecordDeletionPlan } from './range-deletion.js';

const METADATA_KEY = 'sumi_chat_summarizer';
const COMPRESSION_CONTENT_MIGRATION_VERSION = 1;
const RECORD_STORAGE_VERSION = 1;
export const COMPRESSION_MODES = Object.freeze({
    INTEGRATED: 'integrated',
    SEGMENTED: 'segmented',
});
let renderCacheOwner = null;
let recordRenderCache = new Map();
const normalizedStores = new WeakSet();
window.addEventListener('stsm:records-changed', clearRecordRenderCache);

export function getSummaryRecords() {
    const store = getStore();
    const mode = resolveCompressionMode();
    const records = getModeRecords(store.records, mode);
    const renderSettings = getRecordRenderSettings();
    return records.map(record => hydrateRecord(record, renderSettings, mode));
}

export function getSummaryRecordIndex() {
    const store = getStore();
    const mode = resolveCompressionMode();
    return getModeRecords(store.records, mode).map(record => toRecordIndexEntry(record, mode));
}

export function getSummaryRecordSourceIndex() {
    const store = getStore();
    const mode = resolveCompressionMode();
    return getModeRecords(store.records, mode).map(record => ({
        ...toRecordIndexEntry(record, mode),
        sourceFingerprint: record.sourceFingerprint ? structuredClone(record.sourceFingerprint) : null,
    }));
}

export function getActiveSummaryRecords() {
    return getSummaryRecords().filter(record => !record.compressedBy);
}

export function getSummaryRecord(recordId) {
    const store = getStore();
    const mode = resolveCompressionMode();
    const record = getModeRecords(store.records, mode).find(item => item.id === String(recordId));
    return record ? hydrateRecord(record, getRecordRenderSettings(), mode) : null;
}

export function getSummaryRecordsByIds(recordIds) {
    const ids = Array.isArray(recordIds) ? recordIds.map(String) : [];
    if (!ids.length) return [];
    const store = getStore();
    const mode = resolveCompressionMode();
    const recordsById = new Map(getModeRecords(store.records, mode).map(record => [record.id, record]));
    const renderSettings = getRecordRenderSettings();
    return ids.map(id => {
        const record = recordsById.get(id);
        return record ? hydrateRecord(record, renderSettings, mode) : null;
    });
}

export function getCompressionMode() {
    return normalizeCompressionMode(getSettings().summarization.compressionMode);
}

export function setCompressionMode(mode) {
    const normalized = normalizeCompressionMode(mode);
    const settings = getSettings();
    if (settings.summarization.compressionMode === normalized) return normalized;
    settings.summarization.compressionMode = normalized;
    saveSettings();
    window.dispatchEvent(new CustomEvent('stsm:compression-mode-changed'));
    return normalized;
}

export function getIntegratedCompressionCleanupPlan() {
    const records = getStore().records.filter(record => (
        getCompressionRecordMode(record) === COMPRESSION_MODES.INTEGRATED
    ));
    return {
        count: records.length,
        ranges: records
            .map(record => ({ startId: record.startId, endId: record.endId }))
            .sort((left, right) => left.startId - right.startId || left.endId - right.endId),
    };
}

export async function deleteIntegratedCompressionData() {
    const store = getStore();
    if (getCompressionMode() !== COMPRESSION_MODES.SEGMENTED) {
        throw new Error('세그먼트형(v3)으로 전환한 뒤 통합형 압축 데이터를 삭제할 수 있습니다.');
    }
    const deletedIds = new Set(store.records
        .filter(record => getCompressionRecordMode(record) === COMPRESSION_MODES.INTEGRATED)
        .map(record => record.id));
    if (!deletedIds.size) return { count: 0, ranges: [] };
    const plan = getIntegratedCompressionCleanupPlan();
    const previousRecords = store.records;
    const previousRecentConversation = store.recentRevisionConversation;
    store.records = store.records
        .filter(record => !deletedIds.has(record.id))
        .map(record => deletedIds.has(record.compressedBy) ? { ...record, compressedBy: null } : record);
    if (deletedIds.has(String(store.recentRevisionConversation?.recordId))) {
        store.recentRevisionConversation = null;
    }
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        store.recentRevisionConversation = previousRecentConversation;
        throw error;
    }
    notifyRecordsChanged();
    return plan;
}

export function getCompressionParentId(record, mode = getCompressionMode()) {
    return normalizeCompressionMode(mode) === COMPRESSION_MODES.SEGMENTED
        ? normalizeOptionalId(record?.segmentedCompressedBy)
        : normalizeOptionalId(record?.compressedBy);
}

export function getCompressionRecordMode(record) {
    if (!record?.compression) return null;
    return record.compression.mode === COMPRESSION_MODES.SEGMENTED
        ? COMPRESSION_MODES.SEGMENTED
        : COMPRESSION_MODES.INTEGRATED;
}

function toRecordIndexEntry(record, mode) {
    return {
        id: record.id,
        type: record.type,
        compressedBy: getCompressionParentId(record, mode),
        integratedCompressedBy: record.compressedBy,
        segmentedCompressedBy: record.segmentedCompressedBy,
        pinned: record.pinned,
        batchId: record.batchId,
        startId: record.startId,
        endId: record.endId,
        compression: record.compression ? {
            level: record.compression.level,
        } : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

export async function initializeSummaryRecordStorage() {
    const store = getStore();
    const needsVersionUpdate = Number(store.recordStorageVersion || 0) < RECORD_STORAGE_VERSION;
    const hasLegacyCompressionMode = Object.hasOwn(store, 'compressionMode');
    if (!needsVersionUpdate && !hasLegacyCompressionMode) return false;

    const previousVersion = store.recordStorageVersion;
    const previousCompressionMode = store.compressionMode;
    if (needsVersionUpdate) store.recordStorageVersion = RECORD_STORAGE_VERSION;
    if (hasLegacyCompressionMode) delete store.compressionMode;
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        if (previousVersion === undefined) delete store.recordStorageVersion;
        else store.recordStorageVersion = previousVersion;
        if (hasLegacyCompressionMode) store.compressionMode = previousCompressionMode;
        throw error;
    }
    return true;
}

export function needsCompressionContentMigration() {
    return Number(getStore().compressionContentMigrationVersion || 0) < COMPRESSION_CONTENT_MIGRATION_VERSION;
}

export async function saveCompressionContentMigrationResults(updates) {
    const normalizedUpdates = new Map((Array.isArray(updates) ? updates : []).map(update => [
        String(update.recordId),
        update.data,
    ]));
    const store = getStore();
    const previousRecords = store.records;
    const previousVersion = store.compressionContentMigrationVersion;
    const editedIds = new Set(store.records
        .filter(record => record.type === 'compressed' && record.legacyContent && record.compression?.data)
        .map(record => record.id));
    if ([...normalizedUpdates.keys()].some(id => !editedIds.has(id))) {
        throw new Error('동기화할 편집된 압축 요약 레코드를 찾지 못했습니다.');
    }

    const updatedAt = new Date().toISOString();
    store.records = store.records.map(record => {
        const data = normalizedUpdates.get(record.id);
        if (!data) return record;
        const updated = {
            ...record,
            compression: {
                ...record.compression,
                data: structuredClone(data),
            },
            updatedAt,
        };
        delete updated.legacyContent;
        return updated;
    });
    store.compressionContentMigrationVersion = COMPRESSION_CONTENT_MIGRATION_VERSION;

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        if (previousVersion === undefined) delete store.compressionContentMigrationVersion;
        else store.compressionContentMigrationVersion = previousVersion;
        throw error;
    }
    if (normalizedUpdates.size) notifyRecordsChanged();
    return normalizedUpdates.size;
}

export async function saveAtlasRecordReviewOverrides(entries) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    if (!normalizedEntries.length) throw new Error('적용할 레코드별 도감 재검토 결과가 없습니다.');
    const store = getStore();
    const previousRecords = store.records;
    const byRecordId = new Map(normalizedEntries.map(entry => [String(entry.recordId), entry]));
    const found = new Set();
    const reviewedAt = new Date().toISOString();

    store.records = store.records.map(record => {
        const entry = byRecordId.get(record.id);
        if (!entry) return record;
        if (record.type !== 'summary' || !record.structuredSummary) {
            throw new Error(`#${record.startId} ~ #${record.endId} 레코드는 도감 변경안을 교체할 수 없습니다.`);
        }
        const category = String(entry.category);
        if (!['people', 'items', 'commitments', 'events', 'world'].includes(category)) {
            throw new Error('지원하지 않는 도감 종류입니다.');
        }
        found.add(record.id);
        return {
            ...record,
            atlasReviewOverrides: {
                ...record.atlasReviewOverrides,
                [category]: {
                    memoryUpdates: structuredClone(entry.memoryUpdates),
                    reviewedAt,
                },
            },
            updatedAt: reviewedAt,
        };
    });
    if (found.size !== byRecordId.size) {
        store.records = previousRecords;
        throw new Error('재검토 결과를 적용할 일부 요약 레코드를 찾지 못했습니다.');
    }
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return normalizedEntries.length;
}

export async function clearAtlasRecordReviewOverride(recordId, category) {
    const store = getStore();
    const previousRecords = store.records;
    let changed = false;
    store.records = store.records.map(record => {
        if (record.id !== String(recordId) || !record.atlasReviewOverrides?.[category]) return record;
        const atlasReviewOverrides = { ...record.atlasReviewOverrides };
        delete atlasReviewOverrides[category];
        changed = true;
        return { ...record, atlasReviewOverrides, updatedAt: new Date().toISOString() };
    });
    if (!changed) return false;
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return true;
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

export async function addSummaryRecord({ batchId, startId, endId, content, sourceFingerprint, structuredSummary }) {
    const normalizedStructuredSummary = normalizeStructuredSummary(structuredSummary);
    const legacyContent = normalizedStructuredSummary ? null : String(content || '').trim();
    if (!normalizedStructuredSummary && !legacyContent) throw new Error('요약 내용은 비워둘 수 없습니다.');
    const record = {
        id: createId('summary'),
        type: 'summary',
        compressedBy: null,
        segmentedCompressedBy: null,
        pinned: false,
        batchId: normalizeOptionalId(batchId),
        startId: Number(startId),
        endId: Number(endId),
        ...(legacyContent ? { legacyContent } : {}),
        sourceFingerprint: normalizeSourceFingerprint(sourceFingerprint),
        structuredSummary: normalizedStructuredSummary,
        searchTags: null,
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
    return hydrateRecord(record);
}

export async function addCompressedSummaryRecord({ sourceRecordIds, content, compressionData, languageMode, mode = getCompressionMode() }) {
    const store = getStore();
    const normalizedMode = normalizeCompressionMode(mode);
    const normalizedSourceIds = [...new Set((Array.isArray(sourceRecordIds) ? sourceRecordIds : []).map(String))];
    const modeRecords = getModeRecords(store.records, normalizedMode);
    const sources = normalizedSourceIds.map(id => modeRecords.find(record => record.id === id));
    if (sources.length < 2 || sources.some(record => !record)) {
        throw new Error('압축할 원본 요약 레코드를 두 개 이상 찾지 못했습니다.');
    }
    if (sources.some(record => getCompressionParentId(record, normalizedMode))) {
        throw new Error('이미 다른 압축본에 포함된 요약 레코드는 다시 직접 압축할 수 없습니다.');
    }

    const sortedSources = [...sources].sort((left, right) => left.startId - right.startId || left.endId - right.endId);
    const normalizedCompressionData = compressionData && typeof compressionData === 'object'
        ? structuredClone(compressionData)
        : null;
    const legacyContent = normalizedCompressionData ? null : String(content || '').trim();
    if (!normalizedCompressionData && !legacyContent) throw new Error('압축 요약 내용은 비워둘 수 없습니다.');
    const record = {
        id: createId('compression'),
        type: 'compressed',
        compressedBy: null,
        segmentedCompressedBy: null,
        pinned: false,
        batchId: null,
        startId: sortedSources[0].startId,
        endId: sortedSources.at(-1).endId,
        ...(legacyContent ? { legacyContent } : {}),
        sourceFingerprint: null,
        structuredSummary: null,
        searchTags: null,
        compression: {
            version: 1,
            mode: normalizedMode,
            level: Math.max(...sortedSources.map(source => Number(source.compression?.level) || 0)) + 1,
            sourceRecordIds: sortedSources.map(source => source.id),
            languageMode: String(languageMode || 'english'),
            data: normalizedCompressionData || {},
        },
        createdAt: new Date().toISOString(),
    };

    const previousRecords = store.records;
    store.records = [
        ...store.records.map(source => {
            if (!normalizedSourceIds.includes(source.id)) return source;
            return normalizedMode === COMPRESSION_MODES.SEGMENTED
                ? { ...source, segmentedCompressedBy: record.id }
                : { ...source, compressedBy: record.id };
        }),
        record,
    ];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return hydrateRecord(record);
}

export async function deleteSummaryRecord(recordId) {
    const store = getStore();
    const mode = resolveCompressionMode();
    const target = getModeRecords(store.records, mode).find(record => record.id === String(recordId));
    if (!target) return false;
    if (getCompressionParentId(target, mode)) {
        throw new Error('압축본에 포함된 원본은 해당 압축본을 먼저 삭제해야 합니다.');
    }
    const plan = await deleteSummaryRecords([target.id]);
    return plan.deletedIds.length > 0;
}

export function getSummaryRecordDeletionPlan(recordIds) {
    return createRecordDeletionPlan(getStore().records, recordIds);
}

export async function deleteSummaryRecords(recordIds) {
    const store = getStore();
    const plan = createRecordDeletionPlan(store.records, recordIds);
    if (!plan.deletedIds.length) return plan;

    const deletedIds = new Set(plan.deletedIds);
    const previousRecords = store.records;
    const previousRecentConversation = store.recentRevisionConversation;
    store.records = store.records
        .filter(record => !deletedIds.has(record.id))
        .map(record => {
            const compressedBy = deletedIds.has(record.compressedBy) ? null : record.compressedBy;
            const segmentedCompressedBy = deletedIds.has(record.segmentedCompressedBy) ? null : record.segmentedCompressedBy;
            const sourceRecordIds = record.compression?.sourceRecordIds.filter(id => !deletedIds.has(id));
            const compressionChanged = Boolean(record.compression)
                && sourceRecordIds.length !== record.compression.sourceRecordIds.length;
            if (compressedBy === record.compressedBy
                && segmentedCompressedBy === record.segmentedCompressedBy
                && !compressionChanged) return record;
            return {
                ...record,
                compressedBy,
                segmentedCompressedBy,
                compression: compressionChanged ? { ...record.compression, sourceRecordIds } : record.compression,
            };
        });
    if (deletedIds.has(String(store.recentRevisionConversation?.recordId))) {
        store.recentRevisionConversation = null;
    }

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        store.recentRevisionConversation = previousRecentConversation;
        throw error;
    }
    notifyRecordsChanged();
    return plan;
}

export async function updateSummaryRecordContent(recordId, content, {
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

        const previousRuntimeRecord = hydrateRecord(record);
        const nextRecord = {
            ...record,
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
            updatedAt: new Date().toISOString(),
        };
        const keepLegacyContent = contentEdited === undefined
            ? Boolean(record.legacyContent)
            : Boolean(contentEdited);
        if (keepLegacyContent) nextRecord.legacyContent = normalizedContent;
        else delete nextRecord.legacyContent;

        recordRenderCache.delete(normalizedId);
        const nextRuntimeRecord = hydrateRecord(nextRecord);
        nextRecord.translation = nextRuntimeRecord.contentHash === previousRuntimeRecord.contentHash
            ? record.translation
            : null;
        updatedRecord = hydrateRecord(nextRecord);
        return nextRecord;
    });

    if (!updatedRecord) return null;

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        recordRenderCache.delete(normalizedId);
        throw error;
    }
    notifyRecordsChanged();
    return updatedRecord;
}

export async function saveSummaryContentMigrationResults(updates) {
    const normalizedUpdates = new Map((Array.isArray(updates) ? updates : []).map(update => [
        String(update.recordId),
        update.data,
    ]));
    if (!normalizedUpdates.size) return 0;

    const store = getStore();
    const previousRecords = store.records;
    const existingIds = new Set(store.records
        .filter(record => record.type === 'summary' && record.legacyContent && record.structuredSummary?.data)
        .map(record => record.id));
    if ([...normalizedUpdates.keys()].some(id => !existingIds.has(id))) {
        throw new Error('동기화할 편집된 요약 레코드를 찾지 못했습니다.');
    }

    const updatedAt = new Date().toISOString();
    store.records = store.records.map(record => {
        const data = normalizedUpdates.get(record.id);
        if (!data) return record;
        const updated = {
            ...record,
            structuredSummary: normalizeStructuredSummary({
                ...record.structuredSummary,
                data,
            }),
            updatedAt,
        };
        delete updated.legacyContent;
        return updated;
    });

    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.records = previousRecords;
        throw error;
    }
    notifyRecordsChanged();
    return normalizedUpdates.size;
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
    return hydrateRecord(updatedRecord);
}

export async function updateSummaryRecordPinned(recordId, pinned) {
    const normalizedId = String(recordId);
    const store = getStore();
    const mode = resolveCompressionMode();
    const previousRecords = store.records;
    let updatedRecord = null;

    store.records = store.records.map(record => {
        if (record.id !== normalizedId) return record;
        if (!getCompressionParentId(record, mode)) {
            throw new Error('장기기억 레코드만 고정할 수 있습니다.');
        }
        updatedRecord = {
            ...record,
            pinned: Boolean(pinned),
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
    return hydrateRecord(updatedRecord);
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
    return updatedRecords.map(hydrateRecord);
}

export async function setSummaryRecordTranslation(recordId, translation) {
    const normalizedId = String(recordId);
    const store = getStore();
    const previousRecords = store.records;
    let updatedRecord = null;

    store.records = store.records.map(record => {
        if (record.id !== normalizedId) return record;
        const runtimeRecord = hydrateRecord(record);
        updatedRecord = {
            ...record,
            translation: normalizeTranslation(translation, runtimeRecord.contentHash, runtimeRecord.contentHash),
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
    return hydrateRecord(updatedRecord);
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
    if (renderCacheOwner !== metadata) {
        renderCacheOwner = metadata;
        recordRenderCache = new Map();
    }

    if (!metadata[METADATA_KEY] || typeof metadata[METADATA_KEY] !== 'object') {
        metadata[METADATA_KEY] = { records: [] };
    }

    const store = metadata[METADATA_KEY];
    if (!normalizedStores.has(store)) {
        store.records = normalizeRecords(store.records);
        store.recentRevisionConversation = normalizeRevisionConversation(store.recentRevisionConversation);
        normalizedStores.add(store);
    }
    return store;
}

function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];

    const normalized = records
        .filter(Boolean)
        .map(record => {
            const structuredSummary = normalizeStructuredSummary(record.structuredSummary);
            const compression = normalizeCompression(record.compression);
            const legacyContent = String(record.legacyContent ?? record.content ?? '').trim();
            const hasStructuredData = Boolean(structuredSummary || compression?.data && Object.keys(compression.data).length);
            const preserveLegacyContent = Boolean(record.contentEdited) || !hasStructuredData;
            return {
                id: String(record.id || createId('summary')),
                type: compression ? 'compressed' : 'summary',
                compressedBy: normalizeOptionalId(record.compressedBy),
                segmentedCompressedBy: normalizeOptionalId(record.segmentedCompressedBy),
                pinned: Boolean(record.pinned),
                batchId: normalizeOptionalId(record.batchId),
                startId: Math.max(0, Number(record.startId) || 0),
                endId: Math.max(0, Number(record.endId) || 0),
                ...(preserveLegacyContent && legacyContent ? { legacyContent } : {}),
                sourceFingerprint: normalizeSourceFingerprint(record.sourceFingerprint),
                structuredSummary,
                atlasReviewOverrides: normalizeAtlasReviewOverrides(record.atlasReviewOverrides),
                searchTags: Array.isArray(record.searchTags) ? normalizeRecordTags(record.searchTags) : null,
                compression,
                createdAt: String(record.createdAt || new Date().toISOString()),
                updatedAt: record.updatedAt ? String(record.updatedAt) : null,
                translation: normalizeStoredTranslation(record.translation, record.contentHash),
            };
        })
        .filter(record => record.legacyContent || record.structuredSummary || record.compression);
    const byId = new Map(normalized.map(record => [record.id, record]));
    return normalized.map(record => {
        const compression = record.compression ? {
            ...record.compression,
            sourceRecordIds: record.compression.sourceRecordIds.filter(id => byId.has(id) && id !== record.id),
        } : null;
        const integratedParent = record.compressedBy ? byId.get(record.compressedBy) : null;
        const segmentedParent = record.segmentedCompressedBy ? byId.get(record.segmentedCompressedBy) : null;
        const compressedBy = getCompressionRecordMode(integratedParent) === COMPRESSION_MODES.INTEGRATED
            && integratedParent.compression.sourceRecordIds.includes(record.id) ? integratedParent.id : null;
        const segmentedCompressedBy = getCompressionRecordMode(segmentedParent) === COMPRESSION_MODES.SEGMENTED
            && segmentedParent.compression.sourceRecordIds.includes(record.id) ? segmentedParent.id : null;
        return {
            ...record,
            type: compression ? 'compressed' : 'summary',
            compression,
            compressedBy,
            segmentedCompressedBy,
        };
    });
}

function hydrateRecord(record, renderSettings = getRecordRenderSettings(), mode = getCompressionMode()) {
    const cacheKey = createRecordRenderCacheKey(record, renderSettings);
    let rendered = recordRenderCache.get(record.id);
    if (rendered?.key !== cacheKey) {
        const content = renderRecordContent(record, renderSettings);
        rendered = {
            key: cacheKey,
            content,
            contentHash: createContentHash(content),
        };
        recordRenderCache.set(record.id, rendered);
    }
    return {
        ...record,
        compressedBy: getCompressionParentId(record, mode),
        integratedCompressedBy: record.compressedBy,
        content: rendered.content,
        contentHash: rendered.contentHash,
        contentEdited: Boolean(record.legacyContent),
        translation: normalizeTranslation(record.translation, rendered.contentHash, record.translation?.sourceHash),
    };
}

function getRecordRenderSettings() {
    const settings = getSettings().summarization;
    return {
        summaryTemplate: settings.summaryContentTemplate,
        summaryOutputSections: settings.summaryOutputSections,
        compressionTemplate: settings.compressionContentTemplate,
        compressionOutputSections: settings.compressionOutputSections,
    };
}

function renderRecordContent(record, settings) {
    if (record.legacyContent) return record.legacyContent;
    if (record.compression?.data) {
        return renderCompressionSummary(record.compression.data, {
            startId: record.startId,
            endId: record.endId,
            template: settings.compressionTemplate,
            outputSections: settings.compressionOutputSections,
        });
    }
    if (record.structuredSummary?.data) {
        return renderStructuredSummary(record.structuredSummary.data, {
            startId: record.startId,
            endId: record.endId,
            template: settings.summaryTemplate,
            outputSections: settings.summaryOutputSections,
        });
    }
    return '';
}

function createRecordRenderCacheKey(record, settings) {
    const template = record.compression ? settings.compressionTemplate : settings.summaryTemplate;
    const outputSections = record.compression
        ? settings.compressionOutputSections
        : settings.summaryOutputSections;
    return [
        record.type,
        record.startId,
        record.endId,
        record.updatedAt || record.createdAt,
        record.legacyContent || '',
        template,
        JSON.stringify(outputSections),
    ].join('\u0000');
}

function normalizeCompression(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.sourceRecordIds)) return null;
    const data = value.data && typeof value.data === 'object' ? structuredClone(value.data) : {};
    delete data.relationships;
    return {
        version: Math.max(1, Number(value.version) || 1),
        mode: value.mode === COMPRESSION_MODES.SEGMENTED
            ? COMPRESSION_MODES.SEGMENTED
            : COMPRESSION_MODES.INTEGRATED,
        level: Math.max(1, Number(value.level) || 1),
        sourceRecordIds: [...new Set(value.sourceRecordIds.map(String).filter(Boolean))],
        languageMode: String(value.languageMode || 'english'),
        data,
    };
}

function normalizeCompressionMode(value) {
    if (Object.values(COMPRESSION_MODES).includes(value)) return value;
    return COMPRESSION_MODES.SEGMENTED;
}

function resolveCompressionMode() {
    return getCompressionMode();
}

function getModeRecords(records, mode) {
    const normalizedMode = normalizeCompressionMode(mode);
    return records.filter(record => !record.compression || getCompressionRecordMode(record) === normalizedMode);
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

function normalizeAtlasReviewOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const categories = ['people', 'items', 'commitments', 'events', 'world'];
    return Object.fromEntries(categories.map(category => {
        const entry = value[category];
        if (!entry || typeof entry !== 'object' || !entry.memoryUpdates || typeof entry.memoryUpdates !== 'object') {
            return [category, null];
        }
        return [category, {
            memoryUpdates: structuredClone(entry.memoryUpdates),
            reviewedAt: String(entry.reviewedAt || new Date().toISOString()),
        }];
    }).filter(([, entry]) => entry));
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

function normalizeStoredTranslation(translation, fallbackSourceHash = '') {
    if (!translation || typeof translation !== 'object' || !String(translation.content || '').trim()) return null;
    return {
        content: String(translation.content).trim(),
        sourceHash: String(translation.sourceHash ?? fallbackSourceHash),
        provider: ['google', 'bing'].includes(translation.provider) ? translation.provider : 'google',
        targetLanguage: String(translation.targetLanguage || 'ko'),
        translatedAt: String(translation.translatedAt || new Date().toISOString()),
    };
}

function createContentHash(content) {
    return String(getStringHash(String(content || '').trim()));
}

function clearRecordRenderCache() {
    recordRenderCache = new Map();
}

function notifyRecordsChanged() {
    window.dispatchEvent(new CustomEvent('stsm:records-changed'));
}

function normalizeRevisionConversation(conversation) {
    if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.messages)) return null;

    const messages = conversation.messages
        .filter(message => message && ['user', 'assistant'].includes(message.role) && String(message.text || '').trim())
        .map(message => {
            const normalized = {
                role: message.role,
                text: String(message.text).trim(),
            };
            if (message.role === 'assistant') {
                const result = normalizeRevisionResult(message.result);
                if (result) normalized.result = result;
            }
            return normalized;
        });
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

function normalizeRevisionResult(result) {
    if (!result || !['summary', 'compressed'].includes(result.type) || !result.data || typeof result.data !== 'object') {
        return null;
    }
    return {
        type: result.type,
        data: structuredClone(result.data),
    };
}
