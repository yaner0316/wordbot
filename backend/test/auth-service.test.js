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

    const result = await service.register({ username: 'Draggy', phone: '15863061969', password: 'secret1' });

    assert.deepEqual(result, { user: 'Draggy' });
    assert.equal(added[0].user, 'Draggy');
    assert.ok(added[0].auth_password_hash);
    assert.ok(added[0].auth_password_salt);
    assert.notEqual(added[0].auth_password_hash, 'secret1');
});

test('login accepts the registered password and rejects a wrong password', async () => {
    const { service } = fixture();
    await service.register({ username: 'qiuqiu', phone: '17321159980', password: 'goodpass' });

    assert.deepEqual(await service.login({ username: 'qiuqiu', password: 'goodpass' }), { user: 'qiuqiu' });
    await assert.rejects(
        service.login({ username: 'qiuqiu', password: 'badpass' }),
        /用户名\/密码错误/
    );
});

test('register requires a unique phone number and stores it with credentials', async () => {
    const { service, added } = fixture();

    await assert.rejects(
        service.register({ username: 'yusi', password: 'secret1' }),
        /请输入手机号/
    );

    const result = await service.register({ username: 'yusi', phone: '186 2182 3161', password: 'secret1' });

    assert.deepEqual(result, { user: 'yusi' });
    assert.equal(added[0].phone, '18621823161');
    await assert.rejects(
        service.register({ username: 'newkid', phone: '18621823161', password: 'secret2' }),
        /手机号已绑定其他账户/
    );
});

test('login accepts either username or phone with the bound password', async () => {
    const { service } = fixture();
    await service.register({ username: 'Draggy', phone: '15863061969', password: 'secret1' });

    assert.deepEqual(await service.login({ username: '15863061969', password: 'secret1' }), { user: 'Draggy' });
    await assert.rejects(
        service.login({ username: '15863061969', password: 'badpass' }),
        /用户名\/密码错误/
    );
});

test('phone otp can log in and can be verified for parent access', async () => {
    const { service } = fixture();
    await service.register({ username: 'qiuqiu', phone: '17321159980', password: 'goodpass' });

    const otp = await service.requestOtp({ phone: '17321159980', purpose: 'login' });
    assert.equal(otp.sent, true);
    assert.equal(otp.devOtp, '901063');
    assert.deepEqual(await service.loginWithOtp({ phone: '17321159980', otp: otp.devOtp }), { user: 'qiuqiu' });

    const parentOtp = await service.requestOtp({ phone: '17321159980', purpose: 'parent' });
    assert.deepEqual(
        await service.verifyParentOtp({ user: 'qiuqiu', phone: '17321159980', otp: parentOtp.devOtp }),
        { ok: true, user: 'qiuqiu' }
    );
});

test('existing word-library users can bind a password on first registration', async () => {
    const { service, added } = fixture({ wordUsers: ['Draggy'] });

    await service.register({ username: 'Draggy', phone: '15863061969', password: 'secret1' });

    assert.equal(added[0].user, 'Draggy');
    assert.deepEqual(await service.login({ username: 'Draggy', password: 'secret1' }), { user: 'Draggy' });
});

test('register rejects a different password for an account that already has credentials', async () => {
    const { service } = fixture();
    await service.register({ username: 'yusi', phone: '18621823161', password: 'firstpass' });

    await assert.rejects(
        service.register({ username: 'yusi', phone: '18621823161', password: 'secondpass' }),
        /用户已注册/
    );
});
test('register does not scan account fields before a normal credential write', async () => {
    let ensureCalls = 0;
    const added = [];
    const service = createAuthService({
        listAccountRecords: async () => [],
        listWordUsers: async () => [],
        addAccountRecord: async fields => { added.push(fields); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => {
            ensureCalls++;
            throw new Error('field scan should be lazy');
        },
        randomBytes: size => Buffer.alloc(size, 8),
    });

    await service.register({ username: 'Draggy', phone: '15863061969', password: 'secret1' });

    assert.equal(ensureCalls, 0);
    assert.equal(added[0].user, 'Draggy');
});

test('register uses targeted account lookup when available', async () => {
    const added = [];
    const lookupUsers = [];
    const service = createAuthService({
        listAccountRecords: async () => { throw new Error('full account scan should not run'); },
        findAccountRecord: async user => {
            lookupUsers.push(user);
            return null;
        },
        findAccountByPhone: async () => null,
        listWordUsers: async () => [],
        addAccountRecord: async fields => { added.push(fields); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => {},
        randomBytes: size => Buffer.alloc(size, 9),
    });

    await service.register({ username: ' Draggy ', phone: '15863061969', password: 'secret1' });

    assert.deepEqual(lookupUsers, ['Draggy']);
    assert.equal(added[0].user, 'Draggy');
});

test('login uses targeted account lookup when available', async () => {
    const seed = fixture();
    await seed.service.register({ username: 'qiuqiu', phone: '17321159980', password: 'goodpass' });
    const account = seed.stats[0];
    const lookupUsers = [];
    const service = createAuthService({
        listAccountRecords: async () => { throw new Error('full account scan should not run'); },
        findAccountRecord: async user => {
            lookupUsers.push(user);
            return account;
        },
        listWordUsers: async () => [],
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
    await seed.service.register({ username: 'qiuqiu', phone: '17321159980', password: 'goodpass' });
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
        listWordUsers: async () => [],
        addAccountRecord: async () => { throw new Error('should not add'); },
        updateAccountRecord: async (recordId, fields) => {
            assert.equal(recordId, 'stats-1');
            Object.assign(stats[0].fields, fields);
        },
        ensureAccountFields: async () => {},
        logger: { warn: message => logs.push(message) },
        randomBytes: size => Buffer.alloc(size, 11),
    });

    await service.register({ username: 'Draggy', phone: '15863061969', password: 'secret1' });

    assert.equal(stats[0].fields.user, 'Draggy');
    assert.ok(stats[0].fields.auth_password_hash);
    assert.deepEqual(logs, ['targeted auth lookup failed, falling back to full scan']);
});


test('register times out account field preparation after a write failure', async () => {
    const logs = [];
    const service = createAuthService({
        listAccountRecords: async () => [],
        listWordUsers: async () => [],
        addAccountRecord: async () => { throw new Error('field not found'); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => new Promise(() => {}),
        logger: { warn: message => logs.push(message) },
        fieldPreparationTimeoutMs: 5,
        randomBytes: size => Buffer.alloc(size, 12),
    });

    await assert.rejects(
        service.register({ username: 'newkid', phone: '13900000001', password: 'secret1' }),
        /auth account field preparation timed out/
    );
    assert.deepEqual(logs, ['auth credential write failed, ensuring account fields']);
});


test('register does not retry field recovery after a timeout', async () => {
    let ensureCalls = 0;
    const service = createAuthService({
        listAccountRecords: async () => [],
        listWordUsers: async () => [],
        addAccountRecord: async () => { throw new Error('Feishu request timeout after 5000ms: POST /records'); },
        updateAccountRecord: async () => { throw new Error('should not update'); },
        ensureAccountFields: async () => { ensureCalls++; },
        fieldPreparationTimeoutMs: 5,
        randomBytes: size => Buffer.alloc(size, 13),
    });

    await assert.rejects(
        service.register({ username: 'newkid', phone: '13900000001', password: 'secret1' }),
        /Feishu request timeout/
    );
    assert.equal(ensureCalls, 0);
});
