import { addImportedPromptPresets, BLOCK_KINDS, getPromptEditor, PROMPT_TYPES } from '../core/settings.js';
import { downloadJson } from '../core/settings-transfer.js';

const FORMAT = 'sumi-prompt-presets';
const VERSION = 1;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function createPromptPresetBackup(type, { all = false } = {}) {
    if (!Object.values(PROMPT_TYPES).includes(type)) throw new Error('지원하지 않는 프롬프트 종류입니다.');
    const types = all ? Object.values(PROMPT_TYPES) : [type];
    return {
        format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
        editors: Object.fromEntries(types.map(key => {
            const editor = getPromptEditor(key);
            const presets = all ? editor.presets : editor.presets.filter(preset => preset.id === editor.activePresetId);
            return [key, { schemaVersion: editor.schemaVersion, activePresetId: editor.activePresetId, presets: structuredClone(presets) }];
        })),
    };
}

export function downloadPromptPresetBackup(backup) {
    validatePromptPresetBackup(backup);
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(backup, `sumi-prompt-presets-${date}.json`);
}

export async function readPromptPresetBackup(file) {
    if (!file || typeof file.text !== 'function') throw new Error('가져올 프리셋 JSON 파일을 선택해주세요.');
    if (file.size > MAX_FILE_BYTES) throw new Error('프리셋 파일은 10MB 이하로 선택해주세요.');
    let data;
    try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('프리셋 파일이 올바른 JSON 형식이 아닙니다.'); }
    return validatePromptPresetBackup(data);
}

export async function importPromptPresetBackup(backup, options) {
    const validated = validatePromptPresetBackup(backup);
    return await addImportedPromptPresets(validated.editors, options);
}

export function validatePromptPresetBackup(value) {
    if (!isObject(value) || value.format !== FORMAT) throw new Error('Sumi 프롬프트 프리셋 파일이 아닙니다.');
    if (value.version !== VERSION) throw new Error('지원하지 않는 프리셋 파일 버전입니다. 확장을 업데이트해주세요.');
    if (!isObject(value.editors) || !Object.keys(value.editors).length) throw new Error('파일에 프리셋이 없습니다.');
    const knownKinds = new Set(Object.values(BLOCK_KINDS));
    for (const [type, editor] of Object.entries(value.editors)) {
        if (!Object.values(PROMPT_TYPES).includes(type)) throw new Error('지원하지 않는 프롬프트 종류가 포함되어 있습니다.');
        if (!isObject(editor) || !Number.isInteger(editor.schemaVersion) || editor.schemaVersion < 1
            || editor.schemaVersion > getPromptEditor(type).schemaVersion) throw new Error('프롬프트 형식 버전을 확인해주세요. 더 최신 버전의 확장이 필요할 수 있습니다.');
        if (!Array.isArray(editor.presets) || !editor.presets.length) throw new Error('파일에 프리셋이 없습니다.');
        const ids = new Set();
        for (const preset of editor.presets) {
            if (!isObject(preset) || !isText(preset.id) || ids.has(preset.id) || !isText(preset.name) || !Array.isArray(preset.blocks)) {
                throw new Error('프리셋 이름, ID 또는 블록 목록이 올바르지 않습니다.');
            }
            ids.add(preset.id);
            const blockIds = new Set();
            for (const block of preset.blocks) {
                if (!isObject(block) || !isText(block.id) || blockIds.has(block.id) || !isText(block.name)
                    || typeof block.content !== 'string' || !knownKinds.has(block.kind)
                    || ['enabled', 'locked', 'separator'].some(key => typeof block[key] !== 'boolean')
                    || !isObject(block.config) || !isObject(block.scope)) throw new Error('지원하지 않거나 올바르지 않은 프롬프트 블록이 있습니다.');
                blockIds.add(block.id);
                if (!['global', 'character'].includes(block.scope.type)
                    || (block.scope.type === 'character' && (!isText(block.scope.characterKey) || !isText(block.scope.characterName)))) {
                    throw new Error('캐릭터 전용 프롬프트 범위가 올바르지 않습니다.');
                }
                if (block.kind === BLOCK_KINDS.SUMMARY_EXTRACTION_RULES
                    && (!isObject(block.config.rules) || Object.values(block.config.rules).some(rule => !isText(rule)))) {
                    throw new Error('요약 추출 규칙이 올바르지 않습니다.');
                }
            }
        }
        if (!ids.has(editor.activePresetId)) throw new Error('파일의 선택된 프리셋 ID가 목록에 없습니다.');
    }
    return structuredClone(value);
}

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isText(value) { return typeof value === 'string' && Boolean(value.trim()); }
