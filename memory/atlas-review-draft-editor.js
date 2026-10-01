import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { getEditableAtlasReviewUpdates } from './atlas-review-service.js';
import { showManualAtlasEntryEditor } from './atlas-manual-editor.js';
import { showPerceptionUpdateEditor } from './perception-memory-view.js';
import { atlasUpdateEditorInitial, createManualAtlasUpdate } from '../records/manual-atlas-draft.js';
import { renderRecordMemoryUpdateDetails } from '../records/record-memory-updates-view.js';

export function mergeReviewUpdate(category, entity, previous, value) {
    // Keep explicit replacements even if they equal the current projected value.
    let edited;
    try { edited = createManualAtlasUpdate(category, entity, value); }
    catch (error) {
        if (!Object.keys(previous.replace || {}).length) throw error;
        edited = { targetId: entity.id, replace: {}, append: {} };
    }
    const replace = { ...edited.replace };
    for (const key of Object.keys(previous.replace || {})) replace[key] = structuredClone(value[key] ?? null);
    const append = { ...previous.append, ...edited.append };
    for (const key of Object.keys(previous.append || {})) append[key] = structuredClone(value[key] || []);
    return { ...previous, ...edited, replace, append, targetId: previous.targetId };
}

export async function showAtlasReviewDraftEditor(draft, index) {
    const entry = draft.entries[index];
    const working = getEditableAtlasReviewUpdates(draft, index);
    working.created ||= [];
    working.updated ||= [];
    const category = draft.category;
    const entities = [...(draft.after || []), ...(draft.before || [])];
    const form = document.createElement('div');
    form.className = 'stsm-review-draft-editor';
    let busy = false;
    const protectedTarget = value => category === 'perceptions' && draft.perceptionIds?.length && !draft.perceptionIds.includes(value.targetId);
    const render = () => {
        form.innerHTML = `<h3>변경안 편집 · #${entry.startId} ~ #${entry.endId}</h3><div data-review-proposals></div><div class="stsm-manual-error" role="alert" data-review-edit-error></div>`;
        const list = form.querySelector('[data-review-proposals]');
        for (const kind of ['created', 'updated']) working[kind].forEach((value, at) => {
            if (protectedTarget(value)) return;
            const block = document.createElement('section');
            block.className = 'stsm-review-proposal';
            block.dataset.kind = kind;
            block.dataset.index = at;
            block.innerHTML = `<div class="stsm-review-proposal-actions"><strong>${kind === 'created' ? '신규 항목' : '업데이트'}</strong>
                <button type="button" class="menu_button menu_button_icon" data-review-edit title="수정" aria-label="수정"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="menu_button menu_button_icon" data-review-remove title="제안 제거" aria-label="제안 제거"><i class="fa-solid fa-trash-can"></i></button></div>
                ${renderRecordMemoryUpdateDetails({ structuredSummary: { data: { memoryUpdates: { [category]: { created: [], updated: [], [kind]: [value] } } } } })}`;
            list.append(block);
        });
        if (!list.children.length) list.innerHTML = '<p>편집할 변경안이 없습니다.</p>';
    };
    form.addEventListener('click', async event => {
        const button = event.target.closest('[data-review-edit], [data-review-remove]');
        if (!button || busy) return;
        const block = button.closest('[data-kind]');
        const kind = block.dataset.kind;
        const at = Number(block.dataset.index);
        const previous = working[kind][at];
        busy = true;
        try {
            if (button.hasAttribute('data-review-remove')) {
                if (await Popup.show.confirm('이 제안을 제거할까요?', '초안에서만 제거합니다. 다른 구간의 변경안은 그대로 유지됩니다.')) working[kind].splice(at, 1);
            } else if (kind === 'created') {
                const value = await showManualAtlasEntryEditor(category, null, { draft: true, initial: previous });
                if (value) working[kind][at] = { ...previous, ...value, sourceId: previous.sourceId };
            } else {
                const entity = entities.find(item => item.id === previous.targetId);
                if (!entity) throw new Error('변경 대상이 현재 초안에 없습니다. 앞 구간의 생성 제안이나 연결 대상을 확인해주세요.');
                if (category === 'perceptions') {
                    const value = await showPerceptionUpdateEditor(entity, previous);
                    if (value) working[kind][at] = { ...previous, ...value, targetId: previous.targetId };
                } else {
                    const initial = atlasUpdateEditorInitial(category, entity, previous);
                    const value = await showManualAtlasEntryEditor(category, null, { draft: true, initial, update: true });
                    if (value) working[kind][at] = mergeReviewUpdate(category, entity, previous, value);
                }
            }
            render();
        } catch (error) { form.querySelector('[data-review-edit-error]').textContent = error.message; }
        finally { busy = false; }
    });
    render();
    const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '초안에 반영', cancelButton: '취소',
        wide: true, large: true, allowVerticalScrolling: true, onClosing: () => !busy }).show();
    return result === POPUP_RESULT.AFFIRMATIVE ? working : null;
}
