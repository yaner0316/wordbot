function createQuizRecordWriteStaging() {
    const writes = new Map();

    function stage(testId, writePromise) {
        if (!testId || !writePromise) return;
        const entry = { promise: null, error: null };
        entry.promise = Promise.resolve(writePromise)
            .catch(error => {
                entry.error = error;
            })
            .finally(() => {
                if (writes.get(testId) === entry && !entry.error) {
                    writes.delete(testId);
                }
            });
        writes.set(testId, entry);
    }

    async function waitFor(testId) {
        const pending = writes.get(testId);
        if (!pending) return;
        await pending.promise;
        writes.delete(testId);
        if (pending.error) throw pending.error;
    }

    function has(testId) {
        return writes.has(testId);
    }

    return { stage, waitFor, has };
}

module.exports = { createQuizRecordWriteStaging };
