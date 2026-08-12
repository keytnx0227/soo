import { generateSummary } from '../connection/generation.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import { buildCompressionPrompt } from '../prompts/prompt-builder.js';
import {
    INTEGRATED_COMPRESSION_FORMAT_VERSION,
    SEGMENTED_COMPRESSION_FORMAT_VERSION,
    parseCompressionResponse,
    renderCompressionSummary,
} from './compression-format.js';
import {
    addCompressedSummaryRecord,
    COMPRESSION_MODES,
    getCompressionMode,
    getActiveSummaryRecords,
    getSummaryRecord,
    getSummaryRecordsByIds,
    updateSummaryRecordContent,
} from './summary-store.js';

export function getCompressionCandidates() {
    return getActiveSummaryRecords()
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);
}

export function selectCompressionSources(startRecordId, count) {
    const normalizedCount = Number(count);
    if (!Number.isInteger(normalizedCount) || normalizedCount < 2) {
        throw new Error('압축할 요약 레코드 수는 2개 이상이어야 합니다.');
    }
    const candidates = getCompressionCandidates();
    const startIndex = candidates.findIndex(record => record.id === String(startRecordId));
    if (startIndex < 0) throw new Error('압축을 시작할 활성 요약 레코드를 찾지 못했습니다.');
    const sources = candidates.slice(startIndex, startIndex + normalizedCount);
    if (sources.length !== normalizedCount) throw new Error('선택한 시작점 이후에 압축할 요약 레코드가 부족합니다.');
    assertContiguousSources(sources);
    return sources;
}

export function createCompressionBatchPlan(startRecordId, count, repeatCount) {
    const normalizedCount = Number(count);
    const normalizedRepeatCount = Number(repeatCount);
    if (!Number.isInteger(normalizedCount) || normalizedCount < 2) {
        throw new Error('압축할 요약 레코드 수는 2개 이상이어야 합니다.');
    }
    if (!Number.isInteger(normalizedRepeatCount) || normalizedRepeatCount < 1) {
        throw new Error('압축 반복 횟수는 1회 이상이어야 합니다.');
    }

    const candidates = getCompressionCandidates();
    const startIndex = candidates.findIndex(record => record.id === String(startRecordId));
    if (startIndex < 0) throw new Error('압축을 시작할 활성 요약 레코드를 찾지 못했습니다.');

    const totalCount = normalizedCount * normalizedRepeatCount;
    const sources = candidates.slice(startIndex, startIndex + totalCount);
    if (sources.length !== totalCount) {
        const possibleRepeats = Math.floor(sources.length / normalizedCount);
        throw new Error(`선택한 시작점에서는 ${normalizedCount}개씩 최대 ${possibleRepeats}회 압축할 수 있습니다.`);
    }
    assertContiguousSources(sources);

    return {
        batches: Array.from({ length: normalizedRepeatCount }, (_, index) => (
            sources.slice(index * normalizedCount, (index + 1) * normalizedCount)
        )),
        sources,
        nextRecord: candidates[startIndex + totalCount] || null,
    };
}

export async function compressSummaryRecords({ startRecordId, count, notifyChanges = true }) {
    assertExtensionEnabled();
    const sources = selectCompressionSources(startRecordId, count);
    const snapshot = createSourceSnapshot(sources);
    const { outputLanguage, compressionContentTemplate, compressionOutputSections } = getSettings().summarization;
    const mode = getCompressionMode();
    const segmented = mode === COMPRESSION_MODES.SEGMENTED;
    const prompt = buildCompressionPrompt(sources, outputLanguage, mode);
    if (!prompt.trim()) throw new Error('조립된 압축 요약 프롬프트가 비어 있습니다.');

    const response = await generateSummary(prompt);
    if (!response) throw new Error('압축 요약 응답이 비어 있습니다.');
    assertSourcesUnchanged(snapshot);
    const data = parseCompressionResponse(response, { segmented, sourceRecords: sources });
    const content = renderCompressionSummary(data, {
        startId: sources[0].startId,
        endId: sources.at(-1).endId,
        template: compressionContentTemplate,
        outputSections: compressionOutputSections,
    });
    return addCompressedSummaryRecord({
        sourceRecordIds: sources.map(record => record.id),
        content,
        compressionData: {
            formatVersion: segmented ? SEGMENTED_COMPRESSION_FORMAT_VERSION : INTEGRATED_COMPRESSION_FORMAT_VERSION,
            ...data,
        },
        languageMode: outputLanguage,
        mode,
        notifyChanges,
    });
}

export async function regenerateCompressedSummary(recordId) {
    assertExtensionEnabled();
    const record = getSummaryRecord(recordId);
    if (!record?.compression) throw new Error('재생성할 압축 요약 기록을 찾지 못했습니다.');
    const sources = getSummaryRecordsByIds(record.compression.sourceRecordIds);
    if (sources.some(source => !source)) throw new Error('압축 요약의 원본 레코드 일부를 찾지 못했습니다.');
    const snapshot = createSourceSnapshot(sources);
    const mode = getCompressionMode();
    const segmented = mode === COMPRESSION_MODES.SEGMENTED;
    const { outputLanguage, compressionContentTemplate, compressionOutputSections } = getSettings().summarization;
    const prompt = buildCompressionPrompt(sources, outputLanguage, mode);
    if (!prompt.trim()) throw new Error('조립된 압축 재생성 프롬프트가 비어 있습니다.');

    const response = await generateSummary(prompt);
    if (!response) throw new Error('재생성된 압축 요약 응답이 비어 있습니다.');
    assertSourcesUnchanged(snapshot, record.id);
    const data = parseCompressionResponse(response, { segmented, sourceRecords: sources });
    const content = renderCompressionSummary(data, {
        startId: record.startId,
        endId: record.endId,
        template: compressionContentTemplate,
        outputSections: compressionOutputSections,
    });
    const updated = await updateSummaryRecordContent(record.id, content, {
        contentEdited: false,
        compressionData: {
            formatVersion: segmented ? SEGMENTED_COMPRESSION_FORMAT_VERSION : INTEGRATED_COMPRESSION_FORMAT_VERSION,
            ...data,
        },
    });
    if (!updated) throw new Error('압축 재생성 결과를 저장할 기록을 찾지 못했습니다.');
    return updated;
}

function assertContiguousSources(sources) {
    for (let index = 1; index < sources.length; index += 1) {
        const previous = sources[index - 1];
        const current = sources[index];
        if (current.startId !== previous.endId + 1) {
            throw new Error(`#${previous.startId} ~ #${previous.endId}와 #${current.startId} ~ #${current.endId} 사이가 이어지지 않습니다.`);
        }
    }
}

function createSourceSnapshot(sources) {
    return sources.map(record => ({
        id: record.id,
        contentHash: record.contentHash,
        compressedBy: record.compressedBy,
    }));
}

function assertSourcesUnchanged(snapshot, expectedParentId = null) {
    const currentRecords = getSummaryRecordsByIds(snapshot.map(record => record.id));
    for (let index = 0; index < snapshot.length; index += 1) {
        const expected = snapshot[index];
        const current = currentRecords[index];
        if (!current || current.contentHash !== expected.contentHash) {
            throw new Error('압축 요청 중 원본 요약이 변경되어 결과를 저장하지 않았습니다.');
        }
        if (expectedParentId === null && current.compressedBy) {
            throw new Error('압축 요청 중 원본 요약의 활성 상태가 변경되어 결과를 저장하지 않았습니다.');
        }
        if (expectedParentId !== null && current.compressedBy !== expectedParentId) {
            throw new Error('압축 재생성 중 원본 연결 상태가 변경되어 결과를 저장하지 않았습니다.');
        }
    }
}
