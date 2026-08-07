export function getRecordTags(record) {
    const tags = Array.isArray(record?.searchTags)
        ? record.searchTags
        : record?.structuredSummary?.data?.tags;
    if (!Array.isArray(tags)) return [];

    return tags.map(tag => {
        if (!tag || typeof tag !== 'object') return null;
        const canonical = String(tag.canonical || '').trim();
        if (!canonical) return null;
        const matchTerms = Array.isArray(tag.matchTerms)
            ? tag.matchTerms.map(term => String(term || '').trim()).filter(Boolean)
            : [];
        return { canonical, matchTerms };
    }).filter(Boolean);
}
