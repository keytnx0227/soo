import { getSettings, setExtensionEnabled as saveExtensionEnabled } from './settings.js';

const listeners = new Set();

let operation = null;

export function getExtensionState() {
    return {
        enabled: Boolean(getSettings().enabled),
        operation: operation ? { type: operation.type, label: operation.label } : null,
    };
}

export function isExtensionEnabled() {
    return getExtensionState().enabled;
}

export function setExtensionEnabled(enabled) {
    if (operation) throw createControlError('작업 중에는 확장을 켜거나 끌 수 없습니다.');
    saveExtensionEnabled(enabled);
    notifyStateChanged();
    return getExtensionState();
}

export function beginOperation(type, label) {
    assertExtensionEnabled();
    if (operation) throw createControlError(`이미 ${operation.label} 작업이 진행 중입니다.`);

    const token = Symbol(type);
    operation = {
        token,
        type: String(type || 'working'),
        label: String(label || '작업 중'),
    };
    notifyStateChanged();
    return token;
}

export function updateOperation(token, label) {
    if (!operation || operation.token !== token) return false;
    operation = { ...operation, label: String(label || '작업 중') };
    notifyStateChanged();
    return true;
}

export function endOperation(token) {
    if (!operation || operation.token !== token) return false;
    operation = null;
    notifyStateChanged();
    return true;
}

export function assertExtensionEnabled() {
    if (!isExtensionEnabled()) throw createControlError('요약 확장이 꺼져 있습니다.');
}

function createControlError(message) {
    const error = new Error(message);
    error.code = 'STSM_OPERATION_BLOCKED';
    return error;
}

export function subscribeExtensionState(listener) {
    listeners.add(listener);
    listener(getExtensionState());
    return () => listeners.delete(listener);
}

function notifyStateChanged() {
    const state = getExtensionState();
    for (const listener of listeners) {
        try {
            listener(state);
        } catch (error) {
            console.error('[Chat Summarizer] Extension state listener failed:', error);
        }
    }
}
