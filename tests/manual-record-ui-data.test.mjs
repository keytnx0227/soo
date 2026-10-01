import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { atlasUpdateEditorInitial, createManualAtlasUpdate, collectManualAtlasUpdates } from '../records/manual-atlas-draft.js';
import * as placement from '../summary/record-placement.js';
import { derivePeopleAtlas } from '../memory/people-memory.js';
import { deriveItemAtlas } from '../memory/item-memory.js';
import { deriveCommitmentAtlas } from '../memory/commitment-memory.js';
import { deriveEventAtlas } from '../memory/event-memory.js';
import { deriveWorldAtlas } from '../memory/world-memory.js';
import { derivePerceptionAtlas } from '../memory/perception-memory.js';
import { applyAtlasCorrections } from '../memory/atlas-corrections.js';

test('proposal editing preserves explicit replacement and identities even when equal to projected values', async () => {
    const scope = await load('../memory/atlas-review-draft-editor.js', { createManualAtlasUpdate, structuredClone });
    const entity = { id: 'i', name: 'Key', functions: ['old'], aliases: [], facts: [] };
    const previous = { targetId: 'i', replace: { functions: ['reviewed'] }, append: { facts: ['added'] } };
    const edited = scope.mergeReviewUpdate('items', entity, previous, entity);
    assert.equal(edited.targetId, 'i');
    assert.deepEqual(edited.replace.functions, ['old']);
    assert.deepEqual(edited.append.facts, []);
    assert.deepEqual(previous.replace.functions, ['reviewed']);
});

test('review results render readable atlas fields and comparisons without changing source data', async () => {
    const scope = await load('../memory/atlas-review-view.js', {
        escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    });
    const values = [
        { id: 'p', name: 'A', role: '여행자', relationships: [{ targetName: 'B', feelings: ['신뢰'] }] },
        { id: 'i', name: '열쇠', facts: ['은으로 만들어짐'], functions: ['문 열기'] },
        { id: 'c', title: '약속', terms: '다시 만나기', conditions: [], status: 'pending' },
        { id: 'e', title: '재회', summary: '다시 만났다', importance: 'major' },
        { id: 'w', keys: ['도시'], content: '오래된 도시' },
        { id: 'ab', observerName: 'A', subjectName: 'B', facts: [{ id: 'f', text: '<script>꽃을 좋아함</script>' }], impression: null },
    ];
    for (const value of values) {
        const original = structuredClone(value);
        const html = scope.renderReviewChange({ type: 'updated', label: '변경', name: '항목', value: { before: value, after: value } });
        assert.match(html, /변경 전/);
        assert.match(html, /변경 후/);
        assert.match(html, /<details><summary>JSON 원문<\/summary><pre>/);
        assert.doesNotMatch(html, /<script>/);
        assert.deepEqual(value, original);
    }
    assert.match(scope.renderReviewValue(values[5]), /알고 있는 정보/);
    assert.match(scope.renderReviewValue(values[5]), /<li>&lt;script&gt;꽃을 좋아함/);
    assert.doesNotMatch(scope.renderReviewValue(values[5]), /<dt>id<\/dt>/);
    for (const type of ['created', 'removed']) {
        const html = scope.renderReviewChange({ type, label: type, name: 'A', value: values[0] });
        assert.match(html, /여행자/);
        assert.doesNotMatch(html, /변경 전/);
    }
});

async function load(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope);
    return scope;
}

test('review translation includes generated proposals even when final atlas is unchanged', async () => {
    const calls = [];
    const scope = await load('../memory/atlas-review-view.js', { translateAtlasReviewChanges: async changes => {
        calls.push(changes); return { content: `translation ${calls.length}` };
    } });
    const draft = { before: [], after: [], entries: [{ startId: 0, endId: 19, memoryUpdates: { updated: [{ targetId: 'ab', append: { facts: ['new proposal'] } }] } }] };
    const original = structuredClone(draft);
    const result = await scope.translateReviewDraft(draft);
    assert.equal(calls.length, 1);
    assert.equal(result.generated.content, 'translation 1');
    assert.match(calls[0].updated[0].name, /#0 ~ #19/);
    assert.equal(calls[0].updated[0].value.updated[0].append.facts[0], 'new proposal');
    draft.after = [{ id: 'ab', impression: 'new impression' }];
    await scope.translateReviewDraft(draft);
    assert.equal(calls.length, 3);
    assert.deepEqual(draft.entries, original.entries);
});

test('atlas update preserves target ID and only appends explicitly entered cumulative fields', () => {
    const person = { id: 'p1', name: 'A', role: 'traveler', aliases: ['old alias'], relationships: [{ targetId: 'p2' }] };
    const initial = atlasUpdateEditorInitial('people', person);
    assert.deepEqual(initial.aliases, []);
    assert.deepEqual(initial.relationships, []);
    assert.throws(() => createManualAtlasUpdate('people', person, initial));
    initial.role = 'guide';
    initial.aliases = ['new alias'];
    const update = createManualAtlasUpdate('people', person, initial);
    assert.deepEqual(update, { targetId: 'p1', replace: { role: 'guide' }, append: { aliases: ['new alias'] }, relationshipUpdates: [] });
    assert.equal(person.role, 'traveler');
    assert.deepEqual(atlasUpdateEditorInitial('people', person, update), initial);
});

test('atlas drafts retain explicit IDs and do not share mutable data with collected updates', () => {
    const entries = [
        { category: 'people', kind: 'created', value: { sourceId: 'new-person', name: 'A' } },
        { category: 'people', kind: 'updated', value: { targetId: 'old-person', replace: { role: 'guide' } } },
    ];
    const updates = collectManualAtlasUpdates(entries);
    assert.equal(updates.people.created[0].sourceId, 'new-person');
    assert.equal(updates.people.updated[0].targetId, 'old-person');
    updates.people.updated[0].replace.role = 'changed';
    assert.equal(entries[1].value.replace.role, 'guide');
});

test('last completed range uses individual records and ignores non-covering supplements', async () => {
    const scope = await load('../records/manual-record-settings.js', { ...placement });
    const records = [
        { startId: 0, endId: 39, coverageRanges: [{ startId: 0, endId: 39 }] },
        { startId: 0, endId: 19 }, { startId: 20, endId: 39 },
        { startId: 40, endId: 59, manual: { countsAsSummary: false } },
        { startId: null, endId: null, position: 60 },
    ];
    assert.equal(scope.getLastCompletedRecordRange(records), records[2]);
    assert.equal(scope.getLastCompletedRecordRange([]), null);
});

test('atlas preview applies drafts without writing source records or polluting the cached atlas', async () => {
    const chat = [];
    const records = [{ id: 'r1', startId: 0, endId: 19, structuredSummary: { data: { memoryUpdates: {
        people: { created: [{ sourceId: 'p1', name: 'A', role: 'traveler' }] },
    } } } }];
    const draft = { id: 'draft', startId: 20, endId: 39, structuredSummary: { data: { memoryUpdates: {
        people: { updated: [{ targetId: 'p1', replace: { role: 'guide' } }] },
    } } } };
    const snapshot = structuredClone({ records, draft });
    const scope = await load('../memory/atlas-projection-service.js', {
        structuredClone, derivePeopleAtlas, deriveItemAtlas, deriveCommitmentAtlas, deriveEventAtlas, deriveWorldAtlas, derivePerceptionAtlas, applyAtlasCorrections,
        SillyTavern: { getContext: () => ({ chat }) }, getSummaryRecords: () => records,
        filterLlmVisibleSummaryRecords: records => records,
        getAtlasReviewRecords: () => [], getManualAtlasEntries: () => [], getAtlasCorrections: () => ({}), getAtlasLayerOrders: () => ({}),
    });
    assert.equal(scope.getAtlasProjection().people[0].role, 'traveler');
    const preview = scope.getAtlasProjection({ draftRecords: [draft] });
    assert.equal(preview.people[0].role, 'guide');
    preview.people[0].role = 'mutated';
    assert.equal(scope.getAtlasProjection().people[0].role, 'traveler');
    assert.deepEqual({ records, draft }, snapshot);
});

test('rendered context retains supplement placement and never labels it as message zero', async () => {
    const scope = await load('../summary/context-block-composer.js', {
        ...placement, SUMMARY_CONTEXT_BLOCK_KINDS: { RECORDS: 'records', PEOPLE: 'people', ITEMS: 'items', EVENTS: 'events', COMMITMENTS: 'commitments', WORLD: 'world' },
    });
    const records = [
        { id: 'b', startId: 20, endId: 39, content: 'B' },
        { id: 'x', startId: null, endId: null, position: 19.5, content: 'X' },
        { id: 'a', startId: 0, endId: 19, content: 'A' },
    ];
    const blocks = scope.buildRenderedBlocks([{ kind: 'records', enabled: true, entryTemplate: '{{sumiRecordStartId}}:{{sumiRecordContent}}' }], records, {});
    const output = blocks[0].units.map(unit => unit.content).join('\n');
    assert.equal(output, '0:A\nsupplement:X\n20:B');
    assert.deepEqual(records.map(record => record.id), ['b', 'x', 'a']);
});
