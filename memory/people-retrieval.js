const PINNED_PRIORITY = 1_000_000;
const RECENCY_TIE_BREAK_MAX = 0.001;

export function evaluatePeopleRetrieval({ people, messages, metadata, messageCount = 6 }) {
    const sourcePeople = Array.isArray(people) ? people : [];
    const contextText = getRecentSearchText(messages, messageCount);
    const positions = sourcePeople.map(getLastUpdatedPosition);
    const oldest = positions.length ? Math.min(...positions) : 0;
    const newest = positions.length ? Math.max(...positions) : 0;
    const span = newest - oldest;

    return sourcePeople.map(person => {
        const preference = metadata?.[String(person.id)] || { keywords: [], pinned: false };
        const keywords = normalizeKeywords(preference.keywords);
        const matchedKeywords = preference.pinned || !contextText
            ? []
            : keywords.filter(keyword => matchesSearchTerm(contextText, normalizeSearchText(keyword)));
        const recency = span > 0 ? (getLastUpdatedPosition(person) - oldest) / span : 0;
        const score = preference.pinned ? PINNED_PRIORITY : matchedKeywords.length;
        return {
            person,
            pinned: Boolean(preference.pinned),
            keywords,
            matchedKeywords,
            score,
            priority: score + (recency * RECENCY_TIE_BREAK_MAX),
            lastUpdatedId: getLastUpdatedPosition(person),
        };
    });
}

function getRecentSearchText(messages, count) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message && !message.is_system && String(message.mes || '').trim())
        .slice(-clampInteger(count, 1, 100, 6))
        .map(message => message.mes)
        .join('\n')
        .normalize('NFKC')
        .toLocaleLowerCase();
}

function matchesSearchTerm(text, term) {
    if (!text || !term) return false;
    if (containsCjk(term) || term.includes(' ')) return normalizeSearchText(text).includes(term);
    return (` ${normalizeSearchText(text)} `).includes(` ${term} `);
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeKeywords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(keyword => String(keyword || '').trim()).filter(keyword => {
        const identity = keyword.normalize('NFKC').toLocaleLowerCase();
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

function containsCjk(value) {
    return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function getLastUpdatedPosition(person) {
    return Number(person?.lastUpdatedRange?.endId ?? person?.firstSeenRange?.endId) || 0;
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
