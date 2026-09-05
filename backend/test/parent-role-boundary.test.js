const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionStore } = require('../auth-middleware');
test('child sessions cannot mutate parent-managed learning data', async t => {
    const { startServer } = require('../server');
    const server = startServer(0, { enableQuestionGenerationWorker: false });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const cookie = sessionStore.cookie(sessionStore.issue('audit-child', 'user'));
    for (const [method, path] of [['PUT','/api/admin/userSettings'], ['POST','/api/admin/addWord'], ['POST','/api/admin/addWords'], ['POST','/api/admin/cleanup'], ['POST','/api/admin/reviewWords/mark'], ['POST','/api/admin/reviewWords/clear'], ['PUT','/api/word'], ['DELETE','/api/word']]) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method, headers:{cookie, 'Content-Type':'application/json'}, body: JSON.stringify({user:'audit-child'})});
        assert.equal(response.status, 403, `${method} ${path}`);
    }
});
test('parent middleware retains ownership checks', () => {
    const { requireParentSession } = require('../auth-middleware');
    assert.equal(typeof requireParentSession, 'function');
    for (const [role, target, status] of [['parent','audit-child',200],['parent','other-child',403],['user','audit-child',403]]) {
        const req = {get:()=>sessionStore.cookie(sessionStore.issue('audit-child',role)),body:{user:target}};
        const res = {code:200,status(code){this.code=code;return this;},json(){return this;}};
        let allowed=false;
        requireParentSession(req,res,()=>{allowed=true;});
        assert.equal(res.code,status);
        assert.equal(allowed,status===200);
    }
});
