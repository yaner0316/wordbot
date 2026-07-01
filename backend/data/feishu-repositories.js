function requireTable(tables, name) {
    const table = tables?.[name];
    if (!table) throw new Error(`Missing Feishu table config: ${name}`);
    return table;
}

function requireClientMethod(client, method) {
    if (typeof client?.[method] !== 'function') {
        throw new Error(`Missing Feishu client method: ${method}`);
    }
    return client[method].bind(client);
}

function fieldsFrom(record) {
    return record?.rawFields || record?.fields || record || {};
}

function toCanonicalRecord(record) {
    return {
        feishuRecordId: record.record_id || record.feishuRecordId || record.recordId,
        rawFields: record.fields || record.rawFields || {},
    };
}

function isFieldValue(fields, fieldName, value) {
    if (!value) return true;
    return String(fields[fieldName] || '').toLowerCase() === String(value).toLowerCase();
}

function filterByField(records, fieldName, value) {
    return records
        .filter(record => isFieldValue(record.fields || {}, fieldName, value))
        .map(toCanonicalRecord);
}

function fieldFilter(fieldName, value) {
    return {
        conjunction: 'and',
        conditions: [{ field_name: fieldName, operator: 'is', value: [value] }],
    };
}

function createFeishuRepositories({ client, tables }) {
    const wordTable = requireTable(tables, 'word');
    const testTable = requireTable(tables, 'test');
    const statsTable = requireTable(tables, 'stats');
    const questionCacheTable = requireTable(tables, 'questionCache');

    async function getRecords(table) {
        return requireClientMethod(client, 'getRecords')(table);
    }

    async function searchRecords(table, filter, sort, timeout) {
        return requireClientMethod(client, 'searchRecords')(table, filter, sort, timeout);
    }

    async function addRecord(table, record) {
        return requireClientMethod(client, 'addRecord')(table, fieldsFrom(record));
    }

    async function addRecords(table, records) {
        return requireClientMethod(client, 'addRecords')(table, records.map(fieldsFrom));
    }

    async function updateRecord(table, recordId, patch) {
        return requireClientMethod(client, 'updateRecord')(table, recordId, fieldsFrom(patch));
    }

    async function deleteRecord(table, recordId) {
        if (typeof client?.deleteRecord === 'function') {
            return client.deleteRecord(table, recordId);
        }
        const request = requireClientMethod(client, 'request');
        const getToken = requireClientMethod(client, 'getToken');
        const token = await getToken();
        return request('DELETE', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, null, token);
    }

    return {
        dataSource: 'feishu',
        accounts: {
            async findByUserId(userId) {
                return filterByField(await getRecords(statsTable), 'user', userId)[0] || null;
            },
            async create(account) {
                return addRecord(statsTable, account);
            },
            async updateCredentials(feishuRecordId, credentials) {
                return updateRecord(statsTable, feishuRecordId, credentials);
            },
        },
        users: {
            async list() {
                return (await getRecords(statsTable)).map(toCanonicalRecord);
            },
            async getSettings(userId) {
                return filterByField(await getRecords(statsTable), 'user', userId)[0] || null;
            },
            async updateSettings(feishuRecordId, settings) {
                return updateRecord(statsTable, feishuRecordId, settings);
            },
        },
        words: {
            async listByUser(userId) {
                return filterByField(await getRecords(wordTable), 'user', userId);
            },
            async findByUserAndWord(userId, word) {
                return (await getRecords(wordTable))
                    .filter(record => isFieldValue(record.fields || {}, 'user', userId))
                    .filter(record => isFieldValue(record.fields || {}, 'Word', word))
                    .map(toCanonicalRecord);
            },
            async findByRecordId(feishuRecordId) {
                return (await getRecords(wordTable))
                    .map(toCanonicalRecord)
                    .find(record => record.feishuRecordId === feishuRecordId) || null;
            },
            async create(word) {
                return addRecord(wordTable, word);
            },
            async createMany(words) {
                return addRecords(wordTable, words);
            },
            async update(feishuRecordId, patch) {
                return updateRecord(wordTable, feishuRecordId, patch);
            },
            async delete(feishuRecordId) {
                return deleteRecord(wordTable, feishuRecordId);
            },
        },
        tests: {
            async listByUser(userId) {
                return filterByField(await getRecords(testTable), 'user', userId);
            },
            async findByTestId(testId) {
                return (await searchRecords(testTable, fieldFilter('test_id', testId))).map(toCanonicalRecord);
            },
            async createMany(testRecords) {
                return addRecords(testTable, testRecords);
            },
            async update(feishuRecordId, patch) {
                return updateRecord(testTable, feishuRecordId, patch);
            },
        },
        reviews: {
            async listByUser(userId) {
                return filterByField(await getRecords(testTable), 'user', userId);
            },
            async createMany(reviewItems) {
                return addRecords(testTable, reviewItems);
            },
            async update(feishuRecordId, patch) {
                return updateRecord(testTable, feishuRecordId, patch);
            },
        },
        questionCache: {
            async list(userId) {
                return filterByField(await getRecords(questionCacheTable), 'user', userId);
            },
            async createMany(items) {
                return addRecords(questionCacheTable, items);
            },
            async markUsed(feishuRecordId, patch) {
                return updateRecord(questionCacheTable, feishuRecordId, patch);
            },
        },
        stats: {
            async findByUser(userId) {
                return filterByField(await getRecords(statsTable), 'user', userId)[0] || null;
            },
            async listAll() {
                return (await getRecords(statsTable)).map(toCanonicalRecord);
            },
            async upsert(stat) {
                const records = filterByField(await getRecords(statsTable), 'user', stat.userId || fieldsFrom(stat).user);
                if (records[0]?.feishuRecordId) {
                    return updateRecord(statsTable, records[0].feishuRecordId, stat);
                }
                return addRecord(statsTable, stat);
            },
        },
        maintenance: {
            async deleteUserTestData(userId) {
                const records = filterByField(await getRecords(testTable), 'user', userId);
                return Promise.all(records.map(record => deleteRecord(testTable, record.feishuRecordId)));
            },
            async audit() {
                return {
                    dataSource: 'feishu',
                    tables: {
                        word: wordTable.tableId,
                        test: testTable.tableId,
                        stats: statsTable.tableId,
                        questionCache: questionCacheTable.tableId,
                    },
                };
            },
        },
    };
}

module.exports = {
    createFeishuRepositories,
};
