import { createId } from '../core/utils.js';

const MAX_ERROR_LOGS = 20;
const DUPLICATE_WINDOW_MS = 30000;

let errorLogs = [];
const listeners = new Set();

export function getExtensionErrorLogs() {
    return structuredClone(errorLogs);
}

export function addExtensionErrorLog(error, {
    operation = 'unknown',
    title = '확장 작업 실패',
    message = '',
    context = null,
} = {}) {
    if (error?.code === 'STSM_OPERATION_BLOCKED') return null;

    const batch = error?.summaryBatch;
    const reason = getErrorMessage(error?.cause) || getErrorMessage(error) || '알 수 없는 오류';
    const entry = {
        id: createId('error'),
        operation: String(operation || 'unknown'),
        title: String(title || '확장 작업 실패'),
        message: String(message || error?.message || reason),
        reason,
        occurredAt: Date.now(),
        read: false,
        batch: batch ? structuredClone(batch) : null,
        context: context ? structuredClone(context) : null,
        repeatCount: 1,
    };

    const duplicateIndex = errorLogs.findIndex(log => log.operation === entry.operation
        && log.title === entry.title
        && log.reason === entry.reason
        && entry.occurredAt - log.occurredAt <= DUPLICATE_WINDOW_MS);
    if (duplicateIndex >= 0) {
        const duplicate = errorLogs[duplicateIndex];
        entry.id = duplicate.id;
        entry.repeatCount = (duplicate.repeatCount || 1) + 1;
        errorLogs = [entry, ...errorLogs.filter((_, index) => index !== duplicateIndex)];
        notifyListeners();
        return structuredClone(entry);
    }

    errorLogs = [entry, ...errorLogs].slice(0, MAX_ERROR_LOGS);
    notifyListeners();
    return structuredClone(entry);
}

function getErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    return String(error.message || error.response || error.statusText || '');
}

export function markExtensionErrorLogsRead() {
    if (!errorLogs.some(log => !log.read)) return;
    errorLogs = errorLogs.map(log => ({ ...log, read: true }));
    notifyListeners();
}

export function removeExtensionErrorLog(errorId) {
    const nextLogs = errorLogs.filter(log => log.id !== String(errorId));
    if (nextLogs.length === errorLogs.length) return;
    errorLogs = nextLogs;
    notifyListeners();
}

export function clearExtensionErrorLogs() {
    if (!errorLogs.length) return;
    errorLogs = [];
    notifyListeners();
}

export function subscribeExtensionErrorLogs(listener) {
    listeners.add(listener);
    listener(getExtensionErrorLogs());
    return () => listeners.delete(listener);
}

function notifyListeners() {
    const snapshot = getExtensionErrorLogs();
    listeners.forEach(listener => listener(snapshot));
}
