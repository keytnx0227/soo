import { escapeHtml } from '../core/utils.js';

export function renderExcludedAtlasEntries(entries, { open = false } = {}) {
    if (!Array.isArray(entries) || !entries.length) return '';
    return `
        <details class="stsm-atlas-excluded" ${open ? 'open' : ''}>
            <summary>
                <span><i class="fa-solid fa-trash-can" aria-hidden="true"></i> 삭제된 항목</span>
                <span>${entries.length.toLocaleString()}개</span>
            </summary>
            <div class="stsm-atlas-excluded-list">
                ${entries.map(renderExcludedEntry).join('')}
            </div>
        </details>
    `;
}

function renderExcludedEntry(entry) {
    const name = entry.name || entry.title || entry.id;
    return `
        <div class="stsm-atlas-excluded-entry" data-entity-id="${escapeHtml(entry.id)}">
            <span>
                <strong>${escapeHtml(name)}</strong>
                <code>${escapeHtml(entry.id)}</code>
            </span>
            <button class="menu_button menu_button_icon interactable" data-atlas-action="restore" type="button" title="도감에 복원" aria-label="도감에 복원">
                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
            </button>
        </div>
    `;
}
