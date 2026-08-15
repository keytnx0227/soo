import { getSettings, setSummarizationSettings } from '../core/settings.js';
import { escapeHtml } from '../core/utils.js';
import { buildSummaryContextDetails } from '../summary/summary-context.js';
import { getLastGenerationRetrievalSnapshot } from './generation-retrieval-snapshot.js';

export function bindLongTermRetrievalSettings(root, initialContextDetails = null) {
    const container = root.querySelector('.stsm-long-term-retrieval');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.addEventListener('change', event => handleSettingChange(root, event));
    container.addEventListener('click', event => handleResultTabClick(container, event));
    const refresh = event => renderLongTermRetrievalSettings(root, event?.detail || null);
    const refreshLastGeneration = () => renderLastGenerationRetrieval(container);
    window.addEventListener('stsm:long-term-retrieval-changed', refresh);
    window.addEventListener('stsm:last-generation-retrieval-changed', refreshLastGeneration);
    renderLongTermRetrievalSettings(root, initialContextDetails);
    renderLastGenerationRetrieval(container);
    setResultView(container, 'current');
    return () => {
        window.removeEventListener('stsm:long-term-retrieval-changed', refresh);
        window.removeEventListener('stsm:last-generation-retrieval-changed', refreshLastGeneration);
    };
}

export function renderLongTermRetrievalSettings(root, contextDetails = null) {
    const container = root.querySelector('.stsm-long-term-retrieval');
    if (!container) return;
    const settings = getSettings().summarization.longTermRetrieval;
    container.querySelector('#stsm-long-term-enabled').checked = settings.enabled;
    container.querySelector('#stsm-long-term-mode').value = settings.mode;
    container.querySelector('#stsm-long-term-message-count').value = settings.messageCount;
    container.querySelector('#stsm-long-term-max-tokens').value = settings.maxTokens;
    container.querySelector('#stsm-long-term-relevance').value = settings.relevance;
    container.querySelector('#stsm-long-term-message-recency').value = settings.messageRecency;
    container.querySelector('#stsm-long-term-recency-strength').value = settings.messageRecencyStrength;
    container.querySelector('#stsm-long-term-oldest-weight').value = settings.messageRecencyOldestWeight;
    container.querySelector('#stsm-long-term-newest-weight').value = settings.messageRecencyNewestWeight;
    container.querySelector('#stsm-long-term-recency-curve').value = settings.messageRecencyCurve;
    container.querySelector('#stsm-long-term-curve-exponent').value = settings.messageRecencyCurveExponent;
    container.querySelector('#stsm-long-term-limit-mode').value = settings.relevanceLimitMode;
    container.querySelector('#stsm-long-term-max-records').value = settings.relevanceMaxRecords;
    container.querySelector('.stsm-long-term-settings-grid').classList.toggle('stsm-control-disabled', !settings.enabled);
    container.querySelectorAll('.stsm-long-term-settings-grid :is(input, select)').forEach(control => {
        control.disabled = !settings.enabled;
    });
    container.querySelectorAll('.stsm-long-term-relevance-field').forEach(field => {
        field.hidden = settings.mode !== 'relevance';
    });
    container.querySelector('.stsm-long-term-recency-strength-field').hidden = settings.mode !== 'relevance'
        || settings.messageRecency !== 'recent';
    container.querySelector('.stsm-long-term-custom-recency-field').hidden = settings.mode !== 'relevance'
        || settings.messageRecency !== 'recent'
        || settings.messageRecencyStrength !== 'custom';
    container.querySelector('.stsm-long-term-recency-curve-field').hidden = settings.mode !== 'relevance'
        || settings.messageRecency !== 'recent';
    container.querySelector('.stsm-long-term-custom-curve-field').hidden = settings.mode !== 'relevance'
        || settings.messageRecency !== 'recent'
        || settings.messageRecencyCurve !== 'custom';
    container.querySelector('.stsm-long-term-max-records-field').hidden = settings.mode !== 'relevance'
        || settings.relevanceLimitMode !== 'top';
    renderRetrievalResult(container, (contextDetails || buildSummaryContextDetails()).retrieval);
}

export function renderLongTermRetrievalPreview(retrieval) {
    if (!retrieval?.enabled) return '<div class="stsm-context-retrieval-summary">장기기억 자동 회상 꺼짐</div>';
    if (!retrieval.injected.length) return '<div class="stsm-context-retrieval-summary">이번 문맥에서 불러온 장기기억 없음</div>';
    return `
        <details class="stsm-context-retrieval-summary">
            <summary>장기기억 ${retrieval.injected.length}개 자동 회상</summary>
            <div class="stsm-long-term-result-list">
                ${retrieval.injected.map(item => renderResultRow(item, true, retrieval.mode)).join('')}
            </div>
        </details>
    `;
}

function handleSettingChange(root, event) {
    const target = event.target;
    if (!target.matches('[data-long-term-setting]')) return;
    const current = getSettings().summarization.longTermRetrieval;
    const next = {
        ...current,
        [target.dataset.longTermSetting]: target.type === 'checkbox' ? target.checked : target.value,
    };
    setSummarizationSettings({ longTermRetrieval: next });
    renderLongTermRetrievalSettings(root);
}

function handleResultTabClick(container, event) {
    const tab = event.target.closest('[data-long-term-result-view]');
    if (!tab || !container.contains(tab)) return;
    setResultView(container, tab.dataset.longTermResultView);
}

function setResultView(container, view) {
    const normalized = view === 'last' ? 'last' : 'current';
    container.dataset.resultView = normalized;
    container.querySelectorAll('[data-long-term-result-view]').forEach(tab => {
        const selected = tab.dataset.longTermResultView === normalized;
        tab.classList.toggle('stsm-long-term-result-tab-active', selected);
        tab.setAttribute('aria-selected', String(selected));
    });
    container.querySelectorAll('[data-long-term-result-panel]').forEach(panel => {
        panel.hidden = panel.dataset.longTermResultPanel !== normalized;
    });
}

function renderRetrievalResult(container, retrieval) {
    const output = container.querySelector('.stsm-long-term-result');
    if (!retrieval?.enabled) {
        output.innerHTML = '<span class="stsm-long-term-result-empty">장기기억 자동 회상이 꺼져 있어요.</span>';
        return;
    }
    if (!retrieval.longTermRecordCount) {
        output.innerHTML = '<span class="stsm-long-term-result-empty">검색할 장기기억 레코드가 아직 없어요.</span>';
        return;
    }
    if (!retrieval.contextMessageCount && !retrieval.candidates.length) {
        output.innerHTML = '<span class="stsm-long-term-result-empty">검색에 사용할 최근 채팅 메시지가 없어요.</span>';
        return;
    }
    if (!retrieval.candidates.length) {
        output.innerHTML = '<span class="stsm-long-term-result-empty">최근 채팅과 일치하는 장기기억이 없어요.</span>';
        return;
    }

    const injectedIds = new Set(retrieval.injected.map(item => String(item.record.id)));
    const rows = retrieval.selected.map(item => renderResultRow(
        item,
        injectedIds.has(String(item.record.id)),
        retrieval.mode,
    )).join('');
    const omittedCount = retrieval.excludedByThreshold.length
        + retrieval.excludedByRecordLimit.length
        + retrieval.omittedByRetrievalBudget.length
        + retrieval.omittedByInjectionBudget.length;
    const summary = `${retrieval.injected.length}개 불러옴${omittedCount ? ` · ${omittedCount}개 제외` : ''}`;
    output.innerHTML = `
        <details class="stsm-long-term-result-details" ${retrieval.injected.length ? 'open' : ''}>
            <summary>${escapeHtml(summary)}</summary>
            <div class="stsm-long-term-result-list">
                ${rows || '<span class="stsm-long-term-result-empty">일치한 기억은 있지만 현재 선택 기준에서는 주입되지 않았어요.</span>'}
                ${retrieval.excludedByThreshold.map(item => renderResultRow(item, false, retrieval.mode, '관련도 기준 미달')).join('')}
                ${retrieval.excludedByRecordLimit.map(item => renderResultRow(item, false, retrieval.mode, '상위 N개 제한')).join('')}
                ${retrieval.omittedByRetrievalBudget.map(item => renderResultRow(item, false, retrieval.mode, '장기기억 토큰 제한')).join('')}
            </div>
        </details>
    `;
}

function renderLastGenerationRetrieval(container) {
    const output = container.querySelector('.stsm-long-term-last-result');
    if (!output) return;
    const snapshot = getLastGenerationRetrievalSnapshot();
    if (!snapshot) {
        output.innerHTML = '<span class="stsm-long-term-result-empty">이 채팅에서 아직 기록된 생성 요청이 없어요.</span>';
        return;
    }

    const label = getGenerationTypeLabel(snapshot.generationType);
    const time = new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!snapshot.enabled || !snapshot.injected.length) {
        output.innerHTML = `<span class="stsm-long-term-result-empty">${escapeHtml(label)} · ${escapeHtml(time)} · 사용된 장기기억 없음</span>`;
        return;
    }

    output.innerHTML = `
        <details class="stsm-long-term-result-details" open>
            <summary>${escapeHtml(label)} · ${escapeHtml(time)} · ${snapshot.injected.length}개 사용</summary>
            <div class="stsm-long-term-result-list">
                ${snapshot.injected.map(item => renderResultRow(item, true, snapshot.mode)).join('')}
            </div>
        </details>
    `;
}

function getGenerationTypeLabel(type) {
    return {
        normal: '일반 생성',
        regenerate: '재생성',
        swipe: '스와이프 재생성',
        continue: '이어쓰기',
    }[type] || '생성 요청';
}

function renderResultRow(item, injected, mode, omittedReason = '전체 주입 토큰 제한') {
    const matches = item.matchedConcepts.map(concept => {
        const terms = concept.terms.join(', ');
        return `<span><strong>${escapeHtml(concept.canonical)}</strong>: ${escapeHtml(terms)}</span>`;
    }).join('');
    const status = `${item.pinned ? '고정 · ' : ''}${injected ? '주입' : omittedReason}`;
    const matchDetails = matches || (item.pinned
        ? '<span>태그 매칭 없이 고정 우선순위로 회상</span>'
        : '<span>일치 검색어 없음</span>');
    return `
        <div class="stsm-long-term-result-item${injected ? '' : ' stsm-long-term-result-item-omitted'}">
            <div class="stsm-long-term-result-heading">
                <strong>#${item.record.startId} ~ #${item.record.endId}</strong>
                <span>${escapeHtml(status)}${mode === 'relevance' ? ` · ${item.score.toFixed(2)}점` : ''}</span>
            </div>
            <div class="stsm-long-term-result-matches">${matchDetails}</div>
        </div>
    `;
}
