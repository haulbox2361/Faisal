// lib/dataStore.js
// Per-Entity Dual-Write and Dynamic Phased Data Layer Manager for HaulBoX (IMP-204)

const crypto = require('crypto');
const kv = require('./kvstore');
const db = require('./db');
const audit = require('./auditStore');

// In-Memory Layer Cache with 5s TTL
let cachedLayers = null;
let lastLayerFetch = 0;
const LAYER_CACHE_TTL_MS = 5000;

const DEFAULT_LAYERS = {
  dispatchers: 'kv',
  brokers: 'kv',
  drivers: 'kv',
  loads: 'kv'
};

// OWASP Compliant Configuration for Low-Entropy PINs (600,000 iterations + 128-bit salt + server pepper)
const PBKDF2_ITERATIONS = 600000;
const PIN_PEPPER = process.env.PIN_PEPPER_SECRET || 'haulbox-enterprise-security-pepper-v1';

function hashPin(pin) {
  if (!pin) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const pepperedPin = `${String(pin).trim()}:${PIN_PEPPER}`;
  const hash = crypto.pbkdf2Sync(pepperedPin, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function verifyPin(inputPin, storedHash) {
  if (!storedHash || !inputPin) return false;
  if (!storedHash.startsWith('pbkdf2$')) {
    return String(inputPin).trim() === String(storedHash).trim();
  }
  const parts = storedHash.split('$');
  if (parts.length !== 5) return false;
  const iterations = parseInt(parts[2], 10) || PBKDF2_ITERATIONS;
  const salt = parts[3];
  const originalHash = parts[4];
  const pepperedPin = `${String(inputPin).trim()}:${PIN_PEPPER}`;
  const testHash = crypto.pbkdf2Sync(pepperedPin, salt, iterations, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(originalHash, 'hex'));
}

// 1. DYNAMIC PER-ENTITY READ LAYER MANAGEMENT
async function getReadLayers() {
  const now = Date.now();
  if (cachedLayers && (now - lastLayerFetch < LAYER_CACHE_TTL_MS)) {
    return { ...cachedLayers };
  }

  try {
    await db.ensureSchema();
    const pool = db.getPool();
    const res = await pool.query("SELECT value FROM app_settings WHERE key = 'system:data_read_layers'");
    if (res.rows.length && res.rows[0].value) {
      cachedLayers = { ...DEFAULT_LAYERS, ...(res.rows[0].value.layers || {}) };
    } else {
      // Check legacy single-layer fallback if present
      const singleRes = await pool.query("SELECT value FROM app_settings WHERE key = 'system:data_read_layer'");
      if (singleRes.rows.length && singleRes.rows[0].value) {
        const l = singleRes.rows[0].value.layer || 'kv';
        cachedLayers = { dispatchers: l, brokers: l, drivers: l, loads: l };
      } else {
        const globalEnv = process.env.DATA_READ_LAYER || 'kv';
        cachedLayers = { dispatchers: globalEnv, brokers: globalEnv, drivers: globalEnv, loads: globalEnv };
      }
    }
  } catch (e) {
    const globalEnv = process.env.DATA_READ_LAYER || 'kv';
    cachedLayers = { dispatchers: globalEnv, brokers: globalEnv, drivers: globalEnv, loads: globalEnv };
  }

  lastLayerFetch = now;
  return { ...cachedLayers };
}

// Backward compatibility alias for single-layer query
async function getReadLayer() {
  const layers = await getReadLayers();
  return layers.loads || 'kv';
}

async function setReadLayer(entityOrMap, layerVal, actor = { id: 'admin', name: 'Admin', email: 'admin@haulbox.com' }) {
  await db.ensureSchema();
  const pool = db.getPool();
  const prevLayers = await getReadLayers();
  const newLayers = { ...prevLayers };

  if (typeof entityOrMap === 'object' && entityOrMap !== null) {
    for (const [ent, val] of Object.entries(entityOrMap)) {
      if (['dispatchers', 'brokers', 'drivers', 'loads'].includes(ent) && ['kv', 'relational'].includes(val)) {
        newLayers[ent] = val;
      }
    }
  } else if (['dispatchers', 'brokers', 'drivers', 'loads'].includes(entityOrMap)) {
    if (!['kv', 'relational'].includes(layerVal)) {
      throw new Error(`Invalid layer value "${layerVal}": must be "kv" or "relational"`);
    }
    newLayers[entityOrMap] = layerVal;
  } else if (['kv', 'relational'].includes(entityOrMap)) {
    // Global toggle all entities
    const val = entityOrMap;
    newLayers.dispatchers = val;
    newLayers.brokers = val;
    newLayers.drivers = val;
    newLayers.loads = val;
  } else {
    throw new Error('Invalid entity or layer specification');
  }

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('system:data_read_layers', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ layers: newLayers, changedBy: actor.id, changedAt: new Date().toISOString() })]
  );

  cachedLayers = newLayers;
  lastLayerFetch = Date.now();

  // Log to immutable audit log
  await audit.log({
    actorType: 'admin',
    actorId: actor.id || 'admin',
    actorName: actor.name || 'System Admin',
    action: 'DATA_READ_LAYER_TOGGLED',
    targetType: 'SYSTEM_CONFIG',
    targetId: 'system:data_read_layers',
    details: {
      fromLayers: prevLayers,
      toLayers: newLayers,
      timestamp: new Date().toISOString(),
      actorEmail: actor.email || 'admin@haulbox.com'
    }
  });

  return { ok: true, previousLayers: prevLayers, currentLayers: newLayers };
}

// 2. PER-ENTITY READ LAYER DISPATCHER
async function loadFullState() {
  const defaultCompanies = [
    {
      id: 'COMP-LEGACY',
      name: 'HaulBoX Fleet (Default)',
      status: 'active',
      contactName: 'Operations Admin',
      phone: '555-0100',
      email: 'operations@haulbox.com',
      createdAt: new Date().toISOString()
    }
  ];

  const layers = await getReadLayers();
  const allKv = Object.values(layers).every(v => v === 'kv');

  if (allKv) {
    let s = await loadStateFromKv();
    if (!s) {
      s = { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };
    }

    // Merge relational companies if table exists
    try {
      const pool = db.getPool();
      const compRes = await pool.query('SELECT * FROM companies ORDER BY created_at ASC');
      if (compRes && compRes.rows && compRes.rows.length) {
        const companyMap = new Map();
        defaultCompanies.forEach(c => companyMap.set(c.id, c));
        (s.companies || []).forEach(c => companyMap.set(c.id, { ...companyMap.get(c.id), ...c }));
        compRes.rows.forEach(r => {
          companyMap.set(r.id, {
            ...companyMap.get(r.id),
            id: r.id,
            name: r.name,
            status: r.status || 'active',
            contactName: r.contact_name || '',
            phone: r.phone || '',
            email: r.email || '',
            createdAt: r.created_at || new Date().toISOString()
          });
        });
        s.companies = Array.from(companyMap.values());
      } else {
        s.companies = (s.companies && s.companies.length) ? s.companies : defaultCompanies;
      }
    } catch (e) {
      s.companies = (s.companies && s.companies.length) ? s.companies : defaultCompanies;
    }

    s.drivers = (s.drivers || []).map(d => ({ ...d, companyId: d.companyId || d.company_id || 'COMP-LEGACY' }));
    s.loads = (s.loads || []).map(l => ({ ...l, companyId: l.companyId || l.company_id || 'COMP-LEGACY' }));
    s.owners = (s.owners || []).map(o => ({ ...o, companyId: o.companyId || o.company_id || 'COMP-LEGACY' }));
    return s;
  }

  // Load KV state as base / fallback
  const kvState = (await loadStateFromKv()) || { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };

  try {
    await db.ensureSchema();
    const pool = db.getPool();

    // 1. Dispatchers
    let dispatchers = kvState.dispatchers || [];
    if (layers.dispatchers === 'relational') {
      const res = await pool.query('SELECT * FROM dispatchers WHERE active = true ORDER BY name ASC');
      dispatchers = res.rows.map(disp => ({
        id: disp.id,
        name: disp.name,
        email: disp.email,
        phone: disp.phone,
        role: disp.role,
        active: disp.active,
        settings: disp.settings || {}
      }));
    }

    // 2. Brokers
    let brokers = kvState.brokers || [];
    if (layers.brokers === 'relational') {
      const res = await pool.query('SELECT * FROM brokers ORDER BY name ASC');
      brokers = res.rows.map(b => ({
        id: b.id,
        name: b.name,
        mcNumber: b.mc_number,
        contactName: b.contact_name,
        phone: b.phone,
        email: b.email,
        paymentTerms: b.payment_terms,
        creditScore: b.credit_score,
        notes: b.notes
      }));
    }

    // 3. Drivers
    let drivers = kvState.drivers || [];
    if (layers.drivers === 'relational') {
      const res = await pool.query('SELECT * FROM drivers WHERE active = true ORDER BY name ASC');
      drivers = res.rows.map(d => ({
        id: d.id,
        driverCode: d.driver_code,
        pinHash: d.pin_hash,
        name: d.name,
        phone: d.phone,
        email: d.email,
        companyId: d.company_id || 'COMP-LEGACY',
        status: d.status,
        active: d.active,
        currentLoadId: d.current_load_id,
        assignedDispatcherId: d.assigned_dispatcher_id,
        permissions: d.permissions || {},
        documents: d.documents || []
      }));
    }

    // 4. Loads
    let loads = kvState.loads || [];
    if (layers.loads === 'relational') {
      const res = await pool.query('SELECT * FROM loads ORDER BY created_at DESC');
      loads = res.rows.map(l => ({
        id: l.id,
        loadNumber: l.load_number,
        brokerId: l.broker_id,
        brokerName: l.broker_name,
        brokerPhone: l.broker_phone,
        driverId: l.driver_id,
        dispatcherId: l.dispatcher_id,
        companyId: l.company_id || 'COMP-LEGACY',
        status: l.status,
        pickup: `${l.pickup_city || ''}, ${l.pickup_state || ''}`.trim().replace(/^,|,$/g, ''),
        dropoff: `${l.delivery_city || ''}, ${l.delivery_state || ''}`.trim().replace(/^,|,$/g, ''),
        pickupDate: l.pickup_date ? new Date(l.pickup_date).toLocaleDateString() : 'TBD',
        deliveryDate: l.delivery_date ? new Date(l.delivery_date).toLocaleDateString() : 'TBD',
        miles: l.miles,
        rate: l.rate,
        driverPay: l.driver_pay,
        weight: l.weight,
        commodity: l.commodity,
        trailerType: l.trailer_type,
        equipmentNotes: l.equipment_notes,
        trackingStatus: l.tracking_status,
        checkpoints: l.checkpoints || [],
        documents: l.documents || []
      }));
    }

    const defaultCompanies = [
      {
        id: 'COMP-LEGACY',
        name: 'HaulBoX Fleet (Default)',
        status: 'active',
        contactName: 'Operations Admin',
        phone: '555-0100',
        email: 'operations@haulbox.com',
        createdAt: new Date().toISOString()
      }
    ];

    let dbCompanies = [];
    try {
      const compRes = await pool.query('SELECT * FROM companies ORDER BY created_at ASC');
      if (compRes && compRes.rows) {
        dbCompanies = compRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          status: r.status || 'active',
          contactName: r.contact_name || '',
          phone: r.phone || '',
          email: r.email || '',
          createdAt: r.created_at || new Date().toISOString()
        }));
      }
    } catch (e) {}

    const companyMap = new Map();
    defaultCompanies.forEach(c => companyMap.set(c.id, c));
    (kvState.companies || []).forEach(c => companyMap.set(c.id, { ...companyMap.get(c.id), ...c }));
    dbCompanies.forEach(c => companyMap.set(c.id, { ...companyMap.get(c.id), ...c }));
    const companiesList = Array.from(companyMap.values());

    const normalizedDrivers = (drivers || []).map(d => ({
      ...d,
      companyId: d.companyId || d.company_id || 'COMP-LEGACY'
    }));

    const normalizedLoads = (loads || []).map(l => ({
      ...l,
      companyId: l.companyId || l.company_id || 'COMP-LEGACY'
    }));

    const normalizedOwners = ((kvState && kvState.owners) || []).map(o => ({
      ...o,
      companyId: o.companyId || o.company_id || 'COMP-LEGACY'
    }));

    return {
      dispatchers,
      brokers,
      drivers: normalizedDrivers,
      loads: normalizedLoads,
      owners: normalizedOwners,
      companies: companiesList.length ? companiesList : defaultCompanies,
      settings: (kvState && kvState.settings) || {}
    };
  } catch (err) {
    console.error('[DataStore] Error reading relational layer — falling back to kv_store:', err);
    if (kvState) {
      if (!kvState.companies || !kvState.companies.length) {
        kvState.companies = [
          {
            id: 'COMP-LEGACY',
            name: 'HaulBoX Fleet (Default)',
            status: 'active',
            contactName: 'Operations Admin',
            phone: '555-0100',
            email: 'operations@haulbox.com',
            createdAt: new Date().toISOString()
          }
        ];
      }
      kvState.drivers = (kvState.drivers || []).map(d => ({ ...d, companyId: d.companyId || d.company_id || 'COMP-LEGACY' }));
      kvState.loads = (kvState.loads || []).map(l => ({ ...l, companyId: l.companyId || l.company_id || 'COMP-LEGACY' }));
      kvState.owners = (kvState.owners || []).map(o => ({ ...o, companyId: o.companyId || o.company_id || 'COMP-LEGACY' }));
    }
    return kvState;
  }
}

async function loadStateFromKv() {
  const raw = await kv.get('haulline:state');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// 3. DUAL-WRITE ENGINE (Non-blocking Secondary Relational Execution)
async function saveFullState(state, options = {}) {
  // A. PRIMARY WRITE: Always persist to kv_store first (guarantees zero disruption)
  await kv.set('haulline:state', JSON.stringify(state));

  if (global.broadcastState) {
    global.broadcastState(state).catch(() => {});
  }

  // B. NON-BLOCKING SECONDARY WRITE: Asynchronously dual-write to relational tables
  setImmediate(async () => {
    try {
      await module.exports.writeRelationalEntities(state);
    } catch (err) {
      console.warn('[DataStore] Secondary relational write warning:', err.message);
    }
  });
}

// Helper: Upsert entities into normalized relational tables
async function writeRelationalEntities(state) {
  if (!state || typeof state !== 'object') return;
  await db.ensureSchema();
  const pool = db.getPool();

  // 1. Dispatchers
  if (Array.isArray(state.dispatchers)) {
    for (const disp of state.dispatchers) {
      if (!disp.id || !disp.email) continue;
      await pool.query(
        `INSERT INTO dispatchers (id, name, email, phone, role, active, settings, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           settings = EXCLUDED.settings,
           updated_at = NOW()`,
        [
          String(disp.id),
          disp.name || 'Dispatcher',
          disp.email,
          disp.phone || null,
          disp.role || 'dispatcher',
          disp.active !== false,
          JSON.stringify(disp.settings || {})
        ]
      ).catch(() => {});
    }
  }

  // 2. Brokers
  if (Array.isArray(state.brokers)) {
    for (const b of state.brokers) {
      if (!b.id || !b.name) continue;
      await pool.query(
        `INSERT INTO brokers (id, name, mc_number, contact_name, phone, email, payment_terms, credit_score, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           mc_number = EXCLUDED.mc_number,
           contact_name = EXCLUDED.contact_name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           payment_terms = EXCLUDED.payment_terms,
           credit_score = EXCLUDED.credit_score,
           notes = EXCLUDED.notes,
           updated_at = NOW()`,
        [
          String(b.id),
          b.name,
          b.mcNumber || null,
          b.contactName || null,
          b.phone || null,
          b.email || null,
          b.paymentTerms || 'QuickPay (2-Day)',
          b.creditScore || null,
          b.notes || null
        ]
      ).catch(() => {});
    }
  }

  // 3. Drivers
  if (Array.isArray(state.drivers)) {
    for (const d of state.drivers) {
      if (!d.id || !d.name) continue;
      const pinHash = d.pinHash || (d.pin ? hashPin(d.pin) : hashPin('1234'));
      const companyId = d.companyId || d.company_id || 'COMP-LEGACY';
      await pool.query(
        `INSERT INTO drivers (id, driver_code, pin_hash, name, phone, email, status, active, current_load_id, assigned_dispatcher_id, permissions, documents, company_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (id) DO UPDATE SET
           driver_code = EXCLUDED.driver_code,
           pin_hash = EXCLUDED.pin_hash,
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           status = EXCLUDED.status,
           active = EXCLUDED.active,
           current_load_id = EXCLUDED.current_load_id,
           assigned_dispatcher_id = EXCLUDED.assigned_dispatcher_id,
           permissions = EXCLUDED.permissions,
           documents = EXCLUDED.documents,
           company_id = EXCLUDED.company_id,
           updated_at = NOW()`,
        [
          String(d.id),
          d.driverCode || `DRV-${d.id}`,
          pinHash,
          d.name,
          d.phone || null,
          d.email || null,
          d.status || 'Active',
          d.active !== false,
          d.currentLoadId || null,
          d.assignedDispatcherId || null,
          JSON.stringify(d.permissions || {}),
          JSON.stringify(d.documents || []),
          companyId
        ]
      ).catch(() => {});
    }
  }

  // 4. Loads
  if (Array.isArray(state.loads)) {
    for (const l of state.loads) {
      if (!l.id || !l.loadNumber) continue;
      const pickupParts = String(l.pickup || '').split(',');
      const pickupCity = (pickupParts[0] || 'Origin').trim();
      const pickupState = (pickupParts[1] || 'XX').trim();

      const dropParts = String(l.dropoff || '').split(',');
      const dropCity = (dropParts[0] || 'Destination').trim();
      const dropState = (dropParts[1] || 'XX').trim();
      const companyId = l.companyId || l.company_id || 'COMP-LEGACY';

      await pool.query(
        `INSERT INTO loads (
           id, load_number, broker_id, broker_name, broker_phone, driver_id, dispatcher_id,
           status, pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date,
           miles, rate, driver_pay, weight, commodity, trailer_type, equipment_notes,
           tracking_status, checkpoints, documents, company_id, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW())
         ON CONFLICT (id) DO UPDATE SET
           load_number = EXCLUDED.load_number,
           broker_name = EXCLUDED.broker_name,
           broker_phone = EXCLUDED.broker_phone,
           driver_id = EXCLUDED.driver_id,
           dispatcher_id = EXCLUDED.dispatcher_id,
           status = EXCLUDED.status,
           pickup_city = EXCLUDED.pickup_city,
           pickup_state = EXCLUDED.pickup_state,
           pickup_date = EXCLUDED.pickup_date,
           delivery_city = EXCLUDED.delivery_city,
           delivery_state = EXCLUDED.delivery_state,
           delivery_date = EXCLUDED.delivery_date,
           miles = EXCLUDED.miles,
           rate = EXCLUDED.rate,
           driver_pay = EXCLUDED.driver_pay,
           weight = EXCLUDED.weight,
           commodity = EXCLUDED.commodity,
           trailer_type = EXCLUDED.trailer_type,
           equipment_notes = EXCLUDED.equipment_notes,
           tracking_status = EXCLUDED.tracking_status,
           checkpoints = EXCLUDED.checkpoints,
           documents = EXCLUDED.documents,
           company_id = EXCLUDED.company_id,
           updated_at = NOW()`,
        [
          String(l.id),
          String(l.loadNumber),
          l.brokerId || null,
          l.brokerName || 'Direct Shipper',
          l.brokerPhone || null,
          l.driverId || null,
          l.dispatcherId || null,
          l.status || 'ASSIGNED',
          pickupCity,
          pickupState,
          l.pickupDate ? new Date(l.pickupDate) : null,
          dropCity,
          dropState,
          l.deliveryDate ? new Date(l.deliveryDate) : null,
          Number(l.miles) || 0,
          Number(l.rate) || 0,
          Number(l.driverPay) || 0,
          Number(l.weight) || null,
          l.commodity || 'General Freight',
          l.trailerType || 'Dry Van',
          l.equipmentNotes || null,
          l.trackingStatus || 'NORMAL',
          JSON.stringify(l.checkpoints || []),
          JSON.stringify(l.documents || []),
          companyId
        ]
      ).catch(() => {});
    }
  }

  // 5. Companies
  if (Array.isArray(state.companies)) {
    for (const c of state.companies) {
      if (!c.id || !c.name) continue;
      await pool.query(
        `INSERT INTO companies (id, name, status, contact_name, phone, email, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           contact_name = EXCLUDED.contact_name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           updated_at = NOW()`,
        [
          String(c.id),
          c.name,
          c.status || 'active',
          c.contactName || c.contact_name || null,
          c.phone || null,
          c.email || null
        ]
      ).catch(() => {});
    }
  }

  // 6. Global Settings
  if (state.settings) {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('haulline:global_settings', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(state.settings)]
    ).catch(() => {});
  }
}

module.exports = {
  getReadLayers,
  getReadLayer,
  setReadLayer,
  loadFullState,
  saveFullState,
  hashPin,
  verifyPin,
  writeRelationalEntities
};
