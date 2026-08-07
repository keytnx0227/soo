import { SUMMARY_SECTION_DESCRIPTIONS } from '../summary/summary-format.js';

export function buildPopup() {
    const root = document.createElement('div');
    root.id = 'stsm-root';
    root.dataset.activeTab = 'summary';
    root.innerHTML = `
        <div class="stsm-tabs" role="tablist">
            ${renderTab('summary', '요약', true)}
            ${renderTab('records', '기록')}
            ${renderTab('memory', '도감')}
            ${renderTab('connection', '연결 설정')}
            ${renderTab('settings', '요약 설정')}
        </div>

        <div class="stsm-extension-status" role="status" aria-live="polite">
            <span class="stsm-extension-status-face" aria-hidden="true">◕‿◕</span>
            <div class="stsm-extension-status-copy">
                <strong class="stsm-extension-status-enabled">켜짐</strong>
                <span class="stsm-extension-status-operation">작업 없음</span>
            </div>
            <div class="stsm-extension-status-actions">
                <div class="stsm-error-popover-wrap">
                    <button id="stsm-error-toggle" class="menu_button menu_button_icon interactable" type="button" title="확장 오류 로그" aria-label="확장 오류 로그" aria-expanded="false">
                        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    </button>
                    <div id="stsm-error-popover" class="stsm-error-popover" hidden>
                        <div class="stsm-error-popover-title">확장 오류 로그</div>
                        <button id="stsm-clear-errors" class="menu_button interactable" type="button">전부 지우기</button>
                        <button id="stsm-close-errors" class="menu_button menu_button_icon interactable" type="button" title="닫기" aria-label="닫기">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                        <div id="stsm-error-list" class="stsm-error-list"></div>
                    </div>
                </div>
                <label class="stsm-switch" title="요약 확장 켜기/끄기">
                    <input id="stsm-extension-enabled" type="checkbox" />
                    <span></span>
                </label>
            </div>
        </div>

        <section id="stsm-panel-summary" class="stsm-panel" role="tabpanel">
            <div class="stsm-summary-status" aria-label="요약 현황">
                <div class="stsm-summary-status-title">
                    <span>요약 현황</span>
                    <button id="stsm-open-coverage-map" class="menu_button interactable" type="button" title="채팅방 요약 현황 보기">
                        <i class="fa-solid fa-chart-simple" aria-hidden="true"></i>
                        <span>현황 보기</span>
                    </button>
                </div>
                <div class="stsm-summary-status-metrics">
                    <div class="stsm-summary-status-item">
                        <span>전체 메시지 개수</span>
                        <strong id="stsm-status-total">0</strong>
                    </div>
                    <div class="stsm-summary-status-item">
                        <span>요약된 메시지 수</span>
                        <strong id="stsm-status-summarized">0</strong>
                    </div>
                    <div class="stsm-summary-status-item">
                        <span>마지막 요약 ID</span>
                        <strong id="stsm-status-last-id">-</strong>
                    </div>
                </div>
            </div>
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
                        <div class="stsm-summary-execution-actions">
                            <button id="stsm-summarize" class="menu_button interactable" type="button">요약하기</button>
                            <button id="stsm-cancel-summary" class="menu_button interactable" type="button" hidden>
                                <i class="fa-solid fa-stop" aria-hidden="true"></i>
                                <span>중단</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 사용 설정</div>
                <div class="stsm-injection-grid">
                    <div class="stsm-injection-mode-group">
                        <label class="stsm-field"><span>사용 방법</span><select id="stsm-injection-mode" class="text_pole"><option value="macro">매크로로만 사용</option><option value="depth">채팅 깊이에 주입</option><option value="prompt">프롬프트 영역에 주입</option></select></label>
                        <div class="stsm-macro-name"><span><code>{{sumiSummary}}</code> 매크로를 통해 요약을 원하는 위치에 삽입할 수 있습니다.</span></div>
                    </div>
                    <label class="stsm-field stsm-injection-depth"><span>깊이</span><input id="stsm-injection-depth" class="text_pole" type="number" min="0" max="10000" /></label>
                    <label class="stsm-field stsm-injection-role"><span>역할</span><select id="stsm-injection-role" class="text_pole"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                    <label class="stsm-field stsm-injection-position"><span>Story/Main Prompt 위치</span><select id="stsm-injection-position" class="text_pole"><option value="before">앞</option><option value="after">뒤</option></select></label>
                </div>
                <div id="stsm-context-block-list" class="stsm-context-block-list"></div>
                <div class="stsm-long-term-retrieval">
                    <div class="stsm-long-term-heading">
                        <div>
                            <strong>장기기억 불러오기</strong>
                            <span>최근 채팅의 검색 단서와 일치하는 원본 기억을 요약 매크로에 함께 넣습니다.</span>
                        </div>
                        <label class="stsm-switch" title="장기기억 자동 회상 켜기/끄기">
                            <input id="stsm-long-term-enabled" data-long-term-setting="enabled" type="checkbox" />
                            <span></span>
                        </label>
                    </div>
                    <div class="stsm-long-term-settings-grid">
                        <label class="stsm-field">
                            <span>불러오기 방식</span>
                            <select id="stsm-long-term-mode" data-long-term-setting="mode" class="text_pole">
                                <option value="simple">단순 키워드 일치</option>
                                <option value="relevance">관련도 점수</option>
                            </select>
                        </label>
                        <label class="stsm-field">
                            <span>검색할 최근 메시지 수</span>
                            <input id="stsm-long-term-message-count" data-long-term-setting="messageCount" class="text_pole" type="number" min="1" max="100" />
                        </label>
                        <label class="stsm-field">
                            <span>장기기억 최대 토큰</span>
                            <input id="stsm-long-term-max-tokens" data-long-term-setting="maxTokens" class="text_pole" type="number" min="100" max="100000" step="100" />
                        </label>
                        <label class="stsm-field stsm-long-term-relevance-field">
                            <span>관련도 기준</span>
                            <select id="stsm-long-term-relevance" data-long-term-setting="relevance" class="text_pole">
                                <option value="loose">느슨함</option>
                                <option value="balanced">보통</option>
                                <option value="strict">엄격함</option>
                            </select>
                        </label>
                    </div>
                    <div class="stsm-long-term-result" aria-live="polite"></div>
                </div>
            </div>
        </section>

        <section id="stsm-panel-records" class="stsm-panel" role="tabpanel" hidden>
            <div class="stsm-records-toolbar">
                <div class="stsm-records-toolbar-actions">
                    <button id="stsm-open-compression" class="menu_button interactable" type="button">
                        <i class="fa-solid fa-compress" aria-hidden="true"></i>
                        <span>압축하기</span>
                    </button>
                    <button id="stsm-preview-summary-context" class="menu_button interactable" type="button">
                        <i class="fa-solid fa-eye"></i>
                        <span>미리보기</span>
                    </button>
                    <button id="stsm-adjust-record-ranges" class="menu_button interactable" type="button">
                        <i class="fa-solid fa-arrows-left-right"></i>
                        <span>범위 일괄 교정</span>
                    </button>
                </div>
                <div class="stsm-records-view-controls">
                    <label class="stsm-field stsm-sort-field">
                        <select id="stsm-record-sort" class="text_pole" aria-label="요약 기록 정렬">
                            <option value="id-desc">ID 높은 순</option>
                            <option value="id-asc">ID 낮은 순</option>
                        </select>
                    </label>
                    <button id="stsm-records-fullscreen" class="menu_button menu_button_icon interactable" type="button" title="기록 전체 화면으로 보기" aria-label="기록 전체 화면으로 보기">
                        <i class="fa-solid fa-expand" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            <div class="stsm-record-memory-browser">
                <div class="stsm-record-memory-tabs" role="tablist" aria-label="기억 종류">
                    <button class="stsm-record-memory-tab stsm-record-memory-tab-active menu_button interactable" type="button" data-memory-view="active" role="tab" aria-selected="true">상시기억</button>
                    <button class="stsm-record-memory-tab menu_button interactable" type="button" data-memory-view="long-term" role="tab" aria-selected="false">장기기억</button>
                </div>
                ${renderRecordSearchControls()}
                <div id="stsm-record-list" class="stsm-record-list"></div>
            </div>
            ${renderTranslationSettings()}
        </section>

        <section id="stsm-panel-memory" class="stsm-panel" role="tabpanel" hidden>
            <div class="stsm-memory-toolbar">
                <div>
                    <strong>도감</strong>
                    <span>요약 레코드의 변경안을 바탕으로 계산된 장기 기억</span>
                </div>
            </div>
            <div class="stsm-atlas-scroll">
                <section class="stsm-atlas-section">
                    <div class="stsm-atlas-section-heading">
                        <strong>인물 도감</strong>
                        <span id="stsm-people-memory-count">0명</span>
                    </div>
                    <div id="stsm-people-memory-skipped" class="stsm-people-memory-warning" hidden></div>
                    <div id="stsm-people-memory-list" class="stsm-people-memory-list"></div>
                    <div id="stsm-people-memory-excluded" class="stsm-atlas-excluded-host"></div>
                </section>
                <section class="stsm-atlas-section">
                    <div class="stsm-atlas-section-heading">
                        <strong>아이템 도감</strong>
                        <span id="stsm-item-memory-count">0개</span>
                    </div>
                    <div id="stsm-item-memory-skipped" class="stsm-item-memory-warning" hidden></div>
                    <div id="stsm-item-memory-list" class="stsm-item-memory-list"></div>
                    <div id="stsm-item-memory-excluded" class="stsm-atlas-excluded-host"></div>
                </section>
                <section class="stsm-atlas-section">
                    <div class="stsm-atlas-section-heading">
                        <strong>서약 장부</strong>
                        <span id="stsm-commitment-memory-count">0개</span>
                    </div>
                    <div id="stsm-commitment-memory-skipped" class="stsm-commitment-memory-warning" hidden></div>
                    <div id="stsm-commitment-memory-list" class="stsm-commitment-memory-list"></div>
                    <div id="stsm-commitment-memory-excluded" class="stsm-atlas-excluded-host"></div>
                </section>
                <section class="stsm-atlas-section">
                    <div class="stsm-atlas-section-heading">
                        <strong>주요 사건</strong>
                        <span id="stsm-event-memory-count">0개</span>
                    </div>
                    <div id="stsm-event-memory-skipped" class="stsm-event-memory-warning" hidden></div>
                    <div id="stsm-event-memory-list" class="stsm-event-memory-list"></div>
                    <div id="stsm-event-memory-excluded" class="stsm-atlas-excluded-host"></div>
                </section>
            </div>
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
                    <span>요약 작성 언어</span>
                    <select id="stsm-summary-output-language" class="text_pole">
                        <option value="english">영어로</option>
                        <option value="source">원문 언어로</option>
                        <option value="english-dialogue-source">영어로, 대사만 원문 언어로</option>
                    </select>
                </label>
                <label class="stsm-field">
                    <span>요약 주입 최대 토큰</span>
                    <input id="stsm-injection-max-tokens" class="text_pole" type="number" min="100" max="200000" step="100" />
                </label>
                <label class="stsm-field">
                    <span>기본 압축 레코드 수</span>
                    <input id="stsm-compression-group-size" class="text_pole" type="number" min="2" max="100" step="1" />
                </label>
                <div class="stsm-field stsm-auto-hide-field">
                    <span>요약한 메시지 자동 숨김</span>
                    <label class="stsm-switch" title="요약한 메시지 자동 숨김">
                        <input id="stsm-auto-hide-summarized" type="checkbox" />
                        <span></span>
                    </label>
                </div>
            </div>
            <div class="stsm-auto-hide-actions">
                <button id="stsm-unhide-all-summarized" class="menu_button interactable" type="button">숨김 일괄 해제</button>
                <button id="stsm-hide-all-summarized" class="menu_button interactable" type="button">숨김 일괄 진행</button>
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 항목 설정</div>
                <div class="stsm-summary-section-grid">
                    ${renderSummarySectionToggle('plot', '플롯', true)}
                    ${renderSummarySectionToggle('title', '제목')}
                    ${renderSummarySectionToggle('date', '날짜')}
                    ${renderSummarySectionToggle('time', '시간')}
                    ${renderSummarySectionToggle('location', '장소')}
                    ${renderSummarySectionToggle('continuity', '연속성 변화')}
                    ${renderSummarySectionToggle('emotions', '감정')}
                    ${renderSummarySectionToggle('quotes', '주요 대사')}
                    ${renderSummarySectionToggle('tags', '검색 태그')}
                </div>
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">요약 레코드 내용 형식</div>
                <div id="stsm-summary-content-template"></div>
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">압축 요약 레코드 내용 형식</div>
                <div id="stsm-compression-content-template"></div>
            </div>

            <div class="stsm-settings-section">
                <div class="stsm-section-title">도감 추출 설정</div>
                <div class="stsm-summary-section-grid">
                    ${renderMemorySectionToggle('people', '인물 도감')}
                    ${renderMemorySectionToggle('items', '아이템 도감')}
                    ${renderMemorySectionToggle('commitments', '서약 장부')}
                    ${renderMemorySectionToggle('events', '주요 사건')}
                </div>
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

            <div class="stsm-settings-section">
                <div class="stsm-section-title">압축 요약 프롬프트 설정</div>
                <div data-prompt-editor="compression"></div>
                ${renderPromptInspector('compression', '압축 요약 프롬프트')}
            </div>

            <div class="stsm-settings-section stsm-data-management">
                <div class="stsm-section-title">데이터 가져오기·내보내기</div>
                <div class="stsm-data-management-group">
                    <div class="stsm-data-management-copy">
                        <strong>현재 채팅 요약 데이터</strong>
                        <span>요약 레코드, 번역, 도감 상태와 최근 수정 대화를 관리합니다.</span>
                    </div>
                    <div class="stsm-data-management-actions">
                        <button id="stsm-export-chat-data" class="menu_button interactable" type="button">
                            <i class="fa-solid fa-file-export" aria-hidden="true"></i>
                            <span>내보내기</span>
                        </button>
                        <button id="stsm-import-chat-data" class="menu_button interactable" type="button">
                            <i class="fa-solid fa-file-import" aria-hidden="true"></i>
                            <span>가져오기</span>
                        </button>
                    </div>
                    <button id="stsm-reset-chat-data" class="menu_button interactable stsm-danger-text-button" type="button">현재 채팅 요약 데이터 전체 초기화</button>
                    <input id="stsm-import-chat-data-file" type="file" accept="application/json,.json" hidden />
                </div>
                <div class="stsm-data-management-group">
                    <div class="stsm-data-management-copy">
                        <strong>확장 전역 설정</strong>
                        <span>프롬프트, 연결, 요약, 주입과 번역 설정을 관리합니다. 채팅별 요약 데이터는 포함하지 않습니다.</span>
                    </div>
                    <div class="stsm-data-management-actions">
                        <button id="stsm-export-global-settings" class="menu_button interactable" type="button">
                            <i class="fa-solid fa-file-export" aria-hidden="true"></i>
                            <span>내보내기</span>
                        </button>
                        <button id="stsm-import-global-settings" class="menu_button interactable" type="button">
                            <i class="fa-solid fa-file-import" aria-hidden="true"></i>
                            <span>가져오기</span>
                        </button>
                    </div>
                    <input id="stsm-import-global-settings-file" type="file" accept="application/json,.json" hidden />
                </div>
            </div>
        </section>
    `;
    return root;
}

export function renderRecordSearchControls() {
    return `
        <div class="stsm-record-search">
            <select class="stsm-record-search-mode text_pole" aria-label="기억 검색 방식">
                <option value="number">번호</option>
                <option value="all">전체</option>
                <option value="tags">태그</option>
            </select>
            <div class="stsm-record-search-input-wrap">
                <input class="stsm-record-search-input text_pole" type="search" inputmode="numeric" placeholder="메시지 ID" aria-label="기억 검색어" />
                <button class="stsm-record-search-clear stsm-record-search-clear-hidden menu_button menu_button_icon interactable" type="button" title="검색어 지우기" aria-label="검색어 지우기" aria-hidden="true" disabled>
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <span class="stsm-record-search-count" aria-live="polite"></span>
        </div>
    `;
}

function renderSummarySectionToggle(section, label, required = false) {
    const title = required ? `${label}은 필수 항목입니다.` : `${label} 추출 켜기/끄기`;
    const description = SUMMARY_SECTION_DESCRIPTIONS[section];
    return `
        <div class="stsm-summary-section-toggle">
            <span class="stsm-summary-section-label">
                <span>${label}${required ? ' (필수)' : ''}</span>
                <button class="stsm-section-info interactable" type="button" data-tooltip="${description}" aria-label="${label} 설명: ${description}">
                    <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                </button>
            </span>
            <label class="stsm-switch" title="${title}">
                <input type="checkbox" data-summary-section="${section}" ${required ? 'checked disabled' : ''} />
                <span></span>
            </label>
        </div>
    `;
}

function renderMemorySectionToggle(section, label) {
    const description = SUMMARY_SECTION_DESCRIPTIONS[section];
    return `
        <div class="stsm-summary-section-toggle">
            <span class="stsm-summary-section-label">
                <span>${label}</span>
                <button class="stsm-section-info interactable" type="button" data-tooltip="${description}" aria-label="${label} 설명: ${description}">
                    <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                </button>
            </span>
            <label class="stsm-switch" title="${label} 추출 켜기/끄기">
                <input type="checkbox" data-memory-section="${section}" />
                <span></span>
            </label>
        </div>
    `;
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
