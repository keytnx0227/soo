import { isMessageAutoHiddenBySummarizer } from '../visibility/message-visibility-state.js';

export function createSummaryChunks(chat, start, end, chunkSize) {
    const chunks = [];

    for (let chunkStart = start; chunkStart <= end; chunkStart += chunkSize) {
        const chunkEnd = Math.min(end, chunkStart + chunkSize - 1);
        const messages = [];

        for (let id = chunkStart; id <= chunkEnd; id += 1) {
            messages.push({ id, message: chat[id] });
        }

        if (messages.some(({ message }) => message
            && (!message.is_system || isMessageAutoHiddenBySummarizer(message))
            && String(message.mes || '').trim())) {
            chunks.push({ startId: chunkStart, endId: chunkEnd, messages });
        }
    }

    return chunks;
}
