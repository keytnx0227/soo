import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    setExtensionPrompt,
    substituteParams,
} from '../../../../../script.js';
import { MacrosParser } from '../../../../../scripts/macros.js';
import { macros, MacroCategory } from '../../../../../scripts/macros/macro-system.js';
import { power_user } from '../../../../../scripts/power-user.js';
import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { world_info_position } from '../../../../../scripts/world-info.js';
import { isExtensionEnabled } from '../core/extension-state.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { finalizeRetrievalResult, retrieveLongTermRecords } from '../memory/long-term-retrieval.js';
import { getSummaryRecords } from './summary-store.js';
import { buildContextBlockComposition } from './context-block-composer.js';

const INJECTION_KEY = 'sumi_chat_summarizer_context';
const MACRO_NAME = 'sumiSummary';
const WORLD_MACRO_NAME = 'sumiWorldSetting';
const VIRTUAL_WORLD_NAME = 'sumi-chat-summarizer';
const VIRTUAL_WORLD_UID = -731941;
const WORLD_INFO_BOOTSTRAP_UID = -731942;
const RECORD_SEPARATOR = '\n\n';
let initialized = false;
let worldInfoInjectionSuppressionDepth = 0;

export function initializeSummaryContext() {
    if (initialized) return;
    initialized = true;
    registerMacros();
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, prepareWorldInfoScan);
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, injectVirtualWorldInfoEntry);
    refreshSummaryInjection();
    window.addEventListener('stsm:records-changed', queueRetrievalRefresh);
    window.addEventListener('stsm:atlas-changed', queueRetrievalRefresh);
    window.addEventListener('stsm:injection-settings-changed', refreshRetrievalState);
    for (const eventType of [
        event_types.CHAT_CHANGED,
        event_types.MESSAGE_SENT,
        event_types.MESSAGE_RECEIVED,
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_UPDATED,
        event_types.MESSAGE_DELETED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_SWIPE_DELETED,
    ]) {
        eventSource.on(eventType, queueRetrievalRefresh);
    }
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, refreshRetrievalState);
}

export function refreshSummaryInjection() {
    if (!isExtensionEnabled()) {
        setExtensionPrompt(INJECTION_KEY, '', extension_prompt_types.NONE, 0);
        return;
    }

    const settings = getSettings().summarization.injection;
    const value = buildSummaryContext();
    const roles = {
        system: extension_prompt_roles.SYSTEM,
        user: extension_prompt_roles.USER,
        assistant: extension_prompt_roles.ASSISTANT,
    };

    if (settings.mode === 'depth') {
        setExtensionPrompt(INJECTION_KEY, value, extension_prompt_types.IN_CHAT, settings.depth, false, roles[settings.role]);
    } else if (settings.mode === 'prompt') {
        const position = settings.position === 'before' ? extension_prompt_types.BEFORE_PROMPT : extension_prompt_types.IN_PROMPT;
        setExtensionPrompt(INJECTION_KEY, value, position, 0, false, extension_prompt_roles.SYSTEM);
    } else {
        setExtensionPrompt(INJECTION_KEY, '', extension_prompt_types.NONE, 0);
    }
}

export function buildSummaryContext() {
    return buildSummaryContextDetails().content;
}

export function buildSummaryContextDetails() {
    const settings = getSettings().summarization;
    if (!isExtensionEnabled()) {
        return createContextDetails({
            enabled: false,
            budget: settings.injectionMaxTokens,
        });
    }
    const context = SillyTavern.getContext();
    const allRecords = getSummaryRecords();
    const activeRecords = allRecords.filter(record => !record.compressedBy);
    const retrieval = retrieveLongTermRecords({
        records: allRecords,
        messages: context.chat,
        settings: settings.longTermRetrieval,
        countTokens: getTokenCount,
    });
    const selectedRecords = retrieval.selected.map(item => item.record);
    const pinnedRecordIds = retrieval.selected.filter(item => item.pinned).map(item => item.record.id);
    const composition = buildContextBlockComposition(settings.injectionMaxTokens, {
        records: [...activeRecords, ...selectedRecords],
        retrievedRecordIds: selectedRecords.map(record => record.id),
        pinnedRecordIds,
        messages: context.chat,
        blockKinds: settings.worldOutput.mode === 'summary'
            ? null
            : settings.contextBlocks
                .map(block => block.kind)
                .filter(kind => kind !== SUMMARY_CONTEXT_BLOCK_KINDS.WORLD),
    });
    return {
        enabled: true,
        ...composition,
        sourceRecordCount: activeRecords.length + selectedRecords.length,
        retrieval: finalizeRetrievalResult(retrieval, composition.omittedUnits),
        omittedRecords: [],
        partialRecord: null,
    };
}

export function buildWorldSettingContext() {
    return buildWorldSettingContextDetails().content;
}

export function buildWorldSettingContextDetails() {
    const settings = getSettings().summarization;
    if (!isExtensionEnabled()) {
        return createContextDetails({
            enabled: false,
            budget: settings.worldRetrieval.maxTokens,
        });
    }
    return {
        enabled: true,
        ...buildContextBlockComposition(Infinity, {
            records: [],
            messages: SillyTavern.getContext().chat,
            blockKinds: [SUMMARY_CONTEXT_BLOCK_KINDS.WORLD],
        }),
    };
}

export async function withWorldInfoInjectionSuppressed(callback) {
    worldInfoInjectionSuppressionDepth += 1;
    try {
        return await callback();
    } finally {
        worldInfoInjectionSuppressionDepth -= 1;
    }
}

export function buildSummaryRecordsContext(sourceRecords, template, budget = Infinity) {
    return buildSummaryRecordsContextDetails(sourceRecords, template, budget).content;
}

export function buildSummaryRecordsContextDetails(sourceRecords, template, budget = Infinity) {
    const records = [...sourceRecords].sort((a, b) => a.startId - b.startId || a.endId - b.endId);
    if (!records.length) return createContextDetails({ budget });

    const full = renderRecords(records, template);
    const originalTokenCount = getTokenCount(full);
    if (!Number.isFinite(budget) || originalTokenCount <= budget) {
        return createContextDetails({
            content: full,
            budget,
            originalTokenCount,
            sourceRecordCount: records.length,
        });
    }

    const includedRecords = [...records];
    const omittedRecords = [];
    while (includedRecords.length && getTokenCount(renderRecords(includedRecords, template)) > budget) {
        omittedRecords.push(includedRecords.shift());
    }

    return createContextDetails({
        content: renderRecords(includedRecords, template),
        budget,
        originalTokenCount,
        sourceRecordCount: records.length,
        omittedRecords,
    });
}

function createContextDetails({
    enabled = true,
    content = '',
    budget = Infinity,
    originalTokenCount = 0,
    sourceRecordCount = 0,
    omittedRecords = [],
    partialRecord = null,
} = {}) {
    return {
        enabled,
        content,
        budget,
        originalTokenCount,
        sourceRecordCount,
        outputTokenCount: getTokenCount(content),
        truncated: Boolean(omittedRecords.length || partialRecord),
        omittedRecords: omittedRecords.map(record => ({ startId: record.startId, endId: record.endId })),
        partialRecord,
    };
}

function renderRecords(records, template) {
    return records
        .map(record => renderRecord(record, template))
        .filter(Boolean)
        .join(RECORD_SEPARATOR);
}

function renderRecord(record, template, content = record.content) {
    return String(template || '')
        .replaceAll('{{sumiRecordStartId}}', String(record.startId))
        .replaceAll('{{sumiRecordEndId}}', String(record.endId))
        .replaceAll('{{sumiRecordContent}}', String(content || ''))
        .trim();
}

function registerMacros() {
    registerMacro(
        MACRO_NAME,
        () => buildSummaryContext(),
        'Returns the token-limited summary context for the current chat.',
    );
    registerMacro(
        WORLD_MACRO_NAME,
        () => getSettings().summarization.worldOutput.mode === 'macro' ? buildWorldSettingContext() : '',
        'Returns the token-limited world setting memory when separate macro output is enabled.',
    );
}

function registerMacro(name, handler, description) {
    if (power_user.experimental_macro_engine) {
        if (macros.registry.hasMacro(name)) macros.registry.unregisterMacro(name);
        macros.register(name, {
            category: MacroCategory.CHAT,
            description,
            handler,
        });
    } else {
        if (MacrosParser.has(name)) MacrosParser.unregisterMacro(name);
        MacrosParser.registerMacro(name, handler, description);
    }
}

function shouldInjectWorldInfo() {
    return worldInfoInjectionSuppressionDepth === 0
        && isExtensionEnabled()
        && getSettings().summarization.worldOutput.mode === 'worldInfo';
}

function prepareWorldInfoScan(loreSources) {
    if (!shouldInjectWorldInfo()) return;
    const collections = [
        loreSources?.globalLore,
        loreSources?.characterLore,
        loreSources?.chatLore,
        loreSources?.personaLore,
    ];
    if (collections.some(collection => Array.isArray(collection) && collection.length)) return;
    if (!Array.isArray(loreSources?.globalLore)) return;

    // A disabled entry prevents ST from returning before WORLDINFO_SCAN_DONE when no lorebook exists.
    loreSources.globalLore.push({
        uid: WORLD_INFO_BOOTSTRAP_UID,
        world: VIRTUAL_WORLD_NAME,
        comment: 'Sumi World Setting Bootstrap',
        content: '',
        disable: true,
        order: 0,
        position: world_info_position.before,
    });
}

function injectVirtualWorldInfoEntry(scan) {
    if (!shouldInjectWorldInfo() || scan?.state?.next) return;
    const settings = getSettings().summarization;
    const content = substituteParams(buildWorldSettingContext());
    const activatedEntries = scan?.activated?.entries;
    if (!content || !activatedEntries) return;
    const key = `${VIRTUAL_WORLD_NAME}.${VIRTUAL_WORLD_UID}`;
    const entry = {
        uid: VIRTUAL_WORLD_UID,
        world: VIRTUAL_WORLD_NAME,
        comment: 'Sumi World Setting',
        content,
        key: [],
        keysecondary: [],
        order: 0,
        position: settings.worldOutput.worldInfoPosition === 'after'
            ? world_info_position.after
            : world_info_position.before,
        hash: VIRTUAL_WORLD_UID,
    };
    if (typeof activatedEntries.set === 'function') activatedEntries.set(key, entry);
    else if (typeof activatedEntries.add === 'function') activatedEntries.add(entry);
}

function queueRetrievalRefresh() {
    queueMicrotask(refreshRetrievalState);
}

function refreshRetrievalState() {
    refreshSummaryInjection();
    window.dispatchEvent(new CustomEvent('stsm:long-term-retrieval-changed'));
}
