import { renderTemplateData } from './summary-record-template.js';

export const COMPRESSION_FORMAT_VERSION = 1;

export const DEFAULT_COMPRESSION_CONTENT_TEMPLATE = `[#{{sumiCompressionStartId}}-{{sumiCompressionEndId}}{{#sumiCompressionContext}} | {{value}}{{/sumiCompressionContext}}]
{{#sumiCompressionPlot}}- {{value}}
{{/sumiCompressionPlot}}
{{#sumiCompressionEmotions}}{{#first}}Emotion:
{{/first}}- {{subject}}: {{#trajectory}}{{value}}{{^last}} -> {{/last}}{{/trajectory}}{{#reason}} ({{value}}){{/reason}}
{{/sumiCompressionEmotions}}
{{#sumiCompressionRelationships}}{{#first}}Relationship:
{{/first}}- {{participants}}: {{#trajectory}}{{value}}{{^last}} -> {{/last}}{{/trajectory}}
{{/sumiCompressionRelationships}}
{{#sumiCompressionQuotes}}{{#first}}Quotes:
{{/first}}- {{speaker}}: "{{text}}"
{{/sumiCompressionQuotes}}`;

export const COMPRESSION_CONTENT_TEMPLATE_MACROS = Object.freeze([
    ['sumiCompressionStartId', '압축 범위 시작 메시지 ID'],
    ['sumiCompressionEndId', '압축 범위 종료 메시지 ID'],
    ['sumiCompressionContext', '날짜·시간·장소 흐름을 합친 헤더 문자열. 값은 {{value}}'],
    ['sumiCompressionContextFlow', '날짜·시간·장소 배열. date, time, location 사용'],
    ['sumiCompressionPlot', '압축된 핵심 사건 배열. value, index, first, last 사용'],
    ['sumiCompressionEmotions', '감정 궤적 배열. subject, trajectory, reason 사용'],
    ['sumiCompressionRelationships', '관계 궤적 배열. participants, trajectory 사용'],
    ['trajectory', '감정·관계 내부의 시간순 상태 배열. value, index, first, last 사용'],
    ['sumiCompressionQuotes', '대표 대사 배열. speaker, text 사용'],
]);

export function buildCompressionJsonContract() {
    return [
        '# JSON Output Contract',
        '',
        'Return exactly one valid JSON object matching this structure.',
        'Do not use Markdown fences, commentary, or additional properties.',
        '',
        JSON.stringify({
            contextFlow: [{
                date: 'Day 1 or an explicit date',
                time: 'A concise time period',
                location: 'A concise location',
            }],
            plot: ['One concise causal event per item'],
            emotions: [{
                subject: 'Character name',
                trajectory: ['Representative emotion from each source summary'],
                reason: 'One compact causal clause for the whole arc',
            }],
            relationships: [{
                participants: ['Character A', 'Character B'],
                trajectory: ['Relationship snapshot from each source summary'],
            }],
            quotes: [{
                speaker: 'Speaker name',
                text: 'Exact source dialogue',
            }],
        }, null, 2),
    ].join('\n');
}

export function parseCompressionResponse(response) {
    const source = stripCodeFence(response);
    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        throw new Error(`압축 요약 응답 JSON 파싱에 실패했습니다: ${error.message}`);
    }
    if (!isPlainObject(parsed)) throw new Error('압축 요약 응답은 하나의 JSON 객체여야 합니다.');

    const result = {
        contextFlow: normalizeContextFlow(parsed.contextFlow),
        plot: normalizeStringList(parsed.plot),
        emotions: normalizeEmotions(parsed.emotions),
        relationships: normalizeRelationships(parsed.relationships),
        quotes: normalizeQuotes(parsed.quotes),
    };
    if (!result.plot.length) throw new Error('압축 요약에는 하나 이상의 plot 항목이 필요합니다.');
    return result;
}

export function renderCompressionSummary(summary, { startId, endId, template = DEFAULT_COMPRESSION_CONTENT_TEMPLATE }) {
    return renderTemplateData(template, {
        sumiCompressionStartId: startId,
        sumiCompressionEndId: endId,
        sumiCompressionContext: renderContextFlow(summary.contextFlow),
        sumiCompressionContextFlow: summary.contextFlow,
        sumiCompressionPlot: summary.plot,
        sumiCompressionEmotions: summary.emotions,
        sumiCompressionRelationships: summary.relationships.map(item => ({
            ...item,
            participants: item.participants.join(' <-> '),
        })),
        sumiCompressionQuotes: summary.quotes,
    });
}

function renderContextFlow(flow) {
    return ['date', 'time', 'location']
        .map(key => dedupeAdjacent(flow.map(item => item[key]).filter(Boolean)).join(' -> '))
        .filter(Boolean)
        .join(' | ');
}

function normalizeContextFlow(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => isPlainObject(item) ? {
        date: normalizeNullableString(item.date),
        time: normalizeNullableString(item.time),
        location: normalizeNullableString(item.location),
    } : null).filter(item => item && (item.date || item.time || item.location));
}

function normalizeEmotions(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const subject = normalizeNullableString(item.subject);
        const trajectory = dedupeAdjacent(normalizeStringList(item.trajectory));
        if (!subject || !trajectory.length) return null;
        return {
            subject,
            trajectory,
            reason: normalizeNullableString(item.reason),
        };
    }).filter(Boolean);
}

function normalizeRelationships(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!isPlainObject(item)) return null;
        const participants = normalizeStringList(item.participants).slice(0, 3);
        const trajectory = dedupeAdjacent(normalizeStringList(item.trajectory));
        if (participants.length < 2 || !trajectory.length) return null;
        return { participants, trajectory };
    }).filter(Boolean).slice(0, 3);
}

function normalizeQuotes(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => isPlainObject(item) ? {
        speaker: normalizeNullableString(item.speaker),
        text: normalizeNullableString(item.text),
    } : null).filter(item => item?.speaker && item.text).slice(0, 3);
}

function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeNullableString).filter(Boolean);
}

function normalizeNullableString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function dedupeAdjacent(values) {
    return values.filter((value, index) => index === 0 || value.toLocaleLowerCase() !== values[index - 1].toLocaleLowerCase());
}

function stripCodeFence(value) {
    const source = String(value || '').trim();
    const match = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return (match ? match[1] : source).trim();
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
