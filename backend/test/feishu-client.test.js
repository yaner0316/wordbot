const test = require('node:test');
const assert = require('node:assert/strict');

const { createFeishuClient } = require('../data/feishu-client');

test('createFeishuClient exposes the low-level Feishu data operations', () => {
    const client = createFeishuClient({
        appId: 'app-id',
        appSecret: 'app-secret',
        httpsModule: {},
    });

    for (const method of [
        'request',
        'getToken',
        'getRecords',
        'searchRecords',
        'addRecord',
        'addRecords',
        'updateRecord',
        'listTableFields',
        'createTableField',
        'invalidateRecordsCache',
    ]) {
        assert.equal(typeof client[method], 'function', method);
    }
});

test('client record cache invalidates after writes', async () => {
    const table = { appToken: 'app', tableId: 'table' };
    const requests = [];
    const responses = [
        { tenant_access_token: 'token', expire: 7200 },
        { code: 0, data: { items: [{ record_id: 'r1', fields: {} }] } },
        { code: 0, data: { record: { record_id: 'created' } } },
        { code: 0, data: { items: [{ record_id: 'r2', fields: {} }] } },
    ];
    const client = createFeishuClient({
        appId: 'app-id',
        appSecret: 'app-secret',
        requestImpl: async (...args) => {
            requests.push(args);
            return responses.shift();
        },
        recordsCacheTtlMs: 60000,
    });

    assert.deepEqual((await client.getRecords(table)).map(record => record.record_id), ['r1']);
    assert.deepEqual((await client.getRecords(table)).map(record => record.record_id), ['r1']);
    await client.addRecord(table, { Word: 'apple' });
    assert.deepEqual((await client.getRecords(table)).map(record => record.record_id), ['r2']);

    const recordListRequests = requests.filter(([, url]) => url.includes('/records?page_size=500'));
    assert.equal(recordListRequests.length, 2);
});