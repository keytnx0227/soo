export function hasMessageRange(record) {
    return record?.startId != null && record?.endId != null
        && Number.isInteger(Number(record.startId)) && Number.isInteger(Number(record.endId))
        && Number(record.startId) >= 0 && Number(record.endId) >= Number(record.startId);
}

export function recordPosition(record) {
    return Number.isFinite(record?.position) ? record.position : Number(record?.startId) || 0;
}

export function compareRecordPosition(left, right) {
    return recordPosition(left) - recordPosition(right)
        || Number(left.endId) - Number(right.endId)
        || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || String(left.id).localeCompare(String(right.id));
}

export function recordRangeLabel(record) {
    return hasMessageRange(record) ? `#${record.startId} ~ #${record.endId}` : '보충 기억';
}

export function recordSelectionLabel(record) {
    const title = String(record?.title || record?.structuredSummary?.data?.title || '').trim();
    return title ? `${recordRangeLabel(record)} · ${title}` : hasMessageRange(record)
        ? recordRangeLabel(record) : `${recordRangeLabel(record)} · ${String(record?.id || '').slice(-8)}`;
}

export function positionAfter(records, anchorId) {
    const ordered = [...records].sort(compareRecordPosition);
    const anchor = anchorId ? ordered.find(record => record.id === anchorId) : ordered.at(-1);
    if (anchorId && !anchor) throw new Error('배치 기준 레코드를 찾지 못했습니다.');
    if (!anchor) return 0;
    const base = Math.max(recordPosition(anchor), hasMessageRange(anchor) ? anchor.endId : -1);
    const next = ordered.find(record => recordPosition(record) > base);
    return next ? (base + recordPosition(next)) / 2 : base + 0.5;
}

export function isCompressionIncluded(record) {
    return record?.manual?.includeInCompression !== false;
}

export function rangeAwareTemplate(template, prefix, startId, endId) {
    if (startId != null && endId != null) return template;
    return String(template || '')
        .replaceAll(`#{{${prefix}StartId}}-{{${prefix}EndId}}`, 'Supplement')
        .replaceAll(`#{{${prefix}StartId}} ~ #{{${prefix}EndId}}`, 'Supplement');
}
