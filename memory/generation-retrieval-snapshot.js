const SNAPSHOT_CHANGED_EVENT = 'stsm:last-generation-retrieval-changed';

let activeGeneration = null;
let pendingRetrieval = null;
let lastSnapshot = null;

export function beginGenerationRetrievalCapture(type, dryRun = false) {
    const generationType = String(type || 'normal');
    const supported = !dryRun && !['quiet', 'impersonate'].includes(generationType);
    activeGeneration = supported ? { type: generationType } : null;
    pendingRetrieval = null;
}

export function stageGenerationRetrieval(retrieval) {
    if (!activeGeneration || !retrieval) return;
    pendingRetrieval = {
        enabled: Boolean(retrieval.enabled),
        mode: retrieval.mode === 'relevance' ? 'relevance' : 'simple',
        contextMessageCount: Number(retrieval.contextMessageCount) || 0,
        injected: (retrieval.injected || []).map(snapshotResult),
    };
}

export function commitGenerationRetrievalCapture(dryRun = false) {
    if (!activeGeneration) return;
    if (!dryRun && pendingRetrieval) {
        lastSnapshot = {
            ...pendingRetrieval,
            generationType: activeGeneration.type,
            capturedAt: Date.now(),
        };
        dispatchSnapshotChanged();
    }
    activeGeneration = null;
    pendingRetrieval = null;
}

export function cancelGenerationRetrievalCapture() {
    activeGeneration = null;
    pendingRetrieval = null;
}

export function clearLastGenerationRetrievalSnapshot() {
    cancelGenerationRetrievalCapture();
    lastSnapshot = null;
    dispatchSnapshotChanged();
}

export function getLastGenerationRetrievalSnapshot() {
    return lastSnapshot ? structuredClone(lastSnapshot) : null;
}

function snapshotResult(result) {
    return {
        record: {
            id: String(result.record?.id || ''),
            startId: Number(result.record?.startId) || 0,
            endId: Number(result.record?.endId) || 0,
        },
        pinned: Boolean(result.pinned),
        score: Number(result.score) || 0,
        matchedConcepts: (result.matchedConcepts || []).map(concept => ({
            canonical: String(concept.canonical || ''),
            terms: (concept.terms || []).map(String),
            weight: Number(concept.weight) || 0,
        })),
        matchedTerms: (result.matchedTerms || []).map(String),
    };
}

function dispatchSnapshotChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(SNAPSHOT_CHANGED_EVENT, { detail: getLastGenerationRetrievalSnapshot() }));
}
