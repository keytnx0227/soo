import { escapeHtml } from '../core/utils.js';
import { normalizeEmotionalWeight, normalizeFeelings } from './people-feelings.js';

export function renderFeelingEditor(values = []) {
    const feelings = normalizeFeelings(values);
    return `
        <div class="stsm-feeling-editor" data-feeling-editor>
            <div class="stsm-feeling-editor-heading">
                <span>감정</span>
                <button class="menu_button menu_button_icon interactable" data-add-feeling type="button" title="감정 추가" aria-label="감정 추가">
                    <i class="fa-solid fa-plus"></i>
                </button>
            </div>
            <div class="stsm-feeling-editor-list">
                ${feelings.map(renderFeelingRow).join('')}
            </div>
        </div>
    `;
}

export function handleFeelingEditorClick(event) {
    const addButton = event.target.closest('[data-add-feeling]');
    if (addButton) {
        addButton.closest('[data-feeling-editor]')
            ?.querySelector('.stsm-feeling-editor-list')
            ?.insertAdjacentHTML('beforeend', renderFeelingRow());
        return true;
    }
    const deleteButton = event.target.closest('[data-delete-feeling]');
    if (deleteButton) {
        deleteButton.closest('.stsm-feeling-editor-row')?.remove();
        return true;
    }
    return false;
}

export function readFeelingEditor(host) {
    if (!host) return [];
    return normalizeFeelings([...host.querySelectorAll('.stsm-feeling-editor-row')].map(row => ({
        text: row.querySelector('[data-feeling-text]')?.value,
        weight: normalizeEmotionalWeight(row.querySelector('[data-feeling-weight]')?.value),
    })));
}

function renderFeelingRow(value = {}) {
    const [feeling] = normalizeFeelings([value]);
    return `
        <div class="stsm-feeling-editor-row">
            <textarea class="text_pole" data-feeling-text rows="2" placeholder="지속되는 감정과 누적 맥락">${escapeHtml(feeling?.text || '')}</textarea>
            <input class="text_pole" data-feeling-weight type="number" min="0" step="0.1" inputmode="decimal" value="${feeling?.weight ?? ''}" placeholder="무게" title="상대 인식과 행동에 미치는 누적된 정서적 무게" aria-label="누적 감정 무게" />
            <button class="menu_button menu_button_icon interactable" data-delete-feeling type="button" title="감정 삭제" aria-label="감정 삭제">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}
