// Generic key/value store backed by Supabase Postgres. This is the backend
// for /api/storage, which the frontend's window.storage polyfill calls —
// it's what replaces the Claude-artifact-only window.storage host so the
// app's data (loads, drivers, brokers, dispatchers, settings, chat...)
// actually persists for real, shared by every dispatcher and the admin.

const { getPool, ensureSchema } = require('./db');

async function get(key) {
  await ensureSchema();
  const { rows } = await getPool().query('SELECT value FROM kv_store WHERE key=$1', [key]);
  return rows.length ? rows[0].value : null;
}

async function set(key, value) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

async function del(key) {
  await ensureSchema();
  await getPool().query('DELETE FROM kv_store WHERE key=$1', [key]);
}

async function list(prefix) {
  await ensureSchema();
  const { rows } = prefix
    ? await getPool().query('SELECT key FROM kv_store WHERE key LIKE $1', [prefix.replace(/[%_]/g, '\\$&') + '%'])
    : await getPool().query('SELECT key FROM kv_store');
  return rows.map((r) => r.key);
}

module.exports = { get, set, del, list };
