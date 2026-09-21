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
]) sources[name] = await readFile(new URL(name, root), 'utf8');
const css = await readFile(new URL('style.css', root), 'utf8');
const output = new URL('personal-notes/manual-record-ui/', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    for (const width of [360, 390, 1000]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<html lang="ko"><body><main id="test-root"></main></body></html>');
        await page.addStyleTag({ content: `
            * { box-sizing: border-box; } body { margin: 0; padding: 12px; font: 14px Arial, sans-serif; color: #333; background: #f6f6f7; }
            :root { --SmartThemeBodyColor:#333; --SmartThemeBorderColor:#d4d4d8; --SmartThemeQuoteColor:#bf4670; }
            .text_pole { border:1px solid #ccc; border-radius:5px; background:white; color:inherit; padding:6px; font:inherit; }
            .menu_button { border:1px solid #ccc; border-radius:4px; background:white; padding:5px; color:inherit; cursor:pointer; }
            .test-popup { width: min(100%, 780px); margin: 0 auto; padding: 10px; background: #fafafa; border: 1px solid #ccc; }
            button { font:inherit; } textarea { resize:vertical; } [hidden] { display:none !important; }
        ` });
        await page.addStyleTag({ content: css });
        await page.evaluate(({ sources }) => {
            const load = (name, exports, scope = {}) => new Function(...Object.keys(scope),
                sources[name].replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '')
                + `\nreturn {${exports.join(',')}};`)(...Object.values(scope));
            const scope = { ...load('core/utils.js', ['escapeHtml']), ...load('summary/record-placement.js', ['hasMessageRange', 'recordRangeLabel', 'recordSelectionLabel', 'recordPosition', 'compareRecordPosition', 'rangeAwareTemplate']) };
            Object.assign(scope, load('memory/people-feelings.js', ['normalizeFeelings']));
            Object.assign(scope, load('summary/summary-record-template.js', ['DEFAULT_SUMMARY_CONTENT_TEMPLATE', 'renderSummaryContentTemplate'], scope));
            Object.assign(scope, load('summary/summary-format.js', ['SUMMARY_FORMAT_VERSION', 'SUMMARY_SECTION_DESCRIPTIONS', 'DEFAULT_SUMMARY_SECTIONS', 'DEFAULT_MEMORY_SECTIONS', 'normalizeStructuredSummaryData', 'renderStructuredSummary'], scope));
            Object.assign(scope, load('records/structured-editor-order.js', ['moveEditorItem', 'refreshEditorOrderControls']));
            Object.assign(scope, load('memory/people-feelings-view.js', ['handleFeelingEditorClick', 'readFeelingEditor', 'renderFeelingEditor'], scope));
            const context = { chat: Array.from({ length: 200 }, () => ({})), chatMetadata: {} };
            const settings = { summarization: { outputLanguage: 'source', compressionGroupSize: 3 } };
            const records = [{ id: 'a', startId: 0, endId: 19 }, { id: 'x', startId: null, endId: null, position: 19.5, manual: { includeInCompression: false } }, { id: 'b', startId: 20, endId: 39 }];
            window.toastr = { error: value => { window.lastError = value; }, info() {}, success() {} };
            window.SillyTavern = { getContext: () => context };
            class Popup {
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
                getAtlasProjection: () => ({ frontierId: 39 }),
                addSummaryRecord: async record => { window.savedRecord = record; return record; },
                validateSummaryRange: (start, end) => {
                    if (!start.trim() || !end.trim() || +start > +end || +end >= context.chat.length) throw new Error('invalid range');
                    return { start: +start, end: +end };
                },
            });
            Object.assign(scope, load('memory/atlas-manual-editor.js', ['showManualAtlasEntryEditor'], scope));
            Object.assign(scope, load('records/structured-summary-editor.js', ['renderEditor', 'bindEditorActions', 'collectEditorData'], scope));
            const manual = load('records/manual-record-view.js', ['openManualRecordEditor'], scope);
            window.openManual = () => { void manual.openManualRecordEditor(); };
            const popupTemplate = load('ui/popup-template.js', ['buildPopup'], scope);
            window.renderToolbar = () => {
                const popup = popupTemplate.buildPopup();
                document.querySelector('#test-root').replaceChildren(popup.querySelector('.stsm-records-toolbar'));
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
        }, { sources });
        await page.locator('[data-string-value]').first().fill('A가 B에게 꽃처럼 부드러운 말을 하겠다고 약속하고, 과거의 오해를 풀며 서로의 감정을 확인했다. '.repeat(4));
        await page.locator('[data-manual-range]').check();
        assert.equal(await page.locator('[data-manual-compression]').isChecked(), true);
        await page.locator('[data-manual-start]').fill('100');
        await page.locator('[data-manual-end]').fill('119');
        await page.locator('[data-manual-coverage]').check();
        await page.locator('[data-manual-atlas-add]').click();
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.locator('[data-manual-field="name"] input').isVisible(), true, 'invalid atlas draft must stay open');
        await page.locator('[data-manual-field="name"] input').fill('아주 긴 이름을 가진 여행자');
        await page.locator('[data-manual-field="appearance"] input').fill('오래전부터 함께 여행하며 서로의 마음을 이해하게 된 인물');
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
        await page.evaluate(() => window.openManual());
        await page.locator('[data-string-value]').first().fill('범위 없는 보충 기억');
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.equal(await page.evaluate(() => window.savedRecord.startId), null);
        await page.evaluate(() => window.openCompression());
        await page.locator('[data-excluded-action]').selectOption('keep');
        assert.equal(await page.locator('[data-excluded-after]').isVisible(), true);
        await page.screenshot({ path: fileURLToPath(new URL(`compression-${width}.png`, output)), fullPage: true });
        await page.locator('.test-cancel').click();
        await page.evaluate(() => window.renderToolbar());
        const buttons = await page.locator('.stsm-records-toolbar-actions > button').evaluateAll(elements => elements.map(element => {
            const rect = element.getBoundingClientRect(); return { top: rect.top, right: rect.right, width: rect.width };
        }));
        assert.equal(buttons.length, 6);
        if (width < 700) assert.equal(new Set(buttons.map(button => button.top)).size, 1, 'mobile toolbar must stay on one line');
        assert.ok(buttons.every(button => button.right <= width && button.width >= 30));
        await page.screenshot({ path: fileURLToPath(new URL(`toolbar-${width}.png`, output)), fullPage: true });
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`UI checks passed: ${width}px`);
    }
} finally { await browser.close(); }
