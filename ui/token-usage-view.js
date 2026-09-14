import { escapeHtml } from '../core/utils.js';

const SECTION_COLORS = {
    records: '#3685c5', events: '#d78728', people: '#329b80',
    items: '#aa70b5', commitments: '#d36778', world: '#879842',
};

export function renderTokenUsageBar({ label, used, max, enabled = true, blocks = null }) {
    const usedTokens = Math.max(0, Number(used) || 0);
    const maximum = Number(max);
    const hasLimit = Number.isFinite(maximum) && maximum > 0;
    const percentage = hasLimit ? (usedTokens / maximum) * 100 : 0;
    const displayPercentage = Math.min(100, Math.max(0, percentage));
    const level = percentage >= 90 ? 'critical' : percentage >= 75 ? 'warning' : 'normal';
    const maximumLabel = hasLimit ? maximum.toLocaleString() : '제한 없음';
    const status = enabled ? `${Math.round(percentage)}%` : '전송 꺼짐';
    const sections = (blocks || []).filter(block => block.enabled).map(block => ({
        name: block.name,
        tokens: enabled ? Math.max(0, Number(block.outputTokenCount) || 0) : 0,
        color: SECTION_COLORS[block.kind] || '#888888',
        recordBreakdown: enabled ? block.recordTokenBreakdown : null,
    }));
    const sectionTotal = sections.reduce((sum, section) => sum + section.tokens, 0);
    const fill = enabled ? (hasLimit ? displayPercentage : usedTokens > 0 ? 100 : 0) : 0;
    const difference = usedTokens - sectionTotal;
    const segmentLabel = section => `${section.name}: ${section.tokens.toLocaleString()} tokens`;

    return `
        <div class="stsm-token-usage" data-level="${level}"${enabled ? '' : ' data-disabled="true"'}>
            <div class="stsm-token-usage-heading">
                <strong>${escapeHtml(label)}</strong>
                <span>${usedTokens.toLocaleString()} / ${maximumLabel} tokens · ${status}</span>
            </div>
            <div class="stsm-token-usage-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${hasLimit ? maximum : 0}" aria-valuenow="${usedTokens}">
                ${blocks ? `<div class="stsm-token-segments" style="width: ${fill}%">${sections.filter(section => section.tokens > 0).map(section => `
                    <span style="flex-grow: ${section.tokens}; background-color: ${section.color}" title="${escapeHtml(segmentLabel(section))}"></span>
                `).join('')}</div>` : `<span style="width: ${enabled ? displayPercentage : 0}%"></span>`}
            </div>
            ${blocks ? `
                <details class="stsm-token-breakdown">
                    <summary>섹션별 토큰 <span>${sections.filter(section => section.tokens > 0).length}개 섹션</span></summary>
                    <div class="stsm-token-breakdown-list">
                        ${sections.map(section => `<div class="stsm-token-breakdown-row">
                            <span class="stsm-token-swatch" style="background-color: ${section.color}" aria-hidden="true"></span>
                            <span>${escapeHtml(section.name)}</span>
                            <span class="stsm-token-breakdown-value">${section.tokens.toLocaleString()} <small>tokens · ${sectionTotal ? (section.tokens / sectionTotal * 100).toFixed(1) : '0.0'}%</small></span>
                        </div>${renderRecordTokenBreakdown(section)}`).join('')}
                        ${difference ? `<div class="stsm-token-breakdown-adjustment"><span>합본 결합 차이</span><span>${difference > 0 ? '+' : ''}${difference.toLocaleString()} tokens</span></div>` : ''}
                    </div>
                </details>
            ` : ''}
        </div>
    `;
}

function renderRecordTokenBreakdown(section) {
    const data = section.recordBreakdown;
    if (!data) return '';
    const total = data.always + data.longTerm;
    const difference = section.tokens - total;
    const percentage = tokens => total ? (tokens / total * 100).toFixed(1) : '0.0';
    const groups = [
        { name: '상시기억', tokens: data.always, color: '#3685c5' },
        { name: '장기기억', tokens: data.longTerm, color: '#d78728' },
    ];
    return `<div class="stsm-record-token-breakdown">
        <div class="stsm-record-token-track" role="img" aria-label="상시기억 ${percentage(data.always)}%, 장기기억 ${percentage(data.longTerm)}%">
            ${groups.filter(group => group.tokens > 0).map(group => `<span style="flex-grow: ${group.tokens}; background-color: ${group.color}" title="${group.name}: ${group.tokens.toLocaleString()} tokens"></span>`).join('')}
        </div>
        ${groups.map(group => `<div class="stsm-token-breakdown-row">
            <span class="stsm-token-swatch" style="background-color: ${group.color}" aria-hidden="true"></span>
            <span>${group.name}</span>
            <span class="stsm-token-breakdown-value">${group.tokens.toLocaleString()} <small>tokens · ${percentage(group.tokens)}%</small></span>
        </div>`).join('')}
        <div class="stsm-record-token-note">장기기억 중 고정 ${data.pinned.toLocaleString()} tokens</div>
        ${difference ? `<div class="stsm-record-token-note">공통 포맷·결합 차이 ${difference > 0 ? '+' : ''}${difference.toLocaleString()} tokens</div>` : ''}
    </div>`;
}
