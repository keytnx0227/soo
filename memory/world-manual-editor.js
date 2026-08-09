import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import {
    addManualWorldEntry,
    deleteManualWorldEntry,
    getManualWorldEntries,
    updateManualWorldEntry,
} from './atlas-metadata.js';

export async function showManualWorldEntryEditor(entityId = null) {
    const current = entityId
        ? getManualWorldEntries().find(entry => entry.id === String(entityId))
        : null;
    if (entityId && !current) throw new Error('수정할 직접 추가 세계 설정을 찾지 못했습니다.');

    const form = document.createElement('div');
    form.className = 'stsm-atlas-editor stsm-world-manual-editor';
    form.innerHTML = `
        <div class="stsm-section-title">세계 설정 ${current ? '수정' : '직접 추가'}</div>
        <div class="stsm-atlas-editor-fields">
            <label class="stsm-atlas-editor-field">
                <span class="stsm-atlas-editor-field-heading"><strong>키</strong></span>
                <textarea class="text_pole" data-world-manual-keys rows="4" placeholder="한 줄에 하나씩 입력">${escapeHtml((current?.keys || []).join('\n'))}</textarea>
            </label>
            <label class="stsm-atlas-editor-field">
                <span class="stsm-atlas-editor-field-heading"><strong>내용</strong></span>
                <textarea class="text_pole" data-world-manual-content rows="6" placeholder="이야기에서 유지할 세계 설정">${escapeHtml(current?.content || '')}</textarea>
            </label>
        </div>
    `;

    const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: current ? '수정하기' : '추가',
        cancelButton: '취소',
    }).show();
    if (result !== 1) return false;

    const keys = parseKeys(form.querySelector('[data-world-manual-keys]').value);
    const content = String(form.querySelector('[data-world-manual-content]').value || '').trim();
    if (!keys.length) throw new Error('세계 설정의 키를 하나 이상 입력해주세요.');
    if (!content) throw new Error('세계 설정의 내용을 입력해주세요.');

    if (current) await updateManualWorldEntry(current.id, { keys, content });
    else await addManualWorldEntry({ keys, content });
    return true;
}

export async function confirmDeleteManualWorldEntry(entityId, label) {
    if (!await Popup.show.confirm(
        '직접 추가한 세계 설정을 삭제하시겠습니까?',
        `${label}\n이 항목은 완전히 삭제되며 삭제 목록에서 복원할 수 없습니다.`,
    )) return false;
    return await deleteManualWorldEntry(entityId);
}

function parseKeys(value) {
    const result = [];
    const seen = new Set();
    for (const item of String(value || '').split(/\r?\n/)) {
        const text = item.trim();
        const identity = text.normalize('NFKC').toLocaleLowerCase();
        if (!text || seen.has(identity)) continue;
        seen.add(identity);
        result.push(text);
    }
    return result;
}
