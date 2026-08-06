const REPLACE_FIELDS = Object.freeze(['functions']);
const STATE_FIELDS = Object.freeze(['owner', 'holder', 'location', 'condition', 'status']);

export function buildItemMemoryPromptContext(items) {
    return JSON.stringify(items.map(item => ({
        id: item.id,
        name: item.name,
        aliases: item.aliases,
        facts: item.facts,
        functions: item.functions,
        lastKnownState: item.lastKnownState,
    })), null, 2);
}

export function deriveItemAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.items)
        .sort((left, right) => left.startId - right.startId
            || left.endId - right.endId
            || Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const itemsById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = { startId: Number(record.startId), endId: Number(record.endId) };
        const updates = record.structuredSummary.data.memoryUpdates.items;

        (Array.isArray(updates.created) ? updates.created : []).forEach((proposal, index) => {
            const id = createStableItemId(record.id, index);
            itemsById.set(id, createItemEntry(id, proposal, range, record.id));
        });

        for (const update of Array.isArray(updates.updated) ? updates.updated : []) {
            const item = itemsById.get(String(update.targetId));
            if (!item) {
                skippedUpdates.push({
                    sourceRecordId: record.id,
                    range,
                    targetId: String(update.targetId || ''),
                    reason: '현재 도감에서 대상 ID를 찾지 못했습니다.',
                });
                continue;
            }
            applyItemUpdate(item, update, range, record.id);
        }
    }

    return {
        items: [...itemsById.values()].map(toPublicItem).sort((left, right) => left.name.localeCompare(right.name)),
        skippedUpdates,
    };
}

function createItemEntry(id, proposal, range, sourceRecordId) {
    const item = {
        id,
        name: String(proposal.name),
        aliases: dedupeStrings(proposal.aliases),
        facts: dedupeStrings(proposal.facts),
        functions: dedupeStrings(proposal.functions),
        lastKnownState: Object.fromEntries(STATE_FIELDS.map(field => [field, proposal.lastKnownState?.[field] || null])),
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
        _valueSources: {},
    };
    item._valueSources.aliases = createValueSources(item.aliases, range);
    item._valueSources.facts = createValueSources(item.facts, range);
    for (const field of ['name', ...REPLACE_FIELDS, ...STATE_FIELDS.map(field => `lastKnownState.${field}`)]) {
        item._sources[field] = { ...range };
    }
    return item;
}

function applyItemUpdate(item, update, range, sourceRecordId) {
    let changed = false;
    changed = appendUniqueTracked(item.aliases, item._valueSources.aliases, dedupeStrings(update.append?.aliases), range) || changed;
    changed = appendUniqueTracked(item.facts, item._valueSources.facts, dedupeStrings(update.append?.facts), range) || changed;

    const replace = update.replace || {};
    if (Object.hasOwn(replace, 'name') && replace.name && canReplace(item, 'name', range)) {
        if (item.name !== replace.name) {
            appendUniqueTracked(item.aliases, item._valueSources.aliases, [item.name], range);
        }
        item.name = String(replace.name);
        item._sources.name = { ...range };
        changed = true;
    }
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(item, field, range)) continue;
        item[field] = dedupeStrings(replace[field]);
        item._sources[field] = { ...range };
        changed = true;
    }
    if (Object.hasOwn(replace, 'lastKnownState')) {
        for (const field of STATE_FIELDS) {
            const sourceKey = `lastKnownState.${field}`;
            if (!Object.hasOwn(replace.lastKnownState || {}, field) || !canReplace(item, sourceKey, range)) continue;
            item.lastKnownState[field] = replace.lastKnownState[field] || null;
            item._sources[sourceKey] = { ...range };
            changed = true;
        }
    }

    if (changed) {
        item.lastUpdatedRange = newerRange(item.lastUpdatedRange, range);
        appendUnique(item.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function canReplace(item, field, range) {
    const previous = item._sources[field];
    return !previous || range.endId >= previous.endId;
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

function createStableItemId(recordId, index) {
    const source = `item:${recordId}:${index}`;
    let hash = 2166136261;
    for (let position = 0; position < source.length; position += 1) {
        hash ^= source.charCodeAt(position);
        hash = Math.imul(hash, 16777619);
    }
    return `item-${(hash >>> 0).toString(36)}`;
}

function toPublicItem(item) {
    const { _sources, _valueSources, ...publicItem } = item;
    return structuredClone({
        ...publicItem,
        provenance: {
            fields: _sources,
            values: _valueSources,
        },
    });
}
