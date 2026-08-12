import { substituteParams } from '../../../../../script.js';
import { getWorldInfoPrompt, world_info_include_names } from '../../../../world-info.js';
import { isMessageAutoHiddenBySummarizer } from '../visibility/message-visibility-state.js';
import {
    buildCompressionJsonContract,
} from '../summary/compression-format.js';
import {
    BLOCK_KINDS,
    getActivePreset,
    getSettings,
    PROMPT_TYPES,
    SUMMARY_EXTRACTION_RULE_DEFINITIONS,
} from '../core/settings.js';
import { buildSummaryRecordsContext, withWorldInfoInjectionSuppressed } from '../summary/summary-context.js';
import { getCompressionMode, getSummaryRecords } from '../summary/summary-store.js';
import { buildPeopleMemoryPromptContext } from '../memory/people-memory-service.js';
import { buildItemMemoryPromptContext } from '../memory/item-memory-service.js';
import { buildCommitmentMemoryPromptContext } from '../memory/commitment-memory-service.js';
import { buildEventMemoryPromptContext } from '../memory/event-memory-service.js';
import { buildWorldMemoryPromptContext } from '../memory/world-memory-service.js';
import {
    buildAtlasReviewJsonContract,
    buildSummaryJsonContract,
    getEnabledMemorySections,
    getEnabledSummarySections,
    getSummarySectionKeyForKind,
    getSummaryLanguageInstruction,
} from '../summary/summary-format.js';

const ATLAS_REVIEW_PROMPT_DEFINITIONS = Object.freeze({
    people: { kind: BLOCK_KINDS.PEOPLE_MEMORY, macro: 'sumiPeopleMemory', buildContext: buildPeopleMemoryPromptContext },
    items: { kind: BLOCK_KINDS.ITEM_MEMORY, macro: 'sumiItemMemory', buildContext: buildItemMemoryPromptContext },
    commitments: { kind: BLOCK_KINDS.COMMITMENT_MEMORY, macro: 'sumiCommitmentMemory', buildContext: buildCommitmentMemoryPromptContext },
    events: { kind: BLOCK_KINDS.EVENT_MEMORY, macro: 'sumiEventMemory', buildContext: buildEventMemoryPromptContext },
    world: { kind: BLOCK_KINDS.WORLD_MEMORY, macro: 'sumiWorldMemory', buildContext: buildWorldMemoryPromptContext },
});

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

export function buildAtlasReviewPrompt(
    { messages, startId, endId },
    category,
    {
        mode = 'quick',
        projectionOptions = {},
        currentRecordContribution = null,
    } = {},
) {
    const definition = ATLAS_REVIEW_PROMPT_DEFINITIONS[category];
    if (!definition) throw new Error(`지원하지 않는 도감 종류입니다: ${category}`);
    const preset = getActivePreset(PROMPT_TYPES.SUMMARY);
    const mainBlock = preset.blocks.find(block => block.id === 'summary-main')
        || preset.blocks.find(block => !block.kind);
    const messageBlock = preset.blocks.find(block => block.kind === BLOCK_KINDS.SUMMARY_MESSAGES);
    const memoryBlock = preset.blocks.find(block => block.kind === definition.kind);
    const extractionBlock = preset.blocks.find(block => block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES);
    if (!messageBlock) throw new Error('현재 요약 프리셋에서 요약 대상 메시지 포맷을 찾지 못했습니다.');

    const values = {
        sumiStartId: startId,
        sumiEndId: endId,
        sumiSummaryLanguageInstruction: getSummaryLanguageInstruction(getSettings().summarization.outputLanguage),
        sumiAtlasReviewJsonContract: buildAtlasReviewJsonContract(category, {
            includeCreatedSourceIds: mode === 'record' || Boolean(currentRecordContribution),
        }),
    };
    const target = renderSummaryMessages(messageBlock.content, { messages, startId, endId }, SillyTavern.getContext());
    const currentMemory = memoryBlock
        ? renderDataBlock(memoryBlock, definition.macro, definition.buildContext(projectionOptions), values)
        : '';
    const rule = String(extractionBlock?.config?.rules?.[category] || '').trim();
    const parts = [
        mainBlock ? renderTemplate(mainBlock.content, values) : '',
        mode === 'record' ? `# Record Atlas Replacement Review

Review only the selected atlas category for this one summary record. Return a complete replacement for this record's category contribution, not an incremental patch to the old contribution. The current atlas is the present-day source of truth. In created entries, copy each retained entry's exact sourceId from <Current Record Atlas Contribution>; use null only for genuinely new entries. Do not reuse a sourceId for a different identity. Updated entries must use exact current-atlas targetId values. Retain every valid created entry from the current record contribution; omit one only when the target messages show that it was incorrectly attributed to this record. Any omission will be shown to the user before approval. Return empty arrays when this record supports no contribution.` : `# Atlas Retrospective Review

Review only the selected atlas category using the messages inside <Atlas Review Target> as evidence. The current atlas is the present-day source of truth and is provided to resolve identity and prevent duplicates. Recover durable information that was previously missed, but never regress a current mutable snapshot to an older historical state merely because it appears in the review target. Create unmatched entries or update an exact existing targetId only when the target supports a useful durable addition or factual correction. Never delete an entry. Return empty created and updated arrays when no proposal is supported.`,
        values.sumiSummaryLanguageInstruction,
        `<Atlas Review Target range="#${startId} ~ #${endId}">\n${target}\n</Atlas Review Target>`,
        currentMemory,
        mode === 'quick' && currentRecordContribution
            ? 'This exact review range already has a replaceable prior contribution. Copy its sourceId for every retained created identity; use null only for genuinely new identities.'
            : '',
        currentRecordContribution
            ? mode === 'record'
                ? `<Current Record Atlas Contribution>\n${currentRecordContribution}\n</Current Record Atlas Contribution>`
                : `<Previous Review Contribution>\n${currentRecordContribution}\n</Previous Review Contribution>`
            : '',
        rule,
        values.sumiAtlasReviewJsonContract,
    ];
    return parts.map(part => String(part || '').trim()).filter(Boolean).join('\n\n');
}

function isSummaryBlockEnabled(block, sections) {
    if (block.kind === BLOCK_KINDS.PEOPLE_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).people;
    }
    if (block.kind === BLOCK_KINDS.ITEM_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).items;
    }
    if (block.kind === BLOCK_KINDS.COMMITMENT_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).commitments;
    }
    if (block.kind === BLOCK_KINDS.EVENT_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).events;
    }
    if (block.kind === BLOCK_KINDS.WORLD_MEMORY) {
        return getEnabledMemorySections(getSettings().summarization.memorySections).world;
    }
    const sectionKey = getSummarySectionKeyForKind(block.kind);
    return sectionKey ? Boolean(sections[sectionKey]) : block.enabled;
}

export async function buildRevisionPrompt({
    baseContent,
    structuredSourceContent = '',
    revisionOutputContract = '',
    summarySource = null,
    compressionSourceContent = '',
    messages,
}) {
    const preset = getActivePreset(PROMPT_TYPES.REVISION);
    const parts = [];
    const includeCompressionSources = Boolean(
        compressionSourceContent
        && preset.blocks.some(block => block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCES && block.enabled),
    );
    const includeSummarySource = Boolean(
        summarySource?.messages?.length
        && preset.blocks.some(block => block.kind === BLOCK_KINDS.REVISION_SUMMARY_MESSAGES && block.enabled),
    );

    for (const block of preset.blocks.filter(block => block.enabled)) {
        const content = renderRevisionBlock(block, {
            baseContent,
            structuredSourceContent,
            revisionOutputContract,
            summarySource,
            includeSummarySource,
            compressionSourceContent,
            includeCompressionSources,
            messages,
        });
        if (content.trim()) parts.push(content.trim());
    }

    return parts.join('\n\n');
}

export function buildCompressionPrompt(records, languageMode = getSettings().summarization.outputLanguage, mode = getCompressionMode()) {
    const preset = getActivePreset(PROMPT_TYPES.COMPRESSION);
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);
    const values = {
        sumiCompressionStartId: sourceRecords[0]?.startId ?? '',
        sumiCompressionEndId: sourceRecords.at(-1)?.endId ?? '',
        sumiCompressionSources: sourceRecords.map((record, index) => (
            `[Source ${index + 1} | #${record.startId}-#${record.endId}]\n${String(record.content || '').trim()}`
        )).join('\n\n'),
        sumiSummaryLanguageInstruction: getSummaryLanguageInstruction(languageMode),
        sumiCompressionJsonContract: buildCompressionJsonContract({
            segmented: mode === 'segmented',
            sourceCount: sourceRecords.length,
        }),
    };

    return preset.blocks
        .filter(block => block.enabled)
        .map(block => renderCompressionBlock(block, values))
        .filter(content => content.trim())
        .join('\n\n');
}

function renderCompressionBlock(block, values) {
    if (block.kind === BLOCK_KINDS.COMPRESSION_SOURCES) {
        return renderDataBlock(block, 'sumiCompressionSources', values.sumiCompressionSources, values);
    }
    return renderTemplate(block.content, values);
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
        case BLOCK_KINDS.COMMITMENT_MEMORY:
            return renderDataBlock(block, 'sumiCommitmentMemory', buildCommitmentMemoryPromptContext(), commonValues);
        case BLOCK_KINDS.EVENT_MEMORY:
            return renderDataBlock(block, 'sumiEventMemory', buildEventMemoryPromptContext(), commonValues);
        case BLOCK_KINDS.WORLD_MEMORY:
            return renderDataBlock(block, 'sumiWorldMemory', buildWorldMemoryPromptContext(), commonValues);
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
        .filter(record => !record.compressedBy && record.endId < startId)
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);

    if (config.countLimit.enabled) records = records.slice(-config.countLimit.value);

    const settings = getSettings().summarization;
    const tokenBudget = config.tokenLimit.enabled ? config.tokenLimit.value : Infinity;
    return buildSummaryRecordsContext(records, settings.recordTemplate, tokenBudget);
}

function renderRevisionBlock(block, {
    baseContent,
    structuredSourceContent,
    revisionOutputContract,
    summarySource,
    includeSummarySource,
    compressionSourceContent,
    includeCompressionSources,
    messages,
}) {
    const commonValues = {
        sumiCurrentSummary: structuredSourceContent || baseContent,
        sumiRevisionJsonContract: revisionOutputContract,
        sumiStartId: summarySource?.startId ?? '',
        sumiEndId: summarySource?.endId ?? '',
        sumiCompressionRevisionSources: compressionSourceContent,
    };

    if (block.kind === BLOCK_KINDS.CURRENT_SUMMARY) {
        return renderDataBlock(block, 'sumiCurrentSummary', structuredSourceContent || baseContent, commonValues);
    }
    if (block.kind === BLOCK_KINDS.REVISION_OUTPUT_CONTRACT) {
        return renderDataBlock(block, 'sumiRevisionJsonContract', revisionOutputContract, commonValues);
    }
    if (block.kind === BLOCK_KINDS.REVISION_SUMMARY_MESSAGES) {
        return includeSummarySource
            ? renderSummaryMessages(block.content, summarySource, SillyTavern.getContext())
            : '';
    }
    if (block.kind === BLOCK_KINDS.REVISION_SUMMARY_SOURCE_SEPARATOR) {
        return includeSummarySource ? renderTemplate(block.content, commonValues) : '';
    }
    if (block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCES) {
        return includeCompressionSources
            ? renderDataBlock(block, 'sumiCompressionRevisionSources', compressionSourceContent, commonValues)
            : '';
    }
    if (block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCE_SEPARATOR) {
        return includeCompressionSources ? renderTemplate(block.content, commonValues) : '';
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
    const result = await withWorldInfoInjectionSuppressed(() => getWorldInfoPrompt(
        chatForWorldInfo,
        context.maxContext,
        true,
        {
            personaDescription: context.powerUserSettings?.persona_description || '',
            characterDescription: character.description || '',
            characterPersonality: character.personality || '',
            characterDepthPrompt: character.data?.extensions?.depth_prompt?.prompt || '',
            scenario: context.chatMetadata?.scenario || character.scenario || '',
            creatorNotes: character.creator_notes || '',
            trigger: 'quiet',
        },
    ));

    return [
        result.worldInfoBefore,
        result.worldInfoAfter,
        ...(result.WIDepthEntries || []).flatMap(entry => entry.entries || []),
        ...(result.ANBeforeEntries || []),
        ...(result.ANAfterEntries || []),
        ...Object.values(result.outletEntries || {}).flat(),
    ].filter(Boolean).join('\n');
}
