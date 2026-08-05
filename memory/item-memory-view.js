import { escapeHtml } from '../core/utils.js';
import { Popup } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { resetAtlasEntity, showAtlasEditor } from './atlas-editor.js';
import { getAtlasTranslations } from './atlas-metadata.js';
import { getItemAtlas } from './item-memory-service.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';

const STATE_LABELS = Object.freeze({
    owner: '소유자',
    holder: '소지자',
    location: '위치',
    condition: '물리 상태',
    status: '서사 상태',
});

export function bindItemMemoryView(root) {
    const list = root.querySelector('#stsm-item-memory-list');
    if (list && !list.dataset.bound) {
        list.dataset.bound = 'true';
        list.addEventListener('click', event => handleAtlasAction(event, 'items'));
    }
    renderItemMemory(root);
}

export function renderItemMemory(root) {
    const list = root.querySelector('#stsm-item-memory-list');
    const count = root.querySelector('#stsm-item-memory-count');
    const skipped = root.querySelector('#stsm-item-memory-skipped');
    if (!list || !count || !skipped) return;

    const atlas = getItemAtlas();
    const translations = getAtlasTranslations('items');
    count.textContent = `${atlas.items.length.toLocaleString()}개`;
    skipped.innerHTML = renderSkippedUpdates(atlas.skippedUpdates, atlas.orphanCorrections);
    skipped.hidden = !atlas.skippedUpdates.length && !atlas.orphanCorrections.length;
    list.innerHTML = atlas.items.length
        ? atlas.items.map(item => renderItem(item, translations[item.id])).join('')
        : '<div class="stsm-empty">아직 추출된 아이템 도감이 없습니다.</div>';
}

function renderItem(item, cachedTranslation) {
    const translation = getValidAtlasTranslation('items', item, cachedTranslation || null);
    const hasCorrection = Boolean(Object.keys(item.manualCorrections || {}).length);
    return `
        <article class="stsm-item-card" data-atlas-category="items" data-entity-id="${escapeHtml(item.id)}">
            <header>
                <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.aliases.length ? `<span>${item.aliases.map(escapeHtml).join(' · ')}</span>` : ''}
                    ${renderCorrectionState(item.manualCorrections)}
                </div>
                <div class="stsm-atlas-card-side">
                    <div class="stsm-atlas-card-actions">
                        ${renderAction('edit', 'fa-pen', '수정')}
                        ${hasCorrection ? renderAction('reset', 'fa-rotate-left', '사용자 수정 초기화') : ''}
                        ${renderAction('translate', 'fa-language', translation ? '번역 재생성' : '번역')}
                        ${translation ? renderAction('toggle-translation', 'fa-right-left', '원문/번역 전환') : ''}
                    </div>
                    <div class="stsm-atlas-card-meta">
                        <code>${escapeHtml(item.id)}</code>
                        <span>#${item.firstSeenRange.startId} ~ #${item.lastUpdatedRange.endId}</span>
                    </div>
                </div>
            </header>
            <div class="stsm-item-fields stsm-atlas-original">
                ${renderField('객관 정보', item.facts)}
                ${renderField('기능', item.functions)}
                ${renderLastKnownState(item.lastKnownState)}
            </div>
            ${translation ? `<div class="stsm-atlas-translation" hidden>${escapeHtml(translation.content)}</div>` : ''}
        </article>
    `;
}

async function handleAtlasAction(event, category) {
    const button = event.target.closest('[data-atlas-action]');
    const card = button?.closest('[data-entity-id]');
    if (!button || !card) return;
    const list = card.parentElement;
    const entityId = card.dataset.entityId;
    const atlas = getItemAtlas();
    const item = atlas.items.find(entity => entity.id === entityId);
    if (!item) return;
    try {
        if (button.dataset.atlasAction === 'edit') {
            await showAtlasEditor(category, entityId);
        } else if (button.dataset.atlasAction === 'reset') {
            await resetAtlasEntity(category, entityId, item.name);
        } else if (button.dataset.atlasAction === 'toggle-translation') {
            toggleTranslation(card, button);
        } else if (button.dataset.atlasAction === 'translate') {
            const existing = getValidAtlasTranslation(category, item);
            if (existing && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
            const operationToken = beginOperation('translating', `${item.name} 도감 번역 중`);
            button.disabled = true;
            try {
                await translateAtlasEntity(category, entityId);
                showTranslatedCard(list, entityId);
                toastr.success('도감 항목을 번역했습니다.');
            } finally {
                endOperation(operationToken);
            }
        }
    } catch (error) {
        console.error('[Chat Summarizer] Item atlas action failed:', error);
        addExtensionErrorLog(error, {
            operation: 'atlas',
            title: '아이템 도감 작업 실패',
            message: error.message,
            context: { entityId },
        });
        toastr.error(error.message);
        button.disabled = false;
    }
}

function toggleTranslation(card, button) {
    const original = card.querySelector('.stsm-atlas-original');
    const translation = card.querySelector('.stsm-atlas-translation');
    if (!original || !translation) return;
    const showTranslation = translation.hidden;
    translation.hidden = !showTranslation;
    original.hidden = showTranslation;
    button.setAttribute('aria-pressed', String(showTranslation));
}

function showTranslatedCard(list, entityId) {
    const refreshedCard = [...(list?.querySelectorAll('[data-entity-id]') || [])]
        .find(element => element.dataset.entityId === entityId);
    const toggle = refreshedCard?.querySelector('[data-atlas-action="toggle-translation"]');
    if (refreshedCard && toggle) toggleTranslation(refreshedCard, toggle);
}

function renderAction(action, icon, title) {
    return `<button class="menu_button menu_button_icon interactable" data-atlas-action="${action}" type="button" title="${title}" aria-label="${title}"><i class="fa-solid ${icon}"></i></button>`;
}

function renderCorrectionState(corrections) {
    const values = Object.values(corrections || {});
    if (!values.length) return '';
    const locked = values.filter(value => value.locked).length;
    return `<span class="stsm-atlas-correction-state"><i class="fa-solid fa-pen"></i> 사용자 수정 ${values.length}${locked ? ` · <i class="fa-solid fa-lock"></i> 잠금 ${locked}` : ''}</span>`;
}

function renderLastKnownState(state) {
    const values = Object.entries(STATE_LABELS)
        .filter(([key]) => state?.[key])
        .map(([key, label]) => `${label}: ${state[key]}`);
    return renderField('마지막 확인 상태', values);
}

function renderField(label, values) {
    if (!Array.isArray(values) || !values.length) return '';
    return `
        <div class="stsm-item-field">
            <strong>${escapeHtml(label)}</strong>
            <div>${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>
        </div>
    `;
}

function renderSkippedUpdates(updates, orphanCorrections) {
    if (!updates.length && !orphanCorrections.length) return '';
    return `
        <div class="stsm-item-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>확인이 필요한 도감 데이터</strong>
        </div>
        ${updates.length ? `<div>미적용 변경안 ${updates.length.toLocaleString()}개</div>` : ''}
        ${updates.map(update => `
            <div>#${update.range.startId} ~ #${update.range.endId} · ${escapeHtml(update.targetId || 'ID 없음')} · ${escapeHtml(update.reason)}</div>
        `).join('')}
        ${orphanCorrections.length ? `<div>대상을 찾지 못한 사용자 수정: ${orphanCorrections.map(escapeHtml).join(', ')}</div>` : ''}
    `;
}
