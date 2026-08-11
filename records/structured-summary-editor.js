import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { getSettings } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { normalizeStructuredSummaryData, renderStructuredSummary } from '../summary/summary-format.js';
import { getSummaryRecord, updateSummaryRecordContent } from '../summary/summary-store.js';

export async function openStructuredSummaryEditor(recordId) {
    const record = getSummaryRecord(recordId);
    if (!record?.structuredSummary?.data || record.type !== 'summary') {
        throw new Error('구조화 편집이 가능한 일반 요약 레코드를 찾지 못했습니다.');
    }

    const form = document.createElement('div');
    form.className = 'stsm-structured-summary-editor';
    form.innerHTML = renderEditor(record);
    bindEditorActions(form);

    let updatedRecord = null;
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '수정하기',
        cancelButton: '취소',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: async currentPopup => {
            if (currentPopup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                const data = normalizeStructuredSummaryData(collectEditorData(form, record.structuredSummary.data));
                const settings = getSettings().summarization;
                const content = renderStructuredSummary(data, {
                    startId: record.startId,
                    endId: record.endId,
                    template: settings.summaryContentTemplate,
                    outputSections: settings.summaryOutputSections,
                });
                updatedRecord = await updateSummaryRecordContent(record.id, content, {
                    contentEdited: false,
                    structuredSummary: {
                        ...record.structuredSummary,
                        data,
                    },
                });
                if (!updatedRecord) throw new Error('수정할 요약 레코드를 찾지 못했습니다.');
                return true;
            } catch (error) {
                console.error('[Chat Summarizer] Failed to save structured summary:', error);
                addExtensionErrorLog(error, {
                    operation: 'record-update',
                    title: '구조화 요약 수정 저장 실패',
                    message: '구조화 요약 수정 내용을 저장하지 못했습니다.',
                    context: { range: { startId: record.startId, endId: record.endId } },
                });
                toastr.error(error.message || '구조화 요약 수정 내용을 저장하지 못했습니다.');
                return false;
            }
        },
    });
    await popup.show();
    return updatedRecord;
}

function renderEditor(record) {
    const data = record.structuredSummary.data;
    return `
        <header class="stsm-structured-editor-header">
            <strong>요약 레코드 수정</strong>
            <span>#${record.startId} ~ #${record.endId}</span>
        </header>
        <section class="stsm-structured-editor-section">
            <div class="stsm-structured-editor-title">제목</div>
            <input class="text_pole" data-summary-title type="text" value="${escapeHtml(data.title || '')}" placeholder="제목 없음" />
        </section>
        ${renderContextEditor(data.contextFlow)}
        ${renderStringListEditor('plot', '플롯', data.plot, '플롯 항목 추가')}
        ${renderStringListEditor('continuity', '연속성 변화', data.continuityChanges, '연속성 변화 추가')}
        ${renderEmotionEditor(data.emotions)}
        ${renderQuoteEditor(data.quotes)}
    `;
}

function renderContextEditor(values) {
    return `
        <section class="stsm-structured-editor-section" data-editor-section="context">
            ${renderSectionHeading('문맥 흐름', 'context', '흐름 추가')}
            <div class="stsm-structured-editor-list" data-editor-list="context">
                ${(values || []).map(renderContextRow).join('')}
            </div>
        </section>
    `;
}

function renderContextRow(value = {}) {
    return `
        <div class="stsm-structured-context-row" data-editor-row>
            <input class="text_pole" data-context-field="date" type="text" value="${escapeHtml(value.date || '')}" placeholder="날짜" />
            <input class="text_pole" data-context-field="relativeDate" type="text" value="${escapeHtml(value.relativeDate || '')}" placeholder="상대 날짜" />
            <input class="text_pole" data-context-field="time" type="text" value="${escapeHtml(value.time || '')}" placeholder="시간" />
            <input class="text_pole" data-context-field="location" type="text" value="${escapeHtml(value.location || '')}" placeholder="장소" />
            ${renderRemoveButton('흐름 삭제')}
        </div>
    `;
}

function renderStringListEditor(kind, title, values, addLabel) {
    return `
        <section class="stsm-structured-editor-section" data-editor-section="${kind}">
            ${renderSectionHeading(title, kind, addLabel)}
            <div class="stsm-structured-editor-list" data-editor-list="${kind}">
                ${(values || []).map(value => renderStringRow(value, title)).join('')}
            </div>
        </section>
    `;
}

function renderStringRow(value = '', label = '항목') {
    return `
        <div class="stsm-structured-string-row" data-editor-row>
            <textarea class="text_pole" rows="2" data-string-value placeholder="${escapeHtml(label)}">${escapeHtml(value)}</textarea>
            ${renderRemoveButton(`${label} 삭제`)}
        </div>
    `;
}

function renderEmotionEditor(values) {
    return `
        <section class="stsm-structured-editor-section" data-editor-section="emotions">
            ${renderSectionHeading('감정', 'emotion-group', '인물 감정 추가')}
            <div class="stsm-structured-editor-list" data-editor-list="emotions">
                ${(values || []).map(renderEmotionGroup).join('')}
            </div>
        </section>
    `;
}

function renderEmotionGroup(value = { states: [] }) {
    return `
        <article class="stsm-structured-emotion-group" data-emotion-group>
            <div class="stsm-structured-emotion-header">
                <input class="text_pole" data-emotion-subject type="text" value="${escapeHtml(value.subject || '')}" placeholder="인물" />
                <input class="text_pole" data-emotion-toward type="text" value="${escapeHtml(value.toward || '')}" placeholder="감정 대상 (선택)" />
                ${renderRemoveButton('인물 감정 삭제', 'emotion-group')}
            </div>
            <div class="stsm-structured-emotion-states" data-emotion-states>
                ${(value.states || []).map(renderEmotionState).join('')}
            </div>
            <button class="menu_button interactable stsm-structured-add-subitem" data-editor-add="emotion-state" type="button">
                <i class="fa-solid fa-plus" aria-hidden="true"></i><span>감정 흐름 추가</span>
            </button>
        </article>
    `;
}

function renderEmotionState(value = {}) {
    return `
        <div class="stsm-structured-emotion-state" data-editor-row>
            <input class="text_pole" data-emotion-name type="text" value="${escapeHtml(value.emotion || '')}" placeholder="감정" />
            <textarea class="text_pole" data-emotion-reason rows="2" placeholder="이유 (선택)">${escapeHtml(value.reason || '')}</textarea>
            ${renderRemoveButton('감정 흐름 삭제')}
        </div>
    `;
}

function renderQuoteEditor(values) {
    return `
        <section class="stsm-structured-editor-section" data-editor-section="quotes">
            ${renderSectionHeading('주요 대사', 'quote', '대사 추가')}
            <div class="stsm-structured-editor-list" data-editor-list="quotes">
                ${(values || []).map(renderQuoteRow).join('')}
            </div>
        </section>
    `;
}

function renderQuoteRow(value = {}) {
    return `
        <div class="stsm-structured-quote-row" data-editor-row>
            <input class="text_pole" data-quote-speaker type="text" value="${escapeHtml(value.speaker || '')}" placeholder="화자" />
            <textarea class="text_pole" data-quote-text rows="2" placeholder="대사">${escapeHtml(value.text || '')}</textarea>
            ${renderRemoveButton('대사 삭제')}
        </div>
    `;
}

function renderSectionHeading(title, kind, addLabel) {
    return `
        <div class="stsm-structured-editor-section-heading">
            <div class="stsm-structured-editor-title">${escapeHtml(title)}</div>
            <button class="menu_button interactable" data-editor-add="${kind}" type="button">
                <i class="fa-solid fa-plus" aria-hidden="true"></i><span>${escapeHtml(addLabel)}</span>
            </button>
        </div>
    `;
}

function renderRemoveButton(label, target = 'row') {
    return `
        <button class="menu_button menu_button_icon interactable stsm-structured-remove" data-editor-remove="${target}" type="button" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
    `;
}

function bindEditorActions(form) {
    form.addEventListener('click', event => {
        const add = event.target.closest('[data-editor-add]')?.dataset.editorAdd;
        if (add) addEditorItem(form, event.target, add);
        const remove = event.target.closest('[data-editor-remove]')?.dataset.editorRemove;
        if (remove) removeEditorItem(event.target, remove);
    });
}

function addEditorItem(form, target, kind) {
    if (kind === 'context') appendHtml(form.querySelector('[data-editor-list="context"]'), renderContextRow());
    if (kind === 'plot') appendHtml(form.querySelector('[data-editor-list="plot"]'), renderStringRow('', '플롯'));
    if (kind === 'continuity') appendHtml(form.querySelector('[data-editor-list="continuity"]'), renderStringRow('', '연속성 변화'));
    if (kind === 'emotion-group') appendHtml(form.querySelector('[data-editor-list="emotions"]'), renderEmotionGroup());
    if (kind === 'emotion-state') appendHtml(target.closest('[data-emotion-group]').querySelector('[data-emotion-states]'), renderEmotionState());
    if (kind === 'quote') appendHtml(form.querySelector('[data-editor-list="quotes"]'), renderQuoteRow());
}

function removeEditorItem(target, kind) {
    const selector = kind === 'emotion-group' ? '[data-emotion-group]' : '[data-editor-row]';
    target.closest(selector)?.remove();
}

function appendHtml(container, html) {
    container.insertAdjacentHTML('beforeend', html);
    container.lastElementChild?.querySelector('input, textarea')?.focus();
}

function collectEditorData(form, original) {
    const data = structuredClone(original);
    data.title = form.querySelector('[data-summary-title]').value.trim() || null;
    data.contextFlow = [...form.querySelectorAll('[data-editor-list="context"] [data-editor-row]')]
        .map(row => Object.fromEntries([...row.querySelectorAll('[data-context-field]')]
            .map(input => [input.dataset.contextField, input.value.trim() || null])))
        .filter(item => Object.values(item).some(Boolean));
    data.plot = collectStringRows(form, 'plot');
    if (!data.plot.length) throw new Error('플롯에는 최소 한 개의 항목이 필요합니다.');
    data.continuityChanges = collectStringRows(form, 'continuity');
    data.emotions = [...form.querySelectorAll('[data-emotion-group]')].map(group => {
        const subject = group.querySelector('[data-emotion-subject]').value.trim();
        const toward = group.querySelector('[data-emotion-toward]').value.trim() || null;
        const states = [...group.querySelectorAll('[data-emotion-states] [data-editor-row]')].map(row => ({
            emotion: row.querySelector('[data-emotion-name]').value.trim(),
            reason: row.querySelector('[data-emotion-reason]').value.trim() || null,
        })).filter(state => state.emotion || state.reason);
        if (!subject) throw new Error('감정 항목의 인물 이름을 입력해주세요.');
        if (!states.length || states.some(state => !state.emotion)) throw new Error(`${subject}의 감정 흐름을 올바르게 입력해주세요.`);
        return { subject, toward, states };
    });
    data.quotes = [...form.querySelectorAll('[data-editor-list="quotes"] [data-editor-row]')].map(row => ({
        speaker: row.querySelector('[data-quote-speaker]').value.trim(),
        text: row.querySelector('[data-quote-text]').value.trim(),
    })).filter(quote => quote.speaker || quote.text);
    if (data.quotes.some(quote => !quote.speaker || !quote.text)) {
        throw new Error('주요 대사의 화자와 내용을 모두 입력해주세요.');
    }
    return data;
}

function collectStringRows(form, kind) {
    return [...form.querySelectorAll(`[data-editor-list="${kind}"] [data-editor-row]`)]
        .map(row => row.querySelector('[data-string-value]').value.trim())
        .filter(Boolean);
}
