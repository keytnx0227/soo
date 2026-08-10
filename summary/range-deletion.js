export function createRecordDeletionPlan(records, selectedRecordIds) {
    const source = Array.isArray(records) ? records : [];
    const byId = new Map(source.map(record => [String(record.id), record]));
    const directlySelectedIds = new Set((Array.isArray(selectedRecordIds) ? selectedRecordIds : [])
        .map(String)
        .filter(id => byId.has(id)));
    const deletedIds = new Set(directlySelectedIds);

    for (const recordId of directlySelectedIds) {
        let parentId = normalizeId(byId.get(recordId)?.compressedBy);
        while (parentId && !deletedIds.has(parentId)) {
            deletedIds.add(parentId);
            parentId = normalizeId(byId.get(parentId)?.compressedBy);
        }
    }

    const deletedRecords = source
        .filter(record => deletedIds.has(String(record.id)))
        .map(record => toPlanRecord(record, directlySelectedIds.has(String(record.id))))
        .sort(compareRecords);
    const releasedRecords = source
        .filter(record => !deletedIds.has(String(record.id)) && deletedIds.has(normalizeId(record.compressedBy)))
        .map(record => toPlanRecord(record, false))
        .sort(compareRecords);

    return {
        selectedIds: [...directlySelectedIds],
        deletedIds: [...deletedIds],
        directRecords: deletedRecords.filter(record => record.direct),
        dependentRecords: deletedRecords.filter(record => !record.direct),
        releasedRecords,
    };
}

function toPlanRecord(record, direct) {
    return {
        id: String(record.id),
        type: record.type === 'compressed' || record.compression ? 'compressed' : 'summary',
        startId: Number(record.startId),
        endId: Number(record.endId),
        level: Number(record.compression?.level) || 0,
        direct,
    };
}

function normalizeId(value) {
    const id = String(value ?? '').trim();
    return id || null;
}

function compareRecords(left, right) {
    return left.startId - right.startId || left.endId - right.endId || left.id.localeCompare(right.id);
}
