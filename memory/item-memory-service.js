import { getAtlasProjection } from './atlas-projection-service.js';
import { buildItemMemoryPromptContext as serializeItemMemory } from './item-memory.js';

export function getItemAtlas() {
    const atlas = getAtlasProjection();
    return {
        items: atlas.items,
        excluded: atlas.excluded.items,
        skippedUpdates: atlas.skippedUpdates.items,
        orphanCorrections: atlas.orphanCorrections.items,
    };
}

export function buildItemMemoryPromptContext() {
    return serializeItemMemory(getItemAtlas().items);
}
