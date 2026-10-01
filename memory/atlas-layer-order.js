import { compareAtlasSourceRecords } from './atlas-source-record.js';

export const ATLAS_LAYER_CATEGORIES = ['people', 'items', 'commitments', 'events', 'world', 'perceptions'];

export function buildAtlasLayers(category, { records = [], reviews = [], manual = [], corrections = {} } = {}) {
    const layers = [];
    const batches = new Map();
    for (const record of [...records].sort(compareAtlasSourceRecords)) {
        const override = record.atlasReviewOverrides?.[category];
        const updates = override?.memoryUpdates || record.structuredSummary?.data?.memoryUpdates?.[category];
        if (!updates || (!override && !updates.created?.length && !updates.updated?.length)) continue;
        const id = override ? `review:${override.reviewBatchId || record.id}` : `record:${record.id}`;
        const layer = batches.get(id) || { id, kind: override ? 'review' : 'record', records: [], position: position(record), category };
        layer.records.push(record);
        layer.position = Math.max(layer.position, position(record));
        if (!batches.has(id)) { batches.set(id, layer); layers.push(layer); }
    }
    for (const review of reviews.filter(review => review.category === category || review.structuredSummary?.data?.memoryUpdates?.[category])) {
        layers.push({ id: `quick:${review.id}`, kind: 'quick', records: [review], position: position(review), category });
    }
    for (const entry of manual) {
        if (category === 'perceptions' && !entry.hasBaseline && !entry.facts?.length && !entry.impression) continue;
        layers.push({ id: `manual:${entry.id}`, kind: 'manual', entityId: entry.id, value: entry, position: entry.appliedThroughId || 0, category });
    }
    for (const [entityId, correction] of Object.entries(corrections)) {
        const groups = new Map();
        for (const [path, field] of Object.entries(correction.fields || {})) {
            const at = Number(field.appliedThroughId) || 0;
            if (!groups.has(at)) groups.set(at, {});
            groups.get(at)[path] = field;
        }
        for (const [at, fields] of groups) layers.push({ id: `correction:${entityId}:${at}`, kind: 'correction', entityId, fields, position: at, category });
    }
    return layers.sort(compareLayers);
}

export function resolveAtlasLayerOrder(layers, moves = []) {
    const ids = new Set(layers.map(layer => layer.id));
    const active = new Map(moves.filter(move => ids.has(move.id)).map(move => [move.id, move]));
    const result = layers.filter(layer => !active.has(layer.id));
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const visiting = new Set();
    const placed = new Set();
    const insert = id => {
        if (placed.has(id) || !active.has(id)) return;
        if (visiting.has(id)) throw new Error('도감 레이어 순서에 순환 참조가 있습니다. 기본 순서로 복원해주세요.');
        visiting.add(id);
        const move = active.get(id);
        const anchor = [move.afterId, ...(move.fallbackIds || [])].find(candidate => candidate !== id && ids.has(candidate)) || null;
        if (anchor) insert(anchor);
        const index = anchor ? result.findIndex(layer => layer.id === anchor) + 1 : 0;
        result.splice(index, 0, byId.get(id));
        visiting.delete(id);
        placed.add(id);
    };
    // Reverse traversal preserves stable order for imported moves sharing an anchor.
    [...active.keys()].reverse().forEach(insert);
    return result;
}

export function moveAtlasLayer(layers, moves, id, afterId) {
    const order = resolveAtlasLayerOrder(layers, moves);
    const index = order.findIndex(layer => layer.id === id);
    if (index < 0 || id === afterId || (afterId && !order.some(layer => layer.id === afterId))) throw new Error('이동할 레이어를 찾지 못했습니다.');
    const [layer] = order.splice(index, 1);
    order.splice(afterId ? order.findIndex(item => item.id === afterId) + 1 : 0, 0, layer);
    const edited = new Set([...moves.map(move => move.id), id]);
    return order.flatMap((item, at) => edited.has(item.id) ? [{ id: item.id, afterId: order[at - 1]?.id || null,
        fallbackIds: order.slice(0, Math.max(0, at - 1)).map(item => item.id).reverse() }] : []);
}

export function expandAtlasLayerOrder(layers, moves) {
    const units = layers.flatMap(layer => layer.records ? layer.records.map(record => ({ ...layer, records: [record], position: position(record) })) : [layer]);
    units.sort(compareLayers);
    const live = new Set(layers.map(layer => layer.id));
    const active = new Map(moves.filter(move => live.has(move.id)).map(move => [move.id, move]));
    const result = units.filter(unit => !active.has(unit.id));
    const visiting = new Set();
    const placed = new Set();
    const insert = id => {
        if (!active.has(id) || placed.has(id)) return;
        if (visiting.has(id)) throw new Error('도감 레이어 순서에 순환 참조가 있습니다.');
        visiting.add(id);
        const move = active.get(id);
        const anchor = [move.afterId, ...(move.fallbackIds || [])].find(candidate => candidate !== id && live.has(candidate)) || null;
        if (anchor) insert(anchor);
        const at = anchor ? result.map(unit => unit.id).lastIndexOf(anchor) + 1 : 0;
        result.splice(at, 0, ...units.filter(unit => unit.id === id));
        visiting.delete(id);
        placed.add(id);
    };
    [...active.keys()].reverse().forEach(insert);
    return result;
}

export function reanchorAtlasLayers(before, remaining, moves) {
    const live = new Set(remaining.map(layer => layer.id));
    return moves.filter(move => live.has(move.id)).map(move => {
        const at = before.findIndex(layer => layer.id === move.id);
        const previous = before.slice(0, Math.max(0, at)).filter(layer => live.has(layer.id)).map(layer => layer.id).reverse();
        return { id: move.id, afterId: previous[0] || null, fallbackIds: previous.slice(1) };
    });
}

function position(record) { return Number(record.atlasReview || record.category ? record.appliedThroughId ?? record.endId : record.endId ?? record.position) || 0; }
function compareLayers(a, b) {
    const priority = { record: 0, review: 0, quick: 1, manual: 2, correction: 3 };
    const delta = a.position - b.position || priority[a.kind] - priority[b.kind];
    if (delta || !a.records || !b.records) return delta;
    return compareAtlasSourceRecords({ ...a.records[0], atlasReview: a.kind === 'quick' }, { ...b.records[0], atlasReview: b.kind === 'quick' });
}
