import { getRecordTags } from '../records/record-tags.js';

const RELEVANCE_THRESHOLDS = Object.freeze({
    loose: 1,
    balanced: 2.75,
    strict: 5.5,
});

export function retrieveLongTermRecords({
    records,
    messages,
    settings,
    countTokens = approximateTokenCount,
    selectCandidates = selectWithinBudget,
}) {
    const allRecords = Array.isArray(records) ? records : [];
    const longTermRecords = allRecords.filter(record => Boolean(record?.compressedBy) && !record.llmHidden);
    const normalizedSettings = normalizeRetrievalSettings(settings);
    const contextMessages = getRecentSearchMessages(messages, normalizedSettings.messageCount);
    const base = {
        enabled: normalizedSettings.enabled,
        mode: normalizedSettings.mode,
        contextMessageCount: contextMessages.length,
        longTermRecordCount: longTermRecords.length,
        pinnedRecordCount: longTermRecords.filter(record => record.pinned).length,
        candidates: [],
        excludedByThreshold: [],
        excludedByRecordLimit: [],
        selected: [],
        omittedByRetrievalBudget: [],
        injected: [],
        omittedByInjectionBudget: [],
    };
    if (!normalizedSettings.enabled || !longTermRecords.length) return base;

    const normalizedMessages = contextMessages.map((message, index) => ({
        text: normalizeSearchText(message.mes),
        recency: getMessageRecencyWeight(index, contextMessages.length, normalizedSettings),
    })).filter(message => message.text);
    if (!normalizedMessages.length && !base.pinnedRecordCount) return base;

    const documentFrequencies = buildDocumentFrequencies(longTermRecords);
    const evaluated = longTermRecords.map(record => matchRecord(
        record,
        normalizedMessages,
        documentFrequencies,
        longTermRecords.length,
        countTokens,
    ));
    const pinnedCandidates = evaluated.filter(result => result.pinned);
    const matchedCandidates = evaluated.filter(result => !result.pinned && result.matchedConcepts.length);
    const candidates = [...pinnedCandidates, ...matchedCandidates];
    const threshold = RELEVANCE_THRESHOLDS[normalizedSettings.relevance] ?? RELEVANCE_THRESHOLDS.balanced;
    const eligible = normalizedSettings.mode === 'relevance'
        ? candidates.filter(result => result.pinned || result.score >= threshold)
        : candidates;
    const excludedByThreshold = normalizedSettings.mode === 'relevance'
        ? candidates.filter(result => !result.pinned && result.score < threshold)
        : [];
    const ranked = [...eligible].sort((left, right) => (
        Number(right.pinned) - Number(left.pinned)
        || (normalizedSettings.mode === 'relevance'
            ? right.score - left.score || right.record.endId - left.record.endId
            : right.record.endId - left.record.endId || right.record.startId - left.record.startId)
    ));
    const rankedPinned = ranked.filter(result => result.pinned);
    const rankedOrdinary = ranked.filter(result => !result.pinned);
    const limitedOrdinary = normalizedSettings.mode === 'relevance' && normalizedSettings.relevanceLimitMode === 'top'
        ? rankedOrdinary.slice(0, normalizedSettings.relevanceMaxRecords)
        : rankedOrdinary;
    const limited = [...rankedPinned, ...limitedOrdinary];
    const excludedByRecordLimit = limitedOrdinary.length < rankedOrdinary.length
        ? rankedOrdinary.slice(limitedOrdinary.length)
        : [];
    const budgeted = normalizedSettings.pinnedBudgetMode === 'separate' ? limitedOrdinary : limited;
    const { selected: budgetSelected, omitted } = selectCandidates(budgeted, normalizedSettings.maxTokens);
    const selected = normalizedSettings.pinnedBudgetMode === 'separate'
        ? [...rankedPinned, ...budgetSelected]
        : budgetSelected;

    return {
        ...base,
        candidates,
        excludedByThreshold,
        excludedByRecordLimit,
        selected: selected.sort((left, right) => left.record.startId - right.record.startId || left.record.endId - right.record.endId),
        omittedByRetrievalBudget: omitted,
    };
}

export function finalizeRetrievalResult(result, omittedUnits = []) {
    const omittedIds = new Set((omittedUnits || [])
        .filter(unit => unit.retrieved)
        .map(unit => String(unit.id)));
    return {
        ...result,
        injected: result.selected.filter(item => !omittedIds.has(String(item.record.id))),
        omittedByInjectionBudget: result.selected.filter(item => omittedIds.has(String(item.record.id))),
    };
}

function getRecentSearchMessages(messages, count) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message && !message.is_system && String(message.mes || '').trim())
        .slice(-count);
}

function buildDocumentFrequencies(records) {
    const frequencies = new Map();
    for (const record of records) {
        const terms = new Set(getRecordTags(record).flatMap(getTagTerms).map(term => term.normalized));
        for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    }
    return frequencies;
}

function matchRecord(record, messages, documentFrequencies, recordCount, countTokens) {
    const matchedConcepts = [];
    for (const tag of getRecordTags(record)) {
        const terms = getTagTerms(tag);
        const matches = [];
        let bestWeight = 0;
        for (const term of terms) {
            const message = [...messages].reverse().find(candidate => matchesSearchTerm(candidate.text, term.normalized));
            if (!message) continue;
            const frequency = documentFrequencies.get(term.normalized) || 1;
            const rarity = 1 + Math.log2(Math.max(1, recordCount / frequency));
            const phraseBonus = term.normalized.includes(' ') ? 0.35 : 0;
            bestWeight = Math.max(bestWeight, (rarity + phraseBonus) * message.recency);
            matches.push(term.display);
        }
        if (matches.length) {
            matchedConcepts.push({
                canonical: tag.canonical,
                terms: [...new Set(matches)],
                weight: bestWeight,
            });
        }
    }
    const conceptBonus = Math.max(0, matchedConcepts.length - 1) * 1.25;
    return {
        record,
        pinned: Boolean(record.pinned),
        matchedConcepts,
        matchedTerms: [...new Set(matchedConcepts.flatMap(concept => concept.terms))],
        score: matchedConcepts.reduce((sum, concept) => sum + concept.weight, 0) + conceptBonus,
        tokenCount: countTokens(String(record.content || '')),
    };
}

function selectWithinBudget(candidates, budget) {
    const selected = [];
    const omitted = [];
    let used = 0;
    for (const candidate of candidates) {
        if (used + candidate.tokenCount > budget) {
            omitted.push(candidate);
            continue;
        }
        selected.push(candidate);
        used += candidate.tokenCount;
    }
    return { selected, omitted };
}

function getTagTerms(tag) {
    const terms = new Map();
    for (const value of [tag.canonical, ...(tag.matchTerms || [])]) {
        const display = String(value || '').trim();
        const normalized = normalizeSearchText(display);
        if (normalized && !terms.has(normalized)) terms.set(normalized, { display, normalized });
    }
    return [...terms.values()];
}

function matchesSearchTerm(text, term) {
    if (!text || !term) return false;
    if (containsCjk(term) || term.includes(' ')) return text.includes(term);
    return (` ${text} `).includes(` ${term} `);
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function containsCjk(value) {
    return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function normalizeRetrievalSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        enabled: source.enabled !== false,
        mode: ['simple', 'relevance'].includes(source.mode) ? source.mode : 'simple',
        messageCount: clampInteger(source.messageCount, 1, 100, 6),
        maxTokens: clampInteger(source.maxTokens, 100, 100000, 6000),
        relevance: Object.hasOwn(RELEVANCE_THRESHOLDS, source.relevance) ? source.relevance : 'balanced',
        messageRecency: ['balanced', 'recent'].includes(source.messageRecency) ? source.messageRecency : 'balanced',
        messageRecencyStrength: ['weak', 'medium', 'strong', 'custom'].includes(source.messageRecencyStrength)
            ? source.messageRecencyStrength
            : 'medium',
        messageRecencyOldestWeight: clampNumber(source.messageRecencyOldestWeight, 0, 10, 0.5),
        messageRecencyNewestWeight: clampNumber(source.messageRecencyNewestWeight, 0, 10, 2),
        messageRecencyCurve: ['linear', 'focused', 'strong', 'custom'].includes(source.messageRecencyCurve)
            ? source.messageRecencyCurve
            : 'linear',
        messageRecencyCurveExponent: clampNumber(source.messageRecencyCurveExponent, 0.1, 10, 2),
        pinnedBudgetMode: ['included', 'separate'].includes(source.pinnedBudgetMode)
            ? source.pinnedBudgetMode
            : 'included',
        relevanceLimitMode: ['all', 'top'].includes(source.relevanceLimitMode) ? source.relevanceLimitMode : 'all',
        relevanceMaxRecords: clampInteger(source.relevanceMaxRecords, 1, 100, 3),
    };
}

function getMessageRecencyWeight(index, count, settings) {
    const [oldestWeight, newestWeight] = getMessageRecencyRange(settings);
    if (count <= 1) return newestWeight;
    const position = index / (count - 1);
    const curvedPosition = Math.pow(position, getMessageRecencyCurveExponent(settings));
    return oldestWeight + curvedPosition * (newestWeight - oldestWeight);
}

function getMessageRecencyCurveExponent(settings) {
    if (settings.messageRecency !== 'recent') return 1;
    if (settings.messageRecencyCurve === 'focused') return 2;
    if (settings.messageRecencyCurve === 'strong') return 3;
    if (settings.messageRecencyCurve === 'custom') return settings.messageRecencyCurveExponent;
    return 1;
}

function getMessageRecencyRange(settings) {
    if (settings.messageRecency !== 'recent') return [0.75, 1];
    if (settings.messageRecencyStrength === 'weak') return [0.75, 1.5];
    if (settings.messageRecencyStrength === 'strong') return [0.25, 3];
    if (settings.messageRecencyStrength === 'custom') {
        return [settings.messageRecencyOldestWeight, settings.messageRecencyNewestWeight];
    }
    return [0.5, 2];
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function approximateTokenCount(value) {
    return Math.ceil(String(value || '').length / 4);
}
