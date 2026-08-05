import { substituteParams } from '../../../../../script.js';
import { getWorldInfoPrompt, world_info_include_names } from '../../../../world-info.js';
import { isMessageAutoHiddenBySummarizer } from '../visibility/message-visibility-state.js';
import {
    BLOCK_KINDS,
    getActivePreset,
    getSettings,
    PROMPT_TYPES,
    SUMMARY_EXTRACTION_RULE_DEFINITIONS,
} from '../core/settings.js';
import { buildSummaryRecordsContext } from '../summary/summary-context.js';
import { getSummaryRecords } from '../summary/summary-store.js';
import { buildPeopleMemoryPromptContext } from '../memory/people-memory-service.js';
import { buildItemMemoryPromptContext } from '../memory/item-memory-service.js';
import {
    buildSummaryJsonContract,
    getEnabledMemorySections,
    getEnabledSummarySections,
    getSummarySectionKeyForKind,
    getSummaryLanguageInstruction,
} from '../summary/summary-format.js';

export function getSummaryOutputConfiguration() {
    const settings = getSettings().summarization;
    return {
        sections: getEnabledSummarySections(settings.summarySections),
        memorySections: getEnabledMemorySections(settings.memorySections),
        languageMode: settings.outputLanguage,
    };
}

export async function buildSummaryPrompt({ messages, startId, endId }, outputConfiguration = getSummaryOutputConfiguration()) {
    const preset = getActivePreset(PROMPT_TYPES.SUMMARY);
    const recentSummaryBlock = preset.blocks.find(block => block.enabled && block.kind === BLOCK_KINDS.RECENT_SUMMARIES);
    const recentSummaries = recentSummaryBlock ? buildRecentSummaryContent(recentSummaryBlock, startId) : '';
    const { sections, memorySections, languageMode } = outputConfiguration;
    const chunk = { messages, startId, endId, recentSummaries, sections, memorySections, languageMode };
    const parts = [];

    for (const block of preset.blocks.filter(block => isSummaryBlockEnabled(block, sections))) {
        const content = await renderSummaryBlock(block, chunk);
        if (content.trim()) parts.push(content.trim());
    }

    return parts.join('\n\n');
}

function isSummaryBlockEnabled(block, sections) {
    if (block.kind === BLOCK_KINDS.PEOPLE_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).people;
    }
    if (block.kind === BLOCK_KINDS.ITEM_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).items;
    }
    const sectionKey = getSummarySectionKeyForKind(block.kind);
    return sectionKey ? Boolean(sections[sectionKey]) : block.enabled;
}

export async function buildRevisionPrompt({ baseContent, messages }) {
    const preset = getActivePreset(PROMPT_TYPES.REVISION);
    const parts = [];

    for (const block of preset.blocks.filter(block => block.enabled)) {
        const content = renderRevisionBlock(block, { baseContent, messages });
        if (content.trim()) parts.push(content.trim());
    }

    return parts.join('\n\n');
}

async function renderSummaryBlock(block, chunk) {
    const context = SillyTavern.getContext();
    const character = context.characters?.[context.characterId] || {};
    const commonValues = {
        sumiStartId: chunk.startId,
        sumiEndId: chunk.endId,
        sumiSummaryLanguageInstruction: getSummaryLanguageInstruction(chunk.languageMode),
        sumiSummaryJsonContract: buildSummaryJsonContract(chunk.sections, chunk.memorySections),
    };

    switch (block.kind) {
        case BLOCK_KINDS.CHARACTER_DESCRIPTION:
            return renderDataBlock(block, 'sumiCharacterDescription', character.description, commonValues);
        case BLOCK_KINDS.CHARACTER_PERSONALITY:
            return renderDataBlock(block, 'sumiCharacterPersonality', character.personality, commonValues);
        case BLOCK_KINDS.CHARACTER_SCENARIO:
            return renderDataBlock(block, 'sumiCharacterScenario', character.scenario, commonValues);
        case BLOCK_KINDS.PERSONA:
            return renderDataBlock(block, 'sumiPersona', context.powerUserSettings?.persona_description, commonValues);
        case BLOCK_KINDS.WORLD_INFO:
            return renderDataBlock(block, 'sumiWorldInfo', await getWorldInfoContent(chunk), commonValues);
        case BLOCK_KINDS.RECENT_SUMMARIES:
            return renderDataBlock(block, 'sumiRecentSummaries', chunk.recentSummaries, commonValues);
        case BLOCK_KINDS.RECENT_SUMMARY_SEPARATOR:
            return chunk.recentSummaries ? renderTemplate(block.content, commonValues) : '';
        case BLOCK_KINDS.SUMMARY_MESSAGES:
            return renderSummaryMessages(block.content, chunk, context);
        case BLOCK_KINDS.PEOPLE_MEMORY:
            return renderDataBlock(block, 'sumiPeopleMemory', buildPeopleMemoryPromptContext(), commonValues);
        case BLOCK_KINDS.ITEM_MEMORY:
            return renderDataBlock(block, 'sumiItemMemory', buildItemMemoryPromptContext(), commonValues);
        case BLOCK_KINDS.SUMMARY_EXTRACTION_RULES:
            return renderSummaryExtractionRules(block.config.rules, chunk.sections, chunk.memorySections);
        default:
            return renderTemplate(block.content, commonValues);
    }
}

function renderSummaryExtractionRules(rules, sections, memorySections) {
    return SUMMARY_EXTRACTION_RULE_DEFINITIONS
        .filter(({ key, category }) => category === 'memory' ? memorySections[key] : sections[key])
        .map(({ key }) => String(rules?.[key] || '').trim())
        .filter(Boolean)
        .join('\n\n');
}

function buildRecentSummaryContent(block, startId) {
    const config = block.config;
    let records = getSummaryRecords()
        .filter(record => record.endId < startId)
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);

    if (config.countLimit.enabled) records = records.slice(-config.countLimit.value);

    const settings = getSettings().summarization;
    const tokenBudget = config.tokenLimit.enabled ? config.tokenLimit.value : Infinity;
    return buildSummaryRecordsContext(records, settings.recordTemplate, tokenBudget);
}

function renderRevisionBlock(block, { baseContent, messages }) {
    const commonValues = { sumiCurrentSummary: baseContent };

    if (block.kind === BLOCK_KINDS.CURRENT_SUMMARY) {
        return renderDataBlock(block, 'sumiCurrentSummary', baseContent);
    }
    if (block.kind === BLOCK_KINDS.REVISION_MESSAGES) {
        return messages
            .filter(message => ['user', 'assistant'].includes(message.role) && String(message.text || '').trim())
            .map(message => renderTemplate(block.content, {
                sumiRevisionRole: message.role,
                sumiRevisionMessage: message.text,
            }))
            .filter(content => content.trim())
            .join('\n\n');
    }
    return renderTemplate(block.content, commonValues);
}

function renderSummaryMessages(template, { messages, startId, endId }, context) {
    return messages
        .filter(({ message }) => message
            && (!message.is_system || isMessageAutoHiddenBySummarizer(message))
            && String(message.mes || '').trim())
        .map(({ id, message }) => {
            const fallbackName = message.is_user ? context.name1 : context.name2;
            return renderTemplate(template, {
                sumiStartId: startId,
                sumiEndId: endId,
                sumiMessageId: id,
                sumiMessageName: message.name || fallbackName || 'Unknown',
                sumiMessageContent: message.mes,
            });
        })
        .filter(content => content.trim())
        .join('\n\n');
}

function renderDataBlock(block, macroName, value, extraValues = {}) {
    const content = String(value || '').trim();
    if (!content) return '';
    return renderTemplate(block.content, { ...extraValues, [macroName]: content });
}

function renderTemplate(template, values = {}) {
    let content = substituteParams(String(template || ''));
    for (const [name, value] of Object.entries(values)) {
        content = content.replaceAll(`{{${name}}}`, String(value ?? ''));
    }
    return content;
}

async function getWorldInfoContent(chunk) {
    const context = SillyTavern.getContext();
    const character = context.characters?.[context.characterId] || {};
    const chatForWorldInfo = chunk.messages
        .map(({ message }) => message)
        .filter(message => message
            && (!message.is_system || isMessageAutoHiddenBySummarizer(message))
            && message.mes)
        .map(message => world_info_include_names ? `${message.name}: ${message.mes}` : message.mes)
        .reverse();
    const result = await getWorldInfoPrompt(chatForWorldInfo, context.maxContext, true, {
        personaDescription: context.powerUserSettings?.persona_description || '',
        characterDescription: character.description || '',
        characterPersonality: character.personality || '',
        characterDepthPrompt: character.data?.extensions?.depth_prompt?.prompt || '',
        scenario: context.chatMetadata?.scenario || character.scenario || '',
        creatorNotes: character.creator_notes || '',
        trigger: 'quiet',
    });

    return [
        result.worldInfoBefore,
        result.worldInfoAfter,
        ...(result.WIDepthEntries || []).flatMap(entry => entry.entries || []),
        ...(result.ANBeforeEntries || []),
        ...(result.ANAfterEntries || []),
        ...Object.values(result.outletEntries || {}).flat(),
    ].filter(Boolean).join('\n');
}
