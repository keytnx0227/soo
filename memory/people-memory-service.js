import { getAtlasProjection } from './atlas-projection-service.js';
import { buildPeopleMemoryPromptContext as serializePeopleMemory } from './people-memory.js';

export function getPeopleAtlas() {
    const atlas = getAtlasProjection();
    return {
        people: atlas.people,
        skippedUpdates: atlas.skippedUpdates.people,
        orphanCorrections: atlas.orphanCorrections.people,
    };
}

export function buildPeopleMemoryPromptContext() {
    return serializePeopleMemory(getPeopleAtlas().people);
}
