import { getAtlasProjection } from './atlas-projection-service.js';
import { buildCommitmentMemoryPromptContext as serializeCommitmentMemory } from './commitment-memory.js';

export function getCommitmentAtlas() {
    const atlas = getAtlasProjection();
    return {
        commitments: atlas.commitments,
        excluded: atlas.excluded.commitments,
        skippedUpdates: atlas.skippedUpdates.commitments,
        orphanCorrections: atlas.orphanCorrections.commitments,
    };
}

export function buildCommitmentMemoryPromptContext() {
    return serializeCommitmentMemory(getCommitmentAtlas().commitments);
}
