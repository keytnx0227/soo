import { generateRaw, main_api } from '../../../../../script.js';
import { chat_completion_sources, oai_settings } from '../../../../../scripts/openai.js';
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

    return await withTemporaryConnection(async () => {
        return await withTemporarySamplers(connection, async () => {
            const result = await generateRaw({
                prompt,
                responseLength: Number(connection.maxTokens) || 5000,
            });
            return String(result || '').trim();
        });
    });
}

async function withTemporaryConnection(callback) {
    const settings = getSettings();
    if (settings.connectionMode !== 'custom') return await callback();

    const custom = settings.connection.custom;
    const provider = CHAT_COMPLETION_PROVIDERS[custom.provider];
    if (main_api !== 'openai' || !provider) {
        toastr.warning('현재 연결 프로필이 Chat Completion 계열이 아니어서 프로바이더/모델을 임시 변경하지 않습니다.');
        return await callback();
    }

    const previous = {
        chat_completion_source: oai_settings.chat_completion_source,
        [provider.modelKey]: oai_settings[provider.modelKey],
    };

    try {
        oai_settings.chat_completion_source = provider.source;
        if (custom.model.trim()) {
            oai_settings[provider.modelKey] = custom.model.trim();
        }
        return await callback();
    } finally {
        Object.assign(oai_settings, previous);
    }
}

async function withTemporarySamplers(connection, callback) {
    const sampler = normalizeSampler(connection);

    if (main_api === 'openai') {
        const previous = {
            temp_openai: oai_settings.temp_openai,
            top_p_openai: oai_settings.top_p_openai,
            top_k_openai: oai_settings.top_k_openai,
        };

        try {
            oai_settings.temp_openai = sampler.temperature;
            oai_settings.top_p_openai = sampler.topP;
            oai_settings.top_k_openai = sampler.topK;
            return await callback();
        } finally {
            Object.assign(oai_settings, previous);
        }
    }

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
