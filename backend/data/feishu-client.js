const defaultHttps = require('https');
const { createTableCache } = require('../table-cache');

function createDefaultRequest({ httpsModule, defaultTimeoutMs }) {
    return function request(method, path, body, token, timeoutOverrideMs) {
        const timeoutMs = Number(timeoutOverrideMs || defaultTimeoutMs || 15000);
        return new Promise((resolve, reject) => {
            const data = body ? JSON.stringify(body) : null;
            const headers = { 'Content-Type': 'application/json' };
            if (data) headers['Content-Length'] = Buffer.byteLength(data);
            if (token) headers.Authorization = 'Bearer ' + token;
            let settled = false;
            let req;
            let totalTimer;
            function settle(callback, value) {
                if (settled) return;
                settled = true;
                clearTimeout(totalTimer);
                callback(value);
            }
            req = httpsModule.request({ hostname: 'open.feishu.cn', path, method, headers, timeout: timeoutMs }, res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        settle(resolve, JSON.parse(Buffer.concat(chunks).toString()));
                    } catch {
                        settle(resolve, {});
                    }
                });
            });
            totalTimer = setTimeout(() => {
                req.destroy(new Error(`Feishu request timeout after ${timeoutMs}ms: ${method} ${path}`));
            }, timeoutMs);
            req.on('timeout', () => {
                req.destroy(new Error(`Feishu request timeout after ${timeoutMs}ms: ${method} ${path}`));
            });
            req.on('error', error => settle(reject, error));
            if (data) req.write(data);
            req.end();
        });
    };
}

function createFeishuClient({
    appId,
    appSecret,
    env = process.env,
    httpsModule = defaultHttps,
    requestImpl,
    requestTimeoutMs = Number(env.WORDBOT_FEISHU_REQUEST_TIMEOUT_MS || 15000),
    recordsCacheTtlMs = Number(env.WORDBOT_FEISHU_RECORDS_CACHE_TTL_MS || 60000),
} = {}) {
    const request = requestImpl || createDefaultRequest({ httpsModule, defaultTimeoutMs: requestTimeoutMs });
    const recordsCache = createTableCache({ ttlMs: recordsCacheTtlMs });
    let cachedToken = null;
    let tokenExpiry = 0;

    async function getToken() {
        if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
        const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: appId,
            app_secret: appSecret,
        });
        cachedToken = res.tenant_access_token;
        tokenExpiry = Date.now() + (res.expire || 7200) * 1000 - 60000;
        return cachedToken;
    }

    async function loadRecordsFromFeishu(table) {
        const token = await getToken();
        const allRecords = [];
        let pageToken = null;
        do {
            let url = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`;
            if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
            const res = await request('GET', url, null, token);
            const items = res.data?.items || [];
            allRecords.push(...items);
            pageToken = res.data?.page_token;
        } while (pageToken);
        console.log(`getRecords: table=${table.tableId} records=${allRecords.length}`);
        return allRecords;
    }

    async function getRecords(table) {
        return recordsCache.get(table, () => loadRecordsFromFeishu(table));
    }

    function invalidateRecordsCache(table) {
        recordsCache.invalidate(table);
    }

    async function searchRecords(table, filter, sort, timeout = 30000) {
        const token = await getToken();
        const allRecords = [];
        let pageToken = null;
        let prevPageToken = null;
        const body = { page_size: 500 };
        if (filter) body.filter = filter;
        if (sort) body.sort = sort;

        const startTime = Date.now();
        let pageCount = 0;
        do {
            pageCount++;
            if (pageToken) body.page_token = pageToken;
            if (Date.now() - startTime > timeout) {
                console.error(`searchRecords timeout after ${Date.now() - startTime}ms, pages=${pageCount}, records=${allRecords.length}`);
                throw new Error('search timeout');
            }
            const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/search`, body, token, timeout);
            const items = res.data?.items || [];
            allRecords.push(...items);
            prevPageToken = pageToken;
            pageToken = res.data?.page_token;
            if (pageToken && pageToken === prevPageToken) {
                console.warn(`searchRecords: repeated page_token, stopping pagination (table=${table.tableId})`);
                break;
            }
        } while (pageToken);
        console.log(`searchRecords: table=${table.tableId} records=${allRecords.length}`);
        return allRecords;
    }

    async function addRecord(table, fields, timeoutOverrideMs) {
        const token = await getToken();
        console.log('getRecords request', table.appToken, table.tableId);
        console.log('getRecords filter', JSON.stringify(fields));
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token, timeoutOverrideMs);
        console.log('getRecords response', JSON.stringify(res).substring(0, 200));
        if (res.code !== 0) {
            throw new Error('Feishu add record failed: ' + (res.msg || res.code));
        }
        invalidateRecordsCache(table);
        return res;
    }

    async function addRecords(table, fieldList) {
        const token = await getToken();
        const records = fieldList.map(fields => ({ fields }));
        console.log(`addRecords request table=${table.appToken}/${table.tableId} count=${records.length}`);
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/batch_create`, { records }, token);
        console.log('addRecords response', JSON.stringify(res).substring(0, 200));
        if (res.code !== 0) {
            throw new Error('Feishu add records failed: ' + (res.msg || res.code));
        }
        invalidateRecordsCache(table);
        return res;
    }

    async function listTableFields(table, timeoutOverrideMs) {
        const token = await getToken();
        const fields = [];
        let pageToken = null;
        let prevPageToken = null;
        do {
            let url = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields?page_size=100`;
            if (pageToken) url += `&page_token=${pageToken}`;
            const res = await request('GET', url, null, token, timeoutOverrideMs);
            if (res.code !== 0) throw new Error('Feishu list table fields failed: ' + (res.msg || res.code));
            fields.push(...(res.data?.items || []));
            prevPageToken = pageToken;
            pageToken = res.data?.page_token;
            if (pageToken && pageToken === prevPageToken) {
                console.warn(`listTableFields: repeated page_token, stopping pagination (table=${table.tableId})`);
                break;
            }
        } while (pageToken);
        return fields;
    }

    async function createTableField(table, field, timeoutOverrideMs) {
        const token = await getToken();
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields`, field, token, timeoutOverrideMs);
        if (res.code !== 0 && res.msg !== 'FieldNameDuplicated') {
            throw new Error('Feishu create table field failed: ' + (res.msg || res.code));
        }
    }

    async function updateRecord(table, recordId, fields, timeoutOverrideMs) {
        const token = await getToken();
        const res = await request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token, timeoutOverrideMs);
        console.log('updateRecord response', JSON.stringify(res).substring(0, 200));
        if (res.code !== 0) {
            throw new Error('Feishu update record failed: ' + (res.msg || res.code));
        }
        invalidateRecordsCache(table);
        return res;
    }

    return {
        request,
        getToken,
        getRecords,
        searchRecords,
        addRecord,
        addRecords,
        updateRecord,
        listTableFields,
        createTableField,
        invalidateRecordsCache,
    };
}

module.exports = {
    createFeishuClient,
};