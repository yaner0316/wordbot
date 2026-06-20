function tableKey(table) {
    return `${table?.appToken || ''}:${table?.tableId || ''}`;
}

function createTableCache({ ttlMs = 60000, now = Date.now } = {}) {
    const entries = new Map();

    async function get(table, loader) {
        const key = tableKey(table);
        const current = now();
        const cached = entries.get(key);
        if (cached && current < cached.expiresAt) return cached.value;
        const value = await loader();
        entries.set(key, { value, expiresAt: current + ttlMs });
        return value;
    }

    function invalidate(table) {
        if (!table) {
            entries.clear();
            return;
        }
        entries.delete(tableKey(table));
    }

    return { get, invalidate };
}

module.exports = { createTableCache, tableKey };