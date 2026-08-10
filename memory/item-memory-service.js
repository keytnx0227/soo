import { getAtlasProjection } from './atlas-projection-service.js';
import { buildItemMemoryPromptContext as serializeItemMemory } from './item-memory.js';

export function getItemAtlas(projectionOptions = {}) {
    const atlas = getAtlasProjection(projectionOptions);
    return {
        items: atlas.items,
        excluded: atlas.excluded.items,
        skippedUpdates: atlas.skippedUpdates.items,
        orphanCorrections: atlas.orphanCorrections.items,
    };
}

export function buildItemMemoryPromptContext(projectionOptions = {}) {
    return serializeItemMemory(getItemAtlas(projectionOptions).items);
}
