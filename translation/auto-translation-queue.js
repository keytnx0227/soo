export function createAutoTranslationQueue({ translate, shouldContinue, onChange = () => {}, onError = () => {} }) {
    let tail = Promise.resolve();
    const state = { total: 0, completed: 0, failed: 0, skipped: 0, active: null };
    const notify = () => onChange({ ...state });
    return {
        enqueue(record) {
            state.total++;
            notify();
            tail = tail.then(async () => {
                if (!shouldContinue()) { state.skipped++; notify(); return; }
                state.active = record;
                notify();
                try {
                    await translate(record);
                    state.completed++;
                } catch (error) {
                    if (error?.code === 'STSM_TRANSLATION_DISCARDED') state.skipped++;
                    else { state.failed++; onError(error, record); }
                } finally {
                    state.active = null;
                    notify();
                }
            });
        },
        async drain() { await tail; return { ...state }; },
    };
}
