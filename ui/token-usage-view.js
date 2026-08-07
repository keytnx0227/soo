import { escapeHtml } from '../core/utils.js';

export function renderTokenUsageBar({ label, used, max, enabled = true }) {
    const usedTokens = Math.max(0, Number(used) || 0);
    const maximum = Number(max);
    const hasLimit = Number.isFinite(maximum) && maximum > 0;
    const percentage = hasLimit ? (usedTokens / maximum) * 100 : 0;
    const displayPercentage = Math.min(100, Math.max(0, percentage));
    const level = percentage >= 90 ? 'critical' : percentage >= 75 ? 'warning' : 'normal';
    const maximumLabel = hasLimit ? maximum.toLocaleString() : '제한 없음';
    const status = enabled ? `${Math.round(percentage)}%` : '전송 꺼짐';

    return `
        <div class="stsm-token-usage" data-level="${level}"${enabled ? '' : ' data-disabled="true"'}>
            <div class="stsm-token-usage-heading">
                <strong>${escapeHtml(label)}</strong>
                <span>${usedTokens.toLocaleString()} / ${maximumLabel} tokens · ${status}</span>
            </div>
            <div class="stsm-token-usage-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${hasLimit ? maximum : 0}" aria-valuenow="${usedTokens}">
                <span style="width: ${enabled ? displayPercentage : 0}%"></span>
            </div>
        </div>
    `;
}
