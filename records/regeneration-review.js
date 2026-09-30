import { createId } from '../core/utils.js';
import { getCreatedAtlasEntityId } from '../memory/atlas-entity-id.js';
import { getAtlasCorrections, getAtlasReviewRecords, getManualAtlasEntries } from '../memory/atlas-metadata.js';
import { getSummaryRecords } from '../summary/summary-store.js';
import { getAtlasProjection } from '../memory/atlas-projection-service.js';

export const REVIEW_CATEGORIES = ['people', 'items', 'commitments', 'events', 'world', 'perceptions'];
const KEY = 'stsmRegenerationDrafts';

export function getPendingRegenerations() {
    return SillyTavern.getContext().chatMetadata?.[KEY] || [];
}

export async function savePendingRegenerations(drafts) {
    const context = SillyTavern.getContext();
    const previous = context.chatMetadata[KEY];
    context.chatMetadata[KEY] = drafts;
    try { await context.saveMetadata(); }
    catch (error) { context.chatMetadata[KEY] = previous; throw error; }
    document.dispatchEvent(new Event('stsm:regeneration-pending'));
}

export async function queueRegeneration(draft) {
    if (SillyTavern.getContext().chat !== draft.sourceChat) throw new Error('채팅방이 변경되었습니다.');
    const { sourceChat, ...serializable } = draft;
    const pending = structuredClone(serializable);
    pending.structuredSummary.data.memoryUpdates = isolateCreatedIds(pending.structuredSummary.data.memoryUpdates);
    await savePendingRegenerations([...getPendingRegenerations().filter(item => item.recordId !== draft.recordId), pending]);
    return pending;
}

export function isolateCreatedIds(memoryUpdates = {}) {
    const next = structuredClone(memoryUpdates);
    const maps = {};
    for (const category of REVIEW_CATEGORIES) {
        maps[category] = new Map();
        for (const proposal of next[category]?.created || []) {
            const id = createId(`${category}-entry`);
            if (proposal.sourceId) maps[category].set(proposal.sourceId, id);
            proposal.sourceId = id;
        }
    }
    rewriteReferences(next, maps);
    return next;
}

function rewriteReferences(updates, maps) {
    for (const category of REVIEW_CATEGORIES) {
        for (const entry of updates[category]?.updated || []) {
            entry.targetId = maps[category]?.get(entry.targetId) || entry.targetId;
        }
    }
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (value.personId) value.personId = maps.people?.get(value.personId) || value.personId;
        for (const key of ['relationships', 'relationshipUpdates']) {
            for (const relationship of value[key] || []) {
                relationship.targetId = maps.people?.get(relationship.targetId) || relationship.targetId;
            }
        }
        Object.values(value).forEach(visit);
    };
    visit(updates);
}

export function getRegenerationReferences(draft) {
    const records = getSummaryRecords().filter(record => record.id !== draft.recordId);
    const sources = records.map(record => ({
        label: `#${record.startId} ~ #${record.endId}`,
        updates: Object.fromEntries(REVIEW_CATEGORIES.map(category => [category,
            record.atlasReviewOverrides?.[category]?.memoryUpdates
            || record.structuredSummary?.data?.memoryUpdates?.[category]])),
    }));
    for (const review of getAtlasReviewRecords()) {
        sources.push({ label: `도감 검토 #${review.startId} ~ #${review.endId}`, updates: { [review.category]: review.memoryUpdates } });
    }
    for (const category of REVIEW_CATEGORIES) {
        sources.push({ label: '수동 도감', updates: { [category]: { created: getManualAtlasEntries(category) } } });
    }
    sources.push({ label: '재생성 초안', updates: Object.fromEntries(REVIEW_CATEGORIES.map(category => [category,
        draft.previousRecord.atlasReviewOverrides?.[category]?.memoryUpdates
        || draft.structuredSummary.data.memoryUpdates[category]])) });
    const corrections = getAtlasCorrections();
    const result = [];
    for (const category of REVIEW_CATEGORIES) {
        // Review overrides remain authoritative and are not replaced by regeneration.
        if (draft.previousRecord.atlasReviewOverrides?.[category]?.memoryUpdates) continue;
        const created = draft.previousRecord.structuredSummary?.data?.memoryUpdates?.[category]?.created || [];
        created.forEach((proposal, index) => {
            const id = getCreatedAtlasEntityId(category, draft.recordId, proposal, index);
            const references = sources.filter(source => referencesEntity(source.updates, category, id)).map(source => source.label);
            if (corrections[category]?.[id]) references.push('수동 보정');
            if (category === 'people' && referencesEntity(Object.fromEntries(REVIEW_CATEGORIES.map(key => [key,
                { created: Object.values(corrections[key] || {}).map(item => item.fields) }])), category, id)) references.push('관계 수동 보정');
            if (references.length) result.push({ category, id, proposal, references: [...new Set(references)] });
        });
    }
    // Keeping an old entry can also retain its references to another old entry.
    // Include those dependencies so "keep" cannot silently strand a relationship.
    for (let position = 0; position < result.length; position++) {
        const parent = result[position];
        for (const category of REVIEW_CATEGORIES) {
            if (draft.previousRecord.atlasReviewOverrides?.[category]?.memoryUpdates) continue;
            const created = draft.previousRecord.structuredSummary?.data?.memoryUpdates?.[category]?.created || [];
            created.forEach((proposal, index) => {
                const id = getCreatedAtlasEntityId(category, draft.recordId, proposal, index);
                if (result.some(item => item.category === category && item.id === id)) return;
                if (referencesEntity({ [parent.category]: { created: [parent.proposal] } }, category, id)) {
                    result.push({ category, id, proposal, references: ['기존 항목 유지 시 연결되는 관계'] });
                }
            });
        }
    }
    return result;
}

function referencesEntity(updates, category, id) {
    if ((updates[category]?.updated || []).some(item => item.targetId === id)) return true;
    if (category !== 'people') return false;
    const visit = value => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(visit);
        if (value.personId === id || value.observerId === id || value.subjectId === id) return true;
        if (['relationships', 'relationshipUpdates'].some(key => (value[key] || []).some(item => item.targetId === id))) return true;
        return Object.values(value).some(visit);
    };
    return visit(updates);
}

export function resolveRegeneration(draft, requirements, choices) {
    const resolved = structuredClone(draft);
    const updates = resolved.structuredSummary.data.memoryUpdates;
    const maps = Object.fromEntries(REVIEW_CATEGORIES.map(category => [category, new Map()]));
    for (const requirement of requirements) {
        const { category, id, proposal } = requirement;
        const choice = choices[`${category}:${id}`];
        if (!choice) throw new Error('모든 도감 항목의 연결을 선택해주세요.');
        updates[category] ||= { created: [], updated: [] };
        updates[category].created ||= [];
        if (choice === 'disconnect') continue;
        if (choice === 'keep') {
            updates[category].created.push({ ...structuredClone(proposal), sourceId: id });
            continue;
        }
        if (maps[category].has(choice)) throw new Error('같은 새 항목을 여러 기존 항목에 연결할 수 없습니다.');
        const target = updates[category].created.find(item => item.sourceId === choice);
        if (!target) throw new Error('선택한 새 항목을 찾을 수 없습니다.');
        maps[category].set(choice, id);
        target.sourceId = id;
    }
    rewriteReferences(updates, maps);
    return resolved;
}

export function validateResolvedRegeneration(draft, requirements, choices) {
    const before = getAtlasProjection();
    const after = getAtlasProjection({ draftRecordOverrides: REVIEW_CATEGORIES
        .filter(category => !draft.previousRecord.atlasReviewOverrides?.[category]?.memoryUpdates)
        .map(category => ({ recordId: draft.recordId, category,
            memoryUpdates: draft.structuredSummary.data.memoryUpdates[category] || { created: [], updated: [] } })) });
    for (const category of REVIEW_CATEGORIES) {
        const signature = item => `${item.sourceRecordId}:${item.targetId}:${item.factId || ''}`;
        const existing = new Set((before.skippedUpdates[category] || []).map(signature));
        const allowed = new Set(requirements.filter(item => item.category === category
            && choices[`${category}:${item.id}`] === 'disconnect').map(item => item.id));
        const unexpected = (after.skippedUpdates[category] || []).filter(item => !existing.has(signature(item)) && !allowed.has(item.targetId));
        if (unexpected.length) throw new Error('초안에 연결되지 않은 도감 업데이트가 있습니다. 초안을 다시 생성해주세요.');
    }
}

export function regenerationReferenceSignature(draft) {
    return JSON.stringify({ references: getRegenerationReferences(draft), records: getSummaryRecords(),
        reviews: getAtlasReviewRecords(), corrections: getAtlasCorrections(),
        manual: REVIEW_CATEGORIES.map(category => getManualAtlasEntries(category)) });
}
