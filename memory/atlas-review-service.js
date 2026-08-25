import { createId } from '../core/utils.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { generateSummary } from '../connection/generation.js';
import { buildAtlasReviewPrompt } from '../prompts/prompt-builder.js';
import { createSummaryChunks } from '../summary/chunking.js';
import { parseAtlasReviewResponse } from '../summary/summary-format.js';
import { filterLlmVisibleSummaryRecords, getSummaryRecords, saveAtlasRecordReviewOverrides } from '../summary/summary-store.js';
import { validateSummaryRange } from '../summary/summary-service.js';
import { getCoveredRanges } from '../summary/range-utils.js';
import { createStableAtlasEntityId } from './atlas-entity-id.js';
import {
    getAtlasCorrections,
    getAtlasReviewRecords,
    getManualAtlasEntries,
    saveAtlasReviewRecord,
} from './atlas-metadata.js';
import { getAtlasProjection } from './atlas-projection-service.js';

export const ATLAS_REVIEW_CATEGORIES = Object.freeze({
    people: '인물 도감',
    items: '아이템 도감',
    commitments: '서약 장부',
    events: '주요 사건',
    world: '세계 설정',
});

export const ATLAS_REVIEW_MODES = Object.freeze({
    QUICK: 'quick',
    RECORD: 'record',
    CHRONOLOGICAL: 'chronological',
});

export function getAtlasReviewRecordCandidates() {
    return filterLlmVisibleSummaryRecords(getSummaryRecords())
        .filter(record => record.type === 'summary' && record.structuredSummary)
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);
}

export function getAtlasReviewOverview(category) {
    assertCategory(category);
    const records = getAtlasReviewRecordCandidates();
    const processed = records.filter(record => Boolean(record.structuredSummary.memorySections?.[category])
        || Boolean(record.atlasReviewOverrides?.[category])
        || hasMemoryUpdates(record.structuredSummary.data.memoryUpdates?.[category]));
    const changed = records.filter(record => hasMemoryUpdates(
        record.atlasReviewOverrides?.[category]?.memoryUpdates
        || record.structuredSummary.data.memoryUpdates?.[category],
    ));
    const reviewed = getAtlasReviewRecords().filter(record => record.category === category);
    return {
        processedRanges: getCoveredRanges(processed),
        changedRanges: getCoveredRanges(changed),
        reviewedRanges: getCoveredRanges(reviewed),
    };
}

export function buildAtlasReviewPromptPreviews({
    mode,
    category,
    startId,
    endId,
    startRecordId,
    endRecordId,
}) {
    assertCategory(category);
    const hiddenIds = getHiddenAtlasEntityIds(category);
    if (isRecordReviewMode(mode)) {
        return selectRecordRange(startRecordId, endRecordId).map(record => {
            const [target] = createSummaryChunks(
                SillyTavern.getContext().chat,
                record.startId,
                record.endId,
                record.endId - record.startId + 1,
            );
            const updates = record.atlasReviewOverrides?.[category]?.memoryUpdates
                || record.structuredSummary.data.memoryUpdates?.[category]
                || { created: [], updated: [] };
            const contribution = attachExistingSourceIds(updates, category, record.id);
            return buildAtlasReviewPrompt(target, category, {
                mode,
                projectionOptions: mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL
                    ? { beforeStartId: record.startId, includeCorrections: false }
                    : { excludeRecordCategory: { recordId: record.id, category } },
                currentRecordContribution: JSON.stringify(
                    omitHiddenAtlasUpdates(contribution, hiddenIds),
                    null,
                    2,
                ),
            });
        });
    }
    const { start, end, chat } = validateSummaryRange(startId, endId);
    const [target] = createSummaryChunks(chat, start, end, end - start + 1);
    const previous = getAtlasReviewRecords().find(record => record.category === category
        && record.startId === start
        && record.endId === end);
    const previousUpdates = previous
        ? attachExistingSourceIds(previous.memoryUpdates, category, previous.id)
        : null;
    return [buildAtlasReviewPrompt(target, category, {
        mode: ATLAS_REVIEW_MODES.QUICK,
        projectionOptions: previous ? { excludeReviewIds: [previous.id] } : {},
        currentRecordContribution: previousUpdates
            ? JSON.stringify(omitHiddenAtlasUpdates(previousUpdates, hiddenIds), null, 2)
            : null,
    })];
}

export async function createAtlasReviewDraft({
    mode,
    category,
    startId,
    endId,
    startRecordId,
    endRecordId,
    onProgress,
    signal,
}) {
    assertExtensionEnabled();
    assertCategory(category);
    const sourceChat = SillyTavern.getContext().chat;
    const baselineSignature = createAtlasStateSignature();
    const beforeProjection = getAtlasProjection();
    const draft = {
        id: createId('atlas-review-draft'),
        mode,
        category,
        sourceChat,
        baselineSignature,
        appliedThroughId: beforeProjection.frontierId,
        entries: [],
        before: structuredClone(beforeProjection[category]),
        after: null,
        completed: false,
    };

    try {
        if (isRecordReviewMode(mode)) {
            await createRecordReviewEntries(draft, { startRecordId, endRecordId, onProgress, signal });
        } else {
            await createQuickReviewEntry(draft, { startId, endId, onProgress, signal });
        }
        draft.completed = true;
    } catch (error) {
        error.atlasReviewDraft = finalizeDraft(draft);
        throw error;
    }
    return finalizeDraft(draft);
}

export async function applyAtlasReviewDraft(draft) {
    if (!draft?.entries?.length) throw new Error('적용할 도감 재검토 결과가 없습니다.');
    if (SillyTavern.getContext().chat !== draft.sourceChat || createAtlasStateSignature() !== draft.baselineSignature) {
        const error = new Error('검토 요청 이후 채팅 또는 도감 상태가 변경되었습니다. 현재 상태를 기준으로 다시 검토해주세요.');
        error.code = 'STSM_ATLAS_REVIEW_STALE';
        throw error;
    }

    if (isRecordReviewMode(draft.mode)) {
        await saveAtlasRecordReviewOverrides(draft.entries.map(entry => ({
            recordId: entry.recordId,
            category: draft.category,
            memoryUpdates: entry.memoryUpdates,
        })));
        return;
    }

    const [entry] = draft.entries;
    await saveAtlasReviewRecord({
        id: entry.reviewId,
        category: draft.category,
        startId: entry.startId,
        endId: entry.endId,
        appliedThroughId: draft.appliedThroughId,
        batchId: draft.id,
        memoryUpdates: entry.memoryUpdates,
    });
}

async function createQuickReviewEntry(draft, { startId, endId, onProgress, signal }) {
    const { start, end, chat } = validateSummaryRange(startId, endId);
    const [target] = createSummaryChunks(chat, start, end, end - start + 1);
    if (!target) throw new Error('선택한 범위에 재검토할 메시지가 없습니다.');
    const previous = getAtlasReviewRecords().find(record => record.category === draft.category
        && record.startId === start
        && record.endId === end);
    const reviewId = previous?.id || createId('atlas-review');
    const previousUpdates = previous
        ? attachExistingSourceIds(previous.memoryUpdates, draft.category, reviewId)
        : null;
    const hiddenIds = getHiddenAtlasEntityIds(draft.category);
    const visiblePreviousUpdates = previousUpdates
        ? omitHiddenAtlasUpdates(previousUpdates, hiddenIds)
        : null;
    throwIfCancelled(signal, draft);
    onProgress?.({ current: 1, total: 1, target });
    const prompt = buildAtlasReviewPrompt(target, draft.category, {
        mode: ATLAS_REVIEW_MODES.QUICK,
        projectionOptions: previous ? { excludeReviewIds: [previous.id] } : {},
        currentRecordContribution: visiblePreviousUpdates
            ? JSON.stringify(visiblePreviousUpdates, null, 2)
            : null,
    });
    const response = await generateSummary(prompt);
    throwIfCancelled(signal, draft);
    ensureChatUnchanged(draft.sourceChat);
    const parsed = stabilizeCreatedSourceIds(
        parseAtlasReviewResponse(response, draft.category),
        visiblePreviousUpdates,
        draft.category,
    );
    draft.entries.push({
        reviewId,
        startId: start,
        endId: end,
        memoryUpdates: restoreHiddenAtlasUpdates(parsed, previousUpdates, hiddenIds),
    });
}

async function createRecordReviewEntries(draft, { startRecordId, endRecordId, onProgress, signal }) {
    const records = selectRecordRange(startRecordId, endRecordId);
    const pendingOverrides = [];
    const hiddenIds = getHiddenAtlasEntityIds(draft.category);
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        try {
            throwIfCancelled(signal, draft);
            ensureChatUnchanged(draft.sourceChat);
            onProgress?.({ current: index + 1, total: records.length, target: record });
            const [target] = createSummaryChunks(
                draft.sourceChat,
                record.startId,
                record.endId,
                record.endId - record.startId + 1,
            );
            if (!target) throw new Error(`#${record.startId} ~ #${record.endId} 원본 메시지를 찾지 못했습니다.`);
            const originalUpdates = record.atlasReviewOverrides?.[draft.category]?.memoryUpdates
                || record.structuredSummary.data.memoryUpdates?.[draft.category]
                || { created: [], updated: [] };
            const contribution = attachExistingSourceIds(originalUpdates, draft.category, record.id);
            const visibleContribution = omitHiddenAtlasUpdates(contribution, hiddenIds);
            const prompt = buildAtlasReviewPrompt(target, draft.category, {
                mode: draft.mode,
                projectionOptions: draft.mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL
                    ? {
                        draftRecordOverrides: pendingOverrides,
                        beforeStartId: record.startId,
                        includeCorrections: false,
                    }
                    : {
                        draftRecordOverrides: pendingOverrides,
                        excludeRecordCategory: { recordId: record.id, category: draft.category },
                    },
                currentRecordContribution: JSON.stringify(visibleContribution, null, 2),
            });
            const response = await generateSummary(prompt);
            throwIfCancelled(signal, draft);
            ensureChatUnchanged(draft.sourceChat);
            const visibleMemoryUpdates = stabilizeCreatedSourceIds(
                parseAtlasReviewResponse(response, draft.category),
                visibleContribution,
                draft.category,
            );
            const memoryUpdates = restoreHiddenAtlasUpdates(
                visibleMemoryUpdates,
                contribution,
                hiddenIds,
            );
            const entry = {
                recordId: record.id,
                startId: record.startId,
                endId: record.endId,
                memoryUpdates,
            };
            draft.entries.push(entry);
            pendingOverrides.push({ recordId: record.id, category: draft.category, memoryUpdates });
        } catch (error) {
            if (error?.code === 'STSM_ATLAS_REVIEW_CANCELLED') throw error;
            throw createRecordBatchError(error, record, draft.entries, records.slice(index + 1));
        }
    }
}

function finalizeDraft(draft) {
    const projectionOptions = isRecordReviewMode(draft.mode)
        ? {
            draftRecordOverrides: draft.entries.map(entry => ({
                recordId: entry.recordId,
                category: draft.category,
                memoryUpdates: entry.memoryUpdates,
            })),
        }
        : draft.entries.length ? {
            draftReviewRecords: draft.entries.map(entry => ({
                id: entry.reviewId,
                category: draft.category,
                startId: entry.startId,
                endId: entry.endId,
                appliedThroughId: draft.appliedThroughId,
                memoryUpdates: entry.memoryUpdates,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })),
        } : {};
    draft.after = structuredClone(getAtlasProjection(projectionOptions)[draft.category]);
    return draft;
}

function isRecordReviewMode(mode) {
    return mode === ATLAS_REVIEW_MODES.RECORD || mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL;
}

function selectRecordRange(startRecordId, endRecordId) {
    const records = getAtlasReviewRecordCandidates();
    const startIndex = records.findIndex(record => record.id === String(startRecordId));
    const endIndex = records.findIndex(record => record.id === String(endRecordId));
    if (startIndex < 0 || endIndex < 0) throw new Error('시작과 종료 요약 레코드를 모두 선택해주세요.');
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return records.slice(from, to + 1);
}

function attachExistingSourceIds(memoryUpdates, category, sourceRecordId) {
    const clone = structuredClone(memoryUpdates || { created: [], updated: [] });
    clone.created = (clone.created || []).map((proposal, index) => ({
        sourceId: proposal.sourceId || createStableAtlasEntityId(category, sourceRecordId, index),
        ...proposal,
    }));
    return clone;
}

function stabilizeCreatedSourceIds(memoryUpdates, previousUpdates, category) {
    const previous = Array.isArray(previousUpdates?.created) ? previousUpdates.created : [];
    const allowed = new Map(previous.map(proposal => [proposal.sourceId, proposal]));
    const identities = new Map(previous.map(proposal => [getProposalIdentity(category, proposal), proposal.sourceId]));
    const used = new Set();
    const created = (memoryUpdates.created || []).map(proposal => {
        let sourceId = allowed.has(proposal.sourceId) ? proposal.sourceId : null;
        if (!sourceId) sourceId = identities.get(getProposalIdentity(category, proposal)) || null;
        if (!sourceId || used.has(sourceId)) sourceId = createId(`${category}-entry`);
        used.add(sourceId);
        return { ...proposal, sourceId };
    });
    return { ...memoryUpdates, created };
}

function getHiddenAtlasEntityIds(category) {
    return new Set(getAtlasProjection()[category]
        .filter(entity => entity.llmHidden)
        .map(entity => String(entity.id)));
}

function omitHiddenAtlasUpdates(memoryUpdates, hiddenIds) {
    if (!memoryUpdates || !hiddenIds.size) return structuredClone(memoryUpdates);
    return {
        ...structuredClone(memoryUpdates),
        created: (memoryUpdates.created || [])
            .filter(proposal => !hiddenIds.has(String(proposal.sourceId))),
        updated: (memoryUpdates.updated || [])
            .filter(proposal => !hiddenIds.has(String(proposal.targetId))),
    };
}

function restoreHiddenAtlasUpdates(visibleUpdates, originalUpdates, hiddenIds) {
    if (!originalUpdates || !hiddenIds.size) return visibleUpdates;
    const hiddenCreated = (originalUpdates.created || [])
        .filter(proposal => hiddenIds.has(String(proposal.sourceId)));
    const hiddenUpdated = (originalUpdates.updated || [])
        .filter(proposal => hiddenIds.has(String(proposal.targetId)));
    return {
        ...visibleUpdates,
        created: [...(visibleUpdates.created || []), ...structuredClone(hiddenCreated)],
        updated: [...(visibleUpdates.updated || []), ...structuredClone(hiddenUpdated)],
    };
}

function getProposalIdentity(category, proposal) {
    const value = category === 'world'
        ? (proposal.keys || []).join('|')
        : proposal.name || proposal.title || proposal.content || '';
    return String(value).normalize('NFKC').trim().toLocaleLowerCase();
}

function createAtlasStateSignature() {
    const records = getSummaryRecords().map(record => ({
        id: record.id,
        startId: record.startId,
        endId: record.endId,
        llmHidden: record.llmHidden,
        updatedAt: record.updatedAt,
        memoryUpdates: record.structuredSummary?.data?.memoryUpdates,
        atlasReviewOverrides: record.atlasReviewOverrides,
    }));
    return JSON.stringify({
        records,
        reviews: getAtlasReviewRecords(),
        corrections: getAtlasCorrections(),
        manual: Object.fromEntries(Object.keys(ATLAS_REVIEW_CATEGORIES)
            .map(category => [category, getManualAtlasEntries(category)])),
    });
}

function throwIfCancelled(signal, draft) {
    if (!signal?.aborted) return;
    const error = new Error('도감 재검토 작업을 중단했어요. 생성된 초안은 아직 적용되지 않았습니다.');
    error.code = 'STSM_ATLAS_REVIEW_CANCELLED';
    error.completedRecords = draft.entries.map(entry => ({ startId: entry.startId, endId: entry.endId }));
    throw error;
}

function ensureChatUnchanged(sourceChat) {
    if (SillyTavern.getContext().chat !== sourceChat) {
        throw new Error('도감 재검토 중 채팅방이 변경되어 작업을 중단했습니다.');
    }
}

function assertCategory(category) {
    if (!Object.hasOwn(ATLAS_REVIEW_CATEGORIES, category)) {
        throw new Error('재검토할 도감 종류를 선택해주세요.');
    }
}

function createRecordBatchError(error, failedRecord, completedEntries, unattemptedRecords) {
    const completed = completedEntries.length ? formatRecordRanges(completedEntries) : '없음';
    const unattempted = unattemptedRecords.length ? formatRecordRanges(unattemptedRecords) : '없음';
    const reason = error instanceof Error ? error.message : String(error || '알 수 없는 오류');
    const wrapped = new Error(
        `#${failedRecord.startId} ~ #${failedRecord.endId} 레코드 재검토에 실패해 작업을 중단했어요. `
        + `완료 레코드: ${completed} / 이후 미시도 레코드: ${unattempted} / 원인: ${reason}`,
    );
    wrapped.cause = error;
    return wrapped;
}

function formatRecordRanges(records) {
    return records.map(record => `#${record.startId} ~ #${record.endId}`).join(', ');
}

function hasMemoryUpdates(value) {
    return Boolean(value && ((value.created?.length || 0) + (value.updated?.length || 0)));
}
