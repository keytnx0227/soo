import { saveChatConditional } from '../../../../../script.js';
import { hideChatMessageRange } from '../../../../../scripts/chats.js';
import { assertExtensionEnabled, isExtensionEnabled } from '../core/extension-state.js';
import {
    clearMessageAutoHiddenMarker,
    isMessageAutoHiddenBySummarizer,
    markMessageAutoHidden,
} from './message-visibility-state.js';
import { getCoveredRanges } from '../summary/range-utils.js';
import { getSettings } from '../core/settings.js';
import { getSummaryRecords } from '../summary/summary-store.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';

let operationQueue = Promise.resolve();
let isInitialized = false;

export function initializeMessageVisibility() {
    if (isInitialized) return;
    isInitialized = true;

    const context = SillyTavern.getContext();
    const synchronize = () => {
        queueOperation(() => synchronizeVisibilityIfEnabled()).catch(error => {
            console.error('[Chat Summarizer] Failed to synchronize message visibility:', error);
            addExtensionErrorLog(error, {
                operation: 'message-visibility',
                title: '백그라운드 자동 숨김 동기화 실패',
                message: '요약 메시지의 자동 숨김 상태를 동기화하지 못했습니다.',
            });
        });
    };

    context.eventSource.on(context.eventTypes.APP_READY, synchronize);
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, synchronize);
    window.addEventListener('stsm:records-changed', synchronize);
    synchronize();
}

export function syncSummarizedMessageVisibility() {
    return queueOperation(() => synchronizeVisibilityIfEnabled());
}

export function hideAllSummarizedMessages() {
    assertExtensionEnabled();
    return queueOperation(() => synchronizeVisibility());
}

export function unhideAllSummarizedMessages() {
    return queueOperation(() => unhideOwnedMessages());
}

function synchronizeVisibilityIfEnabled() {
    if (!isExtensionEnabled() || !getSettings().summarization.autoHideSummarizedMessages) {
        return { hidden: 0, unhidden: 0 };
    }
    return synchronizeVisibility();
}

async function synchronizeVisibility() {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    if (!Array.isArray(chat) || !chat.length) return { hidden: 0, unhidden: 0 };

    const coveredIds = getCoveredMessageIds(getSummaryRecords(), chat.length);
    const idsToHide = [];
    const idsToUnhide = [];
    let markerChangedWithoutVisibility = false;

    chat.forEach((message, id) => {
        if (!message) return;

        if (coveredIds.has(id)) {
            if (message.is_system) return;
            markMessageAutoHidden(message);
            idsToHide.push(id);
            return;
        }

        if (!clearMessageAutoHiddenMarker(message)) return;
        if (message.is_system) idsToUnhide.push(id);
        else markerChangedWithoutVisibility = true;
    });

    await applyVisibilityChanges(chat, idsToUnhide, true);
    await applyVisibilityChanges(chat, idsToHide, false);
    if (markerChangedWithoutVisibility && !idsToUnhide.length && !idsToHide.length && SillyTavern.getContext().chat === chat) {
        await saveChatConditional();
    }

    return { hidden: idsToHide.length, unhidden: idsToUnhide.length };
}

async function unhideOwnedMessages() {
    const chat = SillyTavern.getContext().chat;
    if (!Array.isArray(chat) || !chat.length) return { hidden: 0, unhidden: 0 };

    const idsToUnhide = [];
    let markerChangedWithoutVisibility = false;

    chat.forEach((message, id) => {
        if (!clearMessageAutoHiddenMarker(message)) return;
        if (message.is_system) idsToUnhide.push(id);
        else markerChangedWithoutVisibility = true;
    });

    await applyVisibilityChanges(chat, idsToUnhide, true);
    if (markerChangedWithoutVisibility && !idsToUnhide.length && SillyTavern.getContext().chat === chat) {
        await saveChatConditional();
    }

    return { hidden: 0, unhidden: idsToUnhide.length };
}

async function applyVisibilityChanges(chat, ids, unhide) {
    for (const range of groupContiguousIds(ids)) {
        if (SillyTavern.getContext().chat !== chat) return;
        await hideChatMessageRange(range.startId, range.endId, unhide);
    }
}

function getCoveredMessageIds(records, chatLength) {
    const ids = new Set();
    for (const range of getCoveredRanges(records)) {
        const endId = Math.min(range.endId, chatLength - 1);
        for (let id = range.startId; id <= endId; id++) ids.add(id);
    }
    return ids;
}

function groupContiguousIds(ids) {
    const sortedIds = [...ids].sort((left, right) => left - right);
    return sortedIds.reduce((ranges, id) => {
        const previous = ranges.at(-1);
        if (!previous || id > previous.endId + 1) {
            ranges.push({ startId: id, endId: id });
        } else {
            previous.endId = id;
        }
        return ranges;
    }, []);
}

function queueOperation(operation) {
    const queued = operationQueue.catch(() => undefined).then(operation);
    operationQueue = queued;
    return queued;
}
