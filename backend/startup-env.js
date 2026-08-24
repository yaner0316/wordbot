'use strict';

const path = require('node:path');

// Injected production variables keep precedence; this only fills local gaps.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: false });

const PRODUCTION_SOURCE_VALUES = Object.freeze({
  DATA_SOURCE: new Set(['supabase']),
  WORDBOT_DATA_SOURCE: new Set(['supabase']),
  WORDBOT_CACHE_SOURCE: new Set(['db', 'supabase']),
});

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function assertProductionRuntimeEnvironment(env = process.env) {
  if (normalized(env.NODE_ENV) !== 'production') return;

  for (const [name, allowed] of Object.entries(PRODUCTION_SOURCE_VALUES)) {
    const value = normalized(env[name]);
    if (value && !allowed.has(value)) {
      throw new Error(`${name}=${value} is not supported in production`);
    }
  }

  if (!String(env.SUPABASE_URL || '').trim() || !String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production');
  }
}

module.exports = {
  assertProductionRuntimeEnvironment,
};
