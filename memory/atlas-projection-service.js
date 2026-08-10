import { getSummaryRecords } from '../summary/summary-store.js';
import { getAtlasCorrections, getAtlasReviewRecords, getManualWorldEntries } from './atlas-metadata.js';
import { applyAtlasCorrections } from './atlas-corrections.js';
import { deriveItemAtlas } from './item-memory.js';
import { derivePeopleAtlas } from './people-memory.js';
import { deriveCommitmentAtlas } from './commitment-memory.js';
import { deriveEventAtlas } from './event-memory.js';
import { deriveWorldAtlas } from './world-memory.js';

let cache = null;
let cachedChat = null;

export function invalidateAtlasProjection() {
    cache = null;
    cachedChat = null;
}

export function getAtlasProjection({
    includeCorrections = true,
    excludeReviewIds = [],
    draftReviewRecords = [],
    draftRecordOverrides = [],
    excludeRecordCategory = null,
} = {}) {
    const chat = SillyTavern.getContext().chat;
    const excluded = new Set((Array.isArray(excludeReviewIds) ? excludeReviewIds : []).map(String));
    const hasDraft = draftReviewRecords.length || draftRecordOverrides.length || excludeRecordCategory;
    if (excluded.size || hasDraft) {
        const summaryRecords = prepareSummarySourceRecords(
            getSummaryRecords(),
            draftRecordOverrides,
            excludeRecordCategory,
        );
        const replacementIds = new Set(draftReviewRecords.map(review => review.id));
        const reviewRecords = [
            ...getAtlasReviewRecords().filter(review => !replacementIds.has(review.id)),
            ...draftReviewRecords,
        ]
            .filter(review => !excluded.has(review.id))
            .map(toAtlasSourceRecord);
        const projection = buildAtlasProjection(summaryRecords, reviewRecords);
        return structuredClone(includeCorrections
            ? applyAtlasCorrections(projection, getAtlasCorrections())
            : projection);
    }
    if (!cache || cachedChat !== chat) {
        const summaryRecords = prepareSummarySourceRecords(getSummaryRecords());
        const reviewRecords = getAtlasReviewRecords().map(toAtlasSourceRecord);
        const raw = buildAtlasProjection(summaryRecords, reviewRecords);
        cache = {
            raw,
            corrected: null,
        };
        cachedChat = chat;
    }
    if (!includeCorrections) return structuredClone(cache.raw);
    if (!cache.corrected) cache.corrected = applyAtlasCorrections(cache.raw, getAtlasCorrections());
    return structuredClone(cache.corrected);
}

function prepareSummarySourceRecords(records, draftOverrides = [], excludeRecordCategory = null) {
    const drafts = new Map(draftOverrides.map(entry => [`${entry.recordId}:${entry.category}`, entry.memoryUpdates]));
    return records.map(record => {
        if (!record.structuredSummary?.data?.memoryUpdates) return record;
        const memoryUpdates = { ...record.structuredSummary.data.memoryUpdates };
        for (const category of ['people', 'items', 'commitments', 'events', 'world']) {
            const draft = drafts.get(`${record.id}:${category}`);
            const persisted = record.atlasReviewOverrides?.[category]?.memoryUpdates;
            if (draft) memoryUpdates[category] = structuredClone(draft);
            else if (persisted) memoryUpdates[category] = structuredClone(persisted);
        }
        if (excludeRecordCategory?.recordId === record.id) {
            memoryUpdates[excludeRecordCategory.category] = { created: [], updated: [] };
        }
        return {
            ...record,
            structuredSummary: {
                ...record.structuredSummary,
                data: { ...record.structuredSummary.data, memoryUpdates },
            },
        };
    });
}

function buildAtlasProjection(summaryRecords, reviewRecords) {
    const records = [...summaryRecords, ...reviewRecords];
    const people = derivePeopleAtlas(records);
    const items = deriveItemAtlas(records);
    const commitments = deriveCommitmentAtlas(records);
    const events = deriveEventAtlas(records);
    const world = deriveWorldAtlas(records);
    const manualWorld = getManualWorldEntries().map(toManualWorldAtlasEntry);
    return {
        people: people.people,
        items: items.items,
        commitments: commitments.commitments,
        events: events.events,
        world: [...world.world, ...manualWorld].sort(compareWorldEntries),
        skippedUpdates: {
            people: people.skippedUpdates,
            items: items.skippedUpdates,
            commitments: commitments.skippedUpdates,
            events: events.skippedUpdates,
            world: world.skippedUpdates,
        },
        frontierId: summaryRecords.reduce((maximum, record) => Math.max(maximum, Number(record.endId) || 0), 0),
    };
}

function toAtlasSourceRecord(review) {
    return {
        id: review.id,
        startId: review.startId,
        endId: review.endId,
        appliedThroughId: review.appliedThroughId,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        atlasReview: true,
        structuredSummary: {
            data: {
                memoryUpdates: {
                    [review.category]: structuredClone(review.memoryUpdates),
                },
            },
        },
    };
}

function toManualWorldAtlasEntry(entry) {
    return {
        ...structuredClone(entry),
        manual: true,
        sourceRecordIds: [],
        firstSeenRange: null,
        lastUpdatedRange: null,
        provenance: { fields: {}, values: {} },
    };
}

function compareWorldEntries(left, right) {
    if (Boolean(left.manual) !== Boolean(right.manual)) return left.manual ? 1 : -1;
    const leftPosition = Number(left.firstSeenRange?.startId) || 0;
    const rightPosition = Number(right.firstSeenRange?.startId) || 0;
    return leftPosition - rightPosition
        || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || String(left.content || '').localeCompare(String(right.content || ''));
}
