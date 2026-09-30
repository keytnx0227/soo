import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { createId, escapeHtml } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { getAtlasProjection } from '../memory/atlas-projection-service.js';
import { showManualAtlasEntryEditor } from '../memory/atlas-manual-editor.js';
import { showPerceptionUpdateEditor } from '../memory/perception-memory-view.js';
import { buildRenderedBlocks } from '../summary/context-block-composer.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';
import { atlasUpdateEditorInitial, createManualAtlasUpdate, collectManualAtlasUpdates } from './manual-atlas-draft.js';
import { renderManualInfo } from './manual-record-settings.js';

const CATEGORIES = { people: '인물', items: '아이템', commitments: '서약', events: '사건', world: '세계 설정', perceptions: '인식' };
const entityLabel = entity => entity.observerName ? `${entity.observerName} → ${entity.subjectName}` : entity.name || entity.title || entity.keys?.join(', ') || entity.content || entity.id || entity.targetId;

export async function openManualAtlasManager(entries, getDraftRecord) {
    const working = structuredClone(entries);
    const form = document.createElement('div');
    form.className = 'stsm-manual-atlas-manager';
    form.innerHTML = `<header class="stsm-manual-heading"><h3>레코드 도감 관리</h3>
        ${renderManualInfo('도감 미리보기', '레코드를 저장하기 전의 초안입니다. 현재 출력 템플릿과 기존 도감 계산·보정을 적용해 비교합니다. 실제 합본에서는 검색 조건과 토큰 예산에 따라 출력 여부가 달라질 수 있습니다.')}</header>
        <div class="stsm-manual-atlas-controls">
            <label class="stsm-field"><span>도감</span><select class="text_pole" data-atlas-category>${Object.entries(CATEGORIES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
            <label class="stsm-field"><span>작업</span><select class="text_pole" data-atlas-kind><option value="created">새 항목</option><option value="updated">기존 항목 업데이트</option></select></label>
            <label class="stsm-field stsm-atlas-target"><span>업데이트 대상</span><select class="text_pole" data-atlas-target disabled></select></label>
            <button class="menu_button" type="button" data-atlas-add><i class="fa-solid fa-plus" aria-hidden="true"></i><span>작성</span></button>
        </div>
        <div data-atlas-drafts></div><div class="stsm-manual-error" role="alert" data-atlas-error></div>`;
    const category = form.querySelector('[data-atlas-category]');
    const kind = form.querySelector('[data-atlas-kind]');
    const target = form.querySelector('[data-atlas-target]');
    let atlas;
    const refreshTargets = () => {
        atlas = getAtlasProjection();
        kind.querySelector('[value="created"]').disabled = category.value === 'perceptions';
        if (category.value === 'perceptions') kind.value = 'updated';
        target.disabled = kind.value !== 'updated';
        target.innerHTML = `<option value="">${target.disabled ? '새 항목으로 생성' : '항목 선택'}</option>`
            + (atlas[category.value] || []).map(entity => `<option value="${escapeHtml(entity.id)}">${escapeHtml(entityLabel(entity))} · ${escapeHtml(entity.id)}</option>`).join('');
    };
    const render = () => {
        form.querySelector('[data-atlas-drafts]').innerHTML = working.length ? working.map((entry, index) => `
            <details class="stsm-manual-atlas-entry" data-atlas-entry="${index}">
                <summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span><small>${CATEGORIES[entry.category]} · ${entry.kind === 'updated' ? '업데이트' : '신규'}</small><strong>${escapeHtml(entry.label || entityLabel(entry.value))}</strong></span>
                    <button type="button" class="menu_button" data-atlas-edit="${index}" title="수정" aria-label="수정"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="menu_button" data-atlas-delete="${index}" title="삭제" aria-label="삭제"><i class="fa-solid fa-trash"></i></button>
                </summary><div class="stsm-manual-atlas-preview" data-atlas-preview></div>
            </details>`).join('') : '<div class="stsm-empty">작성한 도감 항목이 없습니다.</div>';
        form.querySelectorAll('[data-atlas-entry]').forEach(details => details.addEventListener('toggle', () => {
            if (!details.open) return;
            const entry = working[Number(details.dataset.atlasEntry)];
            try {
                const record = getDraftRecord(collectManualAtlasUpdates(working));
                const raw = getAtlasProjection({ draftRecords: [record], includeCorrections: false });
                const final = getAtlasProjection({ draftRecords: [record] });
                const id = entry.kind === 'updated' ? entry.value.targetId : entry.value.sourceId;
                const rawEntity = raw[entry.category].find(entity => entity.id === id);
                const finalEntity = final[entry.category].find(entity => entity.id === id);
                const own = entry.kind === 'updated' ? rawEntity : { ...entry.value, id };
                const ownRecord = { structuredSummary: { data: { memoryUpdates: collectManualAtlasUpdates([entry]) } } };
                const skipped = final.skippedUpdates?.[entry.category]?.filter(update => update.sourceRecordId === record.id && update.targetId === id) || [];
                details.querySelector('[data-atlas-preview]').innerHTML = `
                    <h4>작성 내용</h4>${renderRecordMemoryUpdateDetails(ownRecord)}
                    <h4>${entry.kind === 'updated' ? '업데이트 반영 출력 · 보정 전' : '이 항목의 출력'}</h4><pre>${escapeHtml(renderEntity(entry.category, own) || '출력 없음')}</pre>
                    <h4>최종 도감 · 기존 기록 및 보정 반영</h4><pre>${escapeHtml(renderEntity(entry.category, finalEntity) || '반영된 항목 없음')}</pre>
                    ${skipped.map(update => `<p class="stsm-manual-error">${escapeHtml(update.reason)}</p>`).join('')}`;
            } catch (error) { details.querySelector('[data-atlas-preview]').textContent = error.message; }
        }));
    };
    category.addEventListener('change', refreshTargets);
    kind.addEventListener('change', refreshTargets);
    form.addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button) return;
        const edit = button.dataset.atlasEdit;
        const remove = button.dataset.atlasDelete;
        if (edit === undefined && remove === undefined && !button.hasAttribute('data-atlas-add')) return;
        event.preventDefault();
        if (remove !== undefined) { working.splice(Number(remove), 1); render(); return; }
        const previous = edit === undefined ? null : working[Number(edit)];
        const selectedCategory = previous?.category || category.value;
        const selectedKind = previous?.kind || kind.value;
        button.disabled = true;
        try {
            const currentAtlas = getAtlasProjection();
            const entity = selectedKind === 'updated' ? currentAtlas[selectedCategory].find(item => item.id === (previous?.value.targetId || target.value)) : null;
            if (selectedKind === 'updated' && !entity) throw new Error('업데이트할 도감 항목을 선택해주세요.');
            const perception = selectedCategory === 'perceptions';
            const initial = entity && !perception ? atlasUpdateEditorInitial(selectedCategory, entity, previous?.value) : previous?.value;
            const value = perception ? await showPerceptionUpdateEditor(entity, previous?.value)
                : await showManualAtlasEntryEditor(selectedCategory, null, { draft: true, initial, update: Boolean(entity) });
            if (!value) return;
            const entry = { category: selectedCategory, kind: selectedKind,
                label: entity ? entityLabel(entity) : entityLabel(value),
                value: perception ? value : entity ? createManualAtlasUpdate(selectedCategory, entity, value)
                    : { ...value, sourceId: previous?.value.sourceId || createId('manual-atlas') } };
            if (previous) working[Number(edit)] = entry;
            else working.push(entry);
            render();
            form.querySelector('[data-atlas-error]').textContent = '';
            form.querySelectorAll('[data-atlas-entry]')[edit === undefined ? working.length - 1 : Number(edit)].open = true;
        } catch (error) { form.querySelector('[data-atlas-error]').textContent = error.message; }
        finally { button.disabled = false; }
    });
    refreshTargets(); render();
    const result = await new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: '적용', cancelButton: '취소', wide: true, large: true, allowVerticalScrolling: true,
    }).show();
    return result === POPUP_RESULT.AFFIRMATIVE ? working : null;
}

function renderEntity(category, entity) {
    if (!entity) return '';
    const atlas = { people: [], items: [], commitments: [], events: [], world: [], [category]: [entity] };
    const settings = getSettings().summarization;
    const blocks = buildRenderedBlocks(settings.contextBlocks.filter(block => block.kind === category), [], atlas, {
        worldRetrieval: category === 'world' ? [{ entry: entity, eligible: true, priority: 1 }] : [],
    });
    return blocks.flatMap(block => block.units.map(unit => unit.content)).join('\n\n');
}
