import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { copyText } from '../../../../scripts/utils.js';
import { bindConnectionSettings } from './connection/connection-settings-view.js';
import { bindCoverageMap } from './records/coverage-map-view.js';
import {
    beginOperation,
    endOperation,
    isExtensionEnabled,
    updateOperation,
} from './core/extension-state.js';
import { bindExtensionStatus } from './ui/extension-status-view.js';
import { buildPopup } from './ui/popup-template.js';
import {
    hideAllSummarizedMessages,
    initializeMessageVisibility,
    syncSummarizedMessageVisibility,
    unhideAllSummarizedMessages,
} from './visibility/message-visibility.js';
import { bindPromptSettings } from './prompts/prompt-settings-view.js';
import { bindPromptInspector } from './prompts/prompt-inspector.js';
import { bindRangeAdjustment } from './records/range-adjustment-view.js';
import {
    bindRecordsView,
    refreshSummaryRecordSourceStates,
    renderSummaryRecords,
} from './records/records-view.js';
import {
    clearRevisionSession,
    openRevisionChat,
    synchronizeRevisionSessionRanges,
} from './records/revision-chat-view.js';
import {
    getSettings,
    setAutoHideSummarizedMessages,
    setChunkSize,
    setSummarizationSettings,
    setTranslationSettings,
} from './core/settings.js';
import { initializeSummaryContext, refreshSummaryInjection } from './summary/summary-context.js';
import { regenerateSummaryRecord, summarizeRange } from './summary/summary-service.js';
import { deleteSummaryRecord, getSummaryRecord, getSummaryRecords, updateSummaryRecordContent } from './summary/summary-store.js';
import { renderSummaryStatus } from './summary/summary-status-view.js';
import { addExtensionErrorLog } from './diagnostics/summary-error-state.js';
import { bindSummaryErrorView } from './diagnostics/summary-error-view.js';
import {
    deleteAllSummaryTranslations,
    translateAllSummaryRecords,
    translateSummaryRecord,
} from './translation/translation-service.js';

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
    const cleanup = bindEvents(root);

    popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: '닫기',
    });

    try {
        await popup.show();
    } finally {
        cleanup();
        currentRoot = null;
        popup = null;
    }
}

function bindEvents(root) {
    const unbindSummaryErrorView = bindSummaryErrorView(root);
    const unbindExtensionStatus = bindExtensionStatus(root, async enabled => {
        refreshSummaryInjection();
        if (!enabled) return;

        try {
            await syncSummarizedMessageVisibility();
        } catch (error) {
            console.error('[Chat Summarizer] Failed to synchronize message visibility after enabling:', error);
            addExtensionErrorLog(error, {
                operation: 'message-visibility',
                title: '확장 활성화 후 자동 숨김 동기화 실패',
                message: '확장은 켜졌지만 요약 메시지 자동 숨김 동기화에 실패했습니다.',
            });
            toastr.warning('확장은 켜졌지만 요약 메시지 자동 숨김 동기화에 실패했습니다.');
        }
    });

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
    bindCoverageMap(root);

    root.querySelector('#stsm-summarize').addEventListener('click', () => runSummarization(root));
    bindTranslationSettings(root);
    root.querySelector('#stsm-translate-all').addEventListener('click', () => translateAllRecords(root));
    root.querySelector('#stsm-delete-all-translations').addEventListener('click', () => deleteAllTranslations(root));

    bindConnectionSettings(root);
    bindPromptSettings(root);
    bindPromptInspector(root);
    bindRecordsView(root, bindRecordEvents);
    bindRangeAdjustment(root, {
        onApplied: async updatedRecords => {
            synchronizeRevisionSessionRanges(updatedRecords);
            renderSummaryRecords(root, bindRecordEvents);
            renderRangeActions(root);
            renderSummaryStatus(root);
            await syncSummarizedMessageVisibility();
        },
    });
    renderSummaryStatus(root);
    return () => {
        unbindSummaryErrorView();
        unbindExtensionStatus();
    };
}

function bindSummarizationSettings(root) {
    const settings = getSettings().summarization;
    const maxTokens = root.querySelector('#stsm-injection-max-tokens');
    const mode = root.querySelector('#stsm-injection-mode');
    const depth = root.querySelector('#stsm-injection-depth');
    const role = root.querySelector('#stsm-injection-role');
    const position = root.querySelector('#stsm-injection-position');
    const recordTemplate = root.querySelector('#stsm-summary-record-template');
    const autoHide = root.querySelector('#stsm-auto-hide-summarized');

    maxTokens.value = settings.injectionMaxTokens;
    mode.value = settings.injection.mode;
    depth.value = settings.injection.depth;
    role.value = settings.injection.role;
    position.value = settings.injection.position;
    recordTemplate.value = settings.recordTemplate;
    autoHide.checked = settings.autoHideSummarizedMessages;

    maxTokens.addEventListener('change', event => setSummarizationSettings({ injectionMaxTokens: event.target.value }));
    mode.addEventListener('change', event => {
        setSummarizationSettings({ injection: { ...getSettings().summarization.injection, mode: event.target.value } });
        renderInjectionFields(root);
    });
    depth.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, depth: event.target.value } }));
    role.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, role: event.target.value } }));
    position.addEventListener('change', event => setSummarizationSettings({ injection: { ...getSettings().summarization.injection, position: event.target.value } }));
    recordTemplate.addEventListener('change', event => setSummarizationSettings({ recordTemplate: event.target.value }));
    autoHide.addEventListener('change', async event => {
        const enabled = setAutoHideSummarizedMessages(event.target.checked);
        if (!enabled) return;

        try {
            const result = await syncSummarizedMessageVisibility();
            if (result.hidden) toastr.success(`${result.hidden}개의 요약된 메시지를 숨겼습니다.`);
        } catch (error) {
            console.error('[Chat Summarizer] Failed to enable automatic message hiding:', error);
            addExtensionErrorLog(error, {
                operation: 'message-visibility',
                title: '자동 숨김 적용 실패',
                message: '요약 메시지 자동 숨김 적용에 실패했습니다.',
            });
            toastr.error('요약 메시지 자동 숨김 적용에 실패했습니다.');
        }
    });
    root.querySelector('#stsm-hide-all-summarized').addEventListener('click', () => hideSummarizedMessages());
    root.querySelector('#stsm-unhide-all-summarized').addEventListener('click', () => unhideSummarizedMessages());
    renderInjectionFields(root);
}

async function hideSummarizedMessages() {
    let operationToken = null;
    try {
        operationToken = beginOperation('hiding', '요약 메시지 숨김 처리 중');
        const result = await hideAllSummarizedMessages();
        if (result.hidden) toastr.success(`${result.hidden}개의 요약된 메시지를 숨겼습니다.`);
        else toastr.info('새로 숨길 요약 메시지가 없습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to hide summarized messages:', error);
        addExtensionErrorLog(error, {
            operation: 'message-visibility',
            title: '메시지 일괄 숨김 실패',
            message: '요약 메시지 일괄 숨김에 실패했습니다.',
        });
        toastr.error('요약 메시지 일괄 숨김에 실패했습니다.');
    } finally {
        if (operationToken) endOperation(operationToken);
    }
}

async function unhideSummarizedMessages() {
    try {
        const result = await unhideAllSummarizedMessages();
        if (result.unhidden) toastr.success(`${result.unhidden}개의 요약 메시지 숨김을 해제했습니다.`);
        else toastr.info('이 확장이 숨긴 메시지가 없습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to unhide summarized messages:', error);
        addExtensionErrorLog(error, {
            operation: 'message-visibility',
            title: '메시지 숨김 해제 실패',
            message: '요약 메시지 숨김 해제에 실패했습니다.',
        });
        toastr.error('요약 메시지 숨김 해제에 실패했습니다.');
    }
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

    let operationToken = null;
    try {
        const initialLabel = startId.trim() && endId.trim()
            ? `#${startId.trim()} ~ #${endId.trim()} 요약 중`
            : '요약 준비 중';
        operationToken = beginOperation('summarizing', initialLabel);
        setSummarizing(root, true);
        const records = await summarizeRange({
            startId,
            endId,
            onProgress: ({ current, total, chunk }) => {
                updateOperation(operationToken, `#${chunk.startId} ~ #${chunk.endId} 요약 중`);
                root.querySelector('#stsm-summarize').textContent = `요약 중 ${current}/${total}`;
            },
            onRecord: async record => {
                await autoTranslateRecord(record, operationToken);
                renderSummaryRecords(root, bindRecordEvents);
            },
        });
        setActiveTab(root, 'records');
        toastr.success(`${records.length}개의 요약 블록을 생성했습니다.`);
    } catch (error) {
        console.error('[Chat Summarizer] Summarization failed:', error);
        if (error?.summaryBatch) {
            addExtensionErrorLog(error, {
                operation: 'summarization',
                title: '요약 배치 실패',
            });
            toastr.error(error.message, '요약 작업 중단', {
                closeButton: true,
                timeOut: 12000,
                extendedTimeOut: 3000,
            });
        } else {
            toastr.error(error.message || '요약 생성에 실패했습니다.');
        }
    } finally {
        if (operationToken) {
            setSummarizing(root, false);
            endOperation(operationToken);
        }
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
    record.querySelector('.stsm-record-chat').addEventListener('click', () => {
        openRevisionChat(record.dataset.recordId, {
            onApplied: () => {
                if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
            },
        }).catch(error => {
            console.error('[Chat Summarizer] Failed to open revision chat:', error);
            addExtensionErrorLog(error, {
                operation: 'revision-chat',
                title: '요약 수정 대화 열기 실패',
                message: '요약 수정 대화 화면을 열지 못했습니다.',
                context: { range: getRecordRange(record) },
            });
            toastr.error('요약 수정 대화 화면을 열지 못했습니다.');
        });
    });
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
        addExtensionErrorLog(error, {
            operation: 'clipboard',
            title: '요약 복사 실패',
            message: '요약 복사에 실패했습니다.',
        });
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
    const record = getSummaryRecord(recordElement.dataset.recordId);
    let operationToken = null;
    try {
        operationToken = beginOperation(
            'translating',
            record ? `#${record.startId} ~ #${record.endId} 번역 중` : '요약 번역 중',
        );
        button.disabled = true;
        await translateSummaryRecord(recordElement.dataset.recordId);
        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약을 번역했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Translation failed:', error);
        addExtensionErrorLog(error, {
            operation: 'translation',
            title: '요약 번역 실패',
            message: '요약 번역에 실패했습니다.',
            context: { range: getRecordRange(record) },
        });
        toastr.error(error.message || '요약 번역에 실패했습니다.');
    } finally {
        if (operationToken) {
            button.disabled = false;
            endOperation(operationToken);
        }
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
        addExtensionErrorLog(error, {
            operation: 'record-update',
            title: '요약 수정 저장 실패',
            message: '요약 수정 내용을 저장하지 못했습니다.',
            context: { range: getRecordRange(record) },
        });
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

    const sourceRecord = getSummaryRecord(recordId);
    let operationToken = null;
    try {
        operationToken = beginOperation(
            'rerolling',
            sourceRecord ? `#${sourceRecord.startId} ~ #${sourceRecord.endId} 재생성 중` : '요약 재생성 중',
        );
        setRecordBusy(record, true);
        const updatedRecord = await regenerateSummaryRecord(recordId);
        await autoTranslateRecord(updatedRecord, operationToken);
        if (currentRoot) renderSummaryRecords(currentRoot, bindRecordEvents);
        toastr.success('요약을 재생성했습니다.');
    } catch (error) {
        console.error('[Chat Summarizer] Failed to regenerate summary:', error);
        addExtensionErrorLog(error, {
            operation: 'regeneration',
            title: '요약 재생성 실패',
            message: '요약 재생성에 실패했습니다.',
            context: { range: getRecordRange(sourceRecord) },
        });
        toastr.error(error.message || '요약 재생성에 실패했습니다.');
    } finally {
        if (operationToken) {
            setRecordBusy(record, false);
            endOperation(operationToken);
        }
    }
}

async function autoTranslateRecord(record, operationToken) {
    if (!isExtensionEnabled() || !getSettings().translation.autoTranslate) return;

    try {
        updateOperation(operationToken, `#${record.startId} ~ #${record.endId} 번역 중`);
        await translateSummaryRecord(record.id);
    } catch (error) {
        console.error('[Chat Summarizer] Automatic translation failed:', error);
        addExtensionErrorLog(error, {
            operation: 'translation',
            title: '자동 번역 실패',
            message: '요약 생성은 완료됐지만 자동 번역에 실패했습니다.',
            context: { range: getRecordRange(record) },
        });
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

function getRecordRange(recordOrElement) {
    const record = recordOrElement instanceof HTMLElement
        ? getSummaryRecord(recordOrElement.dataset.recordId)
        : recordOrElement;
    const startId = Number(record?.startId);
    const endId = Number(record?.endId);
    return Number.isInteger(startId) && Number.isInteger(endId) ? { startId, endId } : null;
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
        addExtensionErrorLog(error, {
            operation: 'record-delete',
            title: '요약 기록 삭제 실패',
            message: '요약 기록 삭제에 실패했습니다.',
            context: { range: getRecordRange(getSummaryRecord(record.dataset.recordId)) },
        });
        toastr.error('요약 기록 삭제에 실패했습니다.');
    }
}

async function translateAllRecords(root) {
    if (isTranslating) return;
    const confirmed = await showConfirmation('모든 요약 기록을 일괄 번역하시겠습니까?', '번역');
    if (!confirmed) return;

    const button = root.querySelector('#stsm-translate-all');
    let operationToken = null;
    try {
        operationToken = beginOperation('translating', '일괄 번역 준비 중');
        setTranslating(root, true);
        const result = await translateAllSummaryRecords({
            onProgress: ({ current, total, record }) => {
                updateOperation(operationToken, `#${record.startId} ~ #${record.endId} 번역 중 (${current}/${total})`);
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
                addExtensionErrorLog(error, {
                    operation: 'translation',
                    title: '일괄 번역 중 레코드 번역 실패',
                    message: '일괄 번역 중 일부 요약을 번역하지 못했습니다.',
                    context: { range: getRecordRange(record) },
                });
            });
        } else {
            toastr.success(`${result.translated}개의 요약 기록을 번역했습니다.`);
        }
    } catch (error) {
        console.error('[Chat Summarizer] Bulk translation failed:', error);
        addExtensionErrorLog(error, {
            operation: 'translation',
            title: '일괄 번역 처리 실패',
            message: '일괄 번역 처리에 실패했습니다.',
        });
        toastr.error('일괄 번역 처리에 실패했습니다.');
    } finally {
        if (operationToken) {
            setTranslating(root, false);
            endOperation(operationToken);
        }
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
        addExtensionErrorLog(error, {
            operation: 'translation-delete',
            title: '번역 일괄 삭제 실패',
            message: '번역 삭제에 실패했습니다.',
        });
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
        renderSummaryStatus(currentRoot);
    });
    window.addEventListener('stsm:records-changed', () => {
        if (!currentRoot) return;
        renderRangeActions(currentRoot);
        renderSummaryStatus(currentRoot);
    });
    [
        context.eventTypes.MESSAGE_SENT,
        context.eventTypes.MESSAGE_RECEIVED,
        context.eventTypes.MESSAGE_DELETED,
        context.eventTypes.MESSAGE_EDITED,
        context.eventTypes.MESSAGE_UPDATED,
        context.eventTypes.MESSAGE_SWIPED,
    ]
        .forEach(eventType => context.eventSource.on(eventType, () => {
            if (!currentRoot) return;
            renderSummaryStatus(currentRoot);
            refreshSummaryRecordSourceStates(currentRoot);
        }));
    initializeSummaryContext();
    initializeMessageVisibility();
    addMenuItem();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
