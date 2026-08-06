import { escapeHtml } from '../core/utils.js';

const FIELD_LABELS = Object.freeze({
    provisional: '임시 이름',
    role: '극중 역할',
    age: '나이',
    occupation: '직업·직위',
    appearance: '외형',
    affiliations: '소속',
    traits: '성격',
    voice: '말투',
    name: '이름',
});

export function renderRecordMemoryUpdateBadge(record) {
    const groups = [
        ['인물', getPeopleUpdates(record)],
        ['아이템', getItemUpdates(record)],
        ['서약', getCommitmentUpdates(record)],
        ['사건', getEventUpdates(record)],
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
    const commitments = getCommitmentUpdates(record);
    const events = getEventUpdates(record);
    if (!people.created.length && !people.updated.length
        && !items.created.length && !items.updated.length
        && !commitments.created.length && !commitments.updated.length
        && !events.created.length && !events.updated.length) return '';

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
        ${commitments.created.length || commitments.updated.length ? `<section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">
                <span>서약 장부 변경안</span>
                <span>현재 서약 장부를 계산하는 데 사용되는 레코드별 변경 이력</span>
            </div>
            <div class="stsm-memory-update-list">
                ${commitments.created.map(renderCreatedCommitment).join('')}
                ${commitments.updated.map(renderUpdatedCommitment).join('')}
            </div>
        </section>` : ''}
        ${events.created.length || events.updated.length ? `<section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">
                <span>주요 사건 변경안</span>
                <span>현재 주요 사건 목록을 계산하는 데 사용되는 레코드별 변경 이력</span>
            </div>
            <div class="stsm-memory-update-list">
                ${events.created.map(renderCreatedEvent).join('')}
                ${events.updated.map(renderUpdatedEvent).join('')}
            </div>
        </section>` : ''}
    `;
}

function renderCreatedPerson(person) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>신규 인물</span><strong>${escapeHtml(person.name)}</strong></header>
            ${renderValueRow('임시 이름', person.provisional ? '예' : '아니오')}
            ${renderValueRow('별칭', person.aliases)}
            ${renderValueRow('극중 역할', person.role)}
            ${renderValueRow('나이', person.age)}
            ${renderValueRow('직업·직위', person.occupation)}
            ${renderValueRow('외형', person.appearance)}
            ${renderValueRow('소속', person.affiliations)}
            ${renderValueRow('성격', person.traits)}
            ${renderValueRow('말투', person.voice)}
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

function renderCreatedCommitment(commitment) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>신규 서약</span><strong>${escapeHtml(commitment.title)}</strong></header>
            ${renderValueRow('내용', commitment.terms)}
            ${renderValueRow('참여자', formatParticipants(commitment.participants))}
            ${renderValueRow('조건', commitment.conditions)}
            ${renderValueRow('기한', commitment.deadline)}
            ${renderValueRow('객관 정보', commitment.facts)}
            ${renderValueRow('상태', commitment.status)}
            ${renderValueRow('상태 근거', commitment.statusReason)}
        </article>
    `;
}

function renderUpdatedCommitment(update) {
    const replace = update.replace || {};
    return `
        <article class="stsm-memory-update-card">
            <header><span>기존 서약 변경</span><strong>${escapeHtml(update.targetId)}</strong></header>
            ${renderValueRow('추가 · 객관 정보', update.append?.facts)}
            ${Object.hasOwn(replace, 'title') ? renderValueRow('교체 · 제목', replace.title) : ''}
            ${Object.hasOwn(replace, 'terms') ? renderValueRow('교체 · 내용', replace.terms) : ''}
            ${Object.hasOwn(replace, 'participants') ? renderValueRow('교체 · 참여자', formatParticipants(replace.participants)) : ''}
            ${Object.hasOwn(replace, 'conditions') ? renderValueRow('교체 · 조건', replace.conditions) : ''}
            ${Object.hasOwn(replace, 'deadline') ? renderValueRow('교체 · 기한', replace.deadline) : ''}
            ${Object.hasOwn(replace, 'status') ? renderValueRow('교체 · 상태', replace.status) : ''}
            ${Object.hasOwn(replace, 'statusReason') ? renderValueRow('교체 · 상태 근거', replace.statusReason) : ''}
        </article>
    `;
}

function renderCreatedEvent(event) {
    return `
        <article class="stsm-memory-update-card">
            <header><span>신규 사건 · ${event.importance === 'turning_point' ? '변곡점' : '일반'}</span><strong>${escapeHtml(event.title)}</strong></header>
            ${renderValueRow('날짜', event.date)}
            ${renderValueRow('장소', event.location)}
            ${renderValueRow('사건', event.summary)}
            ${renderValueRow('SHIFT', event.shift ?? event.shifts?.[0])}
        </article>
    `;
}

function renderUpdatedEvent(update) {
    const replace = update.replace || {};
    return `
        <article class="stsm-memory-update-card">
            <header><span>기존 사건 변경</span><strong>${escapeHtml(update.targetId)}</strong></header>
            ${Object.hasOwn(replace, 'title') ? renderValueRow('교체 · 제목', replace.title) : ''}
            ${Object.hasOwn(replace, 'date') ? renderValueRow('교체 · 날짜', replace.date) : ''}
            ${Object.hasOwn(replace, 'location') ? renderValueRow('교체 · 장소', replace.location) : ''}
            ${Object.hasOwn(replace, 'summary') ? renderValueRow('교체 · 사건', replace.summary) : ''}
            ${Object.hasOwn(replace, 'importance') ? renderValueRow('교체 · 중요도', replace.importance) : ''}
            ${Object.hasOwn(replace, 'shift') || Object.hasOwn(replace, 'shifts')
                ? renderValueRow('교체 · SHIFT', replace.shift ?? replace.shifts?.[0])
                : ''}
        </article>
    `;
}

function formatParticipants(participants) {
    return (Array.isArray(participants) ? participants : []).map(participant => {
        const name = participant.personName || participant.personId || '알 수 없는 참여자';
        return participant.role ? `${name} · ${participant.role}` : name;
    });
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

function getCommitmentUpdates(record) {
    const commitments = record?.structuredSummary?.data?.memoryUpdates?.commitments;
    return {
        created: Array.isArray(commitments?.created) ? commitments.created : [],
        updated: Array.isArray(commitments?.updated) ? commitments.updated : [],
    };
}

function getEventUpdates(record) {
    const events = record?.structuredSummary?.data?.memoryUpdates?.events;
    return {
        created: Array.isArray(events?.created) ? events.created : [],
        updated: Array.isArray(events?.updated) ? events.updated : [],
    };
}
