import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as placement from '../summary/record-placement.js';
import * as references from '../summary/compression-references.js';
import * as ranges from '../summary/range-utils.js';
import * as format from '../summary/compression-format.js';
import { renderStructuredSummary, normalizeStructuredSummaryData } from '../summary/summary-format.js';
import { resolveSegmentedRecall, selectSegmentedRecallWithinBudget } from '../memory/segmented-recall.js';
import { createRecordDeletionPlan } from '../summary/range-deletion.js';
import { getAtlasSourceRange, canApplyAtlasReplacement, formatAtlasSourceRange } from '../memory/atlas-source-record.js';

async function loadModule(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope, { filename: path });
    return scope;
}

async function setup(mode = 'segmented') {
    let sequence = 0;
    const context = { chat: [], chatMetadata: {}, saveMetadata: async () => {} };
    const settings = { summarization: { compressionMode: mode } };
    const scope = {
        ...placement, ...ranges, ...references, ...format, structuredClone, renderStructuredSummary,
        createRecordDeletionPlan, createId: prefix => `${prefix}-${++sequence}`,
        getSettings: () => settings, saveSettings() {}, getStringHash: value => value,
        normalizeSourceFingerprint: value => value || null,
        window: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {},
        SillyTavern: { getContext: () => context },
    };
    await loadModule('../summary/summary-store.js', scope);
    const add = (plot, startId, endId, options = {}) => scope.addSummaryRecord({
        startId, endId, ...options,
        structuredSummary: { version: 5, data: normalizeStructuredSummaryData({ plot: [plot] }) },
    });
    return { scope, context, settings, add };
}

function compact(sources) {
    return format.parseCompressionResponse(JSON.stringify({ segments: sources.map((source, index) => ({
        sourceIndex: index + 1, importanceRank: index + 1, plot: [`compact ${source.id}`],
    })) }), { segmented: true, sourceRecords: sources });
}

test('optional ranges never cover message zero; supplements do not expand completion', () => {
    const records = [
        { startId: 0, endId: 99 },
        { startId: null, endId: null, manual: { countsAsSummary: false } },
        { startId: 100, endId: 119, manual: { countsAsSummary: false } },
    ];
    assert.deepEqual(ranges.getCoveredRanges(records), [{ startId: 0, endId: 99 }]);
    records[2].manual.countsAsSummary = true;
    assert.deepEqual(ranges.getCoveredRanges(records), [{ startId: 0, endId: 119 }]);
    assert.deepEqual(ranges.getCoveredRanges([{ startId: null, endId: null }]), []);
});

test('manual metadata, range-less order and structured content survive reload', async () => {
    const { scope, context, add } = await setup();
    const a = await add('A', 0, 19);
    const b = await add('B', 20, 39);
    const x = await add('X', null, null, { manual: { includeInCompression: false }, afterRecordId: a.id });
    assert.deepEqual(Array.from(scope.getSummaryRecords().sort(placement.compareRecordPosition), record => record.id), [a.id, x.id, b.id]);
    assert.match(x.content, /Supplement/);
    assert.doesNotMatch(x.content, /null|#0-/);
    context.chatMetadata = structuredClone(context.chatMetadata);
    const reloaded = scope.getSummaryRecord(x.id);
    assert.equal(reloaded.startId, null);
    assert.equal(reloaded.position, 19.5);
    assert.equal(reloaded.manual.includeInCompression, false);
    assert.equal(scope.getSummaryRecordIndex().find(record => record.id === x.id).manual.countsAsSummary, false);
});

test('references render nothing until recalled; source order, pinning and nested recall survive', async () => {
    const { scope, context, add } = await setup();
    const a = await add('A original', 0, 19);
    const b = await add('B original', 20, 39);
    const x = await add('X original', null, null, { manual: { includeInCompression: false }, afterRecordId: a.id });
    const sources = [a, x, b];
    const data = references.attachCompressionReferences(compact([a, b]), sources, [x.id], true);
    assert.equal(data.segments[1].kind, 'reference');
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: sources.map(record => record.id), compressionData: data });
    assert.doesNotMatch(parent.content, /X original/);
    context.chatMetadata = structuredClone(context.chatMetadata);
    const records = scope.getSummaryRecords();
    const recalledX = scope.getSummaryRecord(x.id);
    const result = resolveSegmentedRecall(records, [{ record: recalledX, pinned: true }]);
    assert.deepEqual(result.records.map(record => record.id), [`compact:${parent.id}:${a.id}`, x.id, `compact:${parent.id}:${b.id}`]);
    assert.deepEqual(result.pinnedRecordIds, [x.id]);
    const otherHit = resolveSegmentedRecall(records, [{ record: scope.getSummaryRecord(a.id) }]);
    assert.ok(!otherHit.records.some(record => record.id.includes(x.id)));
    const c = await add('C', 40, 59);
    await scope.addCompressedSummaryRecord({ sourceRecordIds: [parent.id, c.id], compressionData: compact([parent, c]) });
    const nested = resolveSegmentedRecall(scope.getSummaryRecords(), [{ record: recalledX }]);
    assert.ok(nested.records.some(record => record.id === x.id && record.content.includes('X original')));
    const budget = selectSegmentedRecallWithinBudget([{ record: recalledX }], 0, {
        records: scope.getSummaryRecords(), countTokens: value => value.includes('X original') ? 1000 : 1,
    });
    assert.equal(budget.selected.length, 0);
});

test('compression preserves exact coverage and retained supplements in one transaction', async () => {
    const { scope, context, add } = await setup();
    const a = await add('A', 0, 19);
    const b = await add('B supplemental range', 40, 59, { manual: { countsAsSummary: false } });
    const x = await add('X', null, null, { manual: { includeInCompression: false }, afterRecordId: a.id });
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: [a.id, b.id], compressionData: compact([a, b]), retainedPlacements: [{ id: x.id }] });
    assert.deepEqual(JSON.parse(JSON.stringify(parent.coverageRanges)), [{ startId: 0, endId: 19 }]);
    const retained = scope.getSummaryRecord(x.id);
    assert.equal(retained.compressedBy, null);
    assert.ok(retained.position > parent.endId);
    const before = JSON.stringify(context.chatMetadata);
    context.saveMetadata = async () => { throw new Error('save failed'); };
    await assert.rejects(scope.addCompressedSummaryRecord({ sourceRecordIds: [parent.id, x.id], compressionData: compact([parent, x]) }), /save failed/);
    assert.equal(JSON.stringify(context.chatMetadata), before);
});

test('LLM contract remains strict; model view excludes reference-only segments', () => {
    const sources = [{ id: 'a' }, { id: 'x' }, { id: 'b' }];
    const data = references.attachCompressionReferences(compact([sources[0], sources[2]]), sources, ['x'], true);
    assert.equal(references.compressionDataForModel(data).segments.length, 2);
    assert.deepEqual(references.getCompressionInputSources(sources, data).map(record => record.id), ['a', 'b']);
    assert.throws(() => format.parseCompressionResponse('{"segments":[{"sourceIndex":1,"plot":[]}]}', { segmented: true, sourceRecords: [sources[0]] }), /plot/);
    const malicious = structuredClone(data);
    malicious.segments[1].compactData = { plot: ['must not render'] };
    assert.doesNotMatch(format.renderCompressionSummary(malicious, { startId: 0, endId: 39 }), /must not render/);
});

test('compression sends only included records, and regeneration keeps the exclusion', async () => {
    const { scope, add } = await setup();
    const a = await add('A', 0, 19);
    const b = await add('B', 20, 39);
    const x = await add('X secret', null, null, { manual: { includeInCompression: false }, afterRecordId: a.id });
    const prompts = [];
    scope.assertExtensionEnabled = () => {};
    scope.buildCompressionPrompt = sources => {
        prompts.push(sources.map(record => record.id));
        return JSON.stringify({ segments: sources.map((record, index) => ({ sourceIndex: index + 1, plot: ['compressed'] })) });
    };
    scope.generateSummary = async prompt => prompt;
    await loadModule('../summary/compression-service.js', scope);
    const parent = await scope.compressSummaryRecords({ startRecordId: a.id, count: 3 });
    assert.deepEqual(Array.from(prompts[0]), [a.id, b.id]);
    assert.equal(scope.getSummaryRecord(x.id).compressedBy, parent.id);
    await scope.regenerateCompressedSummary(parent.id);
    assert.deepEqual(Array.from(prompts[1]), [a.id, b.id]);
    assert.equal(scope.getSummaryRecord(parent.id).compression.data.segments[1].kind, 'reference');
});

test('all excluded selection stops before any LLM call', async () => {
    const { scope, add } = await setup();
    const a = await add('A', null, null, { manual: { includeInCompression: false } });
    await add('B', null, null, { manual: { includeInCompression: false } });
    scope.assertExtensionEnabled = () => {};
    scope.generateSummary = async () => assert.fail('must not call LLM');
    await loadModule('../summary/compression-service.js', scope);
    await assert.rejects(scope.compressSummaryRecords({ startRecordId: a.id, count: 2 }), /압축에 포함할 레코드가 없습니다/);
});

test('single included source plus a retained supplement stays valid without archiving the supplement', async () => {
    const { scope, add } = await setup();
    const a = await add('A', 0, 19);
    const x = await add('X', null, null, { manual: { includeInCompression: false } });
    scope.assertExtensionEnabled = () => {};
    scope.buildCompressionPrompt = sources => JSON.stringify({ segments: sources.map((record, index) => ({ sourceIndex: index + 1, plot: ['compact'] })) });
    scope.generateSummary = async prompt => prompt;
    await loadModule('../summary/compression-service.js', scope);
    const parent = await scope.compressSummaryRecords({ startRecordId: a.id, count: 2, excludedActions: { [x.id]: { action: 'keep' } } });
    assert.equal(scope.getSummaryRecord(x.id).compressedBy, null);
    assert.equal(parent.compression.sourceRecordIds.length, 1);
    assert.equal(parent.compression.data.segments.length, 1);
});

test('integrated compression preserves excluded originals without changing its output format', async () => {
    const { scope, add } = await setup('integrated');
    const a = await add('A', 0, 19);
    const x = await add('X', null, null, { manual: { includeInCompression: false } });
    scope.assertExtensionEnabled = () => {};
    scope.buildCompressionPrompt = sources => {
        assert.deepEqual(Array.from(sources, source => source.id), [a.id]);
        return '{"plot":["compact A"]}';
    };
    scope.generateSummary = async prompt => prompt;
    await loadModule('../summary/compression-service.js', scope);
    const parent = await scope.compressSummaryRecords({ startRecordId: a.id, count: 2 });
    assert.equal(parent.compression.data.segments, undefined);
    assert.equal(scope.getSummaryRecord(x.id).compressedBy, parent.id);
    await scope.regenerateCompressedSummary(parent.id);
    assert.deepEqual(Array.from(scope.getSummaryRecord(parent.id).compression.data.excludedSourceIds), [x.id]);
});

test('mode changes during generation reject results without moving any source', async () => {
    const { scope, settings, add } = await setup();
    const a = await add('A', 0, 19);
    await add('B', 20, 39);
    scope.assertExtensionEnabled = () => {};
    scope.buildCompressionPrompt = () => 'prompt';
    scope.generateSummary = async () => { settings.summarization.compressionMode = 'integrated'; return '{}'; };
    await loadModule('../summary/compression-service.js', scope);
    await assert.rejects(scope.compressSummaryRecords({ startRecordId: a.id, count: 2 }), /압축 모드/);
    assert.equal(scope.getSummaryRecords().length, 2);
    assert.ok(scope.getSummaryRecords().every(record => !record.compressedBy));
});

test('revision contract and parse keep reference segments outside the model request', async () => {
    const { scope, add } = await setup();
    const a = await add('A', 0, 19);
    const x = await add('X', null, null, { manual: { includeInCompression: false } });
    const data = references.attachCompressionReferences(compact([a]), [a, x], [x.id], true);
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: [a.id, x.id], compressionData: data });
    await loadModule('../records/revision-chat-view.js', scope);
    const session = { recordId: parent.id, recordType: 'compressed', baseStructuredData: data, messages: [] };
    const prompt = scope.createRevisionPromptInput(session);
    assert.doesNotMatch(prompt.structuredSourceContent, /reference|excludedSourceIds/);
    assert.equal(JSON.parse(prompt.structuredSourceContent).segments.length, 1);
    const result = scope.parseRevisionResult(session, '{"segments":[{"sourceIndex":1,"plot":["revised A"]}]}');
    assert.equal(result.data.segments[1].sourceRecordId, x.id);
    assert.equal(result.data.segments[1].kind, 'reference');
    await scope.updateSummaryRecordContent(parent.id, 'revised', { compressionData: result.data, contentEdited: false });
    assert.equal(scope.getSummaryRecord(parent.id).compression.data.segments[1].kind, 'reference');
    assert.equal(scope.buildSummarySource(x), null);
});

test('manual regeneration is blocked before any source or LLM access', async () => {
    const { scope, add } = await setup();
    const record = await add('manual', 0, 19, { manual: { countsAsSummary: true } });
    scope.assertExtensionEnabled = () => {};
    await loadModule('../summary/summary-service.js', scope);
    await assert.rejects(scope.createSummaryRegenerationDraft(record.id), /직접 추가한 레코드/);
});

test('deleting a reference source invalidates its parent and releases preserved siblings', async () => {
    const { scope, add } = await setup();
    const a = await add('A', 0, 19);
    const x = await add('X', null, null, { manual: { includeInCompression: false } });
    const data = references.attachCompressionReferences(compact([a]), [a, x], [x.id], true);
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: [a.id, x.id], compressionData: data });
    await scope.deleteSummaryRecords([x.id]);
    assert.equal(scope.getSummaryRecord(parent.id), null);
    assert.equal(scope.getSummaryRecord(x.id), null);
    assert.equal(scope.getSummaryRecord(a.id).compressedBy, null);
});

test('range correction moves supplemental placement and rebuilds parent coverage from children', async () => {
    const { scope, add } = await setup();
    const a = await add('A', 0, 19);
    const b = await add('B', 20, 39, { manual: { countsAsSummary: false } });
    const x = await add('X', null, null, { manual: { includeInCompression: false }, afterRecordId: a.id });
    const data = references.attachCompressionReferences(compact([a, b]), [a, x, b], [x.id], true);
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: [a.id, x.id, b.id], compressionData: data });
    await scope.updateSummaryRecordRanges([
        { id: a.id, startId: 0, endId: 21 }, { id: b.id, startId: 22, endId: 41 },
        { id: parent.id, startId: 0, endId: 41 },
    ], { threshold: 10, delta: 2 });
    assert.equal(scope.getSummaryRecord(x.id).position, 21.5);
    assert.deepEqual(JSON.parse(JSON.stringify(scope.getSummaryRecord(parent.id).coverageRanges)), [{ startId: 0, endId: 21 }]);
    assert.equal(scope.getSummaryRecord(x.id).startId, null);
});

test('backup serialization and reloading preserve manual fields and reference sources', async () => {
    const { scope, context, add } = await setup();
    const a = await add('A', 0, 19);
    const x = await add('X', null, null, { manual: { includeInCompression: false } });
    const data = references.attachCompressionReferences(compact([a]), [a, x], [x.id], true);
    const parent = await scope.addCompressedSummaryRecord({ sourceRecordIds: [a.id, x.id], compressionData: data });
    const backupScope = { structuredClone, SillyTavern: scope.SillyTavern };
    await loadModule('../summary/chat-data-transfer.js', backupScope);
    const backup = backupScope.createCurrentChatBackup();
    const read = await backupScope.readChatBackup({ text: async () => JSON.stringify(backup) });
    context.chatMetadata = { sumi_chat_summarizer: read.data };
    assert.equal(scope.getSummaryRecord(x.id).manual.includeInCompression, false);
    assert.equal(scope.getSummaryRecord(parent.id).compression.data.segments[1].kind, 'reference');
});

test('atlas supplements keep chronological precedence without claiming message zero', () => {
    const original = getAtlasSourceRange({ startId: 10, endId: 19 });
    const supplement = getAtlasSourceRange({ startId: null, endId: null, position: 19.5 });
    assert.equal(supplement.startId, null);
    assert.equal(supplement.endId, null);
    assert.equal(formatAtlasSourceRange(supplement), '보충 기억');
    assert.equal(canApplyAtlasReplacement(original, supplement), true);
    assert.equal(canApplyAtlasReplacement(supplement, original), false);
});
