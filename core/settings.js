import { saveSettings as saveSillyTavernSettings, saveSettingsDebounced } from '../../../../../script.js';
import { createId } from './utils.js';
import {
    DEFAULT_MEMORY_SECTIONS,
    DEFAULT_SUMMARY_SECTIONS,
    SUMMARY_LANGUAGE_MODES,
    SUMMARY_SECTION_KINDS,
} from '../summary/summary-format.js';

export const MODULE_NAME = 'sumi_chat_summarizer';

export const PROMPT_TYPES = Object.freeze({
    SUMMARY: 'summary',
    REVISION: 'revision',
});

const PROMPT_SCHEMA_VERSION = 10;

export const BLOCK_KINDS = Object.freeze({
    EDITABLE: 'editable',
    CHARACTER_DESCRIPTION: 'characterDescription',
    CHARACTER_PERSONALITY: 'characterPersonality',
    CHARACTER_SCENARIO: 'characterScenario',
    PERSONA: 'persona',
    WORLD_INFO: 'worldInfo',
    RECENT_SUMMARIES: 'recentSummaries',
    RECENT_SUMMARY_SEPARATOR: 'recentSummarySeparator',
    SUMMARY_MESSAGES: 'summaryMessages',
    CURRENT_SUMMARY: 'currentSummary',
    REVISION_MESSAGES: 'revisionMessages',
    LEGACY_CHARACTER: 'character',
    LEGACY_SUMMARY_TARGET: 'summaryTarget',
    LEGACY_REVISION_HISTORY: 'revisionHistory',
    SUMMARY_LANGUAGE: 'summaryLanguage',
    SUMMARY_EXTRACTION_RULES: 'summaryExtractionRules',
    SUMMARY_OUTPUT_CONTRACT: 'summaryOutputContract',
    PEOPLE_MEMORY: 'peopleMemory',
    ITEM_MEMORY: 'itemMemory',
    COMMITMENT_MEMORY: 'commitmentMemory',
    EVENT_MEMORY: 'eventMemory',
    SUMMARY_TITLE: SUMMARY_SECTION_KINDS.TITLE,
    SUMMARY_DATE: SUMMARY_SECTION_KINDS.DATE,
    SUMMARY_TIME: SUMMARY_SECTION_KINDS.TIME,
    SUMMARY_LOCATION: SUMMARY_SECTION_KINDS.LOCATION,
    SUMMARY_PLOT: SUMMARY_SECTION_KINDS.PLOT,
    SUMMARY_CONTINUITY: SUMMARY_SECTION_KINDS.CONTINUITY,
    SUMMARY_EMOTIONS: SUMMARY_SECTION_KINDS.EMOTIONS,
    SUMMARY_QUOTES: SUMMARY_SECTION_KINDS.QUOTES,
    SUMMARY_TAGS: SUMMARY_SECTION_KINDS.TAGS,
});

export const SUMMARY_EXTRACTION_RULE_DEFINITIONS = Object.freeze([
    { key: 'title', label: '제목', kind: SUMMARY_SECTION_KINDS.TITLE },
    { key: 'date', label: '날짜', kind: SUMMARY_SECTION_KINDS.DATE },
    { key: 'time', label: '시간', kind: SUMMARY_SECTION_KINDS.TIME },
    { key: 'location', label: '장소', kind: SUMMARY_SECTION_KINDS.LOCATION },
    { key: 'plot', label: '플롯', kind: SUMMARY_SECTION_KINDS.PLOT },
    { key: 'continuity', label: '연속성 변화', kind: SUMMARY_SECTION_KINDS.CONTINUITY },
    { key: 'emotions', label: '감정 변화', kind: SUMMARY_SECTION_KINDS.EMOTIONS },
    { key: 'quotes', label: '주요 대사', kind: SUMMARY_SECTION_KINDS.QUOTES },
    { key: 'tags', label: '검색 태그', kind: SUMMARY_SECTION_KINDS.TAGS },
    { key: 'people', label: '인물 도감', kind: null, category: 'memory' },
    { key: 'items', label: '아이템 도감', kind: null, category: 'memory' },
    { key: 'commitments', label: '서약 장부', kind: null, category: 'memory' },
    { key: 'events', label: '주요 사건', kind: null, category: 'memory' },
]);

const DEFAULT_SUMMARY_EXTRACTION_RULES = Object.freeze({
    title: '# Title\n\nCreate one concise title that identifies the central scene or event of this chunk.',
    date: `# Date

Track dates in chronological order. Use an explicit in-story date when one is available. Otherwise continue the latest reliable Day N value found in recent summaries. If no prior temporal anchor exists, begin with Day 1. Advance the day when the target clearly implies that one or more days passed, including sleep followed by waking on a new day. Do not return "unknown" merely because no calendar date was stated, and do not invent a calendar date. If the date changes inside the chunk, represent each stage in contextFlow. Set relativeDate only when a relative position such as "three days earlier" is supported by the context.`,
    time: '# Time\n\nTrack explicit or reasonably inferable in-story times and time periods in chronological order. Represent meaningful changes as separate contextFlow entries. Do not invent precise clock times without evidence.',
    location: '# Location\n\nTrack the locations in which the target events occur. Represent movement in chronological order through separate contextFlow entries. Prefer specific established place names over vague descriptions.',
    plot: '# Plot\n\nWrite concise chronological plot beats covering what happened, why it happened, and the important consequences. Preserve meaningful decisions and causal links. Plot is required and must contain at least one grounded entry.',
    continuity: '# Continuity Changes\n\nExtract concrete non-emotional changes that may affect later continuity, such as newly learned facts, relationship status changes, goals, physical conditions, possessions, roles, affiliations, or permissions. Record only changes that occur in the target range and avoid repeating unchanged background information.',
    emotions: '# Emotional Changes\n\nFor each relevant subject, record meaningful emotional progression in chronological order and give a concise source-grounded reason for each state. Use toward only when the emotion has a clear target. Do not force an emotional change when none is supported.',
    quotes: '# Key Dialogue\n\nSelect only dialogue whose wording matters for characterization, promises, revelations, relationship changes, or future callbacks. Follow the output-language rule exactly. Keep context concise and do not fabricate quotations.',
    tags: '# Retrieval Tags\n\nCreate specific retrieval concepts for the chunk as a whole. Prioritize named people, places, objects, distinctive events, relationship milestones, promises, and memorable topics. Avoid generic tags such as "conversation", "event", or "emotion". canonical follows the configured output language; matchTerms contains concise source-language words or phrases that could recall this memory later.',
    people: `# People Memory Updates

Maintain compact current profile cards for recurring people. This is not a plot summary, event history, or action log.

## Selection and identity

- The two leads belong in the atlas when the Summary Target first characterizes them; an empty Current People Memory means they are not recorded yet.
- Create a card for another named person at their first meaningful characterization or when they gain durable narrative relevance. Ignore throwaway background figures.
- A pivotal unnamed person may use a short, stable handle as name with provisional set to true. Reuse exactly the same handle until a real name is established. When named, replace name, set provisional to false, and preserve the old handle in aliases.
- Reuse an existing targetId exactly. Never invent, alter, or guess an ID. Similar names, titles, or occupations do not prove identity.

## Evidence and updates

- Use only the Summary Target as evidence for creation or change. Other context may resolve identity but does not itself justify an update.
- Do not repeat unchanged fields. Prefer empty created and updated arrays over speculative, trivial, or redundant entries.
- append contains only newly established aliases. replace contains only current snapshot fields that meaningfully changed.
- For an array in replace, return its complete concise current value.

## Compact field policy

- role: the person's compact role in the story, or null. Do not recount actions.
- age: an explicitly established age or concise age description, otherwise null.
- occupation: current occupation or position, otherwise null.
- appearance: only stable identifying appearance in one compact phrase or sentence. Exclude temporary expressions, clothing changes, wounds, and scene actions unless they became durable.
- affiliations: only current meaningful groups or institutions; use a short list.
- traits: a few stable personality traits supported by meaningful characterization. Exclude temporary moods.
- voice: one compact pattern describing how the person speaks, such as register, forms of address, recurring phrasing, or sentence endings. Never include sample dialogue or quotations.
- lastKnownState: only the last observed location and physical condition in the summarized chronology. Keep both concise.
- relationships and feelings are directional current snapshots toward one named person. Keep only standing ties and durable feelings, not every scene emotion.

## Brevity and safety

- Use short labels or one compact sentence per scalar field. Do not include evidence, explanations, chronology, dialogue, or lists of actions inside profile fields.
- Do not duplicate information across fields. Never propose deleting a person.
- If no durable profile was created or changed, return empty created and updated arrays.`,
    items: `# Item Memory Updates

Extract durable item-memory proposals from the Summary Target. These proposals maintain a current reference snapshot of narratively relevant objects, not an inventory of every object mentioned and not a second chronological summary.

## Evidence boundary

- Propose information only when it is established or meaningfully changed by the Summary Target.
- Character profiles, World Info, recent summaries, Current People Memory, and Current Item Memory may resolve identity and context, but they are not evidence that a change occurred in this target.
- Do not repeat unchanged information merely because it appears in the supplied context.
- Prefer an empty update list over a speculative, redundant, trivial, or purely decorative entry.

## Identity and creation

- Add an item to created only when the target establishes a narratively relevant object that has no matching entry in Current Item Memory.
- Relevant objects include unique, named, plot-critical, emotionally significant, unusually capable, or continuity-sensitive items likely to matter later.
- Do not create entries for ordinary disposable objects, background decorations, generic furniture, or briefly handled items without future relevance.
- Use the most stable established name as name. Put genuine alternate names, titles, and established descriptors used as names in aliases.
- Never invent an ID. The extension assigns IDs after validation.
- Similar descriptions alone do not prove that two objects are the same item.

## Updating existing items

- Add an entry to updated only when its targetId was supplied by Current Item Memory. Copy the ID exactly.
- Never guess, synthesize, or modify a targetId.
- append.aliases and append.facts contain only newly established durable information that should coexist with prior values.
- replace contains only fields whose latest known snapshot changed in this target. Omit every unchanged field.
- When replacing functions, return the complete intended current array, not only the newly changed function.
- Do not use replace to rewrite stable information merely for style or wording.

## Field policy

- facts: durable objective properties, origin, provenance, appearance, restrictions, inscriptions, or significance that do not fit a more specific field.
- functions: the complete latest set of established capabilities, purposes, powers, or usable effects. Do not infer hidden abilities.
- lastKnownState.owner: the person, group, or entity with established ownership. Ownership is not the same as temporary possession.
- lastKnownState.holder: the person or entity physically carrying or controlling the item at the end of the target.
- lastKnownState.location: the last location where the item was observed when no more specific holder is sufficient.
- lastKnownState.condition: its latest physical condition, such as intact, damaged, repaired, sealed, or depleted.
- lastKnownState.status: its latest narrative availability or state, such as hidden, lost, stolen, destroyed, activated, or entrusted.
- Use null only when the target establishes that a previous state is no longer applicable or no reliable latest value exists. Omit an unchanged lastKnownState property from an update.

## Safety and output discipline

- Never propose deleting an item entry. A destroyed, consumed, or permanently lost item remains in memory with an updated status or condition.
- Never erase history by describing a past owner, holder, location, condition, or status as the latest state.
- Do not infer ownership, abilities, provenance, or significance without source support.
- Keep each value concise, factual, and useful for future roleplay continuity.
- If no durable item memory was created or changed, return empty created and updated arrays.`,
    commitments: `# Commitment Memory Updates

Extract durable commitments from the Summary Target. A commitment is a promise, vow, agreement, obligation, or a secret with an explicit future duty to reveal, protect, deliver, resolve, or otherwise act upon it.

## Scope and evidence boundary

- Create or update commitments only from events established in the Summary Target.
- Character profiles, World Info, recent summaries, and current memory blocks may resolve identity and context, but they are not evidence that a commitment changed in this target.
- Do not treat an ordinary secret, general goal, casual intention, speculation, desire, threat, or rhetorical statement as a commitment.
- Do not use this ledger for unresolved plot hooks without a specific duty or expected future action. Those belong to a separate future system.
- Prefer empty arrays over speculative, redundant, trivial, or already irrelevant entries.

## Creation and identity

- Add to created only when the target establishes a new commitment with future continuity value and no matching entry exists in Current Commitment Memory.
- Use a concise title and a self-contained terms statement identifying what must happen.
- Never invent an ID. The extension assigns IDs after validation.
- Do not create duplicates when an existing commitment is restated, clarified, transferred, or given a new deadline.
- A commitment created and fully resolved inside the same target should usually be omitted unless its completion has durable future significance.

## Participants and supporting fields

- participants identifies people or entities directly responsible for, owed, protected by, benefiting from, or witnessing the commitment.
- Copy personId exactly when it is available in Current People Memory. Otherwise use personName and set personId to null.
- role should concisely state the participant's function, such as promisor, beneficiary, witness, custodian, or obligated party.
- conditions contains concrete requirements affecting fulfillment or continued relevance.
- deadline contains only an explicit or reliably relative deadline. Otherwise return null.
- facts contains durable supporting information that should coexist with existing facts and does not duplicate terms, conditions, or status.

## Status policy

- status must be exactly pending, fulfilled, or obsolete.
- pending means the commitment still requires tracking.
- fulfilled means the promised action or required condition was actually completed. Repeating an intention, preparing to act, or partially progressing is not fulfillment.
- obsolete means fulfillment did not occur but tracking is no longer meaningful because the commitment was cancelled, waived, superseded, made impossible, or otherwise lost relevance.
- Use statusReason to state the concrete evidence for the current status.
- Never automatically move a fulfilled or obsolete commitment back to pending. If the prior status was wrong, leave correction to the user.

## Updating existing commitments

- Add to updated only when targetId was supplied by Current Commitment Memory. Copy it exactly.
- Never guess, synthesize, or modify a targetId.
- append.facts contains only newly established durable supporting facts.
- replace contains only fields whose latest snapshot changed in this target. Omit every unchanged field.
- When replacing participants or conditions, return the complete intended current array.
- Never propose deleting a commitment. Completed and obsolete entries remain as history.

## Output discipline

- Keep values concise, factual, and useful for future continuity.
- Do not infer fulfillment, cancellation, deadlines, or participant obligations without source evidence.
- If no commitment was created or changed, return empty created and updated arrays.`,
    events: `# Major Event Memory Updates

Extract a selective chronology of durable narrative events from the Summary Target. This is not a transcript and must not duplicate every plot bullet.

## Scope and evidence boundary

- Create or update events only from developments established in the Summary Target.
- Character profiles, World Info, recent summaries, and current memory blocks may resolve identity and context, but they are not evidence that an event occurred or changed in this target.
- Record only events worth preserving for future narrative continuity. Omit routine movement, small talk, and actions with no durable consequence.
- Prefer empty arrays over trivial, speculative, redundant, or duplicate events.

## Creation and identity

- Add to created only when the target establishes a distinct event not already represented in Current Major Event Memory.
- Use a short, recognizable title and a concise summary preserving the event's cause, central action, and durable result.
- Never invent an ID. The extension assigns IDs after validation.
- Do not create a duplicate merely because a later target reveals additional consequences or changes the event's perceived importance. Update the existing event instead.

## Date and location

- Use the same established date notation as the chunk summary. Preserve explicit dates; otherwise continue the reliable Day N chronology.
- Keep date and location concise. Represent a meaningful transition with \" -> \" when the event spans multiple dates or locations.

## Importance and shifts

- importance must be exactly ordinary or turning_point.
- ordinary means a continuity-worthy event that does not fundamentally redirect the story.
- turning_point means the event substantially changes a relationship, goal, conflict, power balance, or persistent world state.
- shifts describes only durable before-to-after consequences caused by a turning point. Each shift must state what became different after the event.
- For ordinary events, shifts must be an empty array.
- For turning_point events, provide at least one concrete shift.

## Updating existing events

- Add to updated only when targetId was supplied by Current Major Event Memory. Copy it exactly.
- Never guess, synthesize, or modify a targetId.
- replace contains only fields whose established value or interpretation changed in this target. Omit every unchanged field.
- A later consequence may promote an ordinary event to turning_point. When doing so, replace importance and shifts together.
- If changing a turning point back to ordinary, return importance as ordinary and shifts as an empty array.
- Never propose deleting an event. Leave deletion or correction to the user.
- If no major event was created or changed, return empty created and updated arrays.`,
});

const LEGACY_SUMMARY_EXTRACTION_IDS = Object.freeze({
    'summary-title': 'title',
    'summary-date': 'date',
    'summary-time': 'time',
    'summary-location': 'location',
    'summary-plot': 'plot',
    'summary-continuity': 'continuity',
    'summary-emotions': 'emotions',
    'summary-quotes': 'quotes',
    'summary-tags': 'tags',
});

export function getDefaultSummaryExtractionRules() {
    return structuredClone(DEFAULT_SUMMARY_EXTRACTION_RULES);
}

export const PROVIDERS = Object.freeze([
    { value: 'openai', label: 'OpenAI' },
    { value: 'claude', label: 'Claude' },
    { value: 'google', label: 'Google AI Studio' },
    { value: 'vertexai', label: 'Vertex AI' },
    { value: 'openrouter', label: 'OpenRouter' },
]);

const LEGACY_DEFAULT_SUMMARY_MAIN_PROMPT = `# Summary Task

You are a professional conversation summarizer. Summarize the provided conversation segment while preserving concrete events, decisions, relationships, emotional changes, important details, and unresolved information. Do not invent facts that are not present in the conversation.`;

const DEFAULT_SUMMARY_MAIN_PROMPT = `# Summary Task

You are a professional long-term memory writer for an ongoing fictional roleplay conversation. Analyze only the messages inside <Summary Target> and produce a compact but self-contained memory of that range. Preserve chronology, causal relationships, names, concrete actions, and details that may affect later behavior. Use character profiles, World Info, and recent summaries only to resolve context; do not report them as events unless they occur in the target messages. Do not invent unsupported facts.`;

const DEFAULT_REVISION_MAIN_PROMPT = `# Summary Revision

You are revising an existing conversation summary. Apply the user's feedback accurately while preserving useful facts and chronology from the current summary.`;

const DEFAULT_REVISION_TEMPLATE = 'Return only the revised summary without a preface, explanation, or commentary.';

const DEFAULT_SUMMARY_RECORD_TEMPLATE = `<Summary range="#{{sumiRecordStartId}} ~ #{{sumiRecordEndId}}">
{{sumiRecordContent}}
</Summary>`;

const LEGACY_PERSON_CONTEXT_TEMPLATE = `## {{sumiPersonName}}
{{sumiPersonAliases}}
{{sumiPersonFacts}}
{{sumiPersonRoles}}
{{sumiPersonAffiliations}}
{{sumiPersonPersonality}}
{{sumiPersonSpeech}}
{{sumiPersonState}}
{{sumiPersonRelationships}}`;

const DEFAULT_PERSON_CONTEXT_TEMPLATE = `## {{sumiPersonName}}
{{sumiPersonProvisional}}
{{sumiPersonAliases}}
{{sumiPersonRole}}
{{sumiPersonAge}}
{{sumiPersonOccupation}}
{{sumiPersonAppearance}}
{{sumiPersonAffiliations}}
{{sumiPersonTraits}}
{{sumiPersonVoice}}
{{sumiPersonState}}
{{sumiPersonRelationships}}`;

export const SUMMARY_CONTEXT_BLOCK_KINDS = Object.freeze({
    RECORDS: 'records',
    EVENTS: 'events',
    PEOPLE: 'people',
    ITEMS: 'items',
    COMMITMENTS: 'commitments',
});

const SUMMARY_CONTEXT_BLOCK_DEFINITIONS = Object.freeze([
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS,
        name: '시간순 요약 레코드',
        prefixTemplate: '',
        entryTemplate: DEFAULT_SUMMARY_RECORD_TEMPLATE,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS,
        name: '주요 사건',
        prefixTemplate: '# Major Events',
        entryTemplate: `## {{sumiEventTitle}}
- date: {{sumiEventDate}}
- location: {{sumiEventLocation}}
- event: {{sumiEventSummary}}
{{sumiEventShifts}}`,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE,
        name: '현재 인물 도감',
        prefixTemplate: '# Current People',
        entryTemplate: DEFAULT_PERSON_CONTEXT_TEMPLATE,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.ITEMS,
        name: '현재 아이템 도감',
        prefixTemplate: '# Current Items',
        entryTemplate: `## {{sumiItemName}}
{{sumiItemAliases}}
{{sumiItemFacts}}
{{sumiItemFunctions}}
{{sumiItemState}}`,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.COMMITMENTS,
        name: '서약 장부',
        prefixTemplate: '# Commitment Ledger',
        entryTemplate: `## {{sumiCommitmentTitle}}
- status: {{sumiCommitmentStatus}}
- terms: {{sumiCommitmentTerms}}
{{sumiCommitmentParticipants}}
{{sumiCommitmentConditions}}
{{sumiCommitmentDeadline}}
{{sumiCommitmentFacts}}
{{sumiCommitmentStatusReason}}`,
        suffixTemplate: '',
    },
]);

export function getDefaultSummaryContextBlocks() {
    const order = [
        SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS,
        SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE,
        SUMMARY_CONTEXT_BLOCK_KINDS.ITEMS,
        SUMMARY_CONTEXT_BLOCK_KINDS.COMMITMENTS,
        SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS,
    ];
    return [...SUMMARY_CONTEXT_BLOCK_DEFINITIONS]
        .sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind))
        .map(definition => ({
        ...definition,
        enabled: true,
        }));
}

export const defaultSettings = Object.freeze({
    enabled: true,
    connectionMode: 'profile',
    connection: {
        profile: {
            provider: '',
            model: '',
            maxTokens: 5000,
            temperature: 0.9,
            topP: 1,
            topK: 0,
        },
        custom: {
            provider: 'openai',
            model: '',
            maxTokens: 5000,
            temperature: 0.9,
            topP: 1,
            topK: 0,
        },
    },
    summarization: {
        chunkSize: 30,
        outputLanguage: SUMMARY_LANGUAGE_MODES.ENGLISH,
        summarySections: DEFAULT_SUMMARY_SECTIONS,
        memorySections: DEFAULT_MEMORY_SECTIONS,
        injectionMaxTokens: 24000,
        autoHideSummarizedMessages: false,
        recordTemplate: DEFAULT_SUMMARY_RECORD_TEMPLATE,
        contextBlocks: getDefaultSummaryContextBlocks(),
        injection: {
            mode: 'macro',
            position: 'after',
            depth: 4,
            role: 'system',
        },
        prompts: {
            summary: createPromptEditorDefaults(PROMPT_TYPES.SUMMARY),
            revision: createPromptEditorDefaults(PROMPT_TYPES.REVISION),
        },
    },
    translation: {
        method: 'basic',
        provider: 'google',
        targetLanguage: 'ko',
        autoTranslate: false,
    },
});

export function getSettings() {
    const extensionSettings = SillyTavern.getContext().extensionSettings;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    const migrateLegacyContextBlocks = !Array.isArray(extensionSettings[MODULE_NAME]?.summarization?.contextBlocks);
    mergeDefaults(extensionSettings[MODULE_NAME], defaultSettings);
    normalizeSettings(extensionSettings[MODULE_NAME], { migrateLegacyContextBlocks });
    return extensionSettings[MODULE_NAME];
}

export function saveSettings() {
    saveSettingsDebounced();
}

export function setExtensionEnabled(enabled) {
    const settings = getSettings();
    settings.enabled = Boolean(enabled);
    saveSettings();
    return settings.enabled;
}

export async function saveSettingsNow() {
    await saveSillyTavernSettings();
}

export function setChunkSize(value) {
    const settings = getSettings();
    settings.summarization.chunkSize = clampInteger(value, 1, 1000, defaultSettings.summarization.chunkSize);
    saveSettings();
    return settings.summarization.chunkSize;
}

export function setAutoHideSummarizedMessages(enabled) {
    const settings = getSettings();
    settings.summarization.autoHideSummarizedMessages = Boolean(enabled);
    saveSettings();
    return settings.summarization.autoHideSummarizedMessages;
}

export function setSummarizationSettings(patch) {
    const settings = getSettings();
    Object.assign(settings.summarization, patch);
    normalizeSettings(settings);
    saveSettings();
    window.dispatchEvent(new CustomEvent('stsm:injection-settings-changed'));
    return settings.summarization;
}

export function setSummarySectionEnabled(section, enabled) {
    if (!Object.hasOwn(DEFAULT_SUMMARY_SECTIONS, section) || section === 'plot') return false;
    const settings = getSettings();
    settings.summarization.summarySections[section] = Boolean(enabled);
    saveSettings();
    return settings.summarization.summarySections[section];
}

export function setMemorySectionEnabled(section, enabled) {
    if (!Object.hasOwn(DEFAULT_MEMORY_SECTIONS, section)) return false;
    const settings = getSettings();
    settings.summarization.memorySections[section] = Boolean(enabled);
    saveSettings();
    return settings.summarization.memorySections[section];
}

export function getSummaryContextBlocks() {
    return structuredClone(getSettings().summarization.contextBlocks);
}

export function setSummaryContextBlockEnabled(kind, enabled) {
    return updateSummaryContextBlock(kind, { enabled: Boolean(enabled) });
}

export function updateSummaryContextBlock(kind, patch) {
    const settings = getSettings();
    const block = settings.summarization.contextBlocks.find(item => item.kind === kind);
    if (!block) return null;
    if (Object.hasOwn(patch, 'enabled')) block.enabled = Boolean(patch.enabled);
    for (const key of ['prefixTemplate', 'entryTemplate', 'suffixTemplate']) {
        if (Object.hasOwn(patch, key)) block[key] = String(patch[key] ?? '');
    }
    if (kind === SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS && Object.hasOwn(patch, 'entryTemplate')) {
        settings.summarization.recordTemplate = block.entryTemplate;
    }
    saveSettings();
    window.dispatchEvent(new CustomEvent('stsm:injection-settings-changed'));
    return structuredClone(block);
}

export function moveSummaryContextBlock(sourceKind, targetKind) {
    const settings = getSettings();
    const blocks = settings.summarization.contextBlocks;
    const sourceIndex = blocks.findIndex(block => block.kind === sourceKind);
    const targetIndex = blocks.findIndex(block => block.kind === targetKind);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;
    const [source] = blocks.splice(sourceIndex, 1);
    const insertionIndex = blocks.findIndex(block => block.kind === targetKind);
    blocks.splice(insertionIndex, 0, source);
    saveSettings();
    window.dispatchEvent(new CustomEvent('stsm:injection-settings-changed'));
    return true;
}

export function setTranslationSettings(patch) {
    const settings = getSettings();
    settings.translation = normalizeTranslationSettings({
        ...settings.translation,
        ...patch,
    });
    saveSettings();
    return settings.translation;
}

export function resetActiveConnectionSettings() {
    const settings = getSettings();
    const mode = settings.connectionMode;
    settings.connection[mode] = structuredClone(defaultSettings.connection[mode]);
    saveSettings();
    return settings.connection[mode];
}

export function getPromptEditor(type) {
    return getSettings().summarization.prompts[type];
}

export function getActivePreset(type) {
    const editor = getPromptEditor(type);
    return getActivePresetFromEditor(editor);
}

export function setActivePreset(type, presetId) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    if (!editor.presets.some(preset => preset.id === presetId)) return false;

    editor.activePresetId = presetId;
    saveSettings();
    return true;
}

export function setPromptSeparatorsHidden(type, hidden) {
    const editor = getPromptEditor(type);
    editor.hideSeparators = Boolean(hidden);
    saveSettings();
    return editor.hideSeparators;
}

export function addPromptBlock(type, name, content) {
    const block = createPromptBlock({ name, content });
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: [...preset.blocks, block],
    }));
    saveSettings();
    return block;
}

export function updatePromptBlock(type, blockId, patch) {
    let updatedBlock = null;
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: preset.blocks.map(block => {
            if (block.id !== blockId) return block;
            updatedBlock = createPromptBlock({ ...block, ...patch, id: block.id, kind: block.kind, locked: block.locked });
            return updatedBlock;
        }),
    }));

    if (updatedBlock) saveSettings();
    return updatedBlock;
}

export function setPromptBlockEnabled(type, blockId, enabled) {
    let didUpdate = false;
    updateActivePreset(type, preset => ({
        ...preset,
        blocks: preset.blocks.map(block => {
            if (block.id !== blockId) return block;
            if (isRequiredPromptBlock(block)) return block;
            didUpdate = true;
            return createPromptBlock({ ...block, enabled });
        }),
    }));

    if (didUpdate) saveSettings();
    return didUpdate;
}

export function isRequiredPromptBlock(block) {
    return [
        BLOCK_KINDS.SUMMARY_PLOT,
        BLOCK_KINDS.SUMMARY_LANGUAGE,
        BLOCK_KINDS.SUMMARY_EXTRACTION_RULES,
        BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT,
        BLOCK_KINDS.PEOPLE_MEMORY,
        BLOCK_KINDS.ITEM_MEMORY,
        BLOCK_KINDS.COMMITMENT_MEMORY,
        BLOCK_KINDS.EVENT_MEMORY,
    ].includes(block?.kind);
}

export function removePromptBlock(type, blockId) {
    const preset = getActivePreset(type);
    const block = preset.blocks.find(item => item.id === blockId);
    if (!block || block.locked) return false;

    updateActivePreset(type, current => ({
        ...current,
        blocks: current.blocks.filter(item => item.id !== blockId),
    }));
    saveSettings();
    return true;
}

export function movePromptBlock(type, sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return false;

    const preset = getActivePreset(type);
    const sourceIndex = preset.blocks.findIndex(block => block.id === sourceId);
    const targetIndex = preset.blocks.findIndex(block => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;

    const blocks = [...preset.blocks];
    const [moved] = blocks.splice(sourceIndex, 1);
    blocks.splice(targetIndex, 0, moved);
    replaceActivePreset(type, { ...preset, blocks });
    saveSettings();
    return true;
}

export function createPresetFromActive(type, name) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    const source = getActivePresetFromEditor(editor);
    const preset = createPreset({
        name: String(name || '').trim(),
        blocks: structuredClone(source.blocks),
    });

    editor.presets = [...editor.presets, preset];
    editor.activePresetId = preset.id;
    saveSettings();
    return preset;
}

export function deleteActivePreset(type) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    const active = getActivePresetFromEditor(editor);
    if (active.id === getDefaultPreset(type).id || editor.presets.length <= 1) return false;

    editor.presets = editor.presets.filter(preset => preset.id !== active.id);
    editor.activePresetId = editor.presets[0].id;
    saveSettings();
    return true;
}

export function resetActivePreset(type) {
    const active = getActivePreset(type);
    const defaults = getDefaultPreset(type);
    replaceActivePreset(type, {
        ...active,
        blocks: structuredClone(defaults.blocks),
    });
    saveSettings();
    return getActivePreset(type);
}

export function createPromptBlock({
    id = createId('block'),
    name = '새 프롬프트',
    content = '',
    enabled = true,
    locked = false,
    kind = BLOCK_KINDS.EDITABLE,
    separator = false,
    config = {},
} = {}) {
    const normalizedKind = Object.values(BLOCK_KINDS).includes(kind) ? kind : BLOCK_KINDS.EDITABLE;
    return {
        id,
        name: String(name || '새 프롬프트'),
        content: String(content || ''),
        enabled: isRequiredPromptBlock({ kind: normalizedKind }) ? true : Boolean(enabled),
        locked: Boolean(locked),
        kind: normalizedKind,
        separator: Boolean(separator),
        config: normalizePromptBlockConfig(normalizedKind, config),
    };
}

function createPromptEditorDefaults(type) {
    const preset = getDefaultPreset(type);
    return {
        schemaVersion: PROMPT_SCHEMA_VERSION,
        hideSeparators: false,
        activePresetId: preset.id,
        presets: [preset],
    };
}

function getDefaultPreset(type) {
    if (type === PROMPT_TYPES.REVISION) {
        return createPreset({
            id: 'default-revision',
            name: '기본 프리셋',
            blocks: [
                createPromptBlock({ id: 'revision-main', name: '수정 대화 기본 지시문', content: DEFAULT_REVISION_MAIN_PROMPT, locked: true }),
                ...createCurrentSummaryBlocks(),
                ...createRevisionConversationBlocks(),
                createPromptBlock({ id: 'revision-template', name: '수정 결과 템플릿', content: DEFAULT_REVISION_TEMPLATE, locked: true }),
            ],
        });
    }

    return createPreset({
        id: 'default-summary',
        name: '기본 프리셋',
        blocks: [
            createPromptBlock({ id: 'summary-main', name: 'Main Prompt', content: DEFAULT_SUMMARY_MAIN_PROMPT, locked: true }),
            ...createCharacterInformationBlocks(),
            ...createWorldInfoBlocks(),
            ...createRecentSummaryBlocks(),
            ...createSummaryTargetBlocks(),
            ...createStructuredSummaryBlocks(),
        ],
    });
}

function createStructuredSummaryBlocks() {
    return [
        createPromptBlock({
            id: 'summary-language',
            name: '출력 언어',
            content: '# Output Language\n\n{{sumiSummaryLanguageInstruction}}',
            locked: true,
            kind: BLOCK_KINDS.SUMMARY_LANGUAGE,
        }),
        createPromptBlock({
            id: 'summary-extraction-rules',
            name: '요약 추출 규칙',
            content: '',
            locked: true,
            kind: BLOCK_KINDS.SUMMARY_EXTRACTION_RULES,
            config: { rules: getDefaultSummaryExtractionRules() },
        }),
        createPromptBlock({
            id: 'people-memory',
            name: '현재 인물 도감',
            content: '<Current People Memory>\n{{sumiPeopleMemory}}\n</Current People Memory>',
            locked: true,
            kind: BLOCK_KINDS.PEOPLE_MEMORY,
        }),
        createPromptBlock({
            id: 'item-memory',
            name: '현재 아이템 도감',
            content: '<Current Item Memory>\n{{sumiItemMemory}}\n</Current Item Memory>',
            locked: true,
            kind: BLOCK_KINDS.ITEM_MEMORY,
        }),
        createPromptBlock({
            id: 'commitment-memory',
            name: '현재 서약 장부',
            content: '<Current Commitment Memory>\n{{sumiCommitmentMemory}}\n</Current Commitment Memory>',
            locked: true,
            kind: BLOCK_KINDS.COMMITMENT_MEMORY,
        }),
        createPromptBlock({
            id: 'event-memory',
            name: '현재 주요 사건',
            content: '<Current Major Event Memory>\n{{sumiEventMemory}}\n</Current Major Event Memory>',
            locked: true,
            kind: BLOCK_KINDS.EVENT_MEMORY,
        }),
        createPromptBlock({
            id: 'summary-output-contract',
            name: 'JSON 출력 형식 · 자동 생성',
            content: '{{sumiSummaryJsonContract}}',
            locked: true,
            kind: BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT,
        }),
    ];
}

function createCharacterInformationBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'character-info';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '캐릭터 정보 구분선 시작', content: '<Character Information>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-description`, name: '{{char}} 설정', content: '## {{char}} Profile\n\n{{sumiCharacterDescription}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_DESCRIPTION }),
        createPromptBlock({ id: `${prefix}-personality`, name: '{{char}} 성격', content: '## Personality\n\n{{sumiCharacterPersonality}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_PERSONALITY }),
        createPromptBlock({ id: `${prefix}-scenario`, name: '시나리오', content: '## Scenario\n\n{{sumiCharacterScenario}}', enabled, locked: true, kind: BLOCK_KINDS.CHARACTER_SCENARIO }),
        createPromptBlock({ id: `${prefix}-persona`, name: '{{user}} 설정', content: '## {{user}} Profile\n\n{{sumiPersona}}', enabled, locked: true, kind: BLOCK_KINDS.PERSONA }),
        createPromptBlock({ id: `${prefix}-end`, name: '캐릭터 정보 구분선 끝', content: '</Character Information>', enabled, locked: true, separator: true }),
    ];
}

function createWorldInfoBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'world-info';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '월드 인포 구분선 시작', content: '<World Info>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-content`, name: '월드 인포', content: '{{sumiWorldInfo}}', enabled, locked: true, kind: BLOCK_KINDS.WORLD_INFO }),
        createPromptBlock({ id: `${prefix}-end`, name: '월드 인포 구분선 끝', content: '</World Info>', enabled, locked: true, separator: true }),
    ];
}

function createRecentSummaryBlocks() {
    return [
        createPromptBlock({ id: 'recent-summaries-start', name: '최근 요약 구분선 시작', content: '<Recent Summaries>', locked: true, separator: true, kind: BLOCK_KINDS.RECENT_SUMMARY_SEPARATOR }),
        createPromptBlock({ id: 'recent-summaries-content', name: '최근 요약', content: '{{sumiRecentSummaries}}', locked: true, kind: BLOCK_KINDS.RECENT_SUMMARIES }),
        createPromptBlock({ id: 'recent-summaries-end', name: '최근 요약 구분선 끝', content: '</Recent Summaries>', locked: true, separator: true, kind: BLOCK_KINDS.RECENT_SUMMARY_SEPARATOR }),
    ];
}

function createSummaryTargetBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'summary-target';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '요약 대상 구분선 시작', content: '<Summary Target range="#{{sumiStartId}} ~ #{{sumiEndId}}">', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-messages`, name: '요약 대상 메시지 포맷', content: '#{{sumiMessageId}} {{sumiMessageName}}: {{sumiMessageContent}}', enabled, locked: true, kind: BLOCK_KINDS.SUMMARY_MESSAGES }),
        createPromptBlock({ id: `${prefix}-end`, name: '요약 대상 구분선 끝', content: '</Summary Target>', enabled, locked: true, separator: true }),
    ];
}

function createCurrentSummaryBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'current-summary';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '현재 요약 구분선 시작', content: '<Current Summary>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-content`, name: '현재 요약', content: '{{sumiCurrentSummary}}', enabled, locked: true, kind: BLOCK_KINDS.CURRENT_SUMMARY }),
        createPromptBlock({ id: `${prefix}-end`, name: '현재 요약 구분선 끝', content: '</Current Summary>', enabled, locked: true, separator: true }),
    ];
}

function createRevisionConversationBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'revision-history';
    return [
        createPromptBlock({ id: `${prefix}-start`, name: '수정 대화 구분선 시작', content: '<Revision Conversation>', enabled, locked: true, separator: true }),
        createPromptBlock({ id: `${prefix}-messages`, name: '수정 대화 메시지 포맷', content: '<RevisionMessage role="{{sumiRevisionRole}}">\n{{sumiRevisionMessage}}\n</RevisionMessage>', enabled, locked: true, kind: BLOCK_KINDS.REVISION_MESSAGES }),
        createPromptBlock({ id: `${prefix}-end`, name: '수정 대화 구분선 끝', content: '</Revision Conversation>', enabled, locked: true, separator: true }),
    ];
}

function createPreset({ id = createId('preset'), name = '새 프리셋', blocks = [] } = {}) {
    return {
        id,
        name: String(name || '새 프리셋'),
        blocks: blocks.map(block => createPromptBlock(block)),
    };
}

function getActivePresetFromEditor(editor) {
    return editor.presets.find(preset => preset.id === editor.activePresetId) || editor.presets[0];
}

function updateActivePreset(type, updater) {
    const current = getActivePreset(type);
    replaceActivePreset(type, updater(current));
}

function replaceActivePreset(type, nextPreset) {
    const settings = getSettings();
    const editor = settings.summarization.prompts[type];
    editor.presets = editor.presets.map(preset => (
        preset.id === nextPreset.id ? createPreset(nextPreset) : preset
    ));
}

function normalizeSettings(settings, { migrateLegacyContextBlocks = false } = {}) {
    settings.enabled = Boolean(settings.enabled);
    settings.connectionMode = ['profile', 'custom'].includes(settings.connectionMode) ? settings.connectionMode : 'profile';
    settings.connection.profile = normalizeConnection(settings.connection.profile, defaultSettings.connection.profile);
    settings.connection.custom = normalizeConnection(settings.connection.custom, defaultSettings.connection.custom);
    settings.summarization.chunkSize = clampInteger(settings.summarization.chunkSize, 1, 1000, defaultSettings.summarization.chunkSize);
    settings.summarization.outputLanguage = Object.values(SUMMARY_LANGUAGE_MODES).includes(settings.summarization.outputLanguage)
        ? settings.summarization.outputLanguage
        : defaultSettings.summarization.outputLanguage;
    settings.summarization.summarySections = normalizeSummarySections(settings.summarization.summarySections);
    settings.summarization.memorySections = normalizeMemorySections(settings.summarization.memorySections);
    delete settings.summarization.autoStartFromLastSummary;
    settings.summarization.injectionMaxTokens = clampInteger(settings.summarization.injectionMaxTokens, 100, 200000, defaultSettings.summarization.injectionMaxTokens);
    settings.summarization.autoHideSummarizedMessages = Boolean(settings.summarization.autoHideSummarizedMessages);
    settings.summarization.recordTemplate = String(settings.summarization.recordTemplate ?? defaultSettings.summarization.recordTemplate);
    settings.summarization.contextBlocks = normalizeSummaryContextBlocks(
        migrateLegacyContextBlocks ? [] : settings.summarization.contextBlocks,
        settings.summarization.recordTemplate,
    );
    settings.summarization.injection = normalizeInjectionSettings(settings.summarization.injection);
    settings.translation = normalizeTranslationSettings(settings.translation);

    for (const type of Object.values(PROMPT_TYPES)) {
        settings.summarization.prompts[type] = normalizePromptEditor(settings.summarization.prompts[type], type);
    }
}

function normalizeInjectionSettings(injection) {
    const source = injection && typeof injection === 'object' ? injection : {};
    return {
        mode: ['macro', 'depth', 'prompt'].includes(source.mode) ? source.mode : 'macro',
        position: ['before', 'after'].includes(source.position) ? source.position : 'after',
        depth: clampInteger(source.depth, 0, 10000, 4),
        role: ['system', 'user', 'assistant'].includes(source.role) ? source.role : 'system',
    };
}

function normalizeSummaryContextBlocks(value, legacyRecordTemplate) {
    const defaults = getDefaultSummaryContextBlocks();
    const defaultsByKind = new Map(defaults.map(block => [block.kind, block]));
    const source = Array.isArray(value) ? value : [];
    const normalized = [];
    for (const candidate of source) {
        const fallback = defaultsByKind.get(candidate?.kind);
        if (!fallback || normalized.some(block => block.kind === fallback.kind)) continue;
        normalized.push({
            kind: fallback.kind,
            name: fallback.name,
            enabled: candidate.enabled === undefined ? fallback.enabled : Boolean(candidate.enabled),
            prefixTemplate: String(candidate.prefixTemplate ?? fallback.prefixTemplate),
            entryTemplate: fallback.kind === SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE
                && String(candidate.entryTemplate ?? '') === LEGACY_PERSON_CONTEXT_TEMPLATE
                ? fallback.entryTemplate
                : String(candidate.entryTemplate ?? fallback.entryTemplate),
            suffixTemplate: String(candidate.suffixTemplate ?? fallback.suffixTemplate),
        });
    }
    for (const fallback of defaults) {
        if (normalized.some(block => block.kind === fallback.kind)) continue;
        normalized.push({
            ...fallback,
            entryTemplate: fallback.kind === SUMMARY_CONTEXT_BLOCK_KINDS.RECORDS
                ? String(legacyRecordTemplate || fallback.entryTemplate)
                : fallback.entryTemplate,
        });
    }
    return normalized;
}

function normalizeTranslationSettings(translation) {
    const source = translation && typeof translation === 'object' ? translation : {};
    const providers = ['google', 'bing'];
    const targetLanguages = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];

    return {
        method: 'basic',
        provider: providers.includes(source.provider) ? source.provider : defaultSettings.translation.provider,
        targetLanguage: targetLanguages.includes(source.targetLanguage)
            ? source.targetLanguage
            : defaultSettings.translation.targetLanguage,
        autoTranslate: Boolean(source.autoTranslate),
    };
}

function normalizeSummarySections(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(DEFAULT_SUMMARY_SECTIONS).map(([key, fallback]) => [
        key,
        key === 'plot' ? true : source[key] === undefined ? fallback : Boolean(source[key]),
    ]));
}

function normalizeMemorySections(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(DEFAULT_MEMORY_SECTIONS).map(([key, fallback]) => [
        key,
        source[key] === undefined ? fallback : Boolean(source[key]),
    ]));
}

function normalizeConnection(connection, fallback) {
    const source = connection && typeof connection === 'object' ? connection : {};
    return {
        provider: String(source.provider ?? fallback.provider),
        model: String(source.model ?? fallback.model),
        maxTokens: clampInteger(source.maxTokens, 1, 200000, fallback.maxTokens),
        temperature: clampNumber(source.temperature, 0, 2, fallback.temperature),
        topP: clampNumber(source.topP, 0, 1, fallback.topP),
        topK: clampInteger(source.topK, 0, 200, fallback.topK),
    };
}

function normalizePromptEditor(editor, type) {
    const defaultPreset = getDefaultPreset(type);
    const source = editor && typeof editor === 'object' ? editor : {};
    const hasStoredPresets = Array.isArray(source.presets) && source.presets.length;
    const sourceSchemaVersion = Number(source.schemaVersion || 1);
    const needsMigration = hasStoredPresets && (
        sourceSchemaVersion < PROMPT_SCHEMA_VERSION
        || source.presets.some(hasLegacyPromptBlocks)
        || (type === PROMPT_TYPES.SUMMARY && source.presets.some(hasLegacySummaryExtractionBlocks))
    );
    let presets = hasStoredPresets
        ? source.presets.map(preset => createPreset(needsMigration ? migratePromptPreset(preset, type, sourceSchemaVersion) : preset))
        : [defaultPreset];

    if (!presets.some(preset => preset.id === defaultPreset.id)) {
        presets = [defaultPreset, ...presets];
    }

    const activePresetId = presets.some(preset => preset.id === source.activePresetId)
        ? source.activePresetId
        : presets[0].id;

    return {
        schemaVersion: PROMPT_SCHEMA_VERSION,
        hideSeparators: Boolean(source.hideSeparators),
        activePresetId,
        presets,
    };
}

function hasLegacyPromptBlocks(preset) {
    return Array.isArray(preset?.blocks) && preset.blocks.some(block => (
        [BLOCK_KINDS.LEGACY_CHARACTER, BLOCK_KINDS.LEGACY_SUMMARY_TARGET, BLOCK_KINDS.LEGACY_REVISION_HISTORY].includes(block?.kind)
        || (block?.kind === BLOCK_KINDS.WORLD_INFO && !String(block.content || '').trim())
        || (block?.kind === BLOCK_KINDS.CURRENT_SUMMARY && !String(block.content || '').trim())
    ));
}

function hasLegacySummaryExtractionBlocks(preset) {
    return Array.isArray(preset?.blocks) && preset.blocks.some(block => getLegacySummaryExtractionKey(block));
}

function migratePromptPreset(preset, type, sourceSchemaVersion) {
    const blocks = Array.isArray(preset?.blocks) ? preset.blocks : [];
    let migratedBlocks = blocks.flatMap(block => {
        if (block?.kind === BLOCK_KINDS.LEGACY_CHARACTER) return createCharacterInformationBlocks(block);
        if (block?.kind === BLOCK_KINDS.WORLD_INFO && !String(block.content || '').trim()) return createWorldInfoBlocks(block);
        if (block?.kind === BLOCK_KINDS.LEGACY_SUMMARY_TARGET) return createSummaryTargetBlocks(block);
        if (block?.kind === BLOCK_KINDS.CURRENT_SUMMARY && !String(block.content || '').trim()) return createCurrentSummaryBlocks(block);
        if (block?.kind === BLOCK_KINDS.LEGACY_REVISION_HISTORY) return createRevisionConversationBlocks(block);
        return { ...block, separator: block.separator ?? isKnownSeparatorBlock(block) };
    });

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 3
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.RECENT_SUMMARIES)) {
        const targetMessageIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_MESSAGES);
        const insertIndex = targetMessageIndex < 0
            ? migratedBlocks.length
            : targetMessageIndex > 0 && migratedBlocks[targetMessageIndex - 1]?.separator
                ? targetMessageIndex - 1
                : targetMessageIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            ...createRecentSummaryBlocks(),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 4
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.SUMMARY_PLOT)) {
        migratedBlocks = migratedBlocks.map(block => (
            block.id === 'summary-main' && String(block.content || '').trim() === LEGACY_DEFAULT_SUMMARY_MAIN_PROMPT.trim()
                ? { ...block, content: DEFAULT_SUMMARY_MAIN_PROMPT }
                : block
        ));
        const legacyTemplateIndex = migratedBlocks.findIndex(block => block.id === 'summary-template');
        const insertIndex = legacyTemplateIndex < 0 ? migratedBlocks.length : legacyTemplateIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            ...createStructuredSummaryBlocks(),
            ...migratedBlocks.slice(insertIndex).map(block => (
                block.id === 'summary-template' ? { ...block, enabled: false } : block
            )),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY
        && (sourceSchemaVersion < 5 || hasLegacySummaryExtractionBlocks({ blocks: migratedBlocks }))) {
        migratedBlocks = migrateSummaryExtractionRules(migratedBlocks);
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 6
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.PEOPLE_MEMORY)) {
        const extractionIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES);
        const insertIndex = extractionIndex < 0 ? migratedBlocks.length : extractionIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            createPromptBlock({
                id: 'people-memory',
                name: '현재 인물 도감',
                content: '<Current People Memory>\n{{sumiPeopleMemory}}\n</Current People Memory>',
                locked: true,
                kind: BLOCK_KINDS.PEOPLE_MEMORY,
            }),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 7
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.ITEM_MEMORY)) {
        const contractIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT);
        const insertIndex = contractIndex < 0 ? migratedBlocks.length : contractIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            createPromptBlock({
                id: 'item-memory',
                name: '현재 아이템 도감',
                content: '<Current Item Memory>\n{{sumiItemMemory}}\n</Current Item Memory>',
                locked: true,
                kind: BLOCK_KINDS.ITEM_MEMORY,
            }),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 8
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.COMMITMENT_MEMORY)) {
        const contractIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT);
        const insertIndex = contractIndex < 0 ? migratedBlocks.length : contractIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            createPromptBlock({
                id: 'commitment-memory',
                name: '현재 서약 장부',
                content: '<Current Commitment Memory>\n{{sumiCommitmentMemory}}\n</Current Commitment Memory>',
                locked: true,
                kind: BLOCK_KINDS.COMMITMENT_MEMORY,
            }),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 9
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.EVENT_MEMORY)) {
        const contractIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT);
        const insertIndex = contractIndex < 0 ? migratedBlocks.length : contractIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            createPromptBlock({
                id: 'event-memory',
                name: '현재 주요 사건',
                content: '<Current Major Event Memory>\n{{sumiEventMemory}}\n</Current Major Event Memory>',
                locked: true,
                kind: BLOCK_KINDS.EVENT_MEMORY,
            }),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 10) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const config = normalizePromptBlockConfig(block.kind, block.config);
            return {
                ...block,
                config: {
                    ...config,
                    rules: {
                        ...config.rules,
                        people: DEFAULT_SUMMARY_EXTRACTION_RULES.people,
                    },
                },
            };
        });
    }

    return {
        ...preset,
        blocks: migratedBlocks,
    };
}

function isKnownSeparatorBlock(block) {
    return Boolean(block?.locked && /(character-info|world-info|summary-target|current-summary|revision-history).*(?:-start|-end)$/.test(String(block.id || '')));
}

function migrateSummaryExtractionRules(blocks) {
    const definitionsByKind = new Map(SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(definition => [definition.kind, definition]));
    const existingGroup = blocks.find(block => block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES);
    const existingRules = normalizePromptBlockConfig(BLOCK_KINDS.SUMMARY_EXTRACTION_RULES, existingGroup?.config).rules;
    const legacyIndexes = [];
    const rules = { ...existingRules };

    blocks.forEach((block, index) => {
        const definition = definitionsByKind.get(block.kind);
        const key = definition?.key || getLegacySummaryExtractionKey(block);
        if (!key) return;
        legacyIndexes.push(index);
        const legacyContent = String(block.content || '').trim();
        if (legacyContent
            && rules[key] === DEFAULT_SUMMARY_EXTRACTION_RULES[key]
            && legacyContent !== DEFAULT_SUMMARY_EXTRACTION_RULES[key]) {
            rules[key] = String(block.content);
        }
    });

    const outputContractIndex = blocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT);
    const existingGroupIndex = blocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES);
    const candidateIndexes = [legacyIndexes[0], existingGroupIndex].filter(index => index >= 0);
    const insertIndex = candidateIndexes.length
        ? Math.min(...candidateIndexes)
        : outputContractIndex < 0 ? blocks.length : outputContractIndex;
    const extractionBlock = createPromptBlock({
        ...existingGroup,
        id: existingGroup?.id || 'summary-extraction-rules',
        name: existingGroup?.name || '요약 추출 규칙',
        locked: true,
        kind: BLOCK_KINDS.SUMMARY_EXTRACTION_RULES,
        config: { rules },
    });
    const normalizeContractName = block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT
        ? { ...block, name: 'JSON 출력 형식 · 자동 생성' }
        : block;
    const shouldRemove = block => block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES || Boolean(getLegacySummaryExtractionKey(block));
    const before = blocks.slice(0, insertIndex).filter(block => !shouldRemove(block)).map(normalizeContractName);
    const after = blocks.slice(insertIndex).filter(block => !shouldRemove(block)).map(normalizeContractName);
    return [...before, extractionBlock, ...after];
}

function getLegacySummaryExtractionKey(block) {
    return LEGACY_SUMMARY_EXTRACTION_IDS[String(block?.id || '')] || null;
}

function normalizePromptBlockConfig(kind, config) {
    const source = config && typeof config === 'object' ? config : {};
    if (kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) {
        const rules = source.rules && typeof source.rules === 'object' ? source.rules : {};
        return {
            rules: Object.fromEntries(SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(({ key }) => [
                key,
                String(rules[key] || DEFAULT_SUMMARY_EXTRACTION_RULES[key]),
            ])),
        };
    }

    if (kind !== BLOCK_KINDS.RECENT_SUMMARIES) return {};

    return {
        countLimit: {
            enabled: Boolean(source.countLimit?.enabled),
            value: clampInteger(source.countLimit?.value, 1, 1000, 3),
        },
        tokenLimit: {
            enabled: Boolean(source.tokenLimit?.enabled),
            value: clampInteger(source.tokenLimit?.value, 100, 200000, 4000),
        },
    };
}

function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (target[key] === undefined) {
            target[key] = structuredClone(value);
        } else if (isPlainObject(value) && isPlainObject(target[key])) {
            mergeDefaults(target[key], value);
        }
    }
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampInteger(value, min, max, fallback) {
    return Math.round(clampNumber(value, min, max, fallback));
}
