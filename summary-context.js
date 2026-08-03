import {
    extension_prompt_roles,
    extension_prompt_types,
    setExtensionPrompt,
} from '../../../../script.js';
import { MacrosParser } from '../../../../scripts/macros.js';
import { macros, MacroCategory } from '../../../../scripts/macros/macro-system.js';
import { power_user } from '../../../../scripts/power-user.js';
import { getTokenCount } from '../../../../scripts/tokenizers.js';
import { getSettings } from './settings.js';
import { getSummaryRecords } from './summary-store.js';

const INJECTION_KEY = 'st_chat_summarizer_context';
const MACRO_NAME = 'sumiSummary';

export function initializeSummaryContext() {
    registerSummaryMacro();
    refreshSummaryInjection();
    window.addEventListener('stsm:records-changed', refreshSummaryInjection);
    window.addEventListener('stsm:injection-settings-changed', refreshSummaryInjection);
}

export function refreshSummaryInjection() {
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
    const records = [...getSummaryRecords()].sort((a, b) => a.startId - b.startId || a.endId - b.endId);
    if (!records.length) return '';

    const body = records.map(record => `<Summary range="#${record.startId} ~ #${record.endId}">\n${record.content}\n</Summary>`).join('\n\n');
    const prefix = '<ConversationSummaries>\n';
    const suffix = '\n</ConversationSummaries>';
    const budget = getSettings().summarization.injectionMaxTokens;
    const full = `${prefix}${body}${suffix}`;
    if (getTokenCount(full) <= budget) return full;

    let low = 0;
    let high = body.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = `${prefix}${body.slice(middle)}${suffix}`;
        if (getTokenCount(candidate) <= budget) high = middle;
        else low = middle + 1;
    }
    const boundary = body.indexOf('\n', low);
    return `${prefix}${body.slice(boundary >= 0 ? boundary + 1 : low)}${suffix}`;
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
