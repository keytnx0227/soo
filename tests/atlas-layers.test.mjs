import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as order from '../memory/atlas-layer-order.js';
import { captureAtlasAnchors } from '../memory/atlas-anchor-transaction.js';
import * as adapter from '../memory/atlas-layer-projection.js';
import { derivePeopleAtlas } from '../memory/people-memory.js';
import { deriveItemAtlas } from '../memory/item-memory.js';
import { deriveCommitmentAtlas } from '../memory/commitment-memory.js';
import { deriveEventAtlas } from '../memory/event-memory.js';
import { deriveWorldAtlas } from '../memory/world-memory.js';
import { derivePerceptionAtlas } from '../memory/perception-memory.js';
import { applyAtlasCorrections } from '../memory/atlas-corrections.js';

async function load(name, scope) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    const exports = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(match => match[1]);
    return new Function(...Object.keys(scope), source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '') + `\nreturn {${exports.join(',')}};`)(...Object.values(scope));
}

const rec = (id, startId, endId, category, updates) => ({ id, type: 'summary', startId, endId,
    structuredSummary: { data: { memoryUpdates: { [category]: updates } } } });
const update = text => ({ created: [], updated: [{ targetId: 'ab', append: { facts: [text] } }] });
const slot = { id: 'ab', observerId: 'a', subjectId: 'b', allowAutoUpdate: true, appliedThroughId: 99, hasBaseline: true, facts: [], impression: null };

test('anchor capture does no record work without custom order', () => {
    const root = {};
    const transaction = captureAtlasAnchors(root, () => { throw new Error('must not read'); });
    transaction.apply();
    transaction.rollback();
    assert.deepEqual(root, {});
});

for (const kind of ['review', 'manual', 'correction']) {
    test(`external ${kind} deletion uses current predecessors and rolls back failed saves`, async () => {
        const anchor = kind === 'review' ? 'quick:q' : kind === 'manual' ? 'manual:ab' : 'correction:ab:29';
        const h = await harness({
            records: [rec('a', 0, 9, 'perceptions', update('a')), rec('n', 10, 19, 'perceptions', update('n'))],
            slots: [{ ...slot, appliedThroughId: 29 }],
            reviews: [{ id: 'q', category: 'perceptions', startId: 20, endId: 29, appliedThroughId: 29, memoryUpdates: update('q') },
                { id: 'x', category: 'perceptions', startId: 0, endId: 0, appliedThroughId: 0, memoryUpdates: update('x') }],
            corrections: { perceptions: { ab: { fields: { impression: { value: 'thought', appliedThroughId: 29 } } } } },
            orders: { perceptions: [{ id: 'quick:x', afterId: anchor, fallbackIds: ['record:a'] }] },
        });
        const remove = () => kind === 'review' ? h.deleteAtlasReviewRecord('q')
            : kind === 'manual' ? h.deleteManualAtlasEntry('perceptions', 'ab') : h.clearAtlasEntityCorrection('perceptions', 'ab');
        const before = h.getAtlasLayerSnapshot('perceptions').ordered;
        const original = structuredClone(h.context.chatMetadata);
        h.setFail(true);
        await assert.rejects(remove(), /save failed/);
        assert.deepEqual(h.context.chatMetadata, original);
        h.setFail(false);
        await remove();
        const snapshot = h.getAtlasLayerSnapshot('perceptions');
        const live = new Set(snapshot.layers.map(layer => layer.id));
        const at = before.findIndex(layer => layer.id === 'quick:x');
        const predecessor = before.slice(0, at).filter(layer => live.has(layer.id)).at(-1)?.id || null;
        assert.equal(snapshot.moves.find(move => move.id === 'quick:x').afterId, predecessor);
        assert.notEqual(predecessor, 'record:a');
    });
}

async function harness({ records = [], reviews = [], slots = [slot], corrections = {}, orders = {} } = {}) {
    let fail = false;
    const context = { chat: [], chatMetadata: { sumi_chat_summarizer: { records, atlas: { reviews, layerOrders: orders, corrections,
        manual: { perceptions: slots, people: [{ id: 'a', name: 'A', appliedThroughId: 0, allowAutoUpdate: true }, { id: 'b', name: 'B', appliedThroughId: 0, allowAutoUpdate: true }] } } } },
        saveMetadata: async () => { if (fail) throw new Error('save failed'); } };
    let counter = 0;
    let operation = null;
    const scope = { ...order, ...adapter, structuredClone, derivePeopleAtlas, deriveItemAtlas, deriveCommitmentAtlas, deriveEventAtlas, deriveWorldAtlas, derivePerceptionAtlas, applyAtlasCorrections,
        captureAtlasAnchors, createId: () => `new-${++counter}`, SillyTavern: { getContext: () => context }, window: { dispatchEvent() {} }, CustomEvent: class {},
        getSummaryRecords: () => structuredClone(context.chatMetadata.sumi_chat_summarizer.records), filterLlmVisibleSummaryRecords: records => records.filter(record => !record.llmHidden),
        getExtensionState: () => ({ operation }), beginOperation: () => { operation = {}; return operation; }, endOperation: () => { operation = null; },
    };
    Object.assign(scope, await load('memory/atlas-metadata.js', scope));
    Object.assign(scope, await load('memory/atlas-projection-service.js', scope));
    Object.assign(scope, await load('memory/atlas-layer-service.js', scope));
    return { ...scope, context, setFail: value => { fail = value; } };
}

test('moving an empty perception baseline before quick review makes the review visible; reset restores legacy behavior', async () => {
    const h = await harness({ records: [rec('r', 0, 99, 'perceptions', update('Original'))],
        reviews: [{ id: 'q', category: 'perceptions', startId: 0, endId: 99, appliedThroughId: 99, memoryUpdates: update('Reviewed') }] });
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts, []);
    const snap = h.getAtlasLayerSnapshot('perceptions');
    await h.moveAtlasLayerAfter(snap, 'quick:q', 'manual:ab');
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts.map(fact => fact.text), ['Reviewed']);
    assert.equal(h.getAtlasProjection().perceptions[0].lastUpdatedRange.endId, 99);
    assert.equal(h.getAtlasProjection().frontierId, 99);
    await h.resetAtlasLayerOrder(h.getAtlasLayerSnapshot('perceptions'));
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts, []);
    await h.removeAtlasLayer(h.getAtlasLayerSnapshot('perceptions'), 'manual:ab');
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts.map(fact => fact.text), ['Original', 'Reviewed']);
    assert.equal(h.getManualAtlasEntries('perceptions')[0].id, 'ab');
});

test('review batches replace originals once, retain member order, delete atomically and restore originals', async () => {
    const records = [rec('r1', 0, 9, 'perceptions', update('original one')), rec('r2', 10, 19, 'perceptions', update('original two'))];
    records.forEach((record, index) => { record.atlasReviewOverrides = { perceptions: { reviewBatchId: 'batch', memoryUpdates: update(`review ${index}`) } }; });
    const h = await harness({ records, slots: [{ ...slot, hasBaseline: false, appliedThroughId: 0 }] });
    const snap = h.getAtlasLayerSnapshot('perceptions');
    assert.equal(snap.layers.length, 1);
    assert.equal(snap.layers[0].records.length, 2);
    await h.moveAtlasLayerAfter(snap, 'review:batch', null);
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts.map(fact => fact.text), ['review 0', 'review 1']);
    const before = JSON.stringify(h.context.chatMetadata);
    h.setFail(true);
    await assert.rejects(h.removeAtlasLayer(h.getAtlasLayerSnapshot('perceptions'), 'review:batch'), /save failed/);
    assert.equal(JSON.stringify(h.context.chatMetadata), before);
    h.setFail(false);
    await h.removeAtlasLayer(h.getAtlasLayerSnapshot('perceptions'), 'review:batch');
    assert.deepEqual(h.getAtlasProjection().perceptions[0].facts.map(fact => fact.text), ['original one', 'original two']);
    assert.ok(h.getSummaryRecords().every(record => !record.atlasReviewOverrides.perceptions));
});

test('correction positions govern replacement and cumulative fields while locks still win and other categories stay unchanged', async () => {
    const records = [rec('create', 0, 9, 'items', { created: [{ sourceId: 'item', name: 'Key', facts: ['old'], functions: ['old function'] }], updated: [] }),
        rec('update', 10, 19, 'items', { created: [], updated: [{ targetId: 'item', append: { facts: ['new'] }, replace: { functions: ['new function'] } }] })];
    const h = await harness({ records, corrections: { items: { item: { fields: { facts: { value: [], locked: false, appliedThroughId: 19 }, functions: { value: ['manual'], locked: false, appliedThroughId: 19 } } } } } });
    const peopleBefore = h.getAtlasProjection().people;
    assert.deepEqual(h.getAtlasProjection().items[0].facts, []);
    await h.moveAtlasLayerAfter(h.getAtlasLayerSnapshot('items'), 'correction:item:19', 'record:create');
    assert.deepEqual(h.getAtlasProjection().items[0].facts, ['new']);
    assert.deepEqual(h.getAtlasProjection().items[0].functions, ['new function']);
    assert.deepEqual(h.getAtlasProjection().people, peopleBefore);
    assert.equal(h.getAtlasProjection().items[0].lastUpdatedRange.endId, 19);
    await h.setAtlasLayerLocked(h.getAtlasLayerSnapshot('items'), 'correction:item:19', true);
    assert.deepEqual(h.getAtlasProjection().items[0].functions, ['manual']);
    await h.removeAtlasLayer(h.getAtlasLayerSnapshot('items'), 'correction:item:19');
    assert.deepEqual(h.getAtlasProjection().items[0].facts, ['old', 'new']);
});

test('anchor deletion uses the closest preceding survivor and insertion does not pin moved layers to the future tail', () => {
    const nodes = ['a', 'b', 'x', 'c'].map(id => ({ id }));
    let moves = order.moveAtlasLayer(nodes, [], 'x', 'b');
    const remaining = nodes.filter(node => node.id !== 'b');
    moves = order.reanchorAtlasLayers(nodes, remaining, moves);
    assert.equal(moves[0].afterId, 'a');
    assert.deepEqual(order.resolveAtlasLayerOrder([...remaining, { id: 'new' }], moves).map(node => node.id), ['a', 'x', 'c', 'new']);
    const noneBefore = remaining.filter(node => node.id !== 'a');
    moves = order.reanchorAtlasLayers(remaining, noneBefore, moves);
    assert.equal(moves[0].afterId, null);
    assert.deepEqual(order.resolveAtlasLayerOrder(noneBefore, moves).map(node => node.id), ['x', 'c']);
});

test('repeated moves can move anchors across dependents without creating cycles', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id }));
    let moves = order.moveAtlasLayer(nodes, [], 'c', 'a');
    moves = order.moveAtlasLayer(nodes, moves, 'a', 'd');
    assert.deepEqual(order.resolveAtlasLayerOrder(nodes, moves).map(node => node.id), ['c', 'b', 'd', 'a']);
    moves = order.moveAtlasLayer(nodes, moves, 'd', null);
    assert.deepEqual(order.resolveAtlasLayerOrder(nodes, moves).map(node => node.id), ['d', 'c', 'b', 'a']);
});

test('save failures, stale snapshots and chat switches cannot apply layer edits', async () => {
    const h = await harness({ records: [rec('r', 0, 99, 'perceptions', update('old'))] });
    h.setFail(true);
    const snap = h.getAtlasLayerSnapshot('perceptions');
    await assert.rejects(h.moveAtlasLayerAfter(snap, 'record:r', 'manual:ab'), /save failed/);
    assert.deepEqual(h.getAtlasLayerOrders(), {});
    h.setFail(false);
    h.context.chatMetadata.sumi_chat_summarizer.records[0].endId = 100;
    await assert.rejects(h.removeAtlasLayer(snap, 'manual:ab'), /변경/);
    const next = h.getAtlasLayerSnapshot('perceptions');
    h.context.chat = [];
    await assert.rejects(h.removeAtlasLayer(next, 'manual:ab'), /채팅/);
});

test('saved order survives reload without rewriting record IDs, source ranges or original payloads', async () => {
    const records = [rec('r', 0, 99, 'perceptions', update('record'))];
    const h = await harness({ records });
    await h.moveAtlasLayerAfter(h.getAtlasLayerSnapshot('perceptions'), 'record:r', 'manual:ab');
    const reload = await harness({ records: h.getSummaryRecords(), orders: h.getAtlasLayerOrders(), slots: h.getManualAtlasEntries('perceptions') });
    assert.deepEqual(reload.getAtlasProjection().perceptions, h.getAtlasProjection().perceptions);
    assert.deepEqual(h.getSummaryRecords(), records);
    const historical = h.getAtlasProjection({ beforeStartId: 50 });
    assert.equal(historical.perceptions[0].facts.length, 0);
    assert.deepEqual(h.getAtlasProjection({ includeCorrections: false }).perceptions[0].firstSeenRange, { startId: 0, endId: 99 });
});

test('people, commitments, events and world use the same positional correction rules', async () => {
    for (const [category, field, proposal] of [
        ['people', 'role', { name: 'Person', role: 'old' }],
        ['commitments', 'terms', { title: 'Promise', terms: 'old', status: 'active' }],
        ['events', 'summary', { title: 'Event', summary: 'old', importance: 'minor' }],
        ['world', 'content', { keys: ['Place'], content: 'old' }],
    ]) {
        const id = `entity-${category}`;
        const h = await harness({ records: [rec('create', 0, 9, category, { created: [{ ...proposal, sourceId: id }], updated: [] }),
            rec('later', 10, 19, category, { created: [], updated: [{ targetId: id, replace: { [field]: 'new' } }] })],
            corrections: { [category]: { [id]: { fields: { [field]: { value: 'manual', appliedThroughId: 19, locked: false } } } } } });
        assert.equal(h.getAtlasProjection()[category].find(entity => entity.id === id)[field], 'manual');
        await h.moveAtlasLayerAfter(h.getAtlasLayerSnapshot(category), `correction:${id}:19`, 'record:create');
        assert.equal(h.getAtlasProjection()[category].find(entity => entity.id === id)[field], 'new');
        assert.equal(h.getAtlasProjection()[category].find(entity => entity.id === id).firstSeenRange.startId, 0);
    }
});

test('untouched review members keep original temporal positions when another layer moves', () => {
    const r1 = rec('r1', 0, 9, 'perceptions', update('one'));
    const r2 = rec('r2', 20, 29, 'perceptions', update('two'));
    r1.atlasReviewOverrides = r2.atlasReviewOverrides = { perceptions: { reviewBatchId: 'batch', memoryUpdates: update('reviewed') } };
    const layers = order.buildAtlasLayers('perceptions', { records: [r1, r2], manual: [{ ...slot, appliedThroughId: 19 }],
        reviews: [{ id: 'q', category: 'perceptions', startId: 30, endId: 39, appliedThroughId: 39, memoryUpdates: update('quick') }] });
    const expanded = order.expandAtlasLayerOrder(layers, [{ id: 'quick:q', afterId: 'review:batch', fallbackIds: [] }]);
    assert.deepEqual(expanded.map(layer => layer.records?.[0].id || layer.entityId), ['r1', 'ab', 'r2', 'q']);
});
