import { Popup } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';
import {
    excludeAtlasEntity,
    resetAtlasEntity,
    restoreAtlasEntity,
    setAtlasFieldValues,
    showAtlasEditor,
} from './atlas-editor.js';
import { renderExcludedAtlasEntries } from './atlas-exclusion-view.js';
import { getAtlasTranslations } from './atlas-metadata.js';
import { getCommitmentAtlas } from './commitment-memory-service.js';

const STATUS_LABELS = Object.freeze({
    pending: '미이행',
    fulfilled: '이행',
    obsolete: '의미 없어짐',
});

export function bindCommitmentMemoryView(root) {
    const list = root.querySelector('#stsm-commitment-memory-list');
    const excluded = root.querySelector('#stsm-commitment-memory-excluded');
    if (list && !list.dataset.bound) {
        list.dataset.bound = 'true';
        list.addEventListener('click', event => handleAtlasAction(event, 'commitments'));
        list.addEventListener('change', event => handleStatusChange(event));
    }
    if (excluded && !excluded.dataset.bound) {
        excluded.dataset.bound = 'true';
        excluded.addEventListener('click', event => handleAtlasAction(event, 'commitments'));
    }
    renderCommitmentMemory(root);
}

export function renderCommitmentMemory(root) {
    const list = root.querySelector('#stsm-commitment-memory-list');
    const excludedHost = root.querySelector('#stsm-commitment-memory-excluded');
    const count = root.querySelector('#stsm-commitment-memory-count');
    const skipped = root.querySelector('#stsm-commitment-memory-skipped');
    if (!list || !excludedHost || !count || !skipped) return;

    const atlas = getCommitmentAtlas();
    const translations = getAtlasTranslations('commitments');
    const excludedOpen = Boolean(excludedHost.querySelector('.stsm-atlas-excluded')?.open);
    count.textContent = `${atlas.commitments.length.toLocaleString()}개`;
    skipped.innerHTML = renderWarnings(atlas.skippedUpdates, atlas.orphanCorrections);
    skipped.hidden = !atlas.skippedUpdates.length && !atlas.orphanCorrections.length;
    list.innerHTML = atlas.commitments.length
        ? atlas.commitments.map(commitment => renderCommitment(commitment, translations[commitment.id])).join('')
        : '<div class="stsm-empty">아직 추출된 서약이 없습니다.</div>';
    excludedHost.innerHTML = renderExcludedAtlasEntries(atlas.excluded, { open: excludedOpen });
}

function renderCommitment(commitment, cachedTranslation) {
    const translation = getValidAtlasTranslation('commitments', commitment, cachedTranslation || null);
    const hasCorrection = Boolean(Object.keys(commitment.manualCorrections || {}).length);
    return `
        <article class="stsm-commitment-card" data-atlas-category="commitments" data-entity-id="${escapeHtml(commitment.id)}">
            <header>
                <div>
                    <strong>${escapeHtml(commitment.title)}</strong>
                    ${renderCorrectionState(commitment.manualCorrections)}
                </div>
                <div class="stsm-atlas-card-side">
                    <div class="stsm-atlas-card-actions">
                        ${renderAction('edit', 'fa-pen', '수정')}
                        ${hasCorrection ? renderAction('reset', 'fa-rotate-left', '사용자 수정 초기화') : ''}
                        ${renderAction('translate', 'fa-language', translation ? '번역 재생성' : '번역')}
                        ${translation ? renderAction('toggle-translation', 'fa-right-left', '원문/번역 전환') : ''}
                        ${renderAction('exclude', 'fa-trash-can', '도감에서 삭제')}
                    </div>
                    <div class="stsm-atlas-card-meta">
                        <code>${escapeHtml(commitment.id)}</code>
                        <span>#${commitment.firstSeenRange.startId} ~ #${commitment.lastUpdatedRange.endId}</span>
                    </div>
                </div>
            </header>
            <div class="stsm-commitment-status-row">
                <select class="text_pole stsm-commitment-status" aria-label="서약 상태">
                    ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${commitment.status === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                ${commitment.statusReason ? `<span>${escapeHtml(commitment.statusReason)}</span>` : ''}
            </div>
            <div class="stsm-commitment-fields stsm-atlas-original"${translation ? ' hidden' : ''}>
                ${renderField('내용', [commitment.terms])}
                ${renderParticipants(commitment.participants)}
                ${renderField('조건', commitment.conditions)}
                ${renderField('기한', commitment.deadline ? [commitment.deadline] : [])}
                ${renderField('객관 정보', commitment.facts)}
            </div>
            ${translation ? `<div class="stsm-atlas-translation">${escapeHtml(translation.content)}</div>` : ''}
        </article>
    `;
}

async function handleAtlasAction(event, category) {
    const button = event.target.closest('[data-atlas-action]');
    const card = button?.closest('[data-entity-id]');
    if (!button || !card) return;
    const list = card.parentElement;
    const entityId = card.dataset.entityId;
    const atlas = getCommitmentAtlas();
    if (button.dataset.atlasAction === 'restore') {
        const excluded = atlas.excluded.find(entity => entity.id === entityId);
        if (!excluded) return;
        try {
            await restoreAtlasEntity(category, entityId);
            toastr.success(`${excluded.title}을(를) 장부에 복원했습니다.`);
        } catch (error) {
            handleError(error, entityId);
        }
        return;
    }
    const commitment = atlas.commitments.find(entity => entity.id === entityId);
    if (!commitment) return;
    try {
        if (button.dataset.atlasAction === 'edit') {
            await showAtlasEditor(category, entityId);
        } else if (button.dataset.atlasAction === 'reset') {
            await resetAtlasEntity(category, entityId, commitment.title);
        } else if (button.dataset.atlasAction === 'toggle-translation') {
            toggleTranslation(card, button);
        } else if (button.dataset.atlasAction === 'exclude') {
            if (await excludeAtlasEntity(category, entityId, commitment.title)) toastr.success('서약을 장부에서 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'translate') {
            const existing = getValidAtlasTranslation(category, commitment);
            if (existing && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
            const operationToken = beginOperation('translating', `${commitment.title} 장부 번역 중`);
            button.disabled = true;
            try {
                await translateAtlasEntity(category, entityId);
                showTranslatedCard(list, entityId);
                toastr.success('서약을 번역했습니다.');
            } finally {
                endOperation(operationToken);
            }
        }
    } catch (error) {
        handleError(error, entityId);
        button.disabled = false;
    }
}

async function handleStatusChange(event) {
    if (!event.target.matches('.stsm-commitment-status')) return;
    const card = event.target.closest('[data-entity-id]');
    const previous = getCommitmentAtlas().commitments.find(entity => entity.id === card?.dataset.entityId)?.status;
    try {
        event.target.disabled = true;
        await setAtlasFieldValues('commitments', card.dataset.entityId, {
            status: event.target.value,
            statusReason: null,
        });
        toastr.success('서약 상태를 변경했습니다.');
    } catch (error) {
        if (previous) event.target.value = previous;
        event.target.disabled = false;
        handleError(error, card?.dataset.entityId);
    }
}

function handleError(error, entityId) {
    console.error('[Chat Summarizer] Commitment atlas action failed:', error);
    addExtensionErrorLog(error, {
        operation: 'atlas',
        title: '서약 장부 작업 실패',
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

function renderParticipants(participants) {
    const values = (participants || []).map(participant => {
        const name = participant.personName || participant.personId || '알 수 없는 참여자';
        return participant.role ? `${name} · ${participant.role}` : name;
    });
    return renderField('참여자', values);
}

function renderField(label, values) {
    if (!Array.isArray(values) || !values.length) return '';
    return `<div class="stsm-commitment-field"><strong>${escapeHtml(label)}</strong><div>${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div></div>`;
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
        <div class="stsm-commitment-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>확인이 필요한 장부 데이터</strong>
        </div>
        ${updates.length ? `<div>미적용 변경안 ${updates.length.toLocaleString()}개</div>` : ''}
        ${updates.map(update => `<div>#${update.range.startId} ~ #${update.range.endId} · ${escapeHtml(update.targetId || 'ID 없음')} · ${escapeHtml(update.reason)}</div>`).join('')}
        ${orphanCorrections.length ? `<div>대상을 찾지 못한 사용자 수정: ${orphanCorrections.map(escapeHtml).join(', ')}</div>` : ''}
    `;
}
