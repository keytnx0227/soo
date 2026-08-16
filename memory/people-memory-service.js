import { getAtlasProjection, getLlmVisibleAtlasProjection } from './atlas-projection-service.js';
import { buildPeopleMemoryPromptContext as serializePeopleMemory } from './people-memory.js';

export function getPeopleAtlas(projectionOptions = {}) {
    const atlas = getAtlasProjection(projectionOptions);
    return {
        people: atlas.people,
        excluded: atlas.excluded.people,
        skippedUpdates: atlas.skippedUpdates.people,
        orphanCorrections: atlas.orphanCorrections.people,
    };
}

export function buildPeopleMemoryPromptContext(projectionOptions = {}) {
    return serializePeopleMemory(getLlmVisibleAtlasProjection(projectionOptions).people);
}
