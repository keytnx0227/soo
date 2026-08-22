import { translate } from '../../../../../scripts/extensions/translate/index.js';
import { getStringHash } from '../../../../../scripts/utils.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import { getAtlasTranslation, saveAtlasTranslation } from '../memory/atlas-metadata.js';
import { getAtlasProjection } from '../memory/atlas-projection-service.js';
import { formatFeelings } from '../memory/people-feelings.js';

const CATEGORY_COLLECTIONS = Object.freeze({
    people: 'people',
    items: 'items',
    commitments: 'commitments',
    events: 'events',
    world: 'world',
});

export async function translateAtlasEntity(category, entityId) {
    assertExtensionEnabled();
    const sourceChat = SillyTavern.getContext().chat;
    const entity = getEntity(category, entityId);
    if (!entity) throw new Error('번역할 도감 항목을 찾지 못했습니다.');

    const settings = getSettings().translation;
    const source = serializeAtlasEntity(category, entity);
    const content = await translate(source, settings.targetLanguage, settings.provider);
    if (!String(content || '').trim()) throw new Error('번역 결과가 비어 있습니다.');
    if (SillyTavern.getContext().chat !== sourceChat) {
        throw new Error('번역 중 채팅방이 변경되어 결과를 저장하지 않았습니다.');
    }

    return await saveAtlasTranslation(category, entityId, {
        content,
        sourceHash: createAtlasSourceHash(category, entity),
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
        translatedAt: new Date().toISOString(),
    });
}

export function getValidAtlasTranslation(category, entity, cachedTranslation = undefined) {
    const translation = cachedTranslation === undefined ? getAtlasTranslation(category, entity.id) : cachedTranslation;
    if (!translation || translation.sourceHash !== createAtlasSourceHash(category, entity)) return null;
    return translation;
}

export async function translateAllAtlasEntities({ onProgress, signal } = {}) {
    assertExtensionEnabled();
    const settings = getSettings().translation;
    const projection = getAtlasProjection();
    const allEntities = Object.entries(CATEGORY_COLLECTIONS).flatMap(([category, collection]) => (
        (projection[collection] || []).map(entity => ({ category, entity }))
    ));
    const targets = allEntities.filter(({ category, entity }) => {
        const translation = getAtlasTranslation(category, entity.id);
        return !translation
            || translation.sourceHash !== createAtlasSourceHash(category, entity)
            || translation.provider !== settings.provider
            || translation.targetLanguage !== settings.targetLanguage;
    });
    const failures = [];
    let translated = 0;

    for (let index = 0; index < targets.length; index += 1) {
        if (signal?.aborted) break;
        const target = targets[index];
        onProgress?.({ current: index + 1, total: targets.length, ...target });
        try {
            await translateAtlasEntity(target.category, target.entity.id);
            translated += 1;
        } catch (error) {
            failures.push({ ...target, error });
        }
    }

    return {
        translated,
        skipped: allEntities.length - targets.length,
        failures,
        total: allEntities.length,
        targetCount: targets.length,
        remaining: Math.max(0, targets.length - translated - failures.length),
        cancelled: Boolean(signal?.aborted),
    };
}

export function createAtlasSourceHash(category, entity) {
    return String(getStringHash(serializeAtlasEntity(category, entity)));
}

export function serializeAtlasEntity(category, entity) {
    const lines = [`# ${category === 'world'
        ? 'World Setting'
        : ['commitments', 'events'].includes(category) ? entity.title : entity.name}`];
    appendList(lines, 'aliases', entity.aliases);
    if (category === 'people') {
        if (entity.provisional) lines.push('- provisional: true');
        appendScalar(lines, 'role', entity.role);
        appendScalar(lines, 'age', entity.age);
        appendScalar(lines, 'occupation', entity.occupation);
        appendScalar(lines, 'appearance', entity.appearance);
        appendList(lines, 'affiliations', entity.affiliations);
        appendList(lines, 'traits', entity.traits);
        appendScalar(lines, 'voice', entity.voice);
        appendState(lines, entity.lastKnownState, {
            location: 'location',
            physicalCondition: 'physical condition',
        });
        if (entity.relationships?.length) {
            lines.push('- relationships:');
            for (const relationship of entity.relationships) {
                const target = relationship.targetName || relationship.targetId || 'unknown';
                const parts = [];
                if (relationship.relationship?.length) parts.push(`relationship: ${relationship.relationship.join(', ')}`);
                if (relationship.feelings?.length) parts.push(`feelings: ${formatFeelings(relationship.feelings).join(', ')}`);
                lines.push(`  - ${target}: ${parts.join('; ')}`);
            }
        }
    } else if (category === 'items') {
        appendList(lines, 'facts', entity.facts);
        appendList(lines, 'functions', entity.functions);
        appendState(lines, entity.lastKnownState, {
            owner: 'owner',
            holder: 'holder',
            location: 'location',
            condition: 'condition',
            status: 'status',
        });
    } else if (category === 'commitments') {
        lines.push(`- terms: ${entity.terms}`);
        if (entity.participants?.length) {
            lines.push(`- participants: ${entity.participants.map(participant => {
                const name = participant.personName || participant.personId || 'unknown';
                return participant.role ? `${name} (${participant.role})` : name;
            }).join('; ')}`);
        }
        appendList(lines, 'conditions', entity.conditions);
        if (entity.deadline) lines.push(`- deadline: ${entity.deadline}`);
        appendList(lines, 'facts', entity.facts);
        lines.push(`- status: ${entity.status}`);
        if (entity.statusReason) lines.push(`- status reason: ${entity.statusReason}`);
    } else if (category === 'events') {
        if (entity.date) lines.push(`- date: ${entity.date}`);
        if (entity.location) lines.push(`- location: ${entity.location}`);
        lines.push(`- summary: ${entity.summary}`);
        lines.push(`- importance: ${entity.importance}`);
        appendScalar(lines, 'shift', entity.shift);
    } else {
        appendList(lines, 'keys', entity.keys);
        lines.push(`- content: ${entity.content}`);
    }
    return lines.join('\n');
}

function getEntity(category, entityId) {
    const atlas = getAtlasProjection();
    const collection = category === 'people'
        ? atlas.people
        : category === 'items'
            ? atlas.items
            : category === 'commitments'
                ? atlas.commitments
                : category === 'events'
                    ? atlas.events
                    : atlas.world;
    return collection.find(entity => entity.id === entityId) || null;
}

function appendList(lines, label, values) {
    if (Array.isArray(values) && values.length) lines.push(`- ${label}: ${values.join('; ')}`);
}

function appendScalar(lines, label, value) {
    if (value) lines.push(`- ${label}: ${value}`);
}

function appendState(lines, state, labels) {
    const values = Object.entries(labels)
        .filter(([key]) => state?.[key])
        .map(([key, label]) => `${label}: ${state[key]}`);
    if (values.length) lines.push(`- last known state: ${values.join('; ')}`);
}
