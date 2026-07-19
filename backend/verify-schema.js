const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = require('./supabase-client');

const defaultExpectedTables = [
  'users',
  'words',
  'parts_of_speech',
  'word_parts_of_speech',
  'assessments',
  'question_cache',
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function getPublicTablesFromRestSchema() {
  const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: 'application/openapi+json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load REST schema: HTTP ${response.status} ${body}`);
  }

  const schema = await response.json();
  const definitions = schema.definitions || schema.components?.schemas || {};

  return Object.keys(definitions)
    .filter((name) => !name.startsWith('rpc_'))
    .sort((a, b) => a.localeCompare(b));
}

async function getRowCount(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    return { table, count: null, error: error.message };
  }

  return { table, count: count || 0, error: null };
}

async function main() {
  const expectedTables = process.argv.slice(2);
  let tables = expectedTables;
  if (tables.length === 0) {
    const restTables = await getPublicTablesFromRestSchema();
    tables = [...new Set([...restTables, ...defaultExpectedTables])]
      .sort((a, b) => a.localeCompare(b));
  }

  const results = [];
  for (const table of tables) {
    results.push(await getRowCount(table));
  }

  console.log(JSON.stringify({
    tables: results,
    expectedTables: expectedTables.length > 0 ? expectedTables : defaultExpectedTables,
  }, null, 2));

  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
