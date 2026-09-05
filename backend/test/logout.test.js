const test = require('node:test');
const assert = require('node:assert/strict');
test('logout expires the browser session cookie with matching attributes', async t => {
    const { startServer } = require('../server');
    const server = startServer(0, { enableQuestionGenerationWorker:false });
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/logout`,{method:'POST'});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie') || '', /wordbot_session=; Path=\/; HttpOnly; Max-Age=0/);
});
