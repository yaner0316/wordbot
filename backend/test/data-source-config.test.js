const test = require('node:test');
const assert = require('node:assert');
const {
    normalizeDataSource,
    getDataSource,
    isSupabase,
    isFeishu,
    getDataSourceConfig,
} = require('../data-source-config');

test('normalizeDataSource: supabase variants', () => {
    assert.strictEqual(normalizeDataSource('supabase'), 'supabase');
    assert.strictEqual(normalizeDataSource('SUPABASE'), 'supabase');
    assert.strictEqual(normalizeDataSource('  supabase  '), 'supabase');
});

test('normalizeDataSource: feishu variants', () => {
    assert.strictEqual(normalizeDataSource('feishu'), 'feishu');
    assert.strictEqual(normalizeDataSource('FEISHU'), 'feishu');
    assert.strictEqual(normalizeDataSource('  feishu  '), 'feishu');
});

test('normalizeDataSource: defaults to supabase for unknown values', () => {
    assert.strictEqual(normalizeDataSource('unknown'), 'supabase');
    assert.strictEqual(normalizeDataSource(''), 'supabase');
    assert.strictEqual(normalizeDataSource(null), 'supabase');
    assert.strictEqual(normalizeDataSource(undefined), 'supabase');
});

test('getDataSource: uses DATA_SOURCE when set', () => {
    const original = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = 'feishu';
    assert.strictEqual(getDataSource(), 'feishu');
    process.env.DATA_SOURCE = original;
});

test('getDataSource: falls back to WORDBOT_DATA_SOURCE', () => {
    const originalDataSource = process.env.DATA_SOURCE;
    const originalWordbot = process.env.WORDBOT_DATA_SOURCE;
    
    delete process.env.DATA_SOURCE;
    process.env.WORDBOT_DATA_SOURCE = 'feishu';
    assert.strictEqual(getDataSource(), 'feishu');
    
    process.env.DATA_SOURCE = originalDataSource;
    process.env.WORDBOT_DATA_SOURCE = originalWordbot;
});

test('getDataSource: defaults to supabase', () => {
    const originalDataSource = process.env.DATA_SOURCE;
    const originalWordbot = process.env.WORDBOT_DATA_SOURCE;
    
    delete process.env.DATA_SOURCE;
    delete process.env.WORDBOT_DATA_SOURCE;
    assert.strictEqual(getDataSource(), 'supabase');
    
    process.env.DATA_SOURCE = originalDataSource;
    process.env.WORDBOT_DATA_SOURCE = originalWordbot;
});

test('isSupabase: returns true when supabase', () => {
    const original = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = 'supabase';
    assert.strictEqual(isSupabase(), true);
    assert.strictEqual(isFeishu(), false);
    process.env.DATA_SOURCE = original;
});

test('isFeishu: returns true when feishu', () => {
    const original = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = 'feishu';
    assert.strictEqual(isFeishu(), true);
    assert.strictEqual(isSupabase(), false);
    process.env.DATA_SOURCE = original;
});

test('getDataSourceConfig: returns complete config', () => {
    const config = getDataSourceConfig();
    assert.ok(config.source);
    assert.ok(typeof config.isSupabase === 'boolean');
    assert.ok(typeof config.isFeishu === 'boolean');
    assert.ok(config.supabase);
    assert.ok(config.feishu);
    assert.ok(typeof config.supabase.configured === 'boolean');
    assert.ok(typeof config.feishu.configured === 'boolean');
});
