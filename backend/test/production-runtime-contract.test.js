const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..');
const DATA_SOURCE_PATH = path.join(BACKEND_DIR, 'data-source.js');
const SERVER_PATH = path.join(BACKEND_DIR, 'server.js');

function clearBackendModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(BACKEND_DIR)) delete require.cache[key];
  }
}

test('production server and data-source source files contain no Feishu runtime require', () => {
  for (const filename of [SERVER_PATH, DATA_SOURCE_PATH]) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /require\(\s*['"]\.\/?\.?\/feishu['"]\s*\)/);
    assert.doesNotMatch(source, /require\(\s*['"]\.\/?\.?\/config['"]\s*\)/);
    assert.doesNotMatch(source, /require\(\s*['"]\.\/?\.?\/data\/(?:feishu-client|feishu-repositories|repository-factory)['"]\s*\)/);
  }
});

test('loading the production data-source does not load Feishu or legacy config modules', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCacheSource = process.env.WORDBOT_CACHE_SOURCE;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalLoad = Module._load;
  const forbidden = new Set([
    './feishu',
    './config',
    './data/feishu-client',
    './data/feishu-repositories',
    './data/repository-factory',
  ]);

  try {
    process.env.NODE_ENV = 'production';
    process.env.WORDBOT_CACHE_SOURCE = 'db';
    process.env.SUPABASE_URL = 'https://wordbot.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    clearBackendModules();
    Module._load = function guardedLoad(request, parent, isMain) {
      if (forbidden.has(request)) throw new Error(`FORBIDDEN_LEGACY_MODULE_LOAD:${request}`);
      return originalLoad.call(this, request, parent, isMain);
    };

    const dataSource = require(DATA_SOURCE_PATH);
    assert.equal(dataSource.name, 'supabase');
  } finally {
    Module._load = originalLoad;
    clearBackendModules();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCacheSource === undefined) delete process.env.WORDBOT_CACHE_SOURCE;
    else process.env.WORDBOT_CACHE_SOURCE = previousCacheSource;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
