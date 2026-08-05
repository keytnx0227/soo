import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { openSummaryRecordDetail } from './record-detail-view.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { getSummaryRecordSourceStatuses, SOURCE_STATES } from '../summary/source-tracking.js';
import { getSummaryRecords } from '../summary/summary-store.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { escapeHtml } from '../core/utils.js';
import { renderRecordTagSummary } from './record-tags-view.js';
import { renderRecordMemoryUpdateBadge } from './record-memory-updates-view.js';
import { getExtensionState, subscribeExtensionState } from '../core/extension-state.js';
import { renderExtensionControls } from '../ui/extension-status-view.js';

export function bindRecordsView(root, bindRecordEvents) {
    root.querySelector('#stsm-preview-summary-context').addEventListener('click', async () => {
        try {
            await showSummaryContextPreview();
        } catch (error) {
            logRecordViewError(error, '요약 조립 결과 미리보기 실패', '요약 조립 결과를 열지 못했습니다.');
        }
    });
    root.querySelector('#stsm-record-sort').addEventListener('change', () => {
        renderSummaryRecords(root, bindRecordEvents);
    });
    root.querySelector('#stsm-records-fullscreen').addEventListener('click', () => {
        showRecordsFullscreen(root.querySelector('#stsm-record-sort').value, bindRecordEvents).catch(error => {
            logRecordViewError(error, '요약 기록 전체 화면 열기 실패', '요약 기록 전체 화면을 열지 못했습니다.');
        });
    });
    renderSummaryRecords(root, bindRecordEvents);
}

export function renderSummaryRecords(root, bindRecordEvents) {
    const list = root.querySelector('#stsm-record-list');
    const direction = root.querySelector('#stsm-record-sort').value;
    renderRecordList(list, direction, bindRecordEvents);
    root.dispatchEvent(new CustomEvent('stsm:records-rendered'));
}

function renderRecordList(list, direction, bindRecordEvents) {
    const records = [...getSummaryRecords()].sort((left, right) => {
        const difference = left.startId - right.startId || left.endId - right.endId;
        return direction === 'id-asc' ? difference : -difference;
    });
    const sourceStatuses = getSummaryRecordSourceStatuses(records);

    list.innerHTML = records.length
        ? records.map(record => renderSummaryRecord(record, sourceStatuses.get(record.id))).join('')
        : '<div class="stsm-empty">저장된 요약 기록이 없습니다.</div>';
    list.querySelectorAll('.stsm-record').forEach(recordElement => {
        recordElement.querySelector('.stsm-record-detail').addEventListener('click', () => {
            openSummaryRecordDetail(recordElement.dataset.recordId).catch(error => {
                logRecordViewError(error, '요약 레코드 자세히 보기 실패', '요약 레코드의 상세 내용을 열지 못했습니다.', {
                    range: getElementRecordRange(recordElement),
                });
            });
        });
        bindRecordEvents(recordElement);
    });
}

async function showRecordsFullscreen(initialDirection, bindRecordEvents) {
    const content = document.createElement('div');
    content.className = 'stsm-records-fullscreen';
    content.innerHTML = `
        <div class="stsm-records-fullscreen-toolbar">
            <strong>요약 기록</strong>
            <label class="stsm-field stsm-sort-field">
                <select class="stsm-records-fullscreen-sort text_pole" aria-label="요약 기록 정렬">
                    <option value="id-desc">ID 높은 순</option>
                    <option value="id-asc">ID 낮은 순</option>
                </select>
            </label>
        </div>
        <div class="stsm-record-list"></div>
    `;

    const sort = content.querySelector('.stsm-records-fullscreen-sort');
    const list = content.querySelector('.stsm-record-list');
    sort.value = initialDirection === 'id-asc' ? 'id-asc' : 'id-desc';
    const render = () => {
        renderRecordList(list, sort.value, bindRecordEvents);
        renderExtensionControls(content, getExtensionState());
    };
    const handleRecordsChanged = () => render();
    const unsubscribeExtensionState = subscribeExtensionState(state => renderExtensionControls(content, state));
    sort.addEventListener('change', render);
    window.addEventListener('stsm:records-changed', handleRecordsChanged);
    render();

    try {
        await new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            wide: true,
            large: true,
            allowVerticalScrolling: false,
        }).show();
    } finally {
        unsubscribeExtensionState();
        window.removeEventListener('stsm:records-changed', handleRecordsChanged);
    }
}

function logRecordViewError(error, title, message, context = null) {
    console.error(`[Chat Summarizer] ${title}:`, error);
    addExtensionErrorLog(error, {
        operation: 'record-inspection',
        title,
        message,
        context,
    });
    toastr.error(message);
}

function getElementRecordRange(recordElement) {
    const record = getSummaryRecords().find(item => item.id === recordElement.dataset.recordId);
    return record ? { startId: record.startId, endId: record.endId } : null;
}

export function refreshSummaryRecordSourceStates(root) {
    const records = getSummaryRecords();
    const sourceStatuses = getSummaryRecordSourceStatuses(records);
    root.querySelectorAll('.stsm-record').forEach(recordElement => {
        const slot = recordElement.querySelector('.stsm-record-source-state-slot');
        if (!slot) return;
        slot.innerHTML = renderSourceState(sourceStatuses.get(recordElement.dataset.recordId));
    });
}

async function showSummaryContextPreview() {
    const details = buildSummaryContextDetails();
    const content = document.createElement('div');
    content.className = 'stsm-prompt-preview';

    if (!details.enabled || !details.sourceUnitCount) {
        const message = details.enabled
            ? '활성화된 블록에 전송할 요약 또는 도감 항목이 없습니다.'
            : '요약 확장이 꺼져 있어 매크로 결과가 비어 있습니다.';
        content.innerHTML = `<div class="stsm-section-title">{{sumiSummary}} 미리보기</div><div class="stsm-empty">${message}</div>`;
    } else {
        const preview = details.content
            ? '<textarea class="text_pole monospace" rows="24" readonly></textarea>'
            : '<div class="stsm-empty">토큰 제한 또는 레코드 포맷 설정으로 실제 전송 결과가 비어 있습니다.</div>';
        content.innerHTML = `
            <label class="stsm-field">
                <span class="stsm-section-title">{{sumiSummary}} 미리보기</span>
                ${renderContextTokenStatus(details)}
                ${preview}
            </label>
        `;
        if (details.content) content.querySelector('textarea').value = details.content;
    }

    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

function renderContextTokenStatus(details) {
    const budget = Number.isFinite(details.budget) ? details.budget.toLocaleString() : '제한 없음';
    const tokenSummary = `${details.outputTokenCount.toLocaleString()} / ${budget} tokens`;
    if (!details.truncated) {
        return `
            <div class="stsm-context-token-status">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>${tokenSummary} · 잘림 없음</span>
            </div>
        `;
    }

    const omitted = details.blocks
        .filter(block => block.omittedItems.length)
        .map(block => `<div><strong>${escapeHtml(block.name)}:</strong> ${block.omittedItems.map(item => escapeHtml(item.label)).join(', ')} 제외</div>`)
        .join('');
    return `
        <div class="stsm-context-token-status stsm-context-token-status-warning">
            <div class="stsm-context-token-heading">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <strong>토큰 제한으로 앞쪽 항목부터 제외했어요.</strong>
            </div>
            <div>원본 ${details.originalTokenCount.toLocaleString()} tokens → 전송 ${tokenSummary}</div>
            ${omitted}
        </div>
    `;
}

function renderSummaryRecord(summary, sourceStatus) {
    const hasTranslation = Boolean(summary.translation?.content);
    const tokenCount = getTokenCount(String(summary.content || ''));
    return `
        <article class="stsm-record" data-record-id="${escapeHtml(summary.id)}">
            <header class="stsm-record-header">
                <div class="stsm-record-range">
                    <strong>#${summary.startId} ~ #${summary.endId}</strong>
                    <span>${tokenCount.toLocaleString()} tokens</span>
                    ${renderRecordMemoryUpdateBadge(summary)}
                    <span class="stsm-record-source-state-slot">${renderSourceState(sourceStatus)}</span>
                </div>
                <div class="stsm-record-actions">
                    ${renderIconButton('detail', 'fa-magnifying-glass', '자세히 보기')}
                    ${renderIconButton('copy', 'fa-copy', '복사')}
                    ${renderIconButton('edit', 'fa-pen', '수정')}
                    ${renderIconButton('translate', 'fa-language', hasTranslation ? '번역 재생성' : '번역')}
                    ${hasTranslation ? renderIconButton('translation-toggle', 'fa-right-left', '원문/번역 전환', true) : ''}
                    ${renderIconButton('chat', 'fa-comments', '요약 수정 대화')}
                    ${renderIconButton('reroll', 'fa-rotate-right', '재생성')}
                    ${renderIconButton('delete', 'fa-trash', '삭제')}
                </div>
            </header>
            <div class="stsm-record-content stsm-record-original"${hasTranslation ? ' hidden' : ''}>${escapeHtml(summary.content)}</div>
            <div class="stsm-record-content stsm-record-translation"${hasTranslation ? '' : ' hidden'}>${hasTranslation ? escapeHtml(summary.translation.content) : ''}</div>
            ${renderRecordTagSummary(summary)}
            <div class="stsm-record-edit-actions" hidden>
                <button class="stsm-record-save menu_button interactable" type="button">수정</button>
                <button class="stsm-record-cancel menu_button interactable" type="button">취소</button>
            </div>
        </article>
    `;
}

function renderSourceState(status) {
    if (!status || status.state === SOURCE_STATES.CURRENT) return '';
    if (status.state === SOURCE_STATES.MOVED) {
        return `<span class="stsm-record-source-state stsm-record-source-moved" title="동일한 원본 메시지가 현재 #${status.startId} ~ #${status.endId}에 있습니다.">ID 이동</span>`;
    }
    if (status.state === SOURCE_STATES.STALE) {
        return '<span class="stsm-record-source-state stsm-record-source-stale" title="요약 당시의 원본 메시지를 현재 채팅에서 찾지 못했습니다.">원문 변경됨</span>';
    }
    return '<span class="stsm-record-source-state stsm-record-source-untracked" title="fingerprint 기능 추가 전에 만들어진 요약 기록입니다.">추적 전 기록</span>';
}

function renderIconButton(action, icon, title, pressed = null) {
    const pressedAttribute = pressed === null ? '' : ` aria-pressed="${String(pressed)}"`;
    return `
        <button class="stsm-record-${action} menu_button menu_button_icon interactable" type="button" title="${title}" aria-label="${title}"${pressedAttribute}>
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}
