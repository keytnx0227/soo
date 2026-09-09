import { createSummaryChunks } from './chunking.js';
import { generateSummary } from '../connection/generation.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { buildSummaryPrompt, getSummaryOutputConfiguration } from '../prompts/prompt-builder.js';
import { findOverlappingRanges, formatRanges, getUncoveredRanges } from './range-utils.js';
import { getSettings } from '../core/settings.js';
import { createSourceFingerprint } from './source-tracking.js';
import { createId } from '../core/utils.js';
import {
    parseStructuredSummaryResponse,
    renderStructuredSummary,
    SUMMARY_FORMAT_VERSION,
} from './summary-format.js';
import {
    addSummaryRecord,
    getSummaryRecord,
    getSummaryRecordIndex,
    updateSummaryRecordContent,
} from './summary-store.js';
import { regenerateCompressedSummary } from './compression-service.js';

export function validateSummaryRange(startId, endId) {
    const chat = SillyTavern.getContext().chat;
    if (!Array.isArray(chat) || !chat.length) {
        throw new Error('요약할 채팅 내역이 없습니다.');
    }

    const startValue = String(startId ?? '').trim();
    const endValue = String(endId ?? '').trim();
    if (!startValue || !endValue) {
        throw new Error('요약 시작과 종료 채팅 ID를 모두 입력해주세요.');
    }

    const start = Number(startValue);
    const end = Number(endValue);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error('요약 시작과 종료 채팅 ID를 모두 입력해주세요.');
    }
    if (start < 0 || end < 0 || start > end) {
        throw new Error('요약 범위를 올바르게 입력해주세요.');
    }
    if (end >= chat.length) {
        throw new Error(`종료 ID는 현재 마지막 채팅 ID(#${chat.length - 1})보다 클 수 없습니다.`);
    }

    return { start, end, chat };
}

export async function summarizeRange({ startId, endId, onProgress, onRecord, signal }) {
    assertExtensionEnabled();
    const { start, end, chat } = validateSummaryRange(startId, endId);
    validateUncoveredRange(start, end);
    const chunkSize = getSettings().summarization.chunkSize;
    const chunks = createSummaryChunks(chat, start, end, chunkSize);

    if (!chunks.length) {
        throw new Error('선택한 범위에 요약할 메시지가 없습니다.');
    }

    const batchId = createId('batch');
    const records = [];
    for (let index = 0; index < chunks.length; index += 1) {
        throwIfSummaryCancelled(signal, records);
        const chunk = chunks[index];
        let record;
        try {
            ensureChatUnchanged(chat);
            onProgress?.({ current: index + 1, total: chunks.length, chunk });

            const outputConfiguration = getSummaryOutputConfiguration();
            const prompt = await buildSummaryPrompt(chunk, outputConfiguration);
            throwIfSummaryCancelled(signal, records);
            if (!prompt.trim()) {
                throw new Error('조립된 요약 프롬프트가 비어 있습니다.');
            }

            const response = await generateSummary(prompt);
            throwIfSummaryCancelled(signal, records);
            ensureChatUnchanged(chat);
            if (!response) {
                throw new Error('요약 응답이 비어 있습니다.');
            }
            const structuredData = parseStructuredSummaryResponse(
                response,
                outputConfiguration.sections,
                outputConfiguration.memorySections,
            );
            const content = renderStructuredSummary(structuredData, {
                startId: chunk.startId,
                endId: chunk.endId,
                template: getSettings().summarization.summaryContentTemplate,
                outputSections: getSettings().summarization.summaryOutputSections,
            });

            record = await addSummaryRecord({
                batchId,
                startId: chunk.startId,
                endId: chunk.endId,
                content,
                sourceFingerprint: createSourceFingerprint(chunk.messages),
                structuredSummary: {
                    version: SUMMARY_FORMAT_VERSION,
                    languageMode: outputConfiguration.languageMode,
                    sections: outputConfiguration.sections,
                    memorySections: outputConfiguration.memorySections,
                    data: structuredData,
                },
            });
        } catch (error) {
            if (error?.code === 'STSM_SUMMARY_CANCELLED') throw error;
            throw createBatchInterruptionError({
                error,
                batchId,
                requestedRange: { startId: start, endId: end },
                failedChunk: chunk,
                completedRecords: records,
                unattemptedChunks: chunks.slice(index + 1),
            });
        }

        records.push(record);
        await onRecord?.(record);
        throwIfSummaryCancelled(signal, records);
    }

    return records;
}

function throwIfSummaryCancelled(signal, completedRecords) {
    if (!signal?.aborted) return;
    const error = new Error('요약 작업을 중단했어요. 완료된 청크는 유지됩니다.');
    error.code = 'STSM_SUMMARY_CANCELLED';
    error.summaryCancellation = {
        completedChunks: completedRecords.map(({ startId, endId }) => ({ startId, endId })),
    };
    throw error;
}

function createBatchInterruptionError({
    error,
    batchId,
    requestedRange,
    failedChunk,
    completedRecords,
    unattemptedChunks,
}) {
    const completedLabel = completedRecords.length ? formatChunkList(completedRecords) : '없음';
    const unattemptedLabel = unattemptedChunks.length ? formatChunkList(unattemptedChunks) : '없음';
    const reason = error instanceof Error ? error.message : String(error || '알 수 없는 오류');
    const wrappedError = new Error(
        `#${failedChunk.startId} ~ #${failedChunk.endId} 요약에 실패해 `
        + `요청 범위 #${requestedRange.startId} ~ #${requestedRange.endId} 작업을 중단했어요. `
        + `완료 청크: ${completedLabel} / 이후 미시도 청크: ${unattemptedLabel} / 원인: ${reason}`,
    );
    wrappedError.cause = error;
    wrappedError.summaryBatch = {
        batchId,
        requestedRange,
        failedChunk: {
            startId: failedChunk.startId,
            endId: failedChunk.endId,
        },
        completedChunks: completedRecords.map(({ startId, endId }) => ({ startId, endId })),
        unattemptedChunks: unattemptedChunks.map(({ startId, endId }) => ({ startId, endId })),
    };
    return wrappedError;
}

function formatChunkList(chunks) {
    return chunks.map(chunk => `#${chunk.startId} ~ #${chunk.endId}`).join(', ');
}

export async function regenerateSummaryRecord(recordId) {
    const record = getSummaryRecord(recordId);
    if (record?.type === 'compressed') return regenerateCompressedSummary(recordId);
    const draft = await createSummaryRegenerationDraft(recordId);
    return applySummaryRegenerationDraft(draft);
}

export async function createSummaryRegenerationDraft(recordId) {
    assertExtensionEnabled();
    const record = getSummaryRecord(recordId);
    if (!record) throw new Error('재생성할 요약 기록을 찾지 못했습니다.');
    if (record.llmHidden) throw new Error('LLM에서 감춘 요약 기록은 재생성할 수 없습니다.');
    if (record.type === 'compressed') throw new Error('압축 요약은 일반 요약 재생성 미리보기를 사용할 수 없습니다.');

    const { start, end, chat } = validateSummaryRange(record.startId, record.endId);
    const [chunk] = createSummaryChunks(chat, start, end, end - start + 1);
    if (!chunk) throw new Error('현재 채팅의 해당 범위에 요약할 메시지가 없습니다.');
    const baselineRecordSignature = createRegenerationRecordSignature(record);
    const sourceFingerprint = createSourceFingerprint(chunk.messages);

    const outputConfiguration = getSummaryOutputConfiguration();
    const prompt = await buildSummaryPrompt(chunk, outputConfiguration);
    ensureChatUnchanged(chat);
    if (!prompt.trim()) throw new Error('현재 설정으로 조립된 재생성 프롬프트가 비어 있습니다.');

    const response = await generateSummary(prompt);
    ensureChatUnchanged(chat);
    if (!response) throw new Error('재생성된 요약 응답이 비어 있습니다.');
    const currentRecord = getSummaryRecord(recordId);
    if (!currentRecord || createRegenerationRecordSignature(currentRecord) !== baselineRecordSignature) {
        throw new Error('재생성 중 대상 요약 레코드가 변경되어 초안을 만들지 않았습니다.');
    }
    const [currentChunk] = createSummaryChunks(chat, start, end, end - start + 1);
    if (!currentChunk || JSON.stringify(createSourceFingerprint(currentChunk.messages)) !== JSON.stringify(sourceFingerprint)) {
        throw new Error('재생성 중 원본 메시지가 변경되어 초안을 만들지 않았습니다.');
    }
    const structuredData = parseStructuredSummaryResponse(
        response,
        outputConfiguration.sections,
        outputConfiguration.memorySections,
    );
    const content = renderStructuredSummary(structuredData, {
        startId: chunk.startId,
        endId: chunk.endId,
        template: getSettings().summarization.summaryContentTemplate,
        outputSections: getSettings().summarization.summaryOutputSections,
    });

    return {
        id: createId('summary-regeneration-draft'),
        recordId: record.id,
        sourceChat: chat,
        baselineRecordSignature,
        sourceFingerprint,
        previousRecord: structuredClone(record),
        content,
        structuredSummary: {
            version: SUMMARY_FORMAT_VERSION,
            languageMode: outputConfiguration.languageMode,
            sections: outputConfiguration.sections,
            memorySections: outputConfiguration.memorySections,
            data: structuredData,
        },
    };
}

export async function applySummaryRegenerationDraft(draft) {
    if (!draft?.recordId || !draft.structuredSummary || !String(draft.content || '').trim()) {
        throw new Error('적용할 요약 재생성 초안이 없습니다.');
    }
    if (SillyTavern.getContext().chat !== draft.sourceChat) {
        throw new Error('재생성 초안 생성 후 채팅방이 변경되었습니다. 다시 재생성해주세요.');
    }
    const record = getSummaryRecord(draft.recordId);
    if (!record || createRegenerationRecordSignature(record) !== draft.baselineRecordSignature) {
        throw new Error('재생성 초안 생성 후 대상 요약 레코드가 변경되었습니다. 다시 재생성해주세요.');
    }
    const [chunk] = createSummaryChunks(
        draft.sourceChat,
        record.startId,
        record.endId,
        record.endId - record.startId + 1,
    );
    if (!chunk || JSON.stringify(createSourceFingerprint(chunk.messages)) !== JSON.stringify(draft.sourceFingerprint)) {
        throw new Error('재생성 초안 생성 후 원본 메시지가 변경되었습니다. 다시 재생성해주세요.');
    }

    const updatedRecord = await updateSummaryRecordContent(record.id, draft.content, {
        contentEdited: false,
        sourceFingerprint: draft.sourceFingerprint,
        structuredSummary: draft.structuredSummary,
    });
    if (!updatedRecord) throw new Error('재생성 결과를 저장할 요약 기록을 찾지 못했습니다.');
    return updatedRecord;
}

function createRegenerationRecordSignature(record) {
    return JSON.stringify({
        id: record.id,
        startId: record.startId,
        endId: record.endId,
        llmHidden: record.llmHidden,
        updatedAt: record.updatedAt,
        sourceFingerprint: record.sourceFingerprint,
        structuredSummary: record.structuredSummary,
        atlasReviewOverrides: record.atlasReviewOverrides,
        legacyContent: record.legacyContent,
    });
}

function validateUncoveredRange(startId, endId) {
    const records = getSummaryRecordIndex();
    const overlaps = findOverlappingRanges(startId, endId, records);
    if (!overlaps.length) return;

    const uncovered = getUncoveredRanges(startId, endId, records);
    throw new Error(
        `요청 범위 일부가 이미 요약되어 있습니다. 중복 범위: ${formatRanges(overlaps)} / 요약 가능한 범위: ${formatRanges(uncovered)}`,
    );
}

function ensureChatUnchanged(sourceChat) {
    if (SillyTavern.getContext().chat !== sourceChat) {
        throw new Error('요약 중 채팅방이 변경되어 배치 처리를 중단했습니다.');
    }
}
