import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    getCompressionContentTemplate,
    getCompressionContentTemplatePreset,
    resetCompressionContentTemplate,
    setCompressionContentTemplate,
    setCompressionContentTemplatePreset,
} from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import {
    COMPRESSION_CONTENT_TEMPLATE_PRESETS,
    COMPRESSION_CONTENT_TEMPLATE_MACROS,
    getCompressionContentTemplatePresetId,
    renderCompressionSummary,
} from './compression-format.js';

export function bindCompressionTemplateSettings(root) {
    const container = root.querySelector('#stsm-compression-content-template');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.addEventListener('click', event => handleClick(root, event));
    container.addEventListener('change', event => handlePresetChange(root, event));
    renderCompressionTemplateSettings(root);
}

export function renderCompressionTemplateSettings(root) {
    const container = root.querySelector('#stsm-compression-content-template');
    if (!container) return;
    const preview = String(getCompressionContentTemplate()).split(/\r?\n/).find(line => line.trim())?.trim() || '빈 템플릿';
    const presetId = getCompressionContentTemplatePreset();
    container.innerHTML = `
        <div class="stsm-context-block stsm-summary-content-template-block">
            <div class="stsm-context-block-main">
                <strong>구조화 압축 → 레코드 내용</strong>
                ${renderPresetSelect(presetId, 'data-compression-template-preset')}
                <span>${escapeHtml(preview)}</span>
            </div>
            <div class="stsm-summary-template-actions">
                <button class="menu_button menu_button_icon interactable" data-compression-template-action="edit" type="button" title="압축 레코드 내용 형식 수정" aria-label="압축 레코드 내용 형식 수정">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="menu_button menu_button_icon interactable" data-compression-template-action="reset" type="button" title="기본 형식으로 초기화" aria-label="압축 레코드 내용 형식 초기화">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        </div>
    `;
}

function handlePresetChange(root, event) {
    const select = event.target.closest('[data-compression-template-preset]');
    if (!select || select.value === 'custom') return;
    setCompressionContentTemplatePreset(select.value);
    renderCompressionTemplateSettings(root);
    notifyRenderingChanged();
    toastr.success(`압축 레코드 형식을 ${COMPRESSION_CONTENT_TEMPLATE_PRESETS[select.value].label}으로 변경했습니다.`);
}

async function handleClick(root, event) {
    const action = event.target.closest('[data-compression-template-action]')?.dataset.compressionTemplateAction;
    if (action === 'edit') await editTemplate(root);
    if (action === 'reset') await resetTemplate(root);
}

async function editTemplate(root) {
    const form = document.createElement('div');
    form.className = 'stsm-context-template-editor';
    form.innerHTML = `
        <div class="stsm-section-title">압축 요약 레코드 내용 형식</div>
        <label class="stsm-field">
            <span>프리셋</span>
            ${renderPresetSelect(getCompressionContentTemplatePreset(), 'data-compression-content-template-preset')}
        </label>
        <label class="stsm-field">
            <span>내용 템플릿</span>
            <textarea class="text_pole monospace" data-compression-content-template rows="18"></textarea>
        </label>
        <details class="stsm-record-template-help" open>
            <summary>매크로와 반복 문법</summary>
            <div class="stsm-record-template-macros">
                ${COMPRESSION_CONTENT_TEMPLATE_MACROS.map(([name, description]) => `<div><code>{{${name}}}</code><span>${escapeHtml(description)}</span></div>`).join('')}
            </div>
            <div class="stsm-template-syntax-help">
                <p><code>{{#이름}}...{{/이름}}</code> 값 또는 배열이 있을 때 출력하며 배열은 항목마다 반복합니다.</p>
                <p><code>{{^이름}}...{{/이름}}</code> 값이 비어 있을 때 출력합니다.</p>
            </div>
        </details>
    `;
    const textarea = form.querySelector('[data-compression-content-template]');
    const preset = form.querySelector('[data-compression-content-template-preset]');
    textarea.value = getCompressionContentTemplate();
    preset.addEventListener('change', () => {
        if (preset.value !== 'custom') textarea.value = COMPRESSION_CONTENT_TEMPLATE_PRESETS[preset.value].template;
    });
    textarea.addEventListener('input', () => {
        preset.value = getCompressionContentTemplatePresetId(textarea.value);
    });
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '수정하기',
        cancelButton: '취소',
        wide: true,
    });
    if (await popup.show() !== 1) return;
    try {
        validateTemplate(textarea.value);
        setCompressionContentTemplate(textarea.value);
        renderCompressionTemplateSettings(root);
        notifyRenderingChanged();
        toastr.success('압축 레코드 내용 형식을 수정했습니다.');
    } catch (error) {
        toastr.error(error.message || '압축 레코드 내용 형식이 올바르지 않습니다.');
    }
}

async function resetTemplate(root) {
    if (!await Popup.show.confirm('압축 레코드 내용 형식을 초기화할까요?', '기본 압축 형식으로 복원합니다.')) return;
    resetCompressionContentTemplate();
    renderCompressionTemplateSettings(root);
    notifyRenderingChanged();
    toastr.success('압축 레코드 내용 형식을 초기화했습니다.');
}

function notifyRenderingChanged() {
    window.dispatchEvent(new CustomEvent('stsm:record-content-template-applied'));
}

function renderPresetSelect(selectedId, attribute) {
    return `
        <select class="stsm-summary-template-preset text_pole" ${attribute} aria-label="압축 레코드 내용 형식 프리셋">
            ${Object.entries(COMPRESSION_CONTENT_TEMPLATE_PRESETS).map(([id, preset]) => (
        `<option value="${id}"${selectedId === id ? ' selected' : ''}>${preset.label}</option>`
    )).join('')}
            <option value="custom"${selectedId === 'custom' ? ' selected' : ' disabled'}>사용자 설정</option>
        </select>
    `;
}

function validateTemplate(template) {
    if (!String(template || '').trim()) throw new Error('압축 레코드 내용 템플릿은 비워둘 수 없습니다.');
    renderCompressionSummary({
        contextFlow: [{ date: 'Day 1', time: 'afternoon', location: 'garden' }],
        plot: ['Preview plot'],
        emotions: [{ subject: 'char', trajectory: ['wary', 'trust'], reason: 'shared experience' }],
        quotes: [{ speaker: 'char', text: 'Preview dialogue' }],
    }, { startId: 0, endId: 9, template });
}
