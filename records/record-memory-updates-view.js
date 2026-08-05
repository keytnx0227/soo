import { escapeHtml } from '../core/utils.js';

const FIELD_LABELS = Object.freeze({
    aliases: '별칭',
    facts: '객관 정보',
    roles: '역할',
    affiliations: '소속',
    personalityTraits: '성격',
    speechPatterns: '말투',
    name: '이름',
});

export function renderRecordMemoryUpdateBadge(record) {
    const groups = [
        ['인물', getPeopleUpdates(record)],
        ['아이템', getItemUpdates(record)],
    ];
    return groups.map(([label, updates]) => {
        const parts = [];
        if (updates.created.length) parts.push(`신규 ${updates.created.length}`);
        if (updates.updated.length) parts.push(`변경 ${updates.updated.length}`);
        return parts.length
            ? `<span class="stsm-record-memory-badge" title="${label} 도감 변경안">${label} ${parts.join(' · ')}</span>`
            : '';
    }).join('');
}

export function renderRecordMemoryUpdateDetails(record) {
    const people = getPeopleUpdates(record);
    const items = getItemUpdates(record);
    if (!people.created.length && !people.updated.length && !items.created.length && !items.updated.length) return '';

    return `
        ${people.created.length || people.updated.length ? `<section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">
                <span>인물 도감 변경안</span>
                <span>현재 인물 도감을 계산하는 데 사용되는 레코드별 변경 이력</span>
            </div>
            <div class="stsm-memory-update-list">
                ${people.created.map(renderCreatedPerson).join('')}
                ${people.updated.map(renderUpdatedPerson).join('')}
            </div>
        </section>` : ''}
        ${items.created.length || items.updated.length ? `<section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">
                <span>아이템 도감 변경안</span>
                <span>현재 아이템 도감을 계산하는 데 사용되는 레코드별 변경 이력</span>
            </div>
            <div class="stsm-memory-update-list">
                ${items.created.map(renderCreatedItem).join('')}
                ${items.updated.map(renderUpdatedItem).join('')}
            </div>
        </section>` : ''}
    `;
}

function renderCreatedPerson(person) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>신규 인물</span><strong>${escapeHtml(person.name)}</strong></header>
            ${renderValueRow('별칭', person.aliases)}
            ${renderValueRow('객관 정보', person.facts)}
            ${renderValueRow('역할', person.roles)}
            ${renderValueRow('소속', person.affiliations)}
            ${renderValueRow('성격', person.personalityTraits)}
            ${renderValueRow('말투', person.speechPatterns)}
            ${renderLastKnownState(person.lastKnownState)}
            ${renderRelationships('관계 및 감정', person.relationships)}
        </article>
    `;
}

function renderUpdatedPerson(update) {
    const replaceRows = Object.entries(update.replace || {})
        .filter(([key]) => key !== 'lastKnownState')
        .map(([key, value]) => renderValueRow(`교체 · ${FIELD_LABELS[key] || key}`, value))
        .join('');
    return `
        <article class="stsm-memory-update-card">
            <header><span>기존 인물 변경</span><strong>${escapeHtml(update.targetId)}</strong></header>
            ${renderValueRow('추가 · 별칭', update.append?.aliases)}
            ${renderValueRow('추가 · 객관 정보', update.append?.facts)}
            ${replaceRows}
            ${update.replace && Object.hasOwn(update.replace, 'lastKnownState')
                ? renderLastKnownState(update.replace.lastKnownState, '교체 · 마지막 확인 상태')
                : ''}
            ${renderRelationships('관계 및 감정 변경', update.relationshipUpdates)}
        </article>
    `;
}

function renderCreatedItem(item) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>신규 아이템</span><strong>${escapeHtml(item.name)}</strong></header>
            ${renderValueRow('별칭', item.aliases)}
            ${renderValueRow('객관 정보', item.facts)}
            ${renderValueRow('기능', item.functions)}
            ${renderItemState(item.lastKnownState)}
        </article>
    `;
}

function renderUpdatedItem(update) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>기존 아이템 변경</span><strong>${escapeHtml(update.targetId)}</strong></header>
            ${renderValueRow('추가 · 별칭', update.append?.aliases)}
            ${renderValueRow('추가 · 객관 정보', update.append?.facts)}
            ${Object.hasOwn(update.replace || {}, 'name') ? renderValueRow('교체 · 이름', update.replace.name) : ''}
            ${Object.hasOwn(update.replace || {}, 'functions') ? renderValueRow('교체 · 기능', update.replace.functions) : ''}
            ${Object.hasOwn(update.replace || {}, 'lastKnownState')
                ? renderItemState(update.replace.lastKnownState, '교체 · 마지막 확인 상태')
                : ''}
        </article>
    `;
}

function renderValueRow(label, value) {
    const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    if (!values.length) return '';
    return `
        <div class="stsm-memory-update-row">
            <strong>${escapeHtml(label)}</strong>
            <div>${values.map(item => `<span>${escapeHtml(String(item))}</span>`).join('')}</div>
        </div>
    `;
}

function renderLastKnownState(state, label = '마지막 확인 상태') {
    if (!state || (!state.location && !state.physicalCondition)) return '';
    const values = [];
    if (state.location) values.push(`장소: ${state.location}`);
    if (state.physicalCondition) values.push(`신체 상태: ${state.physicalCondition}`);
    return renderValueRow(label, values);
}

function renderItemState(state, label = '마지막 확인 상태') {
    if (!state) return '';
    const labels = {
        owner: '소유자',
        holder: '소지자',
        location: '위치',
        condition: '물리 상태',
        status: '서사 상태',
    };
    const values = Object.entries(labels)
        .filter(([key]) => state[key])
        .map(([key, itemLabel]) => `${itemLabel}: ${state[key]}`);
    return renderValueRow(label, values);
}

function renderRelationships(label, relationships) {
    if (!Array.isArray(relationships) || !relationships.length) return '';
    const values = relationships.map(item => {
        const target = item.targetName || item.targetId || '알 수 없는 인물';
        const relationship = item.relationship?.length ? `관계: ${item.relationship.join(', ')}` : '';
        const feelings = item.feelings?.length ? `감정: ${item.feelings.join(', ')}` : '';
        return `${target}${relationship || feelings ? ` (${[relationship, feelings].filter(Boolean).join(' / ')})` : ''}`;
    });
    return renderValueRow(label, values);
}

function getPeopleUpdates(record) {
    const people = record?.structuredSummary?.data?.memoryUpdates?.people;
    return {
        created: Array.isArray(people?.created) ? people.created : [],
        updated: Array.isArray(people?.updated) ? people.updated : [],
    };
}

function getItemUpdates(record) {
    const items = record?.structuredSummary?.data?.memoryUpdates?.items;
    return {
        created: Array.isArray(items?.created) ? items.created : [],
        updated: Array.isArray(items?.updated) ? items.updated : [],
    };
}
