const CATEGORY_PREFIXES = Object.freeze({
    people: '',
    items: 'item:',
    commitments: 'commitment:',
    events: 'event:',
    world: 'world:',
});

const OUTPUT_PREFIXES = Object.freeze({
    people: 'person',
    items: 'item',
    commitments: 'commitment',
    events: 'event',
    world: 'world',
});

export function createStableAtlasEntityId(category, recordId, index) {
    if (!Object.hasOwn(CATEGORY_PREFIXES, category)) throw new Error(`지원하지 않는 도감 종류입니다: ${category}`);
    const source = `${CATEGORY_PREFIXES[category]}${recordId}:${index}`;
    let hash = 2166136261;
    for (let position = 0; position < source.length; position += 1) {
        hash ^= source.charCodeAt(position);
        hash = Math.imul(hash, 16777619);
    }
    return `${OUTPUT_PREFIXES[category]}-${(hash >>> 0).toString(36)}`;
}

export function getCreatedAtlasEntityId(category, recordId, proposal, index) {
    const explicitId = String(proposal?.sourceId || '').trim();
    return explicitId || createStableAtlasEntityId(category, recordId, index);
}
