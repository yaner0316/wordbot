const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword } = require('../auth-service');
const { createSupabaseAuthAdapter } = require('../supabase-auth');

function createFakeSupabase({ users = [], insertError = null } = {}) {
    const rows = users.map(row => ({ ...row }));
    const operations = [];

    class Query {
        constructor(table) {
            this.table = table;
            this.operation = 'select';
            this.payload = null;
            this.filters = [];
        }

        select(columns) {
            operations.push({ operation: 'select', table: this.table, columns });
            return this;
        }

        insert(payload) {
            this.operation = 'insert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            return this;
        }

        update(payload) {
            this.operation = 'update';
            this.payload = payload;
            return this;
        }

        eq(column, value) {
            this.filters.push({ column, value });
            return this;
        }

        maybeSingle() {
            return this.execute(true);
        }

        then(resolve, reject) {
            return this.execute(false).then(resolve, reject);
        }

        async execute(single) {
            assert.equal(this.table, 'users');
            operations.push({
                operation: this.operation,
                table: this.table,
                payload: this.payload,
                filters: this.filters.map(filter => ({ ...filter })),
            });
            const matches = row => this.filters.every(filter => row[filter.column] === filter.value);

            if (this.operation === 'select') {
                const found = rows.filter(matches);
                return { data: single ? found[0] || null : found, error: null };
            }

            if (this.operation === 'insert') {
                if (insertError) return { data: null, error: insertError };
                const inserted = this.payload.map(payload => {
                    const usernameKey = String(payload.username || '').trim().replace(/\s+/g, '').toLowerCase();
                    if (rows.some(row => row.username_key === usernameKey)) {
                        return null;
                    }
                    const row = {
                        id: `user-${rows.length + 1}`,
                        ...payload,
                        username_key: usernameKey,
                    };
                    rows.push(row);
                    return row;
                });
                if (inserted.includes(null)) {
                    return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                }
                return { data: inserted, error: null };
            }

            const updated = rows.filter(matches);
            updated.forEach(row => Object.assign(row, this.payload));
            return { data: updated, error: null };
        }
    }

    return {
        client: { from: table => new Query(table) },
        rows,
        operations,
    };
}

function credentials(password, salt) {
    return { password_hash: hashPassword(password, salt), password_salt: salt };
}

test('register writes a Supabase user and supports case-insensitive child login', async () => {
    const db = createFakeSupabase();
    const auth = createSupabaseAuthAdapter(db.client, {
        randomBytes: size => Buffer.alloc(size, 7),
    });

    assert.deepEqual(await auth.register({ username: ' Drag gy ', password: 'secret1' }), { user: 'Draggy' });
    assert.deepEqual(await auth.login({ username: 'DRAGGY', password: 'secret1' }), { user: 'Draggy' });

    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].username, 'Draggy');
    assert.equal(db.rows[0].username_key, 'draggy');
    assert.ok(db.rows[0].password_hash);
    assert.ok(db.rows[0].password_salt);
    assert.equal(Object.values(db.rows[0]).includes('secret1'), false);
    assert.match(db.rows[0].auth_created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Number.isNaN(Date.parse(db.rows[0].auth_created_at)), false);
    assert.ok(db.operations.some(operation =>
        operation.operation === 'select'
        && operation.filters?.some(filter => filter.column === 'username_key' && filter.value === 'draggy')
    ));
});

test('login accepts an existing PBKDF2 credential row without rewriting it', async () => {
    const stored = credentials('goodpass', '00112233445566778899aabbccddeeff');
    const db = createFakeSupabase({ users: [{
        id: 'user-qiuqiu',
        username: 'qiuqiu',
        username_key: 'qiuqiu',
        ...stored,
        auth_created_at: '2026-07-15T01:02:03.000Z',
    }] });
    const auth = createSupabaseAuthAdapter(db.client);

    assert.deepEqual(await auth.login({ username: ' QIU QIU ', password: 'goodpass' }), { user: 'qiuqiu' });
    await assert.rejects(auth.login({ username: 'qiuqiu', password: 'badpass' }), /username\/password error/);
    assert.equal(db.operations.some(operation => operation.operation === 'update'), false);
});

test('parent setup, parent login, and child password reset persist Supabase columns', async () => {
    const child = credentials('kidpass1', '11112222333344445555666677778888');
    const db = createFakeSupabase({ users: [{
        id: 'user-yusi',
        username: 'yusi',
        username_key: 'yusi',
        ...child,
        auth_created_at: '2026-07-15T01:02:03.000Z',
    }] });
    const auth = createSupabaseAuthAdapter(db.client, {
        randomBytes: size => Buffer.alloc(size, 9),
    });

    assert.deepEqual(await auth.setParentCredentials({
        user: 'YU SI',
        childPassword: 'kidpass1',
        parentUsername: ' Xiao Yan ',
        parentPassword: 'parent1',
    }), { ok: true, user: 'yusi', parentUsername: 'XiaoYan' });
    assert.deepEqual(await auth.verifyParentLogin({
        user: 'yusi',
        parentUsername: 'XIAOYAN',
        password: 'parent1',
    }), { ok: true, user: 'yusi', parentUsername: 'XiaoYan' });
    assert.match(db.rows[0].parent_created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(db.rows[0].parent_username, 'XiaoYan');
    assert.ok(db.rows[0].parent_password_hash);
    assert.ok(db.rows[0].parent_password_salt);

    assert.deepEqual(await auth.resetChildPassword({
        user: 'YUSI',
        parentUsername: 'xiaoyan',
        parentPassword: 'parent1',
        newPassword: 'newpass1',
    }), { ok: true, user: 'yusi' });
    assert.deepEqual(await auth.login({ username: 'yusi', password: 'newpass1' }), { user: 'yusi' });
    await assert.rejects(auth.login({ username: 'yusi', password: 'kidpass1' }), /username\/password error/);
    assert.match(db.rows[0].auth_created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('register updates an existing credential-free user while preserving stored casing', async () => {
    const db = createFakeSupabase({ users: [{
        id: 'user-draggy',
        username: 'Draggy',
        username_key: 'draggy',
        password_hash: null,
        password_salt: null,
    }] });
    const auth = createSupabaseAuthAdapter(db.client, {
        randomBytes: size => Buffer.alloc(size, 5),
    });

    assert.deepEqual(await auth.register({ username: 'DRAGGY', password: 'secret1' }), { user: 'Draggy' });
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].username, 'Draggy');
    assert.ok(db.rows[0].password_hash);
    assert.match(db.rows[0].auth_created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('a Supabase unique-key race becomes the stable already-registered error', async () => {
    const db = createFakeSupabase({
        insertError: {
            code: '23505',
            message: 'duplicate key value violates unique constraint users_username_key_unique',
        },
    });
    const auth = createSupabaseAuthAdapter(db.client, {
        randomBytes: size => Buffer.alloc(size, 3),
    });

    await assert.rejects(
        auth.register({ username: 'qiuqiu', password: 'goodpass' }),
        error => error.message === 'user already registered'
    );
});

test('database failures never expose the provider error message to auth clients', async () => {
    const marker = 'provider-secret-detail';
    const db = createFakeSupabase({
        insertError: {
            code: 'XX000',
            message: marker,
        },
    });
    const auth = createSupabaseAuthAdapter(db.client, {
        randomBytes: size => Buffer.alloc(size, 3),
    });

    await assert.rejects(
        auth.register({ username: 'qiuqiu', password: 'goodpass' }),
        error => error.message === 'authentication service unavailable'
            && error.code === 'AUTH_DATABASE_ERROR'
            && !error.message.includes(marker)
            && error.cause?.message === marker
    );
});
