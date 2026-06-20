const test = require('node:test');
const assert = require('node:assert/strict');
const { createTableCache } = require('../table-cache');

test('table cache reuses reads inside ttl and expires afterward', async () => {
    let now = 1000;
    let loads = 0;
    const cache = createTableCache({ ttlMs: 100, now: () => now });
    const table = { appToken: 'app', tableId: 'tbl' };

    const first = await cache.get(table, async () => [{ id: ++loads }]);
    const second = await cache.get(table, async () => [{ id: ++loads }]);
    now += 101;
    const third = await cache.get(table, async () => [{ id: ++loads }]);

    assert.equal(first, second);
    assert.notEqual(second, third);
    assert.equal(loads, 2);
});

test('table cache invalidates one table without clearing others', async () => {
    const cache = createTableCache({ ttlMs: 1000 });
    const a = { appToken: 'app', tableId: 'a' };
    const b = { appToken: 'app', tableId: 'b' };
    let loadsA = 0;
    let loadsB = 0;

    await cache.get(a, async () => [{ id: ++loadsA }]);
    await cache.get(b, async () => [{ id: ++loadsB }]);
    cache.invalidate(a);
    await cache.get(a, async () => [{ id: ++loadsA }]);
    await cache.get(b, async () => [{ id: ++loadsB }]);

    assert.equal(loadsA, 2);
    assert.equal(loadsB, 1);
});