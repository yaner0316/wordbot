function createQuizRecordWriteStaging() {
    const writes = new Map();

    function stage(testId, writePromise) {
        if (!testId || !writePromise) return;
        const wrapped = Promise.resolve(writePromise).finally(() => {
            if (writes.get(testId) === wrapped) {
                writes.delete(testId);
            }
        });
        writes.set(testId, wrapped);
    }

    async function waitFor(testId) {
        const pending = writes.get(testId);
        if (pending) await pending;
    }

    function has(testId) {
        return writes.has(testId);
    }

    return { stage, waitFor, has };
}

module.exports = { createQuizRecordWriteStaging };
