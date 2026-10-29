import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAutoTranslationQueue } from '../translation/auto-translation-queue.js';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function load(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.runInContext(source, vm.createContext(scope));
    return scope;
}

test('enqueue does not wait, translations remain serial and later enqueues are drained', async () => {
    const first = deferred();
    const calls = [];
    const queue = createAutoTranslationQueue({ shouldContinue: () => true, translate: async record => {
        calls.push(record.id);
        if (record.id === 1) await first.promise;
    } });
    assert.equal(queue.enqueue({ id: 1 }), undefined);
    await Promise.resolve();
    queue.enqueue({ id: 2 });
    await Promise.resolve();
    assert.deepEqual(calls, [1]);
    first.resolve();
    const result = await queue.drain();
    assert.deepEqual(calls, [1, 2]);
    assert.equal(result.completed, 2);
});

test('a failed translation does not stop the remaining queue', async () => {
    const errors = [];
    const queue = createAutoTranslationQueue({ shouldContinue: () => true, onError: error => errors.push(error.message),
        translate: async item => { if (item.id === 1) throw new Error('provider failed'); } });
    queue.enqueue({ id: 1 }); queue.enqueue({ id: 2 });
    const result = await queue.drain();
    assert.equal(result.failed, 1); assert.equal(result.completed, 1);
    assert.deepEqual(errors, ['provider failed']);
});

test('cancel or chat switch discards active work and skips pending requests', async () => {
    const gate = deferred();
    let active = true;
    let calls = 0;
    const queue = createAutoTranslationQueue({ shouldContinue: () => active, translate: async () => {
        calls++; await gate.promise;
        throw Object.assign(new Error('cancel'), { code: 'STSM_TRANSLATION_DISCARDED' });
    } });
    queue.enqueue({ id: 1 }); queue.enqueue({ id: 2 });
    await Promise.resolve(); active = false; gate.resolve();
    const result = await queue.drain();
    assert.equal(calls, 1); assert.equal(result.skipped, 2); assert.equal(result.failed, 0);
});

test('the second summary generates while the first translation is still pending', async () => {
    const gate = deferred(); const calls = []; const records = [];
    const context = { chat: [{}, {}] };
    const queue = createAutoTranslationQueue({ shouldContinue: () => true, translate: async record => {
        calls.push(`translate-${record.startId}`); await gate.promise;
    } });
    const scope = await load('../summary/summary-service.js', {
        SillyTavern: { getContext: () => context }, assertExtensionEnabled() {},
        getSettings: () => ({ summarization: { chunkSize: 1 } }), getSummaryRecordIndex: () => [],
        findOverlappingRanges: () => [], createId: () => 'batch',
        createSummaryChunks: () => [0, 1].map(id => ({ startId: id, endId: id, messages: [] })),
        getSummaryOutputConfiguration: () => ({ sections: {}, memorySections: {} }),
        buildSummaryPrompt: async chunk => String(chunk.startId), generateSummary: async prompt => { calls.push(`summary-${prompt}`); return '{}'; },
        parseStructuredSummaryResponse: () => ({}), renderStructuredSummary: () => 'summary',
        createSourceFingerprint: () => ({}), SUMMARY_FORMAT_VERSION: 1,
        addSummaryRecord: async record => { records.push(record); return record; },
    });
    await scope.summarizeRange({ startId: 0, endId: 1, onRecord: record => queue.enqueue(record) });
    assert.equal(records.length, 2);
    assert.deepEqual(calls, ['summary-0', 'translate-0', 'summary-1']);
    gate.resolve(); await queue.drain();
    assert.equal(calls.at(-1), 'translate-1');
});

for (const scenario of ['edit', 'delete', 'chat', 'reset', 'cancel', 'unchanged']) {
    test(`translation applies only to the original source: ${scenario}`, async () => {
        const gate = deferred(); const controller = new AbortController();
        let record = { id: 'r', content: 'original' }; let saves = 0;
        const context = { chat: [], chatMetadata: { sumi_chat_summarizer: {} } };
        const scope = await load('../translation/translation-service.js', {
            SillyTavern: { getContext: () => context }, assertExtensionEnabled() {},
            getSummaryRecord: () => record, getSettings: () => ({ translation: { targetLanguage: 'ko', provider: 'mock' } }),
            translate: () => gate.promise,
            setSummaryRecordTranslation: async () => { saves++; return record; },
        });
        const promise = scope.translateSummaryRecord('r', { signal: controller.signal });
        if (scenario === 'edit') record = { ...record, content: 'changed' };
        if (scenario === 'delete') record = null;
        if (scenario === 'chat') context.chat = [];
        if (scenario === 'reset') context.chatMetadata.sumi_chat_summarizer = {};
        if (scenario === 'cancel') controller.abort();
        gate.resolve('translated');
        if (scenario === 'unchanged') { await promise; assert.equal(saves, 1); }
        else { await assert.rejects(promise, error => error.code === 'STSM_TRANSLATION_DISCARDED'); assert.equal(saves, 0); }
    });
}
