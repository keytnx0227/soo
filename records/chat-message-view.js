import { isMessageAutoHiddenBySummarizer } from '../visibility/message-visibility-state.js';
import { escapeHtml } from '../core/utils.js';

export function collectChatRangeMessages(chat, startId, endId) {
    if (!Array.isArray(chat) || !Number.isInteger(startId) || !Number.isInteger(endId)) return [];

    const messages = [];
    for (let messageId = startId; messageId <= endId; messageId += 1) {
        const message = chat[messageId];
        if (!message) continue;
        messages.push({ messageId, message });
    }
    return messages;
}

export function renderChatMessage({ messageId, message }) {
    const isAutoHidden = isMessageAutoHiddenBySummarizer(message);
    const isSystem = message.is_system && !isAutoHidden;
    const role = isSystem ? 'System' : message.is_user ? 'User' : 'Assistant';
    const name = String(message.name || role);
    const content = String(message.mes || '');
    return `
        <article class="stsm-chat-message stsm-chat-message-${role.toLowerCase()}">
            <header>
                <strong>#${messageId}</strong>
                <span>${escapeHtml(name)}</span>
                <span>${role}</span>
                ${isSystem ? '<span>System 메시지</span>' : ''}
                ${isAutoHidden ? '<span>요약 확장 자동 숨김</span>' : ''}
            </header>
            <div>${content ? escapeHtml(content) : '<span class="stsm-chat-message-empty">빈 메시지</span>'}</div>
        </article>
    `;
}
