const REPLACE_FIELDS = Object.freeze(['keys', 'content']);

export function buildWorldMemoryPromptContext(entries) {
    return JSON.stringify(entries.map(entry => ({
        id: entry.id,
        keys: entry.keys,
        content: entry.content,
        ...(entry.manual ? { manual: true } : {}),
    })), null, 2);
}

export function deriveWorldAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.world)
        .sort((left, right) => left.startId - right.startId
            || left.endId - right.endId
            || Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const entriesById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = { startId: Number(record.startId), endId: Number(record.endId) };
        const updates = record.structuredSummary.data.memoryUpdates.world;
        (Array.isArray(updates.created) ? updates.created : []).forEach((proposal, index) => {
            const id = createStableWorldId(record.id, index);
            entriesById.set(id, createWorldEntry(id, proposal, range, record.id));
        });

        for (const update of Array.isArray(updates.updated) ? updates.updated : []) {
            const entry = entriesById.get(String(update.targetId));
            if (!entry) {
                skippedUpdates.push({
                    sourceRecordId: record.id,
                    range,
                    targetId: String(update.targetId || ''),
                    reason: '현재 세계 설정에서 대상 ID를 찾지 못했습니다.',
                });
                continue;
            }
            applyWorldUpdate(entry, update, range, record.id);
        }
    }

    return {
        world: [...entriesById.values()]
            .map(toPublicWorldEntry)
            .sort((left, right) => left.firstSeenRange.startId - right.firstSeenRange.startId
                || left.firstSeenRange.endId - right.firstSeenRange.endId
                || left.content.localeCompare(right.content)),
        skippedUpdates,
    };
}

function createWorldEntry(id, proposal, range, sourceRecordId) {
    const entry = {
        id,
        keys: dedupeStrings(proposal.keys),
        content: String(proposal.content || '').trim(),
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
    };
    for (const field of REPLACE_FIELDS) entry._sources[field] = { ...range };
    return entry;
}

function applyWorldUpdate(entry, update, range, sourceRecordId) {
    const replace = update.replace || {};
    let changed = false;
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(entry, field, range)) continue;
        const value = field === 'keys' ? dedupeStrings(replace.keys) : String(replace.content || '').trim();
        if ((field === 'keys' && !value.length) || (field === 'content' && !value)) continue;
        entry[field] = value;
        entry._sources[field] = { ...range };
        changed = true;
    }
    if (changed) {
        entry.lastUpdatedRange = newerRange(entry.lastUpdatedRange, range);
        appendUnique(entry.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function canReplace(entry, field, range) {
    const previous = entry._sources[field];
    return !previous || range.endId >= previous.endId;
}

function dedupeStrings(values) {
    const result = [];
    appendUnique(result, Array.isArray(values) ? values : []);
    return result;
}

function appendUnique(target, values) {
    const known = new Set(target.map(normalizeKey));
    for (const value of values) {
        const normalized = String(value || '').trim();
        const key = normalizeKey(normalized);
        if (!key || known.has(key)) continue;
        target.push(normalized);
        known.add(key);
    }
}

function normalizeKey(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function newerRange(left, right) {
    return right.endId >= left.endId ? { ...right } : { ...left };
}

function createStableWorldId(recordId, index) {
    const source = `world:${recordId}:${index}`;
    let hash = 2166136261;
    for (let position = 0; position < source.length; position += 1) {
        hash ^= source.charCodeAt(position);
        hash = Math.imul(hash, 16777619);
    }
    return `world-${(hash >>> 0).toString(36)}`;
}

function toPublicWorldEntry(entry) {
    const { _sources, ...publicEntry } = entry;
    return structuredClone({
        ...publicEntry,
        provenance: { fields: _sources, values: {} },
    });
}
