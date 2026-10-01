import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation, getExtensionState } from '../core/extension-state.js';
import { escapeHtml } from '../core/utils.js';
import { createPromptPresetBackup, downloadPromptPresetBackup, importPromptPresetBackup, readPromptPresetBackup } from './prompt-preset-transfer.js';

const LABELS = { summary: '요약', revision: '수정 대화', compression: '압축 요약' };
let importing = false;

export async function openPromptPresetExport(type) {
    try {
        const current = createPromptPresetBackup(type);
        const all = createPromptPresetBackup(type, { all: true });
        const form = document.createElement('div');
        form.className = 'stsm-preset-transfer-form';
        form.innerHTML = `<h3>프롬프트 프리셋 내보내기</h3>
            <label><input type="radio" name="stsm-preset-export-scope" value="current" checked /> 현재 프리셋 · ${escapeHtml(current.editors[type].presets[0].name)}</label>
            <label><input type="radio" name="stsm-preset-export-scope" value="all" /> 전체 프리셋 · ${countPresets(all)}개</label>`;
        const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '내보내기', cancelButton: '취소' }).show();
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        const backup = form.querySelector('input:checked').value === 'all' ? all : current;
        downloadPromptPresetBackup(backup);
        toastr.success(`프롬프트 프리셋 ${countPresets(backup)}개를 내보냈습니다.`);
    } catch (error) { reportError(error); }
}

export async function importPromptPresetFile(input, onImported) {
    const file = input.files?.[0];
    if (!file || importing) return;
    importing = true;
    let operationToken = null;
    try {
        assertAvailable();
        const backup = await readPromptPresetBackup(file);
        const count = countPresets(backup);
        const form = document.createElement('div');
        form.className = 'stsm-preset-transfer-form';
        form.innerHTML = `<h3>프리셋 ${count}개를 새 복사본으로 추가할까요?</h3>
            <ul>${Object.entries(backup.editors).flatMap(([type, editor]) => editor.presets.map(preset =>
                `<li><span>${LABELS[type]}</span><strong>${escapeHtml(preset.name)}</strong><small>블록 ${preset.blocks.length}개</small></li>`)).join('')}</ul>
            <label><input type="checkbox" data-activate-imported ${count === 1 ? 'checked' : ''} /> 가져온 프리셋 사용</label>`;
        const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '추가', cancelButton: '취소', allowVerticalScrolling: true }).show();
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        assertAvailable();
        operationToken = beginOperation('prompt-preset-import', '프롬프트 프리셋 가져오는 중', { requiresEnabled: false });
        await importPromptPresetBackup(backup, { activate: form.querySelector('[data-activate-imported]').checked });
        try { onImported(); }
        catch (error) {
            console.error('[Chat Summarizer] Imported presets saved, but refresh failed:', error);
            toastr.warning('프리셋은 저장됐지만 화면을 갱신하지 못했습니다. 설정창을 다시 열어주세요.');
            return;
        }
        toastr.success(`기존 프리셋을 유지하고 ${count}개를 추가했습니다.`);
    } catch (error) { reportError(error); }
    finally {
        if (operationToken) endOperation(operationToken);
        input.value = '';
        importing = false;
    }
}

function countPresets(backup) { return Object.values(backup.editors).reduce((sum, editor) => sum + editor.presets.length, 0); }
function assertAvailable() {
    const operation = getExtensionState().operation;
    if (operation) throw new Error(`${operation.label} 작업이 끝난 뒤 가져와주세요.`);
}
function reportError(error) {
    console.error('[Chat Summarizer] Prompt preset transfer failed:', error);
    toastr.error(error.message || '프롬프트 프리셋 파일을 처리하지 못했습니다.');
}
