const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../auth-service');

function fixture({ stats = [], wordUsers = [] } = {}) {
    const added = [];
    const updated = [];
    const service = createAuthService({
        listAccountRecords: async () => stats,
        listWordUsers: async () => wordUsers,
        addAccountRecord: async fields => {
            added.push(fields);
            stats.push({ record_id: `stats-${stats.length + 1}`, fields });
        },
        updateAccountRecord: async (recordId, fields) => {
            updated.push({ recordId, fields });
            const record = stats.find(item => item.record_id === recordId);
            Object.assign(record.fields, fields);
        },
        ensureAccountFields: async () => {},
        randomBytes: size => Buffer.alloc(size, 7),
    });
    return { service, added, updated, stats };
}

test('register stores a salted password hash instead of the plaintext password', async () => {
    const { service, added } = fixture();

    const result = await service.register({ username: 'Draggy', password: 'secret1' });

    assert.deepEqual(result, { user: 'Draggy' });
    assert.equal(added[0].user, 'Draggy');
    assert.ok(added[0].auth_password_hash);
    assert.ok(added[0].auth_password_salt);
    assert.notEqual(added[0].auth_password_hash, 'secret1');
});

test('login accepts the registered password and rejects a wrong password', async () => {
    const { service } = fixture();
    await service.register({ username: 'qiuqiu', password: 'goodpass' });

    assert.deepEqual(await service.login({ username: 'qiuqiu', password: 'goodpass' }), { user: 'qiuqiu' });
    await assert.rejects(
        service.login({ username: 'qiuqiu', password: 'badpass' }),
        /密码错误/
    );
});

test('existing word-library users can bind a password on first registration', async () => {
    const { service, added } = fixture({ wordUsers: ['Draggy'] });

    await service.register({ username: 'Draggy', password: 'secret1' });

    assert.equal(added[0].user, 'Draggy');
    assert.deepEqual(await service.login({ username: 'Draggy', password: 'secret1' }), { user: 'Draggy' });
});

test('register rejects a different password for an account that already has credentials', async () => {
    const { service } = fixture();
    await service.register({ username: 'yusi', password: 'firstpass' });

    await assert.rejects(
        service.register({ username: 'yusi', password: 'secondpass' }),
        /用户已注册/
    );
});