import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { createId, escapeHtml } from '../core/utils.js';
import { getExtensionState } from '../core/extension-state.js';
import { getAtlasProjection } from './atlas-projection-service.js';
import { addManualAtlasEntry, updateManualAtlasEntry, getManualAtlasEntries, setAtlasEntityExcluded, setAtlasEntityLlmHidden } from './atlas-metadata.js';

export function renderPerceptionMemory(root) {
    const host = root.querySelector('[data-perception-list]');
    if (!host) return;
    const atlas = getAtlasProjection();
    const slots = [...atlas.perceptions, ...(atlas.excluded?.perceptions || [])];
    root.querySelector('[data-perception-count]').textContent = `${atlas.perceptions.length}개`;
    host.innerHTML = slots.length ? slots.map(slot => `<article class="stsm-perception-entry ${slot.excluded ? 'is-excluded' : ''}">
        <header><strong>${escapeHtml(slot.observerName)} → ${escapeHtml(slot.subjectName)}</strong><div class="stsm-perception-actions">
        ${action('edit', 'fa-pen', '수정', slot.id)}
        ${action('visibility', slot.llmHidden ? 'fa-eye' : 'fa-eye-slash', slot.llmHidden ? 'LLM에 다시 보이기' : 'LLM에서 감추기', slot.id)}
        ${action('exclude', slot.excluded ? 'fa-rotate-left' : 'fa-trash', slot.excluded ? '복원' : '제외', slot.id)}</div></header>
        ${slot.unresolved ? '<p class="stsm-manual-error">연결된 인물을 찾을 수 없습니다. 출력에서 제외됩니다.</p>' : ''}
        ${slot.llmHidden ? '<small>LLM 비공개</small>' : ''}${slot.excluded ? '<small>제외됨</small>' : ''}
        ${!slot.allowAutoUpdate ? '<small>자동 갱신 꺼짐</small>' : ''}
        <h4>알고 있는 정보</h4><ul>${slot.facts.map(fact => `<li>${escapeHtml(fact.text)}</li>`).join('') || '<li>없음</li>'}</ul>
        <h4>종합 인식</h4><p>${escapeHtml(slot.impression || '없음')}</p></article>`).join('') : '<div class="stsm-empty">등록된 인식 칸이 없습니다.</div>';
    const warning = root.querySelector('[data-perception-warning]');
    warning.textContent = (atlas.skippedUpdates.perceptions || []).map(item => item.reason).join('\n');
    warning.hidden = !warning.textContent;
}

function action(name, icon, title, id) {
    return `<button type="button" class="menu_button" data-perception-action="${name}" data-id="${escapeHtml(id)}" title="${title}" aria-label="${title}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
}

export function bindPerceptionMemoryView(root) {
    const host = root.querySelector('[data-perception-list]');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = 'true';
    root.querySelector('[data-perception-add]').addEventListener('click', () => editPerception().then(() => renderPerceptionMemory(root)).catch(error => toastr.error(error.message)));
    host.addEventListener('click', async event => {
        const button = event.target.closest('[data-perception-action]');
        if (!button) return;
        try {
            if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 변경해주세요.');
            const atlas = getAtlasProjection();
            const slot = [...atlas.perceptions, ...(atlas.excluded?.perceptions || [])].find(item => item.id === button.dataset.id);
            if (!slot) return;
            if (button.dataset.perceptionAction === 'edit') await editPerception(slot);
            if (button.dataset.perceptionAction === 'visibility') await setAtlasEntityLlmHidden('perceptions', slot.id, !slot.llmHidden);
            if (button.dataset.perceptionAction === 'exclude') await setAtlasEntityExcluded('perceptions', slot.id, !slot.excluded);
            renderPerceptionMemory(root);
        } catch (error) { toastr.error(error.message); }
    });
    renderPerceptionMemory(root);
}

async function editPerception(slot = null) {
    if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 변경해주세요.');
    const context = SillyTavern.getContext();
    const chat = context.chat;
    const metadata = context.chatMetadata;
    const atlas = getAtlasProjection();
    const initial = JSON.stringify(getManualAtlasEntries('perceptions'));
    const initialProjection = JSON.stringify([...atlas.perceptions, ...(atlas.excluded?.perceptions || [])]);
    const people = atlas.people;
    if (!slot && people.length < 2) throw new Error('먼저 인물 도감에 두 인물 이상을 등록해주세요.');
    const options = selected => people.map(person => `<option value="${escapeHtml(person.id)}" ${person.id === selected ? 'selected' : ''}>${escapeHtml(person.name)}${people.some(other => other.id !== person.id && other.name === person.name) ? ` · ${escapeHtml(person.id)}` : ''}</option>`).join('')
        + (selected && !people.some(person => person.id === selected) ? `<option selected value="${escapeHtml(selected)}">연결 끊김 · ${escapeHtml(selected)}</option>` : '');
    const form = document.createElement('div');
    form.className = 'stsm-perception-editor';
    form.innerHTML = `<h3>${slot ? '인식 수정' : '인식 칸 추가'}</h3><div class="stsm-grid-two">
        <label class="stsm-field"><span>인식하는 인물</span><select class="text_pole" data-observer ${slot ? 'disabled' : ''}>${options(slot?.observerId)}</select></label>
        <label class="stsm-field"><span>대상 인물</span><select class="text_pole" data-subject ${slot ? 'disabled' : ''}>${options(slot?.subjectId || people[1]?.id)}</select></label></div>
        <label class="stsm-field"><span>알고 있는 정보</span><textarea class="text_pole" rows="6" data-facts placeholder="한 줄에 하나씩">${escapeHtml((slot?.facts || []).map(fact => fact.text).join('\n'))}</textarea></label>
        <label class="stsm-field"><span>종합 인식</span><textarea class="text_pole" rows="3" data-impression>${escapeHtml(slot?.impression || '')}</textarea></label>
        <label><input type="checkbox" data-auto ${!slot || slot.allowAutoUpdate ? 'checked' : ''} /> 요약 시 자동 갱신</label>
        <div class="stsm-manual-error" data-error role="alert"></div>`;
    await new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', wide: true, allowVerticalScrolling: true,
        onClosing: async popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                const current = SillyTavern.getContext();
                if (current.chat !== chat || current.chatMetadata !== metadata) throw new Error('채팅이 변경되었습니다.');
                if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 저장해주세요.');
                if (JSON.stringify(getManualAtlasEntries('perceptions')) !== initial) throw new Error('인식 설정이 변경되었습니다. 창을 다시 열어주세요.');
                const latest = getAtlasProjection();
                if (JSON.stringify([...latest.perceptions, ...(latest.excluded?.perceptions || [])]) !== initialProjection) throw new Error('인식 내용이 변경되었습니다. 창을 다시 열어주세요.');
                const observerId = form.querySelector('[data-observer]').value;
                const subjectId = form.querySelector('[data-subject]').value;
                if (observerId === subjectId) throw new Error('서로 다른 두 인물을 선택해주세요.');
                if (!slot && getManualAtlasEntries('perceptions').some(item => item.observerId === observerId && item.subjectId === subjectId)) throw new Error('이미 등록된 인식 방향입니다.');
                const texts = [...new Set(form.querySelector('[data-facts]').value.split('\n').map(text => text.trim()).filter(Boolean))];
                const value = { observerId, subjectId, allowAutoUpdate: form.querySelector('[data-auto]').checked,
                    hasBaseline: Boolean(slot),
                    appliedThroughId: getAtlasProjection().frontierId,
                    facts: texts.map(text => ({ id: slot?.facts.find(fact => fact.text === text)?.id || createId('perception-fact'), text })),
                    impression: form.querySelector('[data-impression]').value.trim() || null };
                if (slot) await updateManualAtlasEntry('perceptions', slot.id, value);
                else await addManualAtlasEntry('perceptions', value);
                return true;
            } catch (error) { form.querySelector('[data-error]').textContent = error.message; return false; }
        },
    }).show();
}

export async function showPerceptionUpdateEditor(slot, patch = {}) {
    const form = document.createElement('div');
    form.className = 'stsm-perception-editor';
    const changes = new Map((patch.factUpdates || []).map(change => [change.targetId, change.text]));
    form.innerHTML = `<h3>${escapeHtml(slot.observerName)} → ${escapeHtml(slot.subjectName)}</h3>
        <label class="stsm-field"><span>새로 알게 된 정보</span><textarea class="text_pole" rows="4" data-new-facts placeholder="한 줄에 하나씩">${escapeHtml((patch.append?.facts || []).join('\n'))}</textarea></label>
        ${slot.facts.map(fact => `<label class="stsm-field"><span>기존 정보 수정</span><textarea class="text_pole" rows="2" data-fact-id="${escapeHtml(fact.id)}">${escapeHtml(changes.get(fact.id) ?? fact.text)}</textarea></label>`).join('')}
        <label class="stsm-field"><span>종합 인식</span><textarea class="text_pole" rows="3" data-impression>${escapeHtml(Object.hasOwn(patch.replace || {}, 'impression') ? patch.replace.impression || '' : slot.impression || '')}</textarea></label>
        <div class="stsm-manual-error" data-error role="alert"></div>`;
    let result;
    await new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '적용', cancelButton: '취소', wide: true, allowVerticalScrolling: true,
        onClosing: popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            const factUpdates = [...form.querySelectorAll('[data-fact-id]')].map(input => ({ targetId: input.dataset.factId, text: input.value.trim() }))
                .filter(change => changes.has(change.targetId) || change.text !== slot.facts.find(fact => fact.id === change.targetId)?.text);
            if (factUpdates.some(change => !change.text)) { form.querySelector('[data-error]').textContent = '수정할 정보는 빈칸으로 둘 수 없습니다.'; return false; }
            const impression = form.querySelector('[data-impression]').value.trim() || null;
            result = { targetId: slot.id, append: { facts: [...new Set(form.querySelector('[data-new-facts]').value.split('\n').map(text => text.trim()).filter(Boolean))] }, factUpdates,
                replace: impression !== slot.impression || Object.hasOwn(patch.replace || {}, 'impression') ? { impression } : {} };
            return true;
        },
    }).show();
    return result || null;
}
