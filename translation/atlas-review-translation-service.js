import { translate } from '../../../../../scripts/extensions/translate/index.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';

export async function translateAtlasReviewChanges(changes) {
    assertExtensionEnabled();
    const sourceChat = SillyTavern.getContext().chat;
    const source = serializeAtlasReviewChanges(changes);
    if (!source) throw new Error('번역할 도감 재검토 변경사항이 없습니다.');

    const settings = getSettings().translation;
    const content = await translate(source, settings.targetLanguage, settings.provider);
    if (!String(content || '').trim()) throw new Error('번역 결과가 비어 있습니다.');
    if (SillyTavern.getContext().chat !== sourceChat) {
        throw new Error('번역 중 채팅방이 변경되어 결과를 사용하지 않았습니다.');
    }

    return {
        content: String(content).trim(),
        provider: settings.provider,
        targetLanguage: settings.targetLanguage,
    };
}

function serializeAtlasReviewChanges(changes) {
    return [
        ...serializeGroup('CREATED', changes?.created),
        ...serializeGroup('UPDATED', changes?.updated),
        ...serializeGroup('REMOVED', changes?.removed),
    ].join('\n\n');
}

function serializeGroup(label, entries) {
    return (Array.isArray(entries) ? entries : []).map(entry => [
        `## ${label}: ${entry.name}`,
        JSON.stringify(entry.value, null, 2),
    ].join('\n'));
}
