import { getCoveredRanges } from './range-utils.js';
import { getSummaryRecords } from './summary-store.js';

export function renderSummaryStatus(root) {
    const chat = SillyTavern.getContext().chat;
    const messages = Array.isArray(chat) ? chat : [];
    const records = getSummaryRecords();
    const summarizedCount = countCoveredMessages(messages, getCoveredRanges(records));
    const lastSummaryId = records.length
        ? Math.max(...records.map(record => record.endId))
        : null;

    root.querySelector('#stsm-status-total').textContent = messages.length.toLocaleString();
    root.querySelector('#stsm-status-summarized').textContent = summarizedCount.toLocaleString();
    root.querySelector('#stsm-status-last-id').textContent = lastSummaryId === null ? '-' : `#${lastSummaryId}`;
}

function countCoveredMessages(messages, ranges) {
    let count = 0;
    for (const range of ranges) {
        const endId = Math.min(range.endId, messages.length - 1);
        for (let id = range.startId; id <= endId; id++) {
            if (messages[id]) count += 1;
        }
    }
    return count;
}
