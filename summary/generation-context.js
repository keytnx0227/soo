export function getGenerationSearchMessages(chat) {
    const messages = Array.isArray(chat) ? chat : [];
    const lastMessage = messages.at(-1);
    const generatingNewSwipe = Boolean(
        lastMessage
        && !lastMessage.is_user
        && Array.isArray(lastMessage.swipes)
        && Number.isInteger(lastMessage.swipe_id)
        && lastMessage.swipe_id >= lastMessage.swipes.length
    );

    return generatingNewSwipe ? messages.slice(0, -1) : messages;
}
