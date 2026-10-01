import { buildAtlasLayers, expandAtlasLayerOrder } from './atlas-layer-order.js';
import { derivePeopleAtlas } from './people-memory.js';
import { deriveItemAtlas } from './item-memory.js';
import { deriveCommitmentAtlas } from './commitment-memory.js';
import { deriveEventAtlas } from './event-memory.js';
import { deriveWorldAtlas } from './world-memory.js';
import { derivePerceptionAtlas } from './perception-memory.js';

const DERIVE = { people: derivePeopleAtlas, items: deriveItemAtlas, commitments: deriveCommitmentAtlas, events: deriveEventAtlas, world: deriveWorldAtlas };

// Only an explicitly reordered category uses virtual positions. Stored records and IDs stay intact.
export function projectAtlasLayerCategory(category, { records, reviews, manual, corrections, moves, people, beforeStartId = null }) {
    const entries = manual.map(entry => category === 'perceptions' && beforeStartId !== null && entry.appliedThroughId >= beforeStartId
        ? { ...entry, hasBaseline: false, facts: [], impression: null } : entry);
    const layers = expandAtlasLayerOrder(buildAtlasLayers(category, { records, reviews, manual: entries, corrections }), moves);
    const ranges = {};
    const orderedRecords = [];
    const baselines = new Map();
    const adjustedCorrections = structuredClone(corrections);
    let rank = 0;
    for (const layer of layers) {
        if (layer.records) {
            for (const record of layer.records) {
                rank++;
                ranges[rank] = { startId: record.startId ?? null, endId: record.endId ?? null };
                orderedRecords.push({ ...record, startId: rank, endId: rank, appliedThroughId: rank });
            }
        } else {
            rank++;
            ranges[rank] = { startId: layer.position, endId: layer.position };
            if (layer.kind === 'manual') baselines.set(layer.entityId, rank);
            if (layer.kind === 'correction') {
                for (const path of Object.keys(layer.fields)) adjustedCorrections[layer.entityId].fields[path].appliedThroughId = rank;
            }
        }
    }
    const adjustedManual = entries.map(entry => ({ ...entry, appliedThroughId: baselines.get(entry.id) ?? -1 }));
    if (category === 'perceptions') {
        const result = derivePerceptionAtlas(orderedRecords, adjustedManual, people);
        return { entities: result.perceptions, skipped: result.skippedUpdates, corrections: adjustedCorrections, ranges };
    }
    const manualRecords = adjustedManual.map(entry => ({ id: `manual-source:${category}:${entry.id}`,
        startId: entry.appliedThroughId, endId: entry.appliedThroughId, manualSource: true,
        structuredSummary: { data: { memoryUpdates: { [category]: { created: [{ ...entry, sourceId: entry.id }], updated: [] } } } },
    }));
    const filtered = orderedRecords.map(record => {
        const updates = record.structuredSummary?.data?.memoryUpdates?.[category];
        if (!updates) return record;
        return { ...record, structuredSummary: { data: { memoryUpdates: { [category]: { ...updates,
            updated: (updates.updated || []).filter(update => !baselines.has(update.targetId) || record.endId > baselines.get(update.targetId)),
        } } } } };
    });
    const derive = DERIVE[category];
    const result = derive([...manualRecords, ...filtered]);
    const manualOnly = new Map(derive(manualRecords)[category].map(entity => [entity.id, entity]));
    const metadata = new Map(entries.map(entry => [entry.id, entry]));
    const entities = result[category].map(entity => {
        const entry = metadata.get(entity.id);
        return entry ? { ...(entry.allowAutoUpdate ? entity : manualOnly.get(entity.id)), manual: true,
            allowAutoUpdate: entry.allowAutoUpdate, createdAt: entry.createdAt, updatedAt: entry.updatedAt } : entity;
    });
    return { entities, skipped: result.skippedUpdates, corrections: adjustedCorrections, ranges };
}

export function restoreAtlasLayerRanges(value, ranges) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => restoreAtlasLayerRanges(item, ranges));
    const output = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreAtlasLayerRanges(item, ranges)]));
    if (Object.hasOwn(value, 'startId') && Object.hasOwn(value, 'endId') && ranges[value.endId]) {
        output.startId = ranges[value.startId]?.startId ?? ranges[value.endId].startId;
        output.endId = ranges[value.endId].endId;
    }
    if (Object.hasOwn(value, 'appliedThroughId') && ranges[value.appliedThroughId]) output.appliedThroughId = ranges[value.appliedThroughId].endId;
    return output;
}
