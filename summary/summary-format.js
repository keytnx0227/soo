import {
    DEFAULT_SUMMARY_CONTENT_TEMPLATE,
    renderSummaryContentTemplate,
} from './summary-record-template.js';
import { normalizeFeelings } from '../memory/people-feelings.js';

export const SUMMARY_FORMAT_VERSION = 5;

export const SUMMARY_LANGUAGE_MODES = Object.freeze({
    ENGLISH: 'english',
    SOURCE: 'source',
    ENGLISH_DIALOGUE_SOURCE: 'english-dialogue-source',
});

export const SUMMARY_SECTION_KINDS = Object.freeze({
    TITLE: 'summaryTitle',
    DATE: 'summaryDate',
    TIME: 'summaryTime',
    LOCATION: 'summaryLocation',
    PLOT: 'summaryPlot',
    CONTINUITY: 'summaryContinuity',
    EMOTIONS: 'summaryEmotions',
    QUOTES: 'summaryQuotes',
    TAGS: 'summaryTags',
});

export const DEFAULT_SUMMARY_SECTIONS = Object.freeze({
    title: true,
    date: true,
    time: true,
    location: true,
    plot: true,
    continuity: true,
    emotions: true,
    quotes: true,
    tags: true,
});

export const DEFAULT_SUMMARY_OUTPUT_SECTIONS = Object.freeze({
    title: true,
    date: true,
    time: true,
    location: true,
    plot: true,
    continuity: true,
    emotions: true,
    emotionReasons: true,
    quotes: true,
});

export const DEFAULT_MEMORY_SECTIONS = Object.freeze({
    people: true,
    items: true,
    commitments: true,
    events: true,
    world: true,
});

export const SUMMARY_SECTION_DESCRIPTIONS = Object.freeze({
    plot: '요약 대상에서 일어난 사건과 원인, 결과를 시간 순서대로 기록합니다. 항상 포함되는 필수 항목입니다.',
    title: '해당 요약 청크의 중심 장면이나 사건을 알아보기 쉬운 짧은 제목으로 만듭니다.',
    date: '명시된 날짜를 우선 사용하고, 날짜가 없다면 최근 요약과 이어지는 Day N 흐름을 추적합니다.',
    time: '작중 시간이나 시간대를 기록하고, 청크 안에서 시간이 변하면 흐름에 따라 나눕니다.',
    location: '사건이 일어난 장소와 청크 안에서 발생한 장소 이동을 시간 순서대로 기록합니다.',
    continuity: '새로 알게 된 사실, 관계 상태, 목표, 신체 상태, 소지품처럼 이후 장면에 영향을 줄 비감정적 변화를 기록합니다.',
    emotions: '청크에서 인물들이 느낀 감정의 흐름과 그 이유를 깊이와 뉘앙스를 유지해 기록합니다.',
    quotes: '인물과 장면을 대표하거나 서사적으로 중요한 대사를 2~3개까지 보존합니다.',
    tags: '청크를 나중에 다시 찾기 위한 검색용 메타데이터를 생성합니다. 태그는 요약 본문이나 {{sumiSummary}}에 출력되지 않습니다.',
    people: '요약 대상에서 확인된 인물의 장기 정보와 기존 인물에 대한 변경안을 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
    items: '요약 대상에서 확인된 중요한 아이템의 장기 정보와 기존 아이템에 대한 변경안을 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
    commitments: '향후 추적할 약속과 서약, 명시적인 의무가 붙은 비밀의 생성 및 상태 변경을 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
    events: '미래 맥락에 남길 사건과 이야기의 변곡점을 간결한 연대기로 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
    world: '대화에서 새롭게 밝혀진 지속적인 세계관 정보를 로어북 형태로 추출합니다. 기존 월드 인포는 반복하지 않습니다.',
});

const SECTION_KEYS_BY_KIND = Object.freeze({
    [SUMMARY_SECTION_KINDS.TITLE]: 'title',
    [SUMMARY_SECTION_KINDS.DATE]: 'date',
    [SUMMARY_SECTION_KINDS.TIME]: 'time',
    [SUMMARY_SECTION_KINDS.LOCATION]: 'location',
    [SUMMARY_SECTION_KINDS.PLOT]: 'plot',
    [SUMMARY_SECTION_KINDS.CONTINUITY]: 'continuity',
    [SUMMARY_SECTION_KINDS.EMOTIONS]: 'emotions',
    [SUMMARY_SECTION_KINDS.QUOTES]: 'quotes',
    [SUMMARY_SECTION_KINDS.TAGS]: 'tags',
});

export function getEnabledSummarySections(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        title: source.title ?? DEFAULT_SUMMARY_SECTIONS.title,
        date: source.date ?? DEFAULT_SUMMARY_SECTIONS.date,
        time: source.time ?? DEFAULT_SUMMARY_SECTIONS.time,
        location: source.location ?? DEFAULT_SUMMARY_SECTIONS.location,
        plot: true,
        continuity: source.continuity ?? DEFAULT_SUMMARY_SECTIONS.continuity,
        emotions: source.emotions ?? DEFAULT_SUMMARY_SECTIONS.emotions,
        quotes: source.quotes ?? DEFAULT_SUMMARY_SECTIONS.quotes,
        tags: source.tags ?? DEFAULT_SUMMARY_SECTIONS.tags,
    };
}

export function getEnabledMemorySections(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        people: source.people ?? DEFAULT_MEMORY_SECTIONS.people,
        items: source.items ?? DEFAULT_MEMORY_SECTIONS.items,
        commitments: source.commitments ?? DEFAULT_MEMORY_SECTIONS.commitments,
        events: source.events ?? DEFAULT_MEMORY_SECTIONS.events,
        world: source.world ?? DEFAULT_MEMORY_SECTIONS.world,
    };
}

export function getSummarySectionKeyForKind(kind) {
    return SECTION_KEYS_BY_KIND[kind] || null;
}

export function getSummaryLanguageInstruction(mode) {
    if (mode === SUMMARY_LANGUAGE_MODES.SOURCE) {
        return 'Write the entire response in the primary language used in the source messages.';
    }
    if (mode === SUMMARY_LANGUAGE_MODES.ENGLISH_DIALOGUE_SOURCE) {
        return [
            'Write all summaries, metadata, descriptions, tags, and extracted information in English.',
            'Preserve quoted dialogue verbatim in its original language. Do not translate or paraphrase quoted dialogue.',
        ].join('\n');
    }
    return 'Write the entire response in English, including quoted dialogue.';
}

export function buildSummaryJsonContract(
    sections,
    memorySections = DEFAULT_MEMORY_SECTIONS,
    { includeSummary = true, includeCreatedSourceIds = false } = {},
) {
    const example = {};
    if (includeSummary && sections.title) example.title = 'A concise title for this chunk';

    if (includeSummary && (sections.date || sections.time || sections.location)) {
        const context = {};
        if (sections.date) {
            context.date = 'An explicit date or a continuous Day N value';
            context.relativeDate = null;
        }
        if (sections.time) context.time = 'The time or time period';
        if (sections.location) context.location = 'The current location';
        example.contextFlow = [context];
    }

    if (includeSummary) example.plot = ['A chronological plot beat grounded in the source messages.'];
    if (includeSummary && sections.continuity) example.continuityChanges = ['A concrete non-emotional state change.'];
    if (includeSummary && sections.emotions) {
        example.emotions = [{
            subject: 'Character name',
            toward: 'Target name or null',
            states: [{ emotion: 'Emotion', reason: 'Cause grounded in the source messages' }],
        }];
    }
    if (includeSummary && sections.quotes) {
        example.quotes = [{
            speaker: 'Speaker name',
            text: 'Important dialogue',
        }];
    }
    if (includeSummary && sections.tags) {
        example.tags = [{
            canonical: 'Specific retrieval concept',
            matchTerms: ['Distinctive source-language cue', 'Normalized lexical cue'],
        }];
    }
    if (memorySections.people || memorySections.items || memorySections.commitments || memorySections.events || memorySections.world) {
        example.memoryUpdates = {};
    }
    if (memorySections.people) {
        example.memoryUpdates.people = {
            created: [{
                name: 'Canonical character name',
                provisional: false,
                aliases: ['Established alias'],
                role: 'Compact role in the story or null',
                age: 'Explicit age or concise age description, otherwise null',
                occupation: 'Current occupation or position, otherwise null',
                appearance: 'Compact stable identifying appearance or null',
                affiliations: ['Current affiliation'],
                traits: ['Stable personality trait'],
                voice: 'Compact speech pattern without sample dialogue or null',
                lastKnownState: {
                    location: 'Last location observed in the target or null',
                    physicalCondition: 'Last physical condition observed in the target or null',
                },
                relationships: [{
                    targetId: null,
                    targetName: 'Related character name',
                    relationship: ['Current relationship description'],
                    feelings: [{
                        text: 'Compact description of a current durable feeling toward the target',
                        weight: 1.0,
                    }],
                }],
            }],
            updated: [{
                targetId: 'ID copied exactly from Current People Memory',
                append: {
                    aliases: ['Newly established alias'],
                },
                replace: {
                    name: 'New canonical name only when the name changed',
                    provisional: false,
                    role: 'Complete current story-role snapshot or null',
                    age: 'Complete current age snapshot or null',
                    occupation: 'Complete current occupation snapshot or null',
                    appearance: 'Complete current stable appearance snapshot or null',
                    affiliations: ['Complete current affiliation snapshot'],
                    traits: ['Complete concise personality snapshot'],
                    voice: 'Complete compact speech-pattern snapshot or null',
                    lastKnownState: {
                        location: 'Last location observed in the target or null',
                        physicalCondition: 'Last physical condition observed in the target or null',
                    },
                },
                relationshipUpdates: [{
                    targetId: 'Existing related-person ID or null',
                    targetName: 'Related character name',
                    relationship: ['Complete current relationship snapshot'],
                    feelings: [{
                        text: 'Complete continuity-preserving description of one durable emotional current toward this person',
                        weight: 2.6,
                    }],
                }],
            }],
        };
    }
    if (memorySections.items) {
        example.memoryUpdates.items = {
            created: [{
                name: 'Canonical item name',
                aliases: ['Established alternate name'],
                facts: ['Durable objective fact'],
                functions: ['Established capability or purpose'],
                lastKnownState: {
                    owner: 'Current owner name or null',
                    holder: 'Current holder name or null',
                    location: 'Last location observed in the target or null',
                    condition: 'Last physical condition observed in the target or null',
                    status: 'Current narrative status or null',
                },
            }],
            updated: [{
                targetId: 'ID copied exactly from Current Item Memory',
                append: {
                    aliases: ['Newly established alternate name'],
                    facts: ['New durable objective fact'],
                },
                replace: {
                    name: 'New canonical name only when the name changed',
                    functions: ['Complete current capability or purpose snapshot'],
                    lastKnownState: {
                        owner: 'Current owner name or null',
                        holder: 'Current holder name or null',
                        location: 'Last location observed in the target or null',
                        condition: 'Last physical condition observed in the target or null',
                        status: 'Current narrative status or null',
                    },
                },
            }],
        };
    }
    if (memorySections.commitments) {
        example.memoryUpdates.commitments = {
            created: [{
                title: 'Concise commitment title',
                terms: 'What was promised, required, protected, or expected',
                participants: [{
                    personId: 'Existing person ID or null',
                    personName: 'Participant name',
                    role: 'Participant role in this commitment',
                }],
                conditions: ['Condition required for fulfillment or relevance'],
                deadline: 'Explicit or relative deadline, or null',
                facts: ['Durable supporting fact'],
                status: 'pending',
                statusReason: 'Why this status currently applies',
            }],
            updated: [{
                targetId: 'ID copied exactly from Current Commitment Memory',
                append: {
                    facts: ['New durable supporting fact'],
                },
                replace: {
                    title: 'Updated title only when needed',
                    terms: 'Complete current terms',
                    participants: [{
                        personId: 'Existing person ID or null',
                        personName: 'Participant name',
                        role: 'Participant role',
                    }],
                    conditions: ['Complete current condition snapshot'],
                    deadline: 'Current deadline or null',
                    status: 'pending, fulfilled, or obsolete',
                    statusReason: 'Why the new status applies',
                },
            }],
        };
    }
    if (memorySections.events) {
        example.memoryUpdates.events = {
            created: [{
                title: 'Concise event title',
                date: 'Established date or Day N',
                location: 'Established location or location transition',
                summary: 'One brief sentence: essential trigger and decisive outcome',
                importance: 'minor or major',
                shift: 'One short clause stating only the resulting durable state of a major event, otherwise null',
            }],
            updated: [{
                targetId: 'ID copied exactly from Current Event Memory',
                replace: {
                    title: 'Complete revised title',
                    date: 'Complete revised date',
                    location: 'Complete revised location',
                    summary: 'Complete revised event summary',
                    importance: 'minor or major',
                    shift: 'One short clause stating only the revised resulting durable state, or null',
                },
            }],
        };
    }
    if (memorySections.world) {
        example.memoryUpdates.world = {
            created: [{
                keys: ['Concise source-language key', 'Established term'],
                content: 'One short, objective, self-contained world fact',
            }],
            updated: [{
                targetId: 'ID copied exactly from Current World Setting Memory',
                replace: {
                    keys: ['Complete current source-language retrieval keys'],
                    content: 'Complete revised world fact',
                },
            }],
        };
    }

    if (includeCreatedSourceIds) {
        for (const updates of Object.values(example.memoryUpdates)) {
            if (!updates.created?.[0]) continue;
            updates.created[0] = {
                sourceId: 'Copy the exact existing sourceId, or null for a genuinely new entry',
                ...updates.created[0],
            };
        }
    }

    return [
        '# JSON Output Contract',
        '',
        'Return exactly one valid JSON object matching the structure below.',
        'Do not wrap the JSON in Markdown code fences. Do not add a preface, explanation, or commentary.',
        'Use null for an unavailable scalar value and [] when an enabled list has no supported entries.',
        'Do not add properties that are not present in this contract.',
        ...(memorySections.people || memorySections.items || memorySections.commitments || memorySections.events || memorySections.world ? [
            'For every memory category, omit unchanged optional update fields and use empty created/updated arrays when no proposal is supported.',
        ] : []),
        ...(memorySections.commitments ? [
            'Commitment status must be exactly pending, fulfilled, or obsolete.',
        ] : []),
        ...(memorySections.events ? [
            'Most chunks should return empty event created and updated arrays. Never create an event merely to fill the example structure.',
            'Event importance must be exactly minor or major.',
            'Event shift must be null for minor events and null or one short clause for major events.',
            'A shift states only the resulting durable state. Never include its cause, process, actions, emotional reactions, explanation, or an event recap.',
        ] : []),
        '',
        JSON.stringify(example, null, 2),
    ].join('\n');
}

export function buildAtlasReviewJsonContract(category, { includeCreatedSourceIds = false } = {}) {
    const memorySections = createSingleMemorySectionConfiguration(category);
    return buildSummaryJsonContract({}, memorySections, { includeSummary: false, includeCreatedSourceIds });
}

export function parseStructuredSummaryResponse(response, sections, memorySections = DEFAULT_MEMORY_SECTIONS) {
    const source = stripJsonFence(String(response || '').trim());
    if (!source) throw new Error('요약 응답이 비어 있습니다.');

    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        throw new Error(`요약 응답 JSON 파싱에 실패했습니다: ${error.message}`);
    }
    if (!isPlainObject(parsed)) throw new Error('요약 응답은 하나의 JSON 객체여야 합니다.');

    const normalized = {
        title: sections.title ? normalizeNullableString(parsed.title) : null,
        contextFlow: normalizeContextFlow(parsed.contextFlow, sections),
        plot: normalizeStringList(parsed.plot),
        continuityChanges: sections.continuity ? normalizeStringList(parsed.continuityChanges) : [],
        emotions: sections.emotions ? normalizeEmotions(parsed.emotions) : [],
        quotes: sections.quotes ? normalizeQuotes(parsed.quotes) : [],
        tags: sections.tags ? normalizeTags(parsed.tags) : [],
        memoryUpdates: normalizeMemoryUpdates(parsed.memoryUpdates, memorySections),
    };

    if (!normalized.plot.length) throw new Error('요약 응답의 plot에는 최소 한 개의 사건이 필요합니다.');
    return normalized;
}

export function normalizeStructuredSummaryData(value) {
    if (!isPlainObject(value)) throw new Error('구조화 요약 데이터가 올바르지 않습니다.');
    return parseStructuredSummaryResponse(
        JSON.stringify(value),
        DEFAULT_SUMMARY_SECTIONS,
        DEFAULT_MEMORY_SECTIONS,
    );
}

export function parseAtlasReviewResponse(response, category) {
    const source = stripJsonFence(String(response || '').trim());
    if (!source) throw new Error('도감 재검토 응답이 비어 있습니다.');

    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        throw new Error(`도감 재검토 응답 JSON 파싱에 실패했습니다: ${error.message}`);
    }
    if (!isPlainObject(parsed)) throw new Error('도감 재검토 응답은 하나의 JSON 객체여야 합니다.');

    const memorySections = createSingleMemorySectionConfiguration(category);
    return normalizeMemoryUpdates(parsed.memoryUpdates, memorySections)[category];
}

function createSingleMemorySectionConfiguration(category) {
    if (!Object.hasOwn(DEFAULT_MEMORY_SECTIONS, category)) {
        throw new Error(`지원하지 않는 도감 종류입니다: ${category}`);
    }
    return Object.fromEntries(Object.keys(DEFAULT_MEMORY_SECTIONS).map(key => [key, key === category]));
}

function normalizeMemoryUpdates(value, memorySections) {
    const source = isPlainObject(value) ? value : {};
    return {
        people: memorySections.people ? normalizePeopleUpdates(source.people) : { created: [], updated: [] },
        items: memorySections.items ? normalizeItemUpdates(source.items) : { created: [], updated: [] },
        commitments: memorySections.commitments ? normalizeCommitmentUpdates(source.commitments) : { created: [], updated: [] },
        events: memorySections.events ? normalizeEventUpdates(source.events) : { created: [], updated: [] },
        world: memorySections.world ? normalizeWorldUpdates(source.world) : { created: [], updated: [] },
    };
}

function normalizeWorldUpdates(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        created: Array.isArray(source.created) ? source.created.map(normalizeCreatedWorldEntry).filter(Boolean) : [],
        updated: Array.isArray(source.updated) ? source.updated.map(normalizeUpdatedWorldEntry).filter(Boolean) : [],
    };
}

function normalizeCreatedWorldEntry(value) {
    if (!isPlainObject(value)) return null;
    const content = normalizeNullableString(value.content);
    const keys = normalizeStringList(value.keys);
    return content && keys.length ? withCreatedSourceId(value, { keys, content }) : null;
}

function normalizeUpdatedWorldEntry(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'keys')) normalizedReplace.keys = normalizeStringList(replace.keys);
    if (Object.hasOwn(replace, 'content')) normalizedReplace.content = normalizeNullableString(replace.content);
    return { targetId, replace: normalizedReplace };
}

function normalizeEventUpdates(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        created: Array.isArray(source.created) ? source.created.map(normalizeCreatedEvent).filter(Boolean) : [],
        updated: Array.isArray(source.updated) ? source.updated.map(normalizeUpdatedEvent).filter(Boolean) : [],
    };
}

function normalizeCreatedEvent(value) {
    if (!isPlainObject(value)) return null;
    const title = normalizeNullableString(value.title);
    const summary = normalizeNullableString(value.summary);
    if (!title || !summary) return null;
    const importance = normalizeEventImportance(value.importance);
    const shift = normalizeEventShift(value.shift ?? value.shifts, importance);
    return withCreatedSourceId(value, {
        title,
        date: normalizeNullableString(value.date),
        location: normalizeNullableString(value.location),
        summary,
        importance,
        shift,
    });
}

function normalizeUpdatedEvent(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'title')) normalizedReplace.title = normalizeNullableString(replace.title);
    if (Object.hasOwn(replace, 'date')) normalizedReplace.date = normalizeNullableString(replace.date);
    if (Object.hasOwn(replace, 'location')) normalizedReplace.location = normalizeNullableString(replace.location);
    if (Object.hasOwn(replace, 'summary')) normalizedReplace.summary = normalizeNullableString(replace.summary);
    if (Object.hasOwn(replace, 'importance')) normalizedReplace.importance = normalizeEventImportance(replace.importance);
    if (Object.hasOwn(replace, 'shift') || Object.hasOwn(replace, 'shifts')) {
        const importance = normalizedReplace.importance || null;
        normalizedReplace.shift = normalizeEventShift(replace.shift ?? replace.shifts, importance);
    }
    if (normalizedReplace.importance === 'minor') normalizedReplace.shift = null;
    return { targetId, replace: normalizedReplace };
}

function normalizeEventImportance(value) {
    if (value === 'major' || value === 'turning_point') return 'major';
    return 'minor';
}

function normalizeEventShift(value, importance) {
    if (importance === 'minor') return null;
    if (Array.isArray(value)) return normalizeNullableString(value[0]);
    return normalizeNullableString(value);
}

function normalizeCommitmentUpdates(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        created: Array.isArray(source.created) ? source.created.map(normalizeCreatedCommitment).filter(Boolean) : [],
        updated: Array.isArray(source.updated) ? source.updated.map(normalizeUpdatedCommitment).filter(Boolean) : [],
    };
}

function normalizeCreatedCommitment(value) {
    if (!isPlainObject(value)) return null;
    const title = normalizeNullableString(value.title);
    const terms = normalizeNullableString(value.terms);
    if (!title || !terms) return null;
    return withCreatedSourceId(value, {
        title,
        terms,
        participants: normalizeCommitmentParticipants(value.participants),
        conditions: normalizeStringList(value.conditions),
        deadline: normalizeNullableString(value.deadline),
        facts: normalizeStringList(value.facts),
        status: normalizeCommitmentStatus(value.status),
        statusReason: normalizeNullableString(value.statusReason),
    });
}

function normalizeUpdatedCommitment(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const append = isPlainObject(value.append) ? value.append : {};
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'title')) normalizedReplace.title = normalizeNullableString(replace.title);
    if (Object.hasOwn(replace, 'terms')) normalizedReplace.terms = normalizeNullableString(replace.terms);
    if (Object.hasOwn(replace, 'participants')) normalizedReplace.participants = normalizeCommitmentParticipants(replace.participants);
    if (Object.hasOwn(replace, 'conditions')) normalizedReplace.conditions = normalizeStringList(replace.conditions);
    if (Object.hasOwn(replace, 'deadline')) normalizedReplace.deadline = normalizeNullableString(replace.deadline);
    if (Object.hasOwn(replace, 'status')) normalizedReplace.status = normalizeCommitmentStatus(replace.status);
    if (Object.hasOwn(replace, 'statusReason')) normalizedReplace.statusReason = normalizeNullableString(replace.statusReason);
    return {
        targetId,
        append: { facts: normalizeStringList(append.facts) },
        replace: normalizedReplace,
    };
}

function normalizeCommitmentParticipants(value) {
    if (!Array.isArray(value)) return [];
    return value.map(participant => {
        if (!isPlainObject(participant)) return null;
        const personId = normalizeNullableString(participant.personId);
        const personName = normalizeNullableString(participant.personName);
        if (!personId && !personName) return null;
        return {
            personId,
            personName,
            role: normalizeNullableString(participant.role),
        };
    }).filter(Boolean);
}

function normalizeCommitmentStatus(value) {
    return ['pending', 'fulfilled', 'obsolete'].includes(value) ? value : 'pending';
}

function normalizeItemUpdates(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        created: Array.isArray(source.created) ? source.created.map(normalizeCreatedItem).filter(Boolean) : [],
        updated: Array.isArray(source.updated) ? source.updated.map(normalizeUpdatedItem).filter(Boolean) : [],
    };
}

function normalizeCreatedItem(value) {
    if (!isPlainObject(value)) return null;
    const name = normalizeNullableString(value.name);
    if (!name) return null;
    return withCreatedSourceId(value, {
        name,
        aliases: normalizeStringList(value.aliases),
        facts: normalizeStringList(value.facts),
        functions: normalizeStringList(value.functions),
        lastKnownState: normalizeItemState(value.lastKnownState),
    });
}

function normalizeUpdatedItem(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const append = isPlainObject(value.append) ? value.append : {};
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'name')) normalizedReplace.name = normalizeNullableString(replace.name);
    if (Object.hasOwn(replace, 'functions')) normalizedReplace.functions = normalizeStringList(replace.functions);
    if (Object.hasOwn(replace, 'lastKnownState')) normalizedReplace.lastKnownState = normalizeItemStatePatch(replace.lastKnownState);
    return {
        targetId,
        append: {
            aliases: normalizeStringList(append.aliases),
            facts: normalizeStringList(append.facts),
        },
        replace: normalizedReplace,
    };
}

function normalizeItemState(value) {
    if (!isPlainObject(value)) return { owner: null, holder: null, location: null, condition: null, status: null };
    return Object.fromEntries(['owner', 'holder', 'location', 'condition', 'status']
        .map(key => [key, normalizeNullableString(value[key])]));
}

function normalizeItemStatePatch(value) {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(['owner', 'holder', 'location', 'condition', 'status']
        .filter(key => Object.hasOwn(value, key))
        .map(key => [key, normalizeNullableString(value[key])]));
}

function normalizePeopleUpdates(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        created: Array.isArray(source.created) ? source.created.map(normalizeCreatedPerson).filter(Boolean) : [],
        updated: Array.isArray(source.updated) ? source.updated.map(normalizeUpdatedPerson).filter(Boolean) : [],
    };
}

function normalizeCreatedPerson(value) {
    if (!isPlainObject(value)) return null;
    const name = normalizeNullableString(value.name);
    if (!name) return null;
    return withCreatedSourceId(value, {
        name,
        provisional: Boolean(value.provisional),
        aliases: normalizeStringList(value.aliases),
        role: normalizeLegacyScalar(value.role, value.roles),
        age: normalizeNullableString(value.age),
        occupation: normalizeNullableString(value.occupation),
        appearance: normalizeNullableString(value.appearance),
        affiliations: normalizeStringList(value.affiliations),
        traits: normalizeStringList(value.traits ?? value.personalityTraits),
        voice: normalizeLegacyScalar(value.voice, value.speechPatterns),
        lastKnownState: normalizeLastKnownState(value.lastKnownState),
        relationships: normalizeRelationships(value.relationships),
    });
}

function normalizeUpdatedPerson(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const append = isPlainObject(value.append) ? value.append : {};
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'name')) normalizedReplace.name = normalizeNullableString(replace.name);
    if (Object.hasOwn(replace, 'provisional')) normalizedReplace.provisional = Boolean(replace.provisional);
    if (Object.hasOwn(replace, 'role') || Object.hasOwn(replace, 'roles')) {
        normalizedReplace.role = normalizeLegacyScalar(replace.role, replace.roles);
    }
    for (const key of ['age', 'occupation', 'appearance']) {
        if (Object.hasOwn(replace, key)) normalizedReplace[key] = normalizeNullableString(replace[key]);
    }
    if (Object.hasOwn(replace, 'affiliations')) normalizedReplace.affiliations = normalizeStringList(replace.affiliations);
    if (Object.hasOwn(replace, 'traits') || Object.hasOwn(replace, 'personalityTraits')) {
        normalizedReplace.traits = normalizeStringList(replace.traits ?? replace.personalityTraits);
    }
    if (Object.hasOwn(replace, 'voice') || Object.hasOwn(replace, 'speechPatterns')) {
        normalizedReplace.voice = normalizeLegacyScalar(replace.voice, replace.speechPatterns);
    }
    if (Object.hasOwn(replace, 'lastKnownState')) normalizedReplace.lastKnownState = normalizeLastKnownStatePatch(replace.lastKnownState);
    return {
        targetId,
        append: {
            aliases: normalizeStringList(append.aliases),
        },
        replace: normalizedReplace,
        relationshipUpdates: normalizeRelationships(value.relationshipUpdates),
    };
}

function normalizeLegacyScalar(value, legacyValues) {
    const normalized = normalizeNullableString(value);
    if (normalized) return normalized;
    const legacy = normalizeStringList(legacyValues);
    return legacy.length ? legacy.join('; ') : null;
}

function normalizeLastKnownState(value) {
    if (!isPlainObject(value)) return { location: null, physicalCondition: null };
    return {
        location: normalizeNullableString(value.location),
        physicalCondition: normalizeNullableString(value.physicalCondition),
    };
}

function normalizeLastKnownStatePatch(value) {
    if (!isPlainObject(value)) return {};
    const state = {};
    if (Object.hasOwn(value, 'location')) state.location = normalizeNullableString(value.location);
    if (Object.hasOwn(value, 'physicalCondition')) state.physicalCondition = normalizeNullableString(value.physicalCondition);
    return state;
}

function normalizeRelationships(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const targetId = normalizeNullableString(item.targetId);
        const targetName = normalizeNullableString(item.targetName);
        if (!targetId && !targetName) return null;
        return {
            targetId,
            targetName,
            relationship: normalizeStringList(item.relationship),
            feelings: normalizeFeelings(item.feelings),
        };
    }).filter(Boolean);
}

export function renderStructuredSummary(summary, {
    startId,
    endId,
    template = DEFAULT_SUMMARY_CONTENT_TEMPLATE,
    outputSections = DEFAULT_SUMMARY_OUTPUT_SECTIONS,
}) {
    return renderSummaryContentTemplate(template, applyOutputSections(summary, outputSections), { startId, endId });
}

function applyOutputSections(summary, outputSections) {
    const enabled = { ...DEFAULT_SUMMARY_OUTPUT_SECTIONS, ...(outputSections || {}) };
    const contextFlow = (Array.isArray(summary?.contextFlow) ? summary.contextFlow : []).map(item => {
        const next = { ...item };
        if (!enabled.date) {
            delete next.date;
            delete next.relativeDate;
        }
        if (!enabled.time) delete next.time;
        if (!enabled.location) delete next.location;
        return next;
    }).filter(item => Object.values(item).some(Boolean));
    return {
        ...summary,
        title: enabled.title ? summary?.title : null,
        contextFlow,
        plot: enabled.plot ? summary?.plot : [],
        continuityChanges: enabled.continuity ? summary?.continuityChanges : [],
        emotions: enabled.emotions
            ? applyEmotionReasonOutput(summary?.emotions, enabled.emotionReasons)
            : [],
        quotes: enabled.quotes ? summary?.quotes : [],
    };
}

function applyEmotionReasonOutput(emotions, includeReasons) {
    const source = Array.isArray(emotions) ? emotions : [];
    if (includeReasons) return source;
    return source.map(emotion => ({
        ...emotion,
        states: Array.isArray(emotion.states)
            ? emotion.states.map(state => ({ ...state, reason: null }))
            : [],
    }));
}

function normalizeContextFlow(value, sections) {
    if (!(sections.date || sections.time || sections.location) || !Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const normalized = {};
        if (sections.date) {
            normalized.date = normalizeNullableString(item.date);
            normalized.relativeDate = normalizeNullableString(item.relativeDate);
        }
        if (sections.time) normalized.time = normalizeNullableString(item.time);
        if (sections.location) normalized.location = normalizeNullableString(item.location);
        return Object.values(normalized).some(Boolean) ? normalized : null;
    }).filter(Boolean);
}

function normalizeEmotions(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const subject = normalizeNullableString(item.subject);
        const states = Array.isArray(item.states) ? item.states.map(state => {
            if (!isPlainObject(state)) return null;
            const emotion = normalizeNullableString(state.emotion);
            if (!emotion) return null;
            return { emotion, reason: normalizeNullableString(state.reason) };
        }).filter(Boolean) : [];
        if (!subject || !states.length) return null;
        return { subject, toward: normalizeNullableString(item.toward), states };
    }).filter(Boolean);
}

function normalizeQuotes(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const speaker = normalizeNullableString(item.speaker);
        const text = normalizeNullableString(item.text);
        if (!speaker || !text) return null;
        return { speaker, text };
    }).filter(Boolean);
}

function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (typeof item === 'string') {
            const canonical = normalizeNullableString(item);
            return canonical ? { canonical, matchTerms: [] } : null;
        }
        if (!isPlainObject(item)) return null;
        const canonical = normalizeNullableString(item.canonical);
        if (!canonical) return null;
        return { canonical, matchTerms: normalizeStringList(item.matchTerms) };
    }).filter(Boolean);
}

function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeNullableString).filter(Boolean);
}

function normalizeNullableString(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

function withCreatedSourceId(source, normalized) {
    const sourceId = normalizeNullableString(source.sourceId);
    return sourceId ? { sourceId, ...normalized } : normalized;
}

function stripJsonFence(value) {
    const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : value;
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
