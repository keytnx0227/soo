import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAuthorPrompt, parseAuthorDraft, authorEntries } from '../records/manual-author-engine.js';

test('author prompt reuses the preset and separates latest request, history, material and draft', () => {
    const input = { mode: 'write', basePrompt: 'MY CUSTOM PRESET', draft: { plot: ['existing'] }, history: [{ role: 'user', text: 'earlier request', mode: 'consult' }], request: 'LATEST_UNIQUE', material: 'PASTED_UNIQUE' };
    const prompt = composeAuthorPrompt(input);
    assert.ok(prompt.startsWith('MY CUSTOM PRESET'));
    assert.equal(prompt.split('LATEST_UNIQUE').length, 2);
    assert.equal(prompt.split('PASTED_UNIQUE').length, 2);
    assert.ok(prompt.indexOf('<chatSessionLog>') < prompt.indexOf('<latestUserRequest>'));
    assert.match(prompt, /Current response mode: DRAFT WRITING/);
    assert.match(prompt, /sourceId/);
    assert.match(composeAuthorPrompt({ ...input, mode: 'consult' }), /JSON-only instructions do not apply/);
    assert.match(composeAuthorPrompt({ ...input, mode: 'consult' }), /Current response mode: CONSULTATION/);
});

test('draft parsing preserves known IDs and assigns new IDs without mutating current draft', () => {
    const previous = { plot: ['old'], memoryUpdates: { people: { created: [{ sourceId: 'retained', name: 'A' }] } } };
    const input = { plot: ['new'], memoryUpdates: { people: { created: [{ sourceId: 'retained', name: 'A' }, { name: 'B', sourceId: null }] } } };
    const draft = parseAuthorDraft(JSON.stringify(input), previous, {}, () => 'new-id');
    assert.deepEqual(draft.memoryUpdates.people.created.map(entry => entry.sourceId), ['retained', 'new-id']);
    assert.equal(previous.plot[0], 'old');
    const entries = authorEntries(draft);
    entries[0].value.name = 'modified';
    assert.equal(draft.memoryUpdates.people.created[0].name, 'A');
});

test('invalid responses and unknown atlas targets cannot become a draft', () => {
    assert.throws(() => parseAuthorDraft('not json', {}, {}, () => 'id'));
    assert.throws(() => parseAuthorDraft('{}', {}, {}, () => 'id'));
    assert.throws(() => parseAuthorDraft(JSON.stringify({ plot: ['x'], memoryUpdates: { people: { created: [{ sourceId: 'invented', name: 'A' }] } } }), {}, {}, () => 'id'));
    assert.throws(() => parseAuthorDraft(JSON.stringify({ plot: ['x'], memoryUpdates: { people: { updated: [{ targetId: 'missing', replace: { role: 'x' } }] } } }), {}, {}, () => 'id'));
    const valid = parseAuthorDraft(JSON.stringify({ plot: ['x'], memoryUpdates: { people: { updated: [{ targetId: 'known', replace: { role: 'x' } }] } } }), {}, { people: [{ id: 'known' }] }, () => 'id');
    assert.equal(valid.memoryUpdates.people.updated[0].targetId, 'known');
});
