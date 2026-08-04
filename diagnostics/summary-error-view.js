import {
    clearExtensionErrorLogs,
    markExtensionErrorLogsRead,
    removeExtensionErrorLog,
    subscribeExtensionErrorLogs,
} from './summary-error-state.js';
import { escapeHtml } from '../core/utils.js';

export function bindSummaryErrorView(root) {
    const toggle = root.querySelector('#stsm-error-toggle');
    const popover = root.querySelector('#stsm-error-popover');
    const close = root.querySelector('#stsm-close-errors');
    const clear = root.querySelector('#stsm-clear-errors');
    const handleRootClick = event => {
        if (event.target.closest('.stsm-error-popover-wrap')) return;
        closeErrorPopover(root);
    };
    const unsubscribe = subscribeExtensionErrorLogs(logs => renderExtensionErrorLogs(root, logs));

    toggle.addEventListener('click', event => {
        event.stopPropagation();
        const willOpen = popover.hidden;
        popover.hidden = !willOpen;
        toggle.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) markExtensionErrorLogsRead();
    });
    close.addEventListener('click', event => {
        event.stopPropagation();
        closeErrorPopover(root);
    });
    clear.addEventListener('click', event => {
        event.stopPropagation();
        clearExtensionErrorLogs();
        closeErrorPopover(root);
    });
    root.addEventListener('click', handleRootClick);

    return () => {
        unsubscribe();
        root.removeEventListener('click', handleRootClick);
    };
}

function renderExtensionErrorLogs(root, logs) {
    const toggle = root.querySelector('#stsm-error-toggle');
    const clear = root.querySelector('#stsm-clear-errors');
    const list = root.querySelector('#stsm-error-list');
    const unreadCount = logs.filter(log => !log.read).length;

    toggle.classList.toggle('stsm-error-unread', unreadCount > 0);
    toggle.title = unreadCount > 0 ? `확인하지 않은 오류 ${unreadCount}개` : '확장 오류 로그';
    toggle.setAttribute('aria-label', toggle.title);
    clear.hidden = !logs.length;

    if (!logs.length) {
        list.innerHTML = '<div class="stsm-empty">기록된 확장 오류가 없습니다.</div>';
        return;
    }

    list.innerHTML = logs.map(renderErrorLog).join('');
    list.querySelectorAll('.stsm-delete-error').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            removeExtensionErrorLog(button.closest('.stsm-error-item')?.dataset.errorId);
        });
    });
}

function renderErrorLog(log) {
    const batch = log.batch;
    const failedRange = batch?.failedChunk ? formatRange(batch.failedChunk) : '';
    const requestedRange = batch?.requestedRange ? formatRange(batch.requestedRange) : '';
    const completed = batch?.completedChunks?.length ? formatRanges(batch.completedChunks) : '없음';
    const unattempted = batch?.unattemptedChunks?.length ? formatRanges(batch.unattemptedChunks) : '없음';
    const contextRange = log.context?.range ? formatRange(log.context.range) : '';
    const title = failedRange ? `${failedRange} 요약 실패` : log.title;
    const description = log.message && log.message !== log.reason && !batch
        ? `<div class="stsm-error-description">${escapeHtml(log.message)}</div>`
        : '';
    return `
        <article class="stsm-error-item" data-error-id="${escapeHtml(log.id)}">
            <div class="stsm-error-copy">
                <div class="stsm-error-message">${escapeHtml(title)}${log.repeatCount > 1 ? ` <span class="stsm-error-repeat">×${log.repeatCount}</span>` : ''}</div>
                <div class="stsm-error-meta">${escapeHtml(new Date(log.occurredAt).toLocaleString())}${contextRange ? ` · ${escapeHtml(contextRange)}` : ''}${requestedRange ? ` · 전체 요청 ${escapeHtml(requestedRange)}` : ''}</div>
                ${batch ? `
                    <div class="stsm-error-progress">
                        <span><strong>완료:</strong> ${escapeHtml(completed)}</span>
                        <span><strong>미시도:</strong> ${escapeHtml(unattempted)}</span>
                    </div>
                ` : ''}
                ${description}
                <div class="stsm-error-reason">${escapeHtml(log.reason || log.message)}</div>
            </div>
            <button class="stsm-delete-error menu_button menu_button_icon interactable" type="button" title="오류 로그 삭제" aria-label="오류 로그 삭제">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
        </article>
    `;
}

function closeErrorPopover(root) {
    root.querySelector('#stsm-error-popover').hidden = true;
    root.querySelector('#stsm-error-toggle').setAttribute('aria-expanded', 'false');
}

function formatRanges(ranges) {
    return ranges.map(formatRange).join(', ');
}

function formatRange(range) {
    return `#${range.startId} ~ #${range.endId}`;
}
