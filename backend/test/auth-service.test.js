const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../auth-service');

function fixture({ stats = [] } = {}) {
    const added = [];
    const updated = [];
    const service = createAuthService({
        listAccountRecords: async () => stats,
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
    await assert.rejects(service.login({ username: 'qiuqiu', password: 'badpass' }), /username\/password error/);
});

test('register no longer requires a phone number', async () => {
    const { service, added } = fixture();
    const result = await service.register({ username: 'yusi', password: 'secret1' });
    assert.deepEqual(result, { user: 'yusi' });
    assert.equal(added[0].phone, undefined);
});

test('username login and registration are case-insensitive while preserving stored casing', async () => {
    const { service } = fixture();
    await service.register({ username: 'yusi', password: 'secret1' });
    assert.deepEqual(await service.login({ username: 'Yusi', password: 'secret1' }), { user: 'yusi' });
    await assert.rejects(service.register({ username: 'YUSI', password: 'secret2' }), /already registered/);
});

test('phone-shaped identifiers are rejected instead of phone login', async () => {
    const { service } = fixture();
    await service.register({ username: 'Draggy', password: 'secret1' });
    await assert.rejects(service.login({ username: '15863061969', password: 'secret1' }), /phone number/);
    await assert.rejects(service.register({ username: '15863061969', password: 'secret1' }), /phone number/);
});

test('parent login is scoped to the current child account so parent usernames can overlap', async () => {
    const { service } = fixture();
    await service.register({ username: 'yusi', password: 'kidpass1' });
    await service.register({ username: 'qiuqiu', password: 'kidpass2' });
    await service.setParentCredentials({ user: 'yusi', childPassword: 'kidpass1', parentUsername: 'xiaoyan', parentPassword: 'parent1' });
    await service.setParentCredentials({ user: 'qiuqiu', childPassword: 'kidpass2', parentUsername: 'xiaoyan', parentPassword: 'parent2' });
    assert.deepEqual(
        await service.verifyParentLogin({ user: 'YUSI', parentUsername: 'Xiaoyan', password: 'parent1' }),
        { ok: true, user: 'yusi', parentUsername: 'xiaoyan' }
    );
    await assert.rejects(
        service.verifyParentLogin({ user: 'qiuqiu', parentUsername: 'xiaoyan', password: 'parent1' }),
        /parent username\/password error/
    );
});


test('parent can reset the child password after parent authentication', async () => {
    const { service } = fixture();
    await service.register({ username: 'yusi', password: 'oldpass' });
    await service.setParentCredentials({ user: 'yusi', childPassword: 'oldpass', parentUsername: 'xiaoyan', parentPassword: 'parent1' });

    assert.deepEqual(
        await service.resetChildPassword({ user: 'YUSI', parentUsername: 'Xiaoyan', parentPassword: 'parent1', newPassword: 'newpass' }),
        { ok: true, user: 'yusi' }
    );
    await assert.rejects(service.login({ username: 'yusi', password: 'oldpass' }), /username\/password error/);
    assert.deepEqual(await service.login({ username: 'yusi', password: 'newpass' }), { user: 'yusi' });
});

test('parent reset rejects wrong parent credentials without changing child password', async () => {
    const { service } = fixture();
    await service.register({ username: 'qiuqiu', password: 'oldpass' });
    await service.setParentCredentials({ user: 'qiuqiu', childPassword: 'oldpass', parentUsername: 'xiaoyan', parentPassword: 'parent1' });

    await assert.rejects(
        service.resetChildPassword({ user: 'qiuqiu', parentUsername: 'xiaoyan', parentPassword: 'wrongpass', newPassword: 'newpass' }),
        /parent username\/password error/
    );
    assert.deepEqual(await service.login({ username: 'qiuqiu', password: 'oldpass' }), { user: 'qiuqiu' });
    await assert.rejects(service.login({ username: 'qiuqiu', password: 'newpass' }), /username\/password error/);
});

test('changing an existing parent account requires child password and current parent password', async () => {
    const { service } = fixture();
    await service.register({ username: 'Draggy', password: 'kidpass1' });
    await service.setParentCredentials({ user: 'Draggy', childPassword: 'kidpass1', parentUsername: 'xiaoyan', parentPassword: 'oldpass' });
    await assert.rejects(
        service.setParentCredentials({ user: 'Draggy', childPassword: 'kidpass1', parentUsername: 'jp', parentPassword: 'newpass' }),
        /parent username\/password error/
    );
    await service.setParentCredentials({
        user: 'Draggy',
        childPassword: 'kidpass1',
        parentUsername: 'jp',
        parentPassword: 'newpass',
        currentParentUsername: 'xiaoyan',
        currentParentPassword: 'oldpass',
    });
    assert.deepEqual(await service.verifyParentLogin({ user: 'Draggy', parentUsername: 'jp', password: 'newpass' }), {
        ok: true,
        user: 'Draggy',
        parentUsername: 'jp',
    });
});

test('register uses targeted account lookup when available', async () => {
    const added = [];
    const lookupUsers = [];
    const service = createAuthService({
        listAccountRecords: async () => { throw new Error('full account scan should not run'); },
        findAccountRecord: async user => { lookupUsers.push(user); return null; },
        addAccountRecord: async fields => { added.push(fields); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => {},
        randomBytes: size => Buffer.alloc(size, 9),
    });
    await service.register({ username: ' Draggy ', password: 'secret1' });
    assert.deepEqual(lookupUsers, ['Draggy']);
    assert.equal(added[0].user, 'Draggy');
});

test('login uses targeted account lookup when available', async () => {
    const seed = fixture();
    await seed.service.register({ username: 'qiuqiu', password: 'goodpass' });
    const account = seed.stats[0];
    const lookupUsers = [];
    const service = createAuthService({
        listAccountRecords: async () => { throw new Error('full account scan should not run'); },
        findAccountRecord: async user => { lookupUsers.push(user); return account; },
        addAccountRecord: async () => { throw new Error('should not add'); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => {},
        randomBytes: size => Buffer.alloc(size, 9),
    });
    assert.deepEqual(await service.login({ username: 'qiuqiu', password: 'goodpass' }), { user: 'qiuqiu' });
    assert.deepEqual(lookupUsers, ['qiuqiu']);
});

test('login accepts Feishu text field objects for stored credentials', async () => {
    const seed = fixture();
    await seed.service.register({ username: 'qiuqiu', password: 'goodpass' });
    const account = seed.stats[0];
    account.fields.auth_password_hash = [{ text: account.fields.auth_password_hash }];
    account.fields.auth_password_salt = [{ text: account.fields.auth_password_salt }];
    assert.deepEqual(await seed.service.login({ username: 'qiuqiu', password: 'goodpass' }), { user: 'qiuqiu' });
});

test('account lookup falls back to full scan when targeted lookup fails', async () => {
    const logs = [];
    const stats = [{ record_id: 'stats-1', fields: { user: 'Draggy' } }];
    const service = createAuthService({
        listAccountRecords: async () => stats,
        findAccountRecord: async () => { throw new Error('search timeout'); },
        addAccountRecord: async () => { throw new Error('should not add'); },
        updateAccountRecord: async (recordId, fields) => {
            assert.equal(recordId, 'stats-1');
            Object.assign(stats[0].fields, fields);
        },
        ensureAccountFields: async () => {},
        logger: { warn: message => logs.push(message) },
        randomBytes: size => Buffer.alloc(size, 11),
    });
    await service.register({ username: 'Draggy', password: 'secret1' });
    assert.ok(stats[0].fields.auth_password_hash);
    assert.deepEqual(logs, ['targeted auth lookup failed, falling back to full scan']);
});

test('register times out account field preparation after a write failure', async () => {
    const logs = [];
    const service = createAuthService({
        listAccountRecords: async () => [],
        addAccountRecord: async () => { throw new Error('field not found'); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => new Promise(() => {}),
        logger: { warn: message => logs.push(message) },
        fieldPreparationTimeoutMs: 5,
        randomBytes: size => Buffer.alloc(size, 12),
    });
    await assert.rejects(service.register({ username: 'newkid', password: 'secret1' }), /auth account field preparation timed out/);
    assert.deepEqual(logs, ['auth credential write failed, ensuring account fields']);
});

test('register does not retry field recovery after a timeout', async () => {
    let ensureCalls = 0;
    const service = createAuthService({
        listAccountRecords: async () => [],
        addAccountRecord: async () => { throw new Error('Feishu request timeout after 5000ms: POST /records'); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => { ensureCalls++; },
        fieldPreparationTimeoutMs: 5,
        randomBytes: size => Buffer.alloc(size, 13),
    });
    await assert.rejects(service.register({ username: 'newkid', password: 'secret1' }), /Feishu request timeout/);
    assert.equal(ensureCalls, 0);
});
