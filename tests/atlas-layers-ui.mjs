import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const moduleName = process.argv.find(value => value.startsWith('--playwright-module='))?.split('=').slice(1).join('=') || 'playwright';
const { chromium } = await import(moduleName);
const root = new URL('../', import.meta.url);
const names = ['core/utils.js', 'memory/people-feelings.js', 'memory/atlas-source-record.js', 'memory/atlas-entity-id.js',
    'memory/people-memory.js', 'memory/item-memory.js', 'memory/commitment-memory.js', 'memory/event-memory.js', 'memory/world-memory.js', 'memory/perception-memory.js',
    'memory/atlas-corrections.js', 'memory/atlas-layer-order.js', 'memory/atlas-anchor-transaction.js', 'memory/atlas-layer-projection.js', 'memory/atlas-metadata.js',
    'memory/atlas-projection-service.js', 'memory/atlas-layer-service.js', 'records/record-memory-updates-view.js',
    'translation/atlas-review-translation-service.js', 'memory/atlas-layer-view.js'];
const sources = {};
for (const name of names) sources[name] = await readFile(new URL(name, root), 'utf8');
const css = await readFile(new URL('style.css', root), 'utf8');
const output = new URL('personal-notes/atlas-layers-ui/', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    for (const width of [360, 390, 1000]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<html lang="ko"><body></body></html>');
        await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;padding:10px;font:14px Arial,sans-serif;color:#333;background:#f6f6f7}:root{--SmartThemeBorderColor:#ccc;--SmartThemeQuoteColor:#ba4b72}.text_pole{font:inherit;padding:6px;border:1px solid #ccc;border-radius:4px}.menu_button{width:min-content;white-space:normal;background:white;border:1px solid #ccc;border-radius:4px;padding:5px;font:inherit}.test-popup{width:min(100%,850px);margin:auto;background:white;padding:10px;border:1px solid #ccc}button:disabled{opacity:.4}[hidden]{display:none}.test-submit{margin-top:12px}` });
        await page.addStyleTag({ content: css });
        await page.evaluate(({ sources, names }) => {
            const context = { chat: [], chatMetadata: { sumi_chat_summarizer: { records: [], atlas: {} } }, saveMetadata: async () => { if (window.failSave) throw new Error('저장 실패'); } };
            window.SillyTavern = { getContext: () => context };
            window.toastr = { error: text => { window.toast = text; }, success() {}, info() {} };
            class Popup {
                static show = { confirm: async () => !window.cancelConfirm };
                constructor(content, type, value, options) { this.content = content; this.options = options; }
                show() {
                    const previous = document.querySelector('.test-popup:not([hidden])');
                    if (previous) previous.hidden = true;
                    const host = document.createElement('section'); host.className = 'test-popup'; host.append(this.content);
                    const close = document.createElement('button'); close.className = 'test-submit'; close.textContent = this.options.okButton;
                    host.append(close); document.body.append(host);
                    return new Promise(resolve => { close.onclick = async () => {
                        if (this.options.onClosing && !await this.options.onClosing()) return;
                        host.remove(); if (previous) previous.hidden = false; resolve(1);
                    }; });
                }
            }
            let operation = null;
            const scope = { Popup, POPUP_TYPE: { TEXT: 1 }, getExtensionState: () => ({ operation }),
                beginOperation: () => { if (operation) throw new Error('busy'); operation = {}; return operation; }, endOperation: () => { operation = null; },
                assertExtensionEnabled() {}, getSettings: () => ({ translation: { targetLanguage: 'ko', provider: 'mock' } }),
                translate: async text => `번역 결과\n${text}`, getSummaryRecords: () => structuredClone(context.chatMetadata.sumi_chat_summarizer.records),
                filterLlmVisibleSummaryRecords: records => records.filter(record => !record.llmHidden),
            };
            for (const name of names) {
                const source = sources[name];
                const exports = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(match => match[1]);
                Object.assign(scope, new Function(...Object.keys(scope), source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '') + `\nreturn {${exports.join(',')}};`)(...Object.values(scope)));
            }
            const updates = text => ({ created: [], updated: [{ targetId: 'ab', append: { facts: [text] } }] });
            const records = [0, 1].map(index => ({ id: `r${index}`, type: 'summary', startId: index * 10, endId: index * 10 + 9,
                structuredSummary: { data: { memoryUpdates: { perceptions: updates(`원본 ${index}`) } } },
                atlasReviewOverrides: { perceptions: { reviewBatchId: 'batch', memoryUpdates: updates(`재검토 ${index}: 상대는 붐비는 곳을 불편해한다고 말했습니다.`) } },
            }));
            context.chatMetadata.sumi_chat_summarizer = { records, atlas: {
                manual: { perceptions: [{ id: 'ab', observerId: 'a', subjectId: 'b', appliedThroughId: 19, hasBaseline: true, facts: [], impression: null, allowAutoUpdate: true }],
                    people: [{ id: 'a', name: '이름이 길어도 잘 보여야 하는 관찰자', allowAutoUpdate: true }, { id: 'b', name: '인식의 대상 인물', allowAutoUpdate: true }] },
                reviews: [{ id: 'q', category: 'perceptions', startId: 0, endId: 19, appliedThroughId: 19, memoryUpdates: updates('일괄 검토로 새로 확인한 정보') }],
            } };
            window.openLayers = () => { void scope.openAtlasLayers(); };
            window.atlas = () => scope.getAtlasProjection();
            window.snapshot = () => scope.getAtlasLayerSnapshot('perceptions');
            window.reload = () => { context.chatMetadata = JSON.parse(JSON.stringify(context.chatMetadata)); scope.invalidateAtlasProjection(); };
            window.openLayers();
        }, { sources, names });
        assert.equal(await page.locator('[data-layer-id]').count(), 3);
        assert.equal(await page.evaluate(() => window.atlas().perceptions[0].facts.length), 0);
        await page.evaluate(() => {
            window.originalRows = [...document.querySelectorAll('[data-layer-id]')];
            window.moveAnimations = [];
            window.pauseMoveAnimations = true;
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (...args) {
                const animation = animate.apply(this, args);
                if (this.matches('.stsm-layer-row')) {
                    window.moveAnimations.push(animation);
                    if (window.pauseMoveAnimations) animation.pause();
                }
                return animation;
            };
        });
        await page.locator('[data-layer-id="manual:ab"] [data-layer-action="up"]').click();
        await page.waitForFunction(() => window.atlas().perceptions[0].facts.length === 1);
        assert.equal(await page.evaluate(() => window.originalRows.every(row => row.isConnected)), true);
        assert.equal(await page.evaluate(() => window.moveAnimations.length), 2);
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.layerAction), 'up');
        await page.evaluate(async () => {
            window.pauseMoveAnimations = false;
            window.moveAnimations.forEach(animation => animation.play());
            await Promise.all(window.moveAnimations.map(animation => animation.finished));
        });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('[data-layer-id="manual:ab"] [data-layer-action="down"]').click();
        await page.waitForFunction(() => window.atlas().perceptions[0].facts.length === 0);
        await page.locator('[data-layer-id="manual:ab"] [data-layer-action="up"]').click();
        await page.waitForFunction(() => window.atlas().perceptions[0].facts.length === 1);
        assert.equal(await page.evaluate(() => window.moveAnimations.length), 2);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => { window.moveAnimations = []; });
        const layout = await page.locator('.stsm-layer-row').evaluateAll(rows => rows.map(row => {
            const rect = row.getBoundingClientRect();
            return { right: rect.right, overflow: row.scrollWidth > row.clientWidth + 1,
                buttons: [...row.querySelectorAll('button')].every(button => button.clientWidth >= 28) };
        }));
        assert.ok(layout.every(row => row.right <= width && !row.overflow && row.buttons));
        await page.screenshot({ path: fileURLToPath(new URL(`layers-${width}.png`, output)), fullPage: true });
        await page.locator('[data-layer-id="quick:q"] [data-layer-action="detail"]').click();
        assert.match(await page.locator('[data-layer-original]').innerText(), /일괄 검토로 새로 확인한 정보/);
        await page.locator('.stsm-layer-detail [data-layer-action="translate"]').click();
        await page.waitForFunction(() => document.querySelector('[data-layer-translation]')?.textContent.includes('번역 결과'));
        await page.locator('.stsm-layer-detail [data-layer-action="toggle"]').click();
        assert.equal(await page.locator('[data-layer-original]').isVisible(), true);
        await page.screenshot({ path: fileURLToPath(new URL(`detail-${width}.png`, output)), fullPage: true });
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.evaluate(() => { window.failSave = true; });
        await page.locator('[data-layer-id="manual:ab"] [data-layer-action="down"]').click();
        assert.match(await page.locator('[data-layer-error]').innerText(), /저장 실패/);
        assert.equal(await page.evaluate(() => window.atlas().perceptions[0].facts.length), 1);
        await page.evaluate(() => { window.failSave = false; window.cancelConfirm = true; });
        await page.locator('[data-layer-id="review:batch"] [data-layer-action="remove"]').click();
        assert.equal(await page.locator('[data-layer-id="review:batch"]').count(), 1);
        await page.evaluate(() => { window.cancelConfirm = false; });
        await page.locator('[data-layer-id="review:batch"] [data-layer-action="remove"]').click();
        assert.equal(await page.locator('[data-layer-id="review:batch"]').count(), 0);
        assert.equal(await page.locator('[data-layer-id^="record:"]').count(), 2);
        await page.locator('[data-layer-id="manual:ab"] [data-layer-action="remove"]').click();
        assert.equal(await page.locator('[data-layer-id="manual:ab"]').count(), 0);
        assert.deepEqual(await page.evaluate(() => window.atlas().perceptions[0].facts.map(fact => fact.text)), ['원본 0', '원본 1', '일괄 검토로 새로 확인한 정보']);
        if (width === 1000) {
            const target = page.locator('[data-layer-id="record:r1"]');
            const box = await target.boundingBox();
            await page.locator('[data-layer-id="record:r0"]').dragTo(target, { sourcePosition: { x: 12, y: 12 }, targetPosition: { x: 20, y: box.height - 5 } });
            await page.waitForFunction(() => window.snapshot().ordered[0].id === 'record:r1');
            assert.ok((await page.evaluate(() => window.snapshot().moves.length)) > 0);
        }
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        await page.evaluate(() => { window.reload(); window.openLayers(); });
        assert.equal(await page.locator('[data-layer-id]').count(), 3);
        await page.locator('.test-popup:not([hidden]) .test-submit').click();
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`Atlas layer UI checks passed: ${width}px`);
    }
} finally { await browser.close(); }
