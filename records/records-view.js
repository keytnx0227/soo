import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { openSummaryRecordDetail } from './record-detail-view.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { getSummaryRecordSourceStatuses, SOURCE_STATES } from '../summary/source-tracking.js';
import { getSummaryRecords } from '../summary/summary-store.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { escapeHtml } from '../core/utils.js';
import { getRecordTags } from './record-tags.js';
import { openRecordTagEditor, renderRecordTagSummary } from './record-tags-view.js';
import { renderRecordMemoryUpdateBadge } from './record-memory-updates-view.js';
import { getExtensionState, subscribeExtensionState } from '../core/extension-state.js';
import { renderExtensionControls } from '../ui/extension-status-view.js';
import { renderRecordSearchControls } from '../ui/popup-template.js';
import { renderLongTermRetrievalPreview } from '../memory/long-term-retrieval-view.js';

export function bindRecordsView(root, bindRecordEvents) {
    root.querySelector('#stsm-preview-summary-context').addEventListener('click', async () => {
        try {
            await showSummaryContextPreview();
        } catch (error) {
            logRecordViewError(error, '요약 조립 결과 미리보기 실패', '요약 조립 결과를 열지 못했습니다.');
        }
    });
    root.querySelector('#stsm-record-sort').addEventListener('change', () => {
        renderSummaryRecords(root, bindRecordEvents);
    });
    bindRecordSearch(root, () => renderSummaryRecords(root, bindRecordEvents));
    bindMemoryTabs(root, () => renderSummaryRecords(root, bindRecordEvents));
    root.querySelector('#stsm-records-fullscreen').addEventListener('click', () => {
        showRecordsFullscreen(
            root.querySelector('#stsm-record-sort').value,
            getSelectedMemoryView(root),
            getRecordSearchState(root),
            bindRecordEvents,
            searchState => {
                setRecordSearchState(root, searchState);
                renderSummaryRecords(root, bindRecordEvents);
            },
        ).catch(error => {
            logRecordViewError(error, '요약 기록 전체 화면 열기 실패', '요약 기록 전체 화면을 열지 못했습니다.');
        });
    });
    renderSummaryRecords(root, bindRecordEvents);
}

export function renderSummaryRecords(root, bindRecordEvents) {
    const list = root.querySelector('#stsm-record-list');
    const direction = root.querySelector('#stsm-record-sort').value;
    renderRecordList(list, direction, getSelectedMemoryView(root), getRecordSearchState(root), bindRecordEvents);
    root.dispatchEvent(new CustomEvent('stsm:records-rendered'));
}

function renderRecordList(list, direction, memoryView, searchState, bindRecordEvents) {
    const allRecords = getSummaryRecords();
    const memoryRecords = allRecords.filter(record => memoryView === 'long-term'
        ? Boolean(record.compressedBy)
        : !record.compressedBy);
    const records = filterRecords(memoryRecords, searchState).sort((left, right) => {
        const difference = left.startId - right.startId || left.endId - right.endId;
        return direction === 'id-asc' ? difference : -difference;
    });
    const sourceStatuses = getSummaryRecordSourceStatuses(allRecords);
    updateRecordSearchCount(list, records.length, memoryRecords.length, searchState.query);

    list.innerHTML = records.length
        ? records.map(record => renderSummaryRecord(record, sourceStatuses.get(record.id))).join('')
        : `<div class="stsm-empty">${searchState.query
            ? '검색 결과가 없습니다.'
            : memoryView === 'long-term' ? '저장된 장기기억이 없습니다.' : '저장된 상시기억이 없습니다.'}</div>`;
    list.querySelectorAll('.stsm-record').forEach(recordElement => {
        recordElement.querySelector('.stsm-record-detail').addEventListener('click', () => {
            openSummaryRecordDetail(recordElement.dataset.recordId).catch(error => {
                logRecordViewError(error, '요약 레코드 자세히 보기 실패', '요약 레코드의 상세 내용을 열지 못했습니다.', {
                    range: getElementRecordRange(recordElement),
                });
            });
        });
        recordElement.querySelector('.stsm-record-tag-edit')?.addEventListener('click', () => {
            openRecordTagEditor(recordElement.dataset.recordId)
                .then(saved => {
                    if (saved) renderRecordList(list, direction, memoryView, searchState, bindRecordEvents);
                })
                .catch(error => {
                    logRecordViewError(error, '장기기억 검색 태그 수정 실패', '검색 태그를 저장하지 못했습니다.', {
                        range: getElementRecordRange(recordElement),
                    });
                });
        });
        bindRecordEvents(recordElement);
    });
}

async function showRecordsFullscreen(initialDirection, initialMemoryView, initialSearchState, bindRecordEvents, onSearchChange) {
    const content = document.createElement('div');
    content.className = 'stsm-records-fullscreen';
    content.innerHTML = `
        <div class="stsm-records-fullscreen-toolbar">
            <strong>요약 기록</strong>
            <label class="stsm-field stsm-sort-field">
                <select class="stsm-records-fullscreen-sort text_pole" aria-label="요약 기록 정렬">
                    <option value="id-desc">ID 높은 순</option>
                    <option value="id-asc">ID 낮은 순</option>
                </select>
            </label>
        </div>
        <div class="stsm-record-memory-browser">
            <div class="stsm-record-memory-tabs" role="tablist" aria-label="기억 종류">
                <button class="stsm-record-memory-tab menu_button interactable" type="button" data-memory-view="active" role="tab">상시기억</button>
                <button class="stsm-record-memory-tab menu_button interactable" type="button" data-memory-view="long-term" role="tab">장기기억</button>
            </div>
            ${renderRecordSearchControls()}
            <div class="stsm-record-list"></div>
        </div>
    `;

    const sort = content.querySelector('.stsm-records-fullscreen-sort');
    const list = content.querySelector('.stsm-record-list');
    sort.value = initialDirection === 'id-asc' ? 'id-asc' : 'id-desc';
    setSelectedMemoryView(content, initialMemoryView);
    setRecordSearchState(content, initialSearchState);
    const render = () => {
        renderRecordList(list, sort.value, getSelectedMemoryView(content), getRecordSearchState(content), bindRecordEvents);
        renderExtensionControls(content, getExtensionState());
    };
    const handleRecordsChanged = () => render();
    const unsubscribeExtensionState = subscribeExtensionState(state => renderExtensionControls(content, state));
    sort.addEventListener('change', render);
    bindRecordSearch(content, () => {
        render();
        onSearchChange?.(getRecordSearchState(content));
    });
    bindMemoryTabs(content, render);
    window.addEventListener('stsm:records-changed', handleRecordsChanged);
    render();

    try {
        await new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            wide: true,
            large: true,
            allowVerticalScrolling: false,
        }).show();
    } finally {
        unsubscribeExtensionState();
        window.removeEventListener('stsm:records-changed', handleRecordsChanged);
    }
}

function bindRecordSearch(root, onChange) {
    const mode = root.querySelector('.stsm-record-search-mode');
    const input = root.querySelector('.stsm-record-search-input');
    const clear = root.querySelector('.stsm-record-search-clear');
    if (!mode || !input || !clear || mode.dataset.bound) return;
    mode.dataset.bound = 'true';
    mode.addEventListener('change', () => {
        updateRecordSearchControls(root);
        onChange();
    });
    input.addEventListener('input', () => {
        updateRecordSearchControls(root);
        onChange();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        updateRecordSearchControls(root);
        onChange();
        input.focus();
    });
    updateRecordSearchControls(root);
}

function getRecordSearchState(root) {
    return {
        mode: ['number', 'all', 'tags'].includes(root.querySelector('.stsm-record-search-mode')?.value)
            ? root.querySelector('.stsm-record-search-mode').value
            : 'number',
        query: String(root.querySelector('.stsm-record-search-input')?.value || '').trim(),
    };
}

function setRecordSearchState(root, state = {}) {
    const mode = root.querySelector('.stsm-record-search-mode');
    const input = root.querySelector('.stsm-record-search-input');
    if (!mode || !input) return;
    mode.value = ['number', 'all', 'tags'].includes(state.mode) ? state.mode : 'number';
    input.value = String(state.query || '');
    updateRecordSearchControls(root);
}

function updateRecordSearchControls(root) {
    const { mode, query } = getRecordSearchState(root);
    const input = root.querySelector('.stsm-record-search-input');
    const clear = root.querySelector('.stsm-record-search-clear');
    if (!input || !clear) return;
    input.inputMode = mode === 'number' ? 'numeric' : 'search';
    input.placeholder = mode === 'number' ? '메시지 ID' : mode === 'tags' ? '태그 검색' : '기억 전체 검색';
    clear.classList.toggle('stsm-record-search-clear-hidden', !query);
    clear.disabled = !query;
    clear.setAttribute('aria-hidden', String(!query));
}

function filterRecords(records, { mode, query }) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [...records];

    if (mode === 'number') {
        const messageId = Number(query);
        if (!Number.isInteger(messageId) || messageId < 0) return [];
        return records.filter(record => record.startId <= messageId && messageId <= record.endId);
    }

    return records.filter(record => {
        const tags = getRecordTags(record).flatMap(tag => [tag.canonical, ...tag.matchTerms]);
        const values = mode === 'tags'
            ? tags
            : [
                record.content,
                record.translation?.content,
                record.structuredSummary?.data?.title,
                ...tags,
            ];
        return values.some(value => normalizeSearchText(value).includes(normalizedQuery));
    });
}

function normalizeSearchText(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function updateRecordSearchCount(list, visibleCount, totalCount, query) {
    const count = list.closest('.stsm-record-memory-browser')?.querySelector('.stsm-record-search-count');
    if (count) count.textContent = query ? `${visibleCount}/${totalCount}개` : `${totalCount}개`;
}

function bindMemoryTabs(root, onChange) {
    root.querySelectorAll('.stsm-record-memory-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const nextView = tab.dataset.memoryView;
            if (nextView === getSelectedMemoryView(root)) return;
            setSelectedMemoryView(root, nextView);
            onChange();
        });
    });
    setSelectedMemoryView(root, getSelectedMemoryView(root));
}

function getSelectedMemoryView(root) {
    return root.dataset.recordMemoryView === 'long-term' ? 'long-term' : 'active';
}

function setSelectedMemoryView(root, memoryView) {
    const normalized = memoryView === 'long-term' ? 'long-term' : 'active';
    root.dataset.recordMemoryView = normalized;
    root.querySelectorAll('.stsm-record-memory-tab').forEach(tab => {
        const selected = tab.dataset.memoryView === normalized;
        tab.classList.toggle('stsm-record-memory-tab-active', selected);
        tab.setAttribute('aria-selected', String(selected));
    });
}

function logRecordViewError(error, title, message, context = null) {
    console.error(`[Chat Summarizer] ${title}:`, error);
    addExtensionErrorLog(error, {
        operation: 'record-inspection',
        title,
        message,
        context,
    });
    toastr.error(message);
}

function getElementRecordRange(recordElement) {
    const record = getSummaryRecords().find(item => item.id === recordElement.dataset.recordId);
    return record ? { startId: record.startId, endId: record.endId } : null;
}

export function refreshSummaryRecordSourceStates(root) {
    const records = getSummaryRecords();
    const sourceStatuses = getSummaryRecordSourceStatuses(records);
    root.querySelectorAll('.stsm-record').forEach(recordElement => {
        const slot = recordElement.querySelector('.stsm-record-source-state-slot');
        if (!slot) return;
        const record = records.find(item => item.id === recordElement.dataset.recordId);
        slot.innerHTML = renderSourceState(sourceStatuses.get(recordElement.dataset.recordId), record);
    });
}

async function showSummaryContextPreview() {
    const details = buildSummaryContextDetails();
    const content = document.createElement('div');
    content.className = 'stsm-prompt-preview';

    if (!details.enabled || !details.sourceUnitCount) {
        const message = details.enabled
            ? '활성화된 블록에 전송할 요약 또는 도감 항목이 없습니다.'
            : '요약 확장이 꺼져 있어 매크로 결과가 비어 있습니다.';
        content.innerHTML = `<div class="stsm-section-title">{{sumiSummary}} 미리보기</div><div class="stsm-empty">${message}</div>`;
    } else {
        const preview = details.content
            ? '<textarea class="text_pole monospace" rows="24" readonly></textarea>'
            : '<div class="stsm-empty">토큰 제한 또는 레코드 포맷 설정으로 실제 전송 결과가 비어 있습니다.</div>';
        content.innerHTML = `
            <label class="stsm-field">
                <span class="stsm-section-title">{{sumiSummary}} 미리보기</span>
                ${renderContextTokenStatus(details)}
                ${renderLongTermRetrievalPreview(details.retrieval)}
                ${preview}
            </label>
        `;
        if (details.content) content.querySelector('textarea').value = details.content;
    }

    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

function renderContextTokenStatus(details) {
    const budget = Number.isFinite(details.budget) ? details.budget.toLocaleString() : '제한 없음';
    const tokenSummary = `${details.outputTokenCount.toLocaleString()} / ${budget} tokens`;
    if (!details.truncated) {
        return `
            <div class="stsm-context-token-status">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>${tokenSummary} · 잘림 없음</span>
            </div>
        `;
    }

    const omitted = details.blocks
        .filter(block => block.omittedItems.length)
        .map(block => `<div><strong>${escapeHtml(block.name)}:</strong> ${block.omittedItems.map(item => escapeHtml(item.label)).join(', ')} 제외</div>`)
        .join('');
    return `
        <div class="stsm-context-token-status stsm-context-token-status-warning">
            <div class="stsm-context-token-heading">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <strong>토큰 제한으로 앞쪽 항목부터 제외했어요.</strong>
            </div>
            <div>원본 ${details.originalTokenCount.toLocaleString()} tokens → 전송 ${tokenSummary}</div>
            ${omitted}
        </div>
    `;
}

function renderSummaryRecord(summary, sourceStatus) {
    const hasTranslation = Boolean(summary.translation?.content);
    const tokenCount = getTokenCount(String(summary.content || ''));
    const compressedChild = Boolean(summary.compressedBy);
    const compressionLevel = Number(summary.compression?.level) || 0;
    return `
        <article class="stsm-record${compressedChild ? ' stsm-record-compressed-child stsm-record-long-term' : ''}${compressionLevel ? ' stsm-record-compression' : ''}" data-record-id="${escapeHtml(summary.id)}">
            <header class="stsm-record-header">
                <div class="stsm-record-range">
                    <strong>#${summary.startId} ~ #${summary.endId}</strong>
                    <span>${tokenCount.toLocaleString()} tokens</span>
                    ${compressionLevel ? `<span class="stsm-record-compression-badge">압축 Lv.${compressionLevel}</span>` : ''}
                    ${compressedChild ? '<span class="stsm-record-compressed-child-badge">장기기억</span>' : ''}
                    ${summary.type === 'summary' ? renderRecordMemoryUpdateBadge(summary) : ''}
                    <span class="stsm-record-source-state-slot">${renderSourceState(sourceStatus, summary)}</span>
                </div>
                <div class="stsm-record-actions">
                    ${renderIconButton('detail', 'fa-magnifying-glass', '자세히 보기')}
                    ${compressedChild ? renderIconButton('tag-edit', 'fa-tags', '검색 태그 편집') : ''}
                    ${renderIconButton('copy', 'fa-copy', '복사')}
                    ${renderIconButton('edit', 'fa-pen', '수정')}
                    ${renderIconButton('translate', 'fa-language', hasTranslation ? '번역 재생성' : '번역')}
                    ${hasTranslation ? renderIconButton('translation-toggle', 'fa-right-left', '원문/번역 전환', true) : ''}
                    ${compressedChild ? '' : renderIconButton('chat', 'fa-comments', '요약 수정 대화')}
                    ${compressedChild ? '' : renderIconButton('reroll', 'fa-rotate-right', '재생성')}
                    ${compressedChild ? '' : renderIconButton('delete', 'fa-trash', '삭제')}
                </div>
            </header>
            <div class="stsm-record-content stsm-record-original"${hasTranslation ? ' hidden' : ''}>${escapeHtml(summary.content)}</div>
            <div class="stsm-record-content stsm-record-translation"${hasTranslation ? '' : ' hidden'}>${hasTranslation ? escapeHtml(summary.translation.content) : ''}</div>
            ${renderRecordTagSummary(summary, { showEmpty: compressedChild, prominent: compressedChild })}
            <div class="stsm-record-edit-actions" hidden>
                <button class="stsm-record-save menu_button interactable" type="button">수정</button>
                <button class="stsm-record-cancel menu_button interactable" type="button">취소</button>
            </div>
        </article>
    `;
}

function renderSourceState(status, record) {
    if (record?.type === 'compressed') return '';
    if (!status || status.state === SOURCE_STATES.CURRENT) return '';
    if (status.state === SOURCE_STATES.MOVED) {
        return `<span class="stsm-record-source-state stsm-record-source-moved" title="동일한 원본 메시지가 현재 #${status.startId} ~ #${status.endId}에 있습니다.">ID 이동</span>`;
    }
    if (status.state === SOURCE_STATES.STALE) {
        return '<span class="stsm-record-source-state stsm-record-source-stale" title="요약 당시의 원본 메시지를 현재 채팅에서 찾지 못했습니다.">원문 변경됨</span>';
    }
    return '<span class="stsm-record-source-state stsm-record-source-untracked" title="fingerprint 기능 추가 전에 만들어진 요약 기록입니다.">추적 전 기록</span>';
}

function renderIconButton(action, icon, title, pressed = null) {
    const pressedAttribute = pressed === null ? '' : ` aria-pressed="${String(pressed)}"`;
    return `
        <button class="stsm-record-${action} menu_button menu_button_icon interactable" type="button" title="${title}" aria-label="${title}"${pressedAttribute}>
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}
