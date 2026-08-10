const REVIEW_RANGE = Symbol('atlasReviewRange');
const EFFECTIVE_ID = Symbol('atlasEffectiveId');

export function compareAtlasSourceRecords(left, right) {
    const leftReview = Boolean(left?.atlasReview);
    const rightReview = Boolean(right?.atlasReview);
    const leftEffectiveId = getRecordEffectiveId(left);
    const rightEffectiveId = getRecordEffectiveId(right);
    return leftEffectiveId - rightEffectiveId
        || (leftReview !== rightReview ? leftReview ? 1 : -1 : 0)
        || (leftReview ? safeTimestamp(left.updatedAt || left.createdAt) - safeTimestamp(right.updatedAt || right.createdAt) : 0)
        || Number(left.startId) - Number(right.startId)
        || Number(left.endId) - Number(right.endId)
        || safeTimestamp(left.createdAt) - safeTimestamp(right.createdAt)
        || String(left.id).localeCompare(String(right.id));
}

export function getAtlasSourceRange(record) {
    const range = {
        startId: Number(record.startId),
        endId: Number(record.endId),
    };
    if (record?.atlasReview) {
        range[REVIEW_RANGE] = true;
    }
    range[EFFECTIVE_ID] = getRecordEffectiveId(record);
    return range;
}

export function canApplyAtlasReplacement(previousRange, nextRange) {
    if (!previousRange) return true;
    const previousEffectiveId = previousRange[EFFECTIVE_ID] ?? previousRange.endId;
    const nextEffectiveId = nextRange[EFFECTIVE_ID] ?? nextRange.endId;
    return nextEffectiveId >= previousEffectiveId;
}

function getRecordEffectiveId(record) {
    return Number(record?.atlasReview ? record.appliedThroughId : record?.endId) || 0;
}

function safeTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
