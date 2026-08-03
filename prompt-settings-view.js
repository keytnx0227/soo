import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import {
    addPromptBlock,
    BLOCK_KINDS,
    createPresetFromActive,
    deleteActivePreset,
    getActivePreset,
    getPromptEditor,
    movePromptBlock,
    PROMPT_TYPES,
    removePromptBlock,
    resetActivePreset,
    saveSettingsNow,
    setActivePreset,
    setPromptBlockEnabled,
    updatePromptBlock,
} from './settings.js';
import { escapeHtml } from './utils.js';

const TYPE_LABELS = Object.freeze({
    [PROMPT_TYPES.SUMMARY]: '요약',
    [PROMPT_TYPES.REVISION]: '수정 대화',
});

export function bindPromptSettings(root) {
    for (const type of Object.values(PROMPT_TYPES)) {
        const container = root.querySelector(`[data-prompt-editor="${type}"]`);
        container.addEventListener('click', event => handleEditorClick(root, type, event));
        container.addEventListener('change', event => handleEditorChange(root, type, event));
        container.addEventListener('dragstart', event => handleDragStart(event));
        container.addEventListener('dragover', event => handleDragOver(event));
        container.addEventListener('drop', event => handleDrop(root, type, event));
        renderPromptEditor(root, type);
    }
}

export function renderPromptEditor(root, type) {
    const container = root.querySelector(`[data-prompt-editor="${type}"]`);
    const editor = getPromptEditor(type);
    const preset = getActivePreset(type);
    const defaultPresetId = type === PROMPT_TYPES.SUMMARY ? 'default-summary' : 'default-revision';

    container.innerHTML = `
        <div class="stsm-preset-toolbar">
            <select class="stsm-preset-select text_pole" aria-label="${TYPE_LABELS[type]} 프롬프트 프리셋">
                ${editor.presets.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === preset.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
            ${renderToolbarButton('save', 'fa-floppy-disk', '현재 프리셋 저장')}
            ${renderToolbarButton('add-preset', 'fa-plus', '새 프리셋 추가')}
            ${renderToolbarButton('delete-preset', 'fa-trash', '프리셋 삭제', preset.id === defaultPresetId || editor.presets.length <= 1)}
            ${renderToolbarButton('reset', 'fa-rotate-left', '현재 프리셋 초기화')}
            <button class="stsm-add-prompt menu_button interactable" data-action="add-block" type="button">프롬프트 추가</button>
        </div>
        <div class="stsm-block-list">
            ${preset.blocks.map(renderPromptBlock).join('')}
        </div>
    `;
}

function renderToolbarButton(action, icon, title, disabled = false) {
    return `
        <button class="menu_button menu_button_icon interactable" data-action="${action}" type="button" title="${title}" aria-label="${title}" ${disabled ? 'disabled' : ''}>
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}

function renderPromptBlock(block) {
    const editable = block.kind === BLOCK_KINDS.EDITABLE;
    return `
        <div class="stsm-block${editable ? '' : ' stsm-block-fixed'}" data-block-id="${escapeHtml(block.id)}" draggable="true">
            <div class="stsm-block-grip" title="드래그로 이동">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="stsm-block-main">
                <div class="stsm-block-title">${escapeHtml(block.name)}</div>
                <div class="stsm-block-preview">${escapeHtml(getBlockPreview(block))}</div>
            </div>
            <label class="stsm-switch" title="전송 여부">
                <input class="stsm-block-toggle" type="checkbox" ${block.enabled ? 'checked' : ''} />
                <span></span>
            </label>
            ${editable ? `
                <button class="stsm-block-edit menu_button menu_button_icon interactable" data-action="edit-block" type="button" title="수정" aria-label="수정">
                    <i class="fa-solid fa-pen"></i>
                </button>
            ` : ''}
            ${!block.locked ? `
                <button class="stsm-block-delete menu_button menu_button_icon interactable" data-action="delete-block" type="button" title="삭제" aria-label="삭제">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            ` : ''}
        </div>
    `;
}

function getBlockPreview(block) {
    const dynamicPreviews = {
        [BLOCK_KINDS.CHARACTER]: '현재 채팅의 캐릭터·페르소나 정보',
        [BLOCK_KINDS.WORLD_INFO]: '현재 채팅에서 활성화되는 월드 인포',
        [BLOCK_KINDS.SUMMARY_TARGET]: '현재 배치에서 처리 중인 채팅 청크',
        [BLOCK_KINDS.CURRENT_SUMMARY]: '선택한 요약 블록의 현재 내용',
        [BLOCK_KINDS.REVISION_HISTORY]: '현재 요약 블록의 수정 대화 내역',
    };
    return dynamicPreviews[block.kind] || block.content || '';
}

async function handleEditorClick(root, type, event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const blockId = button.closest('.stsm-block')?.dataset.blockId;

    if (action === 'save') {
        await saveSettingsNow();
        toastr.success('프리셋을 저장했습니다.');
        return;
    } else if (action === 'add-preset') {
        const name = await Popup.show.input('새 프리셋 이름', null, `${getActivePreset(type).name} 복사본`);
        if (!name?.trim()) return;
        createPresetFromActive(type, name);
        renderPromptEditor(root, type);
    } else if (action === 'delete-preset') {
        const preset = getActivePreset(type);
        if (!await Popup.show.confirm('현재 프리셋을 삭제할까요?', preset.name)) return;
        deleteActivePreset(type);
        renderPromptEditor(root, type);
    } else if (action === 'reset') {
        if (!await Popup.show.confirm('현재 프리셋을 기본 상태로 초기화할까요?', getActivePreset(type).name)) return;
        resetActivePreset(type);
        renderPromptEditor(root, type);
    } else if (action === 'add-block') {
        const values = await showPromptBlockPopup({ title: '프롬프트 추가', okButton: '추가' });
        if (!values) return;
        addPromptBlock(type, values.name, values.content);
        renderPromptEditor(root, type);
    } else if (action === 'edit-block') {
        const block = getActivePreset(type).blocks.find(item => item.id === blockId);
        if (!block) return;
        const values = await showPromptBlockPopup({ title: '프롬프트 수정', okButton: '수정하기', block });
        if (!values) return;
        updatePromptBlock(type, blockId, values);
        renderPromptEditor(root, type);
    } else if (action === 'delete-block') {
        const block = getActivePreset(type).blocks.find(item => item.id === blockId);
        if (!block || !await Popup.show.confirm('이 프롬프트를 삭제할까요?', block.name)) return;
        removePromptBlock(type, blockId);
        renderPromptEditor(root, type);
    }
    root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
}

function handleEditorChange(root, type, event) {
    if (event.target.classList.contains('stsm-preset-select')) {
        setActivePreset(type, event.target.value);
        renderPromptEditor(root, type);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
        return;
    }

    if (event.target.classList.contains('stsm-block-toggle')) {
        const blockId = event.target.closest('.stsm-block')?.dataset.blockId;
        setPromptBlockEnabled(type, blockId, event.target.checked);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
    }
}

function handleDragStart(event) {
    const block = event.target.closest('.stsm-block');
    if (!block) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', block.dataset.blockId);
}

function handleDragOver(event) {
    if (event.target.closest('.stsm-block')) event.preventDefault();
}

function handleDrop(root, type, event) {
    const target = event.target.closest('.stsm-block');
    if (!target) return;
    event.preventDefault();
    if (movePromptBlock(type, event.dataTransfer.getData('text/plain'), target.dataset.blockId)) {
        renderPromptEditor(root, type);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
    }
}

async function showPromptBlockPopup({ title, okButton, block = null }) {
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form';
    form.innerHTML = `
        <div class="stsm-section-title">${escapeHtml(title)}</div>
        <label class="stsm-field">
            <span>프롬프트 이름</span>
            <input class="stsm-block-name text_pole" type="text" />
        </label>
        <label class="stsm-field">
            <span>내용</span>
            <textarea class="stsm-block-content text_pole monospace" rows="10"></textarea>
        </label>
    `;
    form.querySelector('.stsm-block-name').value = block?.name || '';
    form.querySelector('.stsm-block-content').value = block?.content || '';

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton: '취소' });
    if (await popup.show() !== 1) return null;

    const name = form.querySelector('.stsm-block-name').value.trim();
    const content = form.querySelector('.stsm-block-content').value.trim();
    if (!name || !content) {
        toastr.info('프롬프트 이름과 내용을 모두 입력해주세요.');
        return null;
    }

    return { name, content };
}
