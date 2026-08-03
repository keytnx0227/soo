import { Popup, POPUP_TYPE } from '../../../../scripts/popup.js';
import { createSummaryChunks } from './chunking.js';
import { buildSummaryPrompt } from './prompt-builder.js';
import { buildCurrentRevisionPromptPreview } from './revision-chat-view.js';
import { getSettings } from './settings.js';

export function bindPromptInspector(root) {
    let timer = null;
    let runId = 0;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(updateCounts, 250);
    };

    root.querySelectorAll('.stsm-preview-prompt').forEach(button => {
        button.addEventListener('click', async () => {
            const type = button.dataset.previewType;
            const prompt = type === 'summary'
                ? formatSummaryPreview(await buildSummaryPrompts(root))
                : await buildCurrentRevisionPromptPreview();
            await showPreview(type === 'summary' ? '요약 프롬프트 전체' : '요약 수정 대화 프롬프트 전체', prompt);
        });
    });
    root.querySelectorAll('#stsm-range-start, #stsm-range-end, #stsm-chunk-size')
        .forEach(input => input.addEventListener('input', schedule));
    root.addEventListener('stsm:settings-tab-opened', schedule);
    root.addEventListener('stsm:prompt-settings-changed', schedule);

    async function updateCounts() {
        if (root.dataset.activeTab !== 'settings') return;
        const summaryOutput = root.querySelector('#stsm-token-count-summary');
        const revisionOutput = root.querySelector('#stsm-token-count-revision');
        const currentRun = ++runId;
        summaryOutput.textContent = '계산 중...';
        revisionOutput.textContent = '계산 중...';
        try {
            const [summaryPrompts, revisionPrompt] = await Promise.all([
                buildSummaryPrompts(root),
                buildCurrentRevisionPromptPreview(),
            ]);
            const context = SillyTavern.getContext();
            const [summaryTokenCounts, revisionTokens] = await Promise.all([
                Promise.all(summaryPrompts.map(item => context.getTokenCountAsync(item.prompt))),
                context.getTokenCountAsync(revisionPrompt),
            ]);
            if (currentRun !== runId) return;
            const summaryTokens = summaryTokenCounts.reduce((total, count) => total + count, 0);
            summaryOutput.textContent = summaryPrompts.length > 1
                ? `${summaryTokens.toLocaleString()} tokens · ${summaryPrompts.length}회`
                : `${summaryTokens.toLocaleString()} tokens`;
            revisionOutput.textContent = `${revisionTokens.toLocaleString()} tokens`;
        } catch (error) {
            console.warn('[Chat Summarizer] Prompt token count failed:', error);
            if (currentRun === runId) {
                summaryOutput.textContent = '계산 실패';
                revisionOutput.textContent = '계산 실패';
            }
        }
    }
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
