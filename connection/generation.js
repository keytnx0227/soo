import { createRawPrompt, generateRaw, main_api } from '../../../../../script.js';
import {
    chat_completion_sources,
    createGenerationParameters,
    getChatCompletionModel,
    oai_settings,
} from '../../../../../scripts/openai.js';
import { textgenerationwebui_settings } from '../../../../../scripts/textgen-settings.js';
import { assertExtensionEnabled } from '../core/extension-state.js';
import { getSettings } from '../core/settings.js';

const CHAT_COMPLETION_PROVIDERS = Object.freeze({
    openai: { source: chat_completion_sources.OPENAI, modelKey: 'openai_model' },
    claude: { source: chat_completion_sources.CLAUDE, modelKey: 'claude_model' },
    google: { source: chat_completion_sources.MAKERSUITE, modelKey: 'google_model' },
    vertexai: { source: chat_completion_sources.VERTEXAI, modelKey: 'vertexai_model' },
    openrouter: { source: chat_completion_sources.OPENROUTER, modelKey: 'openrouter_model' },
});

export async function generateSummary(prompt) {
    assertExtensionEnabled();
    const settings = getSettings();
    const connection = settings.connection[settings.connectionMode] ?? settings.connection.profile;

    if (settings.connectionMode === 'custom' && main_api !== 'openai') {
        toastr.warning('현재 연결 프로필이 Chat Completion 계열이 아니어서 프로바이더/모델을 임시 변경하지 않습니다.');
    }

    if (main_api === 'openai') {
        return await generateChatCompletion(prompt, connection, settings.connectionMode === 'custom');
    }

    return await withTemporarySamplers(connection, async () => {
        const result = await generateRaw({
            prompt,
            responseLength: Number(connection.maxTokens) || 5000,
        });
        return String(result || '').trim();
    });
}

async function generateChatCompletion(prompt, connection, useCustomConnection) {
    const requestSettings = structuredClone(oai_settings);
    const sampler = normalizeSampler(connection);

    requestSettings.temp_openai = sampler.temperature;
    requestSettings.top_p_openai = sampler.topP;
    requestSettings.top_k_openai = sampler.topK;
    requestSettings.openai_max_tokens = Number(connection.maxTokens) || 5000;

    if (useCustomConnection) {
        const provider = CHAT_COMPLETION_PROVIDERS[connection.provider];
        if (!provider) {
            throw new Error('설정한 Chat Completion 프로바이더를 찾지 못했습니다.');
        }
        requestSettings.chat_completion_source = provider.source;
        if (connection.model.trim()) {
            requestSettings[provider.modelKey] = connection.model.trim();
        }
    }

    const context = SillyTavern.getContext();
    const promptEvent = {
        chat: createRawPrompt(prompt, 'openai', false, false),
        dryRun: false,
    };
    await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, promptEvent);

    const model = getChatCompletionModel(requestSettings);
    const { generate_data } = await createGenerationParameters(
        requestSettings,
        model,
        'quiet',
        promptEvent.chat,
    );
    await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generate_data);

    const abortController = new AbortController();
    const abortRequest = () => abortController.abort(new Error('Cancelled by extension'));
    context.eventSource.on(context.eventTypes.GENERATION_STOPPED, abortRequest);

    try {
        const result = await context.ChatCompletionService.sendRequest(
            generate_data,
            true,
            abortController.signal,
        );
        return String(result?.content || '').trim();
    } finally {
        context.eventSource.removeListener(context.eventTypes.GENERATION_STOPPED, abortRequest);
    }
}

async function withTemporarySamplers(connection, callback) {
    const sampler = normalizeSampler(connection);

    if (main_api === 'textgenerationwebui') {
        const previous = {
            temp: textgenerationwebui_settings.temp,
            top_p: textgenerationwebui_settings.top_p,
            top_k: textgenerationwebui_settings.top_k,
        };

        try {
            textgenerationwebui_settings.temp = sampler.temperature;
            textgenerationwebui_settings.top_p = sampler.topP;
            textgenerationwebui_settings.top_k = sampler.topK;
            return await callback();
        } finally {
            Object.assign(textgenerationwebui_settings, previous);
        }
    }

    return await callback();
}

function normalizeSampler(connection) {
    return {
        temperature: clampNumber(connection.temperature, 0, 2, 0.9),
        topP: clampNumber(connection.topP, 0, 1, 1),
        topK: Math.max(0, Math.round(Number(connection.topK) || 0)),
    };
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}
