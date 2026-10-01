import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as format from '../summary/summary-format.js';
import * as templates from '../summary/summary-record-template.js';
import * as compression from '../summary/compression-format.js';
import { compareRecordPosition } from '../summary/record-placement.js';
import { composeAtomicContext } from '../summary/context-block-trimmer.js';
import { derivePerceptionAtlas } from '../memory/perception-memory.js';
import { derivePeopleAtlas } from '../memory/people-memory.js';
import { deriveItemAtlas } from '../memory/item-memory.js';
import { deriveCommitmentAtlas } from '../memory/commitment-memory.js';
import { deriveEventAtlas } from '../memory/event-memory.js';
import { deriveWorldAtlas } from '../memory/world-memory.js';
import { applyAtlasCorrections } from '../memory/atlas-corrections.js';

async function load(path, scope = {}) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope);
    return scope;
}
const people = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const slot = { id: 'ab', observerId: 'a', subjectId: 'b', facts: [], impression: null, appliedThroughId: 100, allowAutoUpdate: true };
const record = (id, endId, updates, extra = {}) => ({ id, startId: endId - 9, endId, ...extra,
    structuredSummary: { data: { memoryUpdates: { perceptions: { created: [], updated: updates } } } } });
const append = (text, targetId = 'ab') => ({ targetId, append: { facts: [text] } });

test('manual reviews bypass auto-update opt-out while ordinary extraction remains blocked', async () => {
    const disabled = { ...slot, allowAutoUpdate: false };
    const ordinary = record('ordinary', 19, [append('automatic')]);
    const quick = record('quick', 29, [append('quick review')], { atlasReview: true, appliedThroughId: 29 });
    const reviewed = record('reviewed', 39, [append('record review')], { perceptionReview: true });
    assert.deepEqual(derivePerceptionAtlas([ordinary, quick, reviewed], [disabled], people).perceptions[0].facts.map(f => f.text), ['quick review', 'record review']);
    const scope = await projectionHarness({ slots: [disabled], records: [ordinary] });
    await load('../memory/perception-memory-service.js', scope);
    assert.equal(scope.buildPerceptionMemoryPromptContext(), '');
    assert.equal(JSON.parse(scope.buildPerceptionMemoryPromptContext({ manualAtlasReview: true }))[0].id, 'ab');
    assert.equal(scope.buildPerceptionMemoryPromptContext({ manualAtlasReview: true, perceptionIds: ['other'] }), '');
});

test('registered direction only; original long-term records retain knowledge and immutable fact IDs', () => {
    const records = [record('r1', 19, [append('B said they studied abroad.')], { compressedBy: 'parent' }),
        record('r2', 39, [append('B said they studied abroad.'), append('unknown', 'ba')])];
    const before = structuredClone(records);
    const first = derivePerceptionAtlas(records, [slot], people);
    assert.equal(first.perceptions.length, 1);
    assert.equal(first.perceptions[0].facts.length, 1);
    assert.equal(first.skippedUpdates.length, 1);
    assert.equal(first.skippedUpdates[0].targetId, 'ba');
    assert.deepEqual(records, before);
    assert.deepEqual(derivePerceptionAtlas(records, [slot], people), first);
});

test('correction changes an exact fact, preserves others and does not update reverse direction', () => {
    const first = record('r1', 19, [append('B studied abroad.'), append('B has dimples.')]);
    const id = derivePerceptionAtlas([first], [slot], people).perceptions[0].facts[0].id;
    const later = record('r2', 39, [{ targetId: 'ab', factUpdates: [{ targetId: id, text: 'B attended a distant local school.' }], replace: { impression: 'An entertaining person.' } }]);
    const result = derivePerceptionAtlas([later, first], [slot, { ...slot, id: 'ba', observerId: 'b', subjectId: 'a' }], people);
    assert.deepEqual(result.perceptions[0].facts.map(fact => fact.text), ['B attended a distant local school.', 'B has dimples.']);
    assert.equal(result.perceptions[0].facts[0].id, id);
    assert.equal(result.perceptions[0].impression, 'An entertaining person.');
    assert.equal(result.perceptions[1].facts.length, 0);
    const missing = derivePerceptionAtlas([later], [slot], people);
    assert.equal(missing.skippedUpdates[0].factId, id);
});

test('manual baseline can clear content without replaying old data; historical projections omit future edits', () => {
    const records = [record('r1', 19, [append('Old belief')]), record('r2', 119, [append('New knowledge')])];
    const baseline = { ...slot, hasBaseline: true };
    assert.deepEqual(derivePerceptionAtlas(records, [baseline], people).perceptions[0].facts.map(fact => fact.text), ['New knowledge']);
    const historical = derivePerceptionAtlas([records[0]], [{ ...baseline, facts: [{ id: 'manual', text: 'Future edit' }] }], people, { beforeStartId: 30 });
    assert.deepEqual(historical.perceptions[0].facts.map(fact => fact.text), ['Old belief']);
    assert.equal(derivePerceptionAtlas(records, [{ ...baseline, allowAutoUpdate: false }], people).perceptions[0].facts.length, 0);
});

test('JSON contract and parser reject invented slots and preserve partial perception updates', () => {
    const json = format.buildAtlasReviewJsonContract('perceptions');
    assert.match(json, /created must always be \[\]/);
    assert.ok(!json.includes('"people"'));
    assert.throws(() => format.parseAtlasReviewResponse(JSON.stringify({ memoryUpdates: { perceptions: { created: [{ observerId: 'a', subjectId: 'b' }] } } }), 'perceptions'));
    const data = format.normalizeStructuredSummaryData({ plot: ['Beat'], memoryUpdates: { perceptions: { updated: [append('Belief')] } } });
    assert.deepEqual(data.memoryUpdates.perceptions.updated[0].replace, {});
    assert.equal(data.memoryUpdates.perceptions.updated[0].append.facts[0], 'Belief');
    assert.throws(() => format.normalizePerceptionUpdates({ updated: [{ targetId: 'ab', factUpdates: [{ text: 'No ID' }] }] }));
});

async function projectionHarness({ slots = [slot], corrections = {}, records = [], reviews = [] } = {}) {
    const chat = [];
    return await load('../memory/atlas-projection-service.js', {
        structuredClone, derivePeopleAtlas, deriveItemAtlas, deriveCommitmentAtlas, deriveEventAtlas, deriveWorldAtlas, derivePerceptionAtlas, applyAtlasCorrections,
        SillyTavern: { getContext: () => ({ chat }) }, getSummaryRecords: () => records,
        filterLlmVisibleSummaryRecords: records => records.filter(record => !record.llmHidden),
        getAtlasReviewRecords: () => reviews, getManualAtlasEntries: category => category === 'perceptions' ? slots : category === 'people' ? people.map(person => ({ ...person, appliedThroughId: 0 })) : [],
        getAtlasCorrections: () => corrections, getAtlasLayerOrders: () => ({}),
    });
}

test('projection replays review overrides, supports drafts, preserves cache and honors endpoint visibility', async () => {
    const records = [record('r1', 19, [append('Old')], { atlasReviewOverrides: { perceptions: { memoryUpdates: { created: [], updated: [append('Reviewed')] } } } })];
    const corrections = {};
    const scope = await projectionHarness({ records, corrections });
    assert.equal(scope.getAtlasProjection().perceptions[0].facts[0].text, 'Reviewed');
    const draft = scope.getAtlasProjection({ draftRecordOverrides: [{ recordId: 'r1', category: 'perceptions', memoryUpdates: { created: [], updated: [append('Draft')] } }] });
    assert.equal(draft.perceptions[0].facts[0].text, 'Draft');
    assert.equal(scope.getAtlasProjection().perceptions[0].facts[0].text, 'Reviewed');
    corrections.people = { a: { fields: { name: { value: 'Renamed A', locked: true } } } };
    scope.invalidateAtlasProjection();
    assert.equal(scope.getLlmVisibleAtlasProjection().perceptions[0].observerName, 'Renamed A');
    corrections.people.a.llmHidden = true;
    scope.invalidateAtlasProjection();
    assert.equal(scope.getLlmVisibleAtlasProjection().perceptions.length, 0);
    corrections.people.a = { excluded: true };
    scope.invalidateAtlasProjection();
    assert.equal(scope.getAtlasProjection().perceptions[0].unresolved, true);
    assert.equal(scope.getLlmVisibleAtlasProjection().perceptions.length, 0);
});

test('perception prompts keep registered identities but no future facts at a cutoff', async () => {
    const scope = await projectionHarness({ slots: [{ ...slot, hasBaseline: true, facts: [{ id: 'future', text: 'Future manual belief' }] }],
        records: [record('r1', 19, [append('Earlier belief')]), record('r2', 119, [append('Later belief')])] });
    const service = await load('../memory/perception-memory-service.js', scope);
    const prompt = JSON.parse(service.buildPerceptionMemoryPromptContext({ beforeStartId: 30 }));
    assert.deepEqual(prompt[0].facts.map(fact => fact.text), ['Earlier belief']);
    assert.equal(prompt[0].observer, 'A');
    assert.equal(service.buildPerceptionMemoryPromptContext({ perceptionIds: ['other'] }), '');
});

test('metadata persists slots and facts, rejects duplicates and rolls back a failed save', async () => {
    let fail = false;
    let count = 0;
    const context = { chatMetadata: {}, saveMetadata: async () => { if (fail) throw new Error('save failed'); } };
    const scope = await load('../memory/atlas-metadata.js', { structuredClone, captureAtlasAnchors,
        createId: () => `id-${++count}`, SillyTavern: { getContext: () => context },
        window: { dispatchEvent() {} }, CustomEvent: class {},
    });
    const saved = await scope.addManualAtlasEntry('perceptions', { ...slot, hasBaseline: true, facts: [{ id: 'f1', text: 'Known' }] });
    assert.equal(scope.getManualAtlasEntries('perceptions')[0].facts[0].id, 'f1');
    assert.equal(scope.getManualAtlasEntries('perceptions')[0].hasBaseline, true);
    await scope.saveAtlasTranslation('perceptions', saved.id, { content: 'Translation', sourceHash: 'hash' });
    await scope.setPerceptionPinned(saved.id, true);
    assert.equal(scope.getManualAtlasEntries('perceptions')[0].pinned, true);
    assert.equal(scope.getAtlasTranslation('perceptions', saved.id).content, 'Translation');
    await assert.rejects(scope.addManualAtlasEntry('perceptions', slot), /이미 등록/);
    await scope.addManualAtlasEntry('perceptions', { ...slot, observerId: 'b', subjectId: 'a' });
    await assert.rejects(scope.updateManualAtlasEntry('perceptions', saved.id, { subjectId: 'a' }), /방향/);
    fail = true;
    await assert.rejects(scope.setPerceptionPinned(saved.id, false), /save failed/);
    assert.equal(scope.getManualAtlasEntries('perceptions')[0].pinned, true);
    await assert.rejects(scope.updateManualAtlasEntry('perceptions', saved.id, { impression: 'must rollback' }), /save failed/);
    assert.equal(scope.getManualAtlasEntries('perceptions')[0].impression, null);
    assert.equal(scope.getManualAtlasEntries('perceptions').length, 2);
});

test('permanent slot deletion cleans metadata, rolls back failures and never attaches old updates to recreated directions', async () => {
    let fail = false;
    let counter = 0;
    const context = { chatMetadata: {}, saveMetadata: async () => { if (fail) throw new Error('save failed'); } };
    const scope = await load('../memory/atlas-metadata.js', { structuredClone, captureAtlasAnchors,
        createId: () => `fresh-${++counter}`, SillyTavern: { getContext: () => context },
        window: { dispatchEvent() {} }, CustomEvent: class {},
    });
    let current = await scope.addManualAtlasEntry('perceptions', slot);
    const originalRecords = [record('old', 19, [append('Old knowledge', current.id)])];
    for (let cycle = 0; cycle < 2; cycle++) {
        await scope.setAtlasEntityExcluded('perceptions', current.id, true);
        await scope.saveAtlasTranslation('perceptions', current.id, { content: 'Old translation', sourceHash: 'hash' });
        fail = true;
        await assert.rejects(scope.deleteManualAtlasEntry('perceptions', current.id), /save failed/);
        assert.equal(scope.getManualAtlasEntries('perceptions').length, 1);
        assert.ok(scope.getAtlasTranslation('perceptions', current.id));
        assert.ok(scope.getAtlasEntityCorrection('perceptions', current.id).excluded);
        fail = false;
        await scope.deleteManualAtlasEntry('perceptions', current.id);
        assert.equal(scope.getManualAtlasEntries('perceptions').length, 0);
        assert.equal(scope.getAtlasTranslation('perceptions', current.id), null);
        assert.equal(scope.getAtlasEntityCorrection('perceptions', current.id), null);
        const next = await scope.addManualAtlasEntry('perceptions', slot);
        assert.notEqual(next.id, current.id);
        assert.equal(derivePerceptionAtlas(originalRecords, [next], people).perceptions[0].facts.length, 0);
        current = next;
    }
});

test('pinned perceptions survive before unpinned entries but still respect the total budget', async () => {
    const scope = await load('../summary/context-block-composer.js', { compareRecordPosition, SUMMARY_CONTEXT_BLOCK_KINDS: { PERCEPTIONS: 'perceptions' } });
    const entry = { ...slot, observerName: 'A', subjectName: 'B', facts: [], impression: 'Known' };
    const blocks = scope.buildRenderedBlocks([{ kind: 'perceptions', enabled: true, entryTemplate: '{{sumiPerceptionImpression}}' }], [],
        { perceptions: [{ ...entry, id: 'pinned', pinned: true }, { ...entry, id: 'ordinary' }] });
    const result = composeAtomicContext(blocks, 17, text => text.length);
    assert.equal(result.omittedUnits.length, 1);
    assert.equal(result.omittedUnits[0].id, 'ordinary');
    assert.equal(composeAtomicContext(blocks, 1, text => text.length).content, '');
});

test('perception translation uses names and fact text, caches correctly and participates in translate all', async () => {
    const entity = { ...slot, observerName: 'A', subjectName: 'B', facts: [{ id: 'private-id', text: 'Likes flowers' }], impression: 'Kind' };
    const cache = {};
    const chat = [];
    const scope = await load('../translation/atlas-translation-service.js', {
        assertExtensionEnabled() {}, SillyTavern: { getContext: () => ({ chat }) },
        getSettings: () => ({ translation: { provider: 'test', targetLanguage: 'ko' } }),
        getAtlasProjection: () => ({ perceptions: [entity] }), getStringHash: value => value,
        getAtlasTranslation: (category, id) => cache[id],
        saveAtlasTranslation: async (category, id, value) => { assert.equal(category, 'perceptions'); cache[id] = value; return value; },
        translate: async text => `Translated: ${text}`,
    });
    const source = scope.serializeAtlasEntity('perceptions', entity);
    assert.match(source, /A -> B/);
    assert.match(source, /Likes flowers/);
    assert.doesNotMatch(source, /private-id|undefined|\[object Object\]/);
    assert.equal((await scope.translateAllAtlasEntities()).translated, 1);
    assert.equal((await scope.translateAllAtlasEntities()).skipped, 1);
    entity.facts[0].text = 'Changed knowledge';
    assert.equal(scope.getValidAtlasTranslation('perceptions', entity), null);
    assert.equal((await scope.translateAllAtlasEntities()).translated, 1);
});

test('schema migration preserves customized prompts, rules, selection and context templates across reloads', async () => {
    let count = 0;
    const scope = await load('../core/settings.js', { ...format, ...templates, ...compression, structuredClone,
        createId: () => `id-${++count}`, normalizePromptScope: scope => scope || { type: 'global' },
    });
    const original = scope.normalizePromptEditor({}, 'summary');
    original.schemaVersion = 28;
    const preset = original.presets[0];
    original.activePresetId = preset.id;
    preset.blocks = preset.blocks.filter(block => block.kind !== 'perceptionMemory');
    const rules = preset.blocks.find(block => block.kind === 'summaryExtractionRules').config.rules;
    delete rules.perceptions;
    for (const key of Object.keys(rules)) rules[key] = `My ${key} rule\nDo not modify this spacing.  `;
    const main = preset.blocks.find(block => block.id === 'summary-main');
    main.content = 'My custom main prompt\nKeep everything exactly as written.';
    const before = structuredClone(preset.blocks);
    const migrated = scope.normalizePromptEditor(original, 'summary');
    const blocks = migrated.presets.find(item => item.id === preset.id).blocks;
    assert.equal(migrated.activePresetId, original.activePresetId);
    assert.equal(blocks.filter(block => block.kind === 'perceptionMemory').length, 1);
    assert.equal(blocks.find(block => block.id === main.id).content, main.content);
    const afterRules = blocks.find(block => block.kind === 'summaryExtractionRules').config.rules;
    for (const key of Object.keys(rules)) assert.equal(afterRules[key], rules[key]);
    assert.match(afterRules.perceptions, /observer/);
    assert.deepEqual(Array.from(blocks.filter(block => block.kind !== 'perceptionMemory'), block => block.id), Array.from(before, block => block.id));
    const twice = scope.normalizePromptEditor(migrated, 'summary');
    assert.equal(JSON.stringify(twice), JSON.stringify(migrated));
    const custom = [{ kind: 'people', enabled: false, prefixTemplate: 'CUSTOM PREFIX', entryTemplate: 'CUSTOM ENTRY', suffixTemplate: 'CUSTOM SUFFIX' }];
    const context = scope.normalizeSummaryContextBlocks(custom);
    assert.equal(context.find(block => block.kind === 'people').entryTemplate, 'CUSTOM ENTRY');
    assert.equal(context.find(block => block.kind === 'people').enabled, false);
    assert.equal(context.filter(block => block.kind === 'perceptions').length, 1);
});

test('final rendering contains only names, knowledge and impression, and remains under the shared token budget', async () => {
    const scope = await load('../summary/context-block-composer.js', { compareRecordPosition, SUMMARY_CONTEXT_BLOCK_KINDS: { PERCEPTIONS: 'perceptions' } });
    const data = { ...slot, observerName: 'A', subjectName: 'B', facts: [{ id: 'internal-secret-id', text: 'B likes flowers.' }], impression: 'Kind.' };
    const blocks = scope.buildRenderedBlocks([{ kind: 'perceptions', name: 'Perceptions', enabled: true, prefixTemplate: 'Perceptions', suffixTemplate: '',
        entryTemplate: '{{sumiPerceptionObserver}} -> {{sumiPerceptionSubject}}\n{{sumiPerceptionFacts}}\n{{sumiPerceptionImpression}}' }], [], { perceptions: [data] });
    assert.equal(blocks[0].units[0].content, 'A -> B\n- B likes flowers.\nImpression: Kind.');
    assert.ok(!blocks[0].units[0].content.includes('internal-secret-id'));
    const full = composeAtomicContext(blocks, Infinity, text => text.length);
    assert.equal(full.blocks[0].outputTokenCount, full.content.length);
    const trimmed = composeAtomicContext(blocks, 5, text => text.length);
    assert.ok(trimmed.outputTokenCount <= 5);
    assert.equal(trimmed.omittedUnits[0].kind, 'perceptions');
});

test('v30 replaces only the exact old perception default and preserves all other prompt data', async () => {
    let count = 0;
    const scope = await load('../core/settings.js', { ...format, ...templates, ...compression, structuredClone,
        createId: () => `id-${++count}`, normalizePromptScope: scope => scope || { type: 'global' },
    });
    const oldRule = vm.runInContext('V29_PERCEPTION_EXTRACTION_RULE', scope);
    const newRule = vm.runInContext('DEFAULT_SUMMARY_EXTRACTION_RULES.perceptions', scope);
    const editor = scope.normalizePromptEditor({}, 'summary');
    editor.schemaVersion = 29;
    editor.hideSeparators = true;
    const preset = editor.presets[0];
    preset.blocks.reverse();
    preset.blocks.find(block => block.id === 'summary-main').content = 'CUSTOM MAIN: preserve exactly\n  ';
    const rules = preset.blocks.find(block => block.kind === 'summaryExtractionRules').config.rules;
    for (const key of Object.keys(rules)) rules[key] = key === 'perceptions' ? oldRule : `CUSTOM ${key}\n  `;
    const custom = structuredClone(preset);
    custom.id = 'custom-perceptions';
    custom.blocks.find(block => block.kind === 'summaryExtractionRules').config.rules.perceptions = `${oldRule}\nMy own addition.`;
    editor.presets.push(custom);
    editor.activePresetId = custom.id;
    const expected = JSON.parse(JSON.stringify(editor));
    expected.schemaVersion = 30;
    expected.presets[0].blocks.find(block => block.kind === 'summaryExtractionRules').config.rules.perceptions = newRule;
    const migrated = scope.normalizePromptEditor(editor, 'summary');
    assert.deepEqual(JSON.parse(JSON.stringify(migrated)), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(scope.normalizePromptEditor(migrated, 'summary'))), expected);
    assert.equal(rules.perceptions, oldRule, 'migration must not mutate its input');
    for (const type of ['revision', 'compression']) {
        const other = scope.normalizePromptEditor({}, type);
        other.schemaVersion = 29;
        const expectedOther = JSON.parse(JSON.stringify(other));
        expectedOther.schemaVersion = 30;
        assert.deepEqual(JSON.parse(JSON.stringify(scope.normalizePromptEditor(other, type))), expectedOther);
    }
});

test('all perception review modes use the person-focused rule without affecting other categories', async () => {
    const settings = await load('../core/settings.js', { ...format, ...templates, ...compression, structuredClone,
        createId: () => 'test-id', normalizePromptScope: scope => scope || { type: 'global' },
    });
    const rule = vm.runInContext('DEFAULT_SUMMARY_EXTRACTION_RULES.perceptions', settings);
    const kinds = vm.runInContext('BLOCK_KINDS', settings);
    const preset = { blocks: [
        { kind: kinds.SUMMARY_MESSAGES, content: '{{sumiMessageContent}}' },
        { kind: kinds.SUMMARY_EXTRACTION_RULES, config: { rules: { perceptions: rule, people: 'CUSTOM PEOPLE RULE' } } },
        { kind: kinds.PERCEPTION_MEMORY, content: '{{sumiPerceptions}}' },
    ] };
    const scope = await load('../prompts/prompt-builder.js', {
        ...format, BLOCK_KINDS: kinds, PROMPT_TYPES: { SUMMARY: 'summary' },
        getActivePreset: () => preset, getSettings: () => ({ summarization: { outputLanguage: 'source' } }),
        SillyTavern: { getContext: () => ({}) }, substituteParams: text => text,
        buildPerceptionMemoryPromptContext: () => 'REGISTERED SLOTS',
        buildPeopleMemoryPromptContext: () => '', buildItemMemoryPromptContext: () => '',
        buildCommitmentMemoryPromptContext: () => '', buildEventMemoryPromptContext: () => '', buildWorldMemoryPromptContext: () => '',
    });
    for (const mode of ['quick', 'record', 'chronological']) {
        const prompt = scope.buildAtlasReviewPrompt({ messages: [], startId: 0, endId: 9 }, 'perceptions', { mode });
        assert.ok(prompt.includes(rule));
        assert.match(prompt, /She feels uncomfortable in crowded places/);
        assert.match(prompt, /require evidence that the observer actually formed that impression/);
        assert.match(prompt, /knowledge about the subject as a person/);
        assert.ok(!prompt.includes('Record only what that observer learned or believed'));
        const peoplePrompt = scope.buildAtlasReviewPrompt({ messages: [], startId: 0, endId: 9 }, 'people', { mode });
        assert.match(peoplePrompt, /CUSTOM PEOPLE RULE/);
        assert.ok(!peoplePrompt.includes('Perception review exception'));
        assert.ok(!peoplePrompt.includes(rule));
    }
});

test('selected-slot retrospective reviews preserve other directions and reject unselected responses', async () => {
    const reverse = { ...slot, id: 'ba', observerId: 'b', subjectId: 'a' };
    const records = [record('r1', 19, [append('A knew B'), append('B knew A', 'ba')], { type: 'summary' })];
    const scope = await projectionHarness({ slots: [{ ...slot, allowAutoUpdate: false }, reverse], records });
    let calls = 0;
    let responseTarget = 'ab';
    let saved;
    const prompts = [];
    Object.assign(scope, { assertExtensionEnabled() {}, createId: () => 'review-1',
        getCoveredRanges: values => values.map(record => ({ startId: record.startId, endId: record.endId })),
        hasMessageRange: record => Number.isInteger(record.startId) && Number.isInteger(record.endId),
        createSummaryChunks: (chat, startId, endId) => [{ startId, endId, messages: [] }],
        buildAtlasReviewPrompt: (target, category, options) => { prompts.push(options); return 'prompt'; },
        parseAtlasReviewResponse: format.parseAtlasReviewResponse,
        generateSummary: async () => { calls++; return JSON.stringify({ memoryUpdates: { perceptions: { created: [], updated: [append('Reviewed knowledge', responseTarget)] } } }); },
        saveAtlasRecordReviewOverrides: async value => { saved = value; },
    });
    await load('../memory/atlas-review-service.js', scope);
    const input = { mode: 'chronological', category: 'perceptions', perceptionIds: ['ab'], startRecordId: 'r1', endRecordId: 'r1' };
    const draft = await scope.createAtlasReviewDraft(input);
    assert.equal(calls, 1);
    assert.equal(prompts[0].projectionOptions.beforeStartId, 10);
    assert.deepEqual(prompts[0].projectionOptions.perceptionIds, ['ab']);
    const updates = draft.entries[0].memoryUpdates.updated;
    assert.equal(draft.after.find(item => item.id === 'ab').facts[0].text, 'Reviewed knowledge');
    assert.equal(updates.find(update => update.targetId === 'ab').append.facts[0], 'Reviewed knowledge');
    assert.equal(updates.find(update => update.targetId === 'ba').append.facts[0], 'B knew A');
    assert.equal(draft.after.find(item => item.id === 'ba').facts[0].text, 'B knew A');
    const edited = scope.editAtlasReviewDraftEntry(draft, 0, { created: [], updated: [append('User edited knowledge')] });
    assert.equal(calls, 1, 'editing must not call the LLM');
    assert.equal(draft.after.find(item => item.id === 'ab').facts[0].text, 'Reviewed knowledge');
    assert.equal(edited.after.find(item => item.id === 'ab').facts[0].text, 'User edited knowledge');
    assert.equal(edited.after.find(item => item.id === 'ba').facts[0].text, 'B knew A');
    assert.match(JSON.stringify(edited.entries[0].stepChanges), /User edited knowledge/);
    assert.equal(saved, undefined, 'editing must not persist metadata');
    const quickDraft = { ...draft, mode: 'quick', entries: [{ ...draft.entries[0], reviewId: 'quick-edited' }] };
    const quickEdited = scope.editAtlasReviewDraftEntry(quickDraft, 0, { created: [], updated: [append('Quick edited')] });
    assert.equal(quickEdited.after.find(item => item.id === 'ab').facts[0].text, 'Quick edited');
    const precise = scope.editAtlasReviewDraftEntry({ ...draft, mode: 'record' }, 0, { created: [], updated: [append('Precise edited')] });
    assert.equal(precise.after.find(item => item.id === 'ab').facts[0].text, 'Precise edited');
    assert.throws(() => scope.editAtlasReviewDraftEntry({ ...draft, baselineSignature: 'stale' }, 0, updates), /변경되었습니다/);
    assert.throws(() => scope.editAtlasReviewDraftEntry(draft, 0, { created: [], updated: [append('bad', 'invented')] }), /선택|ID/);
    const removed = scope.editAtlasReviewDraftEntry(edited, 0, { created: [], updated: [] });
    assert.equal(removed.after.find(item => item.id === 'ab').facts.length, 0);
    assert.equal(removed.after.find(item => item.id === 'ba').facts[0].text, 'B knew A');
    await scope.applyAtlasReviewDraft(edited);
    assert.equal(saved[0].category, 'perceptions');
    assert.equal(saved[0].memoryUpdates.updated[0].append.facts[0], 'User edited knowledge');
    responseTarget = 'ba';
    await assert.rejects(scope.createAtlasReviewDraft(input), /선택하지 않았거나/);
    const beforeCalls = calls;
    await assert.rejects(scope.createAtlasReviewDraft({ ...input, perceptionIds: ['nonexistent'] }), /재검토할 인식 칸/);
    assert.equal(calls, beforeCalls);
});
import { captureAtlasAnchors } from '../memory/atlas-anchor-transaction.js';
