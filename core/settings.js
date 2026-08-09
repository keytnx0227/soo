import { saveSettings as saveSillyTavernSettings, saveSettingsDebounced } from '../../../../../script.js';
import { createId } from './utils.js';
import {
    DEFAULT_MEMORY_SECTIONS,
    DEFAULT_SUMMARY_SECTIONS,
    SUMMARY_LANGUAGE_MODES,
    SUMMARY_SECTION_KINDS,
} from '../summary/summary-format.js';
import {
    DEFAULT_SUMMARY_CONTENT_TEMPLATE,
    getSummaryContentTemplatePresetId,
    SUMMARY_CONTENT_TEMPLATE_PRESETS,
} from '../summary/summary-record-template.js';
import {
    COMPRESSION_CONTENT_TEMPLATE_PRESETS,
    DEFAULT_COMPRESSION_CONTENT_TEMPLATE,
    getCompressionContentTemplatePresetId,
    LEGACY_COMPRESSION_CONTENT_TEMPLATE_WITH_RELATIONSHIPS,
} from '../summary/compression-format.js';

export const MODULE_NAME = 'sumi_chat_summarizer';

export const PROMPT_TYPES = Object.freeze({
    SUMMARY: 'summary',
    REVISION: 'revision',
    COMPRESSION: 'compression',
});

const PROMPT_SCHEMA_VERSION = 23;

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
    REVISION_SUMMARY_MESSAGES: 'revisionSummaryMessages',
    REVISION_SUMMARY_SOURCE_SEPARATOR: 'revisionSummarySourceSeparator',
    REVISION_COMPRESSION_SOURCES: 'revisionCompressionSources',
    REVISION_COMPRESSION_SOURCE_SEPARATOR: 'revisionCompressionSourceSeparator',
    REVISION_MESSAGES: 'revisionMessages',
    LEGACY_CHARACTER: 'character',
    LEGACY_SUMMARY_TARGET: 'summaryTarget',
    LEGACY_REVISION_HISTORY: 'revisionHistory',
    SUMMARY_LANGUAGE: 'summaryLanguage',
    SUMMARY_EXTRACTION_RULES: 'summaryExtractionRules',
    SUMMARY_OUTPUT_CONTRACT: 'summaryOutputContract',
    COMPRESSION_SOURCES: 'compressionSources',
    COMPRESSION_OUTPUT_CONTRACT: 'compressionOutputContract',
    PEOPLE_MEMORY: 'peopleMemory',
    ITEM_MEMORY: 'itemMemory',
    COMMITMENT_MEMORY: 'commitmentMemory',
    EVENT_MEMORY: 'eventMemory',
    WORLD_MEMORY: 'worldMemory',
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
    { key: 'emotions', label: '감정', kind: SUMMARY_SECTION_KINDS.EMOTIONS },
    { key: 'quotes', label: '주요 대사', kind: SUMMARY_SECTION_KINDS.QUOTES },
    { key: 'tags', label: '검색 태그', kind: SUMMARY_SECTION_KINDS.TAGS },
    { key: 'people', label: '인물 도감', kind: null, category: 'memory' },
    { key: 'items', label: '아이템 도감', kind: null, category: 'memory' },
    { key: 'commitments', label: '서약 장부', kind: null, category: 'memory' },
    { key: 'events', label: '주요 사건', kind: null, category: 'memory' },
    { key: 'world', label: '세계 설정', kind: null, category: 'memory' },
]);

const PREVIOUS_DEFAULT_SUMMARY_EXTRACTION_RULES = Object.freeze({
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

const V11_DEFAULT_SUMMARY_EXTRACTION_RULES = Object.freeze({
    title: '# Title\n\nName the chunk with one short, specific title.',
    date: `# Date

Use an explicit story date when available; otherwise continue the latest reliable Day N, starting at Day 1 when none exists. Advance it only when the target supports elapsed days. Never use "unknown" or invent a calendar date. Use contextFlow for changes and relativeDate only when supported.`,
    time: '# Time\n\nRecord only explicit or reliably inferred story time. Use contextFlow for meaningful changes; never invent precise clock times.',
    location: '# Location\n\nRecord established locations and meaningful movement in order. Prefer specific known names; omit incidental positioning.',
    plot: `# Plot

Use the fewest chronological beats needed to preserve the causal story. Combine related actions; keep decisive choices and consequences. Omit gestures, atmosphere, routine movement, repeated reactions, and details without future value. Do not repeat information better owned by another enabled field. Plot requires at least one grounded beat.`,
    continuity: '# Continuity Changes\n\nRecord only lasting non-emotional changes needed later: knowledge, relationship status, goals, physical state, possessions, roles, affiliations, or access. Use short statements; omit unchanged facts and plot repetition.',
    emotions: '# Emotional Changes\n\nRecord only meaningful emotional transitions, not momentary reactions. Keep each state and source-grounded reason brief; use toward only for a clear target. Return none when no meaningful change occurred.',
    quotes: '# Key Dialogue\n\nKeep at most 2 lines whose exact wording matters for characterization, a promise, reveal, relationship change, or callback. Preserve wording under the language rule; omit merely representative dialogue.',
    tags: '# Retrieval Tags\n\nReturn 3-6 specific retrieval concepts for the chunk. Favor names, places, objects, distinctive events, relationship milestones, and promises; reject generic tags. canonical uses the output language and matchTerms uses concise source-language recall terms.',
    people: `# People Memory Updates

Maintain compact current profiles, never plot or action history.

- The Summary Target alone can create or change data; other context only resolves identity.
- Create the two leads on first clear characterization and other named people only when durably relevant. Ignore throwaway figures. A pivotal unnamed person may use one stable provisional handle; replace it with the real name later and append the handle to aliases.
- Create only unmatched people. Update only an exact targetId. Never guess IDs, duplicate, or delete. Append only new aliases; replace only changed current snapshots, using complete concise arrays. Return no proposal for unchanged or uncertain data.
- role, age, occupation, appearance, affiliations, traits, and voice contain only stable profile facts. voice is a speech pattern, never sample dialogue. Exclude actions, chronology, evidence, temporary moods, clothing, expressions, and injuries unless durable.
- lastKnownState is only the latest observed location and physical condition. relationships and feelings are directional current snapshots, not scene emotions.
- Keep scalars to a short phrase or one compact sentence, lists to a few useful entries, and never repeat information across fields.`,
    items: `# Item Memory Updates

Maintain compact current references for durable, narratively relevant objects, not a general inventory or event history.

- The Summary Target alone can create or change data; other context only resolves identity.
- Create only unmatched unique, named, plot-critical, emotionally significant, unusually capable, or continuity-sensitive items. Omit ordinary, decorative, disposable, or briefly handled objects.
- Update only an exact targetId. Never guess IDs, duplicate, or delete. Append only new aliases and durable facts; replace only changed snapshots, using the complete concise functions list. Return no proposal for unchanged or uncertain data.
- facts holds stable objective properties, origin, appearance, restrictions, inscriptions, or significance. functions holds established capabilities or purposes. Never infer hidden properties.
- lastKnownState distinguishes owner, holder, location, physical condition, and narrative status. Record only the latest supported state; destroyed or lost items remain with an updated state.
- Keep every value brief and avoid repeating plot, evidence, or scene actions.`,
    commitments: `# Commitment Memory Updates

Track durable promises, vows, agreements, obligations, and secrets with an explicit future duty. Exclude goals, wishes, threats, ordinary secrets, rhetoric, and vague plot hooks.

- The Summary Target alone can create or change data; other context only resolves identity.
- Create only a new, still-relevant commitment not already represented. Usually omit one created and resolved inside the same target. Use a short title and self-contained terms.
- Update only an exact targetId. Never guess IDs, duplicate, delete, or reactivate fulfilled/obsolete entries. Append only new supporting facts; replace only changed current fields, using complete participants and conditions arrays.
- participants are directly responsible, owed, protected, benefiting, or witnessing; copy known personId exactly. conditions are concrete requirements; deadline needs explicit or reliable relative support.
- status is pending, fulfilled, or obsolete. Fulfilled requires actual completion; obsolete means unresolved but no longer meaningful. Give one brief evidence-based statusReason.
- Keep all values concise and return no proposal for unchanged, uncertain, trivial, or redundant data.`,
    events: `# Event Index Updates

Maintain a sparse chronology of events worth recalling separately from the chunk summary.

- The Summary Target alone can establish an event or change; other context only resolves identity.
- Return at most 2 event proposals total. Keep only events with clear lasting plot, relationship, knowledge, commitment, status, or world consequences. Omit routine actions, ordinary conversation, minor conflict, repeated emotional beats, reactions, gestures, atmosphere, and scene texture. Do not extract an event merely because it appears in plot. When in doubt, omit.
- Use a short title and exactly one brief summary sentence containing only the essential trigger and decisive outcome. Do not repeat the title, intermediate actions, or details already preserved by the chunk summary.
- ordinary is notable but does not redirect the story. turning_point substantially redirects a relationship, goal, conflict, identity, power balance, or persistent world state.
- shift is null unless one turning_point caused a single essential lasting change. If used, write one short sentence without retelling the event.
- Keep date and location brief and chronologically consistent.
- Create no duplicate. Update only an exact targetId and only fields changed by this target. Never invent IDs or delete events. Return no proposal when nothing qualifies.`,
});

const V12_DEFAULT_QUOTES_RULE = '# Key Dialogue\n\nKeep 2-3 representative or important lines whose exact wording captures character voice, emotion, relationship dynamics, a reveal, promise, or memorable moment. Preserve wording under the language rule and keep context to one short phrase.';
const V12_DEFAULT_COMMITMENTS_RULE = V11_DEFAULT_SUMMARY_EXTRACTION_RULES.commitments;
const V13_DEFAULT_EVENTS_RULE = V11_DEFAULT_SUMMARY_EXTRACTION_RULES.events;
const V14_DEFAULT_EVENTS_RULE = V13_DEFAULT_EVENTS_RULE.replace(
    '- shift is null unless one turning_point caused a single essential lasting change. If used, write one short sentence without retelling the event.',
    '- shift is null unless one turning_point caused a single essential lasting change. If used, state only the resulting durable state in one short clause. Exclude the cause, process, actions, emotional reactions, explanation, and event recap. If the lasting change cannot be expressed that briefly, use null.',
);
const V18_DEFAULT_TAGS_RULE = V11_DEFAULT_SUMMARY_EXTRACTION_RULES.tags;
const V19_DEFAULT_TAGS_RULE = `# Retrieval Tags

Create 4-8 retrieval concepts that can cause this specific memory to be recalled from future chat. These are associative memory cues, not article tags, titles, event labels, or miniature plot summaries.

- Decompose the target into concrete recallable elements: distinctive people, places, objects, actions, evidence, promises, rituals, symbols, sensory details, and relationship milestones.
- canonical is one short concept label in the configured output language.
- matchTerms contains 2-6 atomic source-language cues likely to appear in later dialogue. Use names, nouns, base verbs, or very short noun phrases; no sentences, explanations, or plot clauses.
- Group synonyms and closely related lexical cues under one canonical instead of creating duplicate concepts.
- Preserve small but distinctive details when they could trigger the whole scene later. Do not reduce a scene to broad labels alone.
- Avoid context-free generic cues such as "conversation", "emotion", or "event". A broad cue may be included only when it names a real story concept, such as a particular case under investigation.
- Use only concepts grounded in the Summary Target.

Example: for a scene where someone investigates a case, finds suspicious evidence, visits a park, and sees a person holding roses while praying for another's safety, useful groups include case investigation [사건, 조사, 수사], suspicious evidence [증거, 단서], park [공원, 벤치], rose bouquet [장미, 꽃다발], and prayer for well-being [기도, 기원, 안녕, 무사]. Do not return only summary-like labels such as "suspicious evidence discovery" or "park visit".`;
const V20_DEFAULT_TAGS_RULE = `# Retrieval Tags

Create associative cues that can recall this specific memory from future roleplay. Matching is lexical, not semantic: every matchTerm must be a source-language string likely to reappear in dialogue or narration.

- Return usually 4-8 distinct concepts; return fewer for a sparse target and never pad the list.
- canonical is one short, specific concept label in the configured output language.
- matchTerms contains 2-6 complementary source-language cues for that concept. Prefer names, places, objects, symbols, sensory details, action stems, nouns, and very short phrases.
- Cover separate recall paths instead of reducing the scene to its broad topic: who, where, distinctive objects, decisive actions, promises, rituals, embodied details, and relationship milestones.
- Group synonyms, inflections, and closely related lexical cues under one canonical. Include forms likely to occur later; for an inflected word, add a useful stem or base cue when it improves matching.
- If exact wording is itself memorable, preserve the shortest distinctive quote fragment as one matchTerm and accompany it with normalized lexical cues. Do this only for a recurring phrase, nickname, code, promise, confession, or emotionally defining line. Never copy mundane dialogue or full sentences merely because they appear in the target.
- Never use article-style tags, titles, event summaries, explanations, or plot clauses as matchTerms. Avoid context-free labels such as "conversation", "emotion", or "event" unless they name a concrete story concept.
- Use only concepts grounded in the Summary Target. Do not invent unrelated synonyms or future facts.

Example: an investigation scene may yield case investigation [사건, 조사, 수사], suspicious evidence [증거, 단서], park [공원, 벤치], rose bouquet [장미, 꽃다발], and prayer for well-being [기도, 기원, 안녕, 무사], not only summary labels such as "suspicious evidence discovery" or "park visit". If the line "A씨는 참, 예쁘네요" is emotionally defining, use appearance compliment [예쁘네요, 예쁘, 외모, 칭찬]; if it is ordinary small talk, omit it.`;
const V14_EVENT_MEMORY_TEMPLATE = '<Current Major Event Memory>\n{{sumiEventMemory}}\n</Current Major Event Memory>';
const DEFAULT_EVENT_MEMORY_TEMPLATE = '<Current Event Memory>\n{{sumiEventMemory}}\n</Current Event Memory>';

const DEFAULT_SUMMARY_EXTRACTION_RULES = Object.freeze({
    ...V11_DEFAULT_SUMMARY_EXTRACTION_RULES,
    plot: `# Plot

Use the fewest chronological beats needed to preserve the causal story. Combine related actions; keep decisive choices and consequences. Omit atmosphere, routine movement, repeated reactions, and details without future value. Do not repeat information better owned by another enabled field. Plot requires at least one grounded beat.

**Remember: Do not overlook even seemingly minor actions or lines of dialogue that may hint at changes in character relationships, reveal a character’s emotions, or become pivotal moments shaping future events. This includes subtle external signs of inner tension, hidden emotion, or emotional contradiction—such as pauses, silences, gestures, posture shifts, eye contact, clenched hands, averted eyes, stiffened shoulders, or other embodied visual details—especially when a character’s words conflict with what their body reveals.** Make sure to include these elements.`,
    emotions: `# Emotion

Record the emotions each relevant character experiences through the target, including an important sustained emotion even when it does not change. Keep states chronological and merge near-duplicates.

Do not flatten the emotional analysis. Address the emotions with depth and nuance. Do not simply reproduce superficial rationalizations.

Infer emotion from dialogue, behavior, subtext, and embodied cues while remaining grounded in the target. Give each state one short causal phrase, not a plot retelling. Usually keep 1-3 distinct states per character; use toward only for a clear target.`,
    quotes: '# Key Dialogue\n\nKeep 2-3 representative or important lines whose exact wording captures character voice, emotion, relationship dynamics, a reveal, promise, or memorable moment. Preserve only the spoken words under the language rule. Do not add narration, action, explanation, or parenthetical context.',
    tags: `# Retrieval Tags

Create associative cues that can recall this specific memory from future roleplay. Matching is lexical, not semantic: every matchTerm must be a source-language string likely to reappear in dialogue or narration.

- Return usually 4-8 distinct concepts; return fewer for a sparse target and never pad the list.
- canonical is one short, specific concept label in the configured output language.
- matchTerms contains 2-6 complementary source-language cues for that concept. Prefer names, places, objects, symbols, sensory details, action stems, nouns, and very short phrases.
- Cover separate recall paths instead of reducing the scene to its broad topic: who, where, distinctive objects, decisive actions, promises, rituals, embodied details, and relationship milestones.
- Group synonyms, inflections, and closely related lexical cues under one canonical. Include forms likely to occur later; for an inflected word, add a useful stem or base cue when it improves matching.
- If exact wording is itself memorable, preserve the shortest distinctive quote fragment as one matchTerm and accompany it with normalized lexical cues. Do this only for a recurring phrase, nickname, code, promise, confession, or emotionally defining line. Never copy mundane dialogue or full sentences merely because they appear in the target.
- Never use article-style tags, titles, event summaries, explanations, or plot clauses as matchTerms. Avoid context-free labels such as "conversation", "emotion", or "event" unless they name a concrete story concept.
- Use only concepts grounded in the Summary Target. Do not invent unrelated synonyms or future facts.

Example: an investigation scene may yield case investigation [사건, 조사, 수사], suspicious evidence [증거, 단서], park [공원, 벤치], rose bouquet [장미, 꽃다발], and prayer for well-being [기도, 기원, 안녕, 무사], not only summary labels such as "suspicious evidence discovery" or "park visit".

Preserve exact wording only when the wording itself is a durable recall cue. For "When the blue rose blooms, meet me here again," useful groups include blue rose signal [blue rose, rose blooms] and reunion promise [meet me here again, meet again, reunion]. Do not preserve an ordinary line such as "You look pretty" unless its wording or circumstances establish a lasting relationship milestone.`,
    commitments: V12_DEFAULT_COMMITMENTS_RULE.replace('Never guess IDs, duplicate, delete, or reactivate fulfilled/obsolete entries.', 'Never guess IDs, duplicate, or delete.'),
    events: `# Event Index Updates

Maintain a sparse index of milestone-worthy events that deserve independent recall beyond the chunk summary.

- Most Summary Targets should produce no event proposal. Empty created and updated arrays are the expected default. Never add an event to fill a quota.
- First decide whether a development belongs in long-term event memory at all. Include only a confession, revelation, vow, irreversible choice, death, major acquisition or loss, identity reveal, or similarly durable change in a relationship, goal, conflict, status, power balance, or world state.
- Omit routine actions, ordinary conversation, minor conflict, repeated emotional beats, reactions, gestures, atmosphere, scene texture, and facts already preserved adequately by the chunk summary. Detailed plot coverage does not make something an indexed event. When in doubt, omit.
- Only after an event passes that threshold, assign importance. major is a true turning point that substantially redirects the story. minor is still a durable, independently memorable milestone, but not a story-redirecting turning point. minor never means routine, incidental, merely emotional, or slightly notable.
- Use a short title and exactly one brief summary sentence containing only the essential trigger and decisive outcome. Do not repeat the title, intermediate actions, or incidental detail.
- shift is null unless one major event caused a single essential lasting change. If used, state only the resulting durable state in one short clause. Exclude the cause, process, actions, emotional reactions, explanation, and event recap. If the lasting change cannot be expressed that briefly, use null.
- Keep date and location brief and chronologically consistent.
- The Summary Target alone can establish an event or change; other context only resolves identity. Create no duplicate. Update only an exact targetId and only fields changed by this target. Never invent IDs or delete events.`,
    people: `# People Memory Updates

Maintain compact current profiles, never plot or action history.

- The Summary Target alone can create or change data; other context only resolves identity.
- Create a compact card for any named or distinctly characterized person, even after one appearance. A pivotal unnamed person may use one stable provisional handle; replace it with the real name later and append the handle to aliases. Ignore only indistinguishable background figures with no stable identity.
- For a minor or one-scene person, record only the few established fields needed to recognize them later, often just name and role. Leave unsupported fields empty.
- Create only unmatched people. Update only an exact targetId. Never guess IDs, duplicate, or delete. Append only new aliases; replace only changed current snapshots, using complete concise arrays. Return no proposal for unchanged or uncertain data.
- role, age, occupation, appearance, affiliations, traits, and voice contain only stable profile facts. voice is a speech pattern, never sample dialogue. Exclude actions, chronology, evidence, temporary moods, clothing, expressions, and injuries unless durable.
- lastKnownState is only the latest observed location and physical condition. relationships and feelings are directional current snapshots, not scene emotions.
- Keep scalars to a short phrase or one compact sentence, lists to a few useful entries, and never repeat information across fields.`,
    world: `# World Setting Memory Updates

Maintain a compact lorebook of durable world facts newly established by the Summary Target.

- Store rules, customs, institutions, geography, history, species, magic or technology systems, terminology, and other setting facts that may matter later.
- The Summary Target alone can establish or change an entry. Character profiles, World Info, recent summaries, and Current World Setting Memory only prevent duplication and resolve context.
- Do not restate information already explicit in Character Information, World Info, or Current World Setting Memory. Create only a newly revealed durable fact.
- Entries marked manual are user-owned facts. Use them to prevent duplication, but never create an update targeting their IDs.
- Each entry must contain one independent fact. content must be one short, objective, self-contained sentence with no scene recap, atmosphere, speculation, or repeated evidence.
- keys must contain 2-6 concise source-language lexical cues likely to appear in future dialogue or narration. Prefer names, nouns, established terms, and short noun phrases; never use sentences or mini-summaries.
- Create only an unmatched fact. Update only an exact targetId when the fact is corrected, refined, or its useful retrieval keys change. Never guess IDs, duplicate, or delete.
- Return empty created and updated arrays when no durable new setting fact is supported. When in doubt, omit.`,
});

const V22_DEFAULT_WORLD_EXTRACTION_RULE = DEFAULT_SUMMARY_EXTRACTION_RULES.world
    .replace('\n- Entries marked manual are user-owned facts. Use them to prevent duplication, but never create an update targeting their IDs.', '');

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

const PREVIOUS_DEFAULT_SUMMARY_MAIN_PROMPT = `# Summary Task

You are a professional long-term memory writer for an ongoing fictional roleplay conversation. Analyze only the messages inside <Summary Target> and produce a compact but self-contained memory of that range. Preserve chronology, causal relationships, names, concrete actions, and details that may affect later behavior. Use character profiles, World Info, and recent summaries only to resolve context; do not report them as events unless they occur in the target messages. Do not invent unsupported facts.`;

const DEFAULT_SUMMARY_MAIN_PROMPT = `# Summary Task

Write the smallest self-contained long-term memory that preserves the Summary Target's future-relevant continuity. Use only the target as evidence; other context may resolve identity and chronology. Prefer omission over repetition, scene texture, or speculative detail. Follow the enabled extraction rules and JSON contract exactly. Never invent facts.`;

const V16_DEFAULT_REVISION_MAIN_PROMPT = `# Summary Revision

You are revising an existing conversation summary. Apply the user's feedback accurately while preserving useful facts and chronology from the current summary.`;

const V17_DEFAULT_REVISION_MAIN_PROMPT = `# Summary Revision

You are revising an existing conversation summary. Apply the user's feedback accurately while preserving useful facts and chronology from the current summary. When compression source records are provided, use them to verify or recover details requested by the user; do not restore omitted detail unless it serves the feedback.`;

const DEFAULT_REVISION_MAIN_PROMPT = `# Summary Revision

You are revising an existing conversation summary. Apply the user's feedback accurately while preserving useful facts and chronology from the current summary. When source messages or compression source records are provided, use them to verify or recover details requested by the user; do not restore omitted detail unless it serves the feedback.`;

const DEFAULT_REVISION_TEMPLATE = 'Return only the revised summary without a preface, explanation, or commentary.';

const V15_DEFAULT_COMPRESSION_MAIN_PROMPT = `# Summary Compression Task

Compress the supplied summary records into one dense long-term memory. Preserve chronological causality and durable facts, but remove repetition, scene texture, gestures, pauses, transient reactions, and details already represented by current memory atlases.

Plot: write one concise bullet-worthy sentence per meaningful causal event. Merge adjacent events when meaning remains intact. Do not write a prose paragraph.

Emotion: for each relevant character, reduce each source record to one representative emotion, then join the chronological snapshots into one trajectory. Merge repeated or near-identical states. Omit emotion targets. Give the entire arc one compact causal phrase in parentheses: keep the decisive cause, never retell the event sequence or explain every intermediate state.

Relationship: for each relevant pair, reduce each source record to a one- or two-word relationship snapshot and join the snapshots chronologically. Merge repeated states. Preserve a single snapshot even when the relationship did not change. Example: strangers -> cautious acquaintances -> trusted companions.

Quotes: preserve 1-3 exact source lines whose wording has the highest future recall value. Prefer vows, confessions, revelations, relationship-defining words, and irreversible decisions. Never invent dialogue; return an empty array only when no source quote exists.

Context: merge date, time, and location chronologically. Keep only meaningful transitions. Use only supplied records as evidence, never invent facts, and follow the JSON contract exactly.`;

const DEFAULT_COMPRESSION_MAIN_PROMPT = `# Summary Compression Task

Compress the supplied summary records into one dense long-term memory. Preserve chronological causality and durable facts, but remove repetition, scene texture, gestures, pauses, transient reactions, and details already represented by current memory atlases.

Plot: write one concise bullet-worthy sentence per meaningful causal event. Merge adjacent events when meaning remains intact. Do not write a prose paragraph. Preserve a relationship development only when it is a concrete event with lasting narrative consequences; express it as an action or outcome in plot, never as a separate relationship analysis.

Emotion: for each relevant character, reduce each source record to one representative emotion, then join the chronological snapshots into one trajectory. Merge repeated or near-identical states. Omit emotion targets. Give the entire arc one compact causal phrase in parentheses: keep the decisive cause, never retell the event sequence or explain every intermediate state.

Quotes: preserve 1-3 exact source lines whose wording has the highest future recall value. Prefer vows, confessions, revelations, relationship-defining words, and irreversible decisions. Never invent dialogue; return an empty array only when no source quote exists.

Context: merge date, time, and location chronologically. Keep only meaningful transitions. Use only supplied records as evidence, never invent facts, and follow the JSON contract exactly.`;

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

const V12_DEFAULT_PERSON_CONTEXT_TEMPLATE = `## {{sumiPersonName}}
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

const DEFAULT_PERSON_CONTEXT_TEMPLATE = `## {{sumiPersonName}}
- provisional: {{sumiPersonProvisionalValue}}
- aliases: {{sumiPersonAliasesValue}}
- role: {{sumiPersonRoleValue}}
- age: {{sumiPersonAgeValue}}
- occupation: {{sumiPersonOccupationValue}}
- appearance: {{sumiPersonAppearanceValue}}
- affiliations: {{sumiPersonAffiliationsValue}}
- traits: {{sumiPersonTraitsValue}}
- voice: {{sumiPersonVoiceValue}}
- last location: {{sumiPersonLastLocationValue}}
- physical condition: {{sumiPersonPhysicalConditionValue}}
- relationships: {{sumiPersonRelationshipsValue}}`;

const LEGACY_EVENT_CONTEXT_TEMPLATE = `## {{sumiEventTitle}}
- date: {{sumiEventDate}}
- location: {{sumiEventLocation}}
- event: {{sumiEventSummary}}
{{sumiEventShifts}}`;

const V12_DEFAULT_EVENT_CONTEXT_TEMPLATE = `[{{sumiEventImportance}}: {{sumiEventTitle}} - {{sumiEventSummary}}] {{sumiEventMetadata}}
{{sumiEventShift}}`;

const DEFAULT_EVENT_CONTEXT_TEMPLATE = `[{{sumiEventImportance}}: {{sumiEventTitle}} - {{sumiEventSummary}}]
- date: {{sumiEventDate}}
- location: {{sumiEventLocation}}
- SHIFT: {{sumiEventShiftValue}}`;

const V12_DEFAULT_ITEM_CONTEXT_TEMPLATE = `## {{sumiItemName}}
{{sumiItemAliases}}
{{sumiItemFacts}}
{{sumiItemFunctions}}
{{sumiItemState}}`;

const DEFAULT_ITEM_CONTEXT_TEMPLATE = `## {{sumiItemName}}
- aliases: {{sumiItemAliasesValue}}
- facts: {{sumiItemFactsValue}}
- functions: {{sumiItemFunctionsValue}}
- owner: {{sumiItemOwnerValue}}
- holder: {{sumiItemHolderValue}}
- location: {{sumiItemLocationValue}}
- condition: {{sumiItemConditionValue}}
- status: {{sumiItemStatusValue}}`;

const V12_DEFAULT_COMMITMENT_CONTEXT_TEMPLATE = `## {{sumiCommitmentTitle}}
- status: {{sumiCommitmentStatus}}
- terms: {{sumiCommitmentTerms}}
{{sumiCommitmentParticipants}}
{{sumiCommitmentConditions}}
{{sumiCommitmentDeadline}}
{{sumiCommitmentFacts}}
{{sumiCommitmentStatusReason}}`;

const DEFAULT_COMMITMENT_CONTEXT_TEMPLATE = `## {{sumiCommitmentTitle}}
- status: {{sumiCommitmentStatus}}
- terms: {{sumiCommitmentTerms}}
- participants: {{sumiCommitmentParticipantsValue}}
- conditions: {{sumiCommitmentConditionsValue}}
- deadline: {{sumiCommitmentDeadlineValue}}
- facts: {{sumiCommitmentFactsValue}}
- status reason: {{sumiCommitmentStatusReasonValue}}`;

const DEFAULT_WORLD_CONTEXT_TEMPLATE = '- {{sumiWorldContent}}';

export const SUMMARY_CONTEXT_BLOCK_KINDS = Object.freeze({
    RECORDS: 'records',
    EVENTS: 'events',
    PEOPLE: 'people',
    ITEMS: 'items',
    COMMITMENTS: 'commitments',
    WORLD: 'world',
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
        entryTemplate: DEFAULT_EVENT_CONTEXT_TEMPLATE,
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
        entryTemplate: DEFAULT_ITEM_CONTEXT_TEMPLATE,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.COMMITMENTS,
        name: '서약 장부',
        prefixTemplate: '# Commitment Ledger',
        entryTemplate: DEFAULT_COMMITMENT_CONTEXT_TEMPLATE,
        suffixTemplate: '',
    },
    {
        kind: SUMMARY_CONTEXT_BLOCK_KINDS.WORLD,
        name: '세계 설정',
        prefixTemplate: '# Established World Facts',
        entryTemplate: DEFAULT_WORLD_CONTEXT_TEMPLATE,
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
        SUMMARY_CONTEXT_BLOCK_KINDS.WORLD,
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
        eventInjectionMaxTokens: 4000,
        worldRetrieval: {
            mode: 'lorebook',
            maxTokens: 4000,
            messageCount: 6,
        },
        worldOutput: {
            mode: 'summary',
            worldInfoPosition: 'before',
        },
        personRetrieval: {
            maxTokens: 6000,
            messageCount: 6,
        },
        autoHideSummarizedMessages: false,
        summaryContentTemplate: DEFAULT_SUMMARY_CONTENT_TEMPLATE,
        summaryContentTemplatePreset: 'compact',
        compressionGroupSize: 3,
        compressionContentTemplate: DEFAULT_COMPRESSION_CONTENT_TEMPLATE,
        compressionContentTemplatePreset: 'compact',
        recordTemplate: DEFAULT_SUMMARY_RECORD_TEMPLATE,
        contextBlocks: getDefaultSummaryContextBlocks(),
        injection: {
            mode: 'macro',
            position: 'after',
            depth: 4,
            role: 'system',
        },
        longTermRetrieval: {
            enabled: true,
            mode: 'simple',
            messageCount: 6,
            maxTokens: 6000,
            relevance: 'balanced',
            relevanceLimitMode: 'all',
            relevanceMaxRecords: 3,
        },
        prompts: {
            summary: createPromptEditorDefaults(PROMPT_TYPES.SUMMARY),
            revision: createPromptEditorDefaults(PROMPT_TYPES.REVISION),
            compression: createPromptEditorDefaults(PROMPT_TYPES.COMPRESSION),
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
    normalizeSettings(extensionSettings[MODULE_NAME], {
        migrateLegacyContextBlocks,
    });
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

export function getSettingsSnapshot() {
    return structuredClone(getSettings());
}

export async function replaceSettingsFromBackup(snapshot, { preserveEnabled = true } = {}) {
    if (!isPlainObject(snapshot)) throw new Error('가져올 확장 전역 설정 형식이 올바르지 않습니다.');

    const extensionSettings = SillyTavern.getContext().extensionSettings;
    const current = getSettings();
    const previous = structuredClone(current);
    const enabled = current.enabled;
    extensionSettings[MODULE_NAME] = structuredClone(snapshot);

    try {
        const imported = getSettings();
        if (preserveEnabled) imported.enabled = enabled;
        await saveSettingsNow();
        return structuredClone(imported);
    } catch (error) {
        extensionSettings[MODULE_NAME] = previous;
        throw error;
    }
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

export function getSummaryContentTemplate() {
    return getSettings().summarization.summaryContentTemplate;
}

export function getSummaryContentTemplatePreset() {
    return getSettings().summarization.summaryContentTemplatePreset;
}

export function setSummaryContentTemplatePreset(presetId) {
    const preset = SUMMARY_CONTENT_TEMPLATE_PRESETS[presetId];
    if (!preset) throw new Error('선택한 요약 레코드 형식 프리셋을 찾지 못했습니다.');
    const settings = getSettings();
    settings.summarization.summaryContentTemplate = preset.template;
    settings.summarization.summaryContentTemplatePreset = presetId;
    saveSettings();
    return preset.template;
}

export function setSummaryContentTemplate(template) {
    const value = String(template || '');
    if (!value.trim()) throw new Error('요약 레코드 내용 템플릿은 비워둘 수 없습니다.');
    const settings = getSettings();
    settings.summarization.summaryContentTemplate = value;
    settings.summarization.summaryContentTemplatePreset = getSummaryContentTemplatePresetId(value);
    saveSettings();
    return value;
}

export function resetSummaryContentTemplate() {
    const settings = getSettings();
    settings.summarization.summaryContentTemplate = DEFAULT_SUMMARY_CONTENT_TEMPLATE;
    settings.summarization.summaryContentTemplatePreset = 'compact';
    saveSettings();
    return settings.summarization.summaryContentTemplate;
}

export function setCompressionGroupSize(value) {
    const settings = getSettings();
    settings.summarization.compressionGroupSize = clampInteger(value, 2, 100, defaultSettings.summarization.compressionGroupSize);
    saveSettings();
    return settings.summarization.compressionGroupSize;
}

export function getCompressionContentTemplate() {
    return getSettings().summarization.compressionContentTemplate;
}

export function getCompressionContentTemplatePreset() {
    return getSettings().summarization.compressionContentTemplatePreset;
}

export function setCompressionContentTemplatePreset(presetId) {
    const preset = COMPRESSION_CONTENT_TEMPLATE_PRESETS[presetId];
    if (!preset) throw new Error('선택한 압축 레코드 형식 프리셋을 찾지 못했습니다.');
    const settings = getSettings();
    settings.summarization.compressionContentTemplate = preset.template;
    settings.summarization.compressionContentTemplatePreset = presetId;
    saveSettings();
    return preset.template;
}

export function setCompressionContentTemplate(template) {
    const value = String(template || '');
    if (!value.trim()) throw new Error('압축 요약 레코드 템플릿은 비워둘 수 없습니다.');
    const settings = getSettings();
    settings.summarization.compressionContentTemplate = value;
    settings.summarization.compressionContentTemplatePreset = getCompressionContentTemplatePresetId(value);
    saveSettings();
    return value;
}

export function resetCompressionContentTemplate() {
    const settings = getSettings();
    settings.summarization.compressionContentTemplate = DEFAULT_COMPRESSION_CONTENT_TEMPLATE;
    settings.summarization.compressionContentTemplatePreset = 'compact';
    saveSettings();
    return settings.summarization.compressionContentTemplate;
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
        BLOCK_KINDS.WORLD_MEMORY,
        BLOCK_KINDS.COMPRESSION_SOURCES,
        BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT,
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
                ...createRevisionSummarySourceBlocks(),
                ...createRevisionCompressionSourceBlocks(),
                ...createRevisionConversationBlocks(),
                createPromptBlock({ id: 'revision-template', name: '수정 결과 템플릿', content: DEFAULT_REVISION_TEMPLATE, locked: true }),
            ],
        });
    }

    if (type === PROMPT_TYPES.COMPRESSION) {
        return createPreset({
            id: 'default-compression',
            name: '기본 프리셋',
            blocks: [
                createPromptBlock({ id: 'compression-main', name: '압축 기본 지시문', content: DEFAULT_COMPRESSION_MAIN_PROMPT, locked: true }),
                createPromptBlock({
                    id: 'compression-language',
                    name: '출력 언어',
                    content: '# Output Language\n\n{{sumiSummaryLanguageInstruction}}',
                    locked: true,
                    kind: BLOCK_KINDS.SUMMARY_LANGUAGE,
                }),
                createPromptBlock({
                    id: 'compression-sources',
                    name: '압축 대상 요약 레코드',
                    content: '{{sumiCompressionSources}}',
                    locked: true,
                    kind: BLOCK_KINDS.COMPRESSION_SOURCES,
                }),
                createPromptBlock({
                    id: 'compression-output-contract',
                    name: '압축 JSON 출력 형식 · 자동 생성',
                    content: '{{sumiCompressionJsonContract}}',
                    locked: true,
                    kind: BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT,
                }),
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
            content: DEFAULT_EVENT_MEMORY_TEMPLATE,
            locked: true,
            kind: BLOCK_KINDS.EVENT_MEMORY,
        }),
        createPromptBlock({
            id: 'world-memory',
            name: '현재 세계 설정',
            content: '<Current World Setting Memory>\n{{sumiWorldMemory}}\n</Current World Setting Memory>',
            locked: true,
            kind: BLOCK_KINDS.WORLD_MEMORY,
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

function createRevisionCompressionSourceBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'revision-compression-sources';
    return [
        createPromptBlock({
            id: `${prefix}-start`,
            name: '압축 원본 레코드 구분선 시작',
            content: '<Compression Source Records>',
            enabled,
            locked: true,
            separator: true,
            kind: BLOCK_KINDS.REVISION_COMPRESSION_SOURCE_SEPARATOR,
        }),
        createPromptBlock({
            id: `${prefix}-content`,
            name: '압축 원본 레코드',
            content: '{{sumiCompressionRevisionSources}}',
            enabled,
            locked: true,
            kind: BLOCK_KINDS.REVISION_COMPRESSION_SOURCES,
        }),
        createPromptBlock({
            id: `${prefix}-end`,
            name: '압축 원본 레코드 구분선 끝',
            content: '</Compression Source Records>',
            enabled,
            locked: true,
            separator: true,
            kind: BLOCK_KINDS.REVISION_COMPRESSION_SOURCE_SEPARATOR,
        }),
    ];
}

function createRevisionSummarySourceBlocks(source = {}) {
    const enabled = source.enabled ?? true;
    const prefix = source.id ? `${source.id}-v2` : 'revision-summary-sources';
    return [
        createPromptBlock({
            id: `${prefix}-start`,
            name: '요약 대상 원문 구분선 시작',
            content: '<Summary Source Messages range="#{{sumiStartId}} ~ #{{sumiEndId}}">',
            enabled,
            locked: true,
            separator: true,
            kind: BLOCK_KINDS.REVISION_SUMMARY_SOURCE_SEPARATOR,
        }),
        createPromptBlock({
            id: `${prefix}-messages`,
            name: '요약 대상 원문 메시지 포맷',
            content: '#{{sumiMessageId}} {{sumiMessageName}}: {{sumiMessageContent}}',
            enabled,
            locked: true,
            kind: BLOCK_KINDS.REVISION_SUMMARY_MESSAGES,
        }),
        createPromptBlock({
            id: `${prefix}-end`,
            name: '요약 대상 원문 구분선 끝',
            content: '</Summary Source Messages>',
            enabled,
            locked: true,
            separator: true,
            kind: BLOCK_KINDS.REVISION_SUMMARY_SOURCE_SEPARATOR,
        }),
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

function normalizeSettings(settings, {
    migrateLegacyContextBlocks = false,
} = {}) {
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
    settings.summarization.eventInjectionMaxTokens = clampInteger(
        settings.summarization.eventInjectionMaxTokens,
        100,
        200000,
        defaultSettings.summarization.eventInjectionMaxTokens,
    );
    settings.summarization.worldRetrieval = normalizeWorldRetrievalSettings(
        settings.summarization.worldRetrieval,
    );
    settings.summarization.worldOutput = normalizeWorldOutputSettings(
        settings.summarization.worldOutput,
    );
    settings.summarization.personRetrieval = normalizePersonRetrievalSettings(
        settings.summarization.personRetrieval,
    );
    settings.summarization.autoHideSummarizedMessages = Boolean(settings.summarization.autoHideSummarizedMessages);
    const summaryContentTemplate = String(
        settings.summarization.summaryContentTemplate || defaultSettings.summarization.summaryContentTemplate,
    );
    settings.summarization.summaryContentTemplate = summaryContentTemplate;
    settings.summarization.summaryContentTemplatePreset = getSummaryContentTemplatePresetId(
        settings.summarization.summaryContentTemplate,
    );
    settings.summarization.compressionGroupSize = clampInteger(
        settings.summarization.compressionGroupSize,
        2,
        100,
        defaultSettings.summarization.compressionGroupSize,
    );
    const compressionContentTemplate = String(
        settings.summarization.compressionContentTemplate || defaultSettings.summarization.compressionContentTemplate,
    );
    settings.summarization.compressionContentTemplate = compressionContentTemplate.trim()
        === LEGACY_COMPRESSION_CONTENT_TEMPLATE_WITH_RELATIONSHIPS.trim()
        ? DEFAULT_COMPRESSION_CONTENT_TEMPLATE
        : compressionContentTemplate;
    settings.summarization.compressionContentTemplatePreset = getCompressionContentTemplatePresetId(
        settings.summarization.compressionContentTemplate,
    );
    settings.summarization.recordTemplate = String(settings.summarization.recordTemplate ?? defaultSettings.summarization.recordTemplate);
    settings.summarization.contextBlocks = normalizeSummaryContextBlocks(
        migrateLegacyContextBlocks ? [] : settings.summarization.contextBlocks,
        settings.summarization.recordTemplate,
    );
    settings.summarization.injection = normalizeInjectionSettings(settings.summarization.injection);
    settings.summarization.longTermRetrieval = normalizeLongTermRetrievalSettings(
        settings.summarization.longTermRetrieval,
    );
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

function normalizeLongTermRetrievalSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        enabled: source.enabled === undefined ? true : Boolean(source.enabled),
        mode: ['simple', 'relevance'].includes(source.mode) ? source.mode : 'simple',
        messageCount: clampInteger(source.messageCount, 1, 100, 6),
        maxTokens: clampInteger(source.maxTokens, 100, 100000, 6000),
        relevance: ['loose', 'balanced', 'strict'].includes(source.relevance) ? source.relevance : 'balanced',
        relevanceLimitMode: ['all', 'top'].includes(source.relevanceLimitMode) ? source.relevanceLimitMode : 'all',
        relevanceMaxRecords: clampInteger(source.relevanceMaxRecords, 1, 100, 3),
    };
}

function normalizePersonRetrievalSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        maxTokens: clampInteger(source.maxTokens, 100, 100000, 6000),
        messageCount: clampInteger(source.messageCount, 1, 100, 6),
    };
}

function normalizeWorldRetrievalSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        mode: ['lorebook', 'priority'].includes(source.mode) ? source.mode : 'lorebook',
        maxTokens: clampInteger(source.maxTokens, 100, 100000, 4000),
        messageCount: clampInteger(source.messageCount, 1, 100, 6),
    };
}

function normalizeWorldOutputSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        mode: ['summary', 'macro', 'worldInfo'].includes(source.mode) ? source.mode : 'summary',
        worldInfoPosition: ['before', 'after'].includes(source.worldInfoPosition)
            ? source.worldInfoPosition
            : 'before',
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
            entryTemplate: shouldMigrateContextEntryTemplate(fallback.kind, candidate.entryTemplate)
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

function shouldMigrateContextEntryTemplate(kind, template) {
    const value = String(template ?? '');
    return (kind === SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE && value === LEGACY_PERSON_CONTEXT_TEMPLATE)
        || (kind === SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE && value === V12_DEFAULT_PERSON_CONTEXT_TEMPLATE)
        || (kind === SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS && value === LEGACY_EVENT_CONTEXT_TEMPLATE)
        || (kind === SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS && value === V12_DEFAULT_EVENT_CONTEXT_TEMPLATE)
        || (kind === SUMMARY_CONTEXT_BLOCK_KINDS.ITEMS && value === V12_DEFAULT_ITEM_CONTEXT_TEMPLATE)
        || (kind === SUMMARY_CONTEXT_BLOCK_KINDS.COMMITMENTS && value === V12_DEFAULT_COMMITMENT_CONTEXT_TEMPLATE);
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

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 11) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.id === 'summary-main'
                && String(block.content || '').trim() === PREVIOUS_DEFAULT_SUMMARY_MAIN_PROMPT.trim()) {
                return { ...block, content: DEFAULT_SUMMARY_MAIN_PROMPT };
            }
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const rules = Object.fromEntries(SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(({ key }) => {
                const fallback = PREVIOUS_DEFAULT_SUMMARY_EXTRACTION_RULES[key] ?? DEFAULT_SUMMARY_EXTRACTION_RULES[key];
                const current = String(sourceRules[key] || fallback);
                const next = current.trim() === fallback.trim()
                    ? DEFAULT_SUMMARY_EXTRACTION_RULES[key]
                    : current;
                return [key, next];
            }));
            return { ...block, config: { ...block.config, rules } };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 12) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const rules = Object.fromEntries(SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(({ key }) => {
                const fallback = V11_DEFAULT_SUMMARY_EXTRACTION_RULES[key] ?? DEFAULT_SUMMARY_EXTRACTION_RULES[key];
                const current = String(sourceRules[key] || fallback);
                const next = current.trim() === fallback.trim()
                    ? DEFAULT_SUMMARY_EXTRACTION_RULES[key]
                    : current;
                return [key, next];
            }));
            return { ...block, config: { ...block.config, rules } };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 13) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = String(sourceRules.quotes || V12_DEFAULT_QUOTES_RULE);
            const currentCommitments = String(sourceRules.commitments || V12_DEFAULT_COMMITMENTS_RULE);
            const updates = {};
            if (current.trim() === V12_DEFAULT_QUOTES_RULE.trim()) {
                updates.quotes = DEFAULT_SUMMARY_EXTRACTION_RULES.quotes;
            }
            if (currentCommitments.trim() === V12_DEFAULT_COMMITMENTS_RULE.trim()) {
                updates.commitments = DEFAULT_SUMMARY_EXTRACTION_RULES.commitments;
            }
            if (!Object.keys(updates).length) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        ...updates,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 14) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = String(sourceRules.events || V13_DEFAULT_EVENTS_RULE);
            if (current.trim() !== V13_DEFAULT_EVENTS_RULE.trim()) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        events: DEFAULT_SUMMARY_EXTRACTION_RULES.events,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 15) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind === BLOCK_KINDS.EVENT_MEMORY
                && String(block.content || '').trim() === V14_EVENT_MEMORY_TEMPLATE.trim()) {
                return { ...block, content: DEFAULT_EVENT_MEMORY_TEMPLATE };
            }
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = String(sourceRules.events || V14_DEFAULT_EVENTS_RULE);
            if (current.trim() !== V14_DEFAULT_EVENTS_RULE.trim()) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        events: DEFAULT_SUMMARY_EXTRACTION_RULES.events,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.COMPRESSION && sourceSchemaVersion < 16) {
        migratedBlocks = migratedBlocks.map(block => (
            block.id === 'compression-main'
                && String(block.content || '').trim() === V15_DEFAULT_COMPRESSION_MAIN_PROMPT.trim()
                ? { ...block, content: DEFAULT_COMPRESSION_MAIN_PROMPT }
                : block
        ));
    }

    if (type === PROMPT_TYPES.REVISION && sourceSchemaVersion < 17) {
        migratedBlocks = migratedBlocks.map(block => (
            block.id === 'revision-main'
                && String(block.content || '').trim() === V16_DEFAULT_REVISION_MAIN_PROMPT.trim()
                ? { ...block, content: DEFAULT_REVISION_MAIN_PROMPT }
                : block
        ));
        if (!migratedBlocks.some(block => block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCES)) {
            const revisionMessagesIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.REVISION_MESSAGES);
            const insertIndex = revisionMessagesIndex < 0
                ? migratedBlocks.length
                : revisionMessagesIndex > 0 && migratedBlocks[revisionMessagesIndex - 1]?.separator
                    ? revisionMessagesIndex - 1
                    : revisionMessagesIndex;
            migratedBlocks = [
                ...migratedBlocks.slice(0, insertIndex),
                ...createRevisionCompressionSourceBlocks(),
                ...migratedBlocks.slice(insertIndex),
            ];
        }
    }

    if (type === PROMPT_TYPES.REVISION && sourceSchemaVersion < 18) {
        migratedBlocks = migratedBlocks.map(block => (
            block.id === 'revision-main'
                && String(block.content || '').trim() === V17_DEFAULT_REVISION_MAIN_PROMPT.trim()
                ? { ...block, content: DEFAULT_REVISION_MAIN_PROMPT }
                : block
        ));
        if (!migratedBlocks.some(block => block.kind === BLOCK_KINDS.REVISION_SUMMARY_MESSAGES)) {
            const compressionSourceIndex = migratedBlocks.findIndex(
                block => block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCES,
            );
            const revisionMessagesIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.REVISION_MESSAGES);
            const targetIndex = compressionSourceIndex >= 0 ? compressionSourceIndex : revisionMessagesIndex;
            const insertIndex = targetIndex < 0
                ? migratedBlocks.length
                : targetIndex > 0 && migratedBlocks[targetIndex - 1]?.separator
                    ? targetIndex - 1
                    : targetIndex;
            migratedBlocks = [
                ...migratedBlocks.slice(0, insertIndex),
                ...createRevisionSummarySourceBlocks(),
                ...migratedBlocks.slice(insertIndex),
            ];
        }
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 19) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = typeof sourceRules.tags === 'string'
                ? sourceRules.tags
                : V18_DEFAULT_TAGS_RULE;
            if (current.trim() !== V18_DEFAULT_TAGS_RULE.trim()) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        tags: DEFAULT_SUMMARY_EXTRACTION_RULES.tags,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 20) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = typeof sourceRules.tags === 'string'
                ? sourceRules.tags
                : V19_DEFAULT_TAGS_RULE;
            if (current.trim() !== V19_DEFAULT_TAGS_RULE.trim()) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        tags: DEFAULT_SUMMARY_EXTRACTION_RULES.tags,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 21) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const sourceRules = block.config?.rules && typeof block.config.rules === 'object'
                ? block.config.rules
                : {};
            const current = typeof sourceRules.tags === 'string'
                ? sourceRules.tags
                : V20_DEFAULT_TAGS_RULE;
            if (current.trim() !== V20_DEFAULT_TAGS_RULE.trim()) return block;
            return {
                ...block,
                config: {
                    ...block.config,
                    rules: {
                        ...sourceRules,
                        tags: DEFAULT_SUMMARY_EXTRACTION_RULES.tags,
                    },
                },
            };
        });
    }

    if (type === PROMPT_TYPES.SUMMARY
        && sourceSchemaVersion < 22
        && !migratedBlocks.some(block => block.kind === BLOCK_KINDS.WORLD_MEMORY)) {
        const contractIndex = migratedBlocks.findIndex(block => block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT);
        const insertIndex = contractIndex < 0 ? migratedBlocks.length : contractIndex;
        migratedBlocks = [
            ...migratedBlocks.slice(0, insertIndex),
            createPromptBlock({
                id: 'world-memory',
                name: '현재 세계 설정',
                content: '<Current World Setting Memory>\n{{sumiWorldMemory}}\n</Current World Setting Memory>',
                locked: true,
                kind: BLOCK_KINDS.WORLD_MEMORY,
            }),
            ...migratedBlocks.slice(insertIndex),
        ];
    }

    if (type === PROMPT_TYPES.SUMMARY && sourceSchemaVersion < 23) {
        migratedBlocks = migratedBlocks.map(block => {
            if (block.kind !== BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return block;
            const rules = block.config?.rules && typeof block.config.rules === 'object'
                ? { ...block.config.rules }
                : {};
            const current = String(rules.world || V22_DEFAULT_WORLD_EXTRACTION_RULE);
            if (current.trim() === V22_DEFAULT_WORLD_EXTRACTION_RULE.trim()) {
                rules.world = DEFAULT_SUMMARY_EXTRACTION_RULES.world;
            }
            return {
                ...block,
                config: { ...block.config, rules },
            };
        });
    }

    return {
        ...preset,
        blocks: migratedBlocks,
    };
}

function isKnownSeparatorBlock(block) {
    return Boolean(block?.locked && /(character-info|world-info|summary-target|current-summary|revision-history|revision-summary-sources|revision-compression-sources).*(?:-start|-end)$/.test(String(block.id || '')));
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
