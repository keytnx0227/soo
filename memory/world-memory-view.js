import { Popup } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { buildWorldSettingContextDetails } from '../summary/summary-context.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';
import { renderTokenUsageBar } from '../ui/token-usage-view.js';
import { excludeAtlasEntity, resetAtlasEntity, restoreAtlasEntity, showAtlasEditor } from './atlas-editor.js';
import { renderManualAtlasState } from './atlas-manual-editor.js';
import { renderExcludedAtlasEntries } from './atlas-exclusion-view.js';
import { getAtlasTranslations } from './atlas-metadata.js';
import { getWorldAtlas } from './world-memory-service.js';
import { evaluateWorldRetrieval } from './world-retrieval.js';
import { confirmDeleteManualWorldEntry, showManualWorldEntryEditor } from './world-manual-editor.js';

export function bindWorldMemoryView(root) {
    const list = root.querySelector('#stsm-world-memory-list');
    const excluded = root.querySelector('#stsm-world-memory-excluded');
    if (list && !list.dataset.bound) {
        list.dataset.bound = 'true';
        list.addEventListener('click', handleAtlasAction);
    }
    if (excluded && !excluded.dataset.bound) {
        excluded.dataset.bound = 'true';
        excluded.addEventListener('click', handleAtlasAction);
    }
    root.querySelectorAll('[data-world-manual-add]').forEach(button => {
        if (button.dataset.bound) return;
        button.dataset.bound = 'true';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                if (await showManualWorldEntryEditor()) toastr.success('세계 설정을 직접 추가했습니다.');
            } catch (error) {
                handleError(error, '', button);
            } finally {
                button.disabled = false;
            }
        });
    });
    renderWorldMemory(root);
}

export function renderWorldMemory(root) {
    const list = root.querySelector('#stsm-world-memory-list');
    const excludedHost = root.querySelector('#stsm-world-memory-excluded');
    const count = root.querySelector('#stsm-world-memory-count');
    const tokenUsage = root.querySelector('#stsm-world-token-usage');
    const skipped = root.querySelector('#stsm-world-memory-skipped');
    if (!list || !excludedHost || !count || !skipped) return;

    const atlas = getWorldAtlas();
    const settings = getSettings().summarization;
    const translations = getAtlasTranslations('world');
    const retrieval = evaluateWorldRetrieval({
        entries: atlas.world,
        messages: SillyTavern.getContext().chat,
        mode: settings.worldRetrieval.mode,
        messageCount: settings.worldRetrieval.messageCount,
    });
    const retrievalById = new Map(retrieval.map(result => [String(result.entry.id), result]));
    const details = buildWorldSettingContextDetails();
    const block = details.blocks?.find(item => item.kind === SUMMARY_CONTEXT_BLOCK_KINDS.WORLD);
    const blockEnabled = Boolean(details.enabled && block?.enabled);
    const omittedIds = blockEnabled
        ? new Set((block.omittedItems || []).map(item => String(item.id)))
        : new Set();
    const excludedOpen = Boolean(excludedHost.querySelector('.stsm-atlas-excluded')?.open);

    count.textContent = `${atlas.world.length.toLocaleString()}개`;
    if (tokenUsage) {
        tokenUsage.innerHTML = renderTokenUsageBar({
            label: '세계 설정 주입',
            used: block?.outputTokenCount || 0,
            max: block?.budget ?? settings.worldRetrieval.maxTokens,
            enabled: blockEnabled,
        });
    }
    skipped.innerHTML = renderWarnings(atlas.skippedUpdates, atlas.orphanCorrections);
    skipped.hidden = !atlas.skippedUpdates.length && !atlas.orphanCorrections.length;
    list.innerHTML = atlas.world.length
        ? atlas.world.map(entry => renderWorldEntry(
            entry,
            translations[entry.id],
            retrievalById.get(String(entry.id)),
            blockEnabled && omittedIds.has(String(entry.id)),
            blockEnabled,
            settings.worldRetrieval.mode,
        )).join('')
        : '<div class="stsm-empty">아직 추출된 세계 설정이 없습니다.</div>';
    excludedHost.innerHTML = renderExcludedAtlasEntries(atlas.excluded, { open: excludedOpen });
}

function renderWorldEntry(entry, cachedTranslation, retrieval, omittedByBudget, blockEnabled, mode) {
    const translation = getValidAtlasTranslation('world', entry, cachedTranslation || null);
    const hasCorrection = Boolean(Object.keys(entry.manualCorrections || {}).length);
    const unmatched = blockEnabled && mode === 'lorebook' && !retrieval?.eligible;
    const injectionState = unmatched ? 'unmatched' : omittedByBudget ? 'omitted' : null;
    return `
        <article class="stsm-world-card${injectionState ? ' stsm-atlas-card-injection-omitted' : ''}" data-atlas-category="world" data-entity-id="${escapeHtml(entry.id)}">
            <header>
                <div class="stsm-world-key-list">
                    ${entry.keys.map(key => `<span>${escapeHtml(key)}</span>`).join('')}
                    ${renderManualAtlasState(entry)}
                    ${renderInjectionState(injectionState)}
                    ${renderCorrectionState(entry.manualCorrections)}
                </div>
                <div class="stsm-atlas-card-side">
                    <div class="stsm-atlas-card-actions">
                        ${renderAction('edit', 'fa-pen', '수정')}
                        ${hasCorrection && !entry.manual ? renderAction('reset', 'fa-rotate-left', '사용자 수정 초기화') : ''}
                        ${renderAction('translate', 'fa-language', translation ? '번역 재생성' : '번역')}
                        ${translation ? renderAction('toggle-translation', 'fa-right-left', '원문/번역 전환') : ''}
                        ${entry.manual
        ? renderAction('delete-manual', 'fa-trash-can', '직접 추가 항목 삭제')
        : renderAction('exclude', 'fa-trash-can', '도감에서 삭제')}
                    </div>
                    <div class="stsm-atlas-card-meta">
                        <code>${escapeHtml(entry.id)}</code>
                        ${entry.manual
        ? '<span>직접 추가</span>'
        : `<span>#${entry.firstSeenRange.startId} ~ #${entry.lastUpdatedRange.endId}</span>`}
                    </div>
                </div>
            </header>
            <div class="stsm-world-retrieval-state">
                ${retrieval?.matchedKeys?.length
        ? `<i class="fa-solid fa-link" aria-hidden="true"></i> ${retrieval.matchedKeys.length}개 일치: ${retrieval.matchedKeys.map(escapeHtml).join(', ')}`
        : '<i class="fa-solid fa-minus" aria-hidden="true"></i> 현재 문맥 일치 없음'}
            </div>
            <div class="stsm-world-content stsm-atlas-original"${translation ? ' hidden' : ''}>${escapeHtml(entry.content)}</div>
            ${translation ? `<div class="stsm-atlas-translation">${escapeHtml(translation.content)}</div>` : ''}
        </article>
    `;
}

async function handleAtlasAction(event) {
    const button = event.target.closest('[data-atlas-action]');
    const card = button?.closest('[data-entity-id]');
    if (!button || !card) return;
    const list = card.parentElement;
    const entityId = card.dataset.entityId;
    const atlas = getWorldAtlas();
    if (button.dataset.atlasAction === 'restore') {
        const excluded = atlas.excluded.find(entity => entity.id === entityId);
        if (!excluded) return;
        try {
            await restoreAtlasEntity('world', entityId);
            toastr.success('세계 설정을 복원했습니다.');
        } catch (error) {
            handleError(error, entityId, button);
        }
        return;
    }
    const entry = atlas.world.find(item => item.id === entityId);
    if (!entry) return;
    try {
        if (button.dataset.atlasAction === 'edit') {
            if (entry.manual) await showManualWorldEntryEditor(entityId);
            else await showAtlasEditor('world', entityId);
        } else if (button.dataset.atlasAction === 'reset') {
            await resetAtlasEntity('world', entityId, entry.keys.join(', '));
        } else if (button.dataset.atlasAction === 'toggle-translation') {
            toggleTranslation(card, button);
        } else if (button.dataset.atlasAction === 'exclude') {
            if (await excludeAtlasEntity('world', entityId, entry.keys.join(', '))) toastr.success('세계 설정을 도감에서 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'delete-manual') {
            if (await confirmDeleteManualWorldEntry(entityId, entry.keys.join(', '))) toastr.success('직접 추가한 세계 설정을 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'translate') {
            const existing = getValidAtlasTranslation('world', entry);
            if (existing && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
            const operationToken = beginOperation('translating', '세계 설정 번역 중');
            button.disabled = true;
            try {
                await translateAtlasEntity('world', entityId);
                showTranslatedCard(list, entityId);
                toastr.success('세계 설정을 번역했습니다.');
            } finally {
                endOperation(operationToken);
            }
        }
    } catch (error) {
        handleError(error, entityId, button);
    }
}

function handleError(error, entityId, button) {
    console.error('[Chat Summarizer] World atlas action failed:', error);
    addExtensionErrorLog(error, {
        operation: 'atlas',
        title: '세계 설정 작업 실패',
        message: error.message,
        context: { entityId },
    });
    toastr.error(error.message);
    button.disabled = false;
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

function renderInjectionState(state) {
    if (!state) return '';
    const label = state === 'unmatched' ? '키 불일치' : '주입 제외';
    const title = state === 'unmatched'
        ? '로어북식 활성화에서 현재 문맥과 일치하는 키가 없습니다.'
        : '현재 토큰 예산 계산에서 요약 주입본에 포함되지 않습니다.';
    return `<span class="stsm-atlas-injection-state" title="${title}"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i> ${label}</span>`;
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

function renderWarnings(skippedUpdates, orphanCorrections) {
    const entries = [
        ...skippedUpdates.map(update => `#${update.range.startId} ~ #${update.range.endId} · ${update.targetId} · ${update.reason}`),
        ...orphanCorrections.map(id => `${id} · 현재 도감에서 원본 항목을 찾지 못한 사용자 수정`),
    ];
    if (!entries.length) return '';
    return `
        <div class="stsm-world-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <strong>확인이 필요한 세계 설정 데이터</strong>
        </div>
        ${entries.map(entry => `<div>${escapeHtml(entry)}</div>`).join('')}
    `;
}
