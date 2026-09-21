import { escapeHtml } from '../core/utils.js';
import { getCoveredRanges, getCoverageSegments } from '../summary/range-utils.js';
import { compareRecordPosition, hasMessageRange, recordSelectionLabel, recordRangeLabel, recordPosition } from '../summary/record-placement.js';

export function getLastCompletedRecordRange(records) {
    return records.flatMap(record => Array.isArray(record.coverageRanges) ? record.coverageRanges
        : record.manual && !record.manual.countsAsSummary ? [] : [record])
        .filter(hasMessageRange).sort((a, b) => b.endId - a.endId || b.startId - a.startId)[0] || null;
}

export function renderManualInfo(label, text) {
    return `<button type="button" class="stsm-section-info interactable" data-tooltip="${escapeHtml(text)}" aria-label="${escapeHtml(label)} 설명"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>`;
}

export function renderManualRecordSettings(records, allRecords, messageCount) {
    const covered = getCoveredRanges(allRecords);
    const count = covered.reduce((sum, range) => sum + Math.max(0, Math.min(messageCount - 1, range.endId) - range.startId + 1), 0);
    const last = getLastCompletedRecordRange(allRecords);
    return `<section class="stsm-manual-settings" aria-labelledby="stsm-manual-settings-title">
        <h3 id="stsm-manual-settings-title"><i class="fa-solid fa-sliders" aria-hidden="true"></i> 설정</h3>
        <div class="stsm-manual-setting-row"><label><input type="checkbox" data-manual-range /> 메시지 범위 지정</label>
            ${renderManualInfo('메시지 범위', '이 기억과 연결할 원본 메시지 ID입니다. 끄면 메시지 범위 없는 보충 기억으로 저장합니다.')}</div>
        <div class="stsm-manual-coverage">
            <div class="stsm-manual-coverage-heading"><span>요약 완료 <strong>${count.toLocaleString()}</strong> / ${messageCount.toLocaleString()}</span>
                <span>${last ? `최근 ${recordRangeLabel(last)}` : '완료된 범위 없음'}</span></div>
            <div class="stsm-manual-coverage-track" aria-label="메시지 요약 완료 범위">${getCoverageSegments(messageCount, allRecords).map(range =>
                `<span style="flex-grow:${range.endId - range.startId + 1}" class="${range.summarized ? 'is-covered' : ''}" title="${recordRangeLabel(range)} · ${range.summarized ? '완료' : '미완료'}"></span>`).join('')}</div>
            <div class="stsm-manual-coverage-ranges">${covered.length ? covered.map(range => `<span>${recordRangeLabel(range)}</span>`).join('') : '<span>없음</span>'}</div>
        </div>
        <fieldset class="stsm-manual-range-inputs" data-manual-range-fields disabled>
            <label class="stsm-field"><span>시작 ID</span><input class="text_pole" data-manual-start type="number" min="0" max="${Math.max(0, messageCount - 1)}" step="1" /></label>
            <label class="stsm-field"><span>종료 ID</span><input class="text_pole" data-manual-end type="number" min="0" max="${Math.max(0, messageCount - 1)}" step="1" /></label>
            <div class="stsm-manual-range-shortcuts">
                <button type="button" class="menu_button" data-manual-last-range ${last ? '' : 'disabled'}><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i><span>마지막 범위</span></button>
                <button type="button" class="menu_button" data-manual-next-range ${!messageCount || last?.endId >= messageCount - 1 ? 'disabled' : ''}><i class="fa-solid fa-forward-step" aria-hidden="true"></i><span>이어서</span></button>
            </div>
        </fieldset>
        <div class="stsm-manual-setting-row"><label><input type="checkbox" data-manual-coverage disabled /> 해당 범위를 요약 완료로 처리</label>
            ${renderManualInfo('완료 처리', '체크한 범위는 다음 요약의 완료 범위에 포함됩니다. 기존 자동 숨김 설정이 켜져 있으면 해당 원본 메시지도 숨깁니다.')}</div>
        <div class="stsm-manual-setting-row"><label><input type="checkbox" data-manual-compression /> 압축 대상에 포함</label>
            ${renderManualInfo('압축 포함', '이 레코드를 압축 LLM 입력에 포함합니다. 해제하면 압축 시 원본 그대로 장기기억으로 이동하거나 상시기억에 유지할 수 있습니다.')}</div>
        <div class="stsm-manual-setting-row"><strong>배치 위치</strong>
            ${renderManualInfo('배치 위치', '범위가 있으면 메시지 ID 순서로 배치합니다. 범위가 없으면 기준 레코드 뒤에 배치하며, 아래에 앞뒤 기록을 표시합니다.')}</div>
        <label class="stsm-field" data-manual-position><select class="text_pole" data-manual-after aria-label="배치 기준 레코드">
            <option value="">마지막 레코드 뒤</option>
            ${records.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(recordSelectionLabel(record))} 뒤</option>`).join('')}
        </select></label>
        <ol class="stsm-manual-placement" data-manual-placement aria-label="저장 후 레코드 순서"></ol>
    </section>`;
}

export function bindManualRecordSettings(form, records, allRecords, messageCount, resolveRecord = record => record, initialRecord = null) {
    const range = form.querySelector('[data-manual-range]');
    const start = form.querySelector('[data-manual-start]');
    const end = form.querySelector('[data-manual-end]');
    const after = form.querySelector('[data-manual-after]');
    const ordered = [...records].sort(compareRecordPosition);
    const preview = () => {
        let index = ordered.length;
        if (range.checked && start.value !== '') {
            const next = ordered.findIndex(record => recordPosition(record) > Number(start.value));
            index = next < 0 ? ordered.length : next;
        } else if (after.value === '__current__' && initialRecord) {
            const next = ordered.findIndex(record => compareRecordPosition(record, initialRecord) > 0);
            index = next < 0 ? ordered.length : next;
        } else if (after.value) index = ordered.findIndex(record => record.id === after.value) + 1;
        const renderNeighbor = (record, side) => {
            if (!record) return `<li class="stsm-manual-neighbor is-empty"><small>${side}</small><span>${side === '이전' ? '첫 번째 위치' : '마지막 위치'}</span></li>`;
            const full = resolveRecord(record) || record;
            const content = full.structuredSummary?.data?.plot?.[0] || full.content || '';
            return `<li class="stsm-manual-neighbor"><small>${side} · ${escapeHtml(recordSelectionLabel(record))}</small><span>${escapeHtml(content)}</span></li>`;
        };
        const title = form.querySelector('[data-summary-title]')?.value.trim() || '새 레코드';
        form.querySelector('[data-manual-placement]').innerHTML = `${renderNeighbor(ordered[index - 1], '이전')}
            <li class="stsm-manual-new-record"><i class="fa-solid fa-plus" aria-hidden="true"></i><strong>${escapeHtml(title)}</strong></li>
            ${renderNeighbor(ordered[index], '다음')}`;
    };
    range.addEventListener('change', () => {
        form.querySelector('[data-manual-range-fields]').disabled = !range.checked;
        after.disabled = range.checked;
        const coverage = form.querySelector('[data-manual-coverage]');
        coverage.disabled = !range.checked;
        if (!range.checked) coverage.checked = false;
        form.querySelector('[data-manual-compression]').checked = range.checked;
        preview();
    });
    const last = getLastCompletedRecordRange(allRecords);
    form.querySelector('[data-manual-last-range]').addEventListener('click', () => {
        if (!last) return;
        start.value = last.startId; end.value = Math.min(last.endId, messageCount - 1); preview();
    });
    form.querySelector('[data-manual-next-range]').addEventListener('click', () => {
        start.value = (last?.endId ?? -1) + 1; end.value = messageCount - 1; preview();
    });
    after.addEventListener('change', preview);
    start.addEventListener('change', preview);
    form.querySelector('[data-summary-title]')?.addEventListener('change', preview);
    if (initialRecord) {
        after.insertAdjacentHTML('afterbegin', '<option value="__current__">현재 위치 유지</option>');
        after.value = '__current__';
        range.checked = hasMessageRange(initialRecord);
        start.value = initialRecord.startId ?? '';
        end.value = initialRecord.endId ?? '';
        form.querySelector('[data-manual-range-fields]').disabled = !range.checked;
        after.disabled = range.checked;
        form.querySelector('[data-manual-coverage]').disabled = !range.checked;
        form.querySelector('[data-manual-coverage]').checked = Boolean(initialRecord.manual.countsAsSummary);
        form.querySelector('[data-manual-compression]').checked = initialRecord.manual.includeInCompression !== false;
    }
    preview();
}
