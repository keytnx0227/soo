import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';

let isMenuReady = false;
let popup = null;

const SAMPLE_SUMMARIES = [
    {
        range: '#60 ~ #89',
        content: '캐릭터들은 분쟁의 원인을 확인하고 서로의 입장을 조율했다. 그 과정에서 숨겨져 있던 계약의 조건과 다음 목적지에 대한 단서가 드러났다.',
    },
    {
        range: '#30 ~ #59',
        content: '일행은 도시 외곽의 유적을 탐사했고, 경비대와의 충돌 끝에 오래된 기록을 획득했다. 기록에는 왕국의 실종 사건과 관련된 이름이 남아 있었다.',
    },
    {
        range: '#0 ~ #29',
        content: '주요 인물들이 처음 만나 각자의 목적을 확인했다. 불완전한 신뢰 속에서도 공통의 목표를 위해 임시로 협력하기로 결정했다.',
    },
];

const SUMMARY_PROMPT_BLOCKS = [
    { name: 'Main Prompt', preview: '당신은 대화의 핵심 맥락을 보존하는 요약 전문가입니다.', editable: true },
    { name: '캐릭터 정보', preview: '현재 채팅의 캐릭터 정보', fixed: true },
    { name: '월드 인포', preview: '현재 채팅에서 활성화되는 월드 인포', fixed: true },
    { name: '요약 대상', preview: '현재 청크의 채팅 내역', fixed: true },
    { name: '요약 템플릿', preview: '주요 사건, 인물의 감정, 미해결 정보를 구분해 작성합니다.', editable: true },
];

const REVISION_PROMPT_BLOCKS = [
    { name: '수정 대화 기본 지시문', preview: '사용자의 피드백을 반영해 요약을 수정합니다.', editable: true },
    { name: '현재 요약', preview: '선택한 요약 블록의 현재 내용', fixed: true },
    { name: '수정 대화 내역', preview: '현재 요약 블록에서 진행한 수정 대화', fixed: true },
    { name: '수정 결과 템플릿', preview: '수정된 요약만 답변하도록 지시합니다.', editable: true },
];

function addMenuItem() {
    if (isMenuReady || document.getElementById('stsm-open-button')) return;

    const container = document.querySelector('#extensionsMenu');
    if (!container) return;

    const button = document.createElement('div');
    button.id = 'stsm-open-button';
    button.className = 'list-group-item flex-container flexGap5';
    button.tabIndex = 0;
    button.title = '요약 관리하기';
    button.innerHTML = `
        <div class="fa-solid fa-file-lines extensionsMenuExtensionButton"></div>
        <span>요약 관리하기</span>
    `;
    button.addEventListener('click', openSummarizerPopup);
    button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openSummarizerPopup();
    });

    container.append(button);
    document.querySelector('#extensionsMenuButton')?.style.setProperty('display', 'flex');
    isMenuReady = true;
}

function buildPopup() {
    const root = document.createElement('div');
    root.id = 'stsm-root';
    root.dataset.activeTab = 'summary';
    root.innerHTML = `
        <div class="stsm-tabs" role="tablist">
            ${renderTab('summary', '요약', true)}
            ${renderTab('records', '기록')}
            ${renderTab('connection', '연결 설정')}
            ${renderTab('settings', '요약 설정')}
        </div>

        <section id="stsm-panel-summary" class="stsm-panel" role="tabpanel">
            <div class="stsm-summary-toolbar">
                <div class="stsm-range-field">
                    <span>요약 범위 지정</span>
                    <div class="stsm-range-inputs">
                        <input id="stsm-range-start" class="text_pole" type="number" min="0" placeholder="시작 ID" aria-label="요약 시작 채팅 ID" />
                        <span aria-hidden="true">~</span>
                        <input id="stsm-range-end" class="text_pole" type="number" min="0" placeholder="종료 ID" aria-label="요약 종료 채팅 ID" />
                    </div>
                </div>
                <button id="stsm-summarize" class="menu_button interactable" type="button">요약하기</button>
            </div>
        </section>

        <section id="stsm-panel-records" class="stsm-panel" role="tabpanel" hidden>
            <div class="stsm-records-toolbar">
                <label class="stsm-field stsm-sort-field">
                    <select id="stsm-record-sort" class="text_pole" aria-label="요약 기록 정렬">
                        <option value="newest">최신 순</option>
                        <option value="oldest">오래된 순</option>
                    </select>
                </label>
            </div>
            <div id="stsm-record-list" class="stsm-record-list">
                ${SAMPLE_SUMMARIES.map(renderSummaryRecord).join('')}
            </div>
            <section class="stsm-translation-settings">
                <div class="stsm-translation-settings-title">번역 설정</div>
                <div class="stsm-translation-settings-body">
                    <div class="stsm-translation-grid">
                        <label class="stsm-field">
                            <span>번역 방법</span>
                            <select id="stsm-translation-method" class="text_pole">
                                <option value="basic">기본 번역</option>
                                <option value="llm" disabled>LLM 번역</option>
                            </select>
                        </label>
                        <label class="stsm-field">
                            <span>번역 공급자</span>
                            <select id="stsm-translation-provider" class="text_pole">
                                <option value="google">Google</option>
                                <option value="bing">Bing</option>
                            </select>
                        </label>
                        <label class="stsm-field">
                            <span>대상 언어</span>
                            <select id="stsm-translation-language" class="text_pole">
                                <option value="ko" selected>한국어</option>
                                <option value="en">영어</option>
                                <option value="ja">일본어</option>
                                <option value="zh-CN">중국어(간체)</option>
                                <option value="zh-TW">중국어(번체)</option>
                            </select>
                        </label>
                        <div class="stsm-field stsm-auto-translation-field">
                            <span>자동 번역</span>
                            <label class="stsm-switch" title="자동 번역">
                                <input id="stsm-auto-translation" type="checkbox" />
                                <span></span>
                            </label>
                        </div>
                    </div>
                    <div class="stsm-translation-actions">
                        <button id="stsm-translate-all" class="menu_button interactable" type="button">일괄 번역</button>
                        <button id="stsm-delete-all-translations" class="menu_button interactable" type="button">일괄 번역 삭제</button>
                    </div>
                </div>
            </section>
        </section>

        <section id="stsm-panel-connection" class="stsm-panel" role="tabpanel" hidden>
            ${renderConnectionSettings()}
        </section>

        <section id="stsm-panel-settings" class="stsm-panel stsm-settings-panel" role="tabpanel" hidden>
            <label class="stsm-field stsm-chunk-size">
                <span>요약 청크 크기</span>
                <input id="stsm-chunk-size" class="text_pole" type="number" min="1" step="1" />
            </label>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 프롬프트 설정</div>
                ${renderPromptEditor('summary-prompt', SUMMARY_PROMPT_BLOCKS)}
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">수정 대화 프롬프트 설정</div>
                ${renderPromptEditor('revision-prompt', REVISION_PROMPT_BLOCKS)}
            </div>

            <div class="stsm-settings-footer"></div>
        </section>
    `;

    bindPrototypeEvents(root);
    return root;
}

function renderTab(name, label, active = false) {
    return `
        <button
            class="stsm-tab${active ? ' stsm-tab-active' : ''}"
            type="button"
            role="tab"
            data-tab="${name}"
            aria-controls="stsm-panel-${name}"
            aria-selected="${String(active)}"
        >${label}</button>
    `;
}

function renderSummaryRecord(summary, index) {
    return `
        <article class="stsm-record" data-record-index="${index}">
            <header class="stsm-record-header">
                <strong>${summary.range}</strong>
                <div class="stsm-record-actions">
                    ${renderIconButton('copy', 'fa-copy', '복사')}
                    ${renderIconButton('edit', 'fa-pen', '수정')}
                    ${renderIconButton('translate', 'fa-language', '번역')}
                    ${renderIconButton('chat', 'fa-comments', '요약 수정 대화')}
                    ${renderIconButton('reroll', 'fa-rotate-right', '재생성')}
                    ${renderIconButton('delete', 'fa-trash', '삭제')}
                </div>
            </header>
            <div class="stsm-record-content">${summary.content}</div>
            <div class="stsm-record-edit-actions" hidden>
                <button class="stsm-record-save menu_button interactable" type="button">수정</button>
                <button class="stsm-record-cancel menu_button interactable" type="button">취소</button>
            </div>
        </article>
    `;
}

function renderIconButton(action, icon, title) {
    return `
        <button class="stsm-record-${action} menu_button menu_button_icon interactable" type="button" title="${title}" aria-label="${title}">
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}

function renderConnectionSettings() {
    return `
        <div class="stsm-connection-toolbar">
            <label class="stsm-field">
                <span>연결 방법</span>
                <select id="stsm-connection-mode" class="text_pole">
                    <option value="profile">커넥션 프로필 그대로 사용</option>
                    <option value="custom">프로바이더/모델 설정</option>
                </select>
            </label>
            <button id="stsm-reset-connection" class="menu_button menu_button_icon interactable" type="button" title="현재 연결 설정 초기화" aria-label="현재 연결 설정 초기화">
                <i class="fa-solid fa-rotate-left"></i>
            </button>
        </div>
        <div id="stsm-custom-connection" class="stsm-grid-two" hidden>
            <label class="stsm-field">
                <span>프로바이더</span>
                <select id="stsm-provider" class="text_pole">
                    <option>OpenAI</option>
                    <option>Claude</option>
                    <option>Google AI Studio</option>
                    <option>Vertex AI</option>
                    <option>OpenRouter</option>
                </select>
            </label>
            <label class="stsm-field">
                <span>모델명</span>
                <input id="stsm-model" class="text_pole" type="text" placeholder="예: gpt-4.1, claude-sonnet-4 등" />
            </label>
        </div>
        <div class="stsm-settings-stack">
            <label class="stsm-field">
                <span>API 응답 최대 토큰 수</span>
                <input id="stsm-max-tokens" class="text_pole" type="number" min="1" max="200000" step="1" />
            </label>
            ${renderRange('temperature', '온도', 0, 2, 0.05, 0.9)}
            ${renderRange('top-p', 'Top P', 0, 1, 0.01, 1)}
            ${renderRange('top-k', 'Top K', 0, 200, 1, 0)}
        </div>
    `;
}

function renderRange(name, label, min, max, step, value) {
    return `
        <label class="stsm-range">
            <span>${label}</span>
            <input data-range="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
            <output>${value}</output>
        </label>
    `;
}

function renderPromptEditor(id, blocks) {
    return `
        <div class="stsm-preset-toolbar">
            <select id="stsm-${id}-preset" class="text_pole" aria-label="프롬프트 프리셋">
                <option>기본 프리셋</option>
            </select>
            ${renderToolbarButton('fa-floppy-disk', '현재 프리셋 저장')}
            ${renderToolbarButton('fa-plus', '새 프리셋 추가')}
            ${renderToolbarButton('fa-trash', '프리셋 삭제')}
            ${renderToolbarButton('fa-rotate-left', '현재 프리셋 초기화')}
            <button class="stsm-add-prompt menu_button interactable" type="button">프롬프트 추가</button>
        </div>
        <div class="stsm-block-list">
            ${blocks.map(renderPromptBlock).join('')}
        </div>
    `;
}

function renderToolbarButton(icon, title) {
    return `
        <button class="menu_button menu_button_icon interactable" type="button" title="${title}" aria-label="${title}">
            <i class="fa-solid ${icon}"></i>
        </button>
    `;
}

function renderPromptBlock(block) {
    return `
        <div class="stsm-block${block.fixed ? ' stsm-block-fixed' : ''}" draggable="${String(!block.fixed)}">
            <div class="stsm-block-grip" title="드래그로 이동">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="stsm-block-main">
                <div class="stsm-block-title">${block.name}</div>
                <div class="stsm-block-preview">${block.preview}</div>
            </div>
            <label class="stsm-switch" title="전송 여부">
                <input type="checkbox" checked />
                <span></span>
            </label>
            ${block.editable ? `
                <button class="menu_button menu_button_icon interactable" type="button" title="수정" aria-label="수정">
                    <i class="fa-solid fa-pen"></i>
                </button>
            ` : ''}
            ${!block.fixed ? `
                <button class="menu_button menu_button_icon interactable" type="button" title="삭제" aria-label="삭제">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            ` : ''}
        </div>
    `;
}

function bindPrototypeEvents(root) {
    root.querySelectorAll('.stsm-tab').forEach((tab) => {
        tab.addEventListener('click', () => setActiveTab(root, tab.dataset.tab));
    });

    root.querySelector('#stsm-connection-mode').addEventListener('change', (event) => {
        root.querySelector('#stsm-custom-connection').hidden = event.target.value !== 'custom';
    });

    root.querySelectorAll('.stsm-range input').forEach((input) => {
        input.addEventListener('input', () => {
            input.nextElementSibling.textContent = input.value;
        });
    });

    root.querySelectorAll('.stsm-record').forEach(bindRecordEvents);
    root.querySelector('#stsm-translate-all').addEventListener('click', showTranslateAllConfirmation);
    root.querySelector('#stsm-delete-all-translations').addEventListener('click', showDeleteAllTranslationsConfirmation);
}

function bindRecordEvents(record) {
    record.querySelector('.stsm-record-copy').addEventListener('click', () => {
        toastr.success('복사 완료!');
    });
    record.querySelector('.stsm-record-edit').addEventListener('click', () => enterRecordEditMode(record));
    record.querySelector('.stsm-record-cancel').addEventListener('click', () => exitRecordEditMode(record, false));
    record.querySelector('.stsm-record-save').addEventListener('click', () => exitRecordEditMode(record, true));
    record.querySelector('.stsm-record-reroll').addEventListener('click', showRerollConfirmation);
    record.querySelector('.stsm-record-delete').addEventListener('click', showDeleteConfirmation);
}

function enterRecordEditMode(record) {
    if (record.querySelector('.stsm-record-editor')) return;

    const content = record.querySelector('.stsm-record-content');
    const editor = document.createElement('textarea');
    editor.className = 'stsm-record-editor text_pole';
    editor.rows = 8;
    editor.value = content.textContent.trim();
    content.hidden = true;
    content.after(editor);
    record.querySelector('.stsm-record-edit-actions').hidden = false;
    editor.focus();
}

function exitRecordEditMode(record, shouldApply) {
    const content = record.querySelector('.stsm-record-content');
    const editor = record.querySelector('.stsm-record-editor');
    if (!editor) return;

    if (shouldApply) content.textContent = editor.value;
    editor.remove();
    content.hidden = false;
    record.querySelector('.stsm-record-edit-actions').hidden = true;
}

async function showRerollConfirmation() {
    const content = document.createElement('div');
    content.textContent = '정말 재생성하시겠습니까? 이전 기록은 삭제됩니다.';
    const confirmation = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '재생성',
        cancelButton: '취소',
    });
    await confirmation.show();
}

async function showDeleteConfirmation() {
    const content = document.createElement('div');
    content.textContent = '정말 삭제하시겠습니까? 삭제된 기록은 복구할 수 없습니다.';
    const confirmation = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '삭제',
        cancelButton: '취소',
    });
    await confirmation.show();
}

async function showTranslateAllConfirmation() {
    const content = document.createElement('div');
    content.textContent = '모든 요약 기록을 일괄 번역하시겠습니까?';
    const confirmation = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '번역',
        cancelButton: '취소',
    });
    await confirmation.show();
}

async function showDeleteAllTranslationsConfirmation() {
    const content = document.createElement('div');
    content.textContent = '모든 요약 기록의 번역을 삭제하시겠습니까? 원문 요약은 삭제되지 않습니다.';
    const confirmation = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: '번역 삭제',
        cancelButton: '취소',
    });
    await confirmation.show();
}

function setActiveTab(root, tabName) {
    root.dataset.activeTab = tabName;

    root.querySelectorAll('.stsm-tab').forEach((tab) => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('stsm-tab-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });

    root.querySelectorAll('.stsm-panel').forEach((panel) => {
        panel.hidden = panel.id !== `stsm-panel-${tabName}`;
    });
}

async function openSummarizerPopup() {
    if (popup) return;

    popup = new Popup(buildPopup(), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: '닫기',
    });

    await popup.show();
    popup = null;
}

function initialize() {
    const context = SillyTavern.getContext();
    context.eventSource.on(context.eventTypes.APP_READY, addMenuItem);
    addMenuItem();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
