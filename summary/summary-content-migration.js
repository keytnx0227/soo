import { renderStructuredSummary } from './summary-format.js';
import { COMPACT_SUMMARY_CONTENT_TEMPLATE } from './summary-record-template.js';
import { getSummaryRecords, saveSummaryContentMigrationResults } from './summary-store.js';

const FLOW_KEYS = ['date', 'relativeDate', 'time', 'location'];
const SECTION_HEADERS = new Map([
    ['Continuity:', 'continuityChanges'],
    ['Emotion:', 'emotions'],
    ['Quotes:', 'quotes'],
]);

export async function migrateEditedSummaryContents() {
    const candidates = getSummaryRecords().filter(record => (
        record.type === 'summary'
        && record.contentEdited
        && record.structuredSummary?.data
    ));
    if (!candidates.length) return { migrated: [], failed: [] };

    const migrated = [];
    const failed = [];
    for (const record of candidates) {
        try {
            const result = migrateRecord(record);
            migrated.push({
                recordId: record.id,
                range: `#${record.startId} ~ #${record.endId}`,
                data: result.data,
                changedFields: result.changedFields,
            });
        } catch (error) {
            failed.push({
                recordId: record.id,
                range: `#${record.startId} ~ #${record.endId}`,
                reason: error.message || String(error),
            });
        }
    }

    if (migrated.length) await saveSummaryContentMigrationResults(migrated);
    return { migrated, failed };
}

function migrateRecord(record) {
    const parsed = parseCompactContent(record);
    const original = record.structuredSummary.data;
    const data = structuredClone(original);
    data.title = parsed.title;
    data.contextFlow = applyContextFlow(data.contextFlow, parsed.flows);
    data.plot = parsed.plot;
    data.continuityChanges = parsed.continuityChanges;
    data.emotions = parsed.emotions;
    data.quotes = parsed.quotes;

    const rendered = renderStructuredSummary(data, {
        startId: record.startId,
        endId: record.endId,
        template: COMPACT_SUMMARY_CONTENT_TEMPLATE,
    });
    if (normalizeForComparison(rendered) !== normalizeForComparison(record.content)) {
        throw new Error('역변환 후 간략 형식이 기존 편집 내용과 일치하지 않습니다.');
    }
    return {
        data,
        changedFields: collectChangedFields(original, data),
    };
}

function collectChangedFields(original, migrated) {
    const fields = [
        ['title', '제목'],
        ['plot', '플롯'],
        ['continuityChanges', '연속성 변화'],
        ['emotions', '감정'],
        ['quotes', '주요 대사'],
    ];
    const changed = fields
        .filter(([key]) => !isSameValue(original?.[key], migrated?.[key]))
        .map(([, label]) => label);

    const flowLabels = { date: '날짜', relativeDate: '상대 날짜', time: '시간', location: '장소' };
    for (const key of FLOW_KEYS) {
        const before = createFlow(original?.contextFlow, key);
        const after = createFlow(migrated?.contextFlow, key);
        if (before !== after) changed.push(flowLabels[key]);
    }
    return changed;
}

function isSameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function parseCompactContent(record) {
    const lines = normalizeNewlines(record.content).trim().split('\n');
    const header = lines.shift()?.trimEnd() || '';
    const headerMatch = header.match(/^\[#(\d+)-(\d+)((?: \| [^\]]*)*)\](?: (.*))?$/);
    if (!headerMatch) throw new Error('간략 형식의 첫 줄을 인식하지 못했습니다.');
    if (Number(headerMatch[1]) !== record.startId || Number(headerMatch[2]) !== record.endId) {
        throw new Error('편집된 본문의 범위와 레코드 범위가 다릅니다.');
    }

    const originalFlows = getRenderedFlows(record.structuredSummary.data.contextFlow);
    const flowValues = headerMatch[3]
        ? headerMatch[3].split(' | ').slice(1).map(value => value.trim())
        : [];
    if (flowValues.length !== originalFlows.length || flowValues.some(value => !value)) {
        throw new Error('날짜·시간·장소 흐름의 개수가 기존 구조와 다릅니다.');
    }
    const flows = Object.fromEntries(originalFlows.map((flow, index) => [flow.key, flowValues[index]]));

    const result = {
        title: headerMatch[4]?.trim() || null,
        flows,
        plot: [],
        continuityChanges: [],
        emotions: [],
        quotes: [],
    };
    let section = 'plot';
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) continue;
        if (SECTION_HEADERS.has(line)) {
            section = SECTION_HEADERS.get(line);
            continue;
        }
        if (!line.startsWith('- ')) throw new Error(`인식할 수 없는 본문 행입니다: ${line}`);
        const value = line.slice(2);
        if (section === 'plot' || section === 'continuityChanges') result[section].push(value);
        else if (section === 'emotions') result.emotions.push(parseEmotion(value));
        else if (section === 'quotes') result.quotes.push(parseQuote(value));
    }
    if (!result.plot.length) throw new Error('플롯 항목을 찾지 못했습니다.');
    return result;
}

function getRenderedFlows(contextFlow) {
    return FLOW_KEYS.map(key => ({ key, value: createFlow(contextFlow, key) })).filter(item => item.value);
}

function createFlow(contextFlow, key) {
    const values = (Array.isArray(contextFlow) ? contextFlow : []).map(item => item?.[key]).filter(Boolean);
    return values.filter((value, index) => index === 0 || value !== values[index - 1]).join(' -> ');
}

function applyContextFlow(contextFlow, renderedFlows) {
    const next = Array.isArray(contextFlow) ? structuredClone(contextFlow) : [];
    for (const [key, rendered] of Object.entries(renderedFlows)) {
        const replacements = splitOutsideParentheses(rendered);
        const originalRuns = createFlow(next, key) ? splitOutsideParentheses(createFlow(next, key)) : [];
        if (replacements.length !== originalRuns.length) {
            throw new Error(`${key} 흐름의 단계 수가 기존 구조와 다릅니다.`);
        }
        let runIndex = -1;
        let previous = null;
        for (const item of next) {
            const value = item?.[key];
            if (!value) continue;
            if (value !== previous) {
                runIndex += 1;
                previous = value;
            }
            item[key] = replacements[runIndex];
        }
    }
    return next;
}

function parseEmotion(value) {
    const separator = value.indexOf(': ');
    if (separator < 1) throw new Error(`감정 항목을 인식하지 못했습니다: ${value}`);
    const identity = value.slice(0, separator);
    const identityParts = identity.split(' -> ');
    if (identityParts.length > 2 || !identityParts[0].trim()) {
        throw new Error(`감정 주체를 인식하지 못했습니다: ${value}`);
    }
    const states = splitOutsideParentheses(value.slice(separator + 2)).map(parseEmotionState);
    if (!states.length) throw new Error(`감정 상태를 찾지 못했습니다: ${value}`);
    return {
        subject: identityParts[0].trim(),
        toward: identityParts[1]?.trim() || null,
        states,
    };
}

function parseEmotionState(value) {
    const match = value.trim().match(/^(.*?)(?: \(because (.*)\))?$/);
    const emotion = match?.[1]?.trim();
    if (!emotion) throw new Error(`감정 상태를 인식하지 못했습니다: ${value}`);
    return { emotion, reason: match[2]?.trim() || null };
}

function parseQuote(value) {
    const separator = value.indexOf(': "');
    if (separator < 1 || !value.endsWith('"')) throw new Error(`대사 항목을 인식하지 못했습니다: ${value}`);
    return {
        speaker: value.slice(0, separator).trim(),
        text: value.slice(separator + 3, -1),
    };
}

function splitOutsideParentheses(value) {
    const parts = [];
    let depth = 0;
    let cursor = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '(') depth += 1;
        else if (value[index] === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && value.slice(index, index + 4) === ' -> ') {
            parts.push(value.slice(cursor, index).trim());
            cursor = index + 4;
            index += 3;
        }
    }
    parts.push(value.slice(cursor).trim());
    return parts.filter(Boolean);
}

function normalizeForComparison(value) {
    return normalizeNewlines(value)
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

function normalizeNewlines(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
}
