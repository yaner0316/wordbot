const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupabaseMirrorClient } = require('../db/supabase-mirror-client');
const { syncQuestionCacheRows } = require('../db/stage1-sync');
test('Supabase client upserts public.question_cache by Feishu record id', async () => {
    const requests = []; const client = createSupabaseMirrorClient({ url: 'https://example.supabase.co', serviceRoleKey: 'local-test-key', fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 201, text: async () => '[]', json: async () => [] }; } });
    await syncQuestionCacheRows(client, [{ feishu_record_id: 'q1' }]);
    assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/question_cache?on_conflict=feishu_record_id'); assert.equal(requests[0].options.method, 'POST'); assert.match(requests[0].options.headers.Prefer, /resolution=merge-duplicates/);
});
test('Stage 1 sync script only reads Feishu and has no Feishu write calls', () => { const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stage1-sync-feishu-to-db.js'), 'utf8'); assert.match(source, /getRecords \} = require\('\.\.\/feishu'\)/); assert.doesNotMatch(source, /addRecord|addRecords|updateRecord|deleteWord|addWord/); });
