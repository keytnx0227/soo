export const REFERENCE_SEGMENT = 'reference';

export function getCompressionInputSources(sources, data = {}) {
    const excluded = new Set(data.excludedSourceIds || []);
    return sources.filter(source => !excluded.has(source.id));
}

// Reference segments belong to storage, never to the LLM response contract.
export function attachCompressionReferences(data, sources, excludedSourceIds, segmented) {
    const excluded = new Set(excludedSourceIds || []);
    if (!excluded.size) return data;
    const result = { ...data, excludedSourceIds: [...excluded] };
    if (segmented) {
        const byId = new Map(data.segments.map(segment => [segment.sourceRecordId, segment]));
        result.segments = sources.map(source => {
            if (excluded.has(source.id)) return { kind: REFERENCE_SEGMENT, sourceRecordId: source.id };
            const segment = byId.get(source.id);
            if (!segment) throw new Error('압축 결과의 원본 연결이 누락되었습니다.');
            return segment;
        });
    }
    return result;
}

export function compressionDataForModel(data) {
    const { excludedSourceIds, ...result } = data;
    if (Array.isArray(result.segments)) {
        result.segments = result.segments.filter(segment => segment.kind !== REFERENCE_SEGMENT)
            .map((segment, index) => ({ ...segment, sourceIndex: index + 1 }));
    }
    return result;
}
