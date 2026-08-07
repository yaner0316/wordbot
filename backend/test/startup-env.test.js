'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BACKEND_DIR = path.join(__dirname, '..');

test('Supabase client loads without credentials and validates on first from or rpc call', () => {
  const startupPath = require.resolve('../startup-env');
  const clientPath = require.resolve('../supabase-client');
  const previousStartup = require.cache[startupPath];
  const previousClient = require.cache[clientPath];
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    require.cache[startupPath] = {
      id: startupPath,
      filename: startupPath,
      loaded: true,
      exports: {},
    };
    delete require.cache[clientPath];

    const client = require(clientPath);

    assert.throws(() => client.from('probe'), /SUPABASE_URL/);
    assert.throws(() => client.rpc('probe'), /SUPABASE_URL/);
  } finally {
    if (previousStartup) require.cache[startupPath] = previousStartup;
    else delete require.cache[startupPath];
    if (previousClient) require.cache[clientPath] = previousClient;
    else delete require.cache[clientPath];
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
test('startup environment explicitly preserves injected production variables', () => {
  const dotenvPath = require.resolve('dotenv');
  const startupPath = require.resolve('../startup-env');
  const previousDotenv = require.cache[dotenvPath];
  const previousStartup = require.cache[startupPath];
  const previousValue = process.env.WORDBOT_STARTUP_ENV_PRIORITY;
  let receivedOptions;

  try {
    process.env.WORDBOT_STARTUP_ENV_PRIORITY = 'injected';
    require.cache[dotenvPath] = {
      id: dotenvPath,
      filename: dotenvPath,
      loaded: true,
      exports: {
        config(options) {
          receivedOptions = options;
          if (options?.override !== false) {
            process.env.WORDBOT_STARTUP_ENV_PRIORITY = 'from-file';
          }
          return { parsed: {} };
        },
      },
    };
    delete require.cache[startupPath];

    require(startupPath);

    assert.equal(receivedOptions.override, false);
    assert.equal(process.env.WORDBOT_STARTUP_ENV_PRIORITY, 'injected');
  } finally {
    if (previousDotenv) require.cache[dotenvPath] = previousDotenv;
    else delete require.cache[dotenvPath];
    if (previousStartup) require.cache[startupPath] = previousStartup;
    else delete require.cache[startupPath];
    if (previousValue === undefined) delete process.env.WORDBOT_STARTUP_ENV_PRIORITY;
    else process.env.WORDBOT_STARTUP_ENV_PRIORITY = previousValue;
  }
});
