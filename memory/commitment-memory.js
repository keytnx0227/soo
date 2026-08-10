import {
    canApplyAtlasReplacement,
    compareAtlasSourceRecords,
    getAtlasSourceRange,
} from './atlas-source-record.js';
import { getCreatedAtlasEntityId } from './atlas-entity-id.js';

const REPLACE_FIELDS = Object.freeze([
    'title',
    'terms',
    'participants',
    'conditions',
    'deadline',
    'status',
    'statusReason',
]);
export function buildCommitmentMemoryPromptContext(commitments) {
    return JSON.stringify(commitments.map(commitment => ({
        id: commitment.id,
        title: commitment.title,
        terms: commitment.terms,
        participants: commitment.participants,
        conditions: commitment.conditions,
        deadline: commitment.deadline,
        facts: commitment.facts,
        status: commitment.status,
        statusReason: commitment.statusReason,
    })), null, 2);
}

export function deriveCommitmentAtlas(records) {
    const sourceRecords = [...(Array.isArray(records) ? records : [])]
        .filter(record => record?.structuredSummary?.data?.memoryUpdates?.commitments)
        .sort(compareAtlasSourceRecords);
    const commitmentsById = new Map();
    const skippedUpdates = [];

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.commitments;
        (Array.isArray(updates.created) ? updates.created : []).forEach((proposal, index) => {
            const id = getCreatedAtlasEntityId('commitments', record.id, proposal, index);
            commitmentsById.set(id, createCommitmentEntry(id, proposal, range, record.id));
        });
    }

    for (const record of sourceRecords) {
        const range = getAtlasSourceRange(record);
        const updates = record.structuredSummary.data.memoryUpdates.commitments;
        for (const update of Array.isArray(updates.updated) ? updates.updated : []) {
            const commitment = commitmentsById.get(String(update.targetId));
            if (!commitment) {
                skippedUpdates.push({
                    sourceRecordId: record.id,
                    range,
                    targetId: String(update.targetId || ''),
                    reason: '현재 장부에서 대상 ID를 찾지 못했습니다.',
                });
                continue;
            }
            applyCommitmentUpdate(commitment, update, range, record.id);
        }
    }

    return {
        commitments: [...commitmentsById.values()]
            .map(toPublicCommitment)
            .sort((left, right) => left.firstSeenRange.startId - right.firstSeenRange.startId
                || left.title.localeCompare(right.title)),
        skippedUpdates,
    };
}

function createCommitmentEntry(id, proposal, range, sourceRecordId) {
    const commitment = {
        id,
        title: String(proposal.title),
        terms: String(proposal.terms),
        participants: normalizeParticipants(proposal.participants),
        conditions: dedupeStrings(proposal.conditions),
        deadline: proposal.deadline || null,
        facts: dedupeStrings(proposal.facts),
        status: normalizeStatus(proposal.status),
        statusReason: proposal.statusReason || null,
        firstSeenRange: { ...range },
        lastUpdatedRange: { ...range },
        sourceRecordIds: [String(sourceRecordId)],
        _sources: {},
        _valueSources: {},
        _statusHistory: [{
            status: normalizeStatus(proposal.status),
            statusReason: proposal.statusReason || null,
            range: { ...range },
        }],
    };
    for (const field of REPLACE_FIELDS) commitment._sources[field] = { ...range };
    commitment._valueSources.facts = commitment.facts.map(value => ({ value, range: { ...range } }));
    return commitment;
}

function applyCommitmentUpdate(commitment, update, range, sourceRecordId) {
    let changed = appendUniqueTracked(
        commitment.facts,
        commitment._valueSources.facts,
        dedupeStrings(update.append?.facts),
        range,
    );
    const replace = update.replace || {};
    const proposedStatus = Object.hasOwn(replace, 'status') ? normalizeStatus(replace.status) : null;
    if (proposedStatus) {
        commitment._statusHistory.push({
            status: proposedStatus,
            statusReason: Object.hasOwn(replace, 'statusReason') ? replace.statusReason || null : null,
            range: { ...range },
        });
    }
    for (const field of REPLACE_FIELDS) {
        if (!Object.hasOwn(replace, field) || !canReplace(commitment, field, range)) continue;
        let value = normalizeReplaceValue(field, replace[field]);
        commitment[field] = value;
        commitment._sources[field] = { ...range };
        changed = true;
    }

    if (changed) {
        commitment.lastUpdatedRange = newerRange(commitment.lastUpdatedRange, range);
        appendUnique(commitment.sourceRecordIds, [String(sourceRecordId)]);
    }
}

function normalizeReplaceValue(field, value) {
    if (field === 'participants') return normalizeParticipants(value);
    if (field === 'conditions') return dedupeStrings(value);
    if (field === 'status') return normalizeStatus(value);
    if (['deadline', 'statusReason'].includes(field)) return value || null;
    return String(value || '').trim();
}

function normalizeParticipants(values) {
    if (!Array.isArray(values)) return [];
    return values.map(participant => ({
        personId: participant?.personId || null,
        personName: participant?.personName || null,
        role: participant?.role || null,
    })).filter(participant => participant.personId || participant.personName);
}

function normalizeStatus(value) {
    return ['pending', 'fulfilled', 'obsolete'].includes(value) ? value : 'pending';
}

function canReplace(commitment, field, range) {
    const previous = commitment._sources[field];
    return canApplyAtlasReplacement(previous, range);
}

function appendUniqueTracked(target, sources, values, range) {
    const known = new Set(target.map(normalizeKey));
    let changed = false;
    for (const value of values) {
        const key = normalizeKey(value);
        if (!key || known.has(key)) continue;
        target.push(value);
        sources.push({ value, range: { ...range } });
        known.add(key);
        changed = true;
    }
    return changed;
}

function appendUnique(target, values) {
    const known = new Set(target.map(normalizeKey));
    for (const value of values) {
        const key = normalizeKey(value);
        if (!key || known.has(key)) continue;
        target.push(value);
        known.add(key);
    }
}

function dedupeStrings(values) {
    const result = [];
    appendUnique(result, Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(Boolean) : []);
    return result;
}

function normalizeKey(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function newerRange(left, right) {
    return right.endId >= left.endId ? { ...right } : { ...left };
}

function toPublicCommitment(commitment) {
    const { _sources, _valueSources, _statusHistory, ...publicCommitment } = commitment;
    return structuredClone({
        ...publicCommitment,
        provenance: {
            fields: _sources,
            values: _valueSources,
            statusHistory: _statusHistory,
        },
    });
}
