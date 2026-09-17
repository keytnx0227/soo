import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function setup() {
    let sequence = 0;
    const context = { chat: [], chatMetadata: {}, saveMetadata: async () => {} };
    const records = [];
    const corrections = { people: {} };
    const scope = {
        structuredClone, Event, document: { dispatchEvent() {} },
        createId: () => `new-${++sequence}`,
        getCreatedAtlasEntityId: (category, record, proposal, index) => proposal.sourceId || `${category}-${index}`,
        getAtlasCorrections: () => corrections, getAtlasReviewRecords: () => [], getManualAtlasEntries: () => [],
        getSummaryRecords: () => records, SillyTavern: { getContext: () => context },
    };
    const source = (await readFile(new URL('../records/regeneration-review.js', import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope);
    const draft = {
        id: 'draft', recordId: 'r1', sourceChat: context.chat,
        previousRecord: { structuredSummary: { data: { memoryUpdates: { people: { created: [{ name: 'A', sourceId: 'old' }] } } } } },
        structuredSummary: { data: { memoryUpdates: { people: { created: [{ name: 'A', sourceId: 'old' }] } } } },
    };
    return { scope, draft, records, context, corrections };
}

test('queue persists isolated IDs without copying chat or matching identical names', async () => {
    const { scope, draft, context } = await setup();
    const pending = await scope.queueRegeneration(draft);
    assert.equal(pending.sourceChat, undefined);
    assert.notEqual(pending.structuredSummary.data.memoryUpdates.people.created[0].sourceId, 'old');
    assert.equal(draft.structuredSummary.data.memoryUpdates.people.created[0].sourceId, 'old');
    assert.equal(context.chatMetadata.stsmRegenerationDrafts.length, 1);
});

test('detects update, relationship, participant and correction references without unrelated missing IDs', async () => {
    const { scope, draft, records, corrections } = await setup();
    draft.structuredSummary.data.memoryUpdates = {};
    records.push({ id: 'r2', startId: 50, endId: 59, structuredSummary: { data: { memoryUpdates: {
        people: { updated: [{ targetId: 'old' }, { targetId: 'unrelated' }] },
        commitments: { created: [{ participants: [{ personId: 'old' }] }] },
    } } } });
    corrections.people.old = { fields: {} };
    const result = scope.getRegenerationReferences(draft);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'old');
    assert.ok(result[0].references.includes('#50 ~ #59'));
    assert.ok(result[0].references.includes('수동 보정'));
    records[0].structuredSummary.data.memoryUpdates = { people: { created: [{ relationships: [{ targetId: 'old' }] }] } };
    assert.equal(scope.getRegenerationReferences(draft).length, 1);
    draft.previousRecord.atlasReviewOverrides = { people: { memoryUpdates: {} } };
    assert.equal(scope.getRegenerationReferences(draft).length, 0);
});

test('manual choices preserve old IDs, rewrite internal references and reject missing or duplicate choices', async () => {
    const { scope, draft } = await setup();
    const pending = await scope.queueRegeneration(draft);
    const nextId = pending.structuredSummary.data.memoryUpdates.people.created[0].sourceId;
    pending.structuredSummary.data.memoryUpdates.people.updated = [{ targetId: nextId }];
    const requirement = { category: 'people', id: 'old', proposal: { name: 'Old A' } };
    assert.throws(() => scope.resolveRegeneration(pending, [requirement], {}));
    const resolved = scope.resolveRegeneration(pending, [requirement], { 'people:old': nextId });
    assert.equal(resolved.structuredSummary.data.memoryUpdates.people.created[0].sourceId, 'old');
    assert.equal(resolved.structuredSummary.data.memoryUpdates.people.updated[0].targetId, 'old');
    assert.equal(pending.structuredSummary.data.memoryUpdates.people.created[0].sourceId, nextId);
    assert.throws(() => scope.resolveRegeneration(pending, [requirement, { ...requirement, id: 'other' }], {
        'people:old': nextId, 'people:other': nextId,
    }));
    const kept = scope.resolveRegeneration(pending, [requirement], { 'people:old': 'keep' });
    assert.equal(kept.structuredSummary.data.memoryUpdates.people.created[1].name, 'Old A');
    const disconnected = scope.resolveRegeneration(pending, [requirement], { 'people:old': 'disconnect' });
    assert.equal(disconnected.structuredSummary.data.memoryUpdates.people.created[0].sourceId, nextId);
});

test('failed saves restore pending drafts and chat switches reject enqueue', async () => {
    const { scope, draft, context } = await setup();
    const previous = [{ id: 'existing' }];
    context.chatMetadata.stsmRegenerationDrafts = previous;
    context.saveMetadata = async () => { throw new Error('save failed'); };
    await assert.rejects(scope.queueRegeneration(draft), /save failed/);
    assert.equal(context.chatMetadata.stsmRegenerationDrafts, previous);
    context.chat = [];
    await assert.rejects(scope.queueRegeneration(draft));
});

test('projection validation allows explicit disconnects and pre-existing missing but blocks new unexpected ones', async () => {
    const { scope, draft } = await setup();
    scope.getAtlasProjection = options => ({ skippedUpdates: {
        people: options ? [{ sourceRecordId: 'r2', targetId: 'old' }, { sourceRecordId: 'r3', targetId: 'already-missing' }]
            : [{ sourceRecordId: 'r3', targetId: 'already-missing' }],
    } });
    assert.throws(() => scope.validateResolvedRegeneration(draft, [], {}));
    scope.validateResolvedRegeneration(draft, [{ category: 'people', id: 'old' }], { 'people:old': 'disconnect' });
});

test('reference signatures detect changes while review is open', async () => {
    const { scope, draft, records } = await setup();
    const before = scope.regenerationReferenceSignature(draft);
    records.push({ id: 'changed' });
    assert.notEqual(scope.regenerationReferenceSignature(draft), before);
});

test('keeping old entries includes dependencies on other old people', async () => {
    const { scope, draft, records } = await setup();
    draft.previousRecord.structuredSummary.data.memoryUpdates.people.created = [
        { name: 'A', sourceId: 'old', relationships: [{ targetId: 'old-b' }] },
        { name: 'B', sourceId: 'old-b' },
    ];
    records.push({ id: 'r2', structuredSummary: { data: { memoryUpdates: { people: { updated: [{ targetId: 'old' }] } } } } });
    const requirements = scope.getRegenerationReferences(draft);
    assert.equal(requirements.length, 2);
    assert.ok(requirements.some(item => item.id === 'old-b'));
});
