import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const moduleName = process.argv.find(value => value.startsWith('--playwright-module='))?.split('=').slice(1).join('=') || 'playwright';
const { chromium } = await import(moduleName);
const root = new URL('../', import.meta.url);
const output = new URL('personal-notes/prompt-preset-ui/', root);
await mkdir(output, { recursive: true });
const files = ['core/utils.js', 'summary/record-placement.js', 'summary/summary-record-template.js', 'memory/people-feelings.js',
    'summary/summary-format.js', 'summary/compression-format.js', 'prompts/character-prompt-scope.js', 'core/settings.js',
    'core/settings-transfer.js', 'core/extension-state.js', 'prompts/prompt-preset-transfer.js',
    'prompts/prompt-preset-transfer-view.js', 'prompts/prompt-settings-view.js'];
const sources = {};
for (const name of files) sources[name] = await readFile(new URL(name, root), 'utf8');
const css = await readFile(new URL('style.css', root), 'utf8');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
    for (const width of [360, 390, 1000]) {
        const page = await browser.newPage({ viewport: { width, height: 850 }, acceptDownloads: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<html lang="ko"><body><main id="root"><section data-prompt-editor="summary"></section><section data-prompt-editor="revision" hidden></section><section data-prompt-editor="compression" hidden></section></main><div id="toast" role="status"></div></body></html>');
        await page.addStyleTag({ content: `
            * { box-sizing: border-box; } body { margin:0; padding:12px; background:#f6f6f7; color:#333; font:14px Arial,sans-serif; }
            :root { --SmartThemeBodyColor:#333; --SmartThemeBorderColor:#d4d4d8; --SmartThemeQuoteColor:#b64c71; }
            #root { max-width:850px; margin:auto; } [hidden] { display:none !important; }
            .text_pole { min-width:0; border:1px solid #ccc; border-radius:5px; padding:6px; font:inherit; background:white; }
            .menu_button { border:1px solid #ccc; border-radius:4px; padding:5px; background:white; cursor:pointer; color:inherit; }
            button { font:inherit; } #toast { position:fixed; bottom:8px; background:white; max-width:90%; }
            .test-overlay { position:fixed; inset:0; background:#0003; display:grid; place-items:center; padding:12px; }
            .test-dialog { width:min(540px,100%); max-height:90vh; overflow:auto; padding:16px; border:1px solid #ccc; border-radius:6px; background:#fafafa; }
            .test-footer { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
        ` });
        await page.addStyleTag({ content: css });
        await page.evaluate(({ sources, files }) => {
            const context = { extensionSettings: {}, characters: [], groupId: null };
            window.SillyTavern = { getContext: () => context };
            window.toastr = Object.fromEntries(['success', 'error', 'info', 'warning'].map(name => [name, text => { document.querySelector('#toast').textContent = text; }]));
            class Popup {
                constructor(form, type, value, options) { this.form = form; this.options = options; }
                show() {
                    const overlay = document.createElement('div');
                    overlay.className = 'test-overlay';
                    const dialog = document.createElement('div');
                    dialog.className = 'test-dialog';
                    dialog.setAttribute('role', 'dialog');
                    const footer = document.createElement('div');
                    footer.className = 'test-footer';
                    footer.innerHTML = `<button class="menu_button test-confirm">${this.options.okButton}</button><button class="menu_button test-cancel">취소</button>`;
                    dialog.append(this.form, footer); overlay.append(dialog); document.body.append(overlay);
                    return new Promise(resolve => {
                        footer.querySelector('.test-confirm').onclick = () => { overlay.remove(); resolve(1); };
                        footer.querySelector('.test-cancel').onclick = () => { overlay.remove(); resolve(0); };
                    });
                }
            }
            const scope = { Popup, POPUP_TYPE: { CONFIRM: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
                getCompressionMode: () => 'segmented', saveSettingsDebounced() {},
                saveSillyTavernSettings: async () => {
                    if (window.failSave) throw new Error('test save failed');
                    window.saved = JSON.stringify(context.extensionSettings);
                },
            };
            for (const name of files) {
                const source = sources[name];
                const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)].map(match => match[1]);
                const body = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
                Object.assign(scope, new Function(...Object.keys(scope), `${body}\nreturn {${exports.join(',')}};`)(...Object.values(scope)));
            }
            scope.createPresetFromActive('summary', '내가 직접 다듬어 둔 아주 긴 이름의 요약 프롬프트');
            scope.addPromptBlock('summary', '사용자 지시', '  원문 공백과 {{매크로}}를 그대로 보존\n두 번째 줄  ');
            scope.addPromptBlock('summary', '다른 캐릭터 전용', '화면에서 숨겨진 블록도 백업', { scope: { type: 'character', characterKey: 'other.png', characterName: '다른 캐릭터' } });
            scope.createPresetFromActive('revision', '수정 대화 맞춤 프리셋');
            scope.bindPromptSettings(document.querySelector('#root'));
            window.snapshot = () => structuredClone(scope.getSettings().summarization.prompts);
            window.backup = (type, all) => scope.createPromptPresetBackup(type, { all });
            window.applyCount = 0;
            document.querySelector('#root').addEventListener('stsm:prompt-settings-changed', () => window.applyCount++);
        }, { sources, files });
        const toolbar = page.locator('[data-prompt-editor="summary"] .stsm-preset-toolbar');
        const layout = await toolbar.evaluate(element => {
            const buttons = [...element.querySelectorAll('.stsm-preset-actions button')].map(button => {
                const rect = button.getBoundingClientRect(); return { top: rect.top, left: rect.left, right: rect.right, width: rect.width };
            });
            return { buttons, overflow: element.scrollWidth > element.clientWidth + 1, right: element.getBoundingClientRect().right };
        });
        assert.equal(layout.buttons.length, 7);
        assert.equal(new Set(layout.buttons.map(button => button.top)).size, 1);
        assert.ok(!layout.overflow && layout.right <= width);
        assert.ok(layout.buttons.every((button, index) => button.width >= 28 && (!index || button.left >= layout.buttons[index - 1].right)));
        await page.screenshot({ path: fileURLToPath(new URL(`toolbar-${width}.png`, output)) });
        const original = await page.evaluate(() => window.snapshot());
        await toolbar.locator('[data-action="export-presets"]').click();
        await page.screenshot({ path: fileURLToPath(new URL(`export-${width}.png`, output)) });
        const downloadEvent = page.waitForEvent('download');
        await page.locator('.test-confirm').click();
        const download = await downloadEvent;
        const filePath = fileURLToPath(new URL(`preset-${width}.json`, output));
        await download.saveAs(filePath);
        const single = JSON.parse(await readFile(filePath, 'utf8'));
        assert.equal(single.editors.summary.presets.length, 1);
        assert.deepEqual(single.editors.summary.presets[0], original.summary.presets.find(preset => preset.id === original.summary.activePresetId));
        const input = page.locator('[data-prompt-editor="summary"] .stsm-preset-file');
        await input.setInputFiles(filePath);
        await page.locator('.test-cancel').click();
        assert.deepEqual(await page.evaluate(() => window.snapshot()), original);
        await input.setInputFiles(filePath);
        await page.screenshot({ path: fileURLToPath(new URL(`import-${width}.png`, output)) });
        await page.locator('.test-confirm').click();
        await page.waitForFunction(() => window.applyCount === 1);
        const restored = await page.evaluate(() => window.snapshot());
        assert.equal(restored.summary.presets.length, original.summary.presets.length + 1);
        assert.ok(restored.summary.presets.at(-1).name.includes('(가져옴)'));
        assert.equal(restored.summary.activePresetId, restored.summary.presets.at(-1).id);
        assert.deepEqual(restored.summary.presets.at(-1).blocks, single.editors.summary.presets[0].blocks);
        await page.locator('[data-prompt-editor="summary"] [data-action="export-presets"]').click();
        await page.locator('input[value="all"]').check();
        const allDownloadEvent = page.waitForEvent('download');
        await page.locator('.test-confirm').click();
        const allDownload = await allDownloadEvent;
        const allPath = fileURLToPath(new URL(`all-${width}.json`, output));
        await allDownload.saveAs(allPath);
        const all = JSON.parse(await readFile(allPath, 'utf8'));
        assert.deepEqual(Object.keys(all.editors).sort(), ['compression', 'revision', 'summary']);
        await input.setInputFiles(allPath);
        assert.equal(await page.locator('[data-activate-imported]').isChecked(), false);
        await page.locator('.test-confirm').click();
        await page.waitForFunction(() => window.applyCount === 2);
        const afterAll = await page.evaluate(() => window.snapshot());
        for (const type of ['summary', 'revision', 'compression']) {
            assert.equal(afterAll[type].presets.length, restored[type].presets.length * 2);
            assert.equal(afterAll[type].activePresetId, restored[type].activePresetId);
        }
        await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
        await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('JSON 형식'));
        assert.deepEqual(await page.evaluate(() => window.snapshot()), afterAll);
        await page.evaluate(() => { window.failSave = true; });
        await input.setInputFiles(filePath);
        await page.locator('.test-confirm').click();
        await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('test save failed'));
        assert.deepEqual(await page.evaluate(() => window.snapshot()), afterAll);
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`Prompt preset UI checks passed: ${width}px`);
    }
} finally { await browser.close(); }
