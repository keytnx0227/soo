const METADATA_KEY = 'sumi_chat_summarizer';
const PROMPT_STORAGE_VERSION = 1;

export async function removeLegacyStoredPrompts() {
    const context = SillyTavern.getContext();
    const metadata = context.chatMetadata;
    const current = metadata?.[METADATA_KEY];
    if (!current || typeof current !== 'object') return { removedCount: 0, removedBytes: 0 };
    if (Number(current.promptStorageVersion) >= PROMPT_STORAGE_VERSION) {
        return { removedCount: 0, removedBytes: 0 };
    }

    const before = getJsonByteSize(current);
    const next = structuredClone(current);
    let removedCount = 0;
    const removePrompt = value => {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'prompt')) return;
        delete value.prompt;
        removedCount += 1;
    };

    for (const record of Array.isArray(next.records) ? next.records : []) {
        removePrompt(record);
        for (const override of Object.values(record?.atlasReviewOverrides || {})) removePrompt(override);
    }
    for (const message of next.recentRevisionConversation?.messages || []) removePrompt(message);
    for (const review of next.atlas?.reviews || []) removePrompt(review);

    next.promptStorageVersion = PROMPT_STORAGE_VERSION;
    const after = getJsonByteSize(next);
    metadata[METADATA_KEY] = next;
    try {
        await context.saveMetadata();
    } catch (error) {
        metadata[METADATA_KEY] = current;
        throw error;
    }
    return { removedCount, removedBytes: Math.max(0, before - after) };
}

function getJsonByteSize(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
