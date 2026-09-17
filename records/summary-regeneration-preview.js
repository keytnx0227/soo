import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';
import { getRegenerationReferences, regenerationReferenceSignature, resolveRegeneration, validateResolvedRegeneration } from './regeneration-review.js';

const MEMORY_CATEGORIES = Object.freeze([
    ['people', '인물 도감'],
    ['items', '아이템 도감'],
    ['commitments', '서약 장부'],
    ['events', '주요 사건'],
    ['world', '세계 설정'],
]);

export async function showSummaryRegenerationPreview(draft, onApply) {
    const requirements = getRegenerationReferences(draft);
    const baseline = regenerationReferenceSignature(draft);
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

    const choices = {};
    const connections = document.createElement('section');
    connections.className = 'stsm-regeneration-connections';
    if (requirements.length) {
        const heading = document.createElement('strong');
        heading.textContent = `도감 연결 확인 ${requirements.length}건`;
        connections.append(heading);
    }
    for (const requirement of requirements) {
        const { category, id, proposal, references } = requirement;
        const row = document.createElement('label');
        row.className = 'stsm-regeneration-connection';
        const title = document.createElement('strong');
        title.textContent = `${MEMORY_CATEGORIES.find(([key]) => key === category)[1]} · ${entryLabel(proposal)}`;
        const detail = document.createElement('span');
        detail.textContent = `참조: ${references.join(', ')}`;
        const select = document.createElement('select');
        select.setAttribute('aria-label', `${entryLabel(proposal)} 연결 대상`);
        select.add(new Option('연결 대상을 선택해주세요', ''));
        for (const entry of draft.structuredSummary.data.memoryUpdates[category]?.created || []) {
            select.add(new Option(`새 항목: ${entryLabel(entry)}`, entry.sourceId));
        }
        select.add(new Option('기존 생성 항목 그대로 유지', 'keep'));
        select.add(new Option('연결하지 않기 (참조 끊김 유지 · 비권장)', 'disconnect'));
        select.addEventListener('change', () => { choices[`${category}:${id}`] = select.value; });
        row.append(title, detail, select);
        connections.append(row);
    }
    content.prepend(connections);

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '적용',
        cancelButton: '나중에',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: async popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                if (regenerationReferenceSignature(draft) !== baseline) {
                    throw new Error('검토 중 기록이나 도감이 변경되었습니다. 창을 닫고 다시 검토해주세요.');
                }
                const resolved = resolveRegeneration(draft, requirements, choices);
                validateResolvedRegeneration(resolved, requirements, choices);
                await onApply?.(resolved);
                return true;
            } catch (error) {
                toastr.error(error.message);
                return false;
            }
        },
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function entryLabel(entry) {
    return entry.name || entry.title || entry.keys?.join(', ') || entry.sourceId || '이름 없음';
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
