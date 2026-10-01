import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as format from '../summary/summary-format.js';
import * as templates from '../summary/summary-record-template.js';
import * as compression from '../summary/compression-format.js';
import { normalizePromptScope } from '../prompts/character-prompt-scope.js';

async function load(path, scope) {
    const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    vm.createContext(scope);
    vm.runInContext(source, scope);
    return scope;
}
const plain = value => JSON.parse(JSON.stringify(value));

async function setup() {
    let sequence = 0;
    let saves = 0;
    let fail = false;
    let duringSave = null;
    let download = null;
    const context = { extensionSettings: {}, chatMetadata: { unrelated: 'CHAT DATA' } };
    const scope = await load('../core/settings.js', { ...format, ...templates, ...compression, normalizePromptScope, structuredClone,
        createId: prefix => `${prefix}-${++sequence}`, SillyTavern: { getContext: () => context },
        saveSettingsDebounced() {}, saveSillyTavernSettings: async () => { saves++; duringSave?.(); if (fail) throw new Error('save failed'); },
    });
    const transfer = await load('../prompts/prompt-preset-transfer.js', {
        structuredClone, getPromptEditor: scope.getPromptEditor, addImportedPromptPresets: scope.addImportedPromptPresets,
        BLOCK_KINDS: vm.runInContext('BLOCK_KINDS', scope), PROMPT_TYPES: vm.runInContext('PROMPT_TYPES', scope),
        downloadJson: (data, name) => { download = { data, name }; },
    });
    scope.getSettings().connection.profile.model = 'PRIVATE-CONNECTION-MODEL';
    return { scope, transfer, context, saves: () => saves, fail: value => { fail = value; },
        duringSave: callback => { duringSave = callback; }, download: () => download };
}

test('single export includes complete hidden/scoped blocks, exact text and rules without unrelated settings', async () => {
    const { scope, transfer } = await setup();
    scope.createPresetFromActive('summary', 'Custom <summary>');
    scope.addPromptBlock('summary', 'Private character rule', '  Keep\n{{macros}} exactly.  ', { scope: { type: 'character', characterKey: 'different.png', characterName: 'Other' } });
    const preset = scope.getActivePreset('summary');
    const block = preset.blocks.at(-1);
    scope.setPromptBlockEnabled('summary', block.id, false);
    scope.movePromptBlock('summary', block.id, preset.blocks[0].id);
    const expected = plain(scope.getActivePreset('summary'));
    const backup = transfer.createPromptPresetBackup('summary');
    assert.deepEqual(Object.keys(backup.editors), ['summary']);
    assert.deepEqual(plain(backup.editors.summary.presets), [expected]);
    assert.equal(backup.editors.summary.presets[0].blocks[0].enabled, false);
    assert.equal(backup.editors.summary.presets[0].blocks[0].scope.characterKey, 'different.png');
    assert.ok(!JSON.stringify(backup).includes('PRIVATE-CONNECTION-MODEL'));
    backup.editors.summary.presets[0].blocks[0].content = 'mutated export';
    assert.equal(scope.getActivePreset('summary').blocks[0].content, expected.blocks[0].content);
});

test('all export and file roundtrip restore new copies without changing existing presets or global options', async () => {
    const { scope, transfer, context, saves } = await setup();
    scope.createPresetFromActive('revision', 'Reviser');
    const backup = transfer.createPromptPresetBackup('summary', { all: true });
    const parsed = await transfer.readPromptPresetBackup({ text: async () => '\uFEFF' + JSON.stringify(backup) });
    const before = plain(scope.getSettings());
    const added = await transfer.importPromptPresetBackup(parsed);
    const after = plain(scope.getSettings());
    assert.equal(saves(), 1);
    for (const type of ['summary', 'revision', 'compression']) {
        const oldEditor = before.summarization.prompts[type];
        const editor = after.summarization.prompts[type];
        assert.equal(editor.presets.length, oldEditor.presets.length * 2);
        assert.equal(editor.activePresetId, oldEditor.activePresetId);
        assert.deepEqual(editor.presets.slice(0, oldEditor.presets.length), oldEditor.presets);
        for (const [index, preset] of added.find(item => item.type === type).presets.entries()) {
            assert.deepEqual(plain(preset.blocks), oldEditor.presets[index].blocks);
            assert.notEqual(preset.id, oldEditor.presets[index].id);
            assert.ok(preset.name.includes('(가져옴)'));
        }
    }
    delete before.summarization.prompts;
    delete after.summarization.prompts;
    assert.deepEqual(after, before);
    assert.deepEqual(context.chatMetadata, { unrelated: 'CHAT DATA' });
});

test('activation follows each backup selection and duplicate names remain unique across repeated imports', async () => {
    const { scope, transfer } = await setup();
    scope.createPresetFromActive('compression', 'Copy');
    const backup = transfer.createPromptPresetBackup('compression');
    const first = await transfer.importPromptPresetBackup(backup, { activate: true });
    assert.equal(scope.getActivePreset('compression').id, first[0].presets[0].id);
    const second = await transfer.importPromptPresetBackup(backup, { activate: true });
    assert.equal(scope.getActivePreset('compression').id, second[0].presets[0].id);
    assert.equal(first[0].presets[0].name, 'Copy (가져옴)');
    assert.equal(second[0].presets[0].name, 'Copy (가져옴 2)');
});

test('restoring a saved old default does not apply wording migrations to the backed-up rule', async () => {
    const { scope, transfer } = await setup();
    const backup = transfer.createPromptPresetBackup('summary');
    backup.editors.summary.schemaVersion = 29;
    const oldRule = vm.runInContext('V29_PERCEPTION_EXTRACTION_RULE', scope);
    backup.editors.summary.presets[0].blocks.find(block => block.kind === 'summaryExtractionRules').config.rules.perceptions = oldRule;
    await transfer.importPromptPresetBackup(backup, { activate: true });
    const restored = scope.getActivePreset('summary').blocks.find(block => block.kind === 'summaryExtractionRules');
    assert.equal(restored.config.rules.perceptions, oldRule);
});

test('invalid files are rejected before any preset is added', async () => {
    const { scope, transfer, saves } = await setup();
    const valid = transfer.createPromptPresetBackup('summary', { all: true });
    const before = plain(scope.getSettings());
    const variants = [
        value => { value.format = 'sumi-extension-settings-backup'; },
        value => { value.version = 2; },
        value => { value.editors.summary.schemaVersion = 999; },
        value => { value.editors = {}; },
        value => { value.editors.unknown = value.editors.summary; },
        value => { value.editors.summary.activePresetId = 'missing'; },
        value => { value.editors.summary.presets.push(value.editors.summary.presets[0]); },
        value => { value.editors.compression.presets[0].blocks[0].kind = 'future-kind'; },
        value => { value.editors.summary.presets[0].blocks[0].content = {}; },
        value => { value.editors.summary.presets[0].blocks.push(value.editors.summary.presets[0].blocks[0]); },
        value => { value.editors.summary.presets[0].blocks[0].scope = { type: 'character' }; },
    ];
    for (const mutate of variants) {
        const invalid = structuredClone(valid);
        mutate(invalid);
        await assert.rejects(transfer.importPromptPresetBackup(invalid));
        assert.deepEqual(plain(scope.getSettings()), before);
    }
    await assert.rejects(transfer.readPromptPresetBackup({ text: async () => '{broken' }), /JSON/);
    await assert.rejects(transfer.readPromptPresetBackup({ size: 11 * 1024 * 1024, text: async () => '' }), /10MB/);
    assert.equal(saves(), 0);
});

test('failed saves remove only imported copies and restore previous selections', async () => {
    const { scope, transfer, fail, duringSave } = await setup();
    const backup = transfer.createPromptPresetBackup('summary', { all: true });
    const before = plain(scope.getSettings().summarization.prompts);
    fail(true);
    duringSave(() => { scope.getSettings().summarization.chunkSize = 77; });
    await assert.rejects(transfer.importPromptPresetBackup(backup, { activate: true }), /save failed/);
    assert.deepEqual(plain(scope.getSettings().summarization.prompts), before);
    assert.equal(scope.getSettings().summarization.chunkSize, 77);
});

test('download uses the validated backup and a filesystem-safe filename', async () => {
    const { transfer, download } = await setup();
    const backup = transfer.createPromptPresetBackup('summary');
    transfer.downloadPromptPresetBackup(backup);
    assert.equal(download().data, backup);
    assert.match(download().name, /^sumi-prompt-presets-[\w-]+\.json$/);
});
