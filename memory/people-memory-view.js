import { escapeHtml } from '../core/utils.js';
import { getPeopleAtlas } from './people-memory-service.js';

const FIELD_LABELS = Object.freeze({
    facts: '객관 정보',
    roles: '역할',
    affiliations: '소속',
    personalityTraits: '성격',
    speechPatterns: '말투',
});

export function bindPeopleMemoryView(root) {
    renderPeopleMemory(root);
}

export function renderPeopleMemory(root) {
    const list = root.querySelector('#stsm-people-memory-list');
    const count = root.querySelector('#stsm-people-memory-count');
    const skipped = root.querySelector('#stsm-people-memory-skipped');
    if (!list || !count || !skipped) return;

    const atlas = getPeopleAtlas();
    count.textContent = `${atlas.people.length.toLocaleString()}명`;
    skipped.innerHTML = renderSkippedUpdates(atlas.skippedUpdates);
    skipped.hidden = !atlas.skippedUpdates.length;
    list.innerHTML = atlas.people.length
        ? atlas.people.map(renderPerson).join('')
        : '<div class="stsm-empty">아직 추출된 인물 도감이 없습니다.</div>';
}

function renderPerson(person) {
    return `
        <article class="stsm-person-card">
            <header>
                <div>
                    <strong>${escapeHtml(person.name)}</strong>
                    ${person.aliases.length ? `<span>${person.aliases.map(escapeHtml).join(' · ')}</span>` : ''}
                </div>
                <div>
                    <code>${escapeHtml(person.id)}</code>
                    <span>#${person.firstSeenRange.startId} ~ #${person.lastUpdatedRange.endId}</span>
                </div>
            </header>
            <div class="stsm-person-fields">
                ${Object.entries(FIELD_LABELS).map(([key, label]) => renderField(label, person[key])).join('')}
                ${renderLastKnownState(person.lastKnownState)}
                ${renderRelationships(person.relationships)}
            </div>
        </article>
    `;
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

function renderSkippedUpdates(updates) {
    if (!updates.length) return '';
    return `
        <div class="stsm-people-memory-warning-title">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>미적용 변경안 ${updates.length.toLocaleString()}개</strong>
        </div>
        ${updates.map(update => `
            <div>#${update.range.startId} ~ #${update.range.endId} · ${escapeHtml(update.targetId || 'ID 없음')} · ${escapeHtml(update.reason)}</div>
        `).join('')}
    `;
}
