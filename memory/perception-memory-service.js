import { getAtlasProjection, getLlmVisibleAtlasProjection } from './atlas-projection-service.js';

export function buildPerceptionMemoryPromptContext(options = {}) {
    const current = getLlmVisibleAtlasProjection().perceptions;
    const byId = new Map(current.map(slot => [slot.id, slot]));
    const historical = getAtlasProjection(options).perceptions;
    const slots = historical.filter(slot => byId.has(slot.id) && slot.allowAutoUpdate
        && (!options.perceptionIds?.length || options.perceptionIds.includes(slot.id)));
    return slots.length ? JSON.stringify(slots.map(slot => ({
        id: slot.id, observerId: slot.observerId, subjectId: slot.subjectId,
        observer: byId.get(slot.id).observerName, subject: byId.get(slot.id).subjectName,
        facts: slot.facts, impression: slot.impression,
    })), null, 2) : '';
}
