const CUMULATIVE_FIELDS = Object.freeze({
    people: new Set(['aliases']),
    items: new Set(['aliases', 'facts']),
    commitments: new Set(['facts']),
    events: new Set(),
});

const PEOPLE_FIELDS = new Set([
    'name',
    'provisional',
    'aliases',
    'role',
    'age',
    'occupation',
    'appearance',
    'affiliations',
    'traits',
    'voice',
    'lastKnownState.location',
    'lastKnownState.physicalCondition',
    'relationships',
]);

export function applyAtlasCorrections(raw, corrections) {
    const orphanCorrections = { people: [], items: [], commitments: [], events: [] };
    const people = applyCategoryCorrections('people', raw.people, corrections.people, orphanCorrections.people);
    const items = applyCategoryCorrections('items', raw.items, corrections.items, orphanCorrections.items);
    const commitments = applyCategoryCorrections('commitments', raw.commitments, corrections.commitments, orphanCorrections.commitments);
    const events = applyCategoryCorrections('events', raw.events, corrections.events, orphanCorrections.events)
        .map(event => event.importance === 'minor' ? { ...event, shift: null } : event);
    return {
        ...raw,
        people: people.filter(entity => !entity.excluded),
        items: items.filter(entity => !entity.excluded),
        commitments: commitments.filter(entity => !entity.excluded),
        events: events.filter(entity => !entity.excluded),
        excluded: {
            people: people.filter(entity => entity.excluded),
            items: items.filter(entity => entity.excluded),
            commitments: commitments.filter(entity => entity.excluded),
            events: events.filter(entity => entity.excluded),
        },
        orphanCorrections,
    };
}

function applyCategoryCorrections(category, entities, correctionMap, orphanCorrections) {
    const entitiesById = new Map(entities.map(entity => [entity.id, entity]));
    for (const entityId of Object.keys(correctionMap || {})) {
        if (!entitiesById.has(entityId)) orphanCorrections.push(entityId);
    }
    return entities.map(entity => {
        const sourceFields = correctionMap?.[entity.id]?.fields || {};
        const fields = category === 'people'
            ? normalizePeopleCorrectionFields(sourceFields)
            : category === 'events'
                ? normalizeEventCorrectionFields(sourceFields)
                : sourceFields;
        const corrected = structuredClone(entity);
        corrected.manualCorrections = structuredClone(fields);
        corrected.excluded = Boolean(correctionMap?.[entity.id]?.excluded);
        if (!Object.keys(fields).length) return corrected;
        const handledFields = category === 'commitments'
            ? applyCommitmentStatusCorrection(corrected, fields)
            : new Set();
        for (const [path, correction] of Object.entries(fields)) {
            if (handledFields.has(path)) continue;
            applyFieldCorrection(category, corrected, path, correction);
        }
        return corrected;
    });
}

function normalizeEventCorrectionFields(fields) {
    const normalized = { ...fields };
    if (normalized.importance) {
        normalized.importance = {
            ...normalized.importance,
            value: normalizeEventImportance(normalized.importance.value),
        };
    }
    if (!Object.hasOwn(normalized, 'shift') && Object.hasOwn(normalized, 'shifts')) {
        const correction = normalized.shifts;
        normalized.shift = {
            ...correction,
            value: Array.isArray(correction.value) ? correction.value[0] || null : correction.value || null,
        };
    }
    delete normalized.shifts;
    return normalized;
}

function normalizeEventImportance(value) {
    if (value === 'major' || value === 'turning_point') return 'major';
    return 'minor';
}

function normalizePeopleCorrectionFields(fields) {
    const normalized = {};
    for (const [path, correction] of Object.entries(fields || {})) {
        const mappedPath = {
            roles: 'role',
            personalityTraits: 'traits',
            speechPatterns: 'voice',
        }[path] || path;
        if (!PEOPLE_FIELDS.has(mappedPath) || Object.hasOwn(normalized, mappedPath)) continue;
        const value = ['role', 'voice'].includes(mappedPath) && Array.isArray(correction.value)
            ? correction.value.map(item => String(item || '').trim()).filter(Boolean).join('; ') || null
            : correction.value;
        normalized[mappedPath] = { ...correction, value };
    }
    return normalized;
}

function applyCommitmentStatusCorrection(commitment, fields) {
    const statusCorrection = fields.status;
    if (!statusCorrection) return new Set();
    const reasonCorrection = fields.statusReason;
    let status = statusCorrection.value;
    let reason = reasonCorrection ? reasonCorrection.value : commitment.statusReason;
    let latestAcceptedRange = statusCorrection.appliedThroughId;
    const futureEvents = statusCorrection.locked ? [] : (commitment.provenance?.statusHistory || [])
        .filter(event => Number(event.range?.endId) > statusCorrection.appliedThroughId)
        .sort((left, right) => Number(left.range?.endId) - Number(right.range?.endId));

    for (const event of futureEvents) {
        status = event.status;
        if (event.statusReason !== null && event.statusReason !== undefined) reason = event.statusReason;
        latestAcceptedRange = Number(event.range?.endId) || latestAcceptedRange;
    }

    if (reasonCorrection) {
        const futureReasonApplied = !reasonCorrection.locked && latestAcceptedRange > reasonCorrection.appliedThroughId;
        if (reasonCorrection.locked || !futureReasonApplied) reason = reasonCorrection.value;
    }
    commitment.status = status;
    commitment.statusReason = reason;
    return new Set(reasonCorrection ? ['status', 'statusReason'] : ['status']);
}

function applyFieldCorrection(category, entity, path, correction) {
    if (CUMULATIVE_FIELDS[category].has(path)) {
        const laterValues = correction.locked ? [] : (entity.provenance?.values?.[path] || [])
            .filter(source => Number(source.range?.endId) > correction.appliedThroughId)
            .map(source => source.value);
        setPath(entity, path, dedupeStrings([...(Array.isArray(correction.value) ? correction.value : []), ...laterValues]));
        return;
    }

    if (path === 'relationships') {
        setPath(entity, path, mergeRelationships(correction.value, entity.relationships, correction));
        return;
    }

    const sourceEndId = Number(entity.provenance?.fields?.[path]?.endId) || 0;
    if (correction.locked || sourceEndId <= correction.appliedThroughId) {
        setPath(entity, path, structuredClone(correction.value));
    }
}

function mergeRelationships(manualValue, automaticValue, correction) {
    const result = Array.isArray(manualValue) ? structuredClone(manualValue) : [];
    if (correction.locked) return result;
    const later = (Array.isArray(automaticValue) ? automaticValue : [])
        .filter(item => Number(item.lastObservedRange?.endId) > correction.appliedThroughId);
    for (const relationship of later) {
        const key = relationshipKey(relationship);
        const index = result.findIndex(item => relationshipKey(item) === key);
        if (index >= 0) result[index] = structuredClone(relationship);
        else result.push(structuredClone(relationship));
    }
    return result;
}

function relationshipKey(value) {
    return value?.targetId ? `id:${value.targetId}` : `name:${String(value?.targetName || '').toLocaleLowerCase()}`;
}

function setPath(target, path, value) {
    const segments = path.split('.');
    let parent = target;
    for (const segment of segments.slice(0, -1)) {
        if (!parent[segment] || typeof parent[segment] !== 'object') parent[segment] = {};
        parent = parent[segment];
    }
    parent[segments.at(-1)] = value;
}

function dedupeStrings(values) {
    const known = new Set();
    return values.map(value => String(value || '').trim()).filter(value => {
        const key = value.toLocaleLowerCase();
        if (!key || known.has(key)) return false;
        known.add(key);
        return true;
    });
}
