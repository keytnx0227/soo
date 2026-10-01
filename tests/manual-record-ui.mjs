import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const moduleName = process.argv.find(value => value.startsWith('--playwright-module='))?.split('=').slice(1).join('=') || 'playwright';
const { chromium } = await import(moduleName);
const root = new URL('../', import.meta.url);
const sources = {};
for (const name of [
    'core/utils.js', 'summary/record-placement.js', 'summary/summary-record-template.js',
    'summary/summary-format.js', 'memory/people-feelings.js', 'memory/people-feelings-view.js',
    'records/structured-editor-order.js', 'records/structured-summary-editor.js',
    'records/manual-record-view.js', 'memory/atlas-manual-editor.js', 'ui/popup-template.js',
    'summary/compression-view.js',
    'summary/range-utils.js', 'records/manual-record-settings.js', 'records/manual-atlas-draft.js', 'records/manual-atlas-view.js',
    'records/record-memory-updates-view.js', 'summary/context-block-composer.js', 'ui/section-tooltip.js',
    'memory/atlas-source-record.js', 'memory/atlas-entity-id.js', 'memory/atlas-projection-service.js', 'memory/atlas-corrections.js',
    'memory/people-memory.js', 'memory/item-memory.js', 'memory/commitment-memory.js', 'memory/event-memory.js', 'memory/world-memory.js',
    'records/manual-author-engine.js', 'records/manual-author-view.js',
    'memory/perception-memory.js', 'memory/perception-memory-view.js',
    'memory/atlas-layer-order.js', 'memory/atlas-anchor-transaction.js', 'memory/atlas-metadata.js',
    'memory/atlas-review-service.js', 'memory/atlas-review-view.js',
    'memory/atlas-fullscreen-view.js', 'translation/atlas-translation-service.js', 'ui/token-usage-view.js',
]) sources[name] = await readFile(new URL(name, root), 'utf8');
const css = await readFile(new URL('style.css', root), 'utf8');
const output = new URL('personal-notes/manual-record-ui/', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    for (const width of [360, 390, 1000]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
        await page.setContent('<html lang="ko"><body><main id="test-root"></main></body></html>');
        await page.addStyleTag({ content: `
            * { box-sizing: border-box; } body { margin: 0; padding: 12px; font: 14px Arial, sans-serif; color: #333; background: #f6f6f7; }
            :root { --SmartThemeBodyColor:#333; --SmartThemeBorderColor:#d4d4d8; --SmartThemeQuoteColor:#bf4670; }
            .text_pole { border:1px solid #ccc; border-radius:5px; background:white; color:inherit; padding:6px; font:inherit; }
            .menu_button { border:1px solid #ccc; border-radius:4px; background:white; padding:5px; color:inherit; cursor:pointer; }
            .menu_button:where([data-atlas-add]) { width: 30px; }
            .stsm-atlas-review-history-delete { width: 30px; }
            .test-popup { width: min(100%, 780px); margin: 0 auto; padding: 10px; background: #fafafa; border: 1px solid #ccc; }
            button { font:inherit; } textarea { resize:vertical; } [hidden] { display:none; }
        ` });
        await page.addStyleTag({ content: css });
        await page.evaluate(({ sources }) => {
            const load = (name, exports, scope = {}) => new Function(...Object.keys(scope),
                sources[name].replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '')
                + `\nreturn {${exports.join(',')}};`)(...Object.values(scope));
            const scope = { ...load('core/utils.js', ['escapeHtml', 'createId']), ...load('summary/record-placement.js', ['hasMessageRange', 'recordRangeLabel', 'recordSelectionLabel', 'recordPosition', 'compareRecordPosition', 'rangeAwareTemplate', 'positionAfter']) };
            Object.assign(scope, load('memory/people-feelings.js', ['normalizeFeelings', 'formatFeelings']));
            Object.assign(scope, load('summary/summary-record-template.js', ['DEFAULT_SUMMARY_CONTENT_TEMPLATE', 'renderSummaryContentTemplate'], scope));
            Object.assign(scope, load('summary/summary-format.js', ['SUMMARY_FORMAT_VERSION', 'SUMMARY_SECTION_DESCRIPTIONS', 'DEFAULT_SUMMARY_SECTIONS', 'DEFAULT_MEMORY_SECTIONS', 'normalizeStructuredSummaryData', 'renderStructuredSummary', 'buildSummaryJsonContract', 'parseStructuredSummaryResponse'], scope));
            Object.assign(scope, load('records/structured-editor-order.js', ['moveEditorItem', 'refreshEditorOrderControls']));
            Object.assign(scope, load('memory/people-feelings-view.js', ['handleFeelingEditorClick', 'readFeelingEditor', 'renderFeelingEditor'], scope));
            const context = { chat: Array.from({ length: 200 }, () => ({})), chatMetadata: {}, saveMetadata: async () => {}, eventSource: { emit: async () => {} }, eventTypes: { GENERATION_STOPPED: 'stopped' } };
            const settings = { summarization: { outputLanguage: 'source', compressionGroupSize: 3,
                contextBlocks: [{ kind: 'people', enabled: true, entryTemplate: '{{sumiPersonName}}: {{sumiPersonRole}}\n{{sumiPersonAppearance}}' }],
            } };
            const records = [{ id: 'a', startId: 0, endId: 19 }, { id: 'x', startId: null, endId: null, position: 19.5, manual: { includeInCompression: false } }, { id: 'b', startId: 20, endId: 39 }];
            records[0].structuredSummary = { data: { plot: ['오래된 약속과 만남의 기록'], memoryUpdates: { people: { created: [{ sourceId: 'existing-person', name: '기존 인물', role: '여행자' }] } } } };
            window.toastr = { error: value => { window.lastError = value; }, info: value => { window.lastInfo = value; }, success() {} };
            window.SillyTavern = { getContext: () => context };
            class Popup {
                static show = { confirm: async () => !window.cancelConfirm };
                constructor(form, type, value, options) { this.form = form; this.options = options; }
                show() {
                    this.parent = document.querySelector('.test-popup:last-child');
                    if (this.parent) this.parent.hidden = true;
                    const host = document.createElement('section');
                    host.className = 'test-popup';
                    host.append(this.form);
                    const submit = document.createElement('button');
                    submit.className = 'test-submit'; submit.textContent = this.options.okButton;
                    const cancel = document.createElement('button');
                    cancel.className = 'test-cancel'; cancel.textContent = '취소';
                    host.append(submit, cancel); document.querySelector('#test-root').append(host);
                    return new Promise(resolve => {
                        const close = async result => {
                            this.result = result;
                            if (this.options.onClosing && !await this.options.onClosing(this)) return;
                            host.remove(); if (this.parent) this.parent.hidden = false;
                            resolve(result);
                        };
                        submit.onclick = () => close(1); cancel.onclick = () => close(0);
                    });
                }
            }
            Object.assign(scope, {
                Popup, POPUP_TYPE: { CONFIRM: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
                getSettings: () => settings, getExtensionState: () => ({}),
                getSummaryRecordIndex: () => records,
                getSummaryRecord: id => records.find(record => record.id === id),
                getSummaryRecords: () => records, filterLlmVisibleSummaryRecords: records => records,
                getManualAtlasEntries: () => [], getAtlasCorrections: () => ({}), getAtlasReviewRecords: () => [], getAtlasLayerOrders: () => ({}),
                SUMMARY_CONTEXT_BLOCK_KINDS: { RECORDS: 'records', PEOPLE: 'people', ITEMS: 'items', EVENTS: 'events', COMMITMENTS: 'commitments', WORLD: 'world', PERCEPTIONS: 'perceptions' },
                addSummaryRecord: async record => { window.savedRecord = record; return record; },
                updateSummaryRecordContent: async (id, content, options) => { window.editedRecord = { id, ...options }; return window.editedRecord; },
                validateSummaryRange: (start, end) => {
                    if (!start.trim() || !end.trim() || +start > +end || +end >= context.chat.length) throw new Error('invalid range');
                    return { start: +start, end: +end };
                },
            });
            Object.assign(scope, load('summary/range-utils.js', ['getCoveredRanges', 'getCoverageSegments', 'formatRanges'], scope));
            Object.assign(scope, load('records/manual-record-settings.js', ['renderManualRecordSettings', 'bindManualRecordSettings', 'renderManualInfo'], scope));
            Object.assign(scope, load('memory/atlas-source-record.js', ['canApplyAtlasReplacement', 'compareAtlasSourceRecords', 'getAtlasSourceRange', 'formatAtlasSourceRange'], scope));
            Object.assign(scope, load('memory/atlas-entity-id.js', ['getCreatedAtlasEntityId', 'createStableAtlasEntityId'], scope));
            for (const [file, name] of [['people', 'People'], ['item', 'Item'], ['commitment', 'Commitment'], ['event', 'Event'], ['world', 'World'], ['perception', 'Perception']]) {
                Object.assign(scope, load(`memory/${file}-memory.js`, [`derive${name}Atlas`], scope));
            }
            Object.assign(scope, load('memory/atlas-corrections.js', ['applyAtlasCorrections'], scope));
            Object.assign(scope, load('memory/atlas-layer-order.js', ['ATLAS_LAYER_CATEGORIES', 'buildAtlasLayers', 'resolveAtlasLayerOrder', 'reanchorAtlasLayers'], scope));
            Object.assign(scope, load('memory/atlas-anchor-transaction.js', ['captureAtlasAnchors'], scope));
            Object.assign(scope, load('memory/atlas-metadata.js', ['getManualAtlasEntries', 'getAtlasCorrections', 'getAtlasReviewRecords', 'addManualAtlasEntry', 'updateManualAtlasEntry', 'deleteManualAtlasEntry', 'setAtlasEntityExcluded', 'setAtlasEntityLlmHidden', 'setPerceptionPinned', 'getAtlasTranslations', 'getAtlasTranslation', 'saveAtlasTranslation'], scope));
            Object.assign(scope, load('memory/atlas-projection-service.js', ['getAtlasProjection', 'invalidateAtlasProjection'], scope));
            window.addEventListener('stsm:atlas-changed', () => scope.invalidateAtlasProjection());
            Object.assign(scope, load('summary/context-block-composer.js', ['buildRenderedBlocks'], scope));
            Object.assign(scope, load('records/record-memory-updates-view.js', ['renderRecordMemoryUpdateDetails'], scope));
            Object.assign(scope, load('records/manual-atlas-draft.js', ['atlasUpdateEditorInitial', 'createManualAtlasUpdate', 'collectManualAtlasUpdates'], scope));
            Object.assign(scope, load('memory/atlas-manual-editor.js', ['showManualAtlasEntryEditor'], scope));
            Object.assign(scope, {
                getTokenCount: text => Math.ceil(text.length / 4),
                getStringHash: text => text, assertExtensionEnabled() {},
                translate: async text => `번역 결과: ${text}`,
                beginOperation: () => Symbol(), endOperation() {},
                buildSummaryContextDetails: () => ({ enabled: true, blocks: [{ kind: 'perceptions', enabled: true, outputTokenCount: 30, budget: Infinity }] }),
            });
            settings.translation = { provider: 'mock', targetLanguage: 'ko' };
            Object.assign(scope, load('translation/atlas-translation-service.js', ['getValidAtlasTranslation', 'translateAtlasEntity'], scope));
            Object.assign(scope, load('ui/token-usage-view.js', ['renderTokenUsageBar'], scope));
            Object.assign(scope, load('memory/perception-memory-view.js', ['showPerceptionUpdateEditor', 'renderPerceptionMemory', 'bindPerceptionMemoryView'], scope));
            Object.assign(scope, load('memory/atlas-fullscreen-view.js', ['bindAtlasFullscreenView'], {
                ...scope, bindManualAtlasEntryButtons() {},
                bindPeopleMemoryView() {}, renderPeopleMemory() {}, bindItemMemoryView() {}, renderItemMemory() {},
                bindCommitmentMemoryView() {}, renderCommitmentMemory() {}, bindEventMemoryView() {}, renderEventMemory() {},
                bindWorldMemoryView() {}, renderWorldMemory() {},
            }));
            Object.assign(scope, load('records/manual-atlas-view.js', ['openManualAtlasManager'], scope));
            Object.assign(scope, load('records/structured-summary-editor.js', ['renderEditor', 'bindEditorActions', 'collectEditorData', 'openStructuredSummaryEditor'], scope));
            Object.assign(scope, load('records/manual-author-engine.js', ['composeAuthorPrompt', 'parseAuthorDraft', 'authorEntries'], scope));
            Object.assign(scope, {
                beginOperation: () => Symbol(), endOperation() {},
                getTokenCountAsync: async prompt => Math.ceil(prompt.length / 4),
                buildSummaryPrompt: async chunk => { window.lastSourceCount = chunk.messages.length; return 'CUSTOM PRESET'; },
                createSummaryChunks: (chat, startId, endId) => [{ startId, endId, messages: chat.slice(startId, endId + 1) }],
                generateSummary: async (prompt, options) => {
                    window.authorCalls = (window.authorCalls || 0) + 1;
                    window.authorPrompt = prompt; window.authorOutput = options.maxTokens;
                    if (window.failAuthor) throw new Error('mock request failed');
                    if (window.deferAuthor) return await new Promise(resolve => { window.finishAuthor = resolve; });
                    if (window.invalidAuthor) return 'invalid json';
                    if (prompt.includes('Current response mode: DRAFT WRITING')) return JSON.stringify({ title: '함께 작성한 기억', plot: ['옛 수동 요약을 구조화한 내용'], quotes: [{ speaker: 'A', text: '꽃처럼 부드러운 말' }], memoryUpdates: { people: { created: [{ name: '새 인물' }] } } });
                    return '대사는 보존하고 사건과 감정을 나눠보면 좋겠어요.';
                },
            });
            Object.assign(scope, load('records/manual-author-view.js', ['openManualAuthor'], scope));
            window.openEdit = () => {
                records[1].type = 'summary';
                records[1].structuredSummary = { data: { title: '보충 기록', plot: ['보존할 내용'] } };
                void scope.openStructuredSummaryEditor('x');
            };
            window.currentAtlas = () => scope.getAtlasProjection();
            const manual = load('records/manual-record-view.js', ['openManualRecordEditor', 'bindManualRecordView'], scope);
            window.openManual = () => { void manual.openManualRecordEditor(); };
            const popupTemplate = load('ui/popup-template.js', ['buildPopup'], scope);
            window.renderToolbar = () => {
                const popup = popupTemplate.buildPopup();
                document.querySelector('#test-root').replaceChildren(popup.querySelector('.stsm-records-toolbar'), popup.querySelector('.stsm-record-memory-browser'));
                manual.bindManualRecordView(document.querySelector('#test-root'));
            };
            window.renderPerceptions = () => {
                records[0].type = 'summary';
                records[0].structuredSummary.data.memoryUpdates.people.created.push({ sourceId: 'second-person', name: '아주 긴 이름을 가진 두 번째 인물', role: '친구' });
                settings.summarization.contextBlocks.push({ kind: 'perceptions', enabled: true, entryTemplate: '{{sumiPerceptionObserver}} -> {{sumiPerceptionSubject}}\n{{sumiPerceptionFacts}}\n{{sumiPerceptionImpression}}' });
                scope.invalidateAtlasProjection();
                const popup = popupTemplate.buildPopup();
                const root = document.querySelector('#test-root');
                root.replaceChildren(popup.querySelector('.stsm-perception-section'));
                scope.bindPerceptionMemoryView(root);
                scope.bindAtlasFullscreenView(root);
            };
            window.openPerceptionDraft = () => { void scope.openManualAtlasManager([], memoryUpdates => ({ id: 'perception-draft', startId: 40, endId: 49, structuredSummary: { data: { memoryUpdates } } }))
                .then(result => { window.perceptionDraft = result; }); };
            Object.assign(scope, load('memory/atlas-review-service.js', ['ATLAS_REVIEW_CATEGORIES', 'ATLAS_REVIEW_MODES', 'getAtlasReviewOverview', 'getAtlasReviewRecordCandidates'], scope));
            const review = load('memory/atlas-review-view.js', ['openAtlasReviewPopup', 'renderDraftResult', 'compareAtlas'], scope);
            window.renderReviewResult = (translated = false) => {
                const before = [{ id: 'ab', observerName: '관찰자', subjectName: '상대', facts: [{ id: 'fact', text: '꽃을 좋아한다.' }], impression: '조용한 사람' }];
                const after = [{ ...before[0], facts: [{ id: 'fact', text: '꽃과 음악을 좋아한다. <script>unsafe</script>' }], impression: '다정한 사람' }];
                const root = document.querySelector('#test-root');
                root.innerHTML = '<div class="stsm-atlas-review-result"></div>';
                review.renderDraftResult(root, { category: 'perceptions', before, after, completed: true, entries: [{ startId: 0, endId: 19,
                    stepChanges: review.compareAtlas(before, after), memoryUpdates: { created: [], updated: [{ targetId: 'ab', append: { facts: ['새로운 정보'] } }] } }] }, '',
                    translated ? { content: '번역된 결과', generated: { content: '생성된 변경안 번역' } } : null, translated);
            };
            window.openPerceptionReview = () => { void review.openAtlasReviewPopup(); };
            window.seedReviewHistory = () => {
                records[0].atlasReviewOverrides = { perceptions: { reviewBatchId: 'test-batch', reviewMode: 'chronological', reviewedAt: new Date().toISOString(), memoryUpdates: { created: [], updated: [] } } };
            };
            const compression = load('summary/compression-view.js', ['bindCompressionView'], {
                ...scope, getCompressionCandidates: () => records,
                isCompressionIncluded: record => record.manual?.includeInCompression !== false,
                createCompressionBatchPlan: () => ({ batches: [records], sources: records, nextRecord: null }),
            });
            window.openCompression = () => {
                const root = document.querySelector('#test-root');
                root.innerHTML = '<button id="stsm-open-compression">압축</button>';
                compression.bindCompressionView(root);
                root.querySelector('button').click();
            };
            window.openManual();
            load('ui/section-tooltip.js', ['bindSectionTooltips']).bindSectionTooltips();
        }, { sources });
        await page.locator('[data-manual-author]').click();
        await page.locator('[data-author-input]').fill('이 수동 요약을 어떻게 정리할까?');
        assert.equal(await page.evaluate(() => window.authorCalls || 0), 0, 'typing does not trigger requests');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => document.querySelector('[data-author-history]')?.textContent.includes('대사는 보존'));
        assert.equal(await page.evaluate(() => window.lastSourceCount), 0);
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.match(await page.locator('[data-author-status]').innerText(), /먼저 생성/);
        await page.evaluate(() => { window.failAuthor = true; });
        await page.locator('[data-author-input]').fill('실패할 요청');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => document.querySelector('[data-author-status]')?.textContent.includes('mock request failed'));
        assert.equal(await page.locator('.stsm-author-turn').count(), 2);
        assert.equal(await page.locator('[data-author-input]').inputValue(), '실패할 요청');
        await page.evaluate(() => { window.failAuthor = false; });
        await page.locator('input[value="write"]').check();
        await page.locator('[data-author-input]').fill('좋아 그대로 구조화해줘');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => document.querySelector('[data-author-version]')?.textContent === 'v1');
        assert.match(await page.locator('[data-author-render]').innerText(), /꽃처럼 부드러운 말/);
        assert.match(await page.locator('[data-author-render]').innerText(), /새 인물/);
        await page.evaluate(() => { window.invalidAuthor = true; });
        await page.locator('[data-author-input]').fill('형식 오류 테스트');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => document.querySelector('[data-author-status]')?.textContent.includes('JSON'));
        assert.equal(await page.locator('[data-author-version]').innerText(), 'v1');
        assert.equal(await page.locator('.stsm-author-turn').count(), 4);
        await page.evaluate(() => { window.invalidAuthor = false; window.deferAuthor = true; });
        await page.locator('[data-author-input]').fill('중단할 요청');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => typeof window.finishAuthor === 'function');
        await page.locator('[data-author-stop]').click();
        await page.evaluate(() => { window.finishAuthor(JSON.stringify({ plot: ['discarded'] })); window.deferAuthor = false; });
        await page.waitForFunction(() => !document.querySelector('[data-author-send]').disabled);
        assert.equal(await page.locator('[data-author-version]').innerText(), 'v1');
        assert.equal(await page.locator('.stsm-author-turn').count(), 4);
        await page.locator('[data-author-input]').fill('');
        await page.screenshot({ path: fileURLToPath(new URL(`author-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        assert.equal(await page.locator('[data-string-value]').first().inputValue(), '', 'closing author must not modify manual inputs');
        await page.locator('[data-manual-author]').click();
        assert.equal(await page.locator('[data-author-version]').innerText(), 'v1');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.locator('[data-string-value]').first().inputValue(), '옛 수동 요약을 구조화한 내용');
        assert.equal(await page.locator('[data-manual-atlas-count]').innerText(), '1');
        assert.equal(await page.evaluate(() => window.savedRecord), undefined, 'applying author draft does not save a record');
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        await page.evaluate(() => window.openManual());
        await page.locator('[data-string-value]').first().fill('A가 B에게 꽃처럼 부드러운 말을 하겠다고 약속하고, 과거의 오해를 풀며 서로의 감정을 확인했다. '.repeat(4));
        const beforeToggle = await page.locator('[data-manual-position]').evaluate(element => element.getBoundingClientRect().top + scrollY);
        assert.equal(await page.locator('[data-manual-start]').isDisabled(), true);
        await page.locator('[data-manual-range]').check();
        const afterToggle = await page.locator('[data-manual-position]').evaluate(element => element.getBoundingClientRect().top + scrollY);
        assert.equal(beforeToggle, afterToggle, 'range toggle must not shift layout');
        await page.locator('[data-manual-last-range]').click();
        assert.equal(await page.locator('[data-manual-start]').inputValue(), '20');
        assert.equal(await page.locator('[data-manual-end]').inputValue(), '39');
        assert.equal(await page.locator('[data-manual-compression]').isChecked(), true);
        await page.locator('[data-manual-start]').fill('100');
        await page.locator('[data-manual-end]').fill('119');
        await page.locator('[data-manual-coverage]').check();
        await page.locator('[data-manual-author]').click();
        await page.locator('.stsm-author-options > summary').click();
        await page.locator('[data-author-source]').check();
        await page.locator('[data-author-output]').fill('2233');
        await page.locator('[data-author-input]').fill('원본과 비교해줘');
        await page.locator('[data-author-send]').click();
        await page.waitForFunction(() => document.querySelector('[data-author-history]')?.textContent.includes('대사는 보존'));
        assert.equal(await page.evaluate(() => window.lastSourceCount), 20);
        assert.equal(await page.evaluate(() => window.authorOutput), 2233);
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        await page.locator('[data-manual-atlas-manage]').click();
        const addButton = await page.locator('[data-atlas-add]').boundingBox();
        assert.ok(addButton.width >= 76 && addButton.height <= 40, 'atlas write button must stay horizontal under narrow host button styles');
        await page.locator('[data-atlas-add]').click();
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.locator('[data-manual-field="name"] input').isVisible(), true, 'invalid atlas draft must stay open');
        await page.locator('[data-manual-field="name"] input').fill('아주 긴 이름을 가진 여행자');
        await page.locator('[data-manual-field="appearance"] input').fill('오래전부터 함께 여행하며 서로의 마음을 이해하게 된 인물');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.locator('[data-atlas-preview]').waitFor({ state: 'visible' });
        assert.match(await page.locator('[data-atlas-preview]').innerText(), /아주 긴 이름을 가진 여행자/);
        assert.match(await page.locator('[data-atlas-preview]').innerText(), /최종 도감/);
        await page.locator('[data-atlas-kind]').selectOption('updated');
        await page.locator('[data-atlas-target]').selectOption('existing-person');
        await page.locator('[data-atlas-add]').click();
        await page.locator('[data-manual-field="role"] input').fill('새로운 역할');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.waitForFunction(() => document.querySelectorAll('[data-atlas-entry]')[1]?.textContent.includes('새로운 역할'));
        assert.match(await page.locator('[data-atlas-entry]').nth(1).innerText(), /새로운 역할/);
        await page.screenshot({ path: fileURLToPath(new URL(`atlas-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.locator('[data-manual-tags]').fill('약속, 여행자, 관계 변화');
        await page.locator('[data-editor-add="emotion-group"]').click();
        await page.locator('[data-emotion-subject]').fill('아주 긴 이름을 가진 여행자');
        await page.locator('[data-editor-add="emotion-state"]').click();
        await page.locator('[data-emotion-name]').fill('안도감');
        await page.locator('[data-emotion-reason]').fill('오랜 시간 쌓인 오해가 풀리고 서로를 배려하려는 마음을 확인했기 때문이다. '.repeat(3));
        for (let index = 0; index < 3; index += 1) {
            await page.locator('[data-editor-add="quote"]').click();
            await page.locator('[data-quote-speaker]').nth(index).fill('아주 긴 이름을 가진 여행자');
            await page.locator('[data-quote-text]').nth(index).fill('꽃처럼 부드러운 말을 듣고 싶다고. 알겠다. 네가 그걸 바란다면, 기꺼이 앞으로 그러겠노라. '.repeat(2));
        }
        const overflow = await page.evaluate(() => [...document.querySelectorAll('.test-popup:not([hidden]) input,.test-popup:not([hidden]) textarea,.test-popup:not([hidden]) select,.test-popup:not([hidden]) button')]
            .filter(element => element.getClientRects().length)
            .filter(element => { const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1; })
            .map(element => element.outerHTML));
        assert.deepEqual(overflow, [], `overflow at ${width}`);
        const overlaps = await page.evaluate(() => {
            const controls = [...document.querySelectorAll('.test-popup:not([hidden]) input,.test-popup:not([hidden]) textarea,.test-popup:not([hidden]) select,.test-popup:not([hidden]) button')]
                .filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect());
            let count = 0;
            for (let a = 0; a < controls.length; a += 1) for (let b = a + 1; b < controls.length; b += 1) {
                const x = Math.min(controls[a].right, controls[b].right) - Math.max(controls[a].left, controls[b].left);
                const y = Math.min(controls[a].bottom, controls[b].bottom) - Math.max(controls[a].top, controls[b].top);
                if (x > 1 && y > 1) count += 1;
            }
            return count;
        });
        assert.equal(overlaps, 0, `overlapping controls at ${width}`);
        await page.screenshot({ path: fileURLToPath(new URL(`manual-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        const saved = await page.evaluate(() => window.savedRecord);
        assert.equal(saved.structuredSummary.version, 5);
        assert.equal(saved.manual.countsAsSummary, true);
        assert.equal(saved.structuredSummary.data.memoryUpdates.people.created[0].name, '아주 긴 이름을 가진 여행자');
        assert.equal(saved.structuredSummary.data.memoryUpdates.people.updated[0].targetId, 'existing-person');
        assert.equal(saved.structuredSummary.data.memoryUpdates.people.updated[0].replace.role, '새로운 역할');
        assert.equal(await page.evaluate(() => window.currentAtlas().people.length), 1, 'preview does not create saved atlas entries');
        assert.equal(await page.evaluate(() => window.currentAtlas().people[0].role), '여행자');
        await page.evaluate(() => window.openManual());
        await page.locator('[aria-label="메시지 범위 설명"]').click();
        assert.equal(await page.locator('[role="tooltip"]').isVisible(), true);
        assert.equal(await page.locator('[data-manual-range]').isChecked(), false, 'help does not toggle range');
        await page.locator('[aria-label="메시지 범위 설명"]').click();
        await page.locator('[data-manual-atlas-manage]').click();
        await page.locator('[data-atlas-add]').click();
        await page.locator('[data-manual-field="name"] input').fill('취소할 인물');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        assert.equal(await page.locator('[data-manual-atlas-count]').innerText(), '0');
        await page.locator('[data-string-value]').first().fill('범위 없는 보충 기억');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.evaluate(() => window.savedRecord.startId), null);
        await page.evaluate(() => window.openEdit());
        assert.equal(await page.locator('[data-manual-after]').inputValue(), '__current__');
        assert.equal(await page.locator('[data-manual-range]').isChecked(), false);
        await page.locator('[data-manual-after]').selectOption('b');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.evaluate(() => window.editedRecord.placement.afterRecordId), 'b');
        await page.evaluate(() => window.openEdit());
        await page.locator('[data-manual-range]').check();
        await page.locator('[data-manual-start]').fill('40');
        await page.locator('[data-manual-end]').fill('49');
        await page.locator('[data-manual-coverage]').check();
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.evaluate(() => window.editedRecord.placement.startId), '40');
        assert.equal(await page.evaluate(() => window.editedRecord.manual.countsAsSummary), true);
        await page.evaluate(() => window.openCompression());
        await page.locator('[data-excluded-action]').selectOption('keep');
        assert.equal(await page.locator('[data-excluded-after]').isVisible(), true);
        await page.screenshot({ path: fileURLToPath(new URL(`compression-${width}.png`, output)), fullPage: true });
        await page.locator('.test-cancel').click();
        await page.evaluate(() => window.renderToolbar());
        const buttons = await page.locator('.stsm-records-toolbar-actions > button').evaluateAll(elements => elements.map(element => {
            const rect = element.getBoundingClientRect(); return { top: rect.top, right: rect.right, width: rect.width };
        }));
        assert.equal(buttons.length, 5);
        if (width < 700) assert.equal(new Set(buttons.map(button => button.top)).size, 1, 'mobile toolbar must stay on one line');
        assert.ok(buttons.every(button => button.right <= width && button.width >= 30));
        await page.screenshot({ path: fileURLToPath(new URL(`toolbar-${width}.png`, output)), fullPage: true });
        await page.evaluate(() => { document.querySelector('#test-root').dataset.recordMemoryView = 'long-term'; });
        await page.locator('.stsm-add-record').click();
        assert.equal(await page.locator('.test-popup').count(), 0, 'long-term click must not create an active-memory form');
        assert.match(await page.evaluate(() => window.lastInfo), /아직 지원하지/);
        await page.evaluate(() => window.renderPerceptions());
        await page.locator('[data-perception-add]').click();
        await page.locator('[data-facts]').fill('상대는 웃을 때 보조개가 생긴다.\n상대는 멀리 떨어진 지역의 학교에 다녔다고 말했다.');
        await page.locator('[data-impression]').fill('무뚝뚝해 보이지만 함께 이야기하면 의외로 재미있고 배려심 깊은 사람이라고 생각한다.');
        await page.screenshot({ path: fileURLToPath(new URL(`perception-editor-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.locator('.stsm-perception-entry').count(), 1);
        assert.match(await page.locator('.stsm-perception-entry').innerText(), /보조개/);
        await page.locator('[data-perception-action="edit"]').click();
        assert.equal(await page.locator('[data-observer]').isDisabled(), true);
        await page.locator('[data-facts]').fill('수정된 인식 정보');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.match(await page.locator('.stsm-perception-entry').innerText(), /수정된 인식 정보/);
        assert.match(await page.locator('.stsm-atlas-card-meta').innerText(), /tokens/);
        await page.locator('[data-perception-action="pin"]').click();
        assert.equal(await page.locator('[data-perception-action="pin"]').getAttribute('aria-pressed'), 'true');
        await page.locator('[data-perception-action="translate"]').click();
        assert.match(await page.locator('.stsm-atlas-translation').innerText(), /번역 결과/);
        await page.locator('[data-perception-action="toggle-translation"]').click();
        assert.equal(await page.locator('.stsm-atlas-original').isVisible(), true);
        await page.locator('[data-atlas-fullscreen="perceptions"]').click();
        assert.equal(await page.locator('.stsm-atlas-fullscreen [data-perception-action="pin"]').getAttribute('aria-pressed'), 'true');
        await page.screenshot({ path: fileURLToPath(new URL(`perception-fullscreen-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.locator('[data-perception-action="visibility"]').click();
        assert.match(await page.locator('.stsm-perception-entry').innerText(), /LLM 비공개/);
        await page.locator('[data-perception-action="exclude"]').click();
        assert.equal(await page.locator('[data-perception-count]').innerText(), '0개');
        assert.equal(await page.locator('.stsm-perception-entry').isVisible(), false);
        await page.locator('.stsm-atlas-excluded > summary').click();
        await page.locator('[data-perception-action="exclude"]').click();
        assert.equal(await page.locator('[data-perception-count]').innerText(), '1개');
        const perceptionLayout = await page.locator('.stsm-perception-entry').evaluate(element => {
            const heading = element.querySelector('header > div:first-child').getBoundingClientRect();
            const actions = element.querySelector('.stsm-atlas-card-actions').getBoundingClientRect();
            return { right: element.getBoundingClientRect().right, overlaps: heading.right > actions.left && heading.bottom > actions.top, overflow: element.scrollWidth > element.clientWidth + 1 };
        });
        assert.ok(perceptionLayout.right <= width && !perceptionLayout.overlaps && !perceptionLayout.overflow);
        await page.screenshot({ path: fileURLToPath(new URL(`perceptions-${width}.png`, output)), fullPage: true });
        await page.evaluate(() => window.openPerceptionDraft());
        await page.locator('[data-atlas-category]').selectOption('perceptions');
        assert.equal(await page.locator('[data-atlas-kind]').inputValue(), 'updated');
        const perceptionId = await page.evaluate(() => window.currentAtlas().perceptions[0].id);
        await page.locator('[data-atlas-target]').selectOption(perceptionId);
        await page.locator('[data-atlas-add]').click();
        await page.locator('[data-new-facts]').fill('이 레코드에서 새롭게 들은 정보');
        await page.locator('[data-fact-id]').fill('기존 정보에 대한 정정');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.waitForFunction(() => document.querySelector('[data-atlas-preview]')?.textContent.trim());
        assert.match(await page.locator('[data-atlas-preview]').innerText(), /기존 정보에 대한 정정/);
        await page.screenshot({ path: fileURLToPath(new URL(`perception-draft-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.evaluate(() => window.perceptionDraft[0].value.factUpdates.length), 1);
        await page.evaluate(() => window.openPerceptionReview());
        assert.equal(await page.locator('.stsm-atlas-review-perception-field').isVisible(), false);
        await page.locator('.stsm-atlas-review-category').selectOption('perceptions');
        assert.equal(await page.locator('.stsm-atlas-review-perception-field').isVisible(), true);
        await page.locator('.stsm-atlas-review-category').selectOption('people');
        assert.equal(await page.locator('.stsm-atlas-review-perception-field').isVisible(), false);
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        await page.locator('[data-perception-action="visibility"]').click();
        await page.evaluate(() => window.seedReviewHistory());
        await page.locator('[data-perception-action="edit"]').click();
        await page.locator('[data-auto]').uncheck();
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.evaluate(() => window.openPerceptionReview());
        await page.locator('.stsm-atlas-review-category').selectOption('perceptions');
        await page.locator('.stsm-atlas-review-perception').selectOption(perceptionId);
        await page.locator('.stsm-atlas-review-history > summary').click();
        await page.locator('.stsm-atlas-review-history-batch > summary').click();
        await page.locator('.stsm-atlas-review-history-record > summary').click();
        const resetLayout = await page.locator('.stsm-atlas-review-history-delete').evaluate(button => {
            const text = button.querySelector('span');
            return { buttonWidth: button.clientWidth, textWidth: text.scrollWidth, height: text.getBoundingClientRect().height,
                fontSize: parseFloat(getComputedStyle(text).fontSize), overflow: button.scrollWidth > button.clientWidth + 1 };
        });
        assert.ok(resetLayout.buttonWidth >= resetLayout.textWidth && resetLayout.height < resetLayout.fontSize * 2 && !resetLayout.overflow);
        await page.screenshot({ path: fileURLToPath(new URL(`perception-review-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-cancel').click();
        let previousId = perceptionId;
        for (let cycle = 0; cycle < 2; cycle++) {
            await page.locator('[data-perception-action="exclude"]').click();
            await page.locator('.stsm-atlas-excluded > summary').click();
            await page.evaluate(() => { window.cancelConfirm = true; });
            await page.locator('[data-perception-action="delete-permanently"]').click();
            assert.equal(await page.locator('.stsm-perception-entry').count(), 1);
            await page.evaluate(() => { window.cancelConfirm = false; });
            await page.locator('[data-perception-action="delete-permanently"]').click();
            assert.equal(await page.locator('.stsm-perception-entry').count(), 0);
            assert.equal(await page.locator('.stsm-atlas-excluded').count(), 0);
            await page.locator('[data-perception-add]').click();
            await page.locator('[data-facts]').fill(`새 인식 ${cycle}`);
            await page.locator('.test-popup:not([hidden]) .test-submit').click();
            const nextId = await page.evaluate(() => window.currentAtlas().perceptions[0].id);
            assert.notEqual(nextId, previousId);
            assert.match(await page.locator('.stsm-perception-entry').innerText(), new RegExp(`새 인식 ${cycle}`));
            previousId = nextId;
        }
        assert.deepEqual(errors, []);
        await page.evaluate(() => window.renderReviewResult());
        assert.match(await page.locator('.stsm-atlas-review-result-list').innerText(), /변경 전[\s\S]*꽃을 좋아한다[\s\S]*변경 후[\s\S]*꽃과 음악/);
        assert.equal(await page.locator('.stsm-atlas-review-result script').count(), 0);
        assert.equal(await page.locator('.stsm-atlas-review-result-list pre').isVisible(), false);
        assert.equal(await page.locator('.stsm-atlas-review-step-changes pre').isVisible(), false);
        await page.locator('.stsm-atlas-review-stored-update > summary').click();
        assert.match(await page.locator('.stsm-atlas-review-draft-entries').innerText(), /새로운 정보/);
        assert.equal(await page.locator('.stsm-atlas-review-draft-entries pre').isVisible(), false);
        assert.equal(await page.locator('.stsm-atlas-review-result').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        await page.screenshot({ path: fileURLToPath(new URL(`review-result-${width}.png`, output)), fullPage: true });
        await page.evaluate(() => window.renderReviewResult(true));
        assert.equal(await page.locator('.stsm-atlas-review-result-list').isVisible(), false);
        assert.equal(await page.locator('.stsm-atlas-review-result-translation').innerText(), '번역된 결과');
        assert.equal(await page.locator('.stsm-atlas-review-generated-translation').innerText(), '생성된 변경안 번역');
        assert.equal(await page.locator('.stsm-atlas-review-generated-translation').isVisible(), true);
        assert.equal(await page.locator('.stsm-atlas-review-draft-entries').isVisible(), false);
        await page.close();
        console.log(`UI checks passed: ${width}px`);
    }
} finally { await browser.close(); }
