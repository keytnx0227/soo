import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    getSummaryContentTemplate,
    getSummaryContentTemplatePreset,
    getSettings,
    resetSummaryContentTemplate,
    setSummaryContentTemplate,
    setSummaryContentTemplatePreset,
} from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import {
    renderSummaryContentTemplate,
    getSummaryContentTemplatePresetId,
    SUMMARY_CONTENT_TEMPLATE_PRESETS,
    SUMMARY_CONTENT_TEMPLATE_MACROS,
} from './summary-record-template.js';
import { applySummaryContentTemplateToRecords } from './summary-store.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';

export function bindSummaryRecordTemplateSettings(root) {
    const container = root.querySelector('#stsm-summary-content-template');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.addEventListener('click', event => handleClick(root, event));
    container.addEventListener('change', event => handlePresetChange(root, event));
    renderSummaryRecordTemplateSettings(root);
}

export function renderSummaryRecordTemplateSettings(root) {
    const container = root.querySelector('#stsm-summary-content-template');
    if (!container) return;
    const preview = String(getSummaryContentTemplate()).split(/\r?\n/).find(line => line.trim())?.trim() || '빈 템플릿';
    const presetId = getSummaryContentTemplatePreset();
    container.innerHTML = `
        <div class="stsm-context-block stsm-summary-content-template-block">
            <div class="stsm-context-block-main">
                <strong>구조화 요약 → 레코드 내용</strong>
                ${renderPresetSelect(presetId, 'data-summary-template-preset')}
                <span>${escapeHtml(preview)}</span>
            </div>
            <div class="stsm-summary-template-actions">
                <button class="menu_button interactable" data-summary-template-action="apply" type="button" title="선택한 형식을 기존 요약 레코드에 적용">일괄 적용</button>
                <button class="menu_button menu_button_icon interactable" data-summary-template-action="edit" type="button" title="요약 레코드 내용 형식 수정" aria-label="요약 레코드 내용 형식 수정">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="menu_button menu_button_icon interactable" data-summary-template-action="reset" type="button" title="기본 형식으로 초기화" aria-label="요약 레코드 내용 형식 초기화">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        </div>
    `;
}

function handlePresetChange(root, event) {
    const select = event.target.closest('[data-summary-template-preset]');
    if (!select || select.value === 'custom') return;
    setSummaryContentTemplatePreset(select.value);
    renderSummaryRecordTemplateSettings(root);
    toastr.success(`앞으로 생성할 레코드의 기본 형식을 ${SUMMARY_CONTENT_TEMPLATE_PRESETS[select.value].label}으로 변경했습니다.`);
}

async function handleClick(root, event) {
    const action = event.target.closest('[data-summary-template-action]')?.dataset.summaryTemplateAction;
    if (action === 'apply') await applyTemplateToRecords();
    if (action === 'edit') await editTemplate(root);
    if (action === 'reset') await resetTemplate(root);
}

async function editTemplate(root) {
    const form = document.createElement('div');
    form.className = 'stsm-context-template-editor';
    form.innerHTML = `
        <div class="stsm-section-title">요약 레코드 내용 형식</div>
        <label class="stsm-field">
            <span>프리셋</span>
            ${renderPresetSelect(getSummaryContentTemplatePreset(), 'data-summary-content-template-preset')}
        </label>
        <label class="stsm-field">
            <span>내용 템플릿</span>
            <textarea class="text_pole monospace" data-summary-content-template rows="20"></textarea>
        </label>
        <details class="stsm-record-template-help" open>
            <summary>매크로와 반복 문법</summary>
            <div class="stsm-record-template-macros">
                ${SUMMARY_CONTENT_TEMPLATE_MACROS.map(([name, description]) => `<div><code>{{${name}}}</code><span>${escapeHtml(description)}</span></div>`).join('')}
            </div>
            <div class="stsm-template-syntax-help">
                <p><code>{{#이름}}...{{/이름}}</code> 값 또는 배열이 있을 때 출력하며 배열은 항목마다 반복합니다.</p>
                <p><code>{{^이름}}...{{/이름}}</code> 값이 비어 있을 때 출력합니다.</p>
                <p>배열 안에서는 <code>{{value}}</code>, <code>{{index}}</code>, <code>{{first}}</code>, <code>{{last}}</code>를 사용할 수 있습니다.</p>
            </div>
        </details>
    `;
    const textarea = form.querySelector('[data-summary-content-template]');
    const preset = form.querySelector('[data-summary-content-template-preset]');
    textarea.value = getSummaryContentTemplate();
    preset.addEventListener('change', () => {
        if (preset.value !== 'custom') textarea.value = SUMMARY_CONTENT_TEMPLATE_PRESETS[preset.value].template;
    });
    textarea.addEventListener('input', () => {
        preset.value = getSummaryContentTemplatePresetId(textarea.value);
    });
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '수정하기',
        cancelButton: '취소',
        wide: true,
    });
    if (await popup.show() !== 1) return;
    try {
        validateTemplate(textarea.value);
        setSummaryContentTemplate(textarea.value);
        renderSummaryRecordTemplateSettings(root);
        toastr.success('앞으로 생성할 레코드의 기본 내용 형식을 수정했습니다.');
    } catch (error) {
        toastr.error(error.message || '요약 레코드 내용 형식이 올바르지 않습니다.');
    }
}

async function resetTemplate(root) {
    if (!await Popup.show.confirm('요약 레코드 내용 형식을 초기화할까요?', '기본 간략 버전으로 복원합니다.')) return;
    resetSummaryContentTemplate();
    renderSummaryRecordTemplateSettings(root);
    toastr.success('앞으로 생성할 레코드의 기본 내용 형식을 초기화했습니다.');
}

async function applyTemplateToRecords() {
    const form = document.createElement('div');
    form.className = 'stsm-summary-template-apply-options';
    form.innerHTML = `
        <div class="stsm-section-title">기존 레코드에 일괄 적용</div>
        <p>현재 선택된 내용 형식으로 구조화 요약 레코드를 다시 렌더링합니다.</p>
        <label class="stsm-summary-template-apply-option">
            <input type="radio" name="stsm-summary-template-apply-scope" value="unedited" checked>
            <span><strong>수정되지 않은 레코드만</strong><small>직접 수정하거나 수정 대화를 적용한 레코드는 유지합니다.</small></span>
        </label>
        <label class="stsm-summary-template-apply-option">
            <input type="radio" name="stsm-summary-template-apply-scope" value="all">
            <span><strong>모든 레코드</strong><small>직접 수정한 본문도 구조화 데이터에서 다시 만들어 덮어씁니다.</small></span>
        </label>
    `;
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '일괄 적용',
        cancelButton: '취소',
    });
    if (await popup.show() !== 1) return;

    const includeEdited = form.querySelector('input[name="stsm-summary-template-apply-scope"]:checked')?.value === 'all';
    if (includeEdited && !await Popup.show.confirm(
        '직접 수정한 레코드도 덮어쓸까요?',
        '사용자가 수정한 본문이 구조화 요약 데이터에서 다시 생성되며, 기존 수정 내용은 복구할 수 없습니다.',
    )) return;

    try {
        const result = await applySummaryContentTemplateToRecords(getSummaryContentTemplate(), {
            includeEdited,
            outputSections: getSettings().summarization.summaryOutputSections,
        });
        window.dispatchEvent(new CustomEvent('stsm:record-content-template-applied'));
        const skipped = result.skippedEditedCount ? ` 수정된 레코드 ${result.skippedEditedCount}개는 유지했습니다.` : '';
        if (result.appliedCount) {
            toastr.success(`레코드 ${result.appliedCount}개에 내용 형식을 적용했습니다.${skipped}`);
        } else {
            toastr.info(`적용할 레코드가 없습니다.${skipped}`);
        }
    } catch (error) {
        console.error('[Chat Summarizer] Failed to apply summary content template:', error);
        addExtensionErrorLog(error, {
            operation: 'summary-template-apply',
            title: '요약 레코드 형식 일괄 적용 실패',
            message: '기존 요약 레코드에 선택한 내용 형식을 적용하지 못했습니다.',
        });
        toastr.error(error.message || '기존 레코드에 내용 형식을 적용하지 못했습니다.');
    }
}

function renderPresetSelect(selectedId, attribute) {
    return `
        <select class="stsm-summary-template-preset text_pole" ${attribute} aria-label="요약 레코드 내용 형식 프리셋">
            ${Object.entries(SUMMARY_CONTENT_TEMPLATE_PRESETS).map(([id, preset]) => (
        `<option value="${id}"${selectedId === id ? ' selected' : ''}>${preset.label}</option>`
    )).join('')}
            <option value="custom"${selectedId === 'custom' ? ' selected' : ' disabled'}>사용자 설정</option>
        </select>
    `;
}

function validateTemplate(template) {
    if (!String(template || '').trim()) throw new Error('요약 레코드 내용 템플릿은 비워둘 수 없습니다.');
    renderSummaryContentTemplate(template, {
        title: 'Preview',
        contextFlow: [{ date: 'Day 1', time: 'afternoon', location: 'garden' }],
        plot: ['Preview plot'],
        continuityChanges: ['Preview change'],
        emotions: [{ subject: 'char', toward: 'user', states: [{ emotion: 'curious', reason: 'preview' }] }],
        quotes: [{ speaker: 'char', text: 'Preview dialogue' }],
        tags: [{ canonical: 'preview', matchTerms: ['preview'] }],
    }, { startId: 0, endId: 1 });
}
