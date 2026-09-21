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
import { publishSummaryRecordsChanged } from './summary-store.js';
import { hasMessageRange, isCompressionIncluded, recordRangeLabel, recordSelectionLabel } from './record-placement.js';

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
                ${candidates.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(recordSelectionLabel(record))}${record.compression ? ` · 압축 Lv.${record.compression.level}` : ''}</option>`).join('')}
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
        <div class="stsm-compression-exclusions" data-compression-exclusions></div>
    `;
    const start = form.querySelector('[data-compression-start]');
    const count = form.querySelector('[data-compression-count]');
    const repeat = form.querySelector('[data-compression-repeat]');
    const selection = form.querySelector('[data-compression-selection]');
    const exclusions = form.querySelector('[data-compression-exclusions]');
    const excludedActions = {};
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
                <strong>압축 예정: ${recordRangeLabel(first)} → ${recordRangeLabel(last)}</strong>
                <span>${count.value}개씩 ${repeat.value}회 · 총 ${plan.sources.length}개 레코드</span>
                ${next}
            `;
            const remaining = candidates.filter(record => !plan.sources.some(source => source.id === record.id));
            exclusions.innerHTML = plan.sources.filter(record => !isCompressionIncluded(record)).map(record => `
                <div class="stsm-compression-exclusion" data-excluded-id="${escapeHtml(record.id)}">
                    <strong>${escapeHtml(recordSelectionLabel(record))} · 압축 제외</strong>
                    <label class="stsm-field"><span>배치</span><select class="text_pole" data-excluded-action>
                        <option value="archive">내용 그대로 장기기억으로 이동</option>
                        <option value="keep" ${excludedActions[record.id]?.action === 'keep' ? 'selected' : ''}>상시기억에 유지</option>
                    </select></label>
                    ${!hasMessageRange(record) ? `<label class="stsm-field" data-excluded-placement><span>유지할 위치</span><select class="text_pole" data-excluded-after>
                        <option value="">새 압축본 뒤</option>
                        ${remaining.map(item => `<option value="${escapeHtml(item.id)}" ${excludedActions[record.id]?.afterRecordId === item.id ? 'selected' : ''}>${escapeHtml(recordSelectionLabel(item))} 뒤</option>`).join('')}
                    </select></label>` : ''}
                </div>`).join('');
            exclusions.querySelectorAll('[data-excluded-id]').forEach(row => {
                const update = () => {
                    excludedActions[row.dataset.excludedId] = {
                        action: row.querySelector('[data-excluded-action]').value,
                        afterRecordId: row.querySelector('[data-excluded-after]')?.value || null,
                    };
                    const placement = row.querySelector('[data-excluded-placement]');
                    if (placement) placement.hidden = excludedActions[row.dataset.excludedId].action !== 'keep';
                };
                row.addEventListener('change', update);
                update();
            });
        } catch (error) {
            selection.classList.add('stsm-compression-selection-error');
            selection.textContent = error.message;
            exclusions.replaceChildren();
        }
    };
    start.addEventListener('change', renderSelection);
    count.addEventListener('input', renderSelection);
    repeat.addEventListener('input', renderSelection);
    renderSelection();

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '압축하기',
        cancelButton: '취소',
        onClosing: popup => {
            if (popup.result !== 1) return true;
            try {
                const plan = createCompressionBatchPlan(start.value, count.value, repeat.value);
                if (plan.batches.some(batch => !batch.some(isCompressionIncluded))) {
                    throw new Error('압축에 포함할 레코드가 없는 배치가 있습니다. 압축 포함 설정이나 범위를 확인해주세요.');
                }
                return true;
            } catch (error) {
                selection.classList.add('stsm-compression-selection-error');
                selection.textContent = error.message;
                return false;
            }
        },
    });
    if (await popup.show() !== 1) return;

    let operationToken = null;
    let plan = null;
    const completedRecords = [];
    let currentBatchIndex = 0;
    let changesPublished = false;
    const publishCompletedChanges = () => {
        if (changesPublished || !completedRecords.length) return;
        changesPublished = true;
        publishSummaryRecordsChanged();
    };
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
            const record = await compressSummaryRecords({
                startRecordId: batchStart.id,
                count: batch.length,
                sourceRecordIds: batch.map(source => source.id),
                excludedActions,
                notifyChanges: false,
            });
            completedRecords.push({
                id: record.id,
                startId: record.startId,
                endId: record.endId,
            });

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

            await yieldToBrowser();
        }
        publishCompletedChanges();
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
        if (completedRecords.length) {
            publishCompletedChanges();
            await onCreated?.(completedRecords.at(-1));
        }
        const completedLabel = completedRecords.length ? ` · 완료 ${completedRecords.length}회` : '';
        toastr.error(`${error.message || '요약 레코드 압축에 실패했습니다.'}${completedLabel}`);
    } finally {
        button.disabled = false;
        if (summarizeButton) summarizeButton.disabled = Boolean(summarizeWasDisabled);
        if (operationToken) endOperation(operationToken);
    }
}

function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
}
