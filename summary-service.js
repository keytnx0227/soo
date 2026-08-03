import { createSummaryChunks } from './chunking.js';
import { generateSummary } from './generation.js';
import { buildSummaryPrompt } from './prompt-builder.js';
import { findOverlappingRanges, formatRanges, getUncoveredRanges } from './range-utils.js';
import { getSettings } from './settings.js';
import {
    addSummaryRecord,
    getSummaryRecord,
    getSummaryRecords,
    updateSummaryRecordContent,
} from './summary-store.js';

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

export async function summarizeRange({ startId, endId, onProgress, onRecord }) {
    const { start, end, chat } = validateSummaryRange(startId, endId);
    validateUncoveredRange(start, end);
    const chunkSize = getSettings().summarization.chunkSize;
    const chunks = createSummaryChunks(chat, start, end, chunkSize);

    if (!chunks.length) {
        throw new Error('선택한 범위에 요약할 메시지가 없습니다.');
    }

    const records = [];
    for (let index = 0; index < chunks.length; index += 1) {
        ensureChatUnchanged(chat);
        const chunk = chunks[index];
        onProgress?.({ current: index + 1, total: chunks.length, chunk });

        const prompt = await buildSummaryPrompt(chunk);
        if (!prompt.trim()) {
            throw new Error(`#${chunk.startId} ~ #${chunk.endId} 청크의 프롬프트가 비어 있습니다.`);
        }

        const content = await generateSummary(prompt);
        ensureChatUnchanged(chat);
        if (!content) {
            throw new Error(`#${chunk.startId} ~ #${chunk.endId} 청크의 요약 응답이 비어 있습니다.`);
        }

        const record = await addSummaryRecord({
            startId: chunk.startId,
            endId: chunk.endId,
            content,
            prompt,
        });
        records.push(record);
        await onRecord?.(record);
    }

    return records;
}

export async function regenerateSummaryRecord(recordId) {
    const record = getSummaryRecord(recordId);
    if (!record) throw new Error('재생성할 요약 기록을 찾지 못했습니다.');

    const { start, end, chat } = validateSummaryRange(record.startId, record.endId);
    const [chunk] = createSummaryChunks(chat, start, end, end - start + 1);
    if (!chunk) throw new Error('현재 채팅의 해당 범위에 요약할 메시지가 없습니다.');

    const prompt = await buildSummaryPrompt(chunk);
    ensureChatUnchanged(chat);
    if (!prompt.trim()) throw new Error('현재 설정으로 조립된 재생성 프롬프트가 비어 있습니다.');

    const content = await generateSummary(prompt);
    ensureChatUnchanged(chat);
    if (!content) throw new Error('재생성된 요약 응답이 비어 있습니다.');

    const updatedRecord = await updateSummaryRecordContent(record.id, content, { prompt });
    if (!updatedRecord) throw new Error('재생성 결과를 저장할 요약 기록을 찾지 못했습니다.');
    return updatedRecord;
}

function validateUncoveredRange(startId, endId) {
    const records = getSummaryRecords();
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
