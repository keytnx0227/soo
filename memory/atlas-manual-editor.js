import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import {
    addManualAtlasEntry,
    deleteManualAtlasEntry,
    getManualAtlasEntries,
    updateManualAtlasEntry,
} from './atlas-metadata.js';
import { getAtlasProjection } from './atlas-projection-service.js';

const CATEGORY_CONFIG = Object.freeze({
    people: {
        label: '인물',
        primary: 'name',
        fields: [
            ['name', '이름', 'scalar'], ['provisional', '임시 이름', 'boolean'], ['aliases', '별칭', 'list'],
            ['role', '극중 역할', 'scalar'], ['age', '나이', 'scalar'], ['occupation', '직업·직위', 'scalar'],
            ['appearance', '외형', 'scalar'], ['affiliations', '소속', 'list'], ['traits', '성격', 'list'],
            ['voice', '말투', 'scalar'], ['lastKnownState.location', '마지막 위치', 'scalar'],
            ['lastKnownState.physicalCondition', '마지막 신체 상태', 'scalar'],
        ],
    },
    items: {
        label: '아이템',
        primary: 'name',
        fields: [
            ['name', '이름', 'scalar'], ['aliases', '별칭', 'list'], ['facts', '객관 정보', 'list'],
            ['functions', '기능', 'list'], ['lastKnownState.owner', '소유자', 'scalar'],
            ['lastKnownState.holder', '소지자', 'scalar'], ['lastKnownState.location', '마지막 위치', 'scalar'],
            ['lastKnownState.condition', '물리 상태', 'scalar'], ['lastKnownState.status', '서사 상태', 'scalar'],
        ],
    },
    commitments: {
        label: '서약',
        primary: 'title',
        required: ['title', 'terms'],
        fields: [
            ['title', '제목', 'scalar'], ['terms', '내용', 'long'], ['conditions', '조건', 'list'],
            ['deadline', '기한', 'scalar'], ['facts', '객관 정보', 'list'], ['status', '상태', 'status'],
            ['statusReason', '상태 근거', 'long'],
        ],
    },
    events: {
        label: '사건',
        primary: 'title',
        required: ['title', 'summary'],
        fields: [
            ['title', '제목', 'scalar'], ['date', '날짜', 'scalar'], ['location', '장소', 'scalar'],
            ['summary', '사건 요약', 'long'], ['importance', '중요도', 'importance'], ['shift', 'SHIFT', 'long'],
        ],
    },
    world: {
        label: '세계 설정',
        primary: 'content',
        required: ['keys', 'content'],
        fields: [['keys', '키', 'list'], ['content', '내용', 'long']],
    },
});

export function bindManualAtlasEntryButtons(root) {
    root.querySelectorAll('[data-atlas-manual-add]').forEach(button => {
        if (button.dataset.bound) return;
        button.dataset.bound = 'true';
        button.addEventListener('click', async () => {
            const category = button.dataset.atlasManualAdd;
            button.disabled = true;
            try {
                if (await showManualAtlasEntryEditor(category)) {
                    toastr.success(`${getConfig(category).label} 도감에 직접 추가했습니다.`);
                }
            } catch (error) {
                console.error('[Chat Summarizer] Failed to add manual atlas entry:', error);
                addExtensionErrorLog(error, {
                    operation: 'atlas',
                    title: '도감 직접 추가 실패',
                    message: error.message,
                    context: { category },
                });
                toastr.error(error.message || '도감 항목을 직접 추가하지 못했습니다.');
            } finally {
                button.disabled = false;
            }
        });
    });
}

export async function showManualAtlasEntryEditor(category, entityId = null) {
    const config = getConfig(category);
    const source = entityId
        ? getManualAtlasEntries(category).find(entry => entry.id === String(entityId))
        : null;
    if (entityId && !source) throw new Error('수정할 직접 추가 도감 항목을 찾지 못했습니다.');
    const projection = getAtlasProjection();
    const current = entityId
        ? projection[getCollectionName(category)].find(entry => entry.id === String(entityId)) || source
        : null;

    const form = document.createElement('div');
    form.className = 'stsm-atlas-editor stsm-manual-atlas-editor';
    form.innerHTML = `
        <div class="stsm-section-title">${config.label} 직접 ${current ? '수정' : '추가'}</div>
        <label class="stsm-manual-auto-update">
            <span>
                <strong>자동 갱신 허용</strong>
                <small>이후 요약에서 이 ID를 대상으로 한 변경안을 반영합니다.</small>
            </span>
            <span class="stsm-switch">
                <input data-manual-auto-update type="checkbox" ${source?.allowAutoUpdate ? 'checked' : ''} />
                <span></span>
            </span>
        </label>
        <div class="stsm-atlas-editor-fields">
            ${config.fields.map(([path, label, type]) => renderField(path, label, type, getPath(current, path))).join('')}
            ${category === 'people' ? renderRelationships(current?.relationships) : ''}
            ${category === 'commitments' ? renderParticipants(current?.participants) : ''}
        </div>
    `;
    bindRepeatingRows(form);

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: current ? '수정하기' : '추가',
        cancelButton: '취소',
        wide: true,
    });
    if (await popup.show() !== 1) return false;

    const value = {
        allowAutoUpdate: form.querySelector('[data-manual-auto-update]').checked,
        appliedThroughId: projection.frontierId,
    };
    for (const [path, , type] of config.fields) {
        setPath(value, path, readField(form.querySelector(`[data-manual-field="${path}"]`), type));
    }
    if (category === 'people') value.relationships = readRelationships(form);
    if (category === 'commitments') value.participants = readParticipants(form);
    if (category === 'events' && value.importance !== 'major') value.shift = null;

    const required = config.required || [config.primary];
    if (required.some(path => isEmptyRequired(getPath(value, path)))) {
        throw new Error(`${config.label} 도감의 필수 정보를 입력해주세요.`);
    }
    if (current) await updateManualAtlasEntry(category, current.id, value);
    else await addManualAtlasEntry(category, value);
    return true;
}

export async function confirmDeleteManualAtlasEntry(category, entityId, label) {
    if (!await Popup.show.confirm(
        '직접 추가한 항목을 완전히 삭제하시겠습니까?',
        `${label}\n이 작업은 복원 목록을 거치지 않습니다.`,
    )) return false;
    return await deleteManualAtlasEntry(category, entityId);
}

export function renderManualAtlasState(entity) {
    if (!entity?.manual) return '';
    const mode = entity.allowAutoUpdate ? '자동 갱신' : '수동 유지';
    const icon = entity.allowAutoUpdate ? 'fa-arrows-rotate' : 'fa-user-pen';
    return `<span class="stsm-atlas-manual-state"><i class="fa-solid ${icon}" aria-hidden="true"></i> 직접 추가 · ${mode}</span>`;
}

function renderField(path, label, type, value) {
    const normalized = type === 'list'
        ? (Array.isArray(value) ? value.join('\n') : '')
        : String(value ?? '');
    return `
        <label class="stsm-atlas-editor-field" data-manual-field="${escapeHtml(path)}">
            <span class="stsm-atlas-editor-field-heading"><strong>${escapeHtml(label)}</strong></span>
            ${renderInput(type, normalized)}
        </label>
    `;
}

function renderInput(type, value) {
    if (type === 'list' || type === 'long') {
        return `<textarea class="text_pole" rows="${type === 'long' ? 4 : 3}">${escapeHtml(value)}</textarea>`;
    }
    if (type === 'boolean') {
        return `<select class="text_pole"><option value="false" ${value !== 'true' ? 'selected' : ''}>아니오</option><option value="true" ${value === 'true' ? 'selected' : ''}>예</option></select>`;
    }
    if (type === 'status') {
        return `<select class="text_pole"><option value="pending" ${value === 'pending' ? 'selected' : ''}>미이행</option><option value="fulfilled" ${value === 'fulfilled' ? 'selected' : ''}>이행</option><option value="obsolete" ${value === 'obsolete' ? 'selected' : ''}>의미 없어짐</option></select>`;
    }
    if (type === 'importance') {
        return `<select class="text_pole"><option value="minor" ${value !== 'major' ? 'selected' : ''}>Minor</option><option value="major" ${value === 'major' ? 'selected' : ''}>Major</option></select>`;
    }
    return `<input class="text_pole" type="text" value="${escapeHtml(value)}" />`;
}

function renderRelationships(values = []) {
    return `
        <section class="stsm-atlas-editor-field stsm-relationship-editor" data-manual-relationships>
            <div class="stsm-atlas-editor-field-heading"><strong>관계 및 감정</strong>${renderAddButton('relationship', '관계 추가')}</div>
            <div class="stsm-relationship-editor-list">${(values || []).map(renderRelationshipRow).join('')}</div>
        </section>
    `;
}

function renderRelationshipRow(value = {}) {
    return `
        <div class="stsm-relationship-editor-row">
            <input class="text_pole" data-target-name type="text" value="${escapeHtml(value.targetName || value.targetId || '')}" placeholder="대상" />
            <textarea class="text_pole" data-relationship rows="2" placeholder="관계 · 한 줄에 하나">${escapeHtml((value.relationship || []).join('\n'))}</textarea>
            <textarea class="text_pole" data-feelings rows="2" placeholder="감정 · 한 줄에 하나">${escapeHtml((value.feelings || []).join('\n'))}</textarea>
            ${renderDeleteButton()}
        </div>
    `;
}

function renderParticipants(values = []) {
    return `
        <section class="stsm-atlas-editor-field stsm-participant-editor" data-manual-participants>
            <div class="stsm-atlas-editor-field-heading"><strong>참여자</strong>${renderAddButton('participant', '참여자 추가')}</div>
            <div class="stsm-participant-editor-list">${(values || []).map(renderParticipantRow).join('')}</div>
        </section>
    `;
}

function renderParticipantRow(value = {}) {
    return `
        <div class="stsm-participant-editor-row">
            <input class="text_pole" data-person-name type="text" value="${escapeHtml(value.personName || value.personId || '')}" placeholder="이름" />
            <input class="text_pole" data-person-role type="text" value="${escapeHtml(value.role || '')}" placeholder="역할" />
            ${renderDeleteButton()}
        </div>
    `;
}

function renderAddButton(kind, title) {
    return `<button class="menu_button menu_button_icon interactable" data-add-manual-row="${kind}" type="button" title="${title}" aria-label="${title}"><i class="fa-solid fa-plus"></i></button>`;
}

function renderDeleteButton() {
    return '<button class="menu_button menu_button_icon interactable" data-delete-manual-row type="button" title="행 삭제" aria-label="행 삭제"><i class="fa-solid fa-trash"></i></button>';
}

function bindRepeatingRows(form) {
    form.addEventListener('click', event => {
        const add = event.target.closest('[data-add-manual-row]');
        if (add?.dataset.addManualRow === 'relationship') {
            form.querySelector('.stsm-relationship-editor-list').insertAdjacentHTML('beforeend', renderRelationshipRow());
        } else if (add?.dataset.addManualRow === 'participant') {
            form.querySelector('.stsm-participant-editor-list').insertAdjacentHTML('beforeend', renderParticipantRow());
        } else if (event.target.closest('[data-delete-manual-row]')) {
            event.target.closest('.stsm-relationship-editor-row, .stsm-participant-editor-row')?.remove();
        }
    });
}

function readField(host, type) {
    if (type === 'list') return parseList(host.querySelector('textarea').value);
    if (type === 'long') return normalizeScalar(host.querySelector('textarea').value);
    if (['boolean', 'status', 'importance'].includes(type)) {
        const value = host.querySelector('select').value;
        return type === 'boolean' ? value === 'true' : value;
    }
    return normalizeScalar(host.querySelector('input').value);
}

function readRelationships(form) {
    return [...form.querySelectorAll('.stsm-relationship-editor-row')].map(row => {
        const targetName = normalizeScalar(row.querySelector('[data-target-name]').value);
        return targetName ? {
            targetId: null,
            targetName,
            relationship: parseList(row.querySelector('[data-relationship]').value),
            feelings: parseList(row.querySelector('[data-feelings]').value),
        } : null;
    }).filter(Boolean);
}

function readParticipants(form) {
    return [...form.querySelectorAll('.stsm-participant-editor-row')].map(row => {
        const personName = normalizeScalar(row.querySelector('[data-person-name]').value);
        return personName ? {
            personId: null,
            personName,
            role: normalizeScalar(row.querySelector('[data-person-role]').value),
        } : null;
    }).filter(Boolean);
}

function getConfig(category) {
    const config = CATEGORY_CONFIG[category];
    if (!config) throw new Error('지원하지 않는 도감 종류입니다.');
    return config;
}

function getCollectionName(category) {
    return category === 'people' ? 'people'
        : category === 'items' ? 'items'
            : category === 'commitments' ? 'commitments'
                : category === 'events' ? 'events'
                    : category === 'world' ? 'world'
                        : null;
}

function getPath(target, path) {
    return path.split('.').reduce((value, key) => value?.[key], target);
}

function setPath(target, path, value) {
    const keys = path.split('.');
    let cursor = target;
    keys.slice(0, -1).forEach(key => {
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
    });
    cursor[keys.at(-1)] = value;
}

function parseList(value) {
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function normalizeScalar(value) {
    return String(value || '').trim() || null;
}

function isEmptyRequired(value) {
    return Array.isArray(value) ? !value.length : !value;
}
