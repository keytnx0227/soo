import { translate } from '../../../../../scripts/extensions/translate/index.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import {
    clearAllSummaryTranslations,
    getSummaryRecord,
    getSummaryRecords,
    setSummaryRecordTranslation,
} from '../summary/summary-store.js';

export async function translateSummaryRecord(recordId, { signal, expectedContent, expectedOwner } = {}) {
    assertExtensionEnabled();
    const sourceChat = SillyTavern.getContext().chat;
    const sourceMetadata = SillyTavern.getContext().chatMetadata;
    const sourceStore = sourceMetadata?.sumi_chat_summarizer;
    const discard = () => {
        const error = new Error('번역 대상이 변경되었거나 작업이 중단되어 번역을 적용하지 않았습니다.');
        error.code = 'STSM_TRANSLATION_DISCARDED';
        return error;
    };
    if (signal?.aborted || (expectedOwner && (sourceChat !== expectedOwner.chat
        || sourceMetadata !== expectedOwner.metadata || sourceStore !== expectedOwner.store))) throw discard();
    const record = getSummaryRecord(recordId);
    if (!record) {
        if (expectedOwner) throw discard();
        throw new Error('번역할 요약 기록을 찾지 못했습니다.');
    }
    if (expectedContent !== undefined && record.content !== expectedContent) throw discard();

    const settings = getSettings().translation;
    const content = await translate(record.content, settings.targetLanguage, settings.provider);
    if (!String(content || '').trim()) {
        throw new Error('번역 결과가 비어 있습니다.');
    }

    const currentContext = SillyTavern.getContext();
    if (signal?.aborted || currentContext.chat !== sourceChat || currentContext.chatMetadata !== sourceMetadata
        || currentContext.chatMetadata?.sumi_chat_summarizer !== sourceStore) throw discard();
    const currentRecord = getSummaryRecord(recordId);
    if (!currentRecord || currentRecord.content !== record.content) throw discard();

    const updatedRecord = await setSummaryRecordTranslation(record.id, {
        content,
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
        translatedAt: new Date().toISOString(),
    });
    if (!updatedRecord) throw new Error('번역 결과를 저장할 요약 기록을 찾지 못했습니다.');
    return updatedRecord;
}

export async function translateAllSummaryRecords({ onProgress, signal } = {}) {
    const settings = getSettings().translation;
    const records = getSummaryRecords();
    const targets = records.filter(record => !translationMatches(record.translation, settings));
    const failures = [];
    let translated = 0;

    for (let index = 0; index < targets.length; index += 1) {
        if (signal?.aborted) break;
        const record = targets[index];
        onProgress?.({ current: index + 1, total: targets.length, record });
        try {
            await translateSummaryRecord(record.id);
            translated += 1;
        } catch (error) {
            failures.push({ record, error });
        }
    }

    return {
        translated,
        skipped: records.length - targets.length,
        failures,
        total: records.length,
        cancelled: Boolean(signal?.aborted),
        remaining: Math.max(0, targets.length - translated - failures.length),
    };
}

export async function deleteAllSummaryTranslations() {
    return await clearAllSummaryTranslations();
}

function translationMatches(translation, settings) {
    return Boolean(
        translation?.content
        && translation.provider === settings.provider
        && translation.targetLanguage === settings.targetLanguage
    );
}
