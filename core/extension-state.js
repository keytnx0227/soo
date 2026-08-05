import { getSettings, setExtensionEnabled as saveExtensionEnabled } from './settings.js';

const listeners = new Set();

const operations = new Map();

export function getExtensionState() {
    const activeOperations = [...operations.values()].map(({ type, label }) => ({ type, label }));
    return {
        enabled: Boolean(getSettings().enabled),
        operation: activeOperations[0] || null,
        operations: activeOperations,
    };
}

export function isExtensionEnabled() {
    return getExtensionState().enabled;
}

export function setExtensionEnabled(enabled) {
    if (operations.size) throw createControlError('작업 중에는 확장을 켜거나 끌 수 없습니다.');
    saveExtensionEnabled(enabled);
    notifyStateChanged();
    return getExtensionState();
}

export function beginOperation(type, label) {
    assertExtensionEnabled();
    const normalizedType = String(type || 'working');
    const activeOperations = [...operations.values()];
    const canRunConcurrently = normalizedType === 'translating'
        && activeOperations.every(item => item.type === 'summarizing' || item.type === 'translating');
    if (activeOperations.length && !canRunConcurrently) {
        throw createControlError(`이미 ${activeOperations[0].label} 작업이 진행 중입니다.`);
    }

    const token = Symbol(normalizedType);
    operations.set(token, {
        type: normalizedType,
        label: String(label || '작업 중'),
    });
    notifyStateChanged();
    return token;
}

export function updateOperation(token, label, type = null) {
    const operation = operations.get(token);
    if (!operation) return false;
    operations.set(token, {
        ...operation,
        type: type === null ? operation.type : String(type || 'working'),
        label: String(label || '작업 중'),
    });
    notifyStateChanged();
    return true;
}

export function endOperation(token) {
    if (!operations.delete(token)) return false;
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
