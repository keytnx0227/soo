import { renderCompressionSummary } from '../summary/compression-format.js';

export function resolveSegmentedRecall(records, selectedResults, {
    compressionTemplate,
    compressionOutputSections,
} = {}) {
    const source = Array.isArray(records) ? records : [];
    const byId = new Map(source.map(record => [String(record.id), record]));
    const selected = Array.isArray(selectedResults) ? selectedResults : [];
    const hitIds = new Set(selected.map(result => String(result.record.id)));
    const ancestorIds = buildAncestorIds(hitIds, byId);
    const roots = source
        .filter(record => !record.compressedBy)
        .sort(compareRecords);
    const output = roots.flatMap(record => {
        if (!record.compression?.data?.segments || !hasSelectedDescendant(record.id, hitIds, ancestorIds)) {
            return [record];
        }
        return resolveCompression(record, {
            byId,
            hitIds,
            ancestorIds,
            compressionTemplate,
            compressionOutputSections,
        });
    });
    return {
        records: output.sort(compareRecords),
        retrievedRecordIds: [...hitIds],
        pinnedRecordIds: selected.filter(result => result.pinned).map(result => String(result.record.id)),
    };
}

export function selectSegmentedRecallWithinBudget(candidates, budget, {
    records,
    countTokens,
    compressionTemplate,
    compressionOutputSections,
}) {
    const source = Array.isArray(candidates) ? candidates : [];
    const options = { compressionTemplate, compressionOutputSections };
    const baselineTokens = countRecallTokens(resolveSegmentedRecall(records, [], options).records, countTokens);
    const selected = [];
    const omitted = [];

    for (const candidate of source) {
        const next = [...selected, candidate];
        const resolved = resolveSegmentedRecall(records, next, options);
        const extraTokens = Math.max(0, countRecallTokens(resolved.records, countTokens) - baselineTokens);
        if (extraTokens <= budget) selected.push(candidate);
        else omitted.push(candidate);
    }
    return { selected, omitted };
}

function resolveCompression(record, state) {
    return record.compression.data.segments.flatMap(segment => {
        const child = state.byId.get(String(segment.sourceRecordId));
        if (!child) return [];
        const directHit = state.hitIds.has(child.id);
        const lowerHit = state.ancestorIds.has(child.id);
        if (lowerHit && child.compression?.data?.segments) {
            return resolveCompression(child, state);
        }
        if (directHit) return [child];
        return [createCompactRecord(record, child, segment, state)];
    });
}

function createCompactRecord(parent, source, segment, state) {
    return {
        id: `compact:${parent.id}:${source.id}`,
        type: 'compact-segment',
        compressedBy: null,
        pinned: false,
        startId: source.startId,
        endId: source.endId,
        content: renderCompressionSummary(segment.compactData, {
            startId: source.startId,
            endId: source.endId,
            template: state.compressionTemplate,
            outputSections: state.compressionOutputSections,
        }),
    };
}

function buildAncestorIds(hitIds, byId) {
    const ancestors = new Set();
    for (const hitId of hitIds) {
        let parentId = byId.get(hitId)?.compressedBy;
        while (parentId && !ancestors.has(String(parentId))) {
            ancestors.add(String(parentId));
            parentId = byId.get(String(parentId))?.compressedBy;
        }
    }
    return ancestors;
}

function hasSelectedDescendant(recordId, hitIds, ancestorIds) {
    return hitIds.has(String(recordId)) || ancestorIds.has(String(recordId));
}

function compareRecords(left, right) {
    return left.startId - right.startId || left.endId - right.endId || String(left.id).localeCompare(String(right.id));
}

function countRecallTokens(records, countTokens) {
    return (Array.isArray(records) ? records : [])
        .reduce((sum, record) => sum + countTokens(String(record.content || '')), 0);
}
