import { getSettingsSnapshot, replaceSettingsFromBackup } from './settings.js';

const BACKUP_FORMAT = 'sumi-extension-settings-backup';
const BACKUP_VERSION = 1;

export function downloadGlobalSettingsBackup() {
    const backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: getSettingsSnapshot(),
    };
    downloadJson(backup, `sumi-extension-settings-${formatFileTimestamp(new Date())}.json`);
    return backup;
}

export async function readGlobalSettingsBackup(file) {
    const parsed = await readJsonFile(file);
    if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT) {
        throw new Error('Sumi 확장 전역 설정 백업 파일이 아닙니다.');
    }
    if (parsed.version !== BACKUP_VERSION) {
        throw new Error(`지원하지 않는 전역 설정 백업 버전입니다. (버전 ${String(parsed.version ?? '없음')})`);
    }
    if (!isPlainObject(parsed.data)) {
        throw new Error('백업 파일에 유효한 확장 전역 설정이 없습니다.');
    }
    return structuredClone(parsed.data);
}

export async function importGlobalSettingsBackup(data) {
    await replaceSettingsFromBackup(data, { preserveEnabled: true });
}

function downloadJson(value, fileName) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readJsonFile(file) {
    if (!file || typeof file.text !== 'function') throw new Error('가져올 JSON 파일을 선택해주세요.');
    try {
        return JSON.parse(await file.text());
    } catch {
        throw new Error('백업 파일이 올바른 JSON 형식이 아닙니다.');
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatFileTimestamp(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}
