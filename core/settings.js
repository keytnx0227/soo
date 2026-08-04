import { saveSettings as saveSillyTavernSettings, saveSettingsDebounced } from '../../../../../script.js';
import { createId } from './utils.js';

export const MODULE_NAME = 'sumi_chat_summarizer';

export const PROMPT_TYPES = Object.freeze({
    SUMMARY: 'summary',
    REVISION: 'revision',
});

const PROMPT_SCHEMA_VERSION = 3;

export const BLOCK_KINDS = Object.freeze({
    EDITABLE: 'editable',
    CHARACTER_DESCRIPTION: 'characterDescription',
    CHARACTER_PERSONALITY: 'characterPersonality',
    CHARACTER_SCENARIO: 'characterScenario',
    PERSONA: 'persona',
    WORLD_INFO: 'worldInfo',
    RECENT_SUMMARIES: 'recentSummaries',
    RECENT_SUMMARY_SEPARATOR: 'recentSummarySeparator',
    SUMMARY_MESSAGES: 'summaryMessages',
    CURRENT_SUMMARY: 'currentSummary',
    REVISION_MESSAGES: 'revisionMessages',
    LEGACY_CHARACTER: 'character',
    LEGACY_SUMMARY_TARGET: 'summaryTarget',
    LEGACY_REVISION_HISTORY: 'revisionHistory',
});

export const PROVIDERS = Object.freeze([
    { value: 'openai', label: 'OpenAI' },
    { value: 'claude', label: 'Claude' },
    { value: 'google', label: 'Google AI Studio' },
    { value: 'vertexai', label: 'Vertex AI' },
    { value: 'openrouter', label: 'OpenRouter' },
]);

const DEFAULT_SUMMARY_MAIN_PROMPT = `# Summary Task

You are a professional conversation summarizer. Summarize the provided conversation segment while preserving concrete events, decisions, relationships, emotional changes, important details, and unresolved information. Do not invent facts that are not present in the conversation.`;

const DEFAULT_SUMMARY_TEMPLATE = `Return only the summary without a preface or commentary. Write a self-contained summary that can be placed before later conversation context. Preserve names and the chronological order of events.`;

const DEFAULT_REVISION_MAIN_PROMPT = `# Summary Revision

You are revising an existing conversation summary. Apply the user's feedback accurately while preserving useful facts and chronology from the current summary.`;

const DEFAULT_REVISION_TEMPLATE = 'Return only the revised summary without a preface, explanation, or commentary.';

const DEFAULT_SUMMARY_RECORD_TEMPLATE = `<Summary range="#{{sumiRecordStartId}} ~ #{{sumiRecordEndId}}">
{{sumiRecordContent}}
</Summary>`;

export const defaultSettings = Object.freeze({
    enabled: true,
    connectionMode: 'profile',
    connection: {
        profile: {
            provider: '',
            model: '',
            maxTokens: 5000,
            temperature: 0.9,
            topP: 1,
            topK: 0,
        },
        custom: {
            provider: 'openai',
            model: '',
            maxTokens: 5000,
            temperature: 0.9,
            topP: 1,
            topK: 0,
        },
    },
    summarization: {
        chunkSize: 30,
        injectionMaxTokens: 24000,
        autoHideSummarizedMessages: false,
        recordTemplate: DEFAULT_SUMMARY_RECORD_TEMPLATE,
        injection: {
            mode: 'macro',
            position: 'after',
            depth: 4,
            role: 'system',
        },
        prompts: {
            summary: createPromptEditorDefaults(PROMPT_TYPES.SUMMARY),
            revision: createPromptEditorDefaults(PROMPT_TYPES.REVISION),
        },
    },
    translation: {
        method: 'basic',
        provider: 'google',
        targetLanguage: 'ko',
        autoTranslate: false,
    },
});

export function getSettings() {
    const extensionSettings = SillyTavern.getContext().extensionSettings;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    mergeDefaults(extensionSettings[MODULE_NAME], defaultSettings);
    normalizeSettings(extensionSettings[MODULE_NAME]);
    return extensionSettings[MODULE_NAME];
}

export function saveSettings() {
    saveSettingsDebounced();
}

export function setExtensionEnabled(enabled) {
    const settings = getSettings();
    settings.enabled = Boolean(enabled);
    saveSettings();
    return settings.enabled;
}

export async function saveSettingsNow() {
    await saveSillyTavernSettings();
}

export function setChunkSize(value) {
    const settings = getSettings();
    settings.summarization.chunkSize = clampInteger(value, 1, 1000, defaultSettings.summarization.chunkSize);
    saveSettings();
    return settings.summarization.chunkSize;
}

export function setAutoHideSummarizedMessages(enabled) {
    const settings = getSettings();
    settings.summarization.autoHideSummarizedMessages = Boolean(enabled);
    saveSettings();
    return settings.summarization.autoHideSummarizedMessages;
}

export function setSummarizationSettings(patch) {
    const settings = getSettings();
    Object.assign(settings.summarization, patch);
    normalizeSettings(settings);
    saveSettings();
    window.dispatchEvent(new CustomEvent('stsm:injection-settings-changed'));
    return settings.summarization;
}

export function setTranslationSettings(patch) {
    const settings = getSettings();
    settings.translation = normalizeTranslationSettings({
        ...settings.translation,
        ...patch,
    });
    saveSettings();
    return settings.translation;
}

export function resetActiveConnectionSettings() {
    const settings = getSettings();
    const mode = settings.connectionMode;
    settings.connection[mode] = structuredClone(defaultSettings.connection[mode]);
    saveSettings();
    return settings.connection[mode];
}

export function getPromptEditor(type) {
    return getSettings().summarization.prompts[type];
}

export function getActivePreset(type) {
    const editor = getPromptEditor(type);
    return getActivePresetFromEditor(editor);
}

export function setActivePreset(type, presetId) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    if (!editor.presets.some(preset => preset.id === presetId)) return false;

    editor.activePresetId = presetId;
    saveSettings();
    return true;
}

export function setPromptSeparatorsHidden(type, hidden) {
    const editor = getPromptEditor(type);
    editor.hideSeparators = Boolean(hidden);
    saveSettings();
    return editor.hideSeparators;
}

export function addPromptBlock(type, name, content) {
    const block = createPromptBlock({ name, content });
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: [...preset.blocks, block],
    }));
    saveSettings();
    return block;
}

export function updatePromptBlock(type, blockId, patch) {
    let updatedBlock = null;
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: preset.blocks.map(block => {
            if (block.id !== blockId) return block;
            updatedBlock = createPromptBlock({ ...block, ...patch, id: block.id, kind: block.kind, locked: block.locked });
            return updatedBlock;
        }),
    }));

    if (updatedBlock) saveSettings();
    return updatedBlock;
}

export function setPromptBlockEnabled(type, blockId, enabled) {
    let didUpdate = false;
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: preset.blocks.map(block => {
            if (block.id !== blockId) return block;
            didUpdate = true;
            return createPromptBlock({ ...block, enabled });
        }),
    }));

    if (didUpdate) saveSettings();
    return didUpdate;
}

export function removePromptBlock(type, blockId) {
    const preset = getActivePreset(type);
    const block = preset.blocks.find(item => item.id === blockId);
    if (!block || block.locked) return false;

    updateActivePreset(type, current => ({
        ...current,
        blocks: current.blocks.filter(item => item.id !== blockId),
    }));
    saveSettings();
    return true;
}

export function movePromptBlock(type, sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return false;

    const preset = getActivePreset(type);
    const sourceIndex = preset.blocks.findIndex(block => block.id === sourceId);
    const targetIndex = preset.blocks.findIndex(block => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;

    const blocks = [...preset.blocks];
    const [moved] = blocks.splice(sourceIndex, 1);
    blocks.splice(targetIndex, 0, moved);
    replaceActivePreset(type, { ...preset, blocks });
    saveSettings();
    return true;
}

export function createPresetFromActive(type, name) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    const source = getActivePresetFromEditor(editor);
    const preset = createPreset({
        name: String(name || '').trim(),
        blocks: structuredClone(source.blocks),
    });

    editor.presets = [...editor.presets, preset];
    editor.activePresetId = preset.id;
    saveSettings();
    return preset;
}

export function deleteActivePreset(type) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    const active = getActivePresetFromEditor(editor);
    if (active.id === getDefaultPreset(type).id || editor.presets.length <= 1) return false;

    editor.presets = editor.presets.filter(preset => preset.id !== active.id);
    editor.activePresetId = editor.presets[0].id;
    saveSettings();
    return true;
}

export function resetActivePreset(type) {
    const active = getActivePreset(type);
    const defaults = getDefaultPreset(type);
    replaceActivePreset(type, {
        ...active,
        blocks: structuredClone(defaults.blocks),
    });
    saveSettings();
    return getActivePreset(type);
}

export function createPromptBlock({
    id = createId('block'),
    name = '새 프롬프트',
    content = '',
    enabled = true,
    locked = false,
    kind = BLOCK_KINDS.EDITABLE,
    separator = false,
    config = {},
} = {}) {
    const normalizedKind = Object.values(BLOCK_KINDS).includes(kind) ? kind : BLOCK_KINDS.EDITABLE;
    return {
        id,
        name: String(name || '새 프롬프트'),
        content: String(content || ''),
        enabled: Boolean(enabled),
        locked: Boolean(locked),
        kind: normalizedKind,
        separator: Boolean(separator),
        config: normalizePromptBlockConfig(normalizedKind, config),
    };
}

function createPromptEditorDefaults(type) {
    const preset = getDefaultPreset(type);
    return {
        schemaVersion: PROMPT_SCHEMA_VERSION,
        hideSeparators: false,
        activePresetId: preset.id,
        presets: [preset],
    };
}

function getDefaultPreset(type) {
    if (type === PROMPT_TYPES.REVISION) {
        return createPreset({
            id: 'default-revision',
            name: '기본 프리셋',
            blocks: [
                createPromptBlock({ id: 'revision-main', name: '수정 대화 기본 지시문', content: DEFAULT_REVISION_MAIN_PROMPT, locked: true }),
                ...createCurrentSummaryBlocks(),
                ...createRevisionConversationBlocks(),
                createPromptBlock({ id: 'revision-template', name: '수정 결과 템플릿', content: DEFAULT_REVISION_TEMPLATE, locked: true }),
            ],
        });
    }

    return createPreset({
        id: 'default-summary',
        name: '기본 프리셋',
        blocks: [
            createPromptBlock({ id: 'summary-main', name: 'Main Prompt', content: DEFAULT_SUMMARY_MAIN_PROMPT, locked: true }),
            ...createCharacterInformationBlocks(),
            ...createWorldInfoBlocks(),
            ...createRecentSummaryBlocks(),
            ...createSummaryTargetBlocks(),
            createPromptBlock({ id: 'summary-template', name: '요약 템플릿', content: DEFAULT_SUMMARY_TEMPLATE, locked: true }),
        ],
    });
}

function createCharacterInformationBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'character-info';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '캐릭터 정보 구분선 시작', content: '<Character Information>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-description`, name: '{{char}} 설정', content: '## {{char}} Profile\n\n{{sumiCharacterDescription}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_DESCRIPTION }),
        createPromptBlock({ id: `${prefix}-personality`, name: '{{char}} 성격', content: '## Personality\n\n{{sumiCharacterPersonality}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_PERSONALITY }),
        createPromptBlock({ id: `${prefix}-scenario`, name: '시나리오', content: '## Scenario\n\n{{sumiCharacterScenario}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_SCENARIO }),
        createPromptBlock({ id: `${prefix}-persona`, name: '{{user}} 설정', content: '## {{user}} Profile\n\n{{sumiPersona}}', enabled, locked: true, kind: BLOCK_KINDS.PERSONA }),
        createPromptBlock({ id: `${prefix}-end`, name: '캐릭터 정보 구분선 끝', content: '</Character Information>', enabled, locked: true, separator: true }),
    ];
}

function createWorldInfoBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'world-info';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '월드 인포 구분선 시작', content: '<World Info>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-content`, name: '월드 인포', content: '{{sumiWorldInfo}}', enabled, locked: true, kind: BLOCK_KINDS.WORLD_INFO }),
        createPromptBlock({ id: `${prefix}-end`, name: '월드 인포 구분선 끝', content: '</World Info>', enabled, locked: true, separator: true }),
    ];
}

function createRecentSummaryBlocks() {
    return [
        createPromptBlock({ id: 'recent-summaries-start', name: '최근 요약 구분선 시작', content: '<Recent Summaries>', locked: true, separator: true, kind: BLOCK_KINDS.RECENT_SUMMARY_SEPARATOR }),
        createPromptBlock({ id: 'recent-summaries-content', name: '최근 요약', content: '{{sumiRecentSummaries}}', locked: true, kind: BLOCK_KINDS.RECENT_SUMMARIES }),
        createPromptBlock({ id: 'recent-summaries-end', name: '최근 요약 구분선 끝', content: '</Recent Summaries>', locked: true, separator: true, kind: BLOCK_KINDS.RECENT_SUMMARY_SEPARATOR }),
    ];
}

function createSummaryTargetBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'summary-target';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '요약 대상 구분선 시작', content: '<Summary Target range="#{{sumiStartId}} ~ #{{sumiEndId}}">', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-messages`, name: '요약 대상 메시지 포맷', content: '#{{sumiMessageId}} {{sumiMessageName}}: {{sumiMessageContent}}', enabled, locked: true, kind: BLOCK_KINDS.SUMMARY_MESSAGES }),
        createPromptBlock({ id: `${prefix}-end`, name: '요약 대상 구분선 끝', content: '</Summary Target>', enabled, locked: true, separator: true }),
    ];
}

function createCurrentSummaryBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'current-summary';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '현재 요약 구분선 시작', content: '<Current Summary>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-content`, name: '현재 요약', content: '{{sumiCurrentSummary}}', enabled, locked: true, kind: BLOCK_KINDS.CURRENT_SUMMARY }),
        createPromptBlock({ id: `${prefix}-end`, name: '현재 요약 구분선 끝', content: '</Current Summary>', enabled, locked: true, separator: true }),
    ];
}

function createRevisionConversationBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'revision-history';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '수정 대화 구분선 시작', content: '<Revision Conversation>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-messages`, name: '수정 대화 메시지 포맷', content: '<RevisionMessage role="{{sumiRevisionRole}}">\n{{sumiRevisionMessage}}\n</RevisionMessage>', enabled, locked: true, kind: BLOCK_KINDS.REVISION_MESSAGES }),
        createPromptBlock({ id: `${prefix}-end`, name: '수정 대화 구분선 끝', content: '</Revision Conversation>', enabled, locked: true, separator: true }),
    ];
}

function createPreset({ id = createId('preset'), name = '새 프리셋', blocks = [] } = {}) {
    return {
        id,
        name: String(name || '새 프리셋'),
        blocks: blocks.map(block => createPromptBlock(block)),
    };
}

function getActivePresetFromEditor(editor) {
    return editor.presets.find(preset => preset.id === editor.activePresetId) || editor.presets[0];
}

function updateActivePreset(type, updater) {
    const current = getActivePreset(type);
    replaceActivePreset(type, updater(current));
}

function replaceActivePreset(type, nextPreset) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    editor.presets = editor.presets.map(preset => (
        preset.id === nextPreset.id ? createPreset(nextPreset) : preset
    ));
}

function normalizeSettings(settings) {
    settings.enabled = Boolean(settings.enabled);
    settings.connectionMode = ['profile', 'custom'].includes(settings.connectionMode) ? settings.connectionMode : 'profile';
    settings.connection.profile = normalizeConnection(settings.connection.profile, defaultSettings.connection.profile);
    settings.connection.custom = normalizeConnection(settings.connection.custom, defaultSettings.connection.custom);
    settings.summarization.chunkSize = clampInteger(settings.summarization.chunkSize, 1, 1000, defaultSettings.summarization.chunkSize);
    delete settings.summarization.autoStartFromLastSummary;
    settings.summarization.injectionMaxTokens = clampInteger(settings.summarization.injectionMaxTokens, 100, 200000, defaultSettings.summarization.injectionMaxTokens);
    settings.summarization.autoHideSummarizedMessages = Boolean(settings.summarization.autoHideSummarizedMessages);
    settings.summarization.recordTemplate = String(settings.summarization.recordTemplate ?? defaultSettings.summarization.recordTemplate);
    settings.summarization.injection = normalizeInjectionSettings(settings.summarization.injection);
    settings.translation = normalizeTranslationSettings(settings.translation);

    for (const type of Object.values(PROMPT_TYPES)) {
        settings.summarization.prompts[type] = normalizePromptEditor(settings.summarization.prompts[type], type);
    }
}

function normalizeInjectionSettings(injection) {
    const source = injection && typeof injection === 'object' ? injection : {};
    return {
        mode: ['macro', 'depth', 'prompt'].includes(source.mode) ? source.mode : 'macro',
        position: ['before', 'after'].includes(source.position) ? source.position : 'after',
        depth: clampInteger(source.depth, 0, 10000, 4),
        role: ['system', 'user', 'assistant'].includes(source.role) ? source.role : 'system',
    };
}

function normalizeTranslationSettings(translation) {
    const source = translation && typeof translation === 'object' ? translation : {};
    const providers = ['google', 'bing'];
    const targetLanguages = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];

    return {
        method: 'basic',
        provider: providers.includes(source.provider) ? source.provider : defaultSettings.translation.provider,
        targetLanguage: targetLanguages.includes(source.targetLanguage)
            ? source.targetLanguage
            : defaultSettings.translation.targetLanguage,
        autoTranslate: Boolean(source.autoTranslate),
    };
}

function normalizeConnection(connection, fallback) {
    const source = connection && typeof connection === 'object' ? connection : {};
    return {
        provider: String(source.provider ?? fallback.provider),
        model: String(source.model ?? fallback.model),
        maxTokens: clampInteger(source.maxTokens, 1, 200000, fallback.maxTokens),
        temperature: clampNumber(source.temperature, 0, 2, fallback.temperature),
        topP: clampNumber(source.topP, 0, 1, fallback.topP),
        topK: clampInteger(source.topK, 0, 200, fallback.topK),
    };
}

function normalizePromptEditor(editor, type) {
    const defaultPreset = getDefaultPreset(type);
    const source = editor && typeof editor === 'object' ? editor : {};
    const hasStoredPresets = Array.isArray(source.presets) && source.presets.length;
    const sourceSchemaVersion = Number(source.schemaVersion || 1);
    const needsMigration = hasStoredPresets && (
        sourceSchemaVersion < PROMPT_SCHEMA_VERSION
        || source.presets.some(hasLegacyPromptBlocks)
    );
    let presets = hasStoredPresets
        ? source.presets.map(preset => createPreset(needsMigration ? migratePromptPreset(preset, type, sourceSchemaVersion) : preset))
        : [defaultPreset];

    if (!presets.some(preset => preset.id === defaultPreset.id)) {
        presets = [defaultPreset, ...presets];
    }

    const activePresetId = presets.some(preset => preset.id === source.activePresetId)
        ? source.activePresetId
        : presets[0].id;

    return {
        schemaVersion: PROMPT_SCHEMA_VERSION,
        hideSeparators: Boolean(source.hideSeparators),
        activePresetId,
        presets,
    };
}

function hasLegacyPromptBlocks(preset) {
    return Array.isArray(preset?.blocks) && preset.blocks.some(block => (
        [BLOCK_KINDS.LEGACY_CHARACTER, BLOCK_KINDS.LEGACY_SUMMARY_TARGET, BLOCK_KINDS.LEGACY_REVISION_HISTORY].includes(block?.kind)
        || (block?.kind === BLOCK_KINDS.WORLD_INFO && !String(block.content || '').trim())
        || (block?.kind === BLOCK_KINDS.CURRENT_SUMMARY && !String(block.content || '').trim())
    ));
}

function migratePromptPreset(preset, type, sourceSchemaVersion) {
    const blocks = Array.isArray(preset?.blocks) ? preset.blocks : [];
    let migratedBlocks = blocks.flatMap(block => {
        if (block?.kind === BLOCK_KINDS.LEGACY_CHARACTER) return createCharacterInformationBlocks(block);
        if (block?.kind === BLOCK_KINDS.WORLD_INFO && !String(block.content || '').trim()) return createWorldInfoBlocks(block);
        if (block?.kind === BLOCK_KINDS.LEGACY_SUMMARY_TARGET) return createSummaryTargetBlocks(block);
        if (block?.kind === BLOCK_KINDS.CURRENT_SUMMARY && !String(block.content || '').trim()) return createCurrentSummaryBlocks(block);
        if (block?.kind === BLOCK_KINDS.LEGACY_REVISION_HISTORY) return createRevisionConversationBlocks(block);
        return { ...block, separator: block.separator ?? isKnownSeparatorBlock(block) };
    });

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 3
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.RECENT_SUMMARIES)) {
        const targetMessageIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_MESSAGES);
        const insertIndex = targetMessageIndex < 0
            ? migratedBlocks.length
            : targetMessageIndex > 0 && migratedBlocks[targetMessageIndex - 1]?.separator
                ? targetMessageIndex - 1
                : targetMessageIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            ...createRecentSummaryBlocks(),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    return {
        ...preset,
        blocks: migratedBlocks,
    };
}

function isKnownSeparatorBlock(block) {
    return Boolean(block?.locked && /(character-info|world-info|summary-target|current-summary|revision-history).*(?:-start|-end)$/.test(String(block.id || '')));
}

function normalizePromptBlockConfig(kind, config) {
    if (kind !== BLOCK_KINDS.RECENT_SUMMARIES) return {};

    const source = config && typeof config === 'object' ? config : {};
    return {
        countLimit: {
            enabled: Boolean(source.countLimit?.enabled),
            value: clampInteger(source.countLimit?.value, 1, 1000, 3),
        },
        tokenLimit: {
            enabled: Boolean(source.tokenLimit?.enabled),
            value: clampInteger(source.tokenLimit?.value, 100, 200000, 4000),
        },
    };
}

function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (target[key] === undefined) {
            target[key] = structuredClone(value);
        } else if (isPlainObject(value) && isPlainObject(target[key])) {
            mergeDefaults(target[key], value);
        }
    }
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampInteger(value, min, max, fallback) {
    return Math.round(clampNumber(value, min, max, fallback));
}
