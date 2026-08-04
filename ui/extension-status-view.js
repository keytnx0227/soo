import {
    getExtensionState,
    setExtensionEnabled,
    subscribeExtensionState,
} from '../core/extension-state.js';

const ENABLED_EXECUTION_CONTROL_SELECTOR = [
    '#stsm-summarize',
    '#stsm-hide-all-summarized',
    '#stsm-translate-all',
    '.stsm-record-translate',
    '.stsm-record-reroll',
].join(', ');

const IDLE_CONTROL_SELECTOR = [
    ENABLED_EXECUTION_CONTROL_SELECTOR,
    '#stsm-unhide-all-summarized',
    '#stsm-delete-all-translations',
    '.stsm-record-edit',
    '.stsm-record-save',
    '.stsm-record-chat',
    '.stsm-record-delete',
    '#stsm-adjust-record-ranges',
].join(', ');

export function bindExtensionStatus(root, onEnabledChanged) {
    const toggle = root.querySelector('#stsm-extension-enabled');
    const render = state => renderExtensionStatus(root, state);
    const unsubscribe = subscribeExtensionState(render);
    const handleRecordsRendered = () => render(getExtensionState());

    toggle.addEventListener('change', async event => {
        try {
            const state = setExtensionEnabled(event.target.checked);
            await onEnabledChanged?.(state.enabled);
        } catch (error) {
            toastr.info(error.message || '확장 상태를 변경하지 못했습니다.');
            render(getExtensionState());
        }
    });
    root.addEventListener('stsm:records-rendered', handleRecordsRendered);

    return () => {
        unsubscribe();
        root.removeEventListener('stsm:records-rendered', handleRecordsRendered);
    };
}

export function renderExtensionStatus(root, state = getExtensionState()) {
    const isWorking = Boolean(state.operation);
    const face = root.querySelector('.stsm-extension-status-face');
    const enabled = root.querySelector('.stsm-extension-status-enabled');
    const operation = root.querySelector('.stsm-extension-status-operation');
    const toggle = root.querySelector('#stsm-extension-enabled');

    face.textContent = !state.enabled ? '－_－' : isWorking ? '•̀ᴗ•́' : '◕‿◕';
    enabled.textContent = state.enabled ? '켜짐' : '꺼짐';
    operation.textContent = `· ${state.operation?.label || '작업 없음'}`;
    toggle.checked = state.enabled;
    toggle.disabled = isWorking;
    root.querySelector('.stsm-extension-status').classList.toggle('stsm-extension-status-off', !state.enabled);
    root.querySelector('.stsm-extension-status').classList.toggle('stsm-extension-status-working', isWorking);

    root.querySelectorAll(IDLE_CONTROL_SELECTOR).forEach(control => {
        const requiresEnabled = control.matches(ENABLED_EXECUTION_CONTROL_SELECTOR);
        control.disabled = isWorking || (requiresEnabled && !state.enabled);
    });
}
