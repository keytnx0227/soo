export function getCoveredRanges(records) {
    const ranges = (Array.isArray(records) ? records : [])
        .map(record => ({
            startId: Number(record?.startId),
            endId: Number(record?.endId),
        }))
        .filter(range => Number.isInteger(range.startId)
            && Number.isInteger(range.endId)
            && range.startId >= 0
            && range.startId <= range.endId)
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);

    return ranges.reduce((merged, range) => {
        const previous = merged.at(-1);
        if (!previous || range.startId > previous.endId + 1) {
            merged.push({ ...range });
            return merged;
        }

        previous.endId = Math.max(previous.endId, range.endId);
        return merged;
    }, []);
}

export function findOverlappingRanges(startId, endId, records) {
    return getCoveredRanges(records)
        .filter(range => startId <= range.endId && endId >= range.startId)
        .map(range => ({
            startId: Math.max(startId, range.startId),
            endId: Math.min(endId, range.endId),
        }));
}

export function getUncoveredRanges(startId, endId, records) {
    const covered = getCoveredRanges(records);
    const uncovered = [];
    let cursor = startId;

    for (const range of covered) {
        if (range.endId < cursor) continue;
        if (range.startId > endId) break;

        if (range.startId > cursor) {
            uncovered.push({ startId: cursor, endId: Math.min(endId, range.startId - 1) });
        }

        cursor = Math.max(cursor, range.endId + 1);
        if (cursor > endId) break;
    }

    if (cursor <= endId) {
        uncovered.push({ startId: cursor, endId });
    }

    return uncovered;
}

export function formatRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return '없음';
    return ranges
        .map(range => range.startId === range.endId
            ? `#${range.startId}`
            : `#${range.startId} ~ #${range.endId}`)
        .join(', ');
}
