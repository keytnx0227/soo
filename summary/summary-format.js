export const SUMMARY_FORMAT_VERSION = 1;

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

export const DEFAULT_MEMORY_SECTIONS = Object.freeze({
    people: true,
    items: true,
});

export const SUMMARY_SECTION_DESCRIPTIONS = Object.freeze({
    plot: '요약 대상에서 일어난 사건과 원인, 결과를 시간 순서대로 기록합니다. 항상 포함되는 필수 항목입니다.',
    title: '해당 요약 청크의 중심 장면이나 사건을 알아보기 쉬운 짧은 제목으로 만듭니다.',
    date: '명시된 날짜를 우선 사용하고, 날짜가 없다면 최근 요약과 이어지는 Day N 흐름을 추적합니다.',
    time: '작중 시간이나 시간대를 기록하고, 청크 안에서 시간이 변하면 흐름에 따라 나눕니다.',
    location: '사건이 일어난 장소와 청크 안에서 발생한 장소 이동을 시간 순서대로 기록합니다.',
    continuity: '새로 알게 된 사실, 관계 상태, 목표, 신체 상태, 소지품처럼 이후 장면에 영향을 줄 비감정적 변화를 기록합니다.',
    emotions: '인물별 감정이 어떻게 변했는지와 그 이유를 시간 순서대로 기록합니다.',
    quotes: '표현 자체가 중요한 대사나 약속, 폭로, 관계 변화와 향후 회상에 유용한 대사를 보존합니다.',
    tags: '청크를 나중에 다시 찾기 위한 검색용 메타데이터를 생성합니다. 태그는 요약 본문이나 {{sumiSummary}}에 출력되지 않습니다.',
    people: '요약 대상에서 확인된 인물의 장기 정보와 기존 인물에 대한 변경안을 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
    items: '요약 대상에서 확인된 중요한 아이템의 장기 정보와 기존 아이템에 대한 변경안을 추출합니다. 청크 요약 본문에는 출력되지 않습니다.',
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

export function buildSummaryJsonContract(sections, memorySections = DEFAULT_MEMORY_SECTIONS) {
    const example = {};
    if (sections.title) example.title = 'A concise title for this chunk';

    if (sections.date || sections.time || sections.location) {
        const context = {};
        if (sections.date) {
            context.date = 'An explicit date or a continuous Day N value';
            context.relativeDate = null;
        }
        if (sections.time) context.time = 'The time or time period';
        if (sections.location) context.location = 'The current location';
        example.contextFlow = [context];
    }

    example.plot = ['A chronological plot beat grounded in the source messages.'];
    if (sections.continuity) example.continuityChanges = ['A concrete non-emotional state change.'];
    if (sections.emotions) {
        example.emotions = [{
            subject: 'Character name',
            toward: 'Target name or null',
            states: [{ emotion: 'Emotion', reason: 'Cause grounded in the source messages' }],
        }];
    }
    if (sections.quotes) {
        example.quotes = [{
            speaker: 'Speaker name',
            text: 'Important dialogue',
            context: 'Why or when the line was spoken',
        }];
    }
    if (sections.tags) {
        example.tags = [{
            canonical: 'Specific retrieval concept',
            matchTerms: ['Relevant source-language term'],
        }];
    }
    if (memorySections.people || memorySections.items) {
        example.memoryUpdates = {};
    }
    if (memorySections.people) {
        example.memoryUpdates.people = {
                created: [{
                    name: 'Canonical character name',
                    aliases: ['Established alias'],
                    facts: ['Durable objective fact'],
                    roles: ['Current role'],
                    affiliations: ['Current affiliation'],
                    personalityTraits: ['Stable personality trait'],
                    speechPatterns: ['Distinctive speech pattern'],
                    lastKnownState: {
                        location: 'Last location observed in the target or null',
                        physicalCondition: 'Last physical condition observed in the target or null',
                    },
                    relationships: [{
                        targetId: null,
                        targetName: 'Related character name',
                        relationship: ['Current relationship description'],
                        feelings: ['Current durable feeling toward the target'],
                    }],
                }],
                updated: [{
                    targetId: 'ID copied exactly from Current People Memory',
                    append: {
                        aliases: ['Newly established alias'],
                        facts: ['New durable objective fact'],
                    },
                    replace: {
                        name: 'New canonical name only when the name changed',
                        roles: ['Complete current role snapshot'],
                        affiliations: ['Complete current affiliation snapshot'],
                        personalityTraits: ['Complete current personality snapshot'],
                        speechPatterns: ['Complete current speech-pattern snapshot'],
                        lastKnownState: {
                            location: 'Last location observed in the target or null',
                            physicalCondition: 'Last physical condition observed in the target or null',
                        },
                    },
                    relationshipUpdates: [{
                        targetId: 'Existing related-person ID or null',
                        targetName: 'Related character name',
                        relationship: ['Complete current relationship snapshot'],
                        feelings: ['Complete current durable-feeling snapshot'],
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

    return [
        '# JSON Output Contract',
        '',
        'Return exactly one valid JSON object matching the structure below.',
        'Do not wrap the JSON in Markdown code fences. Do not add a preface, explanation, or commentary.',
        'Use null for an unavailable scalar value and [] when an enabled list has no supported entries.',
        'Do not add properties that are not present in this contract.',
        ...(memorySections.people ? [
            'For people.updated entries, omit optional replace properties that did not change; the example shows the available property shapes, not a requirement to repeat them all.',
            'When there are no supported people-memory proposals, return empty created and updated arrays.',
        ] : []),
        ...(memorySections.items ? [
            'For items.updated entries, omit optional replace properties that did not change; the example shows the available property shapes, not a requirement to repeat them all.',
            'When there are no supported item-memory proposals, return empty created and updated arrays.',
        ] : []),
        '',
        JSON.stringify(example, null, 2),
    ].join('\n');
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

function normalizeMemoryUpdates(value, memorySections) {
    const source = isPlainObject(value) ? value : {};
    return {
        people: memorySections.people ? normalizePeopleUpdates(source.people) : { created: [], updated: [] },
        items: memorySections.items ? normalizeItemUpdates(source.items) : { created: [], updated: [] },
    };
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
    return {
        name,
        aliases: normalizeStringList(value.aliases),
        facts: normalizeStringList(value.facts),
        functions: normalizeStringList(value.functions),
        lastKnownState: normalizeItemState(value.lastKnownState),
    };
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
    return {
        name,
        aliases: normalizeStringList(value.aliases),
        facts: normalizeStringList(value.facts),
        roles: normalizeStringList(value.roles),
        affiliations: normalizeStringList(value.affiliations),
        personalityTraits: normalizeStringList(value.personalityTraits),
        speechPatterns: normalizeStringList(value.speechPatterns),
        lastKnownState: normalizeLastKnownState(value.lastKnownState),
        relationships: normalizeRelationships(value.relationships),
    };
}

function normalizeUpdatedPerson(value) {
    if (!isPlainObject(value)) return null;
    const targetId = normalizeNullableString(value.targetId);
    if (!targetId) return null;
    const append = isPlainObject(value.append) ? value.append : {};
    const replace = isPlainObject(value.replace) ? value.replace : {};
    const normalizedReplace = {};
    if (Object.hasOwn(replace, 'name')) normalizedReplace.name = normalizeNullableString(replace.name);
    for (const key of ['roles', 'affiliations', 'personalityTraits', 'speechPatterns']) {
        if (Object.hasOwn(replace, key)) normalizedReplace[key] = normalizeStringList(replace[key]);
    }
    if (Object.hasOwn(replace, 'lastKnownState')) normalizedReplace.lastKnownState = normalizeLastKnownStatePatch(replace.lastKnownState);
    return {
        targetId,
        append: {
            aliases: normalizeStringList(append.aliases),
            facts: normalizeStringList(append.facts),
        },
        replace: normalizedReplace,
        relationshipUpdates: normalizeRelationships(value.relationshipUpdates),
    };
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
            feelings: normalizeStringList(item.feelings),
        };
    }).filter(Boolean);
}

export function renderStructuredSummary(summary, { startId, endId, sections }) {
    const heading = summary.title
        ? `### #${startId} ~ #${endId} - ${summary.title}`
        : `### #${startId} ~ #${endId}`;
    const lines = [heading];

    appendContextLine(lines, 'date', summary.contextFlow, 'date', sections.date);
    appendContextLine(lines, 'relative date', summary.contextFlow, 'relativeDate', sections.date);
    appendContextLine(lines, 'time', summary.contextFlow, 'time', sections.time);
    appendContextLine(lines, 'location', summary.contextFlow, 'location', sections.location);
    appendList(lines, 'plot', summary.plot);
    appendList(lines, 'continuity changes', summary.continuityChanges);

    if (summary.emotions.length) {
        lines.push('- emotion:');
        for (const item of summary.emotions) {
            const target = item.toward ? ` -> ${item.toward}` : '';
            const flow = item.states
                .map(state => state.reason ? `${state.emotion} (because ${state.reason})` : state.emotion)
                .join(' -> ');
            lines.push(`  - ${item.subject}${target}: ${flow}`);
        }
    }

    if (summary.quotes.length) {
        lines.push('- key dialogue:');
        for (const quote of summary.quotes) {
            const context = quote.context ? ` (${quote.context})` : '';
            lines.push(`  - ${quote.speaker}: "${quote.text}"${context}`);
        }
    }

    return lines.join('\n');
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
        return { speaker, text, context: normalizeNullableString(item.context) };
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

function appendContextLine(lines, label, contextFlow, key, enabled) {
    if (!enabled) return;
    const values = dedupeConsecutive(contextFlow.map(item => item[key]).filter(Boolean));
    if (values.length) lines.push(`- ${label}: ${values.join(' -> ')}`);
}

function appendList(lines, label, values) {
    if (!values?.length) return;
    lines.push(`- ${label}:`);
    values.forEach(value => lines.push(`  - ${value}`));
}

function dedupeConsecutive(values) {
    return values.filter((value, index) => index === 0 || value !== values[index - 1]);
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

function stripJsonFence(value) {
    const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : value;
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
