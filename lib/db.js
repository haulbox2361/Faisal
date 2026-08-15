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
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS load_id TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS load_number TEXT;
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON messages(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages(conversation_id, read_at) WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS notif_unread_created_idx ON notifications(recipient_type, recipient_id, created_at DESC) WHERE read_at IS NULL;

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

    -- Google Drive upload records. One row per document pushed to Drive
    -- (RC, BOL, POD, or full PACKAGE archive). Separate from the kv_store
    -- blob so metadata survives a state reset and is queryable by load.
    CREATE TABLE IF NOT EXISTS drive_uploads (
      id SERIAL PRIMARY KEY,
      load_id TEXT,
      driver_id TEXT,
      doc_type TEXT NOT NULL,         -- 'RC' | 'BOL' | 'POD' | 'PACKAGE'
      drive_file_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      folder_id TEXT,
      web_view_link TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS drive_uploads_load_idx ON drive_uploads(load_id);
    CREATE UNIQUE INDEX IF NOT EXISTS drive_uploads_fileid_idx ON drive_uploads(drive_file_id);

    -- Driver GPS locations tracking table
    CREATE TABLE IF NOT EXISTS driver_locations (
      id SERIAL PRIMARY KEY,
      driver_id TEXT NOT NULL,
      load_id TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      speed DOUBLE PRECISION,
      heading DOUBLE PRECISION,
      sharing_mode TEXT DEFAULT 'ACTIVE_LOAD',
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS driver_loc_driver_idx ON driver_locations(driver_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS driver_loc_load_idx ON driver_locations(load_id);

    -- AI Document Validation Results Table (BOL, POD, Rate Con)
    CREATE TABLE IF NOT EXISTS document_validations (
      id SERIAL PRIMARY KEY,
      load_id TEXT NOT NULL,
      driver_id TEXT,
      document_type TEXT NOT NULL,
      file_url TEXT,
      overall_status TEXT NOT NULL,
      confidence DOUBLE PRECISION DEFAULT 0.95,
      clarity_pass BOOLEAN DEFAULT true,
      blur_detected BOOLEAN DEFAULT false,
      shadow_detected BOOLEAN DEFAULT false,
      corners_visible BOOLEAN DEFAULT true,
      address_match BOOLEAN DEFAULT true,
      weight_match BOOLEAN DEFAULT true,
      signature_present BOOLEAN DEFAULT true,
      date_visible BOOLEAN DEFAULT true,
      rejection_reason TEXT,
      issues JSONB DEFAULT '[]'::jsonb,
      extracted_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS doc_validations_load_idx ON document_validations(load_id);
    CREATE INDEX IF NOT EXISTS doc_val_driver_created_idx ON document_validations(driver_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS doc_val_status_idx ON document_validations(load_id, overall_status);
  `).catch((e) => {

    schemaReady = null; // let the next call retry instead of staying broken forever
    throw e;
  });
  return schemaReady;
}

async function recordDriverLocation({ driverId, loadId, latitude, longitude, speed, heading, sharingMode }) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO driver_locations (driver_id, load_id, latitude, longitude, speed, heading, sharing_mode, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [driverId, loadId || null, Number(latitude), Number(longitude), speed != null ? Number(speed) : null, heading != null ? Number(heading) : null, sharingMode || 'ACTIVE_LOAD']
  );
  return res.rows[0];
}

async function getLatestDriverLocation(driverId) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM driver_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [driverId]
  );
  return res.rows[0] || null;
}

async function getLatestLocationsForDrivers(driverIds = []) {
  if (!driverIds || !driverIds.length) return {};
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT DISTINCT ON (driver_id) * FROM driver_locations WHERE driver_id = ANY($1) ORDER BY driver_id, recorded_at DESC`,
    [driverIds]
  );
  const map = {};
  for (const r of res.rows) {
    map[r.driver_id] = r;
  }
  return map;
}

async function saveDocumentValidation(val) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO document_validations (
       load_id, driver_id, document_type, file_url, overall_status,
       confidence, clarity_pass, blur_detected, shadow_detected, corners_visible,
       address_match, weight_match, signature_present, date_visible,
       rejection_reason, issues, extracted_data, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
     RETURNING *`,
    [
      val.loadId,
      val.driverId || null,
      val.documentType,
      val.fileUrl || null,
      val.overallStatus,
      val.confidence || 0.95,
      val.clarityPass !== false,
      Boolean(val.blurDetected),
      Boolean(val.shadowDetected),
      val.cornersVisible !== false,
      val.addressMatch !== false,
      val.weightMatch !== false,
      val.signaturePresent !== false,
      val.dateVisible !== false,
      val.rejectionReason || null,
      JSON.stringify(val.issues || []),
      JSON.stringify(val.extractedData || {}),
    ]
  );
  return res.rows[0];
}

async function getDocumentValidations(loadId) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM document_validations WHERE load_id = $1 ORDER BY created_at DESC`,
    [loadId]
  );
  return res.rows;
}

module.exports = {
  getPool,
  ensureSchema,
  recordDriverLocation,
  getLatestDriverLocation,
  getLatestLocationsForDrivers,
  saveDocumentValidation,
  getDocumentValidations,
};

