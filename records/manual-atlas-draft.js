const APPEND_FIELDS = { people: ['aliases'], items: ['aliases', 'facts'], commitments: ['facts'], events: [], world: [] };
const REPLACE_FIELDS = {
    people: ['name', 'provisional', 'role', 'age', 'occupation', 'appearance', 'affiliations', 'traits', 'voice', 'lastKnownState'],
    items: ['name', 'functions', 'lastKnownState'],
    commitments: ['title', 'terms', 'participants', 'conditions', 'deadline', 'status', 'statusReason'],
    events: ['title', 'date', 'location', 'summary', 'importance', 'shift'],
    world: ['keys', 'content'],
};

export function atlasUpdateEditorInitial(category, entity, patch = {}) {
    const initial = { ...structuredClone(entity), ...structuredClone(patch.replace || {}) };
    for (const field of APPEND_FIELDS[category]) initial[field] = patch.append?.[field] || [];
    if (category === 'people') initial.relationships = patch.relationshipUpdates || [];
    return initial;
}

export function createManualAtlasUpdate(category, entity, value) {
    const update = { targetId: entity.id, replace: {}, append: {} };
    for (const field of REPLACE_FIELDS[category]) {
        if (JSON.stringify(entity[field] ?? null) !== JSON.stringify(value[field] ?? null)) {
            update.replace[field] = structuredClone(value[field] ?? null);
        }
    }
    for (const field of APPEND_FIELDS[category]) update.append[field] = value[field] || [];
    if (category === 'people') update.relationshipUpdates = value.relationships || [];
    if (!Object.keys(update.replace).length && !Object.values(update.append).some(values => values.length)
        && !update.relationshipUpdates?.length) throw new Error('변경하거나 추가할 내용을 입력해주세요.');
    return update;
}

export function collectManualAtlasUpdates(entries) {
    const memoryUpdates = {};
    for (const entry of entries) {
        memoryUpdates[entry.category] ||= { created: [], updated: [] };
        memoryUpdates[entry.category][entry.kind || 'created'].push(structuredClone(entry.value));
    }
    return memoryUpdates;
}
