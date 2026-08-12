import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { createRangeShiftProposal, formatRange } from './range-adjustment.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { getSummaryRecordIndex, updateSummaryRecordRanges } from '../summary/summary-store.js';

export function bindRangeAdjustment(root, { onApplied } = {}) {
    root.querySelector('#stsm-adjust-record-ranges').addEventListener('click', async () => {
        try {
            await openRangeAdjustmentPopup(onApplied);
        } catch (error) {
            console.error('[Chat Summarizer] Failed to open range adjustment:', error);
            addExtensionErrorLog(error, {
                operation: 'range-adjustment',
                title: '범위 일괄 교정 화면 열기 실패',
                message: '요약 범위 일괄 교정 화면을 열지 못했습니다.',
            });
            toastr.error('요약 범위 일괄 교정 화면을 열지 못했습니다.');
        }
    });
}

async function openRangeAdjustmentPopup(onApplied) {
    if (!getSummaryRecordIndex().length) {
        toastr.info('교정할 요약 기록이 없습니다.');
        return;
    }

    const content = document.createElement('div');
    content.className = 'stsm-range-adjustment-popup';
    content.innerHTML = `
        <strong class="stsm-section-title">요약 범위 일괄 교정</strong>
        <div class="stsm-grid-two">
            <label class="stsm-field">
                <span>변경 기준 ID</span>
                <input class="stsm-range-adjustment-threshold text_pole" type="number" min="0" step="1" placeholder="삭제/추가가 시작된 ID" />
            </label>
            <label class="stsm-field">
                <span>변경 메시지 개수</span>
                <input class="stsm-range-adjustment-amount text_pole" type="number" min="1" step="1" value="1" />
            </label>
        </div>
        <div class="stsm-range-adjustment-actions">
            <button class="stsm-range-adjustment-minus menu_button interactable" type="button">
                <i class="fa-solid fa-minus"></i>
                <span>일괄 −</span>
            </button>
            <button class="stsm-range-adjustment-plus menu_button interactable" type="button">
                <i class="fa-solid fa-plus"></i>
                <span>일괄 ＋</span>
            </button>
        </div>
    `;

    const editorPopup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
    });
    let isApplying = false;
    const applyDirection = async direction => {
        if (isApplying) return;
        try {
            const threshold = parseIntegerInput(content.querySelector('.stsm-range-adjustment-threshold').value);
            const amount = parseIntegerInput(content.querySelector('.stsm-range-adjustment-amount').value);
            if (threshold === null) throw new Error('기준 ID를 입력해주세요.');
            if (amount === null || amount < 1) throw new Error('변경 메시지 개수는 1 이상의 정수로 입력해주세요.');

            const chat = SillyTavern.getContext().chat;
            const proposal = createRangeShiftProposal(getSummaryRecordIndex(), {
                threshold,
                delta: direction * amount,
                chatLength: Array.isArray(chat) ? chat.length : 0,
            });
            if (!await confirmRangeShift(proposal)) return;

            isApplying = true;
            setActionButtonsDisabled(content, true);
            const updatedRecords = await updateSummaryRecordRanges(proposal.changes.map(change => ({
                id: change.id,
                startId: change.startId,
                endId: change.endId,
            })));
            try {
                await onApplied?.(updatedRecords);
            } catch (error) {
                console.error('[Chat Summarizer] Range adjustment follow-up failed:', error);
                addExtensionErrorLog(error, {
                    operation: 'range-adjustment',
                    title: '범위 교정 후 동기화 실패',
                    message: '범위는 저장했지만 화면 또는 자동 숨김 상태 갱신에 실패했습니다.',
                });
                toastr.warning('범위는 저장했지만 화면 또는 자동 숨김 상태 갱신에 실패했습니다. 팝업을 다시 열어 확인해주세요.');
            }
            toastr.success(`${updatedRecords.length}개의 요약 범위를 일괄 교정했습니다.`);
            await editorPopup.completeAffirmative();
        } catch (error) {
            console.error('[Chat Summarizer] Failed to adjust summary ranges:', error);
            if (isApplying) {
                addExtensionErrorLog(error, {
                    operation: 'range-adjustment',
                    title: '요약 범위 일괄 교정 실패',
                    message: '요약 범위 변경 내용을 저장하지 못했습니다.',
                });
            }
            toastr.error(error.message || '요약 범위 일괄 교정에 실패했습니다.');
        } finally {
            isApplying = false;
            setActionButtonsDisabled(content, false);
        }
    };

    content.querySelector('.stsm-range-adjustment-minus').addEventListener('click', () => applyDirection(-1));
    content.querySelector('.stsm-range-adjustment-plus').addEventListener('click', () => applyDirection(1));
    await editorPopup.show();
}

async function confirmRangeShift(proposal) {
    const content = document.createElement('div');
    content.className = 'stsm-range-adjustment-preview';
    const operation = proposal.mode === 'deletion'
        ? `${formatRange(proposal.affectedStartId, proposal.affectedEndId)} 삭제 반영`
        : `#${proposal.affectedStartId}에 ${proposal.delta}개 추가 반영`;
    content.innerHTML = `
        <strong class="stsm-section-title">다음 범위 변경을 적용할까요?</strong>
        <div class="stsm-range-adjustment-summary">${operation}</div>
        <div class="stsm-range-adjustment-preview-list">
            ${proposal.changes.map(change => `
                <div>
                    <span>${formatRange(change.oldStartId, change.oldEndId)}</span>
                    <i class="fa-solid fa-arrow-right"></i>
                    <strong>${formatRange(change.startId, change.endId)}</strong>
                </div>
            `).join('')}
        </div>
    `;
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '일괄 교정',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function parseIntegerInput(value) {
    const text = String(value ?? '').trim();
    const number = Number(text);
    return text && Number.isInteger(number) ? number : null;
}

function setActionButtonsDisabled(content, disabled) {
    content.querySelectorAll('.stsm-range-adjustment-actions button').forEach(button => {
        button.disabled = disabled;
    });
}
