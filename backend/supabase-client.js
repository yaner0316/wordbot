'use strict';

require('./startup-env');

const { createClient } = require('@supabase/supabase-js');

let supabase;

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value;
}

function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(
      getEnv('SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  }
  return supabase;
}

module.exports = {
  from(...args) {
    return getSupabaseClient().from(...args);
  },
  rpc(...args) {
    return getSupabaseClient().rpc(...args);
  },
};
