import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation, updateOperation } from '../core/extension-state.js';
import { getSettings, setCompressionGroupSize } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { translateSummaryRecord } from '../translation/translation-service.js';
import {
    compressSummaryRecords,
    createCompressionBatchPlan,
    getCompressionCandidates,
} from './compression-service.js';

export function bindCompressionView(root, { onCreated } = {}) {
    const button = root.querySelector('#stsm-open-compression');
    if (!button) return;
    button.addEventListener('click', () => openCompressionPopup(button, onCreated));
}

async function openCompressionPopup(button, onCreated) {
    const candidates = getCompressionCandidates();
    if (candidates.length < 2) {
        toastr.info('압축할 활성 요약 레코드가 두 개 이상 필요합니다.');
        return;
    }

    const form = document.createElement('div');
    form.className = 'stsm-compression-form';
    form.innerHTML = `
        <div class="stsm-section-title">요약 레코드 압축</div>
        <label class="stsm-field">
            <span>시작 레코드</span>
            <select class="text_pole" data-compression-start>
                ${candidates.map(record => `<option value="${escapeHtml(record.id)}">#${record.startId} ~ #${record.endId}${record.compression ? ` · 압축 Lv.${record.compression.level}` : ''}</option>`).join('')}
            </select>
        </label>
        <label class="stsm-field">
            <span>압축할 연속 레코드 수</span>
            <input class="text_pole" data-compression-count type="number" min="2" max="100" step="1" />
        </label>
        <label class="stsm-field">
            <span>반복 횟수</span>
            <input class="text_pole" data-compression-repeat type="number" min="1" max="100" step="1" value="1" />
        </label>
        <div class="stsm-compression-selection" data-compression-selection></div>
    `;
    const start = form.querySelector('[data-compression-start]');
    const count = form.querySelector('[data-compression-count]');
    const repeat = form.querySelector('[data-compression-repeat]');
    const selection = form.querySelector('[data-compression-selection]');
    count.value = getSettings().summarization.compressionGroupSize;

    const renderSelection = () => {
        try {
            const plan = createCompressionBatchPlan(start.value, count.value, repeat.value);
            const first = plan.sources[0];
            const last = plan.sources.at(-1);
            const next = plan.nextRecord
                ? `<span>다음 미압축 레코드: <strong>#${plan.nextRecord.startId} ~ #${plan.nextRecord.endId}</strong></span>`
                : '<span>선택 범위 뒤에 남는 활성 레코드가 없습니다.</span>';
            selection.classList.remove('stsm-compression-selection-error');
            selection.innerHTML = `
                <strong>압축 예정: #${first.startId} ~ #${last.endId}</strong>
                <span>${count.value}개씩 ${repeat.value}회 · 총 ${plan.sources.length}개 레코드</span>
                ${next}
            `;
        } catch (error) {
            selection.classList.add('stsm-compression-selection-error');
            selection.textContent = error.message;
        }
    };
    start.addEventListener('change', renderSelection);
    count.addEventListener('input', renderSelection);
    repeat.addEventListener('input', renderSelection);
    renderSelection();

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '압축하기',
        cancelButton: '취소',
    });
    if (await popup.show() !== 1) return;

    let operationToken = null;
    let plan = null;
    const completedRecords = [];
    let currentBatchIndex = 0;
    const summarizeButton = button.closest('#stsm-root')?.querySelector('#stsm-summarize');
    const summarizeWasDisabled = summarizeButton?.disabled;
    try {
        plan = createCompressionBatchPlan(start.value, count.value, repeat.value);
        setCompressionGroupSize(count.value);
        button.disabled = true;
        if (summarizeButton) summarizeButton.disabled = true;
        operationToken = beginOperation('compressing', '압축 배치 작업 준비 중');

        for (currentBatchIndex = 0; currentBatchIndex < plan.batches.length; currentBatchIndex += 1) {
            const batch = plan.batches[currentBatchIndex];
            const batchStart = batch[0];
            const batchEnd = batch.at(-1);
            updateOperation(
                operationToken,
                `#${batchStart.startId} ~ #${batchEnd.endId} 압축 중 (${currentBatchIndex + 1}/${plan.batches.length})`,
            );
            const record = await compressSummaryRecords({ startRecordId: batchStart.id, count: batch.length });
            completedRecords.push(record);

            if (getSettings().translation.autoTranslate) {
                updateOperation(
                    operationToken,
                    `#${record.startId} ~ #${record.endId} 압축본 번역 중 (${currentBatchIndex + 1}/${plan.batches.length})`,
                );
                try {
                    await translateSummaryRecord(record.id);
                } catch (error) {
                    addExtensionErrorLog(error, {
                        operation: 'translation',
                        title: '압축 요약 자동 번역 실패',
                        message: '압축 요약은 생성했지만 자동 번역에 실패했습니다.',
                        context: { range: { startId: record.startId, endId: record.endId } },
                    });
                    toastr.warning(`#${record.startId} ~ #${record.endId} 압축본 자동 번역에 실패했습니다.`);
                }
            }
        }
        await onCreated?.(completedRecords.at(-1));
        toastr.success(`${plan.sources.length}개의 요약 레코드를 ${completedRecords.length}개의 압축본으로 만들었습니다.`);
    } catch (error) {
        console.error('[Chat Summarizer] Compression failed:', error);
        const failedBatch = plan?.batches[currentBatchIndex];
        const failedRange = failedBatch
            ? { startId: failedBatch[0].startId, endId: failedBatch.at(-1).endId }
            : null;
        const unattempted = plan ? plan.batches.slice(currentBatchIndex + 1) : [];
        addExtensionErrorLog(error, {
            operation: 'compression',
            title: '요약 압축 배치 중단',
            message: completedRecords.length
                ? `${completedRecords.length}회 완료 후 압축 작업을 중단했습니다.`
                : '첫 압축 요청에서 작업을 중단했습니다.',
            context: {
                range: failedRange,
                completedRanges: completedRecords.map(record => ({ startId: record.startId, endId: record.endId })),
                unattemptedRanges: unattempted.map(batch => ({ startId: batch[0].startId, endId: batch.at(-1).endId })),
            },
        });
        if (completedRecords.length) await onCreated?.(completedRecords.at(-1));
        const completedLabel = completedRecords.length ? ` · 완료 ${completedRecords.length}회` : '';
        toastr.error(`${error.message || '요약 레코드 압축에 실패했습니다.'}${completedLabel}`);
    } finally {
        button.disabled = false;
        if (summarizeButton) summarizeButton.disabled = Boolean(summarizeWasDisabled);
        if (operationToken) endOperation(operationToken);
    }
}
