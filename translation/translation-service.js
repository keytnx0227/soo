import { translate } from '../../../../../scripts/extensions/translate/index.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import {
    clearAllSummaryTranslations,
    getSummaryRecord,
    getSummaryRecords,
    setSummaryRecordTranslation,
} from '../summary/summary-store.js';

export async function translateSummaryRecord(recordId) {
    assertExtensionEnabled();
    const sourceChat = SillyTavern.getContext().chat;
    const record = getSummaryRecord(recordId);
    if (!record) throw new Error('번역할 요약 기록을 찾지 못했습니다.');

    const settings = getSettings().translation;
    const content = await translate(record.content, settings.targetLanguage, settings.provider);
    if (!String(content || '').trim()) {
        throw new Error('번역 결과가 비어 있습니다.');
    }

    if (SillyTavern.getContext().chat !== sourceChat) {
        throw new Error('번역 중 채팅방이 변경되어 결과를 저장하지 않았습니다.');
    }

    const updatedRecord = await setSummaryRecordTranslation(record.id, {
        content,
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
        translatedAt: new Date().toISOString(),
    });
    if (!updatedRecord) throw new Error('번역 결과를 저장할 요약 기록을 찾지 못했습니다.');
    return updatedRecord;
}

export async function translateAllSummaryRecords({ onProgress } = {}) {
    const settings = getSettings().translation;
    const records = getSummaryRecords();
    const targets = records.filter(record => !translationMatches(record.translation, settings));
    const failures = [];
    let translated = 0;

    for (let index = 0; index < targets.length; index += 1) {
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
