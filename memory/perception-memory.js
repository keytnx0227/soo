import { compareAtlasSourceRecords, getAtlasSourceRange } from './atlas-source-record.js';
import { createStableAtlasEntityId } from './atlas-entity-id.js';

export function derivePerceptionAtlas(records, slots, people, { beforeStartId = null } = {}) {
    const peopleById = new Map(people.map(person => [person.id, person]));
    const baselines = new Map(slots.map(slot => [slot.id,
        (beforeStartId == null || slot.appliedThroughId < beforeStartId) && Boolean(slot.hasBaseline || slot.facts?.length || slot.impression),
    ]));
    const perceptions = slots.map(slot => {
        const includeBaseline = beforeStartId == null || slot.appliedThroughId < beforeStartId;
        const observer = peopleById.get(slot.observerId);
        const subject = peopleById.get(slot.subjectId);
        return { ...structuredClone(slot), manual: true,
            facts: includeBaseline ? structuredClone(slot.facts || []) : [],
            impression: includeBaseline ? slot.impression : null,
            observerName: observer?.name || slot.observerId, subjectName: subject?.name || slot.subjectId,
            unresolved: !observer || !subject,
            endpointHidden: Boolean(observer?.llmHidden || subject?.llmHidden),
            sourceRecordIds: [], firstSeenRange: null, lastUpdatedRange: null,
        };
    });
    const byId = new Map(perceptions.map(slot => [slot.id, slot]));
    const skippedUpdates = [];
    for (const record of [...records].sort(compareAtlasSourceRecords)) {
        if (record.manualSource) continue;
        const range = getAtlasSourceRange(record);
        const effectiveId = Number(record.atlasReview ? record.appliedThroughId : record.endId ?? record.position) || 0;
        for (const update of record.structuredSummary?.data?.memoryUpdates?.perceptions?.updated || []) {
            const slot = byId.get(update.targetId);
            const skip = (reason, factId = null) => skippedUpdates.push({ sourceRecordId: record.id, targetId: update.targetId, factId, range, reason });
            if (!slot) { skip('등록되지 않은 인식 칸입니다.'); continue; }
            if (!slot.allowAutoUpdate || (effectiveId <= slot.appliedThroughId && baselines.get(slot.id))) continue;
            for (const text of update.append?.facts || []) {
                if (slot.facts.some(fact => fact.text === text)) continue;
                slot.facts.push({ id: createStableAtlasEntityId('perceptions', record.id, `${slot.id}:${text}`), text });
            }
            for (const change of update.factUpdates || []) {
                const fact = slot.facts.find(item => item.id === change.targetId);
                if (!fact) { skip(`수정할 인식 정보가 없습니다: ${change.targetId}`, change.targetId); continue; }
                fact.text = change.text;
            }
            if (Object.hasOwn(update.replace || {}, 'impression')) slot.impression = update.replace.impression;
            slot.sourceRecordIds.push(record.id);
            slot.firstSeenRange ||= range;
            slot.lastUpdatedRange = range;
        }
    }
    return { perceptions, skippedUpdates };
}
