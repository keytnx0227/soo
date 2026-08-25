import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation, updateOperation } from '../core/extension-state.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { escapeHtml } from '../core/utils.js';
import { formatRanges, getCoveredRanges } from '../summary/range-utils.js';
import {
    clearAtlasRecordReviewOverride,
    getSummaryRecordIndex,
} from '../summary/summary-store.js';
import {
    deleteAtlasReviewRecord,
    getAtlasReviewRecords,
} from './atlas-metadata.js';
import { getAtlasProjection } from './atlas-projection-service.js';
import { translateAtlasReviewChanges } from '../translation/atlas-review-translation-service.js';
import {
    applyAtlasReviewDraft,
    ATLAS_REVIEW_CATEGORIES,
    ATLAS_REVIEW_MODES,
    buildAtlasReviewPromptPreviews,
    createAtlasReviewDraft,
    getAtlasReviewOverview,
    getAtlasReviewRecordCandidates,
} from './atlas-review-service.js';

const ATLAS_COMPARISON_METADATA_FIELDS = new Set([
    'sourceRecordIds',
    'firstSeenRange',
    'lastUpdatedRange',
    'lastObservedRange',
    'provenance',
    'manualCorrections',
    'excluded',
]);

export function bindAtlasReview(root) {
    root.querySelector('#stsm-open-atlas-review')?.addEventListener('click', () => {
        openAtlasReviewPopup().catch(error => logReviewError(error, '도감 재검토 화면 열기 실패'));
    });
}

async function openAtlasReviewPopup() {
    const content = document.createElement('div');
    content.className = 'stsm-atlas-review-popup';
    content.innerHTML = buildReviewMarkup();
    let mode = ATLAS_REVIEW_MODES.QUICK;
    let abortController = null;
    let operationToken = null;
    let draft = null;
    let applied = false;
    let reviewTranslation = null;
    let showingTranslation = false;
    let draftInterruptionMessage = '';
    let applyingDraft = false;
    let tokenTimer = null;
    let tokenRun = 0;

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: async () => {
            if (applyingDraft) {
                toastr.info('재검토 결과를 저장하고 있습니다. 잠시만 기다려주세요.');
                return false;
            }
            if (abortController) abortController.abort();
            if (!draft || applied) return true;
            return await Popup.show.confirm('적용하지 않은 재검토 결과가 있습니다.', '결과를 폐기하고 닫을까요?');
        },
    });

    const render = () => {
        renderStatus(content);
        renderMode(content, mode);
        renderRecordOptions(content);
        renderOverview(content);
        renderHistory(content, { onChanged: render });
        scheduleTokenEstimate();
    };

    const scheduleTokenEstimate = () => {
        clearTimeout(tokenTimer);
        tokenTimer = setTimeout(updateTokenEstimate, 250);
    };

    const updateTokenEstimate = async () => {
        const output = content.querySelector('.stsm-atlas-review-token-value');
        const currentRun = ++tokenRun;
        output.textContent = '입력 완료 후 계산';
        try {
            const input = readReviewInput(content, mode);
            if (!hasCompleteInput(input)) return;
            output.textContent = '계산 중...';
            const prompts = buildAtlasReviewPromptPreviews(input);
            const counts = await Promise.all(prompts.map(prompt => SillyTavern.getContext().getTokenCountAsync(prompt)));
            if (currentRun !== tokenRun) return;
            const total = counts.reduce((sum, count) => sum + count, 0);
            const average = Math.round(total / counts.length);
            output.textContent = counts.length > 1
                ? `예상 평균 ${average.toLocaleString()} tokens · 총 ${total.toLocaleString()} · ${counts.length}회`
                : `예상 ${total.toLocaleString()} tokens · 1회`;
        } catch {
            if (currentRun === tokenRun) output.textContent = '유효한 범위를 선택해주세요';
        }
    };

    content.querySelectorAll('.stsm-atlas-review-mode').forEach(button => {
        button.addEventListener('click', () => {
            if (abortController) return;
            mode = button.dataset.mode;
            draft = null;
            applied = false;
            reviewTranslation = null;
            showingTranslation = false;
            draftInterruptionMessage = '';
            clearDraftResult(content);
            render();
        });
    });
    content.querySelector('.stsm-atlas-review-category').addEventListener('change', render);
    content.querySelectorAll('input, select').forEach(element => element.addEventListener('input', scheduleTokenEstimate));
    content.querySelector('.stsm-atlas-review-cancel').addEventListener('click', () => abortController?.abort());
    content.querySelector('.stsm-atlas-review-run').addEventListener('click', async () => {
        if (abortController) return;
        const input = readReviewInput(content, mode);
        abortController = new AbortController();
        applied = false;
        draft = null;
        reviewTranslation = null;
        showingTranslation = false;
        draftInterruptionMessage = '';
        clearDraftResult(content);
        try {
            operationToken = beginOperation('reviewing-atlas', `${ATLAS_REVIEW_CATEGORIES[input.category]} 재검토 준비 중`);
            setReviewingState(content, true);
            draft = await createAtlasReviewDraft({
                ...input,
                signal: abortController.signal,
                onProgress: ({ current, total, target }) => {
                    const actionLabel = input.mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL
                        ? '시간순 재구축 중'
                        : '재검토 중';
                    updateOperation(
                        operationToken,
                        `#${target.startId} ~ #${target.endId} ${ATLAS_REVIEW_CATEGORIES[input.category]} ${actionLabel}`,
                    );
                    content.querySelector('.stsm-atlas-review-run').textContent = `${actionLabel} ${current}/${total}`;
                },
            });
            renderDraftResult(content, draft, draftInterruptionMessage, reviewTranslation, showingTranslation);
            toastr.success('재검토 초안을 생성했습니다. 결과를 확인한 뒤 적용해주세요.');
        } catch (error) {
            draft = error?.atlasReviewDraft?.entries?.length ? error.atlasReviewDraft : null;
            draftInterruptionMessage = draft ? error.message : '';
            if (draft) renderDraftResult(content, draft, draftInterruptionMessage, reviewTranslation, showingTranslation);
            if (error?.code === 'STSM_ATLAS_REVIEW_CANCELLED') toastr.info(error.message);
            else logReviewError(error, '도감 재검토 실패');
        } finally {
            if (operationToken) endOperation(operationToken);
            operationToken = null;
            abortController = null;
            setReviewingState(content, false);
            setDraftPendingState(content, Boolean(draft));
        }
    });
    content.querySelector('.stsm-atlas-review-result').addEventListener('click', async event => {
        if (event.target.closest('.stsm-atlas-review-toggle-translation') && reviewTranslation && draft) {
            showingTranslation = !showingTranslation;
            renderDraftResult(content, draft, draftInterruptionMessage, reviewTranslation, showingTranslation);
            return;
        }
        if (event.target.closest('.stsm-atlas-review-translate') && draft) {
            if (reviewTranslation && !await Popup.show.confirm(
                '검토 결과 번역을 재생성할까요?',
                '현재 번역은 덮어씌워집니다.',
            )) return;
            const draftId = draft.id;
            const changes = compareAtlas(draft.before, draft.after);
            const translationToken = beginOperation('translating', '도감 재검토 결과 번역 중');
            setDraftResultBusy(content, true);
            try {
                const translated = await translateAtlasReviewChanges(changes);
                if (!draft || draft.id !== draftId) return;
                reviewTranslation = translated;
                showingTranslation = true;
                renderDraftResult(content, draft, draftInterruptionMessage, reviewTranslation, showingTranslation);
                toastr.success('재검토 결과를 번역했습니다.');
            } catch (error) {
                logReviewError(error, '도감 재검토 결과 번역 실패', 'atlas-review-translation');
            } finally {
                endOperation(translationToken);
                setDraftResultBusy(content, false);
            }
            return;
        }
        if (event.target.closest('.stsm-atlas-review-discard')) {
            draft = null;
            applied = false;
            reviewTranslation = null;
            showingTranslation = false;
            draftInterruptionMessage = '';
            clearDraftResult(content);
            setDraftPendingState(content, false);
            return;
        }
        if (!event.target.closest('.stsm-atlas-review-apply') || !draft || applyingDraft) return;
        applyingDraft = true;
        let applyToken = null;
        setDraftApplyState(content, true);
        try {
            applyToken = beginOperation('saving-atlas-review', '도감 재검토 결과 저장 중');
            await applyAtlasReviewDraft(draft);
            applied = true;
            draft = null;
            reviewTranslation = null;
            showingTranslation = false;
            draftInterruptionMessage = '';
            clearDraftResult(content);
            setDraftPendingState(content, false);
            render();
            toastr.success('도감 재검토 결과를 적용했습니다.');
        } catch (error) {
            logReviewError(error, '도감 재검토 결과 적용 실패');
        } finally {
            applyingDraft = false;
            if (applyToken) endOperation(applyToken);
            if (draft) setDraftApplyState(content, false, draft.completed);
        }
    });

    render();
    await popup.show();
}

function buildReviewMarkup() {
    return `
        <strong class="stsm-section-title">도감 재검토 요청</strong>
        <div class="stsm-atlas-review-status"></div>
        <div class="stsm-atlas-review-mode-tabs" role="tablist" aria-label="재검토 방식">
            <button class="stsm-atlas-review-mode menu_button interactable" data-mode="quick" type="button">빠른 일괄 검토</button>
            <button class="stsm-atlas-review-mode menu_button interactable" data-mode="record" type="button">레코드별 정밀 검토</button>
            <button class="stsm-atlas-review-mode menu_button interactable" data-mode="chronological" type="button">시간순 레코드 재구축</button>
        </div>
        <label class="stsm-field">
            <span>재검토할 도감</span>
            <select class="stsm-atlas-review-category text_pole">
                ${Object.entries(ATLAS_REVIEW_CATEGORIES).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
            </select>
        </label>
        <div class="stsm-atlas-review-quick-fields stsm-grid-two">
            <label class="stsm-field"><span>시작 채팅 ID</span><input class="stsm-atlas-review-start text_pole" type="number" min="0" step="1" /></label>
            <label class="stsm-field"><span>종료 채팅 ID</span><input class="stsm-atlas-review-end text_pole" type="number" min="0" step="1" /></label>
        </div>
        <div class="stsm-atlas-review-record-fields stsm-grid-two" hidden>
            <label class="stsm-field"><span>시작 요약 레코드</span><select class="stsm-atlas-review-record-start text_pole"></select></label>
            <label class="stsm-field"><span>종료 요약 레코드</span><select class="stsm-atlas-review-record-end text_pole"></select></label>
        </div>
        <p class="stsm-atlas-review-help"></p>
        <div class="stsm-atlas-review-token"><span>프롬프트 입력 토큰</span><strong class="stsm-atlas-review-token-value">입력 완료 후 계산</strong></div>
        <div class="stsm-atlas-review-actions">
            <button class="stsm-atlas-review-run menu_button interactable" type="button">재검토 요청</button>
            <button class="stsm-atlas-review-cancel menu_button interactable" type="button" hidden><i class="fa-solid fa-stop" aria-hidden="true"></i><span>중단</span></button>
        </div>
        <section class="stsm-atlas-review-result" hidden></section>
        <details class="stsm-atlas-review-overview"><summary>도감 처리 현황</summary><div class="stsm-atlas-review-overview-body"></div></details>
        <details class="stsm-atlas-review-history"><summary>적용된 재검토 기록</summary><div class="stsm-atlas-review-history-list"></div></details>
    `;
}

function renderStatus(content) {
    const chat = SillyTavern.getContext().chat;
    const records = getSummaryRecordIndex();
    const ranges = getCoveredRanges(records);
    const summarized = ranges.reduce((total, range) => {
        const startId = Math.max(0, range.startId);
        const endId = Math.min((chat?.length || 0) - 1, range.endId);
        return total + Math.max(0, endId - startId + 1);
    }, 0);
    const lastId = records.length ? Math.max(...records.map(record => record.endId)) : null;
    content.querySelector('.stsm-atlas-review-status').innerHTML = `
        <div><span>전체 메시지</span><strong>${(chat?.length || 0).toLocaleString()}</strong></div>
        <div><span>요약된 메시지</span><strong>${summarized.toLocaleString()}</strong></div>
        <div><span>마지막 요약 ID</span><strong>${lastId === null ? '-' : `#${lastId}`}</strong></div>
    `;
}

function renderMode(content, mode) {
    content.querySelectorAll('.stsm-atlas-review-mode').forEach(button => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('stsm-atlas-review-mode-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    const recordMode = mode === ATLAS_REVIEW_MODES.RECORD || mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL;
    content.querySelector('.stsm-atlas-review-quick-fields').hidden = mode !== ATLAS_REVIEW_MODES.QUICK;
    content.querySelector('.stsm-atlas-review-record-fields').hidden = !recordMode;
    content.querySelector('.stsm-atlas-review-help').textContent = mode === ATLAS_REVIEW_MODES.QUICK
        ? '선택한 메시지 범위 전체를 한 번에 검토합니다. 결과는 요청 시점의 도감 계산 흐름에 적용됩니다.'
        : mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL
            ? '선택한 요약 레코드를 시간순으로 다시 읽으며, 각 시점 직전의 도감과 이전 요약을 바탕으로 해당 도감 변경안만 재구축합니다.'
            : '선택한 일반 요약 레코드를 하나씩 정밀 검토합니다. 승인하면 각 레코드의 해당 도감 변경안이 복원 가능한 재검토판으로 교체됩니다.';
}

function renderRecordOptions(content) {
    const category = content.querySelector('.stsm-atlas-review-category').value;
    const records = getAtlasReviewRecordCandidates();
    const options = records.map(record => {
        const reviewed = record.atlasReviewOverrides?.[category] ? ' · 재검토됨' : '';
        return `<option value="${escapeHtml(record.id)}">#${record.startId} ~ #${record.endId}${reviewed}</option>`;
    }).join('');
    for (const select of content.querySelectorAll('.stsm-atlas-review-record-start, .stsm-atlas-review-record-end')) {
        const previous = select.value;
        select.innerHTML = `<option value="">선택</option>${options}`;
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
}

function renderOverview(content) {
    const category = content.querySelector('.stsm-atlas-review-category').value;
    const overview = getAtlasReviewOverview(category);
    content.querySelector('.stsm-atlas-review-overview-body').innerHTML = `
        <div><strong>도감 추출 활성 범위</strong><span>${escapeHtml(formatRanges(overview.processedRanges))}</span></div>
        <div><strong>변경안 발생 범위</strong><span>${escapeHtml(formatRanges(overview.changedRanges))}</span></div>
        <div><strong>일괄 재검토 적용 범위</strong><span>${escapeHtml(formatRanges(overview.reviewedRanges))}</span></div>
    `;
}

function renderHistory(content, { onChanged }) {
    const category = content.querySelector('.stsm-atlas-review-category').value;
    const quick = getAtlasReviewRecords().filter(record => record.category === category);
    const recordOverrides = getAtlasReviewRecordCandidates().filter(record => record.atlasReviewOverrides?.[category]);
    const list = content.querySelector('.stsm-atlas-review-history-list');
    list.innerHTML = [
        ...quick.map(record => historyItem({
            id: record.id,
            type: 'quick',
            title: `일괄 검토 · #${record.startId} ~ #${record.endId}`,
            detail: `#${record.appliedThroughId} 시점에 적용`,
        })),
        ...recordOverrides.map(record => historyItem({
            id: record.id,
            type: 'record',
            title: `레코드별 검토 · #${record.startId} ~ #${record.endId}`,
            detail: '원본 도감 변경안으로 초기화 가능',
        })),
    ].join('') || '<div class="stsm-empty">적용된 재검토 기록이 없습니다.</div>';
    list.querySelectorAll('[data-review-id] button').forEach(button => {
        button.addEventListener('click', async () => {
            const row = button.closest('[data-review-id]');
            const isQuick = row.dataset.reviewType === 'quick';
            const record = isQuick
                ? quick.find(item => item.id === row.dataset.reviewId)
                : recordOverrides.find(item => item.id === row.dataset.reviewId);
            if (!record) {
                toastr.warning('초기화할 재검토 기록을 찾지 못했습니다.');
                return;
            }
            const confirmed = await showReviewRemovalConfirmation({ record, category, isQuick });
            if (!confirmed) return;
            button.disabled = true;
            try {
                if (isQuick) await deleteAtlasReviewRecord(row.dataset.reviewId);
                else await clearAtlasRecordReviewOverride(row.dataset.reviewId, category);
                onChanged();
            } catch (error) {
                logReviewError(error, '도감 재검토 기록 초기화 실패');
                button.disabled = false;
            }
        });
    });
}

async function showReviewRemovalConfirmation({ record, category, isQuick }) {
    const before = getAtlasProjection()[category];
    const originalUpdates = record.structuredSummary?.data?.memoryUpdates?.[category]
        || { created: [], updated: [] };
    const storedUpdates = isQuick
        ? record.memoryUpdates
        : record.atlasReviewOverrides?.[category]?.memoryUpdates;
    const after = getAtlasProjection(isQuick
        ? { excludeReviewIds: [record.id] }
        : { draftRecordOverrides: [{ recordId: record.id, category, memoryUpdates: originalUpdates }] })[category];
    const changes = compareAtlas(before, after);
    const content = document.createElement('div');
    content.className = 'stsm-atlas-review-removal-popup';
    content.innerHTML = `
        <strong class="stsm-section-title">${isQuick ? '일괄 재검토 기록 삭제' : '레코드별 재검토판 초기화'}</strong>
        <p>${isQuick
        ? `#${record.startId} ~ #${record.endId} 재검토 변경안을 도감 계산에서 제거합니다.`
        : `#${record.startId} ~ #${record.endId} 레코드를 요약 당시의 도감 변경안으로 되돌립니다.`}</p>
        <div class="stsm-atlas-review-removal-summary">
            <span>복원 ${changes.created.length}</span>
            <span>변경 ${changes.updated.length}</span>
            <span>제거 ${changes.removed.length}</span>
        </div>
        <div class="stsm-atlas-review-result-list">
            ${renderRemovalChanges(changes)}
        </div>
        <details class="stsm-atlas-review-stored-update">
            <summary>저장된 재검토 변경안 원문</summary>
            <pre>${escapeHtml(JSON.stringify(storedUpdates || { created: [], updated: [] }, null, 2))}</pre>
        </details>
    `;
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: isQuick ? '기록 삭제' : '재검토판 초기화',
        cancelButton: '취소',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function renderRemovalChanges(changes) {
    const entries = [
        ...changes.created.map(change => ({ ...change, label: '복원' })),
        ...changes.updated.map(change => ({ ...change, label: '변경' })),
        ...changes.removed.map(change => ({ ...change, label: '제거' })),
    ];
    return entries.map(change => `
        <details>
            <summary><span class="stsm-atlas-review-change-${change.type}">${change.label}</span> ${escapeHtml(change.name)}</summary>
            <pre>${escapeHtml(JSON.stringify(change.value, null, 2))}</pre>
        </details>
    `).join('') || '<div class="stsm-empty">현재 계산된 도감에는 달라지는 항목이 없습니다.</div>';
}

function historyItem({ id, type, title, detail }) {
    return `<div class="stsm-atlas-review-history-item" data-review-id="${escapeHtml(id)}" data-review-type="${type}">
        <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
        <button class="menu_button menu_button_icon interactable" type="button" title="재검토 결과 초기화" aria-label="재검토 결과 초기화"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    </div>`;
}

function renderDraftResult(content, draft, interruptionMessage = '', translation = null, showingTranslation = false) {
    const result = content.querySelector('.stsm-atlas-review-result');
    const changes = compareAtlas(draft.before, draft.after);
    const changeCount = changes.created.length + changes.updated.length + changes.removed.length;
    result.hidden = false;
    result.innerHTML = `
        <div class="stsm-atlas-review-result-heading">
            <strong>적용 전 검토 결과</strong>
            <div class="stsm-atlas-review-result-tools">
                <span>신규 ${changes.created.length} · 변경 ${changes.updated.length} · 제외 ${changes.removed.length}</span>
                ${changeCount ? `<button class="stsm-atlas-review-translate menu_button menu_button_icon interactable" type="button" title="${translation ? '번역 재생성' : '검토 결과 번역'}" aria-label="${translation ? '번역 재생성' : '검토 결과 번역'}"><i class="fa-solid fa-language" aria-hidden="true"></i></button>` : ''}
                ${translation ? `<button class="stsm-atlas-review-toggle-translation menu_button menu_button_icon interactable" type="button" title="원문/번역 전환" aria-label="원문/번역 전환"><i class="fa-solid fa-right-left" aria-hidden="true"></i></button>` : ''}
            </div>
        </div>
        ${interruptionMessage ? `<p class="stsm-atlas-review-interruption">${escapeHtml(interruptionMessage)}</p>` : ''}
        <div class="stsm-atlas-review-result-list"${showingTranslation && translation ? ' hidden' : ''}>
            ${[...changes.created, ...changes.updated, ...changes.removed].map(change => `
                <details><summary><span class="stsm-atlas-review-change-${change.type}">${escapeHtml(change.label)}</span> ${escapeHtml(change.name)}</summary><pre>${escapeHtml(JSON.stringify(change.value, null, 2))}</pre></details>
            `).join('') || '<div class="stsm-empty">도감 계산 결과에 달라지는 항목이 없습니다.</div>'}
        </div>
        ${translation ? `<pre class="stsm-atlas-review-result-translation"${showingTranslation ? '' : ' hidden'}>${escapeHtml(translation.content)}</pre>` : ''}
        ${changeCount === 0 && draft.entries.length ? '<p class="stsm-atlas-review-no-effect">재검토 변경안은 생성됐지만 현재 최종 도감에는 영향을 주지 않습니다. 같은 값이 이미 반영됐거나 이후 레코드·사용자 수정이 해당 값을 덮고 있을 수 있습니다.</p>' : ''}
        <details class="stsm-atlas-review-stored-update">
            <summary>생성된 재검토 변경안 원문</summary>
            <div class="stsm-atlas-review-draft-entries">
                ${draft.entries.map(entry => `
                    <section>
                        <strong>#${entry.startId} ~ #${entry.endId}</strong>
                        <pre>${escapeHtml(JSON.stringify(entry.memoryUpdates || { created: [], updated: [] }, null, 2))}</pre>
                    </section>
                `).join('')}
            </div>
        </details>
        <div class="stsm-atlas-review-result-actions">
            <button class="stsm-atlas-review-apply menu_button interactable" type="button">${draft.completed ? '전체 적용' : '완료된 결과 적용'}</button>
            <button class="stsm-atlas-review-discard menu_button interactable" type="button">폐기</button>
        </div>
    `;
}

function compareAtlas(before, after) {
    const beforeMap = new Map((before || []).map(item => [item.id, toSemanticAtlasValue(item)]));
    const afterMap = new Map((after || []).map(item => [item.id, toSemanticAtlasValue(item)]));
    const created = [];
    const updated = [];
    const removed = [];
    for (const [id, value] of afterMap) {
        const previous = beforeMap.get(id);
        if (!previous) created.push(changeItem('created', '신규', value));
        else if (JSON.stringify(previous) !== JSON.stringify(value)) updated.push(changeItem('updated', '변경', { before: previous, after: value }));
    }
    for (const [id, value] of beforeMap) {
        if (!afterMap.has(id)) removed.push(changeItem('removed', '제외', value));
    }
    return { created, updated, removed };
}

function toSemanticAtlasValue(value) {
    if (Array.isArray(value)) return value.map(toSemanticAtlasValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !ATLAS_COMPARISON_METADATA_FIELDS.has(key))
        .map(([key, entry]) => [key, toSemanticAtlasValue(entry)]));
}

function changeItem(type, label, value) {
    const source = value.after || value;
    return { type, label, value, name: source.name || source.title || source.content || source.id || '항목' };
}

function readReviewInput(content, mode) {
    return {
        mode,
        category: content.querySelector('.stsm-atlas-review-category').value,
        startId: content.querySelector('.stsm-atlas-review-start').value,
        endId: content.querySelector('.stsm-atlas-review-end').value,
        startRecordId: content.querySelector('.stsm-atlas-review-record-start').value,
        endRecordId: content.querySelector('.stsm-atlas-review-record-end').value,
    };
}

function hasCompleteInput(input) {
    return input.mode === ATLAS_REVIEW_MODES.RECORD || input.mode === ATLAS_REVIEW_MODES.CHRONOLOGICAL
        ? Boolean(input.startRecordId && input.endRecordId)
        : String(input.startId).trim() !== '' && String(input.endId).trim() !== '';
}

function setReviewingState(content, reviewing) {
    content.querySelectorAll('input, select, .stsm-atlas-review-mode').forEach(element => { element.disabled = reviewing; });
    const runButton = content.querySelector('.stsm-atlas-review-run');
    runButton.disabled = reviewing;
    if (!reviewing) runButton.textContent = '재검토 요청';
    content.querySelector('.stsm-atlas-review-cancel').hidden = !reviewing;
}

function setDraftPendingState(content, pending) {
    content.querySelectorAll('input, select, .stsm-atlas-review-mode, .stsm-atlas-review-run')
        .forEach(element => { element.disabled = pending; });
}

function clearDraftResult(content) {
    const result = content.querySelector('.stsm-atlas-review-result');
    result.hidden = true;
    result.innerHTML = '';
}

function setDraftResultBusy(content, busy) {
    content.querySelectorAll('.stsm-atlas-review-result button').forEach(button => { button.disabled = busy; });
}

function setDraftApplyState(content, saving, completed = true) {
    setDraftResultBusy(content, saving);
    const button = content.querySelector('.stsm-atlas-review-apply');
    if (!button) return;
    button.innerHTML = saving
        ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>저장 중</span>'
        : completed ? '전체 적용' : '완료된 결과 적용';
}

function logReviewError(error, title, operation = 'atlas-review') {
    console.error(`[Chat Summarizer] ${title}:`, error);
    addExtensionErrorLog(error, {
        operation,
        title,
        message: error.message || title,
    });
    toastr.error(error.message || title);
}
