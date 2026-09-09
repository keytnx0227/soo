import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';

const MEMORY_CATEGORIES = Object.freeze([
    ['people', '인물 도감'],
    ['items', '아이템 도감'],
    ['commitments', '서약 장부'],
    ['events', '주요 사건'],
    ['world', '세계 설정'],
]);

export async function showSummaryRegenerationPreview(draft) {
    const previousRecord = draft.previousRecord;
    const previousBaseRecord = { ...previousRecord, atlasReviewOverrides: {} };
    const nextBaseRecord = {
        ...previousRecord,
        legacyContent: null,
        structuredSummary: draft.structuredSummary,
        atlasReviewOverrides: {},
    };
    const changedCategories = getChangedMemoryCategories(previousRecord, draft.structuredSummary);
    const overriddenCategories = MEMORY_CATEGORIES
        .filter(([category]) => previousRecord.atlasReviewOverrides?.[category])
        .map(([, label]) => label);
    const content = document.createElement('div');
    content.className = 'stsm-regeneration-preview-popup';
    content.innerHTML = `
        <header class="stsm-regeneration-preview-header">
            <strong>요약 재생성 결과 미리보기</strong>
            <span>#${previousRecord.startId} ~ #${previousRecord.endId}</span>
        </header>
        <section class="stsm-regeneration-preview-section">
            <div class="stsm-regeneration-preview-section-title">
                <strong>요약 본문 비교</strong>
                <span>${previousRecord.content === draft.content ? '본문 변경 없음' : '본문 변경됨'}</span>
            </div>
            <div class="stsm-regeneration-preview-columns">
                ${renderTextPanel('기존 요약', previousRecord.content)}
                ${renderTextPanel('재생성 초안', draft.content)}
            </div>
        </section>
        <section class="stsm-regeneration-preview-section">
            <div class="stsm-regeneration-preview-section-title">
                <strong>도감 변경안 비교</strong>
                <span>${changedCategories.length ? `${changedCategories.join(', ')} 변경됨` : '도감 변경 없음'}</span>
            </div>
            ${overriddenCategories.length ? `
                <p class="stsm-regeneration-preview-notice">
                    ${escapeHtml(overriddenCategories.join(', '))}에는 재검토판이 적용되어 있어요. 새 기본 변경안은 저장되지만 현재 최종 도감 계산에는 재검토판이 계속 우선합니다.
                </p>
            ` : ''}
            <div class="stsm-regeneration-preview-columns stsm-regeneration-preview-memory-columns">
                ${renderMemoryPanel('기존 도감 변경안', previousBaseRecord)}
                ${renderMemoryPanel('재생성된 도감 변경안', nextBaseRecord)}
            </div>
        </section>
    `;

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '적용',
        cancelButton: '폐기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function renderTextPanel(title, value) {
    return `<article class="stsm-regeneration-preview-panel">
        <strong>${title}</strong>
        <pre>${escapeHtml(String(value || ''))}</pre>
    </article>`;
}

function renderMemoryPanel(title, record) {
    return `<article class="stsm-regeneration-preview-panel">
        <strong>${title}</strong>
        <div class="stsm-regeneration-preview-memory">
            ${renderRecordMemoryUpdateDetails(record) || '<div class="stsm-empty">도감 변경안이 없습니다.</div>'}
        </div>
    </article>`;
}

function getChangedMemoryCategories(previousRecord, nextStructuredSummary) {
    const previous = previousRecord.structuredSummary?.data?.memoryUpdates || {};
    const next = nextStructuredSummary?.data?.memoryUpdates || {};
    return MEMORY_CATEGORIES
        .filter(([category]) => JSON.stringify(previous[category] || emptyUpdates())
            !== JSON.stringify(next[category] || emptyUpdates()))
        .map(([, label]) => label);
}

function emptyUpdates() {
    return { created: [], updated: [] };
}
