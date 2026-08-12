// Shared Postgres connection (Supabase) for both the app's data (kv_store)
// and connected Google account tokens (google_tokens). Render's own disk is
// wiped on every deploy, so nothing here may live on local disk.

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and paste your Supabase connection string — see README.md.'
    );
  }
  pool = new Pool({
    connectionString,
    // Supabase requires SSL; skipping CA verification is the standard
    // workaround since most hosts (including Render) don't ship Supabase's
    // CA bundle by default.
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  
  const pool = getPool();
  try {
    const tableExists = await pool.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations'
    `);
    if (tableExists.rows.length > 0) {
      const hasCol = await pool.query(`
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'participant_a_type'
      `);
      if (hasCol.rows.length === 0) {
        console.log('Legacy conversations table detected. Dropping old chat tables to recreate with correct schema...');
        await pool.query(`
          DROP TABLE IF EXISTS messages CASCADE;
          DROP TABLE IF EXISTS conversation_participants CASCADE;
          DROP TABLE IF EXISTS conversations CASCADE;
        `);
      }
    }
  } catch (e) {
    console.error('Failed to check/cleanup legacy tables:', e);
  }

  schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS google_tokens (
      account_id TEXT PRIMARY KEY,
      email TEXT,
      tokens JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Append-only timeline per load (status changes, doc uploads, driver
    -- checkpoints). Independent of the kv_store blob since it's an
    -- append-only log, not app state that gets overwritten wholesale.
    CREATE TABLE IF NOT EXISTS load_history (
      id SERIAL PRIMARY KEY,
      load_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      note TEXT,
      actor_type TEXT NOT NULL, -- 'admin' | 'dispatcher' | 'driver' | 'system'
      actor_id TEXT,
      actor_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS load_history_load_id_idx ON load_history(load_id);

    -- Notification center, shared by the driver app and the dispatch web app.
    -- recipient_type/recipient_id mirror the accountId scheme already used
    -- for Google auth ('admin' | dispatcher id | driver id).
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_type TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data JSONB,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_type, recipient_id);

    -- One row per pair of participants. Participant identity is
    -- (type, id) just like notifications/google_tokens, so a driver, a
    -- dispatcher, and 'admin' can all be addressed the same way.
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      participant_a_type TEXT NOT NULL,
      participant_a_id TEXT NOT NULL,
      participant_b_type TEXT NOT NULL,
      participant_b_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (participant_a_type, participant_a_id, participant_b_type, participant_b_id)
    );

    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name TEXT;

    -- Membership for group conversations (Driver/Dispatcher/Admin/Owner
    -- group chats). Direct 1:1 chats keep using the participant_a/b columns
    -- above unchanged; group chats additionally list every member here.
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      participant_type TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      participant_name TEXT,
      PRIMARY KEY (conversation_id, participant_type, participant_id)
    );
    CREATE INDEX IF NOT EXISTS conversation_participants_party_idx ON conversation_participants(participant_type, participant_id);

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      body TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);

    -- Bearer-token sessions for the driver mobile app, issued on
    -- Driver ID + PIN login so the PIN itself doesn't need to be resent (or
    -- stored on-device) on every request. Persisted in Postgres rather than
    -- in-memory because Render's free plan restarts the dyno on inactivity.
    CREATE TABLE IF NOT EXISTS driver_sessions (
      token TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS driver_sessions_driver_idx ON driver_sessions(driver_id);

    -- Audit trail for permission-sensitive actions (status changes, document
    -- uploads, chat, login attempts). Never overwritten, never exposed to drivers.
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `).catch((e) => {
    schemaReady = null; // let the next call retry instead of staying broken forever
    throw e;
  });
  return schemaReady;
}

module.exports = { getPool, ensureSchema };
