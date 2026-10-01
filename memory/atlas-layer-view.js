import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { escapeHtml } from '../core/utils.js';
import { beginOperation, endOperation } from '../core/extension-state.js';
import { getAtlasProjection } from './atlas-projection-service.js';
import { getAtlasLayerSnapshot, moveAtlasLayerAfter, resetAtlasLayerOrder, removeAtlasLayer, setAtlasLayerLocked } from './atlas-layer-service.js';
import { renderRecordMemoryUpdateDetails } from '../records/record-memory-updates-view.js';
import { translateAtlasReviewChanges } from '../translation/atlas-review-translation-service.js';

const CATEGORIES = { people: '인물', items: '아이템', commitments: '서약 장부', events: '주요 사건', world: '세계 설정', perceptions: '인식' };
const KINDS = { record: '레코드', review: '레코드 재검토', quick: '일괄 재검토', correction: '직접 수정', manual: '직접 작성' };
const FIELDS = { facts: '알고 있는 정보', impression: '종합 인식', name: '이름', title: '제목', role: '역할', aliases: '별칭',
    appearance: '외형', traits: '성격', voice: '말투', content: '내용', summary: '요약', terms: '서약 내용',
    relationships: '관계', participants: '참여 인물', status: '상태', statusReason: '상태 근거', keys: '키워드',
    functions: '기능', affiliations: '소속', age: '나이', occupation: '직업', conditions: '조건', deadline: '기한' };

export function bindAtlasLayerView(root) {
    root.querySelector('#stsm-open-atlas-layers')?.addEventListener('click', () => openAtlasLayers().catch(report));
}

export async function openAtlasLayers(initialCategory = 'perceptions') {
    const host = document.createElement('div');
    host.className = 'stsm-atlas-layers';
    host.innerHTML = `<header class="stsm-layer-toolbar"><strong>도감 레이어</strong><select class="text_pole" data-layer-category aria-label="도감 종류">${Object.entries(CATEGORIES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select>${button('reset', 'fa-rotate-left', '기본 순서로 복원')}</header><div data-layer-list></div><div data-layer-error class="stsm-manual-error" role="alert"></div>`;
    const category = host.querySelector('[data-layer-category]');
    category.value = Object.hasOwn(CATEGORIES, initialCategory) ? initialCategory : 'perceptions';
    let snapshot;
    let busy = false;
    let dragged = null;
    const list = host.querySelector('[data-layer-list]');
    const animations = new Map();
    const render = (animate = false) => {
        const existing = new Map([...list.querySelectorAll('[data-layer-id]')].map(row => [row.dataset.layerId, row]));
        const positions = new Map([...existing].map(([id, row]) => [id, row.getBoundingClientRect()]));
        animations.forEach(animation => animation.cancel());
        animations.clear();
        const focused = document.activeElement;
        snapshot = getAtlasLayerSnapshot(category.value);
        const names = entityNames(category.value);
        const template = document.createElement('template');
        template.innerHTML = snapshot.ordered.map((layer, index) => `<article class="stsm-layer-row" data-layer-id="${escapeHtml(layer.id)}" draggable="true">
            <div class="stsm-layer-label"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i><div><strong>${escapeHtml(layerTitle(layer, names))}</strong><small>${escapeHtml(layerMeta(layer))}${snapshot.moves.some(move => move.id === layer.id) ? ' · 위치 조정됨' : ''}</small></div></div>
            <div class="stsm-layer-actions">${button('up', 'fa-arrow-up', '앞으로 이동', index === 0)}${button('down', 'fa-arrow-down', '뒤로 이동', index === snapshot.ordered.length - 1)}${button('detail', 'fa-magnifying-glass', '자세히 보기')}${canRemove(layer) ? button('remove', 'fa-trash-can', layer.kind === 'manual' || layer.kind === 'correction' ? '직접 수정 제거' : '재검토판 전체 초기화') : ''}</div>
        </article>`).join('') || '<div class="stsm-empty">적용 중인 레이어가 없습니다.</div>';
        const liveIds = new Set(snapshot.ordered.map(layer => layer.id));
        [...list.children].forEach(row => { if (!liveIds.has(row.dataset.layerId)) row.remove(); });
        [...template.content.children].forEach((next, index) => {
            const row = existing.get(next.dataset.layerId);
            if (row) {
                for (const selector of ['strong', 'small']) {
                    const label = row.querySelector(selector);
                    const text = next.querySelector(selector).textContent;
                    if (label.textContent !== text) label.textContent = text;
                }
                row.querySelectorAll('button').forEach(button => {
                    button.disabled = next.querySelector(`[data-layer-action="${button.dataset.layerAction}"]`).disabled;
                });
            }
            const node = row || next;
            if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
        });
        if (list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
        // FLIP keeps the same rows and animates from their previous visual positions.
        if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            list.querySelectorAll('[data-layer-id]').forEach(row => {
                const before = positions.get(row.dataset.layerId);
                if (!before) return;
                const after = row.getBoundingClientRect();
                const x = before.left - after.left;
                const y = before.top - after.top;
                if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
                const animation = row.animate([
                    { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
                ], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
                animations.set(row, animation);
                animation.onfinish = () => { if (animations.get(row) === animation) animations.delete(row); };
            });
        }
        host.querySelector('[data-layer-action="reset"]').disabled = !snapshot.moves.length;
    };
    const run = async task => {
        if (busy) return;
        busy = true;
        host.querySelector('[data-layer-error]').textContent = '';
        host.setAttribute('aria-busy', 'true');
        category.disabled = true;
        try { await task(); }
        catch (error) { host.querySelector('[data-layer-error]').textContent = error.message; }
        finally { busy = false; category.disabled = false; host.removeAttribute('aria-busy'); render(true); }
    };
    category.addEventListener('change', () => { list.replaceChildren(); render(); });
    host.addEventListener('click', event => {
        const target = event.target.closest('[data-layer-action]');
        if (!target || busy) return;
        const action = target.dataset.layerAction;
        const id = target.closest('[data-layer-id]')?.dataset.layerId;
        const index = snapshot.ordered.findIndex(layer => layer.id === id);
        const layer = snapshot.ordered[index];
        void run(async () => {
            if (action === 'reset' && await Popup.show.confirm('기본 적용 순서로 복원할까요?', '위치 조정만 제거하며 수정 내용과 재검토판은 유지합니다.')) await resetAtlasLayerOrder(snapshot);
            if (action === 'up' && index > 0) await moveAtlasLayerAfter(snapshot, id, snapshot.ordered[index - 2]?.id || null);
            if (action === 'down' && index < snapshot.ordered.length - 1) await moveAtlasLayerAfter(snapshot, id, snapshot.ordered[index + 1].id);
            if (action === 'remove') await confirmRemoveAtlasLayer(snapshot, layer);
            if (action === 'detail') await showAtlasLayerDetails(snapshot.category, id);
        });
    });
    host.addEventListener('dragstart', event => {
        if (busy) { event.preventDefault(); return; }
        dragged = event.target.closest('[data-layer-id]')?.dataset.layerId;
        if (dragged) { event.dataTransfer.setData('text/plain', dragged); event.dataTransfer.effectAllowed = 'move'; }
    });
    host.addEventListener('dragover', event => { if (dragged && event.target.closest('[data-layer-id]')) event.preventDefault(); });
    host.addEventListener('drop', event => {
        const row = event.target.closest('[data-layer-id]');
        if (!row || !dragged || busy) return;
        event.preventDefault();
        const id = dragged;
        dragged = null;
        if (row.dataset.layerId === id) return;
        const before = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        const others = snapshot.ordered.filter(layer => layer.id !== id);
        const at = others.findIndex(layer => layer.id === row.dataset.layerId);
        const anchor = before ? others[at - 1]?.id || null : row.dataset.layerId;
        void run(() => moveAtlasLayerAfter(snapshot, id, anchor));
    });
    host.addEventListener('dragend', () => { dragged = null; });
    render();
    await new Popup(host, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true,
        onClosing: () => !busy }).show();
    animations.forEach(animation => animation.cancel());
}

export async function confirmRemoveAtlasLayer(snapshot, layer) {
    if (!layer || !canRemove(layer)) return false;
    const message = layer.kind === 'correction' || layer.kind === 'manual'
        ? '이 직접 수정만 제거하고 남은 레코드와 재검토판으로 다시 계산합니다. 인식 칸 자체는 유지합니다.'
        : '이 묶음의 재검토판을 제거합니다. 원본 레코드는 유지되며, 레코드 재검토판이 있던 자리는 원본 추출 내용으로 돌아갑니다. 직접 수정은 유지합니다.';
    if (!await Popup.show.confirm(`${layerTitle(layer, entityNames(snapshot.category))} 삭제할까요?`, message)) return false;
    await removeAtlasLayer(snapshot, layer.id);
    return true;
}

export async function showAtlasLayerDetails(category, id) {
    const snapshot = getAtlasLayerSnapshot(category);
    const layer = snapshot.layers.find(layer => layer.id === id);
    if (!layer) throw new Error('레이어가 변경되었습니다. 목록을 다시 열어주세요.');
    const names = entityNames(category);
    const title = layerTitle(layer, names);
    const host = document.createElement('div');
    host.className = 'stsm-layer-detail';
    const data = layer.records ? layer.records.map(record => ({ range: range(record), updates: record.atlasReviewOverrides?.[category]?.memoryUpdates
        || (record.category ? record.memoryUpdates : record.structuredSummary?.data?.memoryUpdates?.[category]) }))
        : layer.fields || manualFields(layer);
    host.innerHTML = `<header class="stsm-layer-toolbar"><strong>${escapeHtml(title)}</strong><div class="stsm-layer-actions">${button('translate', 'fa-language', '내용 번역')}${button('toggle', 'fa-right-left', '원문/번역 전환', true)}${canRemove(layer) ? button('remove', 'fa-trash-can', '이 레이어 삭제') : ''}</div></header>
        <small>${escapeHtml(layerMeta(layer))}</small>
        ${layer.kind === 'correction' ? `<label><input type="checkbox" data-layer-lock ${Object.values(layer.fields).every(field => field.locked) ? 'checked' : ''} /> 수정값 잠금</label>` : ''}
        <div data-layer-original>${layer.records ? layer.records.map(record => {
            const updates = record.atlasReviewOverrides?.[category]?.memoryUpdates || (record.category ? record.memoryUpdates : record.structuredSummary?.data?.memoryUpdates?.[category]);
            return `<section><h4>${escapeHtml(range(record))}</h4>${renderRecordMemoryUpdateDetails({ structuredSummary: { data: { memoryUpdates: { [category]: updates } } } }) || '<p>변경 내용 없음</p>'}</section>`;
        }).join('') : renderFields(layer.fields || Object.fromEntries(Object.entries(manualFields(layer)).map(([key, value]) => [key, { value }])))}</div>
        <div data-layer-translation hidden></div><details><summary>JSON</summary><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></details><div class="stsm-manual-error" data-layer-error role="alert"></div>`;
    let busy = false;
    let editSnapshot = snapshot;
    const lock = host.querySelector('[data-layer-lock]');
    if (lock) lock.indeterminate = Object.values(layer.fields).some(field => field.locked) && !lock.checked;
    host.querySelector('[data-layer-lock]')?.addEventListener('change', async event => {
        if (busy) return;
        busy = true;
        try { await setAtlasLayerLocked(editSnapshot, id, event.target.checked); editSnapshot = getAtlasLayerSnapshot(category); }
        catch (error) { event.target.checked = !event.target.checked; host.querySelector('[data-layer-error]').textContent = error.message; }
        finally { busy = false; }
    });
    host.addEventListener('click', async event => {
        const target = event.target.closest('[data-layer-action]');
        if (!target || busy) return;
        const action = target.dataset.layerAction;
        if (action === 'toggle') {
            const original = host.querySelector('[data-layer-original]');
            original.hidden = !original.hidden;
            host.querySelector('[data-layer-translation]').hidden = !original.hidden;
            return;
        }
        busy = true;
        try {
            if (action === 'translate') {
                const token = beginOperation('translating', '도감 레이어 번역 중');
                try {
                    const result = await translateAtlasReviewChanges({ updated: [{ name: title, value: host.querySelector('[data-layer-original]').innerText }] });
                    host.querySelector('[data-layer-translation]').textContent = result.content;
                    host.querySelector('[data-layer-translation]').hidden = false;
                    host.querySelector('[data-layer-original]').hidden = true;
                    host.querySelector('[data-layer-action="toggle"]').disabled = false;
                } finally { endOperation(token); }
            }
            if (action === 'remove' && await confirmRemoveAtlasLayer(editSnapshot, layer)) host.innerHTML = '<div class="stsm-empty">레이어를 삭제했습니다.</div>';
        } catch (error) { host.querySelector('[data-layer-error]').textContent = error.message; }
        finally { busy = false; }
    });
    await new Popup(host, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true, onClosing: () => !busy }).show();
}

function entityNames(category) {
    const atlas = getAtlasProjection();
    return new Map([...(atlas[category] || []), ...(atlas.excluded?.[category] || [])].map(entry => [entry.id,
        category === 'perceptions' ? `${entry.observerName} → ${entry.subjectName}` : entry.name || entry.title || entry.keys?.join(', ') || entry.id]));
}
function layerTitle(layer, names) { return `${layer.kind === 'manual' && layer.category === 'perceptions' ? '직접 수정' : KINDS[layer.kind]} · ${layer.entityId ? names.get(layer.entityId) || layer.entityId : range({ startId: layer.records[0].startId, endId: layer.records.at(-1).endId })}`; }
function layerMeta(layer) { return layer.records ? `${layer.records.length}개 레코드` : `#${layer.position} 기준${layer.fields && Object.values(layer.fields).some(field => field.locked) ? ' · 잠금 포함' : ''}${layer.value?.allowAutoUpdate === false ? ' · 자동 갱신 꺼짐' : ''}`; }
function canRemove(layer) { return ['review', 'quick', 'correction'].includes(layer.kind) || (layer.kind === 'manual' && layer.category === 'perceptions'); }
function range(record) { return record.startId == null || record.endId == null ? '보충 기억' : `#${record.startId} ~ #${record.endId}`; }
function button(action, icon, title, disabled = false) { return `<button type="button" class="menu_button menu_button_icon" data-layer-action="${action}" title="${title}" aria-label="${title}"${disabled ? ' disabled' : ''}><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`; }
function renderFields(fields) { return `<dl class="stsm-layer-fields">${Object.entries(fields).map(([path, field]) => `<dt>${escapeHtml(FIELDS[path] || path)}${field.locked ? ' · 잠금' : ''}</dt><dd>${escapeHtml(readable(field.value))}</dd>`).join('')}</dl>`; }
function readable(value) { if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '(비움)'; if (Array.isArray(value)) return value.map(readable).join('\n'); if (typeof value === 'object') return value.text || Object.entries(value).filter(([key]) => key !== 'id').map(([key, item]) => `${FIELDS[key] || key}: ${readable(item)}`).join('\n'); return String(value); }
function manualFields(layer) { return Object.fromEntries(Object.entries(layer.value).filter(([key]) => layer.category === 'perceptions' ? ['facts', 'impression'].includes(key) : !['id', 'allowAutoUpdate', 'appliedThroughId', 'createdAt', 'updatedAt'].includes(key))); }
function report(error) { console.error('[Chat Summarizer] Atlas layers:', error); toastr.error(error.message); }
