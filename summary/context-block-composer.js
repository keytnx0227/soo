import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { getAtlasProjection } from '../memory/atlas-projection-service.js';
import { getSummaryRecords } from './summary-store.js';
import { composeAtomicContext } from './context-block-trimmer.js';

export function buildContextBlockComposition(budget = Infinity) {
    const settings = getSettings().summarization;
    const sourceBlocks = buildRenderedBlocks(
        settings.contextBlocks,
        getSummaryRecords(),
        getAtlasProjection(),
    );
    return composeAtomicContext(sourceBlocks, budget, getTokenCount);
}

export function buildRenderedBlocks(blockSettings, records, atlas) {
    const sources = {
        [SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS]: [...(records || [])]
            .sort((left, right) => left.startId - right.startId || left.endId - right.endId)
            .map(record => ({
                id: String(record.id),
                label: `#${record.startId} ~ #${record.endId}`,
                values: {
                    sumiRecordStartId: record.startId,
                    sumiRecordEndId: record.endId,
                    sumiRecordContent: record.content,
                },
            })),
        [SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS]: (atlas?.events || []).map(event => ({
            id: event.id,
            label: event.title,
            values: renderEventValues(event),
        })),
        [SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE]: (atlas?.people || []).map(person => ({
            id: person.id,
            label: person.name,
            values: renderPersonValues(person),
        })),
        [SUMMARY_CONTEXT_BLOCK_KINDS.ITEMS]: (atlas?.items || []).map(item => ({
            id: item.id,
            label: item.name,
            values: renderItemValues(item),
        })),
        [SUMMARY_CONTEXT_BLOCK_KINDS.COMMITMENTS]: (atlas?.commitments || []).map(commitment => ({
            id: commitment.id,
            label: commitment.title,
            values: renderCommitmentValues(commitment),
        })),
    };

    return blockSettings.map(block => ({
        kind: block.kind,
        name: block.name,
        enabled: block.enabled,
        prefixTemplate: block.prefixTemplate,
        suffixTemplate: block.suffixTemplate,
        units: (sources[block.kind] || []).map(unit => ({
            id: unit.id,
            label: unit.label,
            content: renderTemplate(block.entryTemplate, unit.values),
        })).filter(unit => unit.content),
    }));
}

function renderTemplate(template, values) {
    let result = String(template || '');
    for (const [key, value] of Object.entries(values)) {
        result = result.replaceAll(`{{${key}}}`, String(value ?? ''));
    }
    return result.split('\n').map(line => line.trimEnd()).filter((line, index, lines) => (
        line.trim() || (index > 0 && index < lines.length - 1 && lines[index - 1].trim() && lines[index + 1].trim())
    )).join('\n').trim();
}

function renderEventValues(event) {
    return {
        sumiEventId: event.id,
        sumiEventTitle: event.title,
        sumiEventDate: event.date || '',
        sumiEventLocation: event.location || '',
        sumiEventSummary: event.summary,
        sumiEventImportance: event.importance,
        sumiEventShifts: event.importance === 'turning_point' ? listBlock('shifts', event.shifts) : '',
    };
}

function renderPersonValues(person) {
    const state = compactPairs({
        location: person.lastKnownState?.location,
        physicalCondition: person.lastKnownState?.physicalCondition,
    });
    const relationships = (person.relationships || []).map(relationship => {
        const target = relationship.targetName || relationship.targetId || 'unknown';
        const details = [
            relationship.relationship?.length ? `relationship: ${relationship.relationship.join(', ')}` : '',
            relationship.feelings?.length ? `feelings: ${relationship.feelings.join(', ')}` : '',
        ].filter(Boolean).join('; ');
        return details ? `${target} (${details})` : target;
    });
    return {
        sumiPersonId: person.id,
        sumiPersonName: person.name,
        sumiPersonAliases: listBlock('aliases', person.aliases),
        sumiPersonFacts: listBlock('facts', person.facts),
        sumiPersonRoles: listBlock('roles', person.roles),
        sumiPersonAffiliations: listBlock('affiliations', person.affiliations),
        sumiPersonPersonality: listBlock('personality', person.personalityTraits),
        sumiPersonSpeech: listBlock('speech patterns', person.speechPatterns),
        sumiPersonState: state ? `- last known state: ${state}` : '',
        sumiPersonRelationships: listBlock('relationships', relationships),
    };
}

function renderItemValues(item) {
    const state = compactPairs({
        owner: item.lastKnownState?.owner,
        holder: item.lastKnownState?.holder,
        location: item.lastKnownState?.location,
        condition: item.lastKnownState?.condition,
        status: item.lastKnownState?.status,
    });
    return {
        sumiItemId: item.id,
        sumiItemName: item.name,
        sumiItemAliases: listBlock('aliases', item.aliases),
        sumiItemFacts: listBlock('facts', item.facts),
        sumiItemFunctions: listBlock('functions', item.functions),
        sumiItemState: state ? `- last known state: ${state}` : '',
    };
}

function renderCommitmentValues(commitment) {
    const participants = (commitment.participants || []).map(participant => {
        const name = participant.personName || participant.personId || 'unknown';
        return participant.role ? `${name} (${participant.role})` : name;
    });
    return {
        sumiCommitmentId: commitment.id,
        sumiCommitmentTitle: commitment.title,
        sumiCommitmentStatus: commitment.status,
        sumiCommitmentTerms: commitment.terms,
        sumiCommitmentParticipants: listBlock('participants', participants),
        sumiCommitmentConditions: listBlock('conditions', commitment.conditions),
        sumiCommitmentDeadline: commitment.deadline ? `- deadline: ${commitment.deadline}` : '',
        sumiCommitmentFacts: listBlock('facts', commitment.facts),
        sumiCommitmentStatusReason: commitment.statusReason ? `- status reason: ${commitment.statusReason}` : '',
    };
}

function listBlock(label, values) {
    return Array.isArray(values) && values.length ? `- ${label}: ${values.join('; ')}` : '';
}

function compactPairs(values) {
    return Object.entries(values).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('; ');
}
