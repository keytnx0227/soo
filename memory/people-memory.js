const REPLACE_FIELDS = Object.freeze(['roles', 'affiliations', 'personalityTraits', 'speechPatterns']);

export function buildPeopleMemoryPromptContext(people) {
    return JSON.stringify(people.map(person => ({
        id: person.id,
        name: person.name,
        aliases: person.aliases,
        facts: person.facts,
        roles: person.roles,
        affiliations: person.affiliations,
        personalityTraits: person.personalityTraits,
        speechPatterns: person.speechPatterns,
        lastKnownState: person.lastKnownState,
        relationships: person.relationships.map(relationship => ({
            targetId: relationship.targetId,
            targetName: relationship.targetName,
            relationship: relationship.relationship,
            feelings: relationship.feelings,
        })),
    })), null, 2);
}

export function derivePeopleAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.people)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
            || left.startId - right.startId
            || left.endId - right.endId);
    const peopleById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = { startId: Number(record.startId), endId: Number(record.endId) };
        const updates = record.structuredSummary.data.memoryUpdates.people;
        const created = Array.isArray(updates.created) ? updates.created : [];
        const pendingRelationships = [];

        created.forEach((proposal, index) => {
            const id = createStablePersonId(record.id, index);
            const person = createPersonEntry(id, proposal, range, record.id);
            peopleById.set(id, person);
            pendingRelationships.push({ person, relationships: proposal.relationships || [] });
        });

        for (const { person, relationships } of pendingRelationships) {
            applyRelationshipUpdates(person, relationships, range, peopleById);
        }

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
        aliases: dedupeStrings(proposal.aliases),
        facts: dedupeStrings(proposal.facts),
        roles: dedupeStrings(proposal.roles),
        affiliations: dedupeStrings(proposal.affiliations),
        personalityTraits: dedupeStrings(proposal.personalityTraits),
        speechPatterns: dedupeStrings(proposal.speechPatterns),
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
    person._valueSources.facts = createValueSources(person.facts, range);
    for (const field of ['name', ...REPLACE_FIELDS, 'lastKnownState.location', 'lastKnownState.physicalCondition']) {
        person._sources[field] = { ...range };
    }
    return person;
}

function applyPersonUpdate(person, update, range, sourceRecordId, peopleById) {
    let changed = false;
    const aliases = dedupeStrings(update.append?.aliases);
    const facts = dedupeStrings(update.append?.facts);
    changed = appendUniqueTracked(person.aliases, person._valueSources.aliases, aliases, range) || changed;
    changed = appendUniqueTracked(person.facts, person._valueSources.facts, facts, range) || changed;

    const replace = update.replace || {};
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
        person[field] = dedupeStrings(replace[field]);
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

function applyRelationshipUpdates(person, updates, range, peopleById) {
    if (!Array.isArray(updates)) return false;
    let changed = false;
    for (const update of updates) {
        const resolvedTargetId = resolveTargetId(update, peopleById);
        const key = resolvedTargetId ? `id:${resolvedTargetId}` : `name:${normalizeKey(update.targetName)}`;
        if (!key || key === 'name:') continue;
        const previousSource = person._relationshipSources[key];
        if (previousSource && previousSource.endId > range.endId) continue;

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
    return !previous || range.endId >= previous.endId;
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

function normalizeKey(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function newerRange(left, right) {
    return right.endId >= left.endId ? { ...right } : { ...left };
}

function createStablePersonId(recordId, index) {
    const source = `${recordId}:${index}`;
    let hash = 2166136261;
    for (let position = 0; position < source.length; position += 1) {
        hash ^= source.charCodeAt(position);
        hash = Math.imul(hash, 16777619);
    }
    return `person-${(hash >>> 0).toString(36)}`;
}

function toPublicPerson(person) {
    const { _sources, _valueSources, _relationshipSources, ...publicPerson } = person;
    return structuredClone({
        ...publicPerson,
        provenance: {
            fields: _sources,
            values: _valueSources,
        },
    });
}
