export function normalizeFeelings(values) {
    const source = Array.isArray(values) ? values : [];
    const result = [];
    const seen = new Set();
    for (const value of source) {
        const feeling = normalizeFeeling(value);
        if (!feeling) continue;
        const identity = feeling.text.normalize('NFKC').toLocaleLowerCase();
        if (seen.has(identity)) continue;
        seen.add(identity);
        result.push(feeling);
    }
    return result;
}

export function normalizeFeeling(value) {
    if (typeof value === 'string') {
        const text = value.trim();
        return text ? { text, weight: null } : null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = String(value.text || '').trim();
    if (!text) return null;
    return {
        text,
        weight: normalizeEmotionalWeight(value.weight ?? value.emotionalWeight),
    };
}

export function normalizeEmotionalWeight(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(Math.max(0, numeric) * 10) / 10;
}

export function formatFeeling(value) {
    const feeling = normalizeFeeling(value);
    if (!feeling) return '';
    return feeling.weight === null ? feeling.text : `${feeling.text} (${formatWeight(feeling.weight)})`;
}

export function formatFeelings(values) {
    return normalizeFeelings(values).map(formatFeeling).filter(Boolean);
}

function formatWeight(value) {
    return Number(value).toFixed(1);
}
