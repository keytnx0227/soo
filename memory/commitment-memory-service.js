import { getAtlasProjection, getLlmVisibleAtlasProjection } from './atlas-projection-service.js';
import { buildCommitmentMemoryPromptContext as serializeCommitmentMemory } from './commitment-memory.js';

export function getCommitmentAtlas(projectionOptions = {}) {
    const atlas = getAtlasProjection(projectionOptions);
    return {
        commitments: atlas.commitments,
        excluded: atlas.excluded.commitments,
        skippedUpdates: atlas.skippedUpdates.commitments,
        orphanCorrections: atlas.orphanCorrections.commitments,
    };
}

export function buildCommitmentMemoryPromptContext(projectionOptions = {}) {
    return serializeCommitmentMemory(getLlmVisibleAtlasProjection(projectionOptions).commitments);
}
