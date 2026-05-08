const https = require('https');
const crypto = require('crypto');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const TABLE_ID = 'tblyMh69dws6ty6n';

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

function secureRandomSelect(arr, count) {
    if (arr.length <= count) return arr;
    const shuffled = [];
    const pool = [...arr];
    while (shuffled.length < count && pool.length > 0) {
        const index = crypto.randomInt(0, pool.length);
        shuffled.push(pool.splice(index, 1)[0]);
    }
    return shuffled;
}

function hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

class FeishuClient {
    async getRecords(filter = {}) {
        const token = await getToken();
        const res = await request('GET', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500`, null, token);
        let records = res.data?.items || [];
        
        if (filter.user) records = records.filter(r => r.fields?.user === filter.user);
        if (filter.status !== undefined) {
            records = records.filter(r => {
                const s = r.fields?.Status;
                return filter.status ? (Array.isArray(s) ? s.includes('Mastered') : s === 'Mastered') : (!s || (Array.isArray(s) ? !s.includes('Mastered') : s !== 'Mastered'));
            });
        }
        if (filter.minHours !== undefined) records = records.filter(r => hoursSince(r.fields?.record_time) >= filter.minHours);
        
        return records;
    }

    async addRecord(fields) {
        const token = await getToken();
        return request('POST', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, { fields }, token);
    }

    async updateRecord(recordId, fields) {
        const token = await getToken();
        return request('PUT', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`, { fields }, token);
    }

    async deleteRecord(recordId) {
        const token = await getToken();
        return request('DELETE', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`, null, token);
    }

    async selectRandomPendingWords(user, count = 10) {
        const records = await this.getRecords({ user, status: false, minHours: 18 });
        return secureRandomSelect(records, count);
    }
}

module.exports = { FeishuClient, secureRandomSelect, hoursSince };
