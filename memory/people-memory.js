import {
    canApplyAtlasReplacement,
    compareAtlasSourceRecords,
    getAtlasSourceRange,
} from './atlas-source-record.js';
import { getCreatedAtlasEntityId } from './atlas-entity-id.js';

const REPLACE_FIELDS = Object.freeze([
    'provisional',
    'role',
    'age',
    'occupation',
    'appearance',
    'affiliations',
    'traits',
    'voice',
]);
const LIST_FIELDS = new Set(['affiliations', 'traits']);

export function buildPeopleMemoryPromptContext(people) {
    return JSON.stringify(people.map(compactPersonForPrompt), null, 2);
}

function compactPersonForPrompt(person) {
    const result = { id: person.id, name: person.name };
    if (person.provisional) result.provisional = true;
    for (const field of ['role', 'age', 'occupation', 'appearance', 'voice']) {
        if (person[field]) result[field] = person[field];
    }
    for (const field of ['aliases', 'affiliations', 'traits']) {
        if (person[field]?.length) result[field] = person[field];
    }
    const lastKnownState = Object.fromEntries(Object.entries(person.lastKnownState || {})
        .filter(([, value]) => value));
    if (Object.keys(lastKnownState).length) result.lastKnownState = lastKnownState;
    const relationships = (person.relationships || []).map(relationship => {
        const item = {};
        if (relationship.targetId) item.targetId = relationship.targetId;
        if (relationship.targetName) item.targetName = relationship.targetName;
        if (relationship.relationship?.length) item.relationship = relationship.relationship;
        if (relationship.feelings?.length) item.feelings = relationship.feelings;
        return item;
    }).filter(item => Object.keys(item).length);
    if (relationships.length) result.relationships = relationships;
    return result;
}

export function derivePeopleAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.people)
        .sort(compareAtlasSourceRecords);
    const peopleById = new Map();
    const skippedUpdates = [];
    const pendingRelationships = [];

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.people;
        const created = Array.isArray(updates.created) ? updates.created : [];

        created.forEach((proposal, index) => {
            const id = getCreatedAtlasEntityId('people', record.id, proposal, index);
            const person = createPersonEntry(id, proposal, range, record.id);
            peopleById.set(id, person);
            pendingRelationships.push({ person, relationships: proposal.relationships || [], range });
        });
    }

    for (const { person, relationships, range } of pendingRelationships) {
        applyRelationshipUpdates(person, relationships, range, peopleById);
    }

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.people;
        for (const update of Array.isArray(updates.updated) ? updates.updated : []) {
            const person = peopleById.get(String(update.targetId));
            if (!person) {
                skippedUpdates.push({
                    sourceRecordId: record.id,
                    range,
                    targetId: String(update.targetId || ''),
                    reason: '현재 도감에서 대상 ID를 찾지 못했습니다.',
                });
                continue;
            }
            applyPersonUpdate(person, update, range, record.id, peopleById);
        }
    }

    return {
        people: [...peopleById.values()].map(toPublicPerson).sort((left, right) => left.name.localeCompare(right.name)),
        skippedUpdates,
    };
}

function createPersonEntry(id, proposal, range, sourceRecordId) {
    const person = {
        id,
        name: String(proposal.name),
        provisional: Boolean(proposal.provisional),
        aliases: dedupeStrings(proposal.aliases),
        role: normalizeLegacyScalar(proposal.role, proposal.roles),
        age: normalizeScalar(proposal.age),
        occupation: normalizeScalar(proposal.occupation),
        appearance: normalizeScalar(proposal.appearance),
        affiliations: dedupeStrings(proposal.affiliations),
        traits: dedupeStrings(proposal.traits ?? proposal.personalityTraits),
        voice: normalizeLegacyScalar(proposal.voice, proposal.speechPatterns),
        lastKnownState: {
            location: proposal.lastKnownState?.location || null,
            physicalCondition: proposal.lastKnownState?.physicalCondition || null,
        },
        relationships: [],
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
        _valueSources: {},
        _relationshipSources: {},
    };
    person._valueSources.aliases = createValueSources(person.aliases, range);
    for (const field of ['name', ...REPLACE_FIELDS, 'lastKnownState.location', 'lastKnownState.physicalCondition']) {
        person._sources[field] = { ...range };
    }
    return person;
}

function applyPersonUpdate(person, update, range, sourceRecordId, peopleById) {
    let changed = false;
    const aliases = dedupeStrings(update.append?.aliases);
    changed = appendUniqueTracked(person.aliases, person._valueSources.aliases, aliases, range) || changed;

    const replace = normalizePersonReplace(update.replace);
    if (Object.hasOwn(replace, 'name') && replace.name && canReplace(person, 'name', range)) {
        if (person.name !== replace.name) {
            appendUniqueTracked(person.aliases, person._valueSources.aliases, [person.name], range);
        }
        person.name = String(replace.name);
        person._sources.name = { ...range };
        changed = true;
    }
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(person, field, range)) continue;
        person[field] = field === 'provisional'
            ? Boolean(replace[field])
            : LIST_FIELDS.has(field)
                ? dedupeStrings(replace[field])
                : normalizeScalar(replace[field]);
        person._sources[field] = { ...range };
        changed = true;
    }
    if (Object.hasOwn(replace, 'lastKnownState')) {
        for (const field of ['location', 'physicalCondition']) {
            const sourceKey = `lastKnownState.${field}`;
            if (!Object.hasOwn(replace.lastKnownState || {}, field) || !canReplace(person, sourceKey, range)) continue;
            person.lastKnownState[field] = replace.lastKnownState[field] || null;
            person._sources[sourceKey] = { ...range };
            changed = true;
        }
    }
    changed = applyRelationshipUpdates(person, update.relationshipUpdates, range, peopleById) || changed;

    if (changed) {
        person.lastUpdatedRange = newerRange(person.lastUpdatedRange, range);
        appendUnique(person.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function normalizePersonReplace(value) {
    const source = value && typeof value === 'object' ? value : {};
    const replace = {};
    for (const field of ['name', 'provisional', 'age', 'occupation', 'appearance', 'affiliations']) {
        if (Object.hasOwn(source, field)) replace[field] = source[field];
    }
    if (Object.hasOwn(source, 'role') || Object.hasOwn(source, 'roles')) {
        replace.role = normalizeLegacyScalar(source.role, source.roles);
    }
    if (Object.hasOwn(source, 'traits') || Object.hasOwn(source, 'personalityTraits')) {
        replace.traits = source.traits ?? source.personalityTraits;
    }
    if (Object.hasOwn(source, 'voice') || Object.hasOwn(source, 'speechPatterns')) {
        replace.voice = normalizeLegacyScalar(source.voice, source.speechPatterns);
    }
    if (Object.hasOwn(source, 'lastKnownState')) replace.lastKnownState = source.lastKnownState;
    return replace;
}

function applyRelationshipUpdates(person, updates, range, peopleById) {
    if (!Array.isArray(updates)) return false;
    let changed = false;
    for (const update of updates) {
        const resolvedTargetId = resolveTargetId(update, peopleById);
        const key = resolvedTargetId ? `id:${resolvedTargetId}` : `name:${normalizeKey(update.targetName)}`;
        if (!key || key === 'name:') continue;
        const previousSource = person._relationshipSources[key];
        if (!canApplyAtlasReplacement(previousSource, range)) continue;

        const existingIndex = person.relationships.findIndex(item => relationshipKey(item) === key);
        const relationship = {
            targetId: resolvedTargetId,
            targetName: update.targetName || peopleById.get(resolvedTargetId)?.name || null,
            relationship: dedupeStrings(update.relationship),
            feelings: dedupeStrings(update.feelings),
            lastObservedRange: { ...range },
        };
        if (existingIndex >= 0) person.relationships[existingIndex] = relationship;
        else person.relationships.push(relationship);
        person._relationshipSources[key] = { ...range };
        changed = true;
    }
    return changed;
}

function resolveTargetId(update, peopleById) {
    const suppliedId = String(update?.targetId || '').trim();
    if (suppliedId && peopleById.has(suppliedId)) return suppliedId;
    const targetKey = normalizeKey(update?.targetName);
    if (!targetKey) return null;
    const matches = [...peopleById.values()].filter(person => (
        normalizeKey(person.name) === targetKey
        || person.aliases.some(alias => normalizeKey(alias) === targetKey)
    ));
    return matches.length === 1 ? matches[0].id : null;
}

function canReplace(person, field, range) {
    const previous = person._sources[field];
    return canApplyAtlasReplacement(previous, range);
}

function relationshipKey(relationship) {
    return relationship.targetId ? `id:${relationship.targetId}` : `name:${normalizeKey(relationship.targetName)}`;
}

function appendUnique(target, values) {
    const known = new Set(target.map(normalizeKey));
    let changed = false;
    for (const value of values) {
        const key = normalizeKey(value);
        if (!key || known.has(key)) continue;
        target.push(value);
        known.add(key);
        changed = true;
    }
    return changed;
}

function appendUniqueTracked(target, sources, values, range) {
    const known = new Set(target.map(normalizeKey));
    let changed = false;
    for (const value of values) {
        const key = normalizeKey(value);
        if (!key || known.has(key)) continue;
        target.push(value);
        sources.push({ value, range: { ...range } });
        known.add(key);
        changed = true;
    }
    return changed;
}

function createValueSources(values, range) {
    return values.map(value => ({ value, range: { ...range } }));
}

function dedupeStrings(values) {
    const result = [];
    appendUnique(result, Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(Boolean) : []);
    return result;
}

function normalizeScalar(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function normalizeLegacyScalar(value, legacyValues) {
    const normalized = normalizeScalar(value);
    if (normalized) return normalized;
    const legacy = dedupeStrings(legacyValues);
    return legacy.length ? legacy.join('; ') : null;
}

function normalizeKey(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function newerRange(left, right) {
    return right.endId >= left.endId ? { ...right } : { ...left };
}

function toPublicPerson(person) {
    const { _sources, _valueSources, ...publicPerson } = person;
    delete publicPerson._relationshipSources;
    return structuredClone({
        ...publicPerson,
        provenance: {
            fields: _sources,
            values: _valueSources,
        },
    });
}
