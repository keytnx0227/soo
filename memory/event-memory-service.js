import { getAtlasProjection } from './atlas-projection-service.js';
import { buildEventMemoryPromptContext as serializeEventMemory } from './event-memory.js';

export function getEventAtlas() {
    const atlas = getAtlasProjection();
    return {
        events: atlas.events,
        skippedUpdates: atlas.skippedUpdates.events,
        orphanCorrections: atlas.orphanCorrections.events,
    };
}

export function buildEventMemoryPromptContext() {
    return serializeEventMemory(getEventAtlas().events);
}
