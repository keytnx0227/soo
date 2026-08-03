import { substituteParams } from '../../../../script.js';
import { getWorldInfoPrompt, world_info_include_names } from '../../../world-info.js';
import { BLOCK_KINDS, getActivePreset, PROMPT_TYPES } from './settings.js';

export async function buildSummaryPrompt({ messages, startId, endId }) {
    const preset = getActivePreset(PROMPT_TYPES.SUMMARY);
    const parts = [];

    for (const block of preset.blocks.filter(block => block.enabled)) {
        const content = await renderSummaryBlock(block, { messages, startId, endId });
        if (content.trim()) parts.push(content.trim());
    }

    return parts.join('\n\n');
}

export async function buildRevisionPrompt({ baseContent, messages }) {
    const preset = getActivePreset(PROMPT_TYPES.REVISION);
    const parts = [];

    for (const block of preset.blocks.filter(block => block.enabled)) {
        let content = '';
        if (block.kind === BLOCK_KINDS.CURRENT_SUMMARY) {
            content = `<Current Summary>\n${baseContent}\n</Current Summary>`;
        } else if (block.kind === BLOCK_KINDS.REVISION_HISTORY) {
            content = buildRevisionHistory(messages);
        } else if (block.kind === BLOCK_KINDS.EDITABLE) {
            content = substituteParams(block.content || '');
        } else {
            content = block.content || '';
        }
        if (content.trim()) parts.push(content.trim());
    }

    return parts.join('\n\n');
}

function buildRevisionHistory(messages) {
    const transcript = messages
        .filter(message => ['user', 'assistant'].includes(message.role) && String(message.text || '').trim())
        .map(message => {
            const tag = message.role === 'user' ? 'UserFeedback' : 'AssistantRevision';
            return `<${tag}>\n${message.text}\n</${tag}>`;
        })
        .join('\n\n');

    return transcript ? `<Revision Conversation>\n${transcript}\n</Revision Conversation>` : '';
}

async function renderSummaryBlock(block, chunk) {
    switch (block.kind) {
        case BLOCK_KINDS.CHARACTER:
            return buildCharacterInformation();
        case BLOCK_KINDS.WORLD_INFO:
            return await buildWorldInfo();
        case BLOCK_KINDS.SUMMARY_TARGET:
            return buildSummaryTarget(chunk);
        case BLOCK_KINDS.EDITABLE:
            return substituteParams(block.content || '');
        default:
            return block.content || '';
    }
}

function buildCharacterInformation() {
    const context = SillyTavern.getContext();
    const character = context.characters?.[context.characterId] || {};
    const persona = context.powerUserSettings?.persona_description || '';
    const characterParts = [
        character.description ? `## ${context.name2 || character.name || '{{char}}'} Profile\n\n${character.description}` : '',
        character.personality ? `## Personality\n\n${character.personality}` : '',
        character.scenario ? `## Scenario\n\n${character.scenario}` : '',
        persona ? `## ${context.name1 || '{{user}}'} Profile\n\n${persona}` : '',
    ].filter(Boolean);

    return characterParts.length
        ? ['<Character Information>', ...characterParts, '</Character Information>'].join('\n\n')
        : '';
}

function buildSummaryTarget({ messages, startId, endId }) {
    const context = SillyTavern.getContext();
    const transcript = messages
        .filter(({ message }) => message && !message.is_system && String(message.mes || '').trim())
        .map(({ id, message }) => {
            const fallbackName = message.is_user ? context.name1 : context.name2;
            return `#${id} ${message.name || fallbackName || 'Unknown'}: ${message.mes}`;
        })
        .join('\n\n');

    if (!transcript) return '';
    return `<Summary Target range="#${startId} ~ #${endId}">\n${transcript}\n</Summary Target>`;
}

async function buildWorldInfo() {
    const context = SillyTavern.getContext();
    const messages = Array.isArray(context.chat) ? context.chat : [];
    const character = context.characters?.[context.characterId] || {};
    const chatForWorldInfo = messages
        .filter(message => message && !message.is_system && message.mes)
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
    const parts = [
        result.worldInfoBefore,
        result.worldInfoAfter,
        ...(result.WIDepthEntries || []).flatMap(entry => entry.entries || []),
        ...(result.ANBeforeEntries || []),
        ...(result.ANAfterEntries || []),
        ...Object.values(result.outletEntries || {}).flat(),
    ].filter(Boolean);

    return parts.length ? `<World Info>\n${parts.join('\n')}\n</World Info>` : '';
}
