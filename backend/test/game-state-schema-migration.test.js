'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(__dirname, '..', 'migrations', '20260824_game_states.sql');

test('game state migration is transactional, idempotent, and service-role only', async () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /^begin;/im);
    assert.match(sql, /commit;\s*$/im);
    assert.match(sql, /create table if not exists public\.game_states/i);
    assert.match(sql, /alter table public\.game_states enable row level security/i);
    assert.match(sql, /revoke all on table public\.game_states from public, anon, authenticated, service_role/i);
    assert.match(sql, /grant select, insert, update on table public\.game_states to service_role/i);
    assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to service_role/i);

    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role;
            create table public.users (id uuid primary key);
        `);
        await db.exec(sql);
        await db.exec('grant delete on table public.game_states to service_role;');
        await db.exec(sql);
        const result = await db.query(`
            select
                to_regclass('public.game_states') is not null as table_exists,
                (select relrowsecurity from pg_class where oid = 'public.game_states'::regclass) as rls_enabled,
                has_table_privilege('service_role', 'public.game_states', 'SELECT') as service_role_select,
                has_table_privilege('service_role', 'public.game_states', 'INSERT') as service_role_insert,
                has_table_privilege('service_role', 'public.game_states', 'UPDATE') as service_role_update,
                has_table_privilege('service_role', 'public.game_states', 'DELETE') as service_role_delete,
                has_table_privilege('anon', 'public.game_states', 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
                has_table_privilege('authenticated', 'public.game_states', 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
        `);
        assert.deepEqual(result.rows[0], {
            table_exists: true,
            rls_enabled: true,
            service_role_select: true,
            service_role_insert: true,
            service_role_update: true,
            service_role_delete: false,
            anon_access: false,
            authenticated_access: false,
        });
    } finally {
        await db.close();
    }
});
