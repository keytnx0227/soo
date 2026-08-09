import { getAtlasProjection } from './atlas-projection-service.js';
import { buildWorldMemoryPromptContext as serializeWorldMemory } from './world-memory.js';

export function getWorldAtlas() {
    const atlas = getAtlasProjection();
    return {
        world: atlas.world,
        excluded: atlas.excluded.world,
        skippedUpdates: atlas.skippedUpdates.world,
        orphanCorrections: atlas.orphanCorrections.world,
    };
}

export function buildWorldMemoryPromptContext() {
    return serializeWorldMemory(getWorldAtlas().world);
}
