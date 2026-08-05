const REPLACE_FIELDS = Object.freeze([
    'title',
    'date',
    'location',
    'summary',
    'importance',
    'shifts',
]);

export function buildEventMemoryPromptContext(events) {
    return JSON.stringify(events.map(event => ({
        id: event.id,
        title: event.title,
        date: event.date,
        location: event.location,
        summary: event.summary,
        importance: event.importance,
        shifts: event.shifts,
    })), null, 2);
}

export function deriveEventAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.events)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
            || left.startId - right.startId
            || left.endId - right.endId);
    const eventsById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = { startId: Number(record.startId), endId: Number(record.endId) };
        const updates = record.structuredSummary.data.memoryUpdates.events;
        (Array.isArray(updates.created) ? updates.created : []).forEach((proposal, index) => {
            const id = createStableEventId(record.id, index);
            eventsById.set(id, createEventEntry(id, proposal, range, record.id));
        });

        for (const update of Array.isArray(updates.updated) ? updates.updated : []) {
            const event = eventsById.get(String(update.targetId));
            if (!event) {
                skippedUpdates.push({
                    sourceRecordId: record.id,
                    range,
                    targetId: String(update.targetId || ''),
                    reason: '현재 사건 목록에서 대상 ID를 찾지 못했습니다.',
                });
                continue;
            }
            applyEventUpdate(event, update, range, record.id);
        }
    }

    return {
        events: [...eventsById.values()]
            .map(toPublicEvent)
            .sort((left, right) => left.firstSeenRange.startId - right.firstSeenRange.startId
                || left.firstSeenRange.endId - right.firstSeenRange.endId
                || left.title.localeCompare(right.title)),
        skippedUpdates,
    };
}

function createEventEntry(id, proposal, range, sourceRecordId) {
    const importance = normalizeImportance(proposal.importance);
    const event = {
        id,
        title: String(proposal.title),
        date: proposal.date || null,
        location: proposal.location || null,
        summary: String(proposal.summary),
        importance,
        shifts: importance === 'turning_point' ? dedupeStrings(proposal.shifts) : [],
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
    };
    for (const field of REPLACE_FIELDS) event._sources[field] = { ...range };
    return event;
}

function applyEventUpdate(event, update, range, sourceRecordId) {
    const replace = update.replace || {};
    let changed = false;
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(event, field, range)) continue;
        event[field] = normalizeReplaceValue(field, replace[field]);
        event._sources[field] = { ...range };
        changed = true;
    }
    if (event.importance === 'ordinary' && event.shifts.length) {
        event.shifts = [];
        event._sources.shifts = { ...range };
        changed = true;
    }
    if (changed) {
        event.lastUpdatedRange = newerRange(event.lastUpdatedRange, range);
        appendUnique(event.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function normalizeReplaceValue(field, value) {
    if (field === 'importance') return normalizeImportance(value);
    if (field === 'shifts') return dedupeStrings(value);
    if (['date', 'location'].includes(field)) return value || null;
    return String(value || '').trim();
}

function normalizeImportance(value) {
    return value === 'turning_point' ? 'turning_point' : 'ordinary';
}

function canReplace(event, field, range) {
    const previous = event._sources[field];
    return !previous || range.endId >= previous.endId;
}

function appendUnique(target, values) {
    const known = new Set(target.map(normalizeKey));
    for (const value of values) {
        const key = normalizeKey(value);
        if (!key || known.has(key)) continue;
        target.push(value);
        known.add(key);
    }
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

function createStableEventId(recordId, index) {
    const source = `event:${recordId}:${index}`;
    let hash = 2166136261;
    for (let position = 0; position < source.length; position += 1) {
        hash ^= source.charCodeAt(position);
        hash = Math.imul(hash, 16777619);
    }
    return `event-${(hash >>> 0).toString(36)}`;
}

function toPublicEvent(event) {
    const { _sources, ...publicEvent } = event;
    return structuredClone({
        ...publicEvent,
        provenance: { fields: _sources, values: {} },
    });
}
