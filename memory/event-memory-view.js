import { Popup } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';
import { excludeAtlasEntity, resetAtlasEntity, restoreAtlasEntity, showAtlasEditor } from './atlas-editor.js';
import { confirmDeleteManualAtlasEntry, renderManualAtlasState, showManualAtlasEntryEditor } from './atlas-manual-editor.js';
import { renderExcludedAtlasEntries } from './atlas-exclusion-view.js';
import { getAtlasTranslations } from './atlas-metadata.js';
import { getEventAtlas } from './event-memory-service.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { renderTokenUsageBar } from '../ui/token-usage-view.js';

export function bindEventMemoryView(root, initialContextDetails = null) {
    const list = root.querySelector('#stsm-event-memory-list');
    const excluded = root.querySelector('#stsm-event-memory-excluded');
    if (list && !list.dataset.bound) {
        list.dataset.bound = 'true';
        list.addEventListener('click', handleAtlasAction);
    }
    if (excluded && !excluded.dataset.bound) {
        excluded.dataset.bound = 'true';
        excluded.addEventListener('click', handleAtlasAction);
    }
    renderEventMemory(root, initialContextDetails);
}

export function renderEventMemory(root, contextDetails = null) {
    const list = root.querySelector('#stsm-event-memory-list');
    const excludedHost = root.querySelector('#stsm-event-memory-excluded');
    const count = root.querySelector('#stsm-event-memory-count');
    const tokenUsage = root.querySelector('#stsm-event-token-usage');
    const skipped = root.querySelector('#stsm-event-memory-skipped');
    if (!list || !excludedHost || !count || !skipped) return;

    const atlas = getEventAtlas();
    const translations = getAtlasTranslations('events');
    const excludedOpen = Boolean(excludedHost.querySelector('.stsm-atlas-excluded')?.open);
    count.textContent = `${atlas.events.length.toLocaleString()}개`;
    let omittedIds = new Set();
    if (tokenUsage) {
        const details = contextDetails || buildSummaryContextDetails();
        const block = details.blocks?.find(item => item.kind === SUMMARY_CONTEXT_BLOCK_KINDS.EVENTS);
        if (details.enabled && block?.enabled) {
            omittedIds = new Set((block.omittedItems || []).map(item => String(item.id)));
        }
        tokenUsage.innerHTML = renderTokenUsageBar({
            label: '주요 사건 주입',
            used: block?.outputTokenCount || 0,
            max: block?.budget ?? getSettings().summarization.eventInjectionMaxTokens,
            enabled: Boolean(details.enabled && block?.enabled),
        });
    }
    skipped.innerHTML = renderWarnings(atlas.skippedUpdates, atlas.orphanCorrections);
    skipped.hidden = !atlas.skippedUpdates.length && !atlas.orphanCorrections.length;
    list.innerHTML = atlas.events.length
        ? atlas.events.map(event => renderEvent(
            event,
            translations[event.id],
            omittedIds.has(String(event.id)),
        )).join('')
        : '<div class="stsm-empty">아직 추출된 주요 사건이 없습니다.</div>';
    excludedHost.innerHTML = renderExcludedAtlasEntries(atlas.excluded, { open: excludedOpen });
}

function renderEvent(event, cachedTranslation, omitted) {
    const translation = getValidAtlasTranslation('events', event, cachedTranslation || null);
    const hasCorrection = Boolean(Object.keys(event.manualCorrections || {}).length);
    const major = event.importance === 'major';
    return `
        <article class="stsm-event-card${major ? ' stsm-event-card-turning-point' : ''}${omitted ? ' stsm-atlas-card-injection-omitted' : ''}" data-atlas-category="events" data-entity-id="${escapeHtml(event.id)}">
            <header>
                <div>
                    <span class="stsm-event-title-line">
                        <strong>${escapeHtml(event.title)}</strong>
                        <span class="stsm-event-importance ${major ? 'is-turning-point' : ''}">${major ? '<i class="fa-solid fa-bolt" aria-hidden="true"></i> Major' : 'Minor'}</span>
                        ${renderInjectionState(omitted)}
                    </span>
                    ${renderManualAtlasState(event)}
                    ${renderCorrectionState(event.manualCorrections)}
                </div>
                <div class="stsm-atlas-card-side">
                    <div class="stsm-atlas-card-actions">
                        ${renderAction('edit', 'fa-pen', '수정')}
                        ${hasCorrection && !event.manual ? renderAction('reset', 'fa-rotate-left', '사용자 수정 초기화') : ''}
                        ${renderAction('translate', 'fa-language', translation ? '번역 재생성' : '번역')}
                        ${translation ? renderAction('toggle-translation', 'fa-right-left', '원문/번역 전환') : ''}
                        ${event.manual ? renderAction('delete-manual', 'fa-trash-can', '직접 추가 항목 삭제') : renderAction('exclude', 'fa-trash-can', '도감에서 삭제')}
                    </div>
                    <div class="stsm-atlas-card-meta">
                        <code>${escapeHtml(event.id)}</code>
                        <span>${event.manual ? '직접 추가' : `#${event.firstSeenRange.startId} ~ #${event.lastUpdatedRange.endId}`}</span>
                    </div>
                </div>
            </header>
            <div class="stsm-event-fields stsm-atlas-original"${translation ? ' hidden' : ''}>
                ${renderField('날짜', event.date ? [event.date] : [])}
                ${renderField('장소', event.location ? [event.location] : [])}
                ${renderTextField('사건', event.summary)}
                ${major && event.shift ? renderTextField('SHIFT', event.shift, true) : ''}
            </div>
            ${translation ? `<div class="stsm-atlas-translation">${escapeHtml(translation.content)}</div>` : ''}
        </article>
    `;
}

function renderInjectionState(omitted) {
    return omitted
        ? '<span class="stsm-atlas-injection-state" title="현재 토큰 예산 계산에서 요약 주입본에 포함되지 않습니다."><i class="fa-solid fa-eye-slash" aria-hidden="true"></i> 주입 제외</span>'
        : '';
}

async function handleAtlasAction(event) {
    const button = event.target.closest('[data-atlas-action]');
    const card = button?.closest('[data-entity-id]');
    if (!button || !card) return;
    const list = card.parentElement;
    const entityId = card.dataset.entityId;
    const atlas = getEventAtlas();
    if (button.dataset.atlasAction === 'restore') {
        const excluded = atlas.excluded.find(entity => entity.id === entityId);
        if (!excluded) return;
        try {
            await restoreAtlasEntity('events', entityId);
            toastr.success(`${excluded.title}을(를) 주요 사건에 복원했습니다.`);
        } catch (error) {
            handleError(error, entityId);
        }
        return;
    }
    const entry = atlas.events.find(item => item.id === entityId);
    if (!entry) return;
    try {
        if (button.dataset.atlasAction === 'edit') {
            if (entry.manual) await showManualAtlasEntryEditor('events', entityId);
            else await showAtlasEditor('events', entityId);
        } else if (button.dataset.atlasAction === 'reset') {
            await resetAtlasEntity('events', entityId, entry.title);
        } else if (button.dataset.atlasAction === 'toggle-translation') {
            toggleTranslation(card, button);
        } else if (button.dataset.atlasAction === 'exclude') {
            if (await excludeAtlasEntity('events', entityId, entry.title)) toastr.success('사건을 도감에서 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'delete-manual') {
            if (await confirmDeleteManualAtlasEntry('events', entityId, entry.title)) toastr.success('직접 추가한 사건을 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'translate') {
            const existing = getValidAtlasTranslation('events', entry);
            if (existing && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
            const operationToken = beginOperation('translating', `${entry.title} 사건 번역 중`);
            button.disabled = true;
            try {
                await translateAtlasEntity('events', entityId);
                showTranslatedCard(list, entityId);
                toastr.success('주요 사건을 번역했습니다.');
            } finally {
                endOperation(operationToken);
            }
        }
    } catch (error) {
        handleError(error, entityId);
        button.disabled = false;
    }
}

function handleError(error, entityId) {
    console.error('[Chat Summarizer] Major event atlas action failed:', error);
    addExtensionErrorLog(error, {
        operation: 'atlas',
        title: '주요 사건 작업 실패',
        message: error.message,
        context: { entityId },
    });
    toastr.error(error.message);
}

function toggleTranslation(card, button) {
    const original = card.querySelector('.stsm-atlas-original');
    const translation = card.querySelector('.stsm-atlas-translation');
    if (!original || !translation) return;
    setTranslationVisibility(card, button, translation.hidden);
}

function showTranslatedCard(list, entityId) {
    const refreshedCard = [...(list?.querySelectorAll('[data-entity-id]') || [])]
        .find(element => element.dataset.entityId === entityId);
    const toggle = refreshedCard?.querySelector('[data-atlas-action="toggle-translation"]');
    if (refreshedCard && toggle) setTranslationVisibility(refreshedCard, toggle, true);
}

function setTranslationVisibility(card, button, showTranslation) {
    const original = card.querySelector('.stsm-atlas-original');
    const translation = card.querySelector('.stsm-atlas-translation');
    if (!original || !translation) return;
    translation.hidden = !showTranslation;
    original.hidden = showTranslation;
    button.setAttribute('aria-pressed', String(showTranslation));
}

function renderTextField(label, value, emphasized = false) {
    return value ? `<div class="stsm-event-field${emphasized ? ' stsm-event-shifts' : ''}"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value)}</p></div>` : '';
}

function renderField(label, values, emphasized = false) {
    if (!Array.isArray(values) || !values.length) return '';
    return `<div class="stsm-event-field${emphasized ? ' stsm-event-shifts' : ''}"><strong>${escapeHtml(label)}</strong><div>${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div></div>`;
}

function renderAction(action, icon, title) {
    const pressed = action === 'toggle-translation' ? ' aria-pressed="true"' : '';
    return `<button class="menu_button menu_button_icon interactable" data-atlas-action="${action}" type="button" title="${title}" aria-label="${title}"${pressed}><i class="fa-solid ${icon}"></i></button>`;
}

function renderCorrectionState(corrections) {
    const values = Object.values(corrections || {});
    if (!values.length) return '';
    const locked = values.filter(value => value.locked).length;
    return `<span class="stsm-atlas-correction-state"><i class="fa-solid fa-pen"></i> 사용자 수정 ${values.length}${locked ? ` · <i class="fa-solid fa-lock"></i> 잠금 ${locked}` : ''}</span>`;
}

function renderWarnings(updates, orphanCorrections) {
    if (!updates.length && !orphanCorrections.length) return '';
    return `
        <div class="stsm-event-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>확인이 필요한 사건 데이터</strong>
        </div>
        ${updates.length ? `<div>미적용 변경안 ${updates.length.toLocaleString()}개</div>` : ''}
        ${updates.map(update => `<div>#${update.range.startId} ~ #${update.range.endId} · ${escapeHtml(update.targetId || 'ID 없음')} · ${escapeHtml(update.reason)}</div>`).join('')}
        ${orphanCorrections.length ? `<div>원본을 찾지 못한 사용자 수정 ${orphanCorrections.length.toLocaleString()}개</div>` : ''}
        ${orphanCorrections.map(id => `<div>${escapeHtml(id)} · 생성 근거 레코드가 현재 존재하지 않습니다.</div>`).join('')}
    `;
}
