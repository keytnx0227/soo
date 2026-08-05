import { escapeHtml } from '../core/utils.js';
import { getItemAtlas } from './item-memory-service.js';

const STATE_LABELS = Object.freeze({
    owner: '소유자',
    holder: '소지자',
    location: '위치',
    condition: '물리 상태',
    status: '서사 상태',
});

export function bindItemMemoryView(root) {
    renderItemMemory(root);
}

export function renderItemMemory(root) {
    const list = root.querySelector('#stsm-item-memory-list');
    const count = root.querySelector('#stsm-item-memory-count');
    const skipped = root.querySelector('#stsm-item-memory-skipped');
    if (!list || !count || !skipped) return;

    const atlas = getItemAtlas();
    count.textContent = `${atlas.items.length.toLocaleString()}개`;
    skipped.innerHTML = renderSkippedUpdates(atlas.skippedUpdates);
    skipped.hidden = !atlas.skippedUpdates.length;
    list.innerHTML = atlas.items.length
        ? atlas.items.map(renderItem).join('')
        : '<div class="stsm-empty">아직 추출된 아이템 도감이 없습니다.</div>';
}

function renderItem(item) {
    return `
        <article class="stsm-item-card">
            <header>
                <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.aliases.length ? `<span>${item.aliases.map(escapeHtml).join(' · ')}</span>` : ''}
                </div>
                <div>
                    <code>${escapeHtml(item.id)}</code>
                    <span>#${item.firstSeenRange.startId} ~ #${item.lastUpdatedRange.endId}</span>
                </div>
            </header>
            <div class="stsm-item-fields">
                ${renderField('객관 정보', item.facts)}
                ${renderField('기능', item.functions)}
                ${renderLastKnownState(item.lastKnownState)}
            </div>
        </article>
    `;
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

function renderSkippedUpdates(updates) {
    if (!updates.length) return '';
    return `
        <div class="stsm-item-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>미적용 변경안 ${updates.length.toLocaleString()}개</strong>
        </div>
        ${updates.map(update => `
            <div>#${update.range.startId} ~ #${update.range.endId} · ${escapeHtml(update.targetId || 'ID 없음')} · ${escapeHtml(update.reason)}</div>
        `).join('')}
    `;
}
