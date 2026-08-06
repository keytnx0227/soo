import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation, updateOperation } from '../core/extension-state.js';
import { getSettings, setCompressionGroupSize } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { translateSummaryRecord } from '../translation/translation-service.js';
import {
    compressSummaryRecords,
    getCompressionCandidates,
    selectCompressionSources,
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
        <div class="stsm-compression-selection" data-compression-selection></div>
    `;
    const start = form.querySelector('[data-compression-start]');
    const count = form.querySelector('[data-compression-count]');
    const selection = form.querySelector('[data-compression-selection]');
    count.value = getSettings().summarization.compressionGroupSize;

    const renderSelection = () => {
        try {
            const sources = selectCompressionSources(start.value, count.value);
            selection.classList.remove('stsm-compression-selection-error');
            selection.innerHTML = `<strong>#${sources[0].startId} ~ #${sources.at(-1).endId}</strong><span>${sources.length}개 레코드를 하나로 압축합니다.</span>`;
        } catch (error) {
            selection.classList.add('stsm-compression-selection-error');
            selection.textContent = error.message;
        }
    };
    start.addEventListener('change', renderSelection);
    count.addEventListener('input', renderSelection);
    renderSelection();

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '압축하기',
        cancelButton: '취소',
    });
    if (await popup.show() !== 1) return;

    let operationToken = null;
    const summarizeButton = button.closest('#stsm-root')?.querySelector('#stsm-summarize');
    const summarizeWasDisabled = summarizeButton?.disabled;
    try {
        const sources = selectCompressionSources(start.value, count.value);
        setCompressionGroupSize(count.value);
        button.disabled = true;
        if (summarizeButton) summarizeButton.disabled = true;
        operationToken = beginOperation('compressing', `#${sources[0].startId} ~ #${sources.at(-1).endId} 압축 중`);
        const record = await compressSummaryRecords({ startRecordId: start.value, count: count.value });
        if (getSettings().translation.autoTranslate) {
            updateOperation(operationToken, `#${record.startId} ~ #${record.endId} 압축본 번역 중`);
            try {
                await translateSummaryRecord(record.id);
            } catch (error) {
                addExtensionErrorLog(error, {
                    operation: 'translation',
                    title: '압축 요약 자동 번역 실패',
                    message: '압축 요약은 생성했지만 자동 번역에 실패했습니다.',
                    context: { range: { startId: record.startId, endId: record.endId } },
                });
                toastr.warning('압축 요약은 생성했지만 자동 번역에 실패했습니다.');
            }
        }
        await onCreated?.(record);
        toastr.success(`${sources.length}개의 요약 레코드를 압축했습니다.`);
    } catch (error) {
        console.error('[Chat Summarizer] Compression failed:', error);
        addExtensionErrorLog(error, {
            operation: 'compression',
            title: '요약 압축 실패',
            message: '요약 레코드를 압축하지 못했습니다.',
        });
        toastr.error(error.message || '요약 레코드 압축에 실패했습니다.');
    } finally {
        button.disabled = false;
        if (summarizeButton) summarizeButton.disabled = Boolean(summarizeWasDisabled);
        if (operationToken) endOperation(operationToken);
    }
}
