import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadModule(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope);
    return scope;
}

test('summary prompts forward the cutoff to all six atlas contexts only when supplied', async () => {
    const categories = ['people', 'items', 'commitments', 'events', 'world', 'perceptions'];
    const kinds = ['PEOPLE_MEMORY', 'ITEM_MEMORY', 'COMMITMENT_MEMORY', 'EVENT_MEMORY', 'WORLD_MEMORY', 'PERCEPTION_MEMORY'];
    const names = ['People', 'Item', 'Commitment', 'Event', 'World', 'Perception'];
    const calls = [];
    const scope = {
        BLOCK_KINDS: Object.fromEntries(kinds.map(kind => [kind, kind])),
        PROMPT_TYPES: { SUMMARY: 'summary' },
        getActivePreset: () => ({ blocks: kinds.map((kind, index) => ({
            kind, enabled: true, content: index === 5 ? '{{sumiPerceptions}}' : `{{sumi${names[index]}Memory}}`,
        })) }),
        isPromptBlockApplicable: () => true,
        getSettings: () => ({ summarization: { memorySections: {} } }),
        getEnabledMemorySections: () => Object.fromEntries(categories.map(category => [category, true])),
        SillyTavern: { getContext: () => ({}) },
        getSummaryLanguageInstruction: () => '',
        buildSummaryJsonContract: () => '',
        substituteParams: value => value,
    };
    for (const name of names) {
        scope[`build${name}MemoryPromptContext`] = options => {
            calls.push({ name, cutoff: options.beforeStartId });
            return name;
        };
    }
    await loadModule('../prompts/prompt-builder.js', scope);
    const chunk = { messages: [], startId: 30, endId: 39 };
    const configuration = { sections: {}, memorySections: {} };
    const result = await scope.buildSummaryPrompt(chunk, configuration, {
        atlasProjectionOptions: { beforeStartId: 30 },
    });
    assert.equal(result, names.join('\n\n'));
    assert.deepEqual(calls, names.map(name => ({ name, cutoff: 30 })));
    calls.length = 0;
    await scope.buildSummaryPrompt(chunk, configuration);
    assert.deepEqual(calls, names.map(name => ({ name, cutoff: undefined })));
});

test('regeneration requests atlas state before the target range', async () => {
    const stop = new Error('stop before generation');
    let options;
    const scope = {
        assertExtensionEnabled() {},
        getSummaryRecord: () => ({ id: 'record', startId: 30, endId: 39 }),
        getSummaryOutputConfiguration: () => ({}),
        createSourceFingerprint: () => ({}),
        buildSummaryPrompt: async (chunk, configuration, value) => {
            options = value;
            throw stop;
        },
    };
    await loadModule('../summary/summary-service.js', scope);
    scope.validateSummaryRange = () => ({ start: 30, end: 39, chat: [] });
    scope.createSummaryChunks = () => [{ startId: 30, endId: 39, messages: [] }];
    await assert.rejects(scope.createSummaryRegenerationDraft('record'), error => error === stop);
    assert.equal(options.atlasProjectionOptions.beforeStartId, 30);
});

test('the actual summary builder preserves custom instructions without implicitly reading source messages', async () => {
    const kinds = ['PEOPLE_MEMORY', 'ITEM_MEMORY', 'COMMITMENT_MEMORY', 'EVENT_MEMORY', 'WORLD_MEMORY', 'SUMMARY_MESSAGES', 'RECENT_SUMMARIES', 'CHARACTER_DESCRIPTION', 'CHARACTER_PERSONALITY', 'CHARACTER_SCENARIO', 'PERSONA', 'WORLD_INFO', 'SUMMARY_EXTRACTION_RULES'];
    const scope = {
        BLOCK_KINDS: Object.fromEntries(kinds.map(kind => [kind, kind])),
        PROMPT_TYPES: { SUMMARY: 'summary' },
        getActivePreset: () => ({ blocks: [
            { kind: 'custom', enabled: true, content: 'MY CUSTOM INSTRUCTIONS' },
            { kind: 'SUMMARY_MESSAGES', enabled: true, content: '#{{sumiMessageId}} {{sumiMessageContent}}' },
        ] }),
        isPromptBlockApplicable: () => true, getSummarySectionKeyForKind: () => null,
        SillyTavern: { getContext: () => ({ chat: [{ mes: 'DO NOT READ IMPLICITLY' }] }) },
        getSummaryLanguageInstruction: () => '', buildSummaryJsonContract: () => '', substituteParams: value => value,
        isMessageAutoHiddenBySummarizer: () => false,
        buildPeopleMemoryPromptContext: () => '', buildItemMemoryPromptContext: () => '',
        buildCommitmentMemoryPromptContext: () => '', buildEventMemoryPromptContext: () => '', buildWorldMemoryPromptContext: () => '',
        buildPerceptionMemoryPromptContext: () => '',
    };
    await loadModule('../prompts/prompt-builder.js', scope);
    const config = { sections: {}, memorySections: {} };
    assert.equal(await scope.buildSummaryPrompt({ messages: [], startId: null, endId: null }, config), 'MY CUSTOM INSTRUCTIONS');
    const included = await scope.buildSummaryPrompt({ messages: [{ id: 5, message: { mes: 'SELECTED_ONCE' } }], startId: 5, endId: 5 }, config);
    assert.equal(included, 'MY CUSTOM INSTRUCTIONS\n\n#5 SELECTED_ONCE');
});
