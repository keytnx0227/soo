import { filterLlmVisibleSummaryRecords, getSummaryRecords } from '../summary/summary-store.js';
import { getAtlasCorrections, getAtlasReviewRecords, getManualAtlasEntries } from './atlas-metadata.js';
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

export function getLlmVisibleAtlasProjection(options = {}) {
    const atlas = getAtlasProjection(options);
    for (const category of ['people', 'items', 'commitments', 'events', 'world']) {
        atlas[category] = atlas[category].filter(entity => !entity.llmHidden);
    }
    return atlas;
}

function prepareSummarySourceRecords(records, draftOverrides = [], excludeRecordCategory = null) {
    const drafts = new Map(draftOverrides.map(entry => [`${entry.recordId}:${entry.category}`, entry.memoryUpdates]));
    return filterLlmVisibleSummaryRecords(records).map(record => {
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
    const manualEntries = Object.fromEntries(
        ['people', 'items', 'commitments', 'events', 'world']
            .map(category => [category, getManualAtlasEntries(category)]),
    );
    const manualRecords = Object.entries(manualEntries)
        .flatMap(([category, entries]) => entries.map(entry => toManualAtlasSourceRecord(category, entry)));
    const automaticRecords = filterUpdatesBeforeManualBaseline(
        [...summaryRecords, ...reviewRecords],
        manualEntries,
    );
    const records = [...manualRecords, ...automaticRecords];
    const manualOnly = {
        people: derivePeopleAtlas(manualRecords).people,
        items: deriveItemAtlas(manualRecords).items,
        commitments: deriveCommitmentAtlas(manualRecords).commitments,
        events: deriveEventAtlas(manualRecords).events,
        world: deriveWorldAtlas(manualRecords).world,
    };
    const people = derivePeopleAtlas(records);
    const items = deriveItemAtlas(records);
    const commitments = deriveCommitmentAtlas(records);
    const events = deriveEventAtlas(records);
    const world = deriveWorldAtlas(records);
    return {
        people: applyManualAtlasPolicy(people.people, manualOnly.people, manualEntries.people),
        items: applyManualAtlasPolicy(items.items, manualOnly.items, manualEntries.items),
        commitments: applyManualAtlasPolicy(commitments.commitments, manualOnly.commitments, manualEntries.commitments),
        events: applyManualAtlasPolicy(events.events, manualOnly.events, manualEntries.events),
        world: applyManualAtlasPolicy(world.world, manualOnly.world, manualEntries.world),
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

function toManualAtlasSourceRecord(category, entry) {
    const proposal = structuredClone(entry);
    proposal.sourceId = entry.id;
    return {
        id: `manual-source:${category}:${entry.id}`,
        startId: entry.appliedThroughId,
        endId: entry.appliedThroughId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        manualSource: true,
        structuredSummary: {
            data: {
                memoryUpdates: {
                    [category]: { created: [proposal], updated: [] },
                },
            },
        },
    };
}

function filterUpdatesBeforeManualBaseline(records, manualEntries) {
    const baselineByCategory = Object.fromEntries(Object.entries(manualEntries).map(([category, entries]) => [
        category,
        new Map(entries.map(entry => [String(entry.id), Number(entry.appliedThroughId) || 0])),
    ]));
    return records.map(record => {
        const memoryUpdates = record.structuredSummary?.data?.memoryUpdates;
        if (!memoryUpdates) return record;
        const effectiveId = Number(record.atlasReview ? record.appliedThroughId : record.endId) || 0;
        let changed = false;
        const nextUpdates = { ...memoryUpdates };
        for (const [category, baselines] of Object.entries(baselineByCategory)) {
            const categoryUpdates = memoryUpdates[category];
            if (!categoryUpdates || !Array.isArray(categoryUpdates.updated)) continue;
            const updated = categoryUpdates.updated.filter(update => {
                const baseline = baselines.get(String(update?.targetId));
                return baseline === undefined || effectiveId > baseline;
            });
            if (updated.length === categoryUpdates.updated.length) continue;
            changed = true;
            nextUpdates[category] = { ...categoryUpdates, updated };
        }
        if (!changed) return record;
        return {
            ...record,
            structuredSummary: {
                ...record.structuredSummary,
                data: {
                    ...record.structuredSummary.data,
                    memoryUpdates: nextUpdates,
                },
            },
        };
    });
}

function applyManualAtlasPolicy(derivedEntries, manualBaselineEntries, manualEntries) {
    const metadataById = new Map(manualEntries.map(entry => [String(entry.id), entry]));
    const baselineById = new Map(manualBaselineEntries.map(entry => [String(entry.id), entry]));
    return derivedEntries.map(entry => {
        const metadata = metadataById.get(String(entry.id));
        if (!metadata) return entry;
        const selected = metadata.allowAutoUpdate ? entry : baselineById.get(String(entry.id)) || entry;
        return {
            ...structuredClone(selected),
            manual: true,
            allowAutoUpdate: Boolean(metadata.allowAutoUpdate),
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
        };
    });
}
