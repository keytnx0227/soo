import { syncSummarizedMessageVisibility, unhideAllSummarizedMessages } from '../visibility/message-visibility.js';

const METADATA_KEY = 'sumi_chat_summarizer';
const BACKUP_FORMAT = 'sumi-chat-summarizer-backup';
const BACKUP_VERSION = 1;

export function createCurrentChatBackup() {
    const { metadata } = getCurrentChatContext();
    const storedData = metadata[METADATA_KEY];
    const data = isPlainObject(storedData) ? structuredClone(storedData) : { records: [] };

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data,
    };
}

export function downloadCurrentChatBackup() {
    const backup = createCurrentChatBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sumi-chat-backup-${formatFileTimestamp(new Date())}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return backup;
}

export async function readChatBackup(file) {
    if (!file || typeof file.text !== 'function') throw new Error('가져올 JSON 파일을 선택해주세요.');

    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        throw new Error('백업 파일이 올바른 JSON 형식이 아닙니다.');
    }

    if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT) {
        throw new Error('Sumi 요약 백업 파일이 아닙니다.');
    }
    if (parsed.version !== BACKUP_VERSION) {
        throw new Error(`지원하지 않는 백업 버전입니다. (버전 ${String(parsed.version ?? '없음')})`);
    }

    return {
        backup: parsed,
        data: validateChatData(parsed.data),
        recordCount: parsed.data.records.length,
    };
}

export async function importCurrentChatBackup(data) {
    await replaceCurrentChatData(validateChatData(data));
}

export async function resetCurrentChatData() {
    await replaceCurrentChatData(null);
}

async function replaceCurrentChatData(nextData) {
    const { context, chat, metadata } = getCurrentChatContext();
    const hadPreviousData = Object.hasOwn(metadata, METADATA_KEY);
    const previousData = hadPreviousData ? structuredClone(metadata[METADATA_KEY]) : undefined;

    try {
        await unhideAllSummarizedMessages();
    } catch (error) {
        await restoreVisibilityBestEffort();
        throw error;
    }
    assertSameChat(context, chat, metadata);

    if (nextData === null) delete metadata[METADATA_KEY];
    else metadata[METADATA_KEY] = structuredClone(nextData);

    try {
        await context.saveMetadata();
    } catch (error) {
        if (hadPreviousData) metadata[METADATA_KEY] = previousData;
        else delete metadata[METADATA_KEY];
        await restoreVisibilityBestEffort();
        throw error;
    }

    window.dispatchEvent(new CustomEvent('stsm:records-changed'));
}

function validateChatData(value) {
    if (!isPlainObject(value) || !Array.isArray(value.records)) {
        throw new Error('백업 파일에 유효한 요약 기록 데이터가 없습니다.');
    }
    if (value.records.some(record => !isPlainObject(record))) {
        throw new Error('백업 파일의 요약 기록 형식이 올바르지 않습니다.');
    }
    if (value.atlas !== undefined && !isPlainObject(value.atlas)) {
        throw new Error('백업 파일의 도감 데이터 형식이 올바르지 않습니다.');
    }
    if (value.recentRevisionConversation !== undefined
        && value.recentRevisionConversation !== null
        && !isPlainObject(value.recentRevisionConversation)) {
        throw new Error('백업 파일의 최근 수정 대화 형식이 올바르지 않습니다.');
    }
    return structuredClone(value);
}

function getCurrentChatContext() {
    const context = SillyTavern.getContext();
    if (!Array.isArray(context.chat) || !isPlainObject(context.chatMetadata)) {
        throw new Error('현재 열린 채팅방이 없습니다.');
    }
    return { context, chat: context.chat, metadata: context.chatMetadata };
}

function assertSameChat(context, chat, metadata) {
    if (context.chat !== chat || context.chatMetadata !== metadata) {
        throw new Error('작업 중 채팅방이 변경되어 데이터 변경을 취소했습니다.');
    }
}

async function restoreVisibilityBestEffort() {
    try {
        window.dispatchEvent(new CustomEvent('stsm:records-changed'));
        await syncSummarizedMessageVisibility();
    } catch (error) {
        console.error('[Chat Summarizer] Failed to restore message visibility after metadata rollback:', error);
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatFileTimestamp(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}
