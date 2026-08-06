export const DEFAULT_SUMMARY_CONTENT_TEMPLATE = `{{#sumiSummaryTitle}}### #{{sumiSummaryStartId}} ~ #{{sumiSummaryEndId}} - {{value}}{{/sumiSummaryTitle}}{{^sumiSummaryTitle}}### #{{sumiSummaryStartId}} ~ #{{sumiSummaryEndId}}{{/sumiSummaryTitle}}
{{#sumiSummaryDateFlow}}
- date: {{value}}
{{/sumiSummaryDateFlow}}
{{#sumiSummaryRelativeDateFlow}}
- relative date: {{value}}
{{/sumiSummaryRelativeDateFlow}}
{{#sumiSummaryTimeFlow}}
- time: {{value}}
{{/sumiSummaryTimeFlow}}
{{#sumiSummaryLocationFlow}}
- location: {{value}}
{{/sumiSummaryLocationFlow}}
{{#sumiSummaryPlot}}
{{#first}}- plot:
{{/first}}  - {{value}}
{{/sumiSummaryPlot}}
{{#sumiSummaryContinuityChanges}}
{{#first}}- continuity changes:
{{/first}}  - {{value}}
{{/sumiSummaryContinuityChanges}}
{{#sumiSummaryEmotions}}
{{#first}}- emotion:
{{/first}}  - {{subject}}{{#toward}} -> {{value}}{{/toward}}: {{#states}}{{emotion}}{{#reason}} (because {{value}}){{/reason}}{{^last}} -> {{/last}}{{/states}}
{{/sumiSummaryEmotions}}
{{#sumiSummaryQuotes}}
{{#first}}- key dialogue:
{{/first}}  - {{speaker}}: "{{text}}"
{{/sumiSummaryQuotes}}`;

export const SUMMARY_CONTENT_TEMPLATE_MACROS = Object.freeze([
    ['sumiSummaryStartId', '요약 시작 메시지 ID'],
    ['sumiSummaryEndId', '요약 종료 메시지 ID'],
    ['sumiSummaryTitle', '제목. 값은 {{value}}'],
    ['sumiSummaryContextFlow', '날짜·상대 날짜·시간·장소 배열. date, relativeDate, time, location 사용'],
    ['sumiSummaryDateFlow', '날짜 흐름. 값은 {{value}}'],
    ['sumiSummaryRelativeDateFlow', '상대 날짜 흐름. 값은 {{value}}'],
    ['sumiSummaryTimeFlow', '시간 흐름. 값은 {{value}}'],
    ['sumiSummaryLocationFlow', '장소 흐름. 값은 {{value}}'],
    ['sumiSummaryPlot', '플롯 배열. value, index, first, last 사용'],
    ['sumiSummaryContinuityChanges', '연속성 변화 배열. value, index, first, last 사용'],
    ['sumiSummaryEmotions', '감정 배열. subject, toward, states 사용'],
    ['states', '감정 내부 상태 배열. emotion, reason, index, first, last 사용'],
    ['sumiSummaryQuotes', '주요 대사 배열. speaker, text 사용'],
    ['sumiSummaryTags', '검색 태그 배열. canonical, matchTerms 사용. 기본 템플릿에서는 출력하지 않음'],
]);

export function renderSummaryContentTemplate(template, summary, { startId, endId }) {
    const values = {
        sumiSummaryStartId: startId,
        sumiSummaryEndId: endId,
        sumiSummaryTitle: summary.title,
        sumiSummaryContextFlow: summary.contextFlow,
        sumiSummaryDateFlow: createFlow(summary.contextFlow, 'date'),
        sumiSummaryRelativeDateFlow: createFlow(summary.contextFlow, 'relativeDate'),
        sumiSummaryTimeFlow: createFlow(summary.contextFlow, 'time'),
        sumiSummaryLocationFlow: createFlow(summary.contextFlow, 'location'),
        sumiSummaryPlot: summary.plot,
        sumiSummaryContinuityChanges: summary.continuityChanges,
        sumiSummaryEmotions: summary.emotions,
        sumiSummaryQuotes: summary.quotes,
        sumiSummaryTags: summary.tags,
    };
    return renderTemplateData(template, values);
}

export function renderTemplateData(template, values) {
    return renderNodes(parseTemplate(String(template || '')), [values && typeof values === 'object' ? values : {}]).trim();
}

function createFlow(contextFlow, key) {
    const values = (Array.isArray(contextFlow) ? contextFlow : []).map(item => item?.[key]).filter(Boolean);
    const unique = values.filter((value, index) => index === 0 || value !== values[index - 1]);
    return unique.length ? unique.join(' -> ') : '';
}

function parseTemplate(template) {
    const normalizedTemplate = template.replace(
        /^[\t ]*({{\s*[#^\/][A-Za-z0-9_.]+\s*}})[\t ]*(?:\r?\n|$)/gm,
        '$1',
    );
    const root = [];
    const stack = [{ name: null, children: root }];
    const pattern = /{{\s*([#^\/]?)([A-Za-z0-9_.]+)\s*}}/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(normalizedTemplate))) {
        if (match.index > cursor) stack.at(-1).children.push({ type: 'text', value: normalizedTemplate.slice(cursor, match.index) });
        const [, marker, name] = match;
        if (marker === '#' || marker === '^') {
            const node = { type: 'section', name, inverted: marker === '^', children: [] };
            stack.at(-1).children.push(node);
            stack.push(node);
        } else if (marker === '/') {
            if (stack.length === 1 || stack.at(-1).name !== name) {
                throw new Error(`요약 레코드 템플릿의 닫는 블록이 올바르지 않습니다: ${name}`);
            }
            stack.pop();
        } else {
            stack.at(-1).children.push({ type: 'variable', name });
        }
        cursor = pattern.lastIndex;
    }
    if (cursor < normalizedTemplate.length) stack.at(-1).children.push({ type: 'text', value: normalizedTemplate.slice(cursor) });
    if (stack.length !== 1) throw new Error(`요약 레코드 템플릿의 블록이 닫히지 않았습니다: ${stack.at(-1).name}`);
    return root;
}

function renderNodes(nodes, contexts) {
    return nodes.map(node => {
        if (node.type === 'text') return node.value;
        const value = resolveValue(node.name, contexts);
        if (node.type === 'variable') return stringifyValue(value);
        const empty = !value || (Array.isArray(value) && !value.length);
        if (node.inverted) return empty ? renderNodes(node.children, contexts) : '';
        if (empty) return '';
        if (Array.isArray(value)) {
            return value.map((item, index) => renderNodes(node.children, [createItemContext(item, index, value.length), ...contexts])).join('');
        }
        if (typeof value === 'object') return renderNodes(node.children, [value, ...contexts]);
        return renderNodes(node.children, [{ value }, ...contexts]);
    }).join('');
}

function createItemContext(item, index, length) {
    const metadata = { index, first: index === 0, last: index === length - 1 };
    if (item && typeof item === 'object') return { ...item, ...metadata };
    return { value: item, ...metadata };
}

function resolveValue(path, contexts) {
    const segments = path.split('.');
    for (const context of contexts) {
        let value = context;
        let found = true;
        for (const segment of segments) {
            if (value === null || value === undefined || !Object.hasOwn(Object(value), segment)) {
                found = false;
                break;
            }
            value = value[segment];
        }
        if (found) return value;
    }
    return '';
}

function stringifyValue(value) {
    if (value === null || value === undefined || value === false) return '';
    if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join('; ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
