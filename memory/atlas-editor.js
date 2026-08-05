import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import {
    clearAtlasEntityCorrection,
    getAtlasEntityCorrection,
    saveAtlasEntityCorrection,
} from './atlas-metadata.js';
import { getAtlasProjection } from './atlas-projection-service.js';

const PEOPLE_FIELDS = Object.freeze([
    { path: 'name', label: '이름', type: 'scalar' },
    { path: 'aliases', label: '별칭', type: 'list' },
    { path: 'facts', label: '객관 정보', type: 'list' },
    { path: 'roles', label: '역할', type: 'list' },
    { path: 'affiliations', label: '소속', type: 'list' },
    { path: 'personalityTraits', label: '성격', type: 'list' },
    { path: 'speechPatterns', label: '말투', type: 'list' },
    { path: 'lastKnownState.location', label: '마지막 위치', type: 'scalar' },
    { path: 'lastKnownState.physicalCondition', label: '마지막 신체 상태', type: 'scalar' },
]);

const ITEM_FIELDS = Object.freeze([
    { path: 'name', label: '이름', type: 'scalar' },
    { path: 'aliases', label: '별칭', type: 'list' },
    { path: 'facts', label: '객관 정보', type: 'list' },
    { path: 'functions', label: '기능', type: 'list' },
    { path: 'lastKnownState.owner', label: '소유자', type: 'scalar' },
    { path: 'lastKnownState.holder', label: '소지자', type: 'scalar' },
    { path: 'lastKnownState.location', label: '마지막 위치', type: 'scalar' },
    { path: 'lastKnownState.condition', label: '물리 상태', type: 'scalar' },
    { path: 'lastKnownState.status', label: '서사 상태', type: 'scalar' },
]);

const COMMITMENT_FIELDS = Object.freeze([
    { path: 'title', label: '제목', type: 'scalar' },
    { path: 'terms', label: '내용', type: 'long' },
    { path: 'conditions', label: '조건', type: 'list' },
    { path: 'deadline', label: '기한', type: 'scalar' },
    { path: 'facts', label: '객관 정보', type: 'list' },
    { path: 'status', label: '상태', type: 'status' },
    { path: 'statusReason', label: '상태 근거', type: 'long' },
]);

const EVENT_FIELDS = Object.freeze([
    { path: 'title', label: '제목', type: 'scalar' },
    { path: 'date', label: '날짜', type: 'scalar' },
    { path: 'location', label: '장소', type: 'scalar' },
    { path: 'summary', label: '사건 요약', type: 'long' },
    { path: 'importance', label: '중요도', type: 'importance' },
    { path: 'shifts', label: '변화', type: 'list' },
]);

export async function showAtlasEditor(category, entityId) {
    const currentProjection = getAtlasProjection();
    const rawProjection = getAtlasProjection({ includeCorrections: false });
    const collection = getCollectionName(category);
    const current = currentProjection[collection].find(entity => entity.id === entityId);
    const raw = rawProjection[collection].find(entity => entity.id === entityId);
    if (!current || !raw) throw new Error('수정할 도감 항목을 찾지 못했습니다.');

    const existing = getAtlasEntityCorrection(category, entityId)?.fields || {};
    const definitions = category === 'people'
        ? PEOPLE_FIELDS
        : category === 'items'
            ? ITEM_FIELDS
            : category === 'commitments'
                ? COMMITMENT_FIELDS
                : EVENT_FIELDS;
    const displayName = current.name || current.title;
    const form = document.createElement('div');
    form.className = 'stsm-atlas-editor';
    form.innerHTML = `
        <div class="stsm-section-title">${escapeHtml(displayName)} 수정</div>
        <div class="stsm-atlas-editor-fields">
            ${definitions.map(definition => renderFieldEditor(definition, getPath(current, definition.path), existing[definition.path])).join('')}
            ${category === 'people' ? renderRelationshipEditor(current.relationships, existing.relationships) : ''}
            ${category === 'commitments' ? renderParticipantEditor(current.participants, existing.participants) : ''}
        </div>
    `;
    bindEditor(form);

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '수정하기', cancelButton: '취소' });
    if (await popup.show() !== 1) return false;

    const fields = {};
    for (const definition of definitions) {
        const editor = form.querySelector(`[data-atlas-field="${definition.path}"]`);
        const value = readFieldValue(editor, definition);
        if (['name', 'title', 'terms', 'summary'].includes(definition.path) && !value) {
            throw new Error('도감 항목의 이름, 제목과 내용은 비워둘 수 없습니다.');
        }
        const normalizedValue = category === 'events'
            && definition.path === 'shifts'
            && form.querySelector('[data-atlas-field="importance"] select').value === 'ordinary'
            ? []
            : value;
        preserveOrCreateCorrection({
            fields,
            path: definition.path,
            value: normalizedValue,
            rawValue: getPath(raw, definition.path),
            locked: editor.querySelector('[data-field-lock]').checked,
            existing: existing[definition.path],
            frontierId: currentProjection.frontierId,
        });
    }
    if (category === 'people') {
        const editor = form.querySelector('[data-atlas-field="relationships"]');
        preserveOrCreateCorrection({
            fields,
            path: 'relationships',
            value: readRelationships(editor),
            rawValue: raw.relationships,
            locked: editor.querySelector('[data-field-lock]').checked,
            existing: existing.relationships,
            frontierId: currentProjection.frontierId,
        });
    }
    if (category === 'commitments') {
        const editor = form.querySelector('[data-atlas-field="participants"]');
        preserveOrCreateCorrection({
            fields,
            path: 'participants',
            value: readParticipants(editor),
            rawValue: raw.participants,
            locked: editor.querySelector('[data-field-lock]').checked,
            existing: existing.participants,
            frontierId: currentProjection.frontierId,
        });
    }

    await saveAtlasEntityCorrection(category, entityId, fields);
    return true;
}

export async function setAtlasFieldValue(category, entityId, path, value) {
    await setAtlasFieldValues(category, entityId, { [path]: value });
}

export async function setAtlasFieldValues(category, entityId, values) {
    const currentProjection = getAtlasProjection();
    const rawProjection = getAtlasProjection({ includeCorrections: false });
    const collection = getCollectionName(category);
    const current = currentProjection[collection].find(entity => entity.id === entityId);
    const raw = rawProjection[collection].find(entity => entity.id === entityId);
    if (!current || !raw) throw new Error('수정할 도감 항목을 찾지 못했습니다.');
    const fields = getAtlasEntityCorrection(category, entityId)?.fields || {};
    for (const [path, value] of Object.entries(values)) {
        preserveOrCreateCorrection({
            fields,
            path,
            value,
            rawValue: getPath(raw, path),
            locked: Boolean(fields[path]?.locked),
            existing: fields[path],
            frontierId: currentProjection.frontierId,
        });
    }
    await saveAtlasEntityCorrection(category, entityId, fields);
}

export async function resetAtlasEntity(category, entityId, name) {
    if (!await Popup.show.confirm('이 항목의 사용자 수정과 잠금을 모두 제거할까요?', name)) return false;
    await clearAtlasEntityCorrection(category, entityId);
    return true;
}

function renderFieldEditor(definition, value, correction) {
    const normalized = definition.type === 'list'
        ? (Array.isArray(value) ? value.join('\n') : '')
        : String(value || '');
    return `
        <div class="stsm-atlas-editor-field" data-atlas-field="${escapeHtml(definition.path)}">
            <span class="stsm-atlas-editor-field-heading">
                <strong>${escapeHtml(definition.label)}</strong>
                ${renderLock(correction?.locked)}
            </span>
            ${renderFieldInput(definition, normalized)}
        </div>
    `;
}

function renderFieldInput(definition, value) {
    if (definition.type === 'list') return `<textarea class="text_pole" rows="3">${escapeHtml(value)}</textarea>`;
    if (definition.type === 'long') return `<textarea class="text_pole" rows="3">${escapeHtml(value)}</textarea>`;
    if (definition.type === 'status') {
        return `<select class="text_pole">
            <option value="pending" ${value === 'pending' ? 'selected' : ''}>미이행</option>
            <option value="fulfilled" ${value === 'fulfilled' ? 'selected' : ''}>이행</option>
            <option value="obsolete" ${value === 'obsolete' ? 'selected' : ''}>의미 없어짐</option>
        </select>`;
    }
    if (definition.type === 'importance') {
        return `<select class="text_pole">
            <option value="ordinary" ${value === 'ordinary' ? 'selected' : ''}>일반</option>
            <option value="turning_point" ${value === 'turning_point' ? 'selected' : ''}>변곡점</option>
        </select>`;
    }
    return `<input class="text_pole" type="text" value="${escapeHtml(value)}" />`;
}

function renderRelationshipEditor(relationships, correction) {
    return `
        <section class="stsm-atlas-editor-field stsm-relationship-editor" data-atlas-field="relationships">
            <div class="stsm-atlas-editor-field-heading">
                <strong>관계 및 감정</strong>
                <span>
                    ${renderLock(correction?.locked)}
                    <button class="menu_button menu_button_icon interactable" data-add-relationship type="button" title="관계 추가" aria-label="관계 추가">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </span>
            </div>
            <div class="stsm-relationship-editor-list">
                ${(relationships || []).map(renderRelationshipRow).join('')}
            </div>
        </section>
    `;
}

function renderParticipantEditor(participants, correction) {
    return `
        <section class="stsm-atlas-editor-field stsm-participant-editor" data-atlas-field="participants">
            <div class="stsm-atlas-editor-field-heading">
                <strong>참여자</strong>
                <span>
                    ${renderLock(correction?.locked)}
                    <button class="menu_button menu_button_icon interactable" data-add-participant type="button" title="참여자 추가" aria-label="참여자 추가">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </span>
            </div>
            <div class="stsm-participant-editor-list">
                ${(participants || []).map(renderParticipantRow).join('')}
            </div>
        </section>
    `;
}

function renderParticipantRow(participant = {}) {
    return `
        <div class="stsm-participant-editor-row" data-person-id="${escapeHtml(participant.personId || '')}" data-person-name="${escapeHtml(participant.personName || participant.personId || '')}">
            <input class="text_pole" data-participant-name type="text" value="${escapeHtml(participant.personName || participant.personId || '')}" placeholder="이름" />
            <input class="text_pole" data-participant-role type="text" value="${escapeHtml(participant.role || '')}" placeholder="역할" />
            <button class="menu_button menu_button_icon interactable" data-delete-participant type="button" title="참여자 삭제" aria-label="참여자 삭제">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}

function renderRelationshipRow(relationship = {}) {
    return `
        <div class="stsm-relationship-editor-row" data-target-id="${escapeHtml(relationship.targetId || '')}" data-target-name="${escapeHtml(relationship.targetName || relationship.targetId || '')}">
            <input class="text_pole" data-relationship-target type="text" value="${escapeHtml(relationship.targetName || relationship.targetId || '')}" placeholder="대상" />
            <textarea class="text_pole" data-relationship-state rows="2" placeholder="관계 · 한 줄에 하나">${escapeHtml((relationship.relationship || []).join('\n'))}</textarea>
            <textarea class="text_pole" data-relationship-feelings rows="2" placeholder="감정 · 한 줄에 하나">${escapeHtml((relationship.feelings || []).join('\n'))}</textarea>
            <button class="menu_button menu_button_icon interactable" data-delete-relationship type="button" title="관계 삭제" aria-label="관계 삭제">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
}

function renderLock(locked = false) {
    return `
        <label class="stsm-atlas-field-lock" title="잠그면 이후 자동 변경안이 이 필드를 수정하지 못합니다.">
            <i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i>
            <input data-field-lock type="checkbox" ${locked ? 'checked' : ''} />
        </label>
    `;
}

function bindEditor(form) {
    const editor = form.querySelector('.stsm-relationship-editor');
    editor?.addEventListener('click', event => {
        if (event.target.closest('[data-add-relationship]')) {
            editor.querySelector('.stsm-relationship-editor-list').insertAdjacentHTML('beforeend', renderRelationshipRow());
        } else if (event.target.closest('[data-delete-relationship]')) {
            event.target.closest('.stsm-relationship-editor-row')?.remove();
        }
    });
    const participantEditor = form.querySelector('.stsm-participant-editor');
    participantEditor?.addEventListener('click', event => {
        if (event.target.closest('[data-add-participant]')) {
            participantEditor.querySelector('.stsm-participant-editor-list').insertAdjacentHTML('beforeend', renderParticipantRow());
        } else if (event.target.closest('[data-delete-participant]')) {
            event.target.closest('.stsm-participant-editor-row')?.remove();
        }
    });
    form.addEventListener('change', event => {
        if (!event.target.matches('[data-field-lock]')) return;
        const icon = event.target.closest('.stsm-atlas-field-lock')?.querySelector('i');
        icon?.classList.toggle('fa-lock', event.target.checked);
        icon?.classList.toggle('fa-lock-open', !event.target.checked);
    });
}

function readParticipants(editor) {
    return [...editor.querySelectorAll('.stsm-participant-editor-row')].map(row => {
        const personName = normalizeScalar(row.querySelector('[data-participant-name]').value);
        if (!personName) return null;
        const personId = personName === row.dataset.personName ? row.dataset.personId || null : null;
        return {
            personId,
            personName,
            role: normalizeScalar(row.querySelector('[data-participant-role]').value),
        };
    }).filter(Boolean);
}

function readFieldValue(editor, definition) {
    if (definition.type === 'list') return parseList(editor.querySelector('textarea').value);
    if (definition.type === 'long') return normalizeScalar(editor.querySelector('textarea').value);
    if (definition.type === 'status') return editor.querySelector('select').value;
    if (definition.type === 'importance') return editor.querySelector('select').value;
    return normalizeScalar(editor.querySelector('input[type="text"]').value);
}

function readRelationships(editor) {
    return [...editor.querySelectorAll('.stsm-relationship-editor-row')].map(row => {
        const targetName = normalizeScalar(row.querySelector('[data-relationship-target]').value);
        if (!targetName) return null;
        const originalTargetId = targetName === row.dataset.targetName ? row.dataset.targetId || null : null;
        return {
            targetId: originalTargetId,
            targetName,
            relationship: parseList(row.querySelector('[data-relationship-state]').value),
            feelings: parseList(row.querySelector('[data-relationship-feelings]').value),
            lastObservedRange: null,
        };
    }).filter(Boolean);
}

function preserveOrCreateCorrection({ fields, path, value, rawValue, locked, existing, frontierId }) {
    if (!locked && valuesEqual(value, rawValue)) {
        delete fields[path];
        return;
    }
    const unchanged = existing && valuesEqual(existing.value, value) && existing.locked === locked;
    fields[path] = unchanged ? existing : {
        value: structuredClone(value),
        appliedThroughId: frontierId,
        locked,
        editedAt: new Date().toISOString(),
    };
}

function getPath(target, path) {
    return path.split('.').reduce((value, key) => value?.[key], target);
}

function parseList(value) {
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function normalizeScalar(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function valuesEqual(left, right) {
    return JSON.stringify(normalizeComparable(left)) === JSON.stringify(normalizeComparable(right));
}

function normalizeComparable(value) {
    if (Array.isArray(value)) {
        return value.map(item => {
            if (!item || typeof item !== 'object') return item;
            const { lastObservedRange, ...rest } = item;
            return rest;
        });
    }
    return value ?? null;
}

function getCollectionName(category) {
    if (category === 'people') return 'people';
    if (category === 'items') return 'items';
    if (category === 'commitments') return 'commitments';
    if (category === 'events') return 'events';
    throw new Error('지원하지 않는 도감 종류입니다.');
}
