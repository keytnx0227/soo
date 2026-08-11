import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';

export async function showCompressionContentMigrationReport({ migrated, failed }) {
    if (!migrated.length && !failed.length) return;
    const content = document.createElement('div');
    content.className = 'stsm-migration-report';
    content.innerHTML = `
        <header class="stsm-migration-report-header">
            <strong>편집된 압축 요약 동기화 결과</strong>
            <span>성공 ${migrated.length}개 · 제외 ${failed.length}개</span>
        </header>
        <div class="stsm-migration-report-list">
            ${migrated.map(renderSuccess).join('')}
            ${failed.map(renderFailure).join('')}
        </div>
        <p class="stsm-migration-report-note">성공한 레코드는 기존 본문과 재렌더링 결과가 일치함을 확인했습니다. 제외된 레코드는 원문과 구조화 데이터를 모두 유지하며 기존 문자열 편집 방식으로 열립니다.</p>
    `;
    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '확인',
        wide: true,
        allowVerticalScrolling: true,
    }).show();
}

function renderSuccess(item) {
    const detail = item.changedFields.length ? item.changedFields.join(', ') : '구조화 데이터와 동일 · 편집 상태만 정리';
    return `
        <article class="stsm-migration-report-item stsm-migration-report-success">
            <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
            <div><strong>${escapeHtml(item.range)}</strong><span>${escapeHtml(detail)}</span></div>
        </article>
    `;
}

function renderFailure(item) {
    return `
        <article class="stsm-migration-report-item stsm-migration-report-failure">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            <div><strong>${escapeHtml(item.range)}</strong><span>${escapeHtml(item.reason)}</span></div>
        </article>
    `;
}
