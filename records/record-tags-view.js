import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { getSummaryRecord, updateSummaryRecordTags } from '../summary/summary-store.js';
import { getRecordTags } from './record-tags.js';

export function renderRecordTagSummary(record, { showEmpty = false, prominent = false } = {}) {
    const tags = getRecordTags(record);
    if (!tags.length && !showEmpty) return '';

    return `
        <div class="stsm-record-tags${prominent ? ' stsm-record-tags-prominent' : ''}" aria-label="검색 태그">
            <span class="stsm-record-tags-label"><i class="fa-solid fa-tags" aria-hidden="true"></i> 검색 태그</span>
            <div class="stsm-record-tag-chips">
                ${tags.length
        ? tags.map(tag => `<span class="stsm-record-tag-chip" title="${escapeAttribute(tag.matchTerms.join(', ') || '추가 일치 검색어 없음')}">${escapeHtml(tag.canonical)}</span>`).join('')
        : '<span class="stsm-record-tags-empty">검색 태그 없음</span>'}
            </div>
        </div>
    `;
}

export async function openRecordTagEditor(recordId) {
    const record = getSummaryRecord(recordId);
    if (!record?.compressedBy) throw new Error('장기기억 레코드의 검색 태그만 직접 편집할 수 있습니다.');

    const form = document.createElement('div');
    form.className = 'stsm-record-tag-editor';
    form.innerHTML = `
        <div class="stsm-section-title">장기기억 검색 태그</div>
        <p class="stsm-record-tag-editor-description">대표 태그와 해당 기억을 찾을 때 사용할 일치 검색어를 관리합니다.</p>
        <div class="stsm-record-tag-editor-list"></div>
        <button class="stsm-record-tag-add menu_button interactable" type="button">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            <span>태그 추가</span>
        </button>
    `;
    const list = form.querySelector('.stsm-record-tag-editor-list');
    const addRow = (tag = { canonical: '', matchTerms: [] }) => {
        list.insertAdjacentHTML('beforeend', renderTagEditorRow(tag));
    };
    const tags = getRecordTags(record);
    (tags.length ? tags : [{ canonical: '', matchTerms: [] }]).forEach(addRow);
    form.querySelector('.stsm-record-tag-add').addEventListener('click', () => {
        addRow();
        list.lastElementChild.querySelector('[data-tag-canonical]').focus();
    });
    list.addEventListener('click', event => {
        const remove = event.target.closest('.stsm-record-tag-remove');
        if (remove) remove.closest('.stsm-record-tag-editor-row').remove();
    });

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '저장',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== 1) return false;

    const updated = await updateSummaryRecordTags(recordId, readTagEditorRows(list));
    if (!updated) throw new Error('검색 태그를 수정할 장기기억 레코드를 찾지 못했습니다.');
    toastr.success('장기기억 검색 태그를 저장했습니다.');
    return true;
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

function renderTagEditorRow(tag) {
    return `
        <div class="stsm-record-tag-editor-row">
            <label class="stsm-field">
                <span>대표 태그</span>
                <input class="text_pole" type="text" data-tag-canonical value="${escapeAttribute(tag.canonical)}" placeholder="예: academy garden">
            </label>
            <label class="stsm-field">
                <span>일치 검색어</span>
                <input class="text_pole" type="text" data-tag-terms value="${escapeAttribute(tag.matchTerms.join(', '))}" placeholder="쉼표로 구분">
            </label>
            <button class="stsm-record-tag-remove menu_button menu_button_icon interactable" type="button" title="태그 삭제" aria-label="태그 삭제">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
        </div>
    `;
}

function readTagEditorRows(list) {
    return [...list.querySelectorAll('.stsm-record-tag-editor-row')].map(row => ({
        canonical: row.querySelector('[data-tag-canonical]').value,
        matchTerms: row.querySelector('[data-tag-terms]').value.split(',').map(term => term.trim()).filter(Boolean),
    })).filter(tag => tag.canonical.trim());
}

function escapeAttribute(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
