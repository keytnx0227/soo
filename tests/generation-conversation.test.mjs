import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.runInContext(source, vm.isContext(scope) ? scope : vm.createContext(scope));
    return scope;
}

async function setup() {
    const record = { id: 'r1', startId: 0, endId: 9, updatedAt: 1,
        sourceFingerprint: { hash: 'original' }, structuredSummary: { version: 3, data: {} } };
    const context = { chat: [{}], chatMetadata: { sumi_chat_summarizer: { records: [record] } }, saveMetadata: async () => {} };
    let id = 0;
    const scope = { structuredClone, SillyTavern: { getContext: () => context },
        createId: () => `id-${++id}`, getSettings: () => ({ summarization: {} }),
        getSummaryRecord: key => context.chatMetadata.sumi_chat_summarizer.records.find(item => item.id === key),
        parseStructuredSummaryResponse: JSON.parse, renderStructuredSummary: data => data.title,
        isolateCreatedIds: updates => ({ ...updates, isolated: true }),
    };
    await load('../summary/summary-service.js', scope);
    await load('../records/generation-conversation.js', scope);
    const session = scope.captureGenerationConversation({ record, prompt: 'CUSTOM\r\n<summaryTarget>original</summaryTarget>\nJSON only',
        response: '{"title":"original"}', outputConfiguration: { sections: { title: true }, memorySections: {}, languageMode: 'source' } });
    return { scope, context, record, session };
}

test('original prompt and complete response history survive mode switching unchanged', async () => {
    const { scope, session } = await setup();
    session.history.push({ role: 'user', text: 'Why?' }, { role: 'assistant', text: 'Because...' });
    const prompt = scope.composeGenerationConversation(session, 'Explain');
    assert.ok(prompt.startsWith(session.originalPrompt + '\n\n---'));
    assert.ok(prompt.includes(JSON.stringify(session.history)));
    assert.match(prompt, /JSON-only output requirement does not apply/);
    assert.match(prompt, /When the user asks for revised JSON/);
    assert.doesNotMatch(prompt, /unless the user switches/);
    session.mode = 'write';
    assert.match(scope.composeGenerationConversation(session, 'Revise'), /complete revised summary JSON/);
    assert.equal(session.history[0].text, '{"title":"original"}');
});

test('editing and deleting a turn truncate its descendants and invalidate the candidate without changing baseline', async () => {
    const { scope, session } = await setup();
    const original = session.history[0].text;
    const baseline = session.baseline;
    session.history.push({ role: 'user', text: 'question' }, { role: 'assistant', text: 'answer' }, { role: 'user', text: 'later' });
    session.candidate = 'old draft';
    assert.throws(() => scope.changeGenerationTurn(session, 0), /변경할/);
    assert.throws(() => scope.changeGenerationTurn(session, 1, ' '), /입력/);
    assert.equal(session.history.length, 4);
    scope.changeGenerationTurn(session, 2, 'edited answer');
    assert.equal(session.history.length, 3);
    assert.equal(session.history[2].text, 'edited answer');
    assert.equal(session.candidate, undefined);
    scope.changeGenerationTurn(session, 1);
    assert.equal(session.history.length, 1);
    assert.equal(session.history[0].text, original);
    assert.equal(session.baseline, baseline);
});

test('saving is opt-in, stores one session, clones data, and rolls back failed writes', async () => {
    const { scope, context, session } = await setup();
    assert.equal(scope.readGenerationConversation(), null);
    const owner = scope.getGenerationOwner();
    await scope.saveGenerationConversation(owner, session);
    session.history.push({ role: 'user', text: 'unsaved' });
    assert.equal(scope.readGenerationConversation().history.length, 1);
    const second = { ...session, id: 'second' };
    await scope.saveGenerationConversation(owner, second);
    assert.equal(scope.readGenerationConversation().id, 'second');
    context.saveMetadata = async () => { throw new Error('disk failure'); };
    await assert.rejects(scope.saveGenerationConversation(owner, null), /disk failure/);
    assert.equal(scope.readGenerationConversation().id, 'second');
    context.saveMetadata = async () => {};
    await scope.saveGenerationConversation(owner, null);
    assert.equal(scope.readGenerationConversation(), null);
});

test('automatic archive keeps five record snapshots independently of the explicitly saved conversation', async () => {
    const { scope, context, session } = await setup();
    const owner = scope.getGenerationOwner();
    await scope.saveGenerationConversation(owner, session);
    for (let index = 0; index < 7; index++) {
        await scope.saveRecentGenerationConversation(owner, { ...session, id: `chat-${index}`, recordId: `record-${index}` });
    }
    assert.deepEqual(Array.from(scope.getRecentGenerationConversations(), item => item.recordId), ['record-2', 'record-3', 'record-4', 'record-5', 'record-6']);
    assert.equal(scope.readGenerationConversation().id, session.id);
    assert.equal(scope.hasRecordGenerationConversation('record-0'), false);
    const restored = scope.getRecordGenerationConversation('record-6');
    restored.history.push({ role: 'user', text: 'unsaved follow-up' });
    assert.equal(scope.getRecordGenerationConversation('record-6').history.length, 1);
    context.chatMetadata = JSON.parse(JSON.stringify(context.chatMetadata));
    assert.equal(scope.getRecentGenerationConversations().length, 5);
    assert.equal(scope.getRecordGenerationConversation('record-6').originalPrompt, session.originalPrompt);
    const reloadedOwner = scope.getGenerationOwner();
    context.saveMetadata = async () => { throw new Error('disk failed'); };
    await assert.rejects(scope.saveRecentGenerationConversation(reloadedOwner, { ...session, recordId: 'new' }), /disk failed/);
    assert.equal(scope.getRecentGenerationConversations().length, 5);
    assert.equal(scope.hasRecordGenerationConversation('new'), false);
    await assert.rejects(scope.deleteRecentGenerationConversation(reloadedOwner, 'chat-6'), /disk failed/);
    assert.equal(scope.hasRecordGenerationConversation('record-6'), true);
    context.saveMetadata = async () => {};
    await scope.deleteRecentGenerationConversation(reloadedOwner, 'chat-6');
    assert.equal(scope.getRecentGenerationConversations().length, 4);
    assert.equal(scope.readGenerationConversation().id, session.id);
});

test('an explicitly saved conversation is preferred over its initial automatic snapshot', async () => {
    const { scope, session } = await setup();
    const owner = scope.getGenerationOwner();
    await scope.saveRecentGenerationConversation(owner, session);
    session.history.push({ role: 'user', text: 'saved question' });
    await scope.saveGenerationConversation(owner, session);
    assert.equal(scope.getRecordGenerationConversation(session.recordId).history.length, 2);
    assert.equal(scope.getRecentGenerationConversations()[0].history.length, 1);
    await scope.saveRecentGenerationConversation(owner, { ...session, id: 'replacement' });
    assert.equal(scope.getRecentGenerationConversations().length, 1);
});

test('changed chat, reset data, changed record, hidden record, compressed record are blocked', async () => {
    const { scope, context, session, record } = await setup();
    const owner = scope.getGenerationOwner();
    context.chat = [{}];
    assert.throws(() => scope.checkGenerationOwner(owner), /변경/);
    const fresh = scope.getGenerationOwner();
    context.chatMetadata.sumi_chat_summarizer = { records: [record] };
    assert.throws(() => scope.checkGenerationOwner(fresh), /변경/);
    record.updatedAt++;
    assert.throws(() => scope.checkGenerationRecord(session), /변경/);
    record.updatedAt--; record.llmHidden = true;
    assert.throws(() => scope.checkGenerationRecord(session), /숨겨/);
    delete record.llmHidden; record.segmentedCompressedBy = 'parent';
    assert.throws(() => scope.checkGenerationRecord(session), /압축/);
});

test('revision is a draft, preserves captured fingerprint and uses reference review IDs', async () => {
    const { scope, session, record } = await setup();
    const before = JSON.stringify(record);
    const draft = scope.createConversationDraft(session, '{"title":"revised","memoryUpdates":{}}', scope.getGenerationOwner());
    assert.equal(draft.content, 'revised');
    assert.equal(draft.sourceFingerprint.hash, 'original');
    assert.equal(draft.structuredSummary.data.memoryUpdates.isolated, true);
    assert.equal(JSON.stringify(record), before);
    assert.throws(() => scope.createConversationDraft(session, 'not JSON', scope.getGenerationOwner()));
});

test('summary capture is optional and gets exact input/output after the record callback', async () => {
    const { scope, context, record } = await setup();
    Object.assign(scope, {
        assertExtensionEnabled() {}, getSettings: () => ({ summarization: { chunkSize: 1 } }),
        getSummaryRecordIndex: () => [], findOverlappingRanges: () => [],
        createSummaryChunks: () => [{ startId: 0, endId: 0, messages: [] }],
        getSummaryOutputConfiguration: () => ({ sections: {}, memorySections: {} }),
        buildSummaryPrompt: async () => 'exact prompt', generateSummary: async () => '{"title":"result"}',
        createSourceFingerprint: () => ({}), SUMMARY_FORMAT_VERSION: 3,
        addSummaryRecord: async () => record,
    });
    let captured;
    await scope.summarizeRange({ startId: 0, endId: 0, onRecord: () => { record.updatedAt = 2; }, onGenerated: value => { captured = value; } });
    assert.equal(captured.prompt, 'exact prompt');
    assert.equal(captured.response, '{"title":"result"}');
    assert.equal(captured.record.updatedAt, 2);
    await scope.summarizeRange({ startId: 0, endId: 0 });
    assert.equal(context.chatMetadata.sumi_chat_summarizer.generationConversation, undefined);
});
