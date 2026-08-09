import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    getSummaryContextBlocks,
    moveSummaryContextBlock,
    setSummaryContextBlockEnabled,
    updateSummaryContextBlock,
} from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';

const MACROS = Object.freeze({
    records: [
        ['sumiRecordStartId', '레코드 시작 메시지 ID'],
        ['sumiRecordEndId', '레코드 종료 메시지 ID'],
        ['sumiRecordContent', '저장된 요약 내용'],
    ],
    events: [
        ['sumiEventId', '사건 ID'],
        ['sumiEventTitle', '사건 제목'],
        ['sumiEventDate', '사건 날짜'],
        ['sumiEventLocation', '사건 장소'],
        ['sumiEventSummary', '사건 요약'],
        ['sumiEventImportance', 'minor 또는 major'],
        ['sumiEventShiftValue', '변곡점의 SHIFT 원문'],
        ['sumiEventMetadata', '날짜와 장소를 합친 메타데이터 줄'],
        ['sumiEventShift', '변곡점의 단일 SHIFT 줄'],
        ['sumiEventShifts', '이전 템플릿 호환용 SHIFT 줄'],
    ],
    people: [
        ['sumiPersonId', '인물 ID'],
        ['sumiPersonName', '인물 이름'],
        ['sumiPersonProvisionalValue', '임시 이름일 때 true'],
        ['sumiPersonAliasesValue', '별칭 값'],
        ['sumiPersonRoleValue', '극중 역할 값'],
        ['sumiPersonAgeValue', '나이 값'],
        ['sumiPersonOccupationValue', '직업·직위 값'],
        ['sumiPersonAppearanceValue', '외형 값'],
        ['sumiPersonAffiliationsValue', '소속 값'],
        ['sumiPersonTraitsValue', '성격 값'],
        ['sumiPersonVoiceValue', '말투 값'],
        ['sumiPersonLastLocationValue', '마지막 위치 값'],
        ['sumiPersonPhysicalConditionValue', '마지막 신체 상태 값'],
        ['sumiPersonRelationshipsValue', '관계 및 감정 값'],
        ['sumiPersonProvisional', '임시 이름 여부 줄'],
        ['sumiPersonAliases', '별칭 줄'],
        ['sumiPersonRole', '극중 역할 줄'],
        ['sumiPersonAge', '나이 줄'],
        ['sumiPersonOccupation', '직업·직위 줄'],
        ['sumiPersonAppearance', '외형 줄'],
        ['sumiPersonAffiliations', '소속 줄'],
        ['sumiPersonTraits', '성격 줄'],
        ['sumiPersonVoice', '말투 줄'],
        ['sumiPersonState', '마지막 확인 상태 줄'],
        ['sumiPersonRelationships', '관계 및 감정 줄'],
    ],
    items: [
        ['sumiItemId', '아이템 ID'],
        ['sumiItemName', '아이템 이름'],
        ['sumiItemAliasesValue', '별칭 값'],
        ['sumiItemFactsValue', '객관 정보 값'],
        ['sumiItemFunctionsValue', '기능 값'],
        ['sumiItemOwnerValue', '소유자 값'],
        ['sumiItemHolderValue', '소지자 값'],
        ['sumiItemLocationValue', '마지막 위치 값'],
        ['sumiItemConditionValue', '물리 상태 값'],
        ['sumiItemStatusValue', '서사 상태 값'],
        ['sumiItemAliases', '별칭 줄'],
        ['sumiItemFacts', '객관 정보 줄'],
        ['sumiItemFunctions', '기능 줄'],
        ['sumiItemState', '마지막 확인 상태 줄'],
    ],
    commitments: [
        ['sumiCommitmentId', '서약 ID'],
        ['sumiCommitmentTitle', '서약 제목'],
        ['sumiCommitmentStatus', '서약 상태'],
        ['sumiCommitmentTerms', '서약 내용'],
        ['sumiCommitmentParticipantsValue', '참여자 값'],
        ['sumiCommitmentConditionsValue', '조건 값'],
        ['sumiCommitmentDeadlineValue', '기한 값'],
        ['sumiCommitmentFactsValue', '객관 정보 값'],
        ['sumiCommitmentStatusReasonValue', '상태 근거 값'],
        ['sumiCommitmentParticipants', '참여자 줄'],
        ['sumiCommitmentConditions', '조건 줄'],
        ['sumiCommitmentDeadline', '기한 줄'],
        ['sumiCommitmentFacts', '객관 정보 줄'],
        ['sumiCommitmentStatusReason', '상태 근거 줄'],
    ],
    world: [
        ['sumiWorldId', '세계 설정 ID'],
        ['sumiWorldKeys', '검색 키 값'],
        ['sumiWorldContent', '세계 설정 내용'],
    ],
});

export function bindContextBlockSettings(root) {
    const container = root.querySelector('#stsm-context-block-list');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.addEventListener('click', event => handleClick(root, event));
    container.addEventListener('change', event => handleChange(root, event));
    container.addEventListener('dragstart', handleDragStart);
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', event => handleDrop(root, event));
    renderContextBlockSettings(root);
}

export function renderContextBlockSettings(root) {
    const container = root.querySelector('#stsm-context-block-list');
    if (!container) return;
    container.innerHTML = getSummaryContextBlocks().map(renderBlock).join('');
}

function renderBlock(block) {
    const preview = firstContentLine(block.entryTemplate) || firstContentLine(block.prefixTemplate) || '빈 템플릿';
    return `
        <div class="stsm-context-block" data-context-kind="${escapeHtml(block.kind)}" draggable="true">
            <div class="stsm-context-block-grip" title="드래그로 이동"><i class="fa-solid fa-grip-vertical"></i></div>
            <div class="stsm-context-block-main">
                <strong>${escapeHtml(block.name)}</strong>
                <span>${escapeHtml(preview)}</span>
            </div>
            <button class="menu_button menu_button_icon interactable" data-context-action="edit" type="button" title="렌더링 템플릿 수정" aria-label="${escapeHtml(block.name)} 렌더링 템플릿 수정">
                <i class="fa-solid fa-pen"></i>
            </button>
            <label class="stsm-switch" title="${escapeHtml(block.name)} 전송 켜기/끄기">
                <input data-context-enabled type="checkbox" ${block.enabled ? 'checked' : ''} />
                <span></span>
            </label>
        </div>
    `;
}

async function handleClick(root, event) {
    const button = event.target.closest('[data-context-action="edit"]');
    const kind = button?.closest('[data-context-kind]')?.dataset.contextKind;
    if (!kind) return;
    const block = getSummaryContextBlocks().find(item => item.kind === kind);
    if (!block) return;
    const result = await showTemplateEditor(block);
    if (!result) return;
    updateSummaryContextBlock(kind, result);
    renderContextBlockSettings(root);
}

function handleChange(root, event) {
    if (!event.target.matches('[data-context-enabled]')) return;
    const kind = event.target.closest('[data-context-kind]')?.dataset.contextKind;
    if (!kind) return;
    setSummaryContextBlockEnabled(kind, event.target.checked);
    renderContextBlockSettings(root);
}

function handleDragStart(event) {
    const block = event.target.closest('[data-context-kind]');
    if (!block) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', block.dataset.contextKind);
}

function handleDragOver(event) {
    if (event.target.closest('[data-context-kind]')) event.preventDefault();
}

function handleDrop(root, event) {
    const target = event.target.closest('[data-context-kind]');
    if (!target) return;
    event.preventDefault();
    if (moveSummaryContextBlock(event.dataTransfer.getData('text/plain'), target.dataset.contextKind)) {
        renderContextBlockSettings(root);
    }
}

async function showTemplateEditor(block) {
    const form = document.createElement('div');
    form.className = 'stsm-context-template-editor';
    form.innerHTML = `
        <div class="stsm-section-title">${escapeHtml(block.name)} 렌더링 템플릿</div>
        <label class="stsm-field">
            <span>시작 템플릿</span>
            <textarea class="text_pole monospace" data-template="prefixTemplate" rows="3"></textarea>
        </label>
        <label class="stsm-field">
            <span>항목 템플릿</span>
            <textarea class="text_pole monospace" data-template="entryTemplate" rows="12"></textarea>
        </label>
        <label class="stsm-field">
            <span>끝 템플릿</span>
            <textarea class="text_pole monospace" data-template="suffixTemplate" rows="3"></textarea>
        </label>
        <details class="stsm-record-template-help">
            <summary>사용 가능한 매크로</summary>
            <div class="stsm-record-template-macros">
                ${(MACROS[block.kind] || []).map(([name, description]) => `<div><code>{{${name}}}</code><span>${escapeHtml(description)}</span></div>`).join('')}
            </div>
        </details>
    `;
    for (const key of ['prefixTemplate', 'entryTemplate', 'suffixTemplate']) {
        form.querySelector(`[data-template="${key}"]`).value = block[key];
    }
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '수정하기', cancelButton: '취소', wide: true });
    if (await popup.show() !== 1) return null;
    const entryTemplate = form.querySelector('[data-template="entryTemplate"]').value;
    if (!entryTemplate.trim()) {
        toastr.info('항목 템플릿은 비워둘 수 없습니다. 사용하지 않을 블록은 토글을 꺼주세요.');
        return null;
    }
    return {
        prefixTemplate: form.querySelector('[data-template="prefixTemplate"]').value,
        entryTemplate,
        suffixTemplate: form.querySelector('[data-template="suffixTemplate"]').value,
    };
}

function firstContentLine(value) {
    return String(value || '').split(/\r?\n/).find(line => line.trim())?.trim() || '';
}
