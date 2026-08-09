const RECENCY_TIE_BREAK_MAX = 0.001;

export function evaluateWorldRetrieval({ entries, messages, mode = 'lorebook', messageCount = 6 }) {
    const sourceEntries = Array.isArray(entries) ? entries : [];
    const contextText = getRecentSearchText(messages, messageCount);
    const positions = sourceEntries.map(getLastUpdatedPosition);
    const oldest = positions.length ? Math.min(...positions) : 0;
    const newest = positions.length ? Math.max(...positions) : 0;
    const span = newest - oldest;

    return sourceEntries.map(entry => {
        const keys = normalizeKeys(entry.keys);
        const matchedKeys = contextText
            ? keys.filter(key => matchesSearchTerm(contextText, normalizeSearchText(key)))
            : [];
        const recency = span > 0 ? (getLastUpdatedPosition(entry) - oldest) / span : 0;
        return {
            entry,
            keys,
            matchedKeys,
            eligible: mode === 'priority' || matchedKeys.length > 0,
            priority: matchedKeys.length + (recency * RECENCY_TIE_BREAK_MAX),
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

function normalizeKeys(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(key => String(key || '').trim()).filter(key => {
        const identity = key.normalize('NFKC').toLocaleLowerCase();
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

function containsCjk(value) {
    return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function getLastUpdatedPosition(entry) {
    return Number(entry?.lastUpdatedRange?.endId ?? entry?.firstSeenRange?.endId) || 0;
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
