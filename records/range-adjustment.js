export function createRangeShiftProposal(records, { threshold, delta, chatLength }) {
    if (!Number.isInteger(threshold) || threshold < 0) throw new Error('기준 ID를 올바르게 입력해주세요.');
    if (!Number.isInteger(delta) || delta === 0) throw new Error('변경 메시지 개수는 1 이상의 정수여야 합니다.');

    const sourceRecords = Array.isArray(records) ? records : [];
    const proposal = delta < 0
        ? createDeletionProposal(sourceRecords, threshold, Math.abs(delta))
        : createInsertionProposal(sourceRecords, threshold, delta);
    const { changes } = proposal;

    if (!changes.length) throw new Error(`#${threshold} 이후에 교정할 요약 기록이 없습니다.`);
    for (const change of changes) {
        if (change.startId < 0 || change.endId < change.startId) {
            throw new Error(`${formatRange(change.oldStartId, change.oldEndId)}의 이동 결과가 올바르지 않습니다.`);
        }
        if (Number.isInteger(chatLength) && change.endId >= chatLength) {
            throw new Error(`${formatRange(change.oldStartId, change.oldEndId)}의 이동 결과가 현재 마지막 채팅 ID를 벗어납니다.`);
        }
    }

    const changeMap = new Map(changes.map(change => [change.id, change]));
    const finalRanges = sourceRecords
        .map(record => {
            const change = changeMap.get(record.id);
            return {
                id: record.id,
                startId: change?.startId ?? record.startId,
                endId: change?.endId ?? record.endId,
            };
        })
        .sort((left, right) => left.startId - right.startId || left.endId - right.endId);

    for (let index = 1; index < finalRanges.length; index += 1) {
        const previous = finalRanges[index - 1];
        const current = finalRanges[index];
        if (current.startId <= previous.endId) {
            throw new Error(`교정 후 ${formatRange(previous.startId, previous.endId)}와 ${formatRange(current.startId, current.endId)}가 겹칩니다.`);
        }
    }

    return { threshold, delta, ...proposal };
}

function createDeletionProposal(records, threshold, amount) {
    const deletedEndId = threshold + amount - 1;
    const fullyDeleted = records.filter(record => (
        record.startId >= threshold && record.endId <= deletedEndId
    ));
    if (fullyDeleted.length) {
        throw new Error(`삭제 범위에 완전히 포함되는 요약 기록(${fullyDeleted.map(record => formatRange(record.startId, record.endId)).join(', ')})을 먼저 확인해주세요.`);
    }

    const changes = records.flatMap(record => {
        if (record.endId < threshold) return [];
        if (record.startId > deletedEndId) {
            return [createChange(record, record.startId - amount, record.endId - amount)];
        }

        const startId = record.startId < threshold ? record.startId : threshold;
        const endId = record.endId > deletedEndId ? record.endId - amount : threshold - 1;
        return [createChange(record, startId, endId)];
    });

    return {
        mode: 'deletion',
        affectedStartId: threshold,
        affectedEndId: deletedEndId,
        changes,
        crossing: [],
    };
}

function createInsertionProposal(records, threshold, amount) {
    const crossing = records.filter(record => record.startId < threshold && record.endId >= threshold);
    if (crossing.length) {
        throw new Error(`추가 위치가 요약 기록(${crossing.map(record => formatRange(record.startId, record.endId)).join(', ')}) 내부에 있어 단일 범위로 교정할 수 없습니다.`);
    }

    return {
        mode: 'insertion',
        affectedStartId: threshold,
        affectedEndId: threshold + amount - 1,
        changes: records
            .filter(record => record.startId >= threshold)
            .map(record => createChange(record, record.startId + amount, record.endId + amount)),
        crossing: [],
    };
}

function createChange(record, startId, endId) {
    return {
        id: record.id,
        oldStartId: record.startId,
        oldEndId: record.endId,
        startId,
        endId,
    };
}

export function formatRange(startId, endId) {
    return startId === endId ? `#${startId}` : `#${startId} ~ #${endId}`;
}
