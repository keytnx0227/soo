import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { buildSummaryContext } from './summary-context.js';
import { getSummaryRecords } from './summary-store.js';
import { escapeHtml } from './utils.js';

export function bindRecordsView(root, bindRecordEvents) {
    root.querySelector('#stsm-preview-summary-context').addEventListener('click', showSummaryContextPreview);
    root.querySelector('#stsm-record-sort').addEventListener('change', () => {
        renderSummaryRecords(root, bindRecordEvents);
    });
    renderSummaryRecords(root, bindRecordEvents);
}

export function renderSummaryRecords(root, bindRecordEvents) {
    const list = root.querySelector('#stsm-record-list');
    const direction = root.querySelector('#stsm-record-sort').value;
    const records = [...getSummaryRecords()].sort((left, right) => {
        const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        return direction === 'oldest' ? difference : -difference;
    });

    list.innerHTML = records.length
        ? records.map(renderSummaryRecord).join('')
        : '<div class="stsm-empty">저장된 요약 기록이 없습니다.</div>';
    list.querySelectorAll('.stsm-record').forEach(bindRecordEvents);
}

async function showSummaryContextPreview() {
    const value = buildSummaryContext();
    const content = document.createElement('div');
    content.className = 'stsm-prompt-preview';

    if (!value) {
        content.innerHTML = '<div class="stsm-section-title">{{sumiSummary}} 미리보기</div><div class="stsm-empty">저장된 요약 기록이 없어 매크로 결과가 비어 있습니다.</div>';
    } else {
        content.innerHTML = `
            <label class="stsm-field">
                <span class="stsm-section-title">{{sumiSummary}} 미리보기</span>
                <textarea class="text_pole monospace" rows="24" readonly></textarea>
            </label>
        `;
        content.querySelector('textarea').value = value;
    }

    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

function renderSummaryRecord(summary) {
    const hasTranslation = Boolean(summary.translation?.content);
    return `
        <article class="stsm-record" data-record-id="${escapeHtml(summary.id)}">
            <header class="stsm-record-header">
                <strong>#${summary.startId} ~ #${summary.endId}</strong>
                <div class="stsm-record-actions">
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
            <div class="stsm-record-edit-actions" hidden>
                <button class="stsm-record-save menu_button interactable" type="button">수정</button>
                <button class="stsm-record-cancel menu_button interactable" type="button">취소</button>
            </div>
        </article>
    `;
}

function renderIconButton(action, icon, title, pressed = null) {
    const pressedAttribute = pressed === null ? '' : ` aria-pressed="${String(pressed)}"`;
    return `
        <button class="stsm-record-${action} menu_button menu_button_icon interactable" type="button" title="${title}" aria-label="${title}"${pressedAttribute}>
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}
