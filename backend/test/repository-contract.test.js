const test = require('node:test');
const assert = require('node:assert/strict');

const { REQUIRED_REPOSITORIES, assertRepositoryShape } = require('../data/repository-contract');
const { createFeishuRepositories } = require('../data/feishu-repositories');
const { createRepositories } = require('../data/repository-factory');
const { getRuntimeHealth } = require('../runtime-health');

test('repository contract names the schema-informed data domains', () => {
    assert.deepEqual(Object.keys(REQUIRED_REPOSITORIES), [
        'accounts',
        'users',
        'words',
        'tests',
        'reviews',
        'questionCache',
        'stats',
        'maintenance',
    ]);
});

test('assertRepositoryShape rejects missing domain methods', () => {
    assert.throws(
        () => assertRepositoryShape({ accounts: {} }),
        /accounts\.findByUserId/
    );
});

test('Feishu repositories expose the required canonical contract', () => {
    const repositories = createFeishuRepositories({
        client: {},
        tables: {
            word: { appToken: 'word-app', tableId: 'word-table' },
            test: { appToken: 'test-app', tableId: 'test-table' },
            stats: { appToken: 'stats-app', tableId: 'stats-table' },
            questionCache: { appToken: 'cache-app', tableId: 'cache-table' },
        },
    });

    assert.equal(assertRepositoryShape(repositories), repositories);
    assert.equal(repositories.dataSource, 'feishu');
});

test('Feishu repositories wrap low-level table operations without moving business code', async () => {
    const calls = [];
    const client = {
        getRecords: async table => {
            calls.push(['getRecords', table.tableId]);
            return [{ record_id: 'word-1', fields: { user: 'student', Word: 'apple' } }];
        },
        searchRecords: async (table, filter, sort, timeout) => {
            calls.push(['searchRecords', table.tableId, filter, sort, timeout]);
            return [{ record_id: 'test-1', fields: { test_id: 'quiz-1' } }];
        },
        addRecord: async (table, fields) => {
            calls.push(['addRecord', table.tableId, fields]);
            return { code: 0, data: { record: { record_id: 'created-1' } } };
        },
        addRecords: async (table, fieldList) => {
            calls.push(['addRecords', table.tableId, fieldList]);
            return { code: 0 };
        },
        updateRecord: async (table, recordId, fields) => {
            calls.push(['updateRecord', table.tableId, recordId, fields]);
            return { code: 0 };
        },
    };
    const repositories = createFeishuRepositories({
        client,
        tables: {
            word: { appToken: 'word-app', tableId: 'word-table' },
            test: { appToken: 'test-app', tableId: 'test-table' },
            stats: { appToken: 'stats-app', tableId: 'stats-table' },
            questionCache: { appToken: 'cache-app', tableId: 'cache-table' },
        },
    });

    assert.deepEqual(await repositories.words.listByUser('student'), [
        {
            feishuRecordId: 'word-1',
            rawFields: { user: 'student', Word: 'apple' },
        },
    ]);
    assert.deepEqual(await repositories.tests.findByTestId('quiz-1'), [
        {
            feishuRecordId: 'test-1',
            rawFields: { test_id: 'quiz-1' },
        },
    ]);
    await repositories.words.create({ userId: 'student', word: 'pear', rawFields: { Word: 'pear' } });
    await repositories.tests.createMany([{ testId: 'quiz-2', rawFields: { test_id: 'quiz-2' } }]);
    await repositories.words.update('word-1', { status: 'Mastered', rawFields: { Status: 'Mastered' } });

    assert.deepEqual(calls, [
        ['getRecords', 'word-table'],
        ['searchRecords', 'test-table', {
            conjunction: 'and',
            conditions: [{ field_name: 'test_id', operator: 'is', value: ['quiz-1'] }],
        }, undefined, undefined],
        ['addRecord', 'word-table', { Word: 'pear' }],
        ['addRecords', 'test-table', [{ test_id: 'quiz-2' }]],
        ['updateRecord', 'word-table', 'word-1', { Status: 'Mastered' }],
    ]);
});

test('repository factory defaults to Feishu and validates the repository shape', () => {
    const repositories = createRepositories({
        env: {},
        feishuClient: {},
        tables: {
            word: { appToken: 'word-app', tableId: 'word-table' },
            test: { appToken: 'test-app', tableId: 'test-table' },
            stats: { appToken: 'stats-app', tableId: 'stats-table' },
            questionCache: { appToken: 'cache-app', tableId: 'cache-table' },
        },
    });

    assert.equal(repositories.dataSource, 'feishu');
    assert.equal(assertRepositoryShape(repositories), repositories);
});

test('runtime health reports the selected data source without changing env checks', () => {
    const health = getRuntimeHealth({
        env: {
            DATA_SOURCE: 'supabase',
            WORDBOT_DATA_SOURCE: 'feishu',
            FEISHU_APP_ID: 'app',
        },
        now: () => '2026-06-21T00:00:00.000Z',
    });

    assert.equal(health.dataSource, 'supabase');
    assert.equal(health.env.FEISHU_APP_ID, true);
    assert.equal(health.env.FEISHU_APP_SECRET, false);
});
