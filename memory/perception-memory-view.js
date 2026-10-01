import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { createId, escapeHtml } from '../core/utils.js';
import { getExtensionState, beginOperation, endOperation } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import { getTokenCount } from '../../../../../scripts/tokenizers.js';
import { formatAtlasSourceRange } from './atlas-source-record.js';
import { buildRenderedBlocks } from '../summary/context-block-composer.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { getValidAtlasTranslation, translateAtlasEntity } from '../translation/atlas-translation-service.js';
import { renderTokenUsageBar } from '../ui/token-usage-view.js';
import { getAtlasProjection } from './atlas-projection-service.js';
import { addManualAtlasEntry, updateManualAtlasEntry, deleteManualAtlasEntry, getManualAtlasEntries, setAtlasEntityExcluded, setAtlasEntityLlmHidden, setPerceptionPinned, getAtlasTranslations } from './atlas-metadata.js';

export function renderPerceptionMemory(root, contextDetails = null) {
    const host = root.querySelector('[data-perception-list]');
    if (!host) return;
    const atlas = getAtlasProjection();
    const slots = [...atlas.perceptions, ...(atlas.excluded?.perceptions || [])];
    root.querySelector('[data-perception-count]').textContent = `${atlas.perceptions.length}개`;
    const translations = getAtlasTranslations('perceptions');
    const blockSettings = getSettings().summarization.contextBlocks.filter(block => block.kind === 'perceptions');
    const units = buildRenderedBlocks(blockSettings, [], { perceptions: slots }).flatMap(block => block.units);
    const tokens = new Map(units.map(unit => [unit.id, getTokenCount(unit.content)]));
    const details = contextDetails || buildSummaryContextDetails();
    const block = details.blocks?.find(item => item.kind === 'perceptions');
    const omitted = new Set((block?.omittedItems || []).map(item => item.id));
    const usage = root.querySelector('[data-perception-tokens]');
    if (usage) usage.innerHTML = renderTokenUsageBar({ label: '인식 도감 주입', used: block?.outputTokenCount || 0,
        max: block?.budget, enabled: Boolean(details.enabled && block?.enabled) });
    const renderSlot = slot => {
        const translation = getValidAtlasTranslation('perceptions', slot, translations[slot.id] || null);
        return `<article class="stsm-item-card stsm-perception-entry${slot.llmHidden || slot.endpointHidden ? ' stsm-atlas-card-llm-hidden' : ''}${omitted.has(slot.id) ? ' stsm-atlas-card-injection-omitted' : ''}" data-entity-id="${escapeHtml(slot.id)}">
        <header><div><strong>${escapeHtml(slot.observerName)} → ${escapeHtml(slot.subjectName)}</strong>
        ${slot.llmHidden ? '<span class="stsm-atlas-correction-state">LLM 비공개</span>' : ''}
        ${slot.endpointHidden ? '<span class="stsm-atlas-correction-state">연결 인물 비공개 · 주입 제외</span>' : ''}
        ${omitted.has(slot.id) ? '<span class="stsm-atlas-injection-state">예산으로 주입 제외</span>' : ''}
        ${!slot.allowAutoUpdate ? '<span class="stsm-atlas-correction-state">자동 갱신 꺼짐</span>' : ''}</div>
        <div class="stsm-atlas-card-side"><div class="stsm-atlas-card-actions">
        ${!slot.excluded ? action('pin', 'fa-thumbtack', slot.pinned ? '고정 해제' : '고정 · 토큰 예산 내 우선 보존', slot.id, slot.pinned) : ''}
        ${action('edit', 'fa-pen', '수정', slot.id)}
        ${action('visibility', slot.llmHidden ? 'fa-eye' : 'fa-eye-slash', slot.llmHidden ? 'LLM에 다시 보이기' : 'LLM에서 감추기', slot.id)}
        ${!slot.excluded ? action('translate', 'fa-language', translation ? '번역 재생성' : '번역', slot.id) : ''}
        ${translation ? action('toggle-translation', 'fa-right-left', '원문/번역 전환', slot.id, true) : ''}
        ${action('exclude', slot.excluded ? 'fa-rotate-left' : 'fa-trash', slot.excluded ? '복원' : '도감에서 삭제', slot.id)}
        ${slot.excluded ? action('delete-permanently', 'fa-trash-can', '인식 칸 영구 삭제', slot.id) : ''}</div>
        <div class="stsm-atlas-card-meta"><code>${escapeHtml(slot.id)}</code>
        <span>${slot.firstSeenRange ? formatAtlasSourceRange(slot.firstSeenRange, slot.lastUpdatedRange) : '직접 추가 · 기록 범위 없음'}</span>
        <span title="현재 인식 출력 템플릿으로 렌더링한 원문 기준">${(tokens.get(slot.id) || 0).toLocaleString()} tokens</span></div></div></header>
        ${slot.unresolved ? '<p class="stsm-manual-error">연결된 인물을 찾을 수 없습니다. 출력에서 제외됩니다.</p>' : ''}
        <div class="stsm-item-fields stsm-atlas-original"${translation ? ' hidden' : ''}>
        <div class="stsm-item-field"><strong>알고 있는 정보</strong><div>${slot.facts.map(fact => `<span>${escapeHtml(fact.text)}</span>`).join('') || '<span>없음</span>'}</div></div>
        <div class="stsm-item-field"><strong>종합 인식</strong><div><span>${escapeHtml(slot.impression || '없음')}</span></div></div></div>
        ${translation ? `<div class="stsm-atlas-translation">${escapeHtml(translation.content)}</div>` : ''}</article>`;
    };
    const excludedOpen = Boolean(host.querySelector('.stsm-atlas-excluded')?.open);
    host.innerHTML = `<div class="stsm-item-memory-list">${atlas.perceptions.map(renderSlot).join('') || '<div class="stsm-empty">등록된 인식 칸이 없습니다.</div>'}</div>`
        + (atlas.excluded?.perceptions?.length ? `<details class="stsm-atlas-excluded"${excludedOpen ? ' open' : ''}><summary>삭제된 인식 ${atlas.excluded.perceptions.length}개</summary><div class="stsm-item-memory-list">${atlas.excluded.perceptions.map(renderSlot).join('')}</div></details>` : '');
    const warning = root.querySelector('[data-perception-warning]');
    warning.textContent = (atlas.skippedUpdates.perceptions || []).map(item => item.reason).join('\n');
    warning.hidden = !warning.textContent;
}

function action(name, icon, title, id, pressed = null) {
    return `<button type="button" class="menu_button menu_button_icon interactable" data-perception-action="${name}" data-id="${escapeHtml(id)}" title="${title}" aria-label="${title}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
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
            if (button.dataset.perceptionAction === 'toggle-translation') {
                const card = button.closest('[data-entity-id]');
                const original = card.querySelector('.stsm-atlas-original');
                const translation = card.querySelector('.stsm-atlas-translation');
                original.hidden = !original.hidden;
                translation.hidden = !original.hidden;
                button.setAttribute('aria-pressed', String(original.hidden));
                return;
            }
            if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 변경해주세요.');
            const atlas = getAtlasProjection();
            const slot = [...atlas.perceptions, ...(atlas.excluded?.perceptions || [])].find(item => item.id === button.dataset.id);
            if (!slot) return;
            if (button.dataset.perceptionAction === 'edit') await editPerception(slot);
            if (button.dataset.perceptionAction === 'pin') await setPerceptionPinned(slot.id, !slot.pinned);
            if (button.dataset.perceptionAction === 'visibility') await setAtlasEntityLlmHidden('perceptions', slot.id, !slot.llmHidden);
            if (button.dataset.perceptionAction === 'exclude') {
                if (!slot.excluded && !await Popup.show.confirm('인식을 도감에서 삭제할까요?', '인식 칸과 기록은 보존되며, 삭제된 인식 목록에서 복원할 수 있습니다.')) return;
                await setAtlasEntityExcluded('perceptions', slot.id, !slot.excluded);
                toastr.success(slot.excluded ? '인식을 복원했습니다.' : '인식을 삭제된 목록으로 옮겼습니다.');
            }
            if (button.dataset.perceptionAction === 'delete-permanently' && slot.excluded) {
                const { chat, chatMetadata } = SillyTavern.getContext();
                if (!await Popup.show.confirm('이 인식 칸을 영구 삭제할까요?',
                    '인식 칸과 번역·개별 설정을 지우며 복원할 수 없습니다. 요약 레코드 자체는 유지됩니다. 같은 방향을 다시 만들면 새 칸으로 시작하고 이전 칸의 기록은 연결되지 않습니다.')) return;
                const current = SillyTavern.getContext();
                if (current.chat !== chat || current.chatMetadata !== chatMetadata) throw new Error('채팅이 변경되었습니다.');
                if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 변경해주세요.');
                const latest = getAtlasProjection().excluded?.perceptions?.find(item => item.id === slot.id);
                if (!latest || JSON.stringify(latest) !== JSON.stringify(slot)) throw new Error('인식 내용이 변경되었습니다. 다시 확인해주세요.');
                await deleteManualAtlasEntry('perceptions', slot.id);
                toastr.success('인식 칸을 영구 삭제했습니다.');
            }
            if (button.dataset.perceptionAction === 'translate') {
                if (getValidAtlasTranslation('perceptions', slot) && !await Popup.show.confirm('번역을 재생성하시겠습니까?', '기존 번역은 덮어씌워집니다.')) return;
                const token = beginOperation('translating', '인식 도감 번역 중');
                try { await translateAtlasEntity('perceptions', slot.id); }
                finally { endOperation(token); }
            }
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
                if (!slot && getManualAtlasEntries('perceptions').some(item => item.observerId === observerId && item.subjectId === subjectId)) throw new Error('이미 등록된 인식 방향입니다. 삭제된 목록에 있다면 복원하거나 영구 삭제한 뒤 새로 만들어주세요.');
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
