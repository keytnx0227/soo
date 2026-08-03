import {
    getSettings,
    PROVIDERS,
    resetActiveConnectionSettings,
    saveSettings,
} from './settings.js';

export function bindConnectionSettings(root) {
    root.querySelector('#stsm-connection-mode').addEventListener('change', event => {
        getSettings().connectionMode = event.target.value;
        saveSettings();
        renderConnectionSettings(root);
    });
    root.querySelector('#stsm-reset-connection').addEventListener('click', () => {
        resetActiveConnectionSettings();
        renderConnectionSettings(root);
        toastr.success('현재 연결 설정을 기본값으로 초기화했습니다.');
    });

    renderConnectionSettings(root);
}

export function renderConnectionSettings(root) {
    const settings = getSettings();
    const modeSelect = root.querySelector('#stsm-connection-mode');
    const customWrap = root.querySelector('#stsm-custom-connection');
    const samplerWrap = root.querySelector('#stsm-sampler-settings');
    const active = settings.connection[settings.connectionMode];

    modeSelect.value = settings.connectionMode;
    customWrap.hidden = settings.connectionMode !== 'custom';
    customWrap.innerHTML = settings.connectionMode === 'custom' ? `
        <label class="stsm-field">
            <span>프로바이더</span>
            <select id="stsm-provider" class="text_pole">
                ${PROVIDERS.map(provider => `<option value="${provider.value}">${provider.label}</option>`).join('')}
            </select>
        </label>
        <label class="stsm-field">
            <span>모델명</span>
            <input id="stsm-model" class="text_pole" type="text" placeholder="예: gpt-4.1, claude-sonnet-4 등" />
        </label>
    ` : '';

    samplerWrap.innerHTML = `
        <label class="stsm-field">
            <span>API 응답 최대 토큰 수</span>
            <input id="stsm-max-tokens" class="text_pole" type="number" min="1" max="200000" step="1" />
        </label>
        ${renderRange('temperature', '온도', 0, 2, 0.05)}
        ${renderRange('topP', 'Top P', 0, 1, 0.01)}
        ${renderRange('topK', 'Top K', 0, 200, 1)}
    `;

    if (settings.connectionMode === 'custom') {
        const provider = customWrap.querySelector('#stsm-provider');
        const model = customWrap.querySelector('#stsm-model');
        provider.value = active.provider;
        model.value = active.model;
        provider.addEventListener('change', event => updateConnectionValue('provider', event.target.value));
        model.addEventListener('input', event => updateConnectionValue('model', event.target.value));
    }

    const maxTokens = samplerWrap.querySelector('#stsm-max-tokens');
    maxTokens.value = active.maxTokens;
    maxTokens.addEventListener('input', event => updateConnectionValue('maxTokens', Number(event.target.value)));

    for (const key of ['temperature', 'topP', 'topK']) {
        const input = samplerWrap.querySelector(`[data-setting="${key}"]`);
        const output = samplerWrap.querySelector(`[data-output="${key}"]`);
        input.value = active[key];
        output.textContent = active[key];
        input.addEventListener('input', event => {
            const value = Number(event.target.value);
            output.textContent = value;
            updateConnectionValue(key, value);
        });
    }
}

function renderRange(key, label, min, max, step) {
    return `
        <label class="stsm-range">
            <span>${label}</span>
            <input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" />
            <output data-output="${key}"></output>
        </label>
    `;
}

function updateConnectionValue(key, value) {
    const settings = getSettings();
    settings.connection[settings.connectionMode][key] = value;
    saveSettings();
}
