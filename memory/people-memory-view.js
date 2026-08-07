import { escapeHtml } from '../core/utils.js';
import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { getSettings, SUMMARY_CONTEXT_BLOCK_KINDS } from '../core/settings.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { excludeAtlasEntity, resetAtlasEntity, restoreAtlasEntity, showAtlasEditor } from './atlas-editor.js';
import { renderExcludedAtlasEntries } from './atlas-exclusion-view.js';
import {
    getAtlasTranslations,
    getPeopleRetrievalMetadata,
    getPersonRetrievalMetadata,
    savePersonRetrievalMetadata,
} from './atlas-metadata.js';
import { getPeopleAtlas } from './people-memory-service.js';
import { evaluatePeopleRetrieval } from './people-retrieval.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';
import { renderTokenUsageBar } from '../ui/token-usage-view.js';

const FIELD_DEFINITIONS = Object.freeze([
    { key: 'role', label: '극중 역할' },
    { key: 'age', label: '나이' },
    { key: 'occupation', label: '직업·직위' },
    { key: 'appearance', label: '외형' },
    { key: 'affiliations', label: '소속', list: true },
    { key: 'traits', label: '성격', list: true },
    { key: 'voice', label: '말투' },
]);

export function bindPeopleMemoryView(root) {
    const list = root.querySelector('#stsm-people-memory-list');
    const excluded = root.querySelector('#stsm-people-memory-excluded');
    if (list && !list.dataset.bound) {
        list.dataset.bound = 'true';
        list.addEventListener('click', event => handleAtlasAction(event, 'people'));
    }
    if (excluded && !excluded.dataset.bound) {
        excluded.dataset.bound = 'true';
        excluded.addEventListener('click', event => handleAtlasAction(event, 'people'));
    }
    renderPeopleMemory(root);
}

export function renderPeopleMemory(root) {
    const list = root.querySelector('#stsm-people-memory-list');
    const excludedHost = root.querySelector('#stsm-people-memory-excluded');
    const count = root.querySelector('#stsm-people-memory-count');
    const tokenUsage = root.querySelector('#stsm-people-token-usage');
    const skipped = root.querySelector('#stsm-people-memory-skipped');
    if (!list || !excludedHost || !count || !skipped) return;

    const atlas = getPeopleAtlas();
    const settings = getSettings().summarization;
    const translations = getAtlasTranslations('people');
    const retrievalMetadata = getPeopleRetrievalMetadata();
    const retrieval = evaluatePeopleRetrieval({
        people: atlas.people,
        messages: SillyTavern.getContext().chat,
        metadata: retrievalMetadata,
        messageCount: settings.personRetrieval.messageCount,
    });
    const retrievalById = new Map(retrieval.map(result => [String(result.person.id), result]));
    const excludedOpen = Boolean(excludedHost.querySelector('.stsm-atlas-excluded')?.open);
    count.textContent = `${atlas.people.length.toLocaleString()}명`;
    if (tokenUsage) {
        const details = buildSummaryContextDetails();
        const block = details.blocks?.find(item => item.kind === SUMMARY_CONTEXT_BLOCK_KINDS.PEOPLE);
        tokenUsage.innerHTML = renderTokenUsageBar({
            label: '인물 도감 주입',
            used: block?.outputTokenCount || 0,
            max: block?.budget ?? settings.personRetrieval.maxTokens,
            enabled: Boolean(details.enabled && block?.enabled),
        });
    }
    skipped.innerHTML = renderSkippedUpdates(atlas.skippedUpdates, atlas.orphanCorrections);
    skipped.hidden = !atlas.skippedUpdates.length && !atlas.orphanCorrections.length;
    list.innerHTML = atlas.people.length
        ? atlas.people.map(person => renderPerson(
            person,
            translations[person.id],
            retrievalMetadata[person.id] || { keywords: [], pinned: false },
            retrievalById.get(String(person.id)),
        )).join('')
        : '<div class="stsm-empty">아직 추출된 인물 도감이 없습니다.</div>';
    excludedHost.innerHTML = renderExcludedAtlasEntries(atlas.excluded, { open: excludedOpen });
}

function renderPerson(person, cachedTranslation, retrievalMetadata, retrieval) {
    const translation = getValidAtlasTranslation('people', person, cachedTranslation || null);
    const hasCorrection = Boolean(Object.keys(person.manualCorrections || {}).length);
    return `
        <article class="stsm-person-card" data-atlas-category="people" data-entity-id="${escapeHtml(person.id)}">
            <header>
                <div>
                    <strong>${escapeHtml(person.name)}</strong>
                    ${person.provisional ? '<span class="stsm-atlas-correction-state">임시 이름</span>' : ''}
                    ${person.aliases.length ? `<span>${person.aliases.map(escapeHtml).join(' · ')}</span>` : ''}
                    ${renderCorrectionState(person.manualCorrections)}
                </div>
                <div class="stsm-atlas-card-side">
                    <div class="stsm-atlas-card-actions">
                        ${renderAction('pin', 'fa-thumbtack', retrievalMetadata.pinned ? '고정 해제' : '고정', {
                            className: 'stsm-person-pin',
                            pressed: retrievalMetadata.pinned,
                        })}
                        ${renderAction('keywords', 'fa-key', '검색 키워드 편집')}
                        ${renderAction('edit', 'fa-pen', '수정')}
                        ${hasCorrection ? renderAction('reset', 'fa-rotate-left', '사용자 수정 초기화') : ''}
                        ${renderAction('translate', 'fa-language', translation ? '번역 재생성' : '번역')}
                        ${translation ? renderAction('toggle-translation', 'fa-right-left', '원문/번역 전환') : ''}
                        ${renderAction('exclude', 'fa-trash-can', '도감에서 삭제')}
                    </div>
                    <div class="stsm-atlas-card-meta">
                        <code>${escapeHtml(person.id)}</code>
                        <span>#${person.firstSeenRange.startId} ~ #${person.lastUpdatedRange.endId}</span>
                    </div>
                </div>
            </header>
            ${renderRetrievalState(retrievalMetadata, retrieval)}
            <div class="stsm-person-fields stsm-atlas-original">
                ${FIELD_DEFINITIONS.map(field => field.list
                    ? renderField(field.label, person[field.key])
                    : renderScalarField(field.label, person[field.key])).join('')}
                ${renderLastKnownState(person.lastKnownState)}
                ${renderRelationships(person.relationships)}
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
    const atlas = getPeopleAtlas();
    if (button.dataset.atlasAction === 'restore') {
        const excluded = atlas.excluded.find(entity => entity.id === entityId);
        if (!excluded) return;
        try {
            await restoreAtlasEntity(category, entityId);
            toastr.success(`${excluded.name}을(를) 도감에 복원했습니다.`);
        } catch (error) {
            handleError(error, entityId, button);
        }
        return;
    }
    const person = atlas.people.find(entity => entity.id === entityId);
    if (!person) return;
    try {
        if (button.dataset.atlasAction === 'edit') {
            await showAtlasEditor(category, entityId);
        } else if (button.dataset.atlasAction === 'pin') {
            const current = getPersonRetrievalMetadata(entityId);
            await savePersonRetrievalMetadata(entityId, { ...current, pinned: !current.pinned });
            toastr.success(current.pinned ? '인물 고정을 해제했습니다.' : '인물을 우선 고정했습니다.');
        } else if (button.dataset.atlasAction === 'keywords') {
            await showPersonKeywordEditor(person);
        } else if (button.dataset.atlasAction === 'reset') {
            await resetAtlasEntity(category, entityId, person.name);
        } else if (button.dataset.atlasAction === 'toggle-translation') {
            toggleTranslation(card, button);
        } else if (button.dataset.atlasAction === 'exclude') {
            if (await excludeAtlasEntity(category, entityId, person.name)) toastr.success('인물을 도감에서 삭제했습니다.');
        } else if (button.dataset.atlasAction === 'translate') {
            const existing = getValidAtlasTranslation(category, person);
            if (existing && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
            const operationToken = beginOperation('translating', `${person.name} 도감 번역 중`);
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
        handleError(error, entityId, button);
    }
}

function handleError(error, entityId, button) {
    console.error('[Chat Summarizer] People atlas action failed:', error);
    addExtensionErrorLog(error, {
        operation: 'atlas',
        title: '인물 도감 작업 실패',
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

function renderAction(action, icon, title, { className = '', pressed = null } = {}) {
    return `<button class="menu_button menu_button_icon interactable ${className}" data-atlas-action="${action}" type="button" title="${title}" aria-label="${title}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}><i class="fa-solid ${icon}"></i></button>`;
}

function renderRetrievalState(metadata, retrieval) {
    const keywords = Array.isArray(metadata.keywords) ? metadata.keywords : [];
    const status = metadata.pinned
        ? '<i class="fa-solid fa-thumbtack" aria-hidden="true"></i> 고정 우선'
        : retrieval?.matchedKeywords?.length
            ? `<i class="fa-solid fa-link" aria-hidden="true"></i> ${retrieval.matchedKeywords.length}개 일치: ${retrieval.matchedKeywords.map(escapeHtml).join(', ')}`
            : '<i class="fa-solid fa-minus" aria-hidden="true"></i> 현재 문맥 일치 없음';
    return `
        <div class="stsm-person-retrieval-state">
            <div class="stsm-person-keywords">
                <i class="fa-solid fa-key" aria-hidden="true"></i>
                ${keywords.length
        ? keywords.map(keyword => `<span>${escapeHtml(keyword)}</span>`).join('')
        : '<small>사용자 검색 키워드 없음</small>'}
            </div>
            <span class="stsm-person-match-state${metadata.pinned ? ' is-pinned' : ''}">${status}</span>
        </div>
    `;
}

async function showPersonKeywordEditor(person) {
    const current = getPersonRetrievalMetadata(person.id);
    const form = document.createElement('div');
    form.className = 'stsm-person-keyword-editor';
    form.innerHTML = `
        <div class="stsm-section-title">${escapeHtml(person.name)} 검색 키워드</div>
        <p>최근 채팅과 비교할 키워드를 한 줄에 하나씩 입력하세요. 이름과 별칭은 자동으로 추가되지 않습니다.</p>
        <textarea class="text_pole" rows="10" placeholder="예:&#10;로완&#10;교수&#10;greenhouse"></textarea>
    `;
    form.querySelector('textarea').value = current.keywords.join('\n');
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '저장',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== 1) return false;
    const keywords = form.querySelector('textarea').value
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean);
    await savePersonRetrievalMetadata(person.id, { ...current, keywords });
    toastr.success('인물 검색 키워드를 저장했습니다.');
    return true;
}

function renderCorrectionState(corrections) {
    const values = Object.values(corrections || {});
    if (!values.length) return '';
    const locked = values.filter(value => value.locked).length;
    return `<span class="stsm-atlas-correction-state"><i class="fa-solid fa-pen"></i> 사용자 수정 ${values.length}${locked ? ` · <i class="fa-solid fa-lock"></i> 잠금 ${locked}` : ''}</span>`;
}

function renderField(label, values) {
    if (!Array.isArray(values) || !values.length) return '';
    return `
        <div class="stsm-person-field">
            <strong>${escapeHtml(label)}</strong>
            <div>${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>
        </div>
    `;
}

function renderScalarField(label, value) {
    return value ? renderField(label, [value]) : '';
}

function renderLastKnownState(state) {
    const values = [];
    if (state?.location) values.push(`장소: ${state.location}`);
    if (state?.physicalCondition) values.push(`신체 상태: ${state.physicalCondition}`);
    return renderField('마지막 확인 상태', values);
}

function renderRelationships(relationships) {
    if (!Array.isArray(relationships) || !relationships.length) return '';
    const values = relationships.map(item => {
        const target = item.targetName || item.targetId || '알 수 없는 인물';
        const relationship = item.relationship.length ? `관계: ${item.relationship.join(', ')}` : '';
        const feelings = item.feelings.length ? `감정: ${item.feelings.join(', ')}` : '';
        return `${target}${relationship || feelings ? ` (${[relationship, feelings].filter(Boolean).join(' / ')})` : ''}`;
    });
    return renderField('관계 및 감정', values);
}

function renderSkippedUpdates(updates, orphanCorrections) {
    if (!updates.length && !orphanCorrections.length) return '';
    return `
        <div class="stsm-people-memory-warning-title">
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
