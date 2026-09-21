import { generateSummary } from '../connection/generation.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';
import { buildCompressionPrompt } from '../prompts/prompt-builder.js';
import { compareRecordPosition, hasMessageRange, isCompressionIncluded } from './record-placement.js';
import { attachCompressionReferences, getCompressionInputSources } from './compression-references.js';
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
    getSummaryRecord,
    getSummaryRecordIndex,
    getSummaryRecordsByIds,
    updateSummaryRecordContent,
} from './summary-store.js';

export function getCompressionCandidates() {
    return getSummaryRecordIndex()
        .filter(record => !record.compressedBy && !record.llmHidden)
        .sort(compareRecordPosition);
}

export function selectCompressionSources(startRecordId, count) {
    const normalizedCount = Number(count);
    if (!Number.isInteger(normalizedCount) || normalizedCount < 2) {
        throw new Error('압축할 요약 레코드 수는 2개 이상이어야 합니다.');
    }
    const candidates = getCompressionCandidates();
    const startIndex = candidates.findIndex(record => record.id === String(startRecordId));
    if (startIndex < 0) throw new Error('압축을 시작할 활성 요약 레코드를 찾지 못했습니다.');
    const sourceIndexes = candidates.slice(startIndex, startIndex + normalizedCount);
    if (sourceIndexes.length !== normalizedCount) throw new Error('선택한 시작점 이후에 압축할 요약 레코드가 부족합니다.');
    assertContiguousSources(sourceIndexes);
    const sources = getSummaryRecordsByIds(sourceIndexes.map(record => record.id));
    if (sources.some(source => !source)) throw new Error('압축할 원본 요약 레코드 일부를 찾지 못했습니다.');
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

export async function compressSummaryRecords({ startRecordId, count, sourceRecordIds, excludedActions = {}, notifyChanges = true }) {
    assertExtensionEnabled();
    const selected = sourceRecordIds ? getSummaryRecordsByIds(sourceRecordIds) : selectCompressionSources(startRecordId, count);
    if (!selected.length || selected.some(source => !source || source.compressedBy || source.llmHidden)) {
        throw new Error('선택한 레코드의 상태가 변경되었습니다. 압축 범위를 다시 선택해주세요.');
    }
    assertContiguousSources(selected);
    const snapshot = createSourceSnapshot(selected);
    const retained = selected.filter(source => !isCompressionIncluded(source) && excludedActions[source.id]?.action === 'keep');
    const sources = selected.filter(source => !retained.includes(source));
    const inputSources = sources.filter(isCompressionIncluded);
    if (!inputSources.length) throw new Error('압축에 포함할 레코드가 없습니다. 압축 포함 설정을 확인해주세요.');
    const excludedIds = sources.filter(source => !isCompressionIncluded(source)).map(source => source.id);
    const { outputLanguage, compressionContentTemplate, compressionOutputSections } = getSettings().summarization;
    const mode = getCompressionMode();
    const segmented = mode === COMPRESSION_MODES.SEGMENTED;
    const prompt = buildCompressionPrompt(inputSources, outputLanguage, mode);
    if (!prompt.trim()) throw new Error('조립된 압축 요약 프롬프트가 비어 있습니다.');

    const response = await generateSummary(prompt);
    if (!response) throw new Error('압축 요약 응답이 비어 있습니다.');
    assertSourcesUnchanged(snapshot);
    const data = attachCompressionReferences(
        parseCompressionResponse(response, { segmented, sourceRecords: inputSources }), sources, excludedIds, segmented,
    );
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
        retainedPlacements: retained.map(source => ({ id: source.id, afterRecordId: excludedActions[source.id]?.afterRecordId })),
    });
}

export async function regenerateCompressedSummary(recordId) {
    assertExtensionEnabled();
    const record = getSummaryRecord(recordId);
    if (!record?.compression) throw new Error('재생성할 압축 요약 기록을 찾지 못했습니다.');
    if (record.llmHidden) throw new Error('LLM에서 감춘 압축 요약은 재생성할 수 없습니다.');
    const sources = getSummaryRecordsByIds(record.compression.sourceRecordIds);
    if (sources.some(source => !source)) throw new Error('압축 요약의 원본 레코드 일부를 찾지 못했습니다.');
    if (sources.some(source => source.llmHidden)) {
        throw new Error('LLM에서 감춘 원본 레코드가 포함되어 압축 요약을 재생성할 수 없습니다.');
    }
    const snapshot = createSourceSnapshot(sources);
    const inputSources = getCompressionInputSources(sources, record.compression.data);
    if (!inputSources.length) throw new Error('재생성할 압축 입력이 없습니다.');
    const mode = getCompressionMode();
    const segmented = mode === COMPRESSION_MODES.SEGMENTED;
    const { outputLanguage, compressionContentTemplate, compressionOutputSections } = getSettings().summarization;
    const prompt = buildCompressionPrompt(inputSources, outputLanguage, mode);
    if (!prompt.trim()) throw new Error('조립된 압축 재생성 프롬프트가 비어 있습니다.');

    const response = await generateSummary(prompt);
    if (!response) throw new Error('재생성된 압축 요약 응답이 비어 있습니다.');
    assertSourcesUnchanged(snapshot, record.id);
    if (getSummaryRecord(recordId)?.llmHidden) {
        throw new Error('압축 재생성 중 대상 기록이 LLM 비공개로 변경되어 결과를 저장하지 않았습니다.');
    }
    const data = attachCompressionReferences(
        parseCompressionResponse(response, { segmented, sourceRecords: inputSources }),
        sources, record.compression.data.excludedSourceIds, segmented,
    );
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
    sources = sources.filter(source => hasMessageRange(source) && (!source.manual || source.manual.countsAsSummary));
    for (let index = 1; index < sources.length; index += 1) {
        const previous = sources[index - 1];
        const current = sources[index];
        if (current.startId !== previous.endId + 1) {
            throw new Error(`#${previous.startId} ~ #${previous.endId}와 #${current.startId} ~ #${current.endId} 사이가 이어지지 않습니다.`);
        }
    }
}

function createSourceSnapshot(sources) {
    const snapshot = sources.map(record => ({
        id: record.id,
        contentHash: record.contentHash,
        compressedBy: record.compressedBy,
        llmHidden: record.llmHidden,
        manual: JSON.stringify(record.manual),
        position: record.position,
    }));
    snapshot.chatMetadata = SillyTavern.getContext().chatMetadata;
    snapshot.mode = getCompressionMode();
    return snapshot;
}

function assertSourcesUnchanged(snapshot, expectedParentId = null) {
    if (snapshot.chatMetadata !== SillyTavern.getContext().chatMetadata || snapshot.mode !== getCompressionMode()) {
        throw new Error('압축 요청 중 채팅 또는 압축 모드가 변경되어 결과를 저장하지 않았습니다.');
    }
    const currentRecords = getSummaryRecordsByIds(snapshot.map(record => record.id));
    for (let index = 0; index < snapshot.length; index += 1) {
        const expected = snapshot[index];
        const current = currentRecords[index];
        if (!current || current.contentHash !== expected.contentHash
            || JSON.stringify(current.manual) !== expected.manual || current.position !== expected.position) {
            throw new Error('압축 요청 중 원본 요약이 변경되어 결과를 저장하지 않았습니다.');
        }
        if (current.llmHidden !== expected.llmHidden || current.llmHidden) {
            throw new Error('압축 요청 중 원본 요약의 LLM 공개 상태가 변경되어 결과를 저장하지 않았습니다.');
        }
        if (expectedParentId === null && current.compressedBy) {
            throw new Error('압축 요청 중 원본 요약의 활성 상태가 변경되어 결과를 저장하지 않았습니다.');
        }
        if (expectedParentId !== null && current.compressedBy !== expectedParentId) {
            throw new Error('압축 재생성 중 원본 연결 상태가 변경되어 결과를 저장하지 않았습니다.');
        }
    }
}
