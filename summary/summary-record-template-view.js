import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    getSummaryContentTemplate,
    getSummaryContentTemplatePreset,
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
    notifyRenderingChanged();
    toastr.success(`요약 레코드 형식을 ${SUMMARY_CONTENT_TEMPLATE_PRESETS[select.value].label}으로 변경했습니다.`);
}

async function handleClick(root, event) {
    const action = event.target.closest('[data-summary-template-action]')?.dataset.summaryTemplateAction;
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
        notifyRenderingChanged();
        toastr.success('요약 레코드 내용 형식을 수정했습니다.');
    } catch (error) {
        toastr.error(error.message || '요약 레코드 내용 형식이 올바르지 않습니다.');
    }
}

async function resetTemplate(root) {
    if (!await Popup.show.confirm('요약 레코드 내용 형식을 초기화할까요?', '기본 간략 버전으로 복원합니다.')) return;
    resetSummaryContentTemplate();
    renderSummaryRecordTemplateSettings(root);
    notifyRenderingChanged();
    toastr.success('요약 레코드 내용 형식을 초기화했습니다.');
}

function notifyRenderingChanged() {
    window.dispatchEvent(new CustomEvent('stsm:record-content-template-applied'));
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
