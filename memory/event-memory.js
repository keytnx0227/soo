import {
    canApplyAtlasReplacement,
    compareAtlasSourceRecords,
    getAtlasSourceRange,
} from './atlas-source-record.js';
import { getCreatedAtlasEntityId } from './atlas-entity-id.js';

const REPLACE_FIELDS = Object.freeze([
    'title',
    'date',
    'location',
    'summary',
    'importance',
    'shift',
]);

export function buildEventMemoryPromptContext(events) {
    return JSON.stringify(events.map(event => ({
        id: event.id,
        title: event.title,
        ...(event.manual ? { manual: true, allowAutoUpdate: Boolean(event.allowAutoUpdate) } : {}),
        date: event.date,
        location: event.location,
        summary: event.summary,
        importance: event.importance,
        shift: event.shift,
    })), null, 2);
}

export function deriveEventAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.events)
        .sort(compareAtlasSourceRecords);
    const eventsById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.events;
        (Array.isArray(updates.created) ? updates.created : []).forEach((proposal, index) => {
            const id = getCreatedAtlasEntityId('events', record.id, proposal, index);
            eventsById.set(id, createEventEntry(id, proposal, range, record.id));
        });
    }

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.events;
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
        shift: importance === 'major' ? normalizeShift(proposal.shift ?? proposal.shifts) : null,
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
    };
    for (const field of REPLACE_FIELDS) event._sources[field] = { ...range };
    return event;
}

function applyEventUpdate(event, update, range, sourceRecordId) {
    const sourceReplace = update.replace || {};
    const replace = Object.hasOwn(sourceReplace, 'shift') || !Object.hasOwn(sourceReplace, 'shifts')
        ? sourceReplace
        : { ...sourceReplace, shift: sourceReplace.shifts };
    let changed = false;
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(event, field, range)) continue;
        event[field] = normalizeReplaceValue(field, replace[field]);
        event._sources[field] = { ...range };
        changed = true;
    }
    if (event.importance === 'minor' && event.shift) {
        event.shift = null;
        event._sources.shift = { ...range };
        changed = true;
    }
    if (changed) {
        event.lastUpdatedRange = newerRange(event.lastUpdatedRange, range);
        appendUnique(event.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function normalizeReplaceValue(field, value) {
    if (field === 'importance') return normalizeImportance(value);
    if (field === 'shift') return normalizeShift(value);
    if (['date', 'location'].includes(field)) return value || null;
    return String(value || '').trim();
}

function normalizeImportance(value) {
    if (value === 'major' || value === 'turning_point') return 'major';
    return 'minor';
}

function canReplace(event, field, range) {
    const previous = event._sources[field];
    return canApplyAtlasReplacement(previous, range);
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

function normalizeShift(value) {
    const candidate = Array.isArray(value) ? value[0] : value;
    return String(candidate || '').trim() || null;
}

function normalizeKey(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function newerRange(left, right) {
    return right.endId >= left.endId ? { ...right } : { ...left };
}

function toPublicEvent(event) {
    const { _sources, ...publicEvent } = event;
    return structuredClone({
        ...publicEvent,
        provenance: { fields: _sources, values: {} },
    });
}
