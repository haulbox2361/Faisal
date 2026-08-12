// Connected Google accounts (OAuth tokens), keyed by "accountId" — either
// 'admin' or a dispatcher's id, matching exactly what the frontend sends as
// `accountId` on every /api and /auth call.
//
// Backed by Supabase Postgres (table google_tokens) instead of a local JSON
// file — Render's disk is wiped on every deploy/restart, so nothing here can
// live on local disk.

const { getPool, ensureSchema } = require('./db');

async function get(accountId) {
  if (!accountId) return null;
  await ensureSchema();
  const { rows } = await getPool().query(
    'SELECT email, tokens FROM google_tokens WHERE account_id=$1',
    [accountId]
  );
  if (!rows.length) return null;
  return { email: rows[0].email, tokens: rows[0].tokens };
}

async function set(accountId, record) {
  if (!accountId) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO google_tokens (account_id, email, tokens, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (account_id) DO UPDATE
       SET email = EXCLUDED.email, tokens = EXCLUDED.tokens, updated_at = now()`,
    [accountId, record.email, JSON.stringify(record.tokens)]
  );
}

async function remove(accountId) {
  if (!accountId) return;
  await ensureSchema();
  await getPool().query('DELETE FROM google_tokens WHERE account_id=$1', [accountId]);
}

// Moves a record from one key to another (used by /auth/claim: the OAuth
// popup only knows the throwaway loginAttemptId, so once the frontend
// figures out which real dispatcher/admin that email belongs to, it asks us
// to re-key the stored tokens under the real id).
async function claim(fromAccountId, toAccountId) {
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) return get(toAccountId);
  const rec = await get(fromAccountId);
  if (!rec) return get(toAccountId);
  await remove(fromAccountId);
  await set(toAccountId, rec);
  return rec;
}

module.exports = { get, set, remove, claim };
