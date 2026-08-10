import {
    getExtensionState,
    setExtensionEnabled,
    subscribeExtensionState,
} from '../core/extension-state.js';

const ENABLED_EXECUTION_CONTROL_SELECTOR = [
    '#stsm-summarize',
    '#stsm-open-compression',
    '#stsm-open-atlas-review',
    '#stsm-hide-all-summarized',
    '.stsm-record-reroll',
].join(', ');

const TRANSLATION_CONTROL_SELECTOR = [
    '#stsm-translate-all',
    '.stsm-record-translate',
].join(', ');

const IDLE_CONTROL_SELECTOR = [
    ENABLED_EXECUTION_CONTROL_SELECTOR,
    TRANSLATION_CONTROL_SELECTOR,
    '#stsm-unhide-all-summarized',
    '#stsm-delete-all-translations',
    '.stsm-record-edit',
    '.stsm-record-save',
    '.stsm-record-chat',
    '.stsm-record-delete',
    '#stsm-adjust-record-ranges',
    '#stsm-export-chat-data',
    '#stsm-import-chat-data',
    '#stsm-reset-chat-data',
    '#stsm-export-global-settings',
    '#stsm-import-global-settings',
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
    const activeOperations = Array.isArray(state.operations)
        ? state.operations
        : state.operation ? [state.operation] : [];
    const canCancelSummary = activeOperations.some(item => item.type === 'summarizing');
    const isSummaryExecutionActive = activeOperations.some(item => (
        item.type === 'summarizing' || item.type === 'cancelling-summary'
    ));
    const face = root.querySelector('.stsm-extension-status-face');
    const enabled = root.querySelector('.stsm-extension-status-enabled');
    const operation = root.querySelector('.stsm-extension-status-operation');
    const toggle = root.querySelector('#stsm-extension-enabled');

    face.textContent = !state.enabled ? '－_－' : isWorking ? '•̀ᴗ•́' : '◕‿◕';
    enabled.textContent = state.enabled ? '켜짐' : '꺼짐';
    operation.textContent = `· ${state.operation?.label || '작업 없음'}`;
    toggle.checked = state.enabled;
    toggle.disabled = isWorking;
    const cancelSummary = root.querySelector('#stsm-cancel-summary');
    if (cancelSummary) {
        const summarize = root.querySelector('#stsm-summarize');
        summarize.hidden = isSummaryExecutionActive;
        cancelSummary.hidden = !isSummaryExecutionActive;
        cancelSummary.disabled = !canCancelSummary;
        cancelSummary.querySelector('span').textContent = canCancelSummary ? '중단' : '중단 중';
    }
    root.querySelector('.stsm-extension-status').classList.toggle('stsm-extension-status-off', !state.enabled);
    root.querySelector('.stsm-extension-status').classList.toggle('stsm-extension-status-working', isWorking);

    renderExtensionControls(root, state);
}

export function renderExtensionControls(root, state = getExtensionState()) {
    const activeOperations = Array.isArray(state.operations)
        ? state.operations
        : state.operation ? [state.operation] : [];
    const isWorking = activeOperations.length > 0;
    const canTranslate = state.enabled && activeOperations.every(operation => (
        operation.type === 'summarizing' || operation.type === 'translating'
    ));
    root.querySelectorAll(IDLE_CONTROL_SELECTOR).forEach(control => {
        if (control.matches(TRANSLATION_CONTROL_SELECTOR)) {
            control.disabled = !canTranslate;
            return;
        }
        const requiresEnabled = control.matches(ENABLED_EXECUTION_CONTROL_SELECTOR);
        control.disabled = isWorking || (requiresEnabled && !state.enabled);
    });
}
