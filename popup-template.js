export function buildPopup() {
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
                    <div class="stsm-summary-input-row">
                        <div class="stsm-range-inputs">
                            <div class="stsm-range-column">
                                <input id="stsm-range-start" class="text_pole" type="number" min="0" placeholder="시작 ID" aria-label="요약 시작 채팅 ID" />
                                <button id="stsm-range-after-last" class="menu_button interactable" type="button">최근 요약 다음</button>
                            </div>
                            <span class="stsm-range-separator" aria-hidden="true">~</span>
                            <div class="stsm-range-column">
                                <input id="stsm-range-end" class="text_pole" type="number" min="0" placeholder="종료 ID" aria-label="요약 종료 채팅 ID" />
                                <div class="stsm-range-chunk-actions">
                                    <button id="stsm-range-chunk-minus" class="menu_button interactable" type="button">− 청크</button>
                                    <button id="stsm-range-chunk-plus" class="menu_button interactable" type="button">+ 청크</button>
                                </div>
                            </div>
                        </div>
                        <button id="stsm-summarize" class="menu_button interactable" type="button">요약하기</button>
                    </div>
                </div>
            </div>
            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 사용 설정</div>
                <div class="stsm-injection-grid">
                    <label class="stsm-field"><span>사용 방법</span><select id="stsm-injection-mode" class="text_pole"><option value="macro">매크로로만 사용</option><option value="depth">채팅 깊이에 주입</option><option value="prompt">프롬프트 영역에 주입</option></select></label>
                    <label class="stsm-field stsm-injection-depth"><span>깊이</span><input id="stsm-injection-depth" class="text_pole" type="number" min="0" max="10000" /></label>
                    <label class="stsm-field stsm-injection-role"><span>역할</span><select id="stsm-injection-role" class="text_pole"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                    <label class="stsm-field stsm-injection-position"><span>Story/Main Prompt 위치</span><select id="stsm-injection-position" class="text_pole"><option value="before">앞</option><option value="after">뒤</option></select></label>
                </div>
                <div class="stsm-macro-name"><span><code>{{sumiSummary}}</code> 매크로를 통해 요약을 원하는 위치에 삽입할 수 있습니다.</span></div>
            </div>
        </section>

        <section id="stsm-panel-records" class="stsm-panel" role="tabpanel" hidden>
            <div class="stsm-records-toolbar">
                <button id="stsm-preview-summary-context" class="menu_button interactable" type="button">
                    <i class="fa-solid fa-eye"></i>
                    <span>미리보기</span>
                </button>
                <label class="stsm-field stsm-sort-field">
                    <select id="stsm-record-sort" class="text_pole" aria-label="요약 기록 정렬">
                        <option value="newest">최신 순</option>
                        <option value="oldest">오래된 순</option>
                    </select>
                </label>
            </div>
            <div id="stsm-record-list" class="stsm-record-list"></div>
            ${renderTranslationSettings()}
        </section>

        <section id="stsm-panel-connection" class="stsm-panel" role="tabpanel" hidden>
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
            <div id="stsm-custom-connection" class="stsm-grid-two" hidden></div>
            <div id="stsm-sampler-settings" class="stsm-settings-stack"></div>
        </section>

        <section id="stsm-panel-settings" class="stsm-panel stsm-settings-panel" role="tabpanel" hidden>
            <div class="stsm-settings-top-grid">
                <label class="stsm-field">
                    <span>요약 청크 크기</span>
                    <input id="stsm-chunk-size" class="text_pole" type="number" min="1" max="1000" step="1" />
                </label>
                <label class="stsm-field">
                    <span>요약 주입 최대 토큰</span>
                    <input id="stsm-injection-max-tokens" class="text_pole" type="number" min="100" max="200000" step="100" />
                </label>
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 프롬프트 설정</div>
                <div data-prompt-editor="summary"></div>
                ${renderPromptInspector('summary', '요약 프롬프트')}
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">수정 대화 프롬프트 설정</div>
                <div data-prompt-editor="revision"></div>
                ${renderPromptInspector('revision', '요약 수정 대화 프롬프트')}
            </div>

            <div class="stsm-settings-footer"></div>
        </section>
    `;
    return root;
}

function renderPromptInspector(type, label) {
    return `<div class="stsm-token-meter"><span>전송 토큰 수</span><strong id="stsm-token-count-${type}">계산 대기 중</strong><button class="stsm-preview-prompt menu_button menu_button_icon interactable" data-preview-type="${type}" type="button" title="${label} 전체 보기" aria-label="${label} 전체 보기"><i class="fa-solid fa-eye"></i></button></div>`;
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

function renderTranslationSettings() {
    return `
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
    `;
}
