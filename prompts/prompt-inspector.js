import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { createSummaryChunks } from '../summary/chunking.js';
import { buildSummaryPrompt } from './prompt-builder.js';
import { buildCompressionPrompt } from './prompt-builder.js';
import { buildCurrentRevisionPromptPreview } from '../records/revision-chat-view.js';
import { getSettings } from '../core/settings.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { getCompressionCandidates, selectCompressionSources } from '../summary/compression-service.js';

export function bindPromptInspector(root) {
    let timer = null;
    let runId = 0;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(updateCounts, 250);
    };

    root.querySelectorAll('.stsm-preview-prompt').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                const type = button.dataset.previewType;
                const prompt = type === 'summary'
                    ? formatSummaryPreview(await buildSummaryPrompts(root))
                    : type === 'compression'
                        ? buildCompressionPreviewPrompt(root)
                        : await buildCurrentRevisionPromptPreview();
                const title = type === 'summary'
                    ? '요약 프롬프트 전체'
                    : type === 'compression'
                        ? '압축 요약 프롬프트 전체'
                        : '요약 수정 대화 프롬프트 전체';
                await showPreview(title, prompt);
            } catch (error) {
                console.error('[Chat Summarizer] Prompt preview failed:', error);
                addExtensionErrorLog(error, {
                    operation: 'prompt-inspection',
                    title: '프롬프트 미리보기 실패',
                    message: '프롬프트 전체 보기를 열지 못했습니다.',
                });
                toastr.error('프롬프트 미리보기를 불러오지 못했습니다.');
            }
        });
    });
    root.querySelectorAll('#stsm-range-start, #stsm-range-end, #stsm-chunk-size, #stsm-compression-group-size')
        .forEach(input => input.addEventListener('input', schedule));
    root.addEventListener('stsm:settings-tab-opened', schedule);
    root.addEventListener('stsm:prompt-settings-changed', schedule);

    async function updateCounts() {
        if (root.dataset.activeTab !== 'settings') return;
        const summaryOutput = root.querySelector('#stsm-token-count-summary');
        const revisionOutput = root.querySelector('#stsm-token-count-revision');
        const compressionOutput = root.querySelector('#stsm-token-count-compression');
        const currentRun = ++runId;
        summaryOutput.textContent = '계산 중...';
        revisionOutput.textContent = '계산 중...';
        compressionOutput.textContent = '계산 중...';
        try {
            const [summaryPrompts, revisionPrompt, compressionPrompt] = await Promise.all([
                buildSummaryPrompts(root),
                buildCurrentRevisionPromptPreview(),
                buildCompressionPreviewPrompt(root),
            ]);
            const context = SillyTavern.getContext();
            const [summaryTokenCounts, revisionTokens, compressionTokens] = await Promise.all([
                Promise.all(summaryPrompts.map(item => context.getTokenCountAsync(item.prompt))),
                context.getTokenCountAsync(revisionPrompt),
                context.getTokenCountAsync(compressionPrompt),
            ]);
            if (currentRun !== runId) return;
            const summaryTokens = summaryTokenCounts.reduce((total, count) => total + count, 0);
            const averageSummaryTokens = Math.round(summaryTokens / summaryPrompts.length);
            summaryOutput.textContent = summaryPrompts.length > 1
                ? `예상 평균 ${averageSummaryTokens.toLocaleString()} tokens · ${summaryPrompts.length}회`
                : `${summaryTokens.toLocaleString()} tokens`;
            revisionOutput.textContent = `${revisionTokens.toLocaleString()} tokens`;
            compressionOutput.textContent = `${compressionTokens.toLocaleString()} tokens`;
        } catch (error) {
            console.warn('[Chat Summarizer] Prompt token count failed:', error);
            addExtensionErrorLog(error, {
                operation: 'prompt-inspection',
                title: '프롬프트 토큰 계산 실패',
                message: '프롬프트 전송 토큰 수를 계산하지 못했습니다.',
            });
            if (currentRun === runId) {
                summaryOutput.textContent = '계산 실패';
                revisionOutput.textContent = '계산 실패';
                compressionOutput.textContent = '계산 실패';
            }
        }
    }
}

function buildCompressionPreviewPrompt(root) {
    const candidates = getCompressionCandidates();
    const count = Number(root.querySelector('#stsm-compression-group-size')?.value)
        || getSettings().summarization.compressionGroupSize;
    let sources;
    try {
        sources = candidates.length ? selectCompressionSources(candidates[0].id, count) : [];
    } catch {
        sources = candidates.slice(0, Math.max(2, count));
    }
    if (sources.length >= 2) return buildCompressionPrompt(sources);
    return buildCompressionPrompt([
        { startId: 0, endId: 4, content: 'Example source summary A.' },
        { startId: 5, endId: 9, content: 'Example source summary B.' },
    ]);
}

async function buildSummaryPrompts(root) {
    const chat = SillyTavern.getContext().chat;
    const startValue = root.querySelector('#stsm-range-start').value.trim();
    const endValue = root.querySelector('#stsm-range-end').value.trim();
    const start = Number(startValue);
    const end = Number(endValue);
    const valid = Array.isArray(chat) && startValue && endValue && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < chat.length;
    const chunks = valid ? createSummaryChunks(chat, start, end, getSettings().summarization.chunkSize) : [];
    if (!chunks.length) {
        return [{ label: '', prompt: await buildSummaryPrompt({ messages: [], startId: 0, endId: 0 }) }];
    }

    const prompts = await Promise.all(chunks.map(chunk => buildSummaryPrompt(chunk)));
    return prompts.map((prompt, index) => ({
        label: `#${chunks[index].startId} ~ #${chunks[index].endId}`,
        prompt,
    }));
}

function formatSummaryPreview(prompts) {
    return prompts.map(item => (
        prompts.length > 1 ? `===== ${item.label} =====\n\n${item.prompt}` : item.prompt
    )).join('\n\n');
}

async function showPreview(title, prompt) {
    const content = document.createElement('div');
    content.className = 'stsm-prompt-preview';
    content.innerHTML = `<label class="stsm-field"><span>${title}</span><textarea class="text_pole monospace" rows="24" readonly></textarea></label>`;
    content.querySelector('textarea').value = prompt;
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true }).show();
}
