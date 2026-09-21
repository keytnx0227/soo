import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { getExtensionState } from '../core/extension-state.js';
import { showManualAtlasEntryEditor } from '../memory/atlas-manual-editor.js';
import { addSummaryRecord, getSummaryRecordIndex } from '../summary/summary-store.js';
import { DEFAULT_SUMMARY_SECTIONS, DEFAULT_MEMORY_SECTIONS, SUMMARY_FORMAT_VERSION, normalizeStructuredSummaryData } from '../summary/summary-format.js';
import { validateSummaryRange } from '../summary/summary-service.js';
import { compareRecordPosition, recordSelectionLabel } from '../summary/record-placement.js';
import { renderEditor, bindEditorActions, collectEditorData } from './structured-summary-editor.js';

const CATEGORIES = { people: '인물', items: '아이템', commitments: '서약', events: '사건', world: '세계 설정' };

export function bindManualRecordView(root, onCreated) {
    root.querySelector('#stsm-add-record')?.addEventListener('click', async () => {
        try {
            if (await openManualRecordEditor()) await onCreated?.();
        } catch (error) {
            console.error('[Chat Summarizer] Manual record failed:', error);
            toastr.error(error.message || '레코드를 추가하지 못했습니다.');
        }
    });
}

export function createManualRecordForm(records) {
    const form = document.createElement('div');
    form.className = 'stsm-structured-summary-editor stsm-manual-record-editor';
    const empty = { plot: [''], contextFlow: [], emotions: [], quotes: [], continuityChanges: [] };
    form.innerHTML = `
        <header class="stsm-structured-editor-header"><strong>요약 레코드 직접 추가</strong></header>
        <section class="stsm-manual-record-options">
            <label><input type="checkbox" data-manual-range /> 메시지 범위 지정</label>
            <div class="stsm-manual-record-range" data-manual-range-fields hidden>
                <label class="stsm-field"><span>시작 ID</span><input class="text_pole" data-manual-start type="number" min="0" step="1" /></label>
                <label class="stsm-field"><span>종료 ID</span><input class="text_pole" data-manual-end type="number" min="0" step="1" /></label>
            </div>
            <label><input type="checkbox" data-manual-coverage disabled /> 해당 범위를 요약 완료로 처리</label>
            <label><input type="checkbox" data-manual-compression /> 압축 대상에 포함</label>
            <label class="stsm-field" data-manual-position><span>배치 위치</span><select class="text_pole" data-manual-after>
                <option value="">마지막 레코드 뒤</option>
                ${records.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(recordSelectionLabel(record))} 뒤</option>`).join('')}
            </select></label>
        </section>
        <div data-manual-body>${renderEditor({ startId: '', endId: '', structuredSummary: { data: empty } })}</div>
        <section class="stsm-structured-editor-section">
            <label class="stsm-field"><span>검색 태그</span><input class="text_pole" data-manual-tags placeholder="쉼표로 구분" /></label>
        </section>
        <section class="stsm-structured-editor-section">
            <div class="stsm-structured-editor-title">도감 추가</div>
            <div class="stsm-manual-atlas-actions">
                <select class="text_pole" data-manual-category>${Object.entries(CATEGORIES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
                <button type="button" class="menu_button" data-manual-atlas-add title="도감 항목 추가" aria-label="도감 항목 추가"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div data-manual-atlas-list></div>
        </section>
        <div class="stsm-compression-selection-error" data-manual-error role="alert"></div>`;
    form.querySelector('[data-manual-body] .stsm-structured-editor-header').remove();
    bindEditorActions(form.querySelector('[data-manual-body]'));
    const range = form.querySelector('[data-manual-range]');
    range.addEventListener('change', () => {
        form.querySelector('[data-manual-range-fields]').hidden = !range.checked;
        form.querySelector('[data-manual-position]').hidden = range.checked;
        const coverage = form.querySelector('[data-manual-coverage]');
        coverage.disabled = !range.checked;
        if (!range.checked) coverage.checked = false;
        form.querySelector('[data-manual-compression]').checked = range.checked;
    });
    return form;
}

export async function openManualRecordEditor() {
    const context = SillyTavern.getContext();
    const chatRef = context.chat;
    const metadataRef = context.chatMetadata;
    const records = getSummaryRecordIndex().filter(record => !record.compressedBy).sort(compareRecordPosition);
    const form = createManualRecordForm(records);
    const entries = [];
    const renderEntries = () => {
        form.querySelector('[data-manual-atlas-list]').innerHTML = entries.map((entry, index) => `
            <div class="stsm-manual-atlas-draft">
                <span>${CATEGORIES[entry.category]} · ${escapeHtml(entry.value.name || entry.value.title || entry.value.content)}</span>
                <button type="button" class="menu_button" data-draft-edit="${index}" title="수정" aria-label="수정"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="menu_button" data-draft-delete="${index}" title="삭제" aria-label="삭제"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');
    };
    form.addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button) return;
        const category = button.hasAttribute('data-manual-atlas-add') ? form.querySelector('[data-manual-category]').value : null;
        const edit = button.dataset.draftEdit;
        const remove = button.dataset.draftDelete;
        if (remove !== undefined) { entries.splice(Number(remove), 1); renderEntries(); return; }
        if (!category && edit === undefined) return;
        button.disabled = true;
        try {
            const entry = edit !== undefined ? entries[Number(edit)] : { category, value: null };
            const value = await showManualAtlasEntryEditor(entry.category, null, { draft: true, initial: entry.value });
            if (value) {
                if (edit !== undefined) entry.value = value;
                else entries.push({ category, value });
                renderEntries();
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
                let startId = null;
                let endId = null;
                if (form.querySelector('[data-manual-range]').checked) {
                    const range = validateSummaryRange(form.querySelector('[data-manual-start]').value, form.querySelector('[data-manual-end]').value);
                    startId = range.start;
                    endId = range.end;
                }
                const memoryUpdates = {};
                for (const entry of entries) {
                    memoryUpdates[entry.category] ||= { created: [], updated: [] };
                    memoryUpdates[entry.category].created.push(entry.value);
                }
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
