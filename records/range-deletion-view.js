import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import {
    deleteSummaryRecords,
    getSummaryRecord,
    getSummaryRecordDeletionPlan,
    getSummaryRecordIndex,
} from '../summary/summary-store.js';
import { escapeHtml } from '../core/utils.js';

export function bindRangeDeletion(root, { onApplied } = {}) {
    root.querySelector('#stsm-delete-record-range')?.addEventListener('click', async () => {
        try {
            await openRangeDeletionPopup(root, onApplied);
        } catch (error) {
            logRangeDeletionError(error, '범위 삭제 화면 열기 실패', '요약 기록 범위 삭제 화면을 열지 못했습니다.');
        }
    });
}

async function openRangeDeletionPopup(root, onApplied) {
    const memoryView = root.dataset.recordMemoryView === 'long-term' ? 'long-term' : 'active';
    const candidates = getSummaryRecordIndex()
        .filter(record => memoryView === 'long-term' ? Boolean(record.compressedBy) : !record.compressedBy)
        .sort(compareRecords);
    if (!candidates.length) {
        toastr.info(memoryView === 'long-term' ? '삭제할 장기기억 레코드가 없습니다.' : '삭제할 상시기억 레코드가 없습니다.');
        return;
    }

    const content = document.createElement('div');
    content.className = 'stsm-range-deletion-popup';
    content.innerHTML = `
        <strong class="stsm-section-title">${memoryView === 'long-term' ? '장기기억' : '상시기억'} 레코드 범위 삭제</strong>
        <div class="stsm-grid-two">
            <label class="stsm-field">
                <span>시작 레코드</span>
                <select class="stsm-range-deletion-start text_pole">
                    <option value="">선택해주세요</option>
                    ${candidates.map(renderRecordOption).join('')}
                </select>
            </label>
            <label class="stsm-field">
                <span>끝 레코드</span>
                <select class="stsm-range-deletion-end text_pole">
                    <option value="">선택해주세요</option>
                    ${candidates.map(renderRecordOption).join('')}
                </select>
            </label>
        </div>
        <div class="stsm-range-deletion-selection">시작 레코드와 끝 레코드를 선택해주세요.</div>
        <p class="stsm-range-deletion-help">두 레코드를 포함해 ID가 낮은 순으로 그 사이에 있는 현재 탭의 레코드를 선택합니다.</p>
        <details class="stsm-range-deletion-inline-preview">
            <summary>삭제 범위 미리보기</summary>
            <div class="stsm-range-deletion-inline-content">
                <div class="stsm-empty">시작 레코드와 끝 레코드를 선택해주세요.</div>
            </div>
        </details>
        <div class="stsm-range-deletion-actions">
            <button class="stsm-range-deletion-preview-button menu_button interactable" type="button" disabled>
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                <span>삭제 대상 확인</span>
            </button>
        </div>
    `;
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        allowVerticalScrolling: true,
    });
    const startSelect = content.querySelector('.stsm-range-deletion-start');
    const endSelect = content.querySelector('.stsm-range-deletion-end');
    const selection = content.querySelector('.stsm-range-deletion-selection');
    const inlinePreviewDetails = content.querySelector('.stsm-range-deletion-inline-preview');
    const inlinePreviewSummary = inlinePreviewDetails.querySelector(':scope > summary');
    const inlinePreview = content.querySelector('.stsm-range-deletion-inline-content');
    const button = content.querySelector('.stsm-range-deletion-preview-button');
    let selectedIds = [];
    let applying = false;

    const renderInlinePreview = () => {
        if (!inlinePreviewDetails.open) {
            inlinePreview.innerHTML = '';
            return;
        }
        if (!selectedIds.length) {
            inlinePreview.innerHTML = '<div class="stsm-empty">시작 레코드와 끝 레코드를 선택해주세요.</div>';
            return;
        }
        const plan = getSummaryRecordDeletionPlan(selectedIds);
        const previewIds = [...plan.directRecords, ...plan.dependentRecords].map(record => record.id);
        const recordsById = new Map(previewIds
            .map(getSummaryRecord)
            .filter(Boolean)
            .map(record => [record.id, record]));
        inlinePreview.innerHTML = `
            ${renderContentPreviewGroup('직접 선택한 기록', plan.directRecords, recordsById)}
            ${renderContentPreviewGroup('압축 관계로 함께 삭제되는 기록', plan.dependentRecords, recordsById)}
        `;
    };

    const updateSelection = () => {
        selectedIds = getSelectedRangeIds(candidates, startSelect.value, endSelect.value);
        button.disabled = !selectedIds.length;
        inlinePreviewSummary.textContent = selectedIds.length
            ? `삭제 범위 미리보기 · ${selectedIds.length}개 선택`
            : '삭제 범위 미리보기';
        if (!selectedIds.length) {
            selection.textContent = '시작 레코드와 끝 레코드를 선택해주세요.';
            renderInlinePreview();
            return;
        }
        const selected = candidates.filter(record => selectedIds.includes(record.id));
        selection.textContent = `${formatRecordRange(selected[0])}부터 ${formatRecordRange(selected.at(-1))}까지 ${selected.length}개가 선택되었습니다.`;
        renderInlinePreview();
    };
    startSelect.addEventListener('change', updateSelection);
    endSelect.addEventListener('change', updateSelection);
    inlinePreviewDetails.addEventListener('toggle', renderInlinePreview);
    button.addEventListener('click', async () => {
        if (applying || !selectedIds.length) return;
        try {
            const plan = getSummaryRecordDeletionPlan(selectedIds);
            if (!plan.deletedIds.length) {
                toastr.info('선택한 요약 기록을 찾지 못했습니다.');
                return;
            }
            if (!await confirmRecordDeletion(plan)) return;

            applying = true;
            button.disabled = true;
            const appliedPlan = await deleteSummaryRecords(selectedIds);
            try {
                await onApplied?.(appliedPlan);
            } catch (error) {
                console.error('[Chat Summarizer] Record range deletion follow-up failed:', error);
                addExtensionErrorLog(error, {
                    operation: 'record-range-delete',
                    title: '레코드 범위 삭제 후 동기화 실패',
                    message: '요약 기록은 삭제했지만 화면 또는 자동 숨김 상태를 갱신하지 못했습니다.',
                });
                toastr.warning('요약 기록은 삭제했지만 후속 화면 갱신에 실패했습니다. 팝업을 다시 열어 확인해주세요.');
            }
            toastr.success(`${appliedPlan.deletedIds.length}개의 요약 기록을 삭제했습니다.`);
            await popup.completeAffirmative();
        } catch (error) {
            logRangeDeletionError(error, '요약 레코드 범위 삭제 실패', error.message || '요약 레코드를 범위로 삭제하지 못했습니다.');
        } finally {
            applying = false;
            button.disabled = !selectedIds.length;
        }
    });
    await popup.show();
}

async function confirmRecordDeletion(plan) {
    const content = document.createElement('div');
    content.className = 'stsm-range-deletion-preview';
    content.innerHTML = `
        <strong class="stsm-section-title">선택한 레코드 범위를 삭제할까요?</strong>
        <div class="stsm-range-deletion-warning">삭제된 요약 기록은 복구할 수 없습니다. SillyTavern의 원본 메시지는 삭제하지 않습니다.</div>
        ${renderPlanGroup('직접 선택한 기록', plan.directRecords)}
        ${renderPlanGroup('압축 관계로 함께 삭제되는 기록', plan.dependentRecords)}
        ${renderPlanGroup('상시기억으로 복원되는 기록', plan.releasedRecords)}
    `;
    return await new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '기록 삭제',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
    }).show() === POPUP_RESULT.AFFIRMATIVE;
}

function getSelectedRangeIds(candidates, startId, endId) {
    const startIndex = candidates.findIndex(record => record.id === String(startId));
    const endIndex = candidates.findIndex(record => record.id === String(endId));
    if (startIndex < 0 || endIndex < 0) return [];
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return candidates.slice(from, to + 1).map(record => record.id);
}

function renderRecordOption(record) {
    return `<option value="${escapeHtml(record.id)}">${escapeHtml(formatRecordRange(record))}</option>`;
}

function formatRecordRange(record) {
    const level = Number(record.compression?.level) || 0;
    return `#${record.startId} ~ #${record.endId}${level ? ` · 압축 Lv.${level}` : ''}`;
}

function renderPlanGroup(title, records) {
    if (!records.length) return '';
    return `
        <section class="stsm-range-deletion-group">
            <strong>${title} · ${records.length}개</strong>
            <div class="stsm-range-deletion-list">
                ${records.map(record => `
                    <span>
                        <i class="fa-solid ${record.type === 'compressed' ? 'fa-compress' : 'fa-file-lines'}" aria-hidden="true"></i>
                        #${record.startId} ~ #${record.endId}${record.level ? ` · 압축 Lv.${record.level}` : ''}
                    </span>
                `).join('')}
            </div>
        </section>
    `;
}

function renderContentPreviewGroup(title, planRecords, recordsById) {
    if (!planRecords.length) return '';
    const items = planRecords.map(planRecord => {
        const record = recordsById.get(planRecord.id);
        return `
            <details class="stsm-range-deletion-record-preview">
                <summary>
                    <i class="stsm-range-deletion-record-chevron fa-solid fa-chevron-right" aria-hidden="true"></i>
                    <i class="fa-solid ${planRecord.type === 'compressed' ? 'fa-compress' : 'fa-file-lines'}" aria-hidden="true"></i>
                    <span>#${planRecord.startId} ~ #${planRecord.endId}${planRecord.level ? ` · 압축 Lv.${planRecord.level}` : ''}</span>
                </summary>
                <div class="stsm-range-deletion-record-content">${escapeHtml(record?.content || '내용이 없습니다.')}</div>
            </details>
        `;
    }).join('');
    return `
        <section class="stsm-range-deletion-group">
            <strong>${title} · ${planRecords.length}개</strong>
            <div class="stsm-range-deletion-content-list">
                ${items}
            </div>
        </section>
    `;
}

function compareRecords(left, right) {
    return left.startId - right.startId || left.endId - right.endId || left.id.localeCompare(right.id);
}

function logRangeDeletionError(error, title, message) {
    console.error(`[Chat Summarizer] ${title}:`, error);
    addExtensionErrorLog(error, {
        operation: 'record-range-delete',
        title,
        message,
    });
    toastr.error(message);
}
