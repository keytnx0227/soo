import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { createId } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { getExtensionState } from '../core/extension-state.js';
import { addSummaryRecord, getSummaryRecord, getSummaryRecordIndex } from '../summary/summary-store.js';
import { DEFAULT_SUMMARY_SECTIONS, DEFAULT_MEMORY_SECTIONS, SUMMARY_FORMAT_VERSION, normalizeStructuredSummaryData } from '../summary/summary-format.js';
import { validateSummaryRange } from '../summary/summary-service.js';
import { compareRecordPosition, positionAfter } from '../summary/record-placement.js';
import { renderEditor, bindEditorActions, collectEditorData } from './structured-summary-editor.js';
import { renderManualRecordSettings, bindManualRecordSettings, renderManualInfo } from './manual-record-settings.js';
import { openManualAtlasManager } from './manual-atlas-view.js';
import { collectManualAtlasUpdates } from './manual-atlas-draft.js';

export function bindManualRecordView(root, onCreated) {
    root.querySelector('.stsm-add-record')?.addEventListener('click', async () => {
        try {
            if (root.dataset.recordMemoryView === 'long-term') {
                toastr.info('장기기억 직접 추가는 아직 지원하지 않습니다. 상시기억에서 추가해주세요.');
                return;
            }
            if (await openManualRecordEditor()) await onCreated?.();
        } catch (error) {
            console.error('[Chat Summarizer] Manual record failed:', error);
            toastr.error(error.message || '레코드를 추가하지 못했습니다.');
        }
    });
}

export function createManualRecordForm(records, { allRecords = records, messageCount = 0, resolveRecord } = {}) {
    const form = document.createElement('div');
    form.className = 'stsm-structured-summary-editor stsm-manual-record-editor';
    const empty = { plot: [''], contextFlow: [], emotions: [], quotes: [], continuityChanges: [] };
    form.innerHTML = `
        <header class="stsm-manual-heading"><h3>레코드 채우기</h3><button class="menu_button" type="button" data-manual-atlas-manage><i class="fa-solid fa-book" aria-hidden="true"></i><span>도감</span><span data-manual-atlas-count>0</span></button></header>
        <div data-manual-body>${renderEditor({ startId: '', endId: '', structuredSummary: { data: empty } })}</div>
        <section class="stsm-structured-editor-section stsm-manual-tags">
            <label class="stsm-field"><span>검색 태그</span><input class="text_pole" data-manual-tags placeholder="쉼표로 구분" /></label>
            ${renderManualInfo('검색 태그', '장기기억을 찾을 때 사용하는 단어입니다. 쉼표로 구분하며, 요약 본문에는 출력하지 않습니다.')}
        </section>
        ${renderManualRecordSettings(records, allRecords, messageCount)}
        <div class="stsm-compression-selection-error" data-manual-error role="alert"></div>`;
    form.querySelector('[data-manual-body] .stsm-structured-editor-header').remove();
    bindEditorActions(form.querySelector('[data-manual-body]'));
    form.querySelectorAll('[data-editor-add]').forEach(button => {
        button.title = button.textContent.trim(); button.setAttribute('aria-label', button.title);
    });
    bindManualRecordSettings(form, records, allRecords, messageCount, resolveRecord);
    return form;
}

export async function openManualRecordEditor() {
    const context = SillyTavern.getContext();
    const chatRef = context.chat;
    const metadataRef = context.chatMetadata;
    const allRecords = getSummaryRecordIndex();
    const records = allRecords.filter(record => !record.compressedBy).sort(compareRecordPosition);
    const form = createManualRecordForm(records, { allRecords, messageCount: chatRef.length, resolveRecord: record => getSummaryRecord(record.id) });
    let entries = [];
    const previewId = createId('manual-preview');
    const getRange = () => {
        if (!form.querySelector('[data-manual-range]').checked) return { startId: null, endId: null };
        const range = validateSummaryRange(form.querySelector('[data-manual-start]').value, form.querySelector('[data-manual-end]').value);
        return { startId: range.start, endId: range.end };
    };
    form.querySelector('[data-manual-atlas-manage]').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const result = await openManualAtlasManager(entries, memoryUpdates => ({
                id: previewId, type: 'summary', ...getRange(),
                position: form.querySelector('[data-manual-range]').checked ? undefined
                    : positionAfter(records, form.querySelector('[data-manual-after]').value || null),
                structuredSummary: { data: { memoryUpdates } },
            }));
            if (result) {
                entries = result;
                form.querySelector('[data-manual-atlas-count]').textContent = entries.length;
            }
        } catch (error) { toastr.error(error.message); }
        finally { button.disabled = false; }
    });
    let created = null;
    await new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '추가하기', cancelButton: '취소', wide: true, large: true, allowVerticalScrolling: true,
        onClosing: async popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                const current = SillyTavern.getContext();
                if (current.chat !== chatRef || current.chatMetadata !== metadataRef) throw new Error('채팅이 변경되었습니다. 현재 창을 닫고 다시 추가해주세요.');
                if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 저장해주세요.');
                const { startId, endId } = getRange();
                const memoryUpdates = collectManualAtlasUpdates(entries);
                const data = normalizeStructuredSummaryData({
                    ...collectEditorData(form, {}), memoryUpdates,
                    tags: form.querySelector('[data-manual-tags]').value.split(',').map(value => value.trim()).filter(Boolean),
                });
                created = await addSummaryRecord({
                    startId, endId,
                    manual: {
                        countsAsSummary: startId !== null && form.querySelector('[data-manual-coverage]').checked,
                        includeInCompression: form.querySelector('[data-manual-compression]').checked,
                    },
                    afterRecordId: form.querySelector('[data-manual-after]').value || null,
                    structuredSummary: { version: SUMMARY_FORMAT_VERSION, languageMode: getSettings().summarization.outputLanguage, sections: DEFAULT_SUMMARY_SECTIONS, memorySections: DEFAULT_MEMORY_SECTIONS, data },
                });
                return true;
            } catch (error) {
                form.querySelector('[data-manual-error]').textContent = error.message;
                return false;
            }
        },
    }).show();
    return created;
}
