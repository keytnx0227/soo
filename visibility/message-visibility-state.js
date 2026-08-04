const AUTO_HIDDEN_KEY = 'sumi_chat_summarizer_auto_hidden';

export function isMessageAutoHiddenBySummarizer(message) {
    return Boolean(message?.extra?.[AUTO_HIDDEN_KEY]);
}

export function markMessageAutoHidden(message) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[AUTO_HIDDEN_KEY] = true;
}

export function clearMessageAutoHiddenMarker(message) {
    if (!isMessageAutoHiddenBySummarizer(message)) return false;
    delete message.extra[AUTO_HIDDEN_KEY];
    return true;
}
