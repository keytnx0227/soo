import {
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
import { getSummaryRecords } from './summary-store.js';
import { buildContextBlockComposition } from './context-block-composer.js';

const INJECTION_KEY = 'sumi_chat_summarizer_context';
const MACRO_NAME = 'sumiSummary';
const RECORD_SEPARATOR = '\n\n';

export function initializeSummaryContext() {
    registerSummaryMacro();
    refreshSummaryInjection();
    window.addEventListener('stsm:records-changed', () => queueMicrotask(refreshSummaryInjection));
    window.addEventListener('stsm:atlas-changed', () => queueMicrotask(refreshSummaryInjection));
    window.addEventListener('stsm:injection-settings-changed', refreshSummaryInjection);
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
    return {
        enabled: true,
        ...buildContextBlockComposition(settings.injectionMaxTokens),
        sourceRecordCount: getSummaryRecords().length,
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

    let firstFittingIndex = records.length;
    for (let index = 1; index <= records.length; index += 1) {
        if (getTokenCount(renderRecords(records.slice(index), template)) <= budget) {
            firstFittingIndex = index;
            break;
        }
    }

    const laterRecords = records.slice(firstFittingIndex);
    const previousRecord = records[firstFittingIndex - 1];
    if (!previousRecord) {
        return createContextDetails({
            content: renderRecords(laterRecords, template),
            budget,
            originalTokenCount,
            sourceRecordCount: records.length,
            omittedRecords: records.slice(0, firstFittingIndex),
        });
    }

    const partial = renderPartialOldestRecord(previousRecord, laterRecords, template, budget);
    const omittedRecords = records.slice(0, Math.max(0, firstFittingIndex - 1));
    if (!partial.partialRecord) omittedRecords.push(previousRecord);

    return createContextDetails({
        content: partial.content,
        budget,
        originalTokenCount,
        sourceRecordCount: records.length,
        omittedRecords,
        partialRecord: partial.partialRecord,
    });
}

function renderPartialOldestRecord(record, laterRecords, template, budget) {
    const content = String(record.content || '');
    const later = renderRecords(laterRecords, template);
    const renderCandidate = offset => [
        renderRecord(record, template, content.slice(offset)),
        later,
    ].filter(Boolean).join(RECORD_SEPARATOR);

    if (getTokenCount(renderCandidate(content.length)) > budget) {
        return { content: later, partialRecord: null };
    }

    let low = 0;
    let high = content.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (getTokenCount(renderCandidate(middle)) <= budget) high = middle;
        else low = middle + 1;
    }

    const boundary = content.indexOf('\n', low);
    const offset = boundary >= 0 ? boundary + 1 : low;
    const trimmedContent = content.slice(offset).trimStart();
    return {
        content: trimmedContent
            ? [renderRecord(record, template, trimmedContent), later].filter(Boolean).join(RECORD_SEPARATOR)
            : later,
        partialRecord: trimmedContent
            ? { startId: record.startId, endId: record.endId }
            : null,
    };
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
