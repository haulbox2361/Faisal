// Shared Postgres connection (Supabase) for both the app's data (kv_store)
// and connected Google account tokens (google_tokens). Render's own disk is
// wiped on every deploy, so nothing here may live on local disk.

const { Pool } = require('pg');

let pool = null;

const memStore = {
  kv: new Map(),
  tokens: new Map(),
  sessions: new Map(),
  history: [],
  validations: [],
  locations: [],
  dailyNotes: [],
  owners: [],
  companies: [
    {
      id: 'COMP-LEGACY',
      name: 'HaulBoX Fleet (Default)',
      status: 'active',
      contact_name: 'Operations Admin',
      phone: '555-0100',
      email: 'operations@haulbox.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

class MockPool {
  async query(sql, params = []) {
    const s = String(sql).trim();
    if (s.startsWith('CREATE') || s.startsWith('DROP') || s.startsWith('SELECT 1 FROM information_schema') || s.startsWith('ALTER')) {
      return { rows: [] };
    }
    if (s.includes('FROM kv_store WHERE key=$1')) {
      const val = memStore.kv.get(params[0]);
      return { rows: val ? [{ value: val }] : [] };
    }
    if (s.includes('INSERT INTO kv_store')) {
      memStore.kv.set(params[0], params[1]);
      return { rows: [] };
    }
    if (s.includes('DELETE FROM kv_store')) {
      memStore.kv.delete(params[0]);
      return { rows: [] };
    }
    if (s.includes('SELECT key FROM kv_store')) {
      const keys = Array.from(memStore.kv.keys());
      return { rows: keys.map(k => ({ key: k })) };
    }
    if (s.includes('INSERT INTO driver_sessions')) {
      memStore.sessions.set(params[0], { driver_id: params[1], role: params[2] || 'DRIVER', expires_at: Date.now() + 30*86400000 });
      return { rows: [] };
    }
    if (s.includes('UPDATE driver_sessions')) {
      const sess = memStore.sessions.get(params[0]);
      return { rows: sess ? [{ driver_id: sess.driver_id, role: sess.role || 'DRIVER' }] : [] };
    }
    if (s.includes('DELETE FROM driver_sessions')) {
      memStore.sessions.delete(params[0]);
      return { rows: [] };
    }
    if (s.includes('SELECT') && s.includes('FROM owners')) {
      memStore.owners = memStore.owners || [];
      if (params && params[0] && s.toLowerCase().includes('owner_code')) {
        const row = memStore.owners.find(o => String(o.owner_code).toUpperCase() === String(params[0]).toUpperCase());
        return { rows: row ? [row] : [] };
      }
      if (params && params[0] && s.includes('id =')) {
        const row = memStore.owners.find(o => String(o.id) === String(params[0]));
        return { rows: row ? [row] : [] };
      }
      return { rows: memStore.owners };
    }
    if (s.includes('INSERT INTO owners')) {
      memStore.owners = memStore.owners || [];
      const entry = {
        id: params[0],
        owner_code: params[1],
        pin_hash: params[2],
        name: params[3],
        phone: params[4] || '',
        email: params[5] || '',
        active: params[6] !== false,
        company_id: params[7] || 'COMP-LEGACY',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const idx = memStore.owners.findIndex(o => o.id === entry.id || o.owner_code === entry.owner_code);
      if (idx >= 0) memStore.owners[idx] = entry;
      else memStore.owners.push(entry);
      return { rows: [entry] };
    }
    if (s.includes('SELECT') && s.includes('FROM companies')) {
      memStore.companies = memStore.companies || [];
      if (params && params[0] && s.includes('id =')) {
        const row = memStore.companies.find(c => String(c.id) === String(params[0]));
        return { rows: row ? [row] : [] };
      }
      return { rows: memStore.companies };
    }
    if (s.includes('INSERT INTO companies')) {
      memStore.companies = memStore.companies || [];
      const entry = {
        id: params[0],
        name: params[1],
        status: params[2] || 'active',
        contact_name: params[3] || '',
        phone: params[4] || '',
        email: params[5] || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const idx = memStore.companies.findIndex(c => c.id === entry.id);
      if (idx >= 0) memStore.companies[idx] = entry;
      else memStore.companies.push(entry);
      return { rows: [entry] };
    }
    if (s.includes('UPDATE companies')) {
      memStore.companies = memStore.companies || [];
      if (s.includes('status =') && params.length >= 2) {
        const companyId = String(params[0]);
        const newStatus = String(params[1]);
        const row = memStore.companies.find(c => String(c.id) === companyId);
        if (row) {
          row.status = newStatus;
          row.updated_at = new Date().toISOString();
        }
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    }
    if (s.includes('SELECT email, tokens FROM google_tokens')) {
      const tok = memStore.tokens.get(params[0]);
      return { rows: tok ? [tok] : [] };
    }
    if (s.includes('INSERT INTO google_tokens')) {
      memStore.tokens.set(params[0], { email: params[1], tokens: params[2] });
      return { rows: [] };
    }
    if (s.includes('INSERT INTO document_validations')) {
      memStore.validations.push({ load_id: params[0], params });
      return { rows: [{ id: memStore.validations.length, load_id: params[0] }] };
    }
    if (s.includes('FROM document_validations')) {
      const match = memStore.validations.filter(v => !params[0] || v.load_id === params[0]);
      return { rows: match.length ? match : (memStore.validations.length ? memStore.validations : [{ id: 1, load_id: params[0] || 'HB-1042' }]) };
    }
    if (s.includes('SELECT') && s.includes('FROM daily_driver_notes')) {
      const list = memStore.dailyNotes || [];
      if (params && params.length >= 2 && s.includes('date = $1') && s.includes('dispatcher_id = $2')) {
        const rows = list.filter(n => String(n.date).slice(0, 10) === String(params[0]).slice(0, 10) && String(n.dispatcher_id) === String(params[1]));
        return { rows };
      }
      if (params && params.length >= 1 && s.includes('date = $1')) {
        const rows = list.filter(n => String(n.date).slice(0, 10) === String(params[0]).slice(0, 10));
        return { rows };
      }
      if (params && params.length >= 1 && s.includes('date >= $1')) {
        const rows = list.filter(n => String(n.date).slice(0, 10) >= String(params[0]).slice(0, 10));
        return { rows };
      }
      return { rows: list };
    }
    if (s.includes('INSERT INTO daily_driver_notes')) {
      memStore.dailyNotes = memStore.dailyNotes || [];
      const date = String(params[0]).slice(0, 10);
      const dispatcher_id = String(params[1]);
      const driver_id = String(params[2]);
      const driver_name = params[3] || '';
      const note = params[4] || '';
      const status = params[5] || 'submitted';
      const existingIdx = memStore.dailyNotes.findIndex(n => String(n.date).slice(0, 10) === date && String(n.dispatcher_id) === dispatcher_id && String(n.driver_id) === driver_id);
      const entry = {
        id: existingIdx >= 0 ? memStore.dailyNotes[existingIdx].id : memStore.dailyNotes.length + 1,
        date,
        dispatcher_id,
        driver_id,
        driver_name,
        note,
        status,
        submitted_at: existingIdx >= 0 ? memStore.dailyNotes[existingIdx].submitted_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (existingIdx >= 0) {
        memStore.dailyNotes[existingIdx] = entry;
      } else {
        memStore.dailyNotes.push(entry);
      }
      return { rows: [entry] };
    }
    if (s.includes('DELETE FROM daily_driver_notes')) {
      if (params && params[0] && s.includes('date <')) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - Number(params[0]));
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        memStore.dailyNotes = (memStore.dailyNotes || []).filter(n => String(n.date).slice(0, 10) >= cutoffStr);
      }
      return { rows: [] };
    }
    if (s.includes('RETURNING')) {
      return { rows: [{ id: 'mock-id-' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString() }] };
    }
    return { rows: [] };
  }
}

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    pool = new MockPool();
    return pool;
  }
  pool = new Pool({
    connectionString,
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

    -- Bearer-token sessions for mobile app (Drivers and Owners), issued on
    -- ID + PIN login so the PIN itself doesn't need to be resent (or
    -- stored on-device) on every request. Persisted in Postgres rather than
    -- in-memory because Render's free plan restarts the dyno on inactivity.
    CREATE TABLE IF NOT EXISTS driver_sessions (
      token TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'DRIVER',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'DRIVER';
    CREATE INDEX IF NOT EXISTS driver_sessions_driver_idx ON driver_sessions(driver_id);

    -- Companies table (Multi-tenant trucking fleets)
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);

    -- Default / Legacy Company Seed (Idempotent)
    INSERT INTO companies (id, name, status, contact_name, created_at, updated_at)
    VALUES ('COMP-LEGACY', 'HaulBoX Fleet (Default)', 'active', 'Operations Admin', now(), now())
    ON CONFLICT (id) DO NOTHING;

    -- Owners table for business owners / executives
    CREATE TABLE IF NOT EXISTS owners (
      id TEXT PRIMARY KEY,
      owner_code TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE owners ADD COLUMN IF NOT EXISTS company_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_owners_code ON owners(owner_code);
    CREATE INDEX IF NOT EXISTS idx_owners_company ON owners(company_id);

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
      uploaded_image_path TEXT,
      file_url TEXT,
      ocr_status TEXT DEFAULT 'COMPLETED',
      ocr_data JSONB DEFAULT '{}'::jsonb,
      overall_status TEXT NOT NULL, -- 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED'
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
      validation_results JSONB DEFAULT '{}'::jsonb,
      dispatcher_review_status TEXT DEFAULT 'NONE', -- 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'
      reviewed_by_user_id TEXT,
      reviewed_timestamp TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS uploaded_image_path TEXT;
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS ocr_status TEXT DEFAULT 'COMPLETED';
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS ocr_data JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS validation_results JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS dispatcher_review_status TEXT DEFAULT 'NONE';
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT;
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS reviewed_timestamp TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS doc_validations_load_idx ON document_validations(load_id);
    CREATE INDEX IF NOT EXISTS doc_val_driver_created_idx ON document_validations(driver_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS doc_val_status_idx ON document_validations(load_id, overall_status);
    CREATE INDEX IF NOT EXISTS doc_val_disp_status_idx ON document_validations(dispatcher_review_status);

    -- Dispatcher Review Queue Table
    CREATE TABLE IF NOT EXISTS dispatcher_review_queue (
      id SERIAL PRIMARY KEY,
      document_validation_id INTEGER REFERENCES document_validations(id) ON DELETE CASCADE,
      load_id TEXT NOT NULL,
      driver_id TEXT,
      document_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
      reason TEXT,
      created_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_timestamp TIMESTAMPTZ,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_disp_queue_load ON dispatcher_review_queue(load_id);
    CREATE INDEX IF NOT EXISTS idx_disp_queue_status ON dispatcher_review_queue(status);
    CREATE INDEX IF NOT EXISTS idx_disp_queue_driver ON dispatcher_review_queue(driver_id);

    -- =========================================================================
    -- NORMALIZED RELATIONAL SCHEMAS (IMP-204 MIGRATION)
    -- =========================================================================

    -- 1. App Settings & Dynamic Read Layer Configuration
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- 2. Dispatchers
    CREATE TABLE IF NOT EXISTS dispatchers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'dispatcher',
      active BOOLEAN NOT NULL DEFAULT true,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_dispatchers_email ON dispatchers(email);

    -- 3. Brokers
    CREATE TABLE IF NOT EXISTS brokers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mc_number TEXT,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      payment_terms TEXT DEFAULT 'QuickPay (2-Day)',
      credit_score INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_brokers_name ON brokers(name);
    CREATE INDEX IF NOT EXISTS idx_brokers_mc ON brokers(mc_number);

    -- 4. Drivers (with Bcrypt/PBKDF2 pin_hash and latest-location-only fields)
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      driver_code TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      active BOOLEAN NOT NULL DEFAULT true,
      current_load_id TEXT,
      assigned_dispatcher_id TEXT,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      last_location_at TIMESTAMPTZ,
      permissions JSONB NOT NULL DEFAULT '{
        "canViewLoads": true,
        "canUpdateLoadStatus": true,
        "canUploadDocuments": true,
        "canViewTransactions": true,
        "canChat": true,
        "canUpdateProfile": true,
        "canEditOwnDocuments": false
      }'::jsonb,
      documents JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_drivers_code ON drivers(driver_code);
    CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status, active);
    CREATE INDEX IF NOT EXISTS idx_drivers_dispatcher ON drivers(assigned_dispatcher_id);
    CREATE INDEX IF NOT EXISTS idx_drivers_last_loc ON drivers(last_location_at DESC);

    -- 5. Loads
    CREATE TABLE IF NOT EXISTS loads (
      id TEXT PRIMARY KEY,
      load_number TEXT UNIQUE NOT NULL,
      broker_id TEXT REFERENCES brokers(id) ON DELETE SET NULL,
      broker_name TEXT NOT NULL,
      broker_phone TEXT,
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      dispatcher_id TEXT REFERENCES dispatchers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'ASSIGNED',
      pickup_city TEXT NOT NULL,
      pickup_state TEXT NOT NULL,
      pickup_zip TEXT,
      pickup_date TIMESTAMPTZ,
      delivery_city TEXT NOT NULL,
      delivery_state TEXT NOT NULL,
      delivery_zip TEXT,
      delivery_date TIMESTAMPTZ,
      miles DOUBLE PRECISION DEFAULT 0.0,
      rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      driver_pay DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      weight DOUBLE PRECISION,
      commodity TEXT,
      trailer_type TEXT,
      equipment_notes TEXT,
      tracking_status TEXT DEFAULT 'NORMAL',
      checkpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
      documents JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE loads ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE loads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE loads ADD COLUMN IF NOT EXISTS deleted_by TEXT;
    ALTER TABLE loads ADD COLUMN IF NOT EXISTS delete_reason TEXT;
    ALTER TABLE loads ADD COLUMN IF NOT EXISTS company_id TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS company_id TEXT;
    ALTER TABLE dispatchers ADD COLUMN IF NOT EXISTS company_id TEXT;

    -- Backfill orphaned owners, drivers, and loads into default legacy company
    UPDATE owners SET company_id = 'COMP-LEGACY' WHERE company_id IS NULL;
    UPDATE drivers SET company_id = 'COMP-LEGACY' WHERE company_id IS NULL;
    UPDATE loads SET company_id = 'COMP-LEGACY' WHERE company_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_loads_status ON loads(status);
    CREATE INDEX IF NOT EXISTS idx_loads_driver ON loads(driver_id);
    CREATE INDEX IF NOT EXISTS idx_loads_dispatcher ON loads(dispatcher_id);
    CREATE INDEX IF NOT EXISTS idx_loads_company ON loads(company_id);
    CREATE INDEX IF NOT EXISTS idx_drivers_company ON drivers(company_id);
    CREATE INDEX IF NOT EXISTS idx_loads_number ON loads(load_number);
    CREATE INDEX IF NOT EXISTS idx_loads_pickup_date ON loads(pickup_date DESC);
    CREATE INDEX IF NOT EXISTS idx_loads_deleted ON loads(is_deleted);

    -- =========================================================================
    -- MULTI-STOP EXTENSIONS (PICKUP_STOPS & DELIVERY_STOPS)
    -- =========================================================================
    CREATE TABLE IF NOT EXISTS pickup_stops (
      id SERIAL PRIMARY KEY,
      load_id TEXT NOT NULL,
      stop_number INTEGER NOT NULL,
      facility_name TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT,
      scheduled_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'ARRIVED' | 'BOL_UPLOADED' | 'BOL_APPROVED' | 'BOL_REJECTED'
      document_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (load_id, stop_number)
    );
    CREATE INDEX IF NOT EXISTS idx_pickup_stops_load ON pickup_stops(load_id);

    CREATE TABLE IF NOT EXISTS delivery_stops (
      id SERIAL PRIMARY KEY,
      load_id TEXT NOT NULL,
      stop_number INTEGER NOT NULL,
      facility_name TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT,
      scheduled_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'ARRIVED' | 'POD_UPLOADED' | 'POD_APPROVED' | 'POD_REJECTED'
      document_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (load_id, stop_number)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_stops_load ON delivery_stops(load_id);

    -- Additive stop metadata columns on validation, review, and Drive tracking tables
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS stop_type TEXT;
    ALTER TABLE document_validations ADD COLUMN IF NOT EXISTS stop_number INTEGER;
    ALTER TABLE dispatcher_review_queue ADD COLUMN IF NOT EXISTS stop_type TEXT;
    ALTER TABLE dispatcher_review_queue ADD COLUMN IF NOT EXISTS stop_number INTEGER;
    ALTER TABLE drive_uploads ADD COLUMN IF NOT EXISTS stop_type TEXT;
    ALTER TABLE drive_uploads ADD COLUMN IF NOT EXISTS stop_number INTEGER;

    -- Daily Driver Notes Table (End-of-day reports from dispatchers per allocated driver)
    CREATE TABLE IF NOT EXISTS daily_driver_notes (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      dispatcher_id TEXT NOT NULL,
      driver_id TEXT NOT NULL,
      driver_name TEXT,
      note VARCHAR(100) NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted' | 'missing'
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (date, dispatcher_id, driver_id)
    );
    CREATE INDEX IF NOT EXISTS daily_driver_notes_date_idx ON daily_driver_notes(date);
    CREATE INDEX IF NOT EXISTS daily_driver_notes_disp_idx ON daily_driver_notes(dispatcher_id, date);
  `).catch((e) => {
    schemaReady = null; // let the next call retry instead of staying broken forever
    throw e;
  });
  return schemaReady;
}

async function recordDriverLocation({ driverId, loadId, latitude, longitude, speed, heading, sharingMode }) {
  await ensureSchema();
  const pool = getPool();

  // 1. Insert into historical breadcrumb log (7-day retention)
  const res = await pool.query(
    `INSERT INTO driver_locations (driver_id, load_id, latitude, longitude, speed, heading, sharing_mode, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [driverId, loadId || null, Number(latitude), Number(longitude), speed != null ? Number(speed) : null, heading != null ? Number(heading) : null, sharingMode || 'ACTIVE_LOAD']
  );

  // 2. Overwrite latest-location fields on drivers table (Single-point of truth)
  await pool.query(
    `UPDATE drivers SET last_lat = $2, last_lng = $3, last_location_at = NOW() WHERE id = $1`,
    [driverId, Number(latitude), Number(longitude)]
  ).catch(() => {});

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
       rejection_reason, issues, extracted_data, stop_type, stop_number, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
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
      val.stopType || null,
      val.stopNumber || null,
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

// ---------------------------------------------------------------------------
// Multi-Stop Helpers
// ---------------------------------------------------------------------------

async function getStopsForLoad(loadId) {
  await ensureSchema();
  const pool = getPool();
  const pRes = await pool.query(
    `SELECT * FROM pickup_stops WHERE load_id = $1 ORDER BY stop_number ASC`,
    [loadId]
  );
  const dRes = await pool.query(
    `SELECT * FROM delivery_stops WHERE load_id = $1 ORDER BY stop_number ASC`,
    [loadId]
  );
  return {
    pickupStops: pRes.rows || [],
    deliveryStops: dRes.rows || [],
  };
}

async function saveStopsForLoad(loadId, { pickupStops = [], deliveryStops = [] }) {
  await ensureSchema();
  const pool = getPool();

  for (const s of pickupStops) {
    await pool.query(
      `INSERT INTO pickup_stops (load_id, stop_number, facility_name, address, city, state, zip, scheduled_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (load_id, stop_number) DO UPDATE SET
         facility_name = EXCLUDED.facility_name,
         address = EXCLUDED.address,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         zip = EXCLUDED.zip,
         scheduled_date = EXCLUDED.scheduled_date`,
      [
        loadId,
        s.stop_number || s.stopNumber || 1,
        s.facility_name || s.facilityName || null,
        s.address || s.city || '',
        s.city || '',
        s.state || '',
        s.zip || null,
        s.scheduled_date || s.scheduledDate || s.date || null,
        s.status || 'PENDING',
      ]
    );
  }

  for (const s of deliveryStops) {
    await pool.query(
      `INSERT INTO delivery_stops (load_id, stop_number, facility_name, address, city, state, zip, scheduled_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (load_id, stop_number) DO UPDATE SET
         facility_name = EXCLUDED.facility_name,
         address = EXCLUDED.address,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         zip = EXCLUDED.zip,
         scheduled_date = EXCLUDED.scheduled_date`,
      [
        loadId,
        s.stop_number || s.stopNumber || 1,
        s.facility_name || s.facilityName || null,
        s.address || s.city || '',
        s.city || '',
        s.state || '',
        s.zip || null,
        s.scheduled_date || s.scheduledDate || s.date || null,
        s.status || 'PENDING',
      ]
    );
  }
}

async function updateStopStatus(loadId, stopType, stopNumber, status, documentId = null) {
  await ensureSchema();
  const pool = getPool();
  const table = stopType.toUpperCase() === 'PICKUP' ? 'pickup_stops' : 'delivery_stops';
  await pool.query(
    `UPDATE ${table} SET status = $3, document_id = COALESCE($4, document_id) WHERE load_id = $1 AND stop_number = $2`,
    [loadId, stopNumber, status, documentId]
  );
}

// Idempotent backfill: creates exactly one pickup_stops and one delivery_stops row for single-stop loads that don't have rows
async function backfillSingleStopLoads(loads = []) {
  if (!loads || !loads.length) return;
  await ensureSchema();
  const pool = getPool();

  for (const l of loads) {
    if (!l || !l.id) continue;
    // Pickup stop backfill
    await pool.query(
      `INSERT INTO pickup_stops (load_id, stop_number, address, city, state, zip, scheduled_date, status)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (load_id, stop_number) DO NOTHING`,
      [
        l.id,
        l.pickup || l.pickupAddress || '',
        l.pickupCity || (l.pickup ? l.pickup.split(',')[0].trim() : ''),
        l.pickupState || (l.pickup ? (l.pickup.split(',')[1] || '').trim().slice(0, 2) : ''),
        l.pickupZip || null,
        l.pickupDate || null,
        (l.status === 'Loaded' || l.status === 'Drop-off' || l.driverProgress === 'LOADED' || l.driverProgress === 'DELIVERED') ? 'BOL_APPROVED' : 'PENDING',
      ]
    ).catch(() => {});

    // Delivery stop backfill
    await pool.query(
      `INSERT INTO delivery_stops (load_id, stop_number, address, city, state, zip, scheduled_date, status)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (load_id, stop_number) DO NOTHING`,
      [
        l.id,
        l.dropoff || l.deliveryAddress || '',
        l.dropoffCity || (l.dropoff ? l.dropoff.split(',')[0].trim() : ''),
        l.dropoffState || (l.dropoff ? (l.dropoff.split(',')[1] || '').trim().slice(0, 2) : ''),
        l.deliveryZip || null,
        l.deliveryDate || null,
        (l.status === 'Drop-off' || l.driverProgress === 'DELIVERED') ? 'POD_APPROVED' : 'PENDING',
      ]
    ).catch(() => {});
  }
}

async function saveDailyDriverNote({ date, dispatcherId, driverId, driverName, note, status = 'submitted' }) {
  await ensureSchema();
  const pool = getPool();
  const dateStr = String(date).slice(0, 10);
  const cleanNote = String(note || '').trim().slice(0, 100);

  const res = await pool.query(
    `INSERT INTO daily_driver_notes (date, dispatcher_id, driver_id, driver_name, note, status, submitted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (date, dispatcher_id, driver_id)
     DO UPDATE SET 
       note = EXCLUDED.note,
       driver_name = COALESCE(EXCLUDED.driver_name, daily_driver_notes.driver_name),
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING *`,
    [dateStr, dispatcherId, driverId, driverName || '', cleanNote, status]
  );
  return res.rows[0];
}

async function getDailyDriverNotes({ date, dispatcherId, startDate } = {}) {
  await ensureSchema();
  const pool = getPool();
  if (date && dispatcherId) {
    const res = await pool.query(
      `SELECT * FROM daily_driver_notes WHERE date = $1 AND dispatcher_id = $2 ORDER BY updated_at DESC`,
      [String(date).slice(0, 10), dispatcherId]
    );
    return res.rows;
  }
  if (date) {
    const res = await pool.query(
      `SELECT * FROM daily_driver_notes WHERE date = $1 ORDER BY updated_at DESC`,
      [String(date).slice(0, 10)]
    );
    return res.rows;
  }
  if (startDate) {
    const res = await pool.query(
      `SELECT * FROM daily_driver_notes WHERE date >= $1 ORDER BY date DESC, updated_at DESC`,
      [String(startDate).slice(0, 10)]
    );
    return res.rows;
  }
  const res = await pool.query(`SELECT * FROM daily_driver_notes ORDER BY date DESC, updated_at DESC`);
  return res.rows;
}

async function purgeOldDailyNotes(daysToKeep = 5) {
  await ensureSchema();
  const pool = getPool();
  try {
    await pool.query(
      `DELETE FROM daily_driver_notes WHERE date < CURRENT_DATE - ($1 || ' days')::INTERVAL`,
      [daysToKeep]
    );
  } catch (err) {
    console.warn('[DB] purgeOldDailyNotes error:', err.message);
  }
}

async function saveOwner({ id, ownerCode, pinHash, name, phone, email, active = true, companyId }) {
  await ensureSchema();
  const pool = getPool();
  const ownerId = id || ('OWN-' + Date.now().toString(36).toUpperCase());
  const res = await pool.query(
    `INSERT INTO owners (id, owner_code, pin_hash, name, phone, email, active, company_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       owner_code = EXCLUDED.owner_code,
       pin_hash = EXCLUDED.pin_hash,
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       active = EXCLUDED.active,
       company_id = COALESCE(EXCLUDED.company_id, owners.company_id),
       updated_at = NOW()
     RETURNING *`,
    [ownerId, String(ownerCode).trim().toUpperCase(), pinHash, name, phone || '', email || '', active !== false, companyId || 'COMP-LEGACY']
  );
  return res.rows[0];
}

async function getOwnerByCode(ownerCode) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM owners WHERE UPPER(owner_code) = UPPER($1) LIMIT 1`,
    [String(ownerCode).trim()]
  );
  return res.rows.length ? res.rows[0] : null;
}

async function getOwnerById(id) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM owners WHERE id = $1 LIMIT 1`,
    [id]
  );
  return res.rows.length ? res.rows[0] : null;
}

async function getAllOwners() {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(`SELECT id, owner_code, name, phone, email, active, company_id, created_at, updated_at FROM owners ORDER BY name ASC`);
  return res.rows;
}

// ---------------------------------------------------------------------------
// Companies Entity Helper Functions
// ---------------------------------------------------------------------------
async function saveCompany({ id, name, status = 'active', contactName, phone, email }) {
  await ensureSchema();
  const pool = getPool();
  const companyId = id || ('COMP-' + Date.now().toString(36).toUpperCase());
  const res = await pool.query(
    `INSERT INTO companies (id, name, status, contact_name, phone, email, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status,
       contact_name = EXCLUDED.contact_name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       updated_at = NOW()
     RETURNING *`,
    [companyId, String(name).trim(), status || 'active', contactName || '', phone || '', email || '']
  );
  return res.rows[0];
}

async function getCompanyById(id) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM companies WHERE id = $1 LIMIT 1`,
    [id]
  );
  return res.rows.length ? res.rows[0] : null;
}

async function getAllCompanies() {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(`SELECT * FROM companies ORDER BY name ASC`);
  return res.rows;
}

async function updateCompany(id, { name, contactName, phone, email }) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `UPDATE companies SET
       name = COALESCE($2, name),
       contact_name = COALESCE($3, contact_name),
       phone = COALESCE($4, phone),
       email = COALESCE($5, email),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, contactName || null, phone || null, email || null]
  );
  return res.rows[0] || null;
}

async function toggleCompanyStatus(id, status) {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `UPDATE companies SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return res.rows[0] || null;
}

module.exports = {
  getPool,
  ensureSchema,
  recordDriverLocation,
  getLatestDriverLocation,
  getLatestLocationsForDrivers,
  saveDocumentValidation,
  getDocumentValidations,
  getStopsForLoad,
  saveStopsForLoad,
  updateStopStatus,
  backfillSingleStopLoads,
  saveDailyDriverNote,
  getDailyDriverNotes,
  purgeOldDailyNotes,
  saveOwner,
  getOwnerByCode,
  getOwnerById,
  getAllOwners,
  saveCompany,
  getCompanyById,
  getAllCompanies,
  updateCompany,
  toggleCompanyStatus,
};

