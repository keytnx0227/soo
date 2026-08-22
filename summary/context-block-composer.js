import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { getLlmVisibleAtlasProjection } from '../memory/atlas-projection-service.js';
import { getPeopleRetrievalMetadata } from '../memory/atlas-metadata.js';
import { formatFeelings } from '../memory/people-feelings.js';
import { evaluatePeopleRetrieval } from '../memory/people-retrieval.js';
import { evaluateWorldRetrieval } from '../memory/world-retrieval.js';
import { getActiveSummaryRecords } from './summary-store.js';
import { composeAtomicContext } from './context-block-trimmer.js';

export function buildContextBlockComposition(budget = Infinity, {
    records = getActiveSummaryRecords(),
    retrievedRecordIds = [],
    pinnedRecordIds = [],
    messages = SillyTavern.getContext().chat,
    blockKinds = null,
} = {}) {
    const settings = getSettings().summarization;
    const atlas = getLlmVisibleAtlasProjection();
    const peopleRetrieval = evaluatePeopleRetrieval({
        people: atlas.people,
        messages,
        metadata: getPeopleRetrievalMetadata(),
        messageCount: settings.personRetrieval.messageCount,
    });
    const worldRetrieval = evaluateWorldRetrieval({
        entries: atlas.world,
        messages,
        mode: settings.worldRetrieval.mode,
        messageCount: settings.worldRetrieval.messageCount,
    });
    const sourceBlocks = buildRenderedBlocks(
        Array.isArray(blockKinds)
            ? settings.contextBlocks.filter(block => blockKinds.includes(block.kind))
            : settings.contextBlocks,
        records,
        atlas,
        {
            retrievedRecordIds,
            pinnedRecordIds,
            eventBudget: settings.eventInjectionMaxTokens,
            personBudget: settings.personRetrieval.maxTokens,
            peopleRetrieval,
            worldBudget: settings.worldRetrieval.maxTokens,
            worldRetrieval,
        },
    );
    return composeAtomicContext(sourceBlocks, budget, getTokenCount);
}

export function buildRenderedBlocks(blockSettings, records, atlas, {
    retrievedRecordIds = [],
    pinnedRecordIds = [],
    eventBudget = Infinity,
    personBudget = Infinity,
    peopleRetrieval = [],
    worldBudget = Infinity,
    worldRetrieval = [],
} = {}) {
    const retrievedIds = new Set(retrievedRecordIds.map(String));
    const pinnedIds = new Set(pinnedRecordIds.map(String));
    const events = buildEventUnits(atlas?.events || []);
    const peopleRetrievalById = new Map(peopleRetrieval.map(result => [String(result.person.id), result]));
    const eligibleWorld = worldRetrieval.filter(result => result.eligible);
    const sources = {
        [SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS]: [...(records || [])]
            .sort((left, right) => left.startId - right.startId || left.endId - right.endId)
            .map(record => ({
                id: String(record.id),
                label: `#${record.startId} ~ #${record.endId}`,
                retrieved: retrievedIds.has(String(record.id)),
                pinned: pinnedIds.has(String(record.id)),
                values: {
                    sumiRecordStartId: record.startId,
                    sumiRecordEndId: record.endId,
                    sumiRecordContent: record.content,
                },
            })),
        [SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS]: events,
        [SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE]: (atlas?.people || []).map(person => {
            const retrieval = peopleRetrievalById.get(String(person.id));
            return {
                id: person.id,
                label: person.name,
                priority: retrieval?.priority || 0,
                values: renderPersonValues(person),
            };
        }),
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
        [SUMMARY_CONTEXT_BLOCK_KINDS.WORLD]: eligibleWorld.map(result => ({
            id: result.entry.id,
            label: result.entry.keys.join(', '),
            priority: result.priority,
            values: renderWorldValues(result.entry),
        })),
    };

    return blockSettings.map(block => ({
        kind: block.kind,
        name: block.name,
        enabled: block.enabled,
        prefixTemplate: block.prefixTemplate,
        suffixTemplate: block.suffixTemplate,
        unitBudget: block.kind === SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS
            ? eventBudget
            : block.kind === SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE
                ? personBudget
                : block.kind === SUMMARY_CONTEXT_BLOCK_KINDS.WORLD ? worldBudget : Infinity,
        units: (sources[block.kind] || []).map(unit => ({
            id: unit.id,
            label: unit.label,
            retrieved: Boolean(unit.retrieved),
            pinned: Boolean(unit.pinned),
            priority: Number(unit.priority) || 0,
            content: renderTemplate(block.entryTemplate, unit.values),
        })).filter(unit => unit.content),
    }));
}

function buildEventUnits(events) {
    const chronological = [...events].sort((left, right) => (
        getEventPosition(left) - getEventPosition(right)
        || String(left.id).localeCompare(String(right.id))
    ));
    const positions = chronological.map(getEventPosition);
    const oldest = positions.length ? Math.min(...positions) : 0;
    const newest = positions.length ? Math.max(...positions) : 0;
    const span = newest - oldest;

    return chronological.map(event => {
        const recency = span > 0 ? (getEventPosition(event) - oldest) / span : 0;
        return {
            id: event.id,
            label: event.title,
            // The recency bonus stays below one, so a minor event never outranks a major event.
            priority: (event.importance === 'major' ? 2 : 1) + (recency * 0.999),
            values: renderEventValues(event),
        };
    });
}

function getEventPosition(event) {
    return Number(event?.firstSeenRange?.endId ?? event?.lastUpdatedRange?.endId) || 0;
}

function renderTemplate(template, values) {
    const normalizedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? '')]));
    let result = String(template || '').split('\n').filter(line => {
        const names = [...line.matchAll(/{{([^{}]+)}}/g)]
            .map(match => match[1])
            .filter(name => Object.hasOwn(normalizedValues, name));
        return !names.length || names.some(name => normalizedValues[name].trim());
    }).join('\n');
    for (const [key, value] of Object.entries(normalizedValues)) {
        result = result.replaceAll(`{{${key}}}`, String(value ?? ''));
    }
    return result.split('\n').map(line => line.trimEnd()).filter((line, index, lines) => (
        line.trim() || (index > 0 && index < lines.length - 1 && lines[index - 1].trim() && lines[index + 1].trim())
    )).join('\n').trim();
}

function renderEventValues(event) {
    const metadata = [event.date, event.location].filter(Boolean).join('; ');
    const shift = event.importance === 'major' ? event.shift : null;
    return {
        sumiEventId: event.id,
        sumiEventTitle: event.title,
        sumiEventDate: event.date || '',
        sumiEventLocation: event.location || '',
        sumiEventSummary: event.summary,
        sumiEventImportance: event.importance,
        sumiEventMetadata: metadata ? `(${metadata})` : '',
        sumiEventShift: shift ? `- SHIFT: ${shift}` : '',
        sumiEventShiftValue: shift || '',
        // Legacy macro for custom templates created before the singular shift field.
        sumiEventShifts: shift ? `- shifts: ${shift}` : '',
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
            relationship.feelings?.length ? `feelings: ${formatFeelings(relationship.feelings).join(', ')}` : '',
        ].filter(Boolean).join('; ');
        return details ? `${target} (${details})` : target;
    });
    return {
        sumiPersonId: person.id,
        sumiPersonName: person.name,
        sumiPersonProvisional: person.provisional ? '- provisional: true' : '',
        sumiPersonAliases: listBlock('aliases', person.aliases),
        sumiPersonRole: scalarBlock('role', person.role),
        sumiPersonAge: scalarBlock('age', person.age),
        sumiPersonOccupation: scalarBlock('occupation', person.occupation),
        sumiPersonAppearance: scalarBlock('appearance', person.appearance),
        sumiPersonAffiliations: listBlock('affiliations', person.affiliations),
        sumiPersonTraits: listBlock('traits', person.traits),
        sumiPersonVoice: scalarBlock('voice', person.voice),
        sumiPersonState: state ? `- last known state: ${state}` : '',
        sumiPersonRelationships: listBlock('relationships', relationships),
        sumiPersonProvisionalValue: person.provisional ? 'true' : '',
        sumiPersonAliasesValue: joinValues(person.aliases),
        sumiPersonRoleValue: person.role || '',
        sumiPersonAgeValue: person.age || '',
        sumiPersonOccupationValue: person.occupation || '',
        sumiPersonAppearanceValue: person.appearance || '',
        sumiPersonAffiliationsValue: joinValues(person.affiliations),
        sumiPersonTraitsValue: joinValues(person.traits),
        sumiPersonVoiceValue: person.voice || '',
        sumiPersonLastLocationValue: person.lastKnownState?.location || '',
        sumiPersonPhysicalConditionValue: person.lastKnownState?.physicalCondition || '',
        sumiPersonRelationshipsValue: joinValues(relationships),
        // Legacy macros keep custom pre-v10 templates readable without restoring facts.
        sumiPersonFacts: '',
        sumiPersonRoles: scalarBlock('role', person.role),
        sumiPersonPersonality: listBlock('traits', person.traits),
        sumiPersonSpeech: scalarBlock('voice', person.voice),
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
        sumiItemAliasesValue: joinValues(item.aliases),
        sumiItemFactsValue: joinValues(item.facts),
        sumiItemFunctionsValue: joinValues(item.functions),
        sumiItemOwnerValue: item.lastKnownState?.owner || '',
        sumiItemHolderValue: item.lastKnownState?.holder || '',
        sumiItemLocationValue: item.lastKnownState?.location || '',
        sumiItemConditionValue: item.lastKnownState?.condition || '',
        sumiItemStatusValue: item.lastKnownState?.status || '',
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
        sumiCommitmentParticipantsValue: joinValues(participants),
        sumiCommitmentConditionsValue: joinValues(commitment.conditions),
        sumiCommitmentDeadlineValue: commitment.deadline || '',
        sumiCommitmentFactsValue: joinValues(commitment.facts),
        sumiCommitmentStatusReasonValue: commitment.statusReason || '',
    };
}

function renderWorldValues(entry) {
    return {
        sumiWorldId: entry.id,
        sumiWorldKeys: joinValues(entry.keys),
        sumiWorldContent: entry.content,
    };
}

function listBlock(label, values) {
    return Array.isArray(values) && values.length ? `- ${label}: ${values.join('; ')}` : '';
}

function scalarBlock(label, value) {
    return value ? `- ${label}: ${value}` : '';
}

function joinValues(values) {
    return Array.isArray(values) ? values.filter(Boolean).join('; ') : '';
}

function compactPairs(values) {
    return Object.entries(values).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('; ');
}
