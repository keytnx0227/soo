import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { copyText } from '../../../../scripts/utils.js';
import { bindConnectionSettings } from './connection-settings-view.js';
import { buildPopup } from './popup-template.js';
import { bindPromptSettings } from './prompt-settings-view.js';
import { bindPromptInspector } from './prompt-inspector.js';
import { bindRecordsView, renderSummaryRecords } from './records-view.js';
import { clearRevisionSession, openRevisionChat } from './revision-chat-view.js';
import { getSettings, setChunkSize, setSummarizationSettings, setTranslationSettings } from './settings.js';
import { initializeSummaryContext, refreshSummaryInjection } from './summary-context.js';
import { regenerateSummaryRecord, summarizeRange } from './summary-service.js';
import { deleteSummaryRecord, getSummaryRecords, updateSummaryRecordContent } from './summary-store.js';
import {
    deleteAllSummaryTranslations,
    translateAllSummaryRecords,
    translateSummaryRecord,
} from './translation-service.js';

let isMenuReady = false;
let popup = null;
let currentRoot = null;
let isSummarizing = false;
let isTranslating = false;
const busyRecordIds = new Set();

function addMenuItem() {
    if (isMenuReady || document.getElementById('stsm-open-button')) return;

    const container = document.querySelector('#extensionsMenu');
    if (!container) return;

    const button = document.createElement('div');
    button.id = 'stsm-open-button';
    button.className = 'list-group-item flex-container flexGap5';
    button.tabIndex = 0;
    button.title = '요약 관리하기';
    button.innerHTML = `
        <div class="fa-solid fa-file-lines extensionsMenuExtensionButton"></div>
        <span>요약 관리하기</span>
    `;
    button.addEventListener('click', openSummarizerPopup);
    button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openSummarizerPopup();
    });

    container.append(button);
    document.querySelector('#extensionsMenuButton')?.style.setProperty('display', 'flex');
    isMenuReady = true;
}

async function openSummarizerPopup() {
    if (popup) return;

    getSettings();
    const root = buildPopup();
    currentRoot = root;
    bindEvents(root);

    popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: '닫기',
    });

    try {
        await popup.show();
    } finally {
        currentRoot = null;
        popup = null;
    }
}

function bindEvents(root) {
    root.querySelectorAll('.stsm-tab').forEach(tab => {
        tab.addEventListener('click', () => setActiveTab(root, tab.dataset.tab));
    });

    const chunkSize = root.querySelector('#stsm-chunk-size');
    chunkSize.value = getSettings().summarization.chunkSize;
    chunkSize.addEventListener('input', event => {
        const normalized = setChunkSize(event.target.value);
        if (event.target.value !== '') event.target.value = normalized;
        renderChunkRangeActions(root);
    });
    bindSummarizationSettings(root);
    bindRangeActions(root);

    root.querySelector('#stsm-summarize').addEventListener('click', () => runSummarization(root));
    bindTranslationSettings(root);
    root.querySelector('#stsm-translate-all').addEventListener('click', () => translateAllRecords(root));
    root.querySelector('#stsm-delete-all-translations').addEventListener('click', () => deleteAllTranslations(root));

    bindConnectionSettings(root);
    bindPromptSettings(root);
    bindPromptInspector(root);
    bindRecordsView(root, bindRecordEvents);
}

function bindSummarizationSettings(root) {
    const settings = getSettings().summarization;
    const maxTokens = root.querySelector('#stsm-injection-max-tokens');
    const mode = root.querySelector('#stsm-injection-mode');
    const depth = root.querySelector('#stsm-injection-depth');
    const role = root.querySelector('#stsm-injection-role');
    const position = root.querySelector('#stsm-injection-position');

    maxTokens.value = settings.injectionMaxTokens;
    mode.value = settings.injection.mode;
    depth.value = settings.injection.depth;
    role.value = settings.injection.role;
    position.value = settings.injection.position;

    maxTokens.addEventListener('change', event => setSummarizationSettings({ injectionMaxTokens: event.target.value }));
    mode.addEventListener('change', event => {
        setSummarizationSettings({ injection: { ...getSettings().summarization.injection, mode: event.target.value } });
        renderInjectionFields(root);
    });
    depth.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, depth: event.target.value } }));
    role.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, role: event.target.value } }));
    position.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, position: event.target.value } }));
    renderInjectionFields(root);
}

function bindRangeActions(root) {
    const startInput = root.querySelector('#stsm-range-start');
    const endInput = root.querySelector('#stsm-range-end');
    const afterLast = root.querySelector('#stsm-range-after-last');
    const minus = root.querySelector('#stsm-range-chunk-minus');
    const plus = root.querySelector('#stsm-range-chunk-plus');

    afterLast.addEventListener('click', () => {
        const records = getSummaryRecords();
        if (!records.length) return;
        const nextId = Math.max(...records.map(record => record.endId)) + 1;
        if (nextId > getLastChatId()) return;
        startInput.value = nextId;
        emitRangeInput(startInput);
    });
    plus.addEventListener('click', () => {
        const start = parseRangeValue(startInput.value);
        const end = parseRangeValue(endInput.value);
        const chunkSize = getSettings().summarization.chunkSize;
        const lastChatId = getLastChatId();
        if (lastChatId < 0) return;

        if (end !== null) endInput.value = Math.min(end + chunkSize, lastChatId);
        else if (start !== null && start <= lastChatId) endInput.value = Math.min(start - 1 + chunkSize, lastChatId);
        else return;
        emitRangeInput(endInput);
    });
    minus.addEventListener('click', () => {
        const start = parseRangeValue(startInput.value);
        const end = parseRangeValue(endInput.value);
        const chunkSize = getSettings().summarization.chunkSize;
        if (start === null || end === null || end - start + 1 <= chunkSize) return;
        endInput.value = Math.max(start + chunkSize - 1, end - chunkSize);
        emitRangeInput(endInput);
    });

    [startInput, endInput].forEach(input => input.addEventListener('input', () => renderChunkRangeActions(root)));
    renderRangeActions(root);
}

function renderRangeActions(root) {
    renderNextSummaryAction(root);
    renderChunkRangeActions(root);
}

function renderNextSummaryAction(root) {
    const lastChatId = getLastChatId();
    const records = getSummaryRecords();
    const nextSummaryId = records.length ? Math.max(...records.map(record => record.endId)) + 1 : null;
    setButtonDisabled(root.querySelector('#stsm-range-after-last'), nextSummaryId === null || nextSummaryId > lastChatId);
}

function renderChunkRangeActions(root) {
    const start = parseRangeValue(root.querySelector('#stsm-range-start').value);
    const end = parseRangeValue(root.querySelector('#stsm-range-end').value);
    const chunkSize = getSettings().summarization.chunkSize;
    const lastChatId = getLastChatId();

    setButtonDisabled(
        root.querySelector('#stsm-range-chunk-minus'),
        start === null || end === null || end - start + 1 <= chunkSize,
    );
    setButtonDisabled(
        root.querySelector('#stsm-range-chunk-plus'),
        lastChatId < 0 || (end !== null ? end >= lastChatId : start === null || start > lastChatId),
    );
}

function setButtonDisabled(button, disabled) {
    if (button.disabled !== disabled) button.disabled = disabled;
}

function getLastChatId() {
    const chat = SillyTavern.getContext().chat;
    return Array.isArray(chat) ? chat.length - 1 : -1;
}

function parseRangeValue(value) {
    const text = String(value ?? '').trim();
    const number = Number(text);
    return text && Number.isInteger(number) && number >= 0 ? number : null;
}

function emitRangeInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderInjectionFields(root) {
    const mode = root.querySelector('#stsm-injection-mode').value;
    root.querySelector('.stsm-injection-depth').hidden = mode !== 'depth';
    root.querySelector('.stsm-injection-role').hidden = mode !== 'depth';
    root.querySelector('.stsm-injection-position').hidden = mode !== 'prompt';
}

async function runSummarization(root) {
    if (isSummarizing) return;

    const startId = root.querySelector('#stsm-range-start').value;
    const endId = root.querySelector('#stsm-range-end').value;

    try {
        setSummarizing(root, true);
        const records = await summarizeRange({
            startId,
            endId,
            onProgress: ({ current, total }) => {
                root.querySelector('#stsm-summarize').textContent = `요약 중 ${current}/${total}`;
            },
            onRecord: async record => {
                await autoTranslateRecord(record);
                renderSummaryRecords(root, bindRecordEvents);
            },
        });
        setActiveTab(root, 'records');
        toastr.success(`${records.length}개의 요약 블록을 생성했습니다.`);
    } catch (error) {
        console.error('[Chat Summarizer] Summarization failed:', error);
        toastr.error(error.message || '요약 생성에 실패했습니다.');
    } finally {
        setSummarizing(root, false);
        renderRangeActions(root);
    }
}

function setSummarizing(root, value) {
    isSummarizing = value;
    root.querySelectorAll('button, input, select, textarea').forEach(element => {
        if (element.classList.contains('stsm-tab')) return;
        if (value) {
            element.dataset.stsmWasDisabled = String(element.disabled);
            element.disabled = true;
        } else {
            element.disabled = element.dataset.stsmWasDisabled === 'true';
            delete element.dataset.stsmWasDisabled;
        }
    });
    root.querySelector('#stsm-summarize').textContent = value ? '요약 중...' : '요약하기';
}

function setActiveTab(root, tabName) {
    root.dataset.activeTab = tabName;
    root.querySelectorAll('.stsm-tab').forEach(tab => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('stsm-tab-active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    root.querySelectorAll('.stsm-panel').forEach(panel => {
        panel.hidden = panel.id !== `stsm-panel-${tabName}`;
    });
    if (tabName === 'settings') root.dispatchEvent(new CustomEvent('stsm:settings-tab-opened'));
}

function bindRecordEvents(record) {
    record.querySelector('.stsm-record-copy').addEventListener('click', () => copyRecordContent(record));
    record.querySelector('.stsm-record-edit').addEventListener('click', () => enterRecordEditMode(record));
    record.querySelector('.stsm-record-translate').addEventListener('click', () => translateRecord(record));
    record.querySelector('.stsm-record-translation-toggle')?.addEventListener('click', () => toggleRecordTranslation(record));
    record.querySelector('.stsm-record-cancel').addEventListener('click', () => cancelRecordEdit(record));
    record.querySelector('.stsm-record-save').addEventListener('click', () => saveRecordEdit(record));
    record.querySelector('.stsm-record-reroll').addEventListener('click', () => rerollRecord(record));
    record.querySelector('.stsm-record-chat').addEventListener('click', () => openRevisionChat(record.dataset.recordId, {
        onApplied: () => {
            if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        },
    }));
    record.querySelector('.stsm-record-delete').addEventListener('click', () => showDeleteConfirmation(record));
}

async function copyRecordContent(record) {
    const visibleContent = [...record.querySelectorAll('.stsm-record-content')]
        .find(element => !element.hidden);
    if (!visibleContent) {
        toastr.warning('복사할 요약 내용이 없습니다.');
        return;
    }

    try {
        await copyText(visibleContent.textContent);
        toastr.success('복사 완료!');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to copy summary:', error);
        toastr.error('요약 복사에 실패했습니다.');
    }
}

function bindTranslationSettings(root) {
    const settings = getSettings().translation;
    const method = root.querySelector('#stsm-translation-method');
    const provider = root.querySelector('#stsm-translation-provider');
    const targetLanguage = root.querySelector('#stsm-translation-language');
    const autoTranslate = root.querySelector('#stsm-auto-translation');

    method.value = settings.method;
    provider.value = settings.provider;
    targetLanguage.value = settings.targetLanguage;
    autoTranslate.checked = settings.autoTranslate;

    method.addEventListener('change', event => setTranslationSettings({ method: event.target.value }));
    provider.addEventListener('change', event => setTranslationSettings({ provider: event.target.value }));
    targetLanguage.addEventListener('change', event => setTranslationSettings({ targetLanguage: event.target.value }));
    autoTranslate.addEventListener('change', event => setTranslationSettings({ autoTranslate: event.target.checked }));
}

function toggleRecordTranslation(recordElement) {
    const original = recordElement.querySelector('.stsm-record-original');
    const translated = recordElement.querySelector('.stsm-record-translation');
    const toggle = recordElement.querySelector('.stsm-record-translation-toggle');
    const showTranslation = translated.hidden;
    translated.hidden = !showTranslation;
    original.hidden = showTranslation;
    toggle.setAttribute('aria-pressed', String(showTranslation));
}

async function translateRecord(recordElement) {
    if (isTranslating) return;

    const translated = recordElement.querySelector('.stsm-record-translation');
    if (translated.textContent.trim()) {
        const confirmed = await showConfirmation('번역을 재생성하시겠습니까? 기존 번역은 덮어씌워집니다.', '재생성');
        if (!confirmed) return;
    }

    const button = recordElement.querySelector('.stsm-record-translate');
    button.disabled = true;
    try {
        await translateSummaryRecord(recordElement.dataset.recordId);
        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약을 번역했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Translation failed:', error);
        toastr.error(error.message || '요약 번역에 실패했습니다.');
    } finally {
        button.disabled = false;
    }
}

function enterRecordEditMode(record) {
    if (record.querySelector('.stsm-record-editor')) return;
    const content = record.querySelector('.stsm-record-original');
    const translation = record.querySelector('.stsm-record-translation');
    record.dataset.stsmTranslationWasVisible = String(!translation.hidden);
    const editor = document.createElement('textarea');
    editor.className = 'stsm-record-editor text_pole';
    editor.rows = 8;
    editor.value = content.textContent.trim();
    content.hidden = true;
    translation.hidden = true;
    content.after(editor);
    record.querySelectorAll('.stsm-record-actions button').forEach(button => {
        button.disabled = true;
    });
    record.querySelector('.stsm-record-edit-actions').hidden = false;
    editor.focus();
}

function cancelRecordEdit(record) {
    const content = record.querySelector('.stsm-record-original');
    const translation = record.querySelector('.stsm-record-translation');
    const editor = record.querySelector('.stsm-record-editor');
    if (!editor) return;
    editor.remove();
    const translationWasVisible = record.dataset.stsmTranslationWasVisible === 'true';
    content.hidden = translationWasVisible;
    translation.hidden = !translationWasVisible;
    delete record.dataset.stsmTranslationWasVisible;
    record.querySelectorAll('.stsm-record-actions button').forEach(button => {
        button.disabled = false;
    });
    record.querySelector('.stsm-record-edit-actions').hidden = true;
}

async function saveRecordEdit(record) {
    if (busyRecordIds.has(record.dataset.recordId)) return;
    const editor = record.querySelector('.stsm-record-editor');
    if (!editor) return;

    try {
        setRecordBusy(record, true);
        const updatedRecord = await updateSummaryRecordContent(record.dataset.recordId, editor.value);
        if (!updatedRecord) throw new Error('수정할 요약 기록을 찾지 못했습니다.');
        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약을 수정했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to update summary:', error);
        toastr.error(error.message || '요약 수정에 실패했습니다.');
    } finally {
        setRecordBusy(record, false);
    }
}

async function rerollRecord(record) {
    const recordId = record.dataset.recordId;
    if (busyRecordIds.has(recordId)) return;

    const confirmed = await showConfirmation('정말 재생성하시겠습니까? 기존 요약은 새 결과로 대체됩니다.', '재생성');
    if (!confirmed) return;
    if (busyRecordIds.has(recordId)) return;

    try {
        setRecordBusy(record, true);
        const updatedRecord = await regenerateSummaryRecord(recordId);
        await autoTranslateRecord(updatedRecord);
        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약을 재생성했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to regenerate summary:', error);
        toastr.error(error.message || '요약 재생성에 실패했습니다.');
    } finally {
        setRecordBusy(record, false);
    }
}

async function autoTranslateRecord(record) {
    if (!getSettings().translation.autoTranslate) return;

    try {
        await translateSummaryRecord(record.id);
    } catch (error) {
        console.error('[Chat Summarizer] Automatic translation failed:', error);
        toastr.warning(`#${record.startId} ~ #${record.endId} 요약의 자동 번역에 실패했습니다.`);
    }
}

function setRecordBusy(record, value) {
    const recordId = record.dataset.recordId;
    if (value) busyRecordIds.add(recordId);
    else busyRecordIds.delete(recordId);

    record.querySelectorAll('button, textarea').forEach(element => {
        element.disabled = value;
    });
}

async function showDeleteConfirmation(record) {
    const confirmed = await showConfirmation('정말 삭제하시겠습니까? 삭제된 기록은 복구할 수 없습니다.', '삭제');
    if (!confirmed) return;

    try {
        const deleted = await deleteSummaryRecord(record.dataset.recordId);
        if (!deleted) {
            toastr.warning('삭제할 요약 기록을 찾지 못했습니다.');
            return;
        }

        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약 기록을 삭제했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to delete summary record:', error);
        toastr.error('요약 기록 삭제에 실패했습니다.');
    }
}

async function translateAllRecords(root) {
    if (isTranslating) return;
    const confirmed = await showConfirmation('모든 요약 기록을 일괄 번역하시겠습니까?', '번역');
    if (!confirmed) return;

    const button = root.querySelector('#stsm-translate-all');
    try {
        setTranslating(root, true);
        const result = await translateAllSummaryRecords({
            onProgress: ({ current, total }) => {
                button.textContent = `번역 중 ${current}/${total}`;
            },
        });
        renderSummaryRecords(root, bindRecordEvents);

        if (!result.total) {
            toastr.info('번역할 요약 기록이 없습니다.');
        } else if (!result.translated && !result.failures.length) {
            toastr.info('모든 요약 기록이 현재 설정으로 이미 번역되어 있습니다.');
        } else if (result.failures.length) {
            toastr.warning(`${result.translated}개 번역 완료, ${result.failures.length}개 번역 실패`);
            result.failures.forEach(({ record, error }) => {
                console.error(`[Chat Summarizer] Failed to translate #${record.startId} ~ #${record.endId}:`, error);
            });
        } else {
            toastr.success(`${result.translated}개의 요약 기록을 번역했습니다.`);
        }
    } catch (error) {
        console.error('[Chat Summarizer] Bulk translation failed:', error);
        toastr.error('일괄 번역 처리에 실패했습니다.');
    } finally {
        setTranslating(root, false);
    }
}

async function deleteAllTranslations(root) {
    if (isTranslating) return;
    const confirmed = await showConfirmation('모든 요약 기록의 번역을 삭제하시겠습니까? 원문 요약은 삭제되지 않습니다.', '번역 삭제');
    if (!confirmed) return;

    try {
        setTranslating(root, true);
        const deletedCount = await deleteAllSummaryTranslations();
        renderSummaryRecords(root, bindRecordEvents);
        if (deletedCount) toastr.success(`${deletedCount}개의 번역을 삭제했습니다.`);
        else toastr.info('삭제할 번역이 없습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to delete translations:', error);
        toastr.error('번역 삭제에 실패했습니다.');
    } finally {
        setTranslating(root, false);
    }
}

function setTranslating(root, value) {
    isTranslating = value;
    root.querySelectorAll('.stsm-record-translate, .stsm-record-translation-toggle, #stsm-translate-all, #stsm-delete-all-translations').forEach(button => {
        button.disabled = value;
    });
    root.querySelector('#stsm-translate-all').textContent = '일괄 번역';
}

async function showConfirmation(message, okButton) {
    const content = document.createElement('div');
    content.textContent = message;
    const confirmation = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton,
        cancelButton: '취소',
    });
    return await confirmation.show();
}

function initialize() {
    const context = SillyTavern.getContext();
    context.eventSource.on(context.eventTypes.APP_READY, addMenuItem);
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        clearRevisionSession();
        refreshSummaryInjection();
        if (!currentRoot) return;
        currentRoot.querySelector('#stsm-range-start').value = '';
        currentRoot.querySelector('#stsm-range-end').value = '';
        renderSummaryRecords(currentRoot, bindRecordEvents);
        renderRangeActions(currentRoot);
    });
    window.addEventListener('stsm:records-changed', () => {
        if (currentRoot) renderRangeActions(currentRoot);
    });
    initializeSummaryContext();
    addMenuItem();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
