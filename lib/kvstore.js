// Generic key/value store backed by Supabase Postgres. This is the backend
// for /api/storage, which the frontend's window.storage polyfill calls —
// it's what replaces the Claude-artifact-only window.storage host so the
// app's data (loads, drivers, brokers, dispatchers, settings, chat...)
// actually persists for real, shared by every dispatcher and the admin.

const { getPool, ensureSchema } = require('./db');

let schemaEnsured = false;
async function checkSchema() {
  if (!schemaEnsured) {
    await ensureSchema();
    schemaEnsured = true;
  }
}

// In-memory cache for high-frequency reads (e.g. haulline:state)
const kvCache = new Map();
const CACHE_TTL_MS = 15000; // 15 seconds TTL

async function get(key, useCache = true) {
  if (useCache && key === 'haulline:state') {
    const cached = kvCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.value;
    }
  }

  await checkSchema();
  const { rows } = await getPool().query('SELECT value FROM kv_store WHERE key=$1', [key]);
  const value = rows.length ? rows[0].value : null;

  if (key === 'haulline:state') {
    kvCache.set(key, { value, timestamp: Date.now() });
  }

  return value;
}

async function set(key, value) {
  await checkSchema();
  await getPool().query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  if (key === 'haulline:state') {
    kvCache.set(key, { value, timestamp: Date.now() });
  }
}

async function del(key) {
  await checkSchema();
  await getPool().query('DELETE FROM kv_store WHERE key=$1', [key]);
  kvCache.delete(key);
}

async function list(prefix) {
  await checkSchema();
  const { rows } = prefix
    ? await getPool().query('SELECT key FROM kv_store WHERE key LIKE $1', [prefix.replace(/[%_]/g, '\\$&') + '%'])
    : await getPool().query('SELECT key FROM kv_store');
  return rows.map((r) => r.key);
}

function invalidateCache(key) {
  if (key) {
    kvCache.delete(key);
  } else {
    kvCache.clear();
  }
}

module.exports = { get, set, del, list, invalidateCache };

