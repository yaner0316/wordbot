const https = require('https');
const crypto = require('crypto');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const TABLE_ID = 'tblyMh69dws6ty6n';
const USER_ID = process.argv[2] || null;
const COUNT = parseInt(process.argv[3]) || 10;

function postRequest(path, body, token = null) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request({ hostname: 'open.feishu.cn', path, method: 'POST', headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function getRequest(path, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname: 'open.feishu.cn', path, method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        req.end();
    });
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
    const recordTime = new Date(dateStr).getTime();
    return (Date.now() - recordTime) / (1000 * 60 * 60);
}

async function getToken() {
    const result = await postRequest('/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return result.tenant_access_token;
}

async function getRecords(token) {
    const result = await getRequest(`/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500`, token);
    return result.data?.items || [];
}

async function main() {
    const token = await getToken();
    const records = await getRecords(token);

    const pending = records.filter(r => {
        const status = r.fields?.Status;
        const isPending = !status || (Array.isArray(status) ? !status.includes('Mastered') : status !== 'Mastered');
        const is18hOld = hoursSince(r.fields?.record_time) >= 18;
        const matchUser = !USER_ID || r.fields?.user === USER_ID;
        return isPending && is18hOld && matchUser;
    });

    const selected = secureRandomSelect(pending, COUNT);
    console.log(JSON.stringify({ count: selected.length, records: selected }, null, 2));
}

main();
