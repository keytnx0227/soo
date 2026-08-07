import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    setExtensionPrompt,
} from '../../../../../script.js';
import { MacrosParser } from '../../../../../scripts/macros.js';
import { macros, MacroCategory } from '../../../../../scripts/macros/macro-system.js';
import { power_user } from '../../../../../scripts/power-user.js';
import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { isExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import { finalizeRetrievalResult, retrieveLongTermRecords } from '../memory/long-term-retrieval.js';
import { getActiveSummaryRecords, getSummaryRecords } from './summary-store.js';
import { buildContextBlockComposition } from './context-block-composer.js';

const INJECTION_KEY = 'sumi_chat_summarizer_context';
const MACRO_NAME = 'sumiSummary';
const RECORD_SEPARATOR = '\n\n';
let initialized = false;

export function initializeSummaryContext() {
    if (initialized) return;
    initialized = true;
    registerSummaryMacro();
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
    const activeRecords = getActiveSummaryRecords();
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

function registerSummaryMacro() {
    const handler = () => buildSummaryContext();
    if (power_user.experimental_macro_engine) {
        if (macros.registry.hasMacro(MACRO_NAME)) macros.registry.unregisterMacro(MACRO_NAME);
        macros.register(MACRO_NAME, {
            category: MacroCategory.CHAT,
            description: 'Returns the token-limited summary context for the current chat.',
            handler,
        });
    } else {
        if (MacrosParser.has(MACRO_NAME)) MacrosParser.unregisterMacro(MACRO_NAME);
        MacrosParser.registerMacro(MACRO_NAME, handler, 'Returns the token-limited summary context for the current chat.');
    }
}

function queueRetrievalRefresh() {
    queueMicrotask(refreshRetrievalState);
}

function refreshRetrievalState() {
    refreshSummaryInjection();
    window.dispatchEvent(new CustomEvent('stsm:long-term-retrieval-changed'));
}
