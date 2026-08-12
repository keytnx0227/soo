import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import {
    buildCompressionJsonContract,
} from '../summary/compression-format.js';
import {
    addPromptBlock,
    BLOCK_KINDS,
    createPresetFromActive,
    deleteActivePreset,
    getDefaultSummaryExtractionRules,
    getActivePreset,
    getPromptEditor,
    getSettings,
    isRequiredPromptBlock,
    movePromptBlock,
    PROMPT_TYPES,
    removePromptBlock,
    resetActivePreset,
    saveSettingsNow,
    setActivePreset,
    setPromptBlockEnabled,
    setPromptSeparatorsHidden,
    SUMMARY_EXTRACTION_RULE_DEFINITIONS,
    updatePromptBlock,
} from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { getCompressionMode } from '../summary/summary-store.js';
import {
    buildSummaryJsonContract,
    getEnabledMemorySections,
    getEnabledSummarySections,
    getSummarySectionKeyForKind,
    SUMMARY_SECTION_DESCRIPTIONS,
} from '../summary/summary-format.js';

const TYPE_LABELS = Object.freeze({
    [PROMPT_TYPES.SUMMARY]: '요약',
    [PROMPT_TYPES.REVISION]: '수정 대화',
    [PROMPT_TYPES.COMPRESSION]: '압축 요약',
});

export function bindPromptSettings(root) {
    for (const type of Object.values(PROMPT_TYPES)) {
        const container = root.querySelector(`[data-prompt-editor="${type}"]`);
        container.addEventListener('click', event => handleEditorClick(root, type, event));
        container.addEventListener('change', event => handleEditorChange(root, type, event));
        container.addEventListener('dragstart', event => handleDragStart(event));
        container.addEventListener('dragover', event => handleDragOver(event));
        container.addEventListener('drop', event => handleDrop(root, type, event));
        renderPromptEditor(root, type);
    }
}

export function renderPromptEditor(root, type) {
    const container = root.querySelector(`[data-prompt-editor="${type}"]`);
    const editor = getPromptEditor(type);
    const preset = getActivePreset(type);
    const summarySections = getSettings().summarization.summarySections;
    const defaultPresetId = {
        [PROMPT_TYPES.SUMMARY]: 'default-summary',
        [PROMPT_TYPES.REVISION]: 'default-revision',
        [PROMPT_TYPES.COMPRESSION]: 'default-compression',
    }[type];

    container.innerHTML = `
        <div class="stsm-preset-toolbar">
            <select class="stsm-preset-select text_pole" aria-label="${TYPE_LABELS[type]} 프롬프트 프리셋">
                ${editor.presets.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === preset.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
            ${renderToolbarButton('save', 'fa-floppy-disk', '현재 프리셋 저장')}
            ${renderToolbarButton('add-preset', 'fa-plus', '새 프리셋 추가')}
            ${renderToolbarButton('delete-preset', 'fa-trash', '프리셋 삭제', preset.id === defaultPresetId || editor.presets.length <= 1)}
            ${renderToolbarButton('reset', 'fa-rotate-left', '현재 프리셋 초기화')}
            <button class="stsm-add-prompt menu_button interactable" data-action="add-block" type="button">프롬프트 추가</button>
            <div class="stsm-separator-visibility">
                <span>구분선 숨기기</span>
                <label class="stsm-switch" title="구분선 블록 숨기기">
                    <input class="stsm-hide-separators" type="checkbox" ${editor.hideSeparators ? 'checked' : ''} />
                    <span></span>
                </label>
            </div>
        </div>
        <div class="stsm-block-list">
            ${preset.blocks.filter(block => !editor.hideSeparators || !block.separator).map(block => renderPromptBlock(block, summarySections)).join('')}
        </div>
    `;
}

function renderToolbarButton(action, icon, title, disabled = false) {
    return `
        <button class="menu_button menu_button_icon interactable" data-action="${action}" type="button" title="${title}" aria-label="${title}" ${disabled ? 'disabled' : ''}>
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}

function renderPromptBlock(block, summarySections) {
    const required = isRequiredPromptBlock(block);
    const sectionKey = getSummarySectionKeyForKind(block.kind);
    const controlledBySection = Boolean(sectionKey);
    const enabled = controlledBySection ? Boolean(summarySections[sectionKey]) : block.enabled || required;
    const switchDisabled = controlledBySection || required;
    const generatedBlock = [
        BLOCK_KINDS.SUMMARY_LANGUAGE,
        BLOCK_KINDS.SUMMARY_EXTRACTION_RULES,
        BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT,
        BLOCK_KINDS.PEOPLE_MEMORY,
        BLOCK_KINDS.ITEM_MEMORY,
        BLOCK_KINDS.COMMITMENT_MEMORY,
        BLOCK_KINDS.EVENT_MEMORY,
        BLOCK_KINDS.WORLD_MEMORY,
        BLOCK_KINDS.COMPRESSION_SOURCES,
        BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT,
        BLOCK_KINDS.REVISION_SUMMARY_MESSAGES,
        BLOCK_KINDS.REVISION_COMPRESSION_SOURCES,
        BLOCK_KINDS.REVISION_OUTPUT_CONTRACT,
    ].includes(block.kind);
    const detailOnly = [
        BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT,
        BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT,
        BLOCK_KINDS.REVISION_OUTPUT_CONTRACT,
    ].includes(block.kind);
    return `
        <div class="stsm-block${block.separator ? ' stsm-block-separator' : ''}${controlledBySection && !enabled ? ' stsm-block-section-disabled' : ''}${generatedBlock ? ' stsm-block-generated' : ''}" data-block-id="${escapeHtml(block.id)}" draggable="true">
            <div class="stsm-block-grip" title="드래그로 이동">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="stsm-block-main">
                <div class="stsm-block-title">${escapeHtml(block.name)}</div>
                <div class="stsm-block-preview">${escapeHtml(getBlockPreview(block))}</div>
            </div>
            ${generatedBlock ? '' : `
                <label class="stsm-switch" title="${controlledBySection ? '요약 항목 설정에서 제어됩니다.' : required ? '필수 프롬프트 블록입니다.' : '전송 여부'}">
                    <input class="stsm-block-toggle" type="checkbox" ${enabled ? 'checked' : ''} ${switchDisabled ? 'disabled' : ''} />
                    <span></span>
                </label>
            `}
            <button class="stsm-block-edit menu_button menu_button_icon interactable" data-action="edit-block" type="button" title="${detailOnly ? '상세 보기' : '수정'}" aria-label="${detailOnly ? '상세 보기' : '수정'}">
                <i class="fa-solid ${detailOnly ? 'fa-eye' : 'fa-pen'}"></i>
            </button>
            ${!block.locked ? `
                <button class="stsm-block-delete menu_button menu_button_icon interactable" data-action="delete-block" type="button" title="삭제" aria-label="삭제">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            ` : ''}
        </div>
    `;
}

function getBlockPreview(block) {
    if (block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) return '항목별 추출 지시문을 한 곳에서 관리합니다.';
    if (block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT) return '요약 항목 설정에 따라 자동 생성됩니다.';
    if (block.kind === BLOCK_KINDS.COMPRESSION_SOURCES) return '선택한 활성 요약 레코드로 자동 구성됩니다.';
    if (block.kind === BLOCK_KINDS.REVISION_SUMMARY_MESSAGES) return '일반 요약 레코드 범위의 실제 채팅 메시지로 자동 구성됩니다.';
    if (block.kind === BLOCK_KINDS.REVISION_COMPRESSION_SOURCES) return '압축 레코드의 원본 요약 레코드로 자동 구성됩니다.';
    if (block.kind === BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT) return '압축 스키마에 따라 자동 생성됩니다.';
    if (block.kind === BLOCK_KINDS.REVISION_OUTPUT_CONTRACT) return '수정 중인 레코드 종류에 따라 자동 생성됩니다.';
    return block.content || '';
}

async function handleEditorClick(root, type, event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const blockId = button.closest('.stsm-block')?.dataset.blockId;

    if (action === 'save') {
        await saveSettingsNow();
        toastr.success('프리셋을 저장했습니다.');
        return;
    } else if (action === 'add-preset') {
        const name = await Popup.show.input('새 프리셋 이름', null, `${getActivePreset(type).name} 복사본`);
        if (!name?.trim()) return;
        createPresetFromActive(type, name);
        renderPromptEditor(root, type);
    } else if (action === 'delete-preset') {
        const preset = getActivePreset(type);
        if (!await Popup.show.confirm('현재 프리셋을 삭제할까요?', preset.name)) return;
        deleteActivePreset(type);
        renderPromptEditor(root, type);
    } else if (action === 'reset') {
        if (!await Popup.show.confirm('현재 프리셋을 기본 상태로 초기화할까요?', getActivePreset(type).name)) return;
        resetActivePreset(type);
        renderPromptEditor(root, type);
    } else if (action === 'add-block') {
        const values = await showPromptBlockPopup({ title: '프롬프트 추가', okButton: '추가' });
        if (!values) return;
        addPromptBlock(type, values.name, values.content);
        renderPromptEditor(root, type);
    } else if (action === 'edit-block') {
        const block = getActivePreset(type).blocks.find(item => item.id === blockId);
        if (!block) return;
        if (block.kind === BLOCK_KINDS.SUMMARY_OUTPUT_CONTRACT) {
            await showSummaryOutputContractPopup();
            return;
        }
        if (block.kind === BLOCK_KINDS.COMPRESSION_OUTPUT_CONTRACT) {
            await showCompressionOutputContractPopup();
            return;
        }
        if (block.kind === BLOCK_KINDS.REVISION_OUTPUT_CONTRACT) {
            await showRevisionOutputContractPopup();
            return;
        }
        if (block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES) {
            const config = await showSummaryExtractionRulesPopup(block);
            if (!config) return;
            updatePromptBlock(type, blockId, { config });
            renderPromptEditor(root, type);
            root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
            return;
        }
        const values = await showPromptBlockPopup({ title: '프롬프트 수정', okButton: '수정하기', block });
        if (!values) return;
        updatePromptBlock(type, blockId, values);
        renderPromptEditor(root, type);
    } else if (action === 'delete-block') {
        const block = getActivePreset(type).blocks.find(item => item.id === blockId);
        if (!block || !await Popup.show.confirm('이 프롬프트를 삭제할까요?', block.name)) return;
        removePromptBlock(type, blockId);
        renderPromptEditor(root, type);
    }
    root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
}

async function showSummaryExtractionRulesPopup(block) {
    const sections = getEnabledSummarySections(getSettings().summarization.summarySections);
    const memorySections = getEnabledMemorySections(getSettings().summarization.memorySections);
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form stsm-extraction-rules-form';
    form.innerHTML = `
        <div class="stsm-section-title">요약 추출 규칙</div>
        <div class="stsm-extraction-rules-intro">
            <span>전역 요약 항목 설정에서 켠 규칙만 프롬프트에 포함됩니다.</span>
            <button class="menu_button interactable stsm-reset-extraction-rules" type="button">
                <i class="fa-solid fa-rotate-left"></i>
                기본값으로 초기화
            </button>
        </div>
        <div class="stsm-extraction-rule-list">
            ${SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(({ key, label, category }) => {
                const enabled = category === 'memory' ? memorySections[key] : sections[key];
                return `
                <div class="stsm-field stsm-extraction-rule" data-rule-key="${escapeHtml(key)}">
                    <div class="stsm-extraction-rule-heading">
                        <span class="stsm-extraction-rule-title">
                            <strong>${escapeHtml(label)}</strong>
                            <button class="stsm-section-info interactable" type="button" data-tooltip="${escapeHtml(SUMMARY_SECTION_DESCRIPTIONS[key])}" aria-label="${escapeHtml(label)} 설명: ${escapeHtml(SUMMARY_SECTION_DESCRIPTIONS[key])}">
                                <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                            </button>
                        </span>
                        <span class="stsm-extraction-rule-actions">
                            <small class="${enabled ? 'is-enabled' : 'is-disabled'}">${enabled ? '활성' : '비활성'}</small>
                            <button class="menu_button menu_button_icon interactable stsm-reset-extraction-rule" type="button" title="${escapeHtml(label)} 규칙 초기화" aria-label="${escapeHtml(label)} 규칙 초기화">
                                <i class="fa-solid fa-rotate-left"></i>
                            </button>
                        </span>
                    </div>
                    <textarea class="text_pole monospace" rows="5"></textarea>
                </div>
            `; }).join('')}
        </div>
    `;

    const setValues = rules => {
        for (const { key } of SUMMARY_EXTRACTION_RULE_DEFINITIONS) {
            form.querySelector(`[data-rule-key="${key}"] textarea`).value = rules[key] || '';
        }
    };
    setValues(block.config.rules);
    form.querySelector('.stsm-reset-extraction-rules').addEventListener('click', () => {
        setValues(getDefaultSummaryExtractionRules());
        toastr.info('추출 규칙을 기본값으로 되돌렸습니다. 수정하기를 누르면 반영됩니다.');
    });
    form.querySelector('.stsm-extraction-rule-list').addEventListener('click', event => {
        const button = event.target.closest('.stsm-reset-extraction-rule');
        if (!button) return;
        const rule = button.closest('.stsm-extraction-rule');
        const key = rule?.dataset.ruleKey;
        const definition = SUMMARY_EXTRACTION_RULE_DEFINITIONS.find(item => item.key === key);
        if (!definition) return;
        rule.querySelector('textarea').value = getDefaultSummaryExtractionRules()[key];
        toastr.info(`${definition.label} 추출 규칙을 기본값으로 되돌렸습니다.`);
    });

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton: '수정하기', cancelButton: '취소' });
    if (await popup.show() !== 1) return null;

    const rules = Object.fromEntries(SUMMARY_EXTRACTION_RULE_DEFINITIONS.map(({ key }) => [
        key,
        form.querySelector(`[data-rule-key="${key}"] textarea`).value.trim(),
    ]));
    const missingRule = SUMMARY_EXTRACTION_RULE_DEFINITIONS.find(({ key }) => !rules[key]);
    if (missingRule) {
        toastr.info(`${missingRule.label} 추출 규칙을 입력해주세요.`);
        return null;
    }
    return { rules };
}

async function showSummaryOutputContractPopup() {
    const sections = getEnabledSummarySections(getSettings().summarization.summarySections);
    const memorySections = getEnabledMemorySections(getSettings().summarization.memorySections);
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form';
    form.innerHTML = `
        <div class="stsm-section-title">JSON 출력 형식 · 자동 생성</div>
        <div class="stsm-muted">전역 요약 항목 설정을 기준으로 실제 전송되는 계약입니다.</div>
        <textarea class="text_pole monospace" rows="18" readonly></textarea>
    `;
    form.querySelector('textarea').value = buildSummaryJsonContract(sections, memorySections);
    const popup = new Popup(form, POPUP_TYPE.TEXT, '', { okButton: '닫기' });
    await popup.show();
}

async function showCompressionOutputContractPopup() {
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form';
    form.innerHTML = `
        <div class="stsm-section-title">압축 JSON 출력 형식 · 자동 생성</div>
        <div class="stsm-muted">압축 응답을 검증하고 레코드 형식으로 렌더링하는 계약입니다.</div>
        <textarea class="text_pole monospace" rows="18" readonly></textarea>
    `;
    form.querySelector('textarea').value = buildCompressionJsonContract({
        segmented: getCompressionMode() === 'segmented',
        sourceCount: getSettings().summarization.compressionGroupSize,
    });
    await new Popup(form, POPUP_TYPE.TEXT, '', { okButton: '닫기' }).show();
}

async function showRevisionOutputContractPopup() {
    const sections = {
        ...getEnabledSummarySections(getSettings().summarization.summarySections),
        tags: false,
    };
    const noMemorySections = { people: false, items: false, commitments: false, events: false, world: false };
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form';
    form.innerHTML = `
        <div class="stsm-section-title">수정 JSON 출력 형식 · 자동 생성</div>
        <div class="stsm-muted">일반 요약과 압축 요약은 각각의 기존 구조를 유지합니다. 태그와 도감 변경안은 수정 대화에서 변경하지 않습니다.</div>
        <label class="stsm-field">
            <span>일반 요약</span>
            <textarea class="text_pole monospace stsm-revision-summary-contract" rows="12" readonly></textarea>
        </label>
        <label class="stsm-field">
            <span>압축 요약</span>
            <textarea class="text_pole monospace stsm-revision-compression-contract" rows="12" readonly></textarea>
        </label>
    `;
    form.querySelector('.stsm-revision-summary-contract').value = buildSummaryJsonContract(sections, noMemorySections);
    form.querySelector('.stsm-revision-compression-contract').value = buildCompressionJsonContract({
        segmented: getCompressionMode() === 'segmented',
        sourceCount: getSettings().summarization.compressionGroupSize,
    });
    await new Popup(form, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true }).show();
}

function handleEditorChange(root, type, event) {
    if (event.target.classList.contains('stsm-hide-separators')) {
        setPromptSeparatorsHidden(type, event.target.checked);
        renderPromptEditor(root, type);
        return;
    }

    if (event.target.classList.contains('stsm-preset-select')) {
        setActivePreset(type, event.target.value);
        renderPromptEditor(root, type);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
        return;
    }

    if (event.target.classList.contains('stsm-block-toggle')) {
        const blockId = event.target.closest('.stsm-block')?.dataset.blockId;
        setPromptBlockEnabled(type, blockId, event.target.checked);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
    }
}

function handleDragStart(event) {
    const block = event.target.closest('.stsm-block');
    if (!block) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', block.dataset.blockId);
}

function handleDragOver(event) {
    if (event.target.closest('.stsm-block')) event.preventDefault();
}

function handleDrop(root, type, event) {
    const target = event.target.closest('.stsm-block');
    if (!target) return;
    event.preventDefault();
    if (movePromptBlock(type, event.dataTransfer.getData('text/plain'), target.dataset.blockId)) {
        renderPromptEditor(root, type);
        root.dispatchEvent(new CustomEvent('stsm:prompt-settings-changed'));
    }
}

async function showPromptBlockPopup({ title, okButton, block = null }) {
    const isRecentSummary = block?.kind === BLOCK_KINDS.RECENT_SUMMARIES;
    const form = document.createElement('div');
    form.className = 'stsm-prompt-form';
    form.innerHTML = `
        <div class="stsm-section-title">${escapeHtml(title)}</div>
        <label class="stsm-field">
            <span>프롬프트 이름</span>
            <input class="stsm-block-name text_pole" type="text" />
        </label>
        <label class="stsm-field">
            <span>내용</span>
            <textarea class="stsm-block-content text_pole monospace" rows="10"></textarea>
        </label>
        ${isRecentSummary ? `
            <div class="stsm-recent-summary-limits">
                <div class="stsm-recent-summary-limit">
                    <label><input class="stsm-recent-count-enabled" type="checkbox" /><span>개수 제한</span></label>
                    <input class="stsm-recent-count-value text_pole" type="number" min="1" max="1000" step="1" />
                </div>
                <div class="stsm-recent-summary-limit">
                    <label><input class="stsm-recent-token-enabled" type="checkbox" /><span>토큰 제한</span></label>
                    <input class="stsm-recent-token-value text_pole" type="number" min="100" max="200000" step="100" />
                </div>
            </div>
        ` : ''}
    `;
    form.querySelector('.stsm-block-name').value = block?.name || '';
    form.querySelector('.stsm-block-content').value = block?.content || '';

    if (isRecentSummary) {
        const countEnabled = form.querySelector('.stsm-recent-count-enabled');
        const countValue = form.querySelector('.stsm-recent-count-value');
        const tokenEnabled = form.querySelector('.stsm-recent-token-enabled');
        const tokenValue = form.querySelector('.stsm-recent-token-value');
        countEnabled.checked = block.config.countLimit.enabled;
        countValue.value = block.config.countLimit.value;
        tokenEnabled.checked = block.config.tokenLimit.enabled;
        tokenValue.value = block.config.tokenLimit.value;

        const updateDisabledState = () => {
            countValue.disabled = !countEnabled.checked;
            tokenValue.disabled = !tokenEnabled.checked;
        };
        countEnabled.addEventListener('change', updateDisabledState);
        tokenEnabled.addEventListener('change', updateDisabledState);
        updateDisabledState();
    }

    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton: '취소' });
    if (await popup.show() !== 1) return null;

    const name = form.querySelector('.stsm-block-name').value.trim();
    const content = form.querySelector('.stsm-block-content').value.trim();
    if (!name || !content) {
        toastr.info('프롬프트 이름과 내용을 모두 입력해주세요.');
        return null;
    }

    if (!isRecentSummary) return { name, content };

    const countEnabled = form.querySelector('.stsm-recent-count-enabled').checked;
    const countValue = Number(form.querySelector('.stsm-recent-count-value').value);
    const tokenEnabled = form.querySelector('.stsm-recent-token-enabled').checked;
    const tokenValue = Number(form.querySelector('.stsm-recent-token-value').value);
    if ((countEnabled && (!Number.isInteger(countValue) || countValue < 1))
        || (tokenEnabled && (!Number.isInteger(tokenValue) || tokenValue < 100))) {
        toastr.info('활성화한 최근 요약 제한값을 올바르게 입력해주세요.');
        return null;
    }

    return {
        name,
        content,
        config: {
            countLimit: { enabled: countEnabled, value: countValue },
            tokenLimit: { enabled: tokenEnabled, value: tokenValue },
        },
    };
}
