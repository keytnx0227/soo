import { getAtlasProjection, getLlmVisibleAtlasProjection } from './atlas-projection-service.js';
import { buildWorldMemoryPromptContext as serializeWorldMemory } from './world-memory.js';

export function getWorldAtlas(projectionOptions = {}) {
    const atlas = getAtlasProjection(projectionOptions);
    return {
        world: atlas.world,
        excluded: atlas.excluded.world,
        skippedUpdates: atlas.skippedUpdates.world,
        orphanCorrections: atlas.orphanCorrections.world,
    };
}

export function buildWorldMemoryPromptContext(projectionOptions = {}) {
    return serializeWorldMemory(getLlmVisibleAtlasProjection(projectionOptions).world);
}
