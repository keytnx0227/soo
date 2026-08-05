import { escapeHtml } from '../core/utils.js';

export function renderRecordTagSummary(record) {
    const tags = getRecordTags(record);
    if (!tags.length) return '';

    return `
        <div class="stsm-record-tags" aria-label="검색 태그">
            <span class="stsm-record-tags-label"><i class="fa-solid fa-tags" aria-hidden="true"></i> 검색 태그</span>
            <div class="stsm-record-tag-chips">
                ${tags.map(tag => `<span class="stsm-record-tag-chip">${escapeHtml(tag.canonical)}</span>`).join('')}
            </div>
        </div>
    `;
}

export function renderRecordTagDetails(record) {
    const tags = getRecordTags(record);
    if (!tags.length) return '';

    return `
        <section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">검색 태그</div>
            <div class="stsm-record-tag-details">
                ${tags.map(tag => `
                    <div class="stsm-record-tag-detail">
                        <strong>${escapeHtml(tag.canonical)}</strong>
                        ${tag.matchTerms.length
                            ? `<div>${tag.matchTerms.map(term => `<span>${escapeHtml(term)}</span>`).join('')}</div>`
                            : '<small>일치 검색어 없음</small>'}
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function getRecordTags(record) {
    const tags = record?.structuredSummary?.data?.tags;
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
