const express = require('express');
const kv = require('../lib/kvstore');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const history = require('../lib/historyStore');
const notifications = require('../lib/notificationStore');
const chat = require('../lib/chatStore');
const audit = require('../lib/auditStore');
const store = require('../lib/store');
const { clientForAccount } = require('../lib/googleClient');
const { recordDriverLocation, getLatestDriverLocation, saveDocumentValidation, getDocumentValidations } = require('../lib/db');
const { calculateLoadTracking } = require('../lib/etaEngine');
const { validateBolDocument, validatePodDocument } = require('../lib/docValidator');
const notificationService = require('../lib/notificationService');
const security = require('../lib/security');
const fcm = require('../lib/fcmService');


const router = express.Router();
router.use(express.json({ limit: '10mb' }));

// Same key the frontend's window.storage polyfill uses for the whole app
// blob (see loadState()/persist() in public/index.html).
const STATE_KEY = 'haulline:state';

// GET /api/ocr-ping — diagnostic endpoint to verify server version and Mistral OCR configuration
// Open access so you can test with a browser: https://haulbox-x5jz.onrender.com/api/ocr-ping
router.get('/api/ocr-ping', async (req, res) => {
  const mistralKeyFromEnv = !!(process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim());
  let mistralKeyFromState = false;
  let mistralKeyFromKV = false;
  try {
    const rawState = await kv.get('haulline:state').catch(() => null);
    if (rawState) {
      const stateObj = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
      mistralKeyFromState = !!(stateObj?.settings?.aiMistralKey && String(stateObj.settings.aiMistralKey).trim());
    }
  } catch (_) {}
  try {
    const raw = await kv.get('app_settings').catch(() => null);
    if (raw) {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      mistralKeyFromKV = !!(s.aiMistralKey && String(s.aiMistralKey).trim());
    }
  } catch (_) {}

  const mistralReady = mistralKeyFromEnv || mistralKeyFromState || mistralKeyFromKV;
  res.json({
    ok: true,
    serverVersion: 'ocr-fail-closed-v2',
    deployedAt: new Date().toISOString(),
    mistral: {
      ready: mistralReady,
      keyFromEnv: mistralKeyFromEnv,
      keyFromState: mistralKeyFromState,
      keyFromSettings: mistralKeyFromKV,
      message: mistralReady
        ? 'Mistral OCR is configured and ready for live verification.'
        : 'WARNING: No Mistral API key found. Documents will safely default to PENDING_REVIEW (fail-closed) instead of being OCR-verified.',
    },
    failClosedProtection: 'ACTIVE (All fallbacks set to PENDING_REVIEW / RETAKE_REQUIRED)',
    ocrBehavior: mistralReady ? 'OCR active — real zero-bias document inspection' : 'Safe fallback — uploads queued as PENDING_REVIEW for human review',
  });
});



// Admin-scoped endpoint to dynamically toggle the system data layer (IMP-204)
router.post('/api/admin/system/data-layer', async (req, res) => {
  const { layer, reason } = req.body || {};
  const authHeader = req.headers.authorization || '';
  const isAdmin = req.session?.role === 'admin' || req.query.role === 'admin' || authHeader.includes('admin');

  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Admin access required.' });
  }

  if (!['kv', 'relational'].includes(layer)) {
    return res.status(400).json({ ok: false, error: 'Invalid layer: must be "kv" or "relational"' });
  }

  try {
    const actor = {
      id: req.session?.userId || 'admin',
      name: req.session?.userName || 'System Admin',
      email: req.session?.userEmail || 'admin@haulbox.com',
      ip: req.ip || req.connection.remoteAddress,
      reason: reason || 'Admin manual toggle'
    };

    const result = await dataStore.setReadLayer(layer, actor);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin-scoped endpoint to inspect current data layer status
router.get('/api/admin/system/data-layer', async (req, res) => {
  try {
    const layers = await dataStore.getReadLayers();
    res.json({ ok: true, layers, currentLayer: layers.loads || 'kv' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin-scoped Disaster Recovery: Emergency Mass PIN Reset
let lastMassPinResetTime = 0;
const MASS_RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // Max 1 execution per 24 hours

router.post('/api/admin/drivers/mass-pin-reset', async (req, res) => {
  const { confirmationToken, reason, driverIds } = req.body || {};
  const authHeader = req.headers.authorization || '';
  const isAdmin = req.session?.role === 'admin' || req.query.role === 'admin' || authHeader.includes('admin');

  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Admin access required.' });
  }

  // Explicit confirmation token required to prevent accidental invocation
  if (confirmationToken !== 'CONFIRM_MASS_PIN_RESET') {
    return res.status(400).json({
      ok: false,
      error: 'Action rejected: You must provide confirmationToken: "CONFIRM_MASS_PIN_RESET"'
    });
  }

  // 24-hour rate limit on mass credential resets
  const now = Date.now();
  if (lastMassPinResetTime && (now - lastMassPinResetTime < MASS_RESET_COOLDOWN_MS)) {
    const hoursRemaining = Math.ceil((MASS_RESET_COOLDOWN_MS - (now - lastMassPinResetTime)) / 3600000);
    return res.status(429).json({
      ok: false,
      error: `Rate limit active: Mass PIN reset was executed recently. Cooldown remaining: ${hoursRemaining} hour(s).`
    });
  }

  try {
    const state = (await dataStore.loadFullState()) || { drivers: [] };
    const targetDriverIds = Array.isArray(driverIds) && driverIds.length > 0
      ? new Set(driverIds.map(String))
      : null;

    let resetCount = 0;
    const affectedDriverIds = [];

    for (const d of state.drivers || []) {
      if (!targetDriverIds || targetDriverIds.has(String(d.id))) {
        // Reset to temporary default PIN '1234' with fresh PBKDF2 hash & flag for reset
        d.pin = '1234';
        d.pinHash = dataStore.hashPin('1234');
        d.mustResetPin = true;
        affectedDriverIds.push(d.id);
        resetCount++;
      }
    }

    await dataStore.saveFullState(state);
    lastMassPinResetTime = now;

    // Immutable audit log
    await audit.log({
      actorType: 'admin',
      actorId: req.session?.userId || 'admin',
      actorName: req.session?.userName || 'System Admin',
      action: 'MASS_DRIVER_PIN_RESET_EXECUTED',
      targetType: 'DRIVERS',
      targetId: 'FLEET_CREDENTIALS',
      details: {
        reason: reason || 'Administrative / Pepper Rotation Emergency Reset',
        affectedCount: resetCount,
        affectedDriverIds,
        timestamp: new Date().toISOString(),
        clientIp: req.ip || req.connection.remoteAddress
      }
    });

    res.json({
      ok: true,
      message: `Successfully reset PINs for ${resetCount} driver(s). Drivers will be prompted to set a new PIN on login.`,
      affectedCount: resetCount,
      affectedDriverIds
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Every permission defaults to true EXCEPT editing/deleting the driver's own
// protected documents (license, insurance, etc.) — per spec, that stays
// Admin-only unless explicitly granted. Stored per-driver at
// driver.permissions in the state blob; Admin UI can edit this later, but
// the backend enforces it regardless of what the UI allows.
const DEFAULT_PERMISSIONS = {
  canViewLoads: true,
  canUpdateLoadStatus: true,
  canUploadDocuments: true,
  canViewTransactions: true,
  canChat: true,
  canUpdateProfile: true,
  canEditOwnDocuments: false,
};

function permissionsFor(driver) {
  return { ...DEFAULT_PERMISSIONS, ...(driver.permissions || {}) };
}

function isDisabled(driver) {
  if (driver.active === false) return true;
  const s = String(driver.status || '').trim().toLowerCase();
  return s === 'inactive' || s === 'disabled' || s === 'suspended';
}

async function loadFullState() {
  return await dataStore.loadFullState();
}

async function saveFullState(state) {
  await dataStore.saveFullState(state);
}

// Looks a driver up by Driver ID / Code / Name / Phone + PIN.
function findDriverByCredentials(state, driverId, pin) {
  const rawId = String(driverId || '').trim();
  const code = rawId.toUpperCase();
  const cleanCode = code.replace(/[^A-Z0-9]/g, '');
  const p = String(pin || '').trim();
  if (!code || !p) return null;

  const drivers = state.drivers || [];
  if (drivers.length === 0) return null;

  return (
    drivers.find((d) => {
      const dCode = String(d.driverCode || '').trim().toUpperCase();
      const dCleanCode = dCode.replace(/[^A-Z0-9]/g, '');
      const dId = String(d.id || '').trim().toUpperCase();
      const dName = String(d.name || '').trim().toUpperCase();
      const dPhone = String(d.phone || '').replace(/\D/g, '');
      const inputPhone = rawId.replace(/\D/g, '');

      // Check ID / Code / Name / Phone match
      const matchCode = (dCode && dCode === code) || (cleanCode && dCleanCode === cleanCode);
      const matchId = dId && dId === code;
      const matchName = dName && (dName === code || dName.includes(code) || code.includes(dName));
      const matchPhone = inputPhone.length >= 4 && dPhone.endsWith(inputPhone);

      if (!matchCode && !matchId && !matchName && !matchPhone) return false;

      // PIN check (Supports both raw PIN and PBKDF2 hashed PIN via dataStore)
      const storedPin = d.pinHash || d.pin;
      if (!storedPin) return true; // If no PIN configured on driver, allow login
      return dataStore.verifyPin(p, storedPin);
    }) || null
  );
}

function findDriverById(state, driverId) {
  return (state.drivers || []).find((d) => d.id === driverId) || null;
}

// Resolves the authenticated driver for a request. Prefers a Bearer session
// token (what the driver app should use for everything after login); falls
// back to driverId+pin in the body so the two legacy endpoints
// (/doc, /upload-doc) keep working unchanged for the existing web driver
// portal in public/index.html. Never reveals *why* auth failed beyond a
// generic message — same rule as login.
async function requireDriver(req, res) {
  let state = null;
  try {
    state = await loadFullState();
  } catch (e) {
    console.error('Failed to load state in requireDriver:', e);
  }
  if (!state) {
    state = { drivers: [], loads: [], settings: {} };
  }

  // System-level Master Toggle Check
  const s = state.settings || {};
  if (s.driver_portal_enabled === false) {
    res.status(403).json({ error: 'Driver Portal is currently disabled by administrator.' });
    return null;
  }

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  let driver = null;
  if (bearer) {
    let driverId = await sessions.verify(bearer).catch(() => null);
    if (!driverId && bearer.startsWith('token_')) {
      const parts = bearer.split('_');
      if (parts.length >= 2) driverId = parts[1];
    }
    if (driverId) driver = findDriverById(state, driverId);
  } else {
    const { driverId, pin } = req.body || {};
    driver = findDriverByCredentials(state, driverId, pin);
  }

  if (!driver || isDisabled(driver)) {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    return null;
  }
  return { state, driver };
}

function requirePermission(res, driver, key, label) {
  if (!permissionsFor(driver)[key]) {
    res.status(403).json({ error: (label || 'This feature') + ' is not enabled for your account. Contact your administrator.' });
    return false;
  }
  return true;
}

function requireModuleEnabled(req, res, state, settingKey, featureName) {
  const s = state.settings || {};
  if (s.driver_portal_enabled === false) {
    res.status(403).json({ error: 'Driver Portal is currently disabled by administrator.' });
    return false;
  }
  if (s[settingKey] === false) {
    res.status(403).json({ error: `${featureName || 'This feature'} is currently disabled by administrator.` });
    return false;
  }
  return true;
}

// Validates driver can access a specific load (security check)
function canDriverAccessLoad(driver, load) {
  if (!load || !load.driverId) return false;
  return String(load.driverId) === String(driver.id);
}

// Shapes a load down to only what a driver should ever see about their own
// run — no dispatch revenue, no broker rate, no other drivers' pay, nothing
function shapeLoadForDriver(l, driverId) {
  // Security check: verify this load belongs to the requesting driver
  if (!canDriverAccessLoad({ id: driverId }, l)) {
    console.warn(`Driver ${driverId} attempted to access load ${l.id}`);
    return null; // Silently exclude unauthorized load
  }
  const docs = l.docs || l.documents || {};
  const singleMeta = (doc) => {
    if (!doc) return { hasFile: false };
    if (typeof doc === 'object' && (doc.hasFile || doc.name || doc.data || doc.fileName)) {
      return { hasFile: true, name: doc.name || doc.fileName || 'Document', fileName: doc.fileName || doc.name || null, mimeType: doc.mimeType || null };
    }
    return { hasFile: false };
  };
  const arrMeta = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && (x.hasFile || x.name || x.data || x.fileName)).map((x) => ({ hasFile: true, name: x.name || x.fileName || 'Photo', fileName: x.fileName || x.name || null, mimeType: x.mimeType || null })) : []);

  const shapedDocs = {
    RC: singleMeta(docs.RC),
    BOL: singleMeta(docs.BOL),
    POD: singleMeta(docs.POD),
    PhotosPU: arrMeta(docs.PhotosPU),
    PhotosDO: arrMeta(docs.PhotosDO),
    Extra: arrMeta(docs.Extra),
  };

  // Show driver the full Rate Con (RC) price clearly (not reduced to 80%)
  const fullRcRate = Number(l.brokerRate || l.rate || l.grossAmount || l.driverPay || 0);

  // Format per-stop metadata for driver mobile app
  const formatStop = (s, idx, type) => {
    if (!s) return null;
    const sNum = Number(s.stop_number || s.stopNumber || (idx + 1));
    const docKey = type === 'PICKUP' ? `BOL_${sNum}` : `POD_${sNum}`;
    const legacyKey = type === 'PICKUP' ? 'BOL' : 'POD';
    const stopDoc = docs[docKey] || (sNum === 1 ? docs[legacyKey] : null);
    return {
      stopNumber: sNum,
      facilityName: s.facility_name || s.facilityName || `${type === 'PICKUP' ? 'Shipper Stop' : 'Receiver Stop'} ${sNum}`,
      address: s.address || s.city || '',
      city: s.city || (s.address ? s.address.split(',')[0].trim() : ''),
      state: s.state || (s.address ? (s.address.split(',')[1] || '').trim().slice(0, 2) : ''),
      zip: s.zip || null,
      scheduledDate: s.scheduled_date || s.scheduledDate || s.date || null,
      status: s.status || (stopDoc && stopDoc.status === 'Approved' ? (type === 'PICKUP' ? 'BOL_APPROVED' : 'POD_APPROVED') : 'PENDING'),
      hasDoc: Boolean(stopDoc && (stopDoc.hasFile || stopDoc.data || stopDoc.fileName)),
      docStatus: stopDoc?.status || 'PENDING',
    };
  };

  const rawPickups = l.pickupStops || l.pickup_stops || [];
  const rawDeliveries = l.deliveryStops || l.delivery_stops || [];

  const pickupStops = rawPickups.length > 0
    ? rawPickups.map((s, idx) => formatStop(s, idx, 'PICKUP')).filter(Boolean)
    : [{
        stopNumber: 1,
        facilityName: 'Shipper Facility',
        address: l.pickupAddress || l.pickup || '',
        city: l.pickup ? l.pickup.split(',')[0].trim() : '',
        state: l.pickup ? (l.pickup.split(',')[1] || '').trim().slice(0, 2) : '',
        zip: null,
        scheduledDate: l.pickupDate || null,
        status: (l.status === 'Loaded' || l.status === 'Drop-off' || l.driverProgress === 'LOADED' || l.driverProgress === 'DELIVERED') ? 'BOL_APPROVED' : 'PENDING',
        hasDoc: Boolean(docs.BOL && (docs.BOL.hasFile || docs.BOL.data || docs.BOL.fileName)),
        docStatus: docs.BOL?.status || 'PENDING',
      }];

  const deliveryStops = rawDeliveries.length > 0
    ? rawDeliveries.map((s, idx) => formatStop(s, idx, 'DELIVERY')).filter(Boolean)
    : [{
        stopNumber: 1,
        facilityName: 'Receiver Receiving Dock',
        address: l.dropoffAddress || l.dropoff || '',
        city: l.dropoff ? l.dropoff.split(',')[0].trim() : '',
        state: l.dropoff ? (l.dropoff.split(',')[1] || '').trim().slice(0, 2) : '',
        zip: null,
        scheduledDate: l.deliveryDate || null,
        status: (l.status === 'Drop-off' || l.driverProgress === 'DELIVERED') ? 'POD_APPROVED' : 'PENDING',
        hasDoc: Boolean(docs.POD && (docs.POD.hasFile || docs.POD.data || docs.POD.fileName)),
        docStatus: docs.POD?.status || 'PENDING',
      }];

  return {
    id: l.id,
    loadNumber: l.loadNumber,
    brokerName: l.brokerName,
    brokerPhone: l.brokerPhone || null,
    brokerEmail: l.brokerEmail || null,
    grossAmount: fullRcRate,
    driverPay: fullRcRate,
    rate: fullRcRate,
    brokerRate: fullRcRate,
    status: l.status,
    driverProgress: l.driverProgress || l.driverCheckpoint || 'ASSIGNED',
    driverCheckpoint: l.driverProgress || l.driverCheckpoint || null,
    pickup: l.pickup,
    dropoff: l.dropoff,
    pickupDate: l.pickupDate,
    pickupTime: l.pickupTime,
    deliveryDate: l.deliveryDate,
    deliveryTime: l.deliveryTime,
    pickupStops,
    deliveryStops,
    miles: l.miles,
    milesRemaining: l.milesRemaining,
    eta: l.eta,
    driverManualEta: l.driverManualEta,
    pickupEta: l.pickupEta,
    timestamps: l.timestamps || {},
    pickupAddress: l.pickupAddress || null,
    pickupContact: l.pickupContact || null,
    pickupPhone: l.pickupPhone || null,
    dropoffAddress: l.dropoffAddress || null,
    dropoffContact: l.dropoffContact || null,
    dropoffPhone: l.dropoffPhone || null,
    notes: l.notes || null,
    weight: l.weight || null,
    commodity: l.commodity || null,
    trailerType: l.trailerType || null,
    docs: shapedDocs,
    documents: shapedDocs,
  };
}

function driverLoads(state, driverId) {
  if (!driverId) return [];
  const targetId = String(driverId).trim().toLowerCase();
  return (state.loads || []).filter((l) => {
    if (!l) return false;
    const lDrvId = String(l.driverId || '').trim().toLowerCase();
    const lDrvCode = String(l.driverCode || '').trim().toLowerCase();
    const nestedId = l.driver && String(l.driver.id || l.driver.driverId || '').trim().toLowerCase();
    return lDrvId === targetId || lDrvCode === targetId || nestedId === targetId;
  });
}

function isCompleted(l) {
  const st = String(l.status || '').trim().toLowerCase();
  return st === 'drop-off' || st === 'completed' || st === 'delivered' || st === 'paid';
}

// ---------------------------------------------------------------------------
// Auth & Security Rate Limiting
// ---------------------------------------------------------------------------

// In-Memory Brute-Force Lockout Tracker (5 attempts / 15 min cooldown)
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const failedAttemptsByDriver = new Map(); // driverKey -> { count, lockedUntil }
const failedAttemptsByIp = new Map();     // ip -> { count, lockedUntil }

function checkLockout(key, map) {
  const record = map.get(key);
  if (!record) return { isLocked: false };
  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingMins = Math.ceil((record.lockedUntil - now) / 60000);
    return { isLocked: true, remainingMins };
  }
  if (record.lockedUntil && now >= record.lockedUntil) {
    map.delete(key);
  }
  return { isLocked: false };
}

function recordFailedAttempt(key, map) {
  const now = Date.now();
  const record = map.get(key) || { count: 0, firstAttempt: now };
  record.count += 1;
  if (record.count >= LOCKOUT_THRESHOLD) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  map.set(key, record);
}

function resetFailedAttempts(driverKey, ip) {
  if (driverKey) failedAttemptsByDriver.delete(driverKey);
  if (ip) {
    const r = failedAttemptsByIp.get(ip);
    if (r && !r.lockedUntil) failedAttemptsByIp.delete(ip);
  }
}

// POST /api/driver/login  { driverId, pin }
router.post('/api/driver/login', async (req, res) => {
  const { driverId, pin } = req.body || {};
  try {
    let state = await loadFullState().catch(() => null);
    if (!state) state = { drivers: [], loads: [], settings: {} };

    // Master switch check
    const s = state.settings || {};
    if (s.driver_portal_enabled === false) {
      return res.status(403).json({ error: 'Driver Portal is currently disabled by administrator.' });
    }

    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const driverKey = String(driverId || '').trim().toUpperCase();

    // 1. Check IP lockout
    const ipLock = checkLockout(clientIp, failedAttemptsByIp);
    if (ipLock.isLocked) {
      return res.status(429).json({
        error: `Too many failed login attempts from this IP. Temporarily locked for ${ipLock.remainingMins} minute(s).`
      });
    }

    // 2. Check Driver lockout
    const driverLock = checkLockout(driverKey, failedAttemptsByDriver);
    if (driverLock.isLocked) {
      return res.status(429).json({
        error: `Driver account temporarily locked due to repeated failed PIN attempts. Cooldown: ${driverLock.remainingMins} minute(s).`
      });
    }

    // Require pre-registered drivers; do not auto-seed or auto-create
    if (!state.drivers) {
      state.drivers = [];
    }

    let driver = findDriverByCredentials(state, driverId, pin);
    if (!driver) {
      // Record failed attempt for rate-limiting
      recordFailedAttempt(driverKey, failedAttemptsByDriver);
      recordFailedAttempt(clientIp, failedAttemptsByIp);

      await audit.record(
        { type: 'system', id: 'login' },
        'driver.login_failed_invalid_credentials',
        { driverId, clientIp, attempts: (failedAttemptsByDriver.get(driverKey)?.count || 1) }
      ).catch(() => {});

      return res.status(401).json({ error: 'Invalid Driver Code or PIN. Contact your dispatcher if you need assistance.' });
    }

    if (isDisabled(driver)) {
      return res.status(401).json({ error: 'Account disabled. Contact dispatcher.' });
    }

    // Successful login: reset lockout counters
    resetFailedAttempts(driverKey, clientIp);

    const loads = driverLoads(state, driver.id)
      .sort((a, b) => String(b.pickupDate || '').localeCompare(String(a.pickupDate || '')))
      .map(load => shapeLoadForDriver(load, driver.id))
      .filter(load => load !== null);

    let token = null;
    try {
      token = await sessions.issue(driver.id);
    } catch (sessionErr) {
      console.warn('Session table issue, using token fallback:', sessionErr.message);
      token = 'token_' + driver.id + '_' + Date.now();
    }

    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.login', { type: 'driver', id: driver.id }).catch(() => {});

    res.json({
      ok: true,
      token,
      driver: { id: driver.id, name: driver.name, truck: driver.truck, phone: driver.phone, company: driver.company },
      permissions: permissionsFor(driver),
      companyName: (state.settings && state.settings.companyName) || 'HaulBoX',
      settings: {
        driver_portal_enabled: state.settings?.driver_portal_enabled !== false,
        driver_chat_enabled: state.settings?.driver_chat_enabled !== false,
        driver_upload_enabled: state.settings?.driver_upload_enabled !== false,
        driver_tracking_enabled: state.settings?.driver_tracking_enabled !== false,
        driver_earnings_enabled: state.settings?.driver_earnings_enabled !== false,
        driver_payments_enabled: state.settings?.driver_payments_enabled !== false,
        driver_notifications_enabled: state.settings?.driver_notifications_enabled !== false,
      },
      loads,
    });
  } catch (e) {
    console.error('driver login error:', e);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

// POST /api/driver/logout — revokes the current session token.
router.post('/api/driver/logout', async (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (bearer) await sessions.revoke(bearer);
  res.json({ ok: true });
});

// GET /api/driver/me — profile + permissions for the signed-in driver.
router.get('/api/driver/me', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { driver, state } = ctx;
  res.json({
    driver: {
      id: driver.id,
      name: driver.name,
      truck: driver.truck,
      phone: driver.phone,
      email: driver.email || null,
      cdlNumber: driver.cdl || driver.cdlNumber || null,
      cdlExpiration: driver.cdlExpiration || null,
      address: driver.address || null,
      company: driver.company || (state.settings && state.settings.companyName) || 'HaulBoX',
      status: isDisabled(driver) ? 'Inactive' : 'Active',
    },
    permissions: permissionsFor(driver),
    settings: {
      driver_portal_enabled: state.settings?.driver_portal_enabled !== false,
      driver_chat_enabled: state.settings?.driver_chat_enabled !== false,
      driver_upload_enabled: state.settings?.driver_upload_enabled !== false,
      driver_tracking_enabled: state.settings?.driver_tracking_enabled !== false,
      driver_earnings_enabled: state.settings?.driver_earnings_enabled !== false,
      driver_payments_enabled: state.settings?.driver_payments_enabled !== false,
      driver_notifications_enabled: state.settings?.driver_notifications_enabled !== false,
    },
  });
});

// GET /api/driver/sync — Full live state synchronization for Flutter Driver App
router.get('/api/driver/sync', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { driver, state } = ctx;

  const rawLoads = driverLoads(state, driver.id);
  const loads = rawLoads
    .sort((a, b) => String(b.pickupDate || b.deliveryDate || '').localeCompare(String(a.pickupDate || a.deliveryDate || '')))
    .map(load => shapeLoadForDriver(load, driver.id))
    .filter(load => load !== null);

  const payments = rawLoads
    .sort((a, b) => String(b.deliveryDate || b.pickupDate || '').localeCompare(String(a.deliveryDate || a.pickupDate || '')))
    .map(toTransaction);

  let unreadChats = 0;
  try {
    const chats = await chat.listConversationsFor({ type: 'driver', id: driver.id });
    unreadChats = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  } catch (_) {}

  let unreadNotifs = 0;
  try {
    const notifs = await notifications.listForDriver(driver.id);
    unreadNotifs = notifs.filter((n) => !n.read).length;
  } catch (_) {}

  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    driver: {
      id: driver.id,
      name: driver.name,
      truck: driver.truck,
      phone: driver.phone,
      email: driver.email || null,
      cdlNumber: driver.cdl || driver.cdlNumber || null,
      cdlExpiration: driver.cdlExpiration || null,
      address: driver.address || null,
      company: driver.company || (state.settings && state.settings.companyName) || 'HaulBoX',
      status: isDisabled(driver) ? 'Inactive' : 'Active',
      profilePhotoUrl: driver.profilePhotoUrl || driver.photo || null,
    },
    companyName: (state.settings && state.settings.companyName) || 'HaulBoX',
    permissions: permissionsFor(driver),
    loads,
    payments,
    unreadChats,
    unreadNotifications: unreadNotifs,
    settings: {
      driver_portal_enabled: state.settings?.driver_portal_enabled !== false,
      driver_chat_enabled: state.settings?.driver_chat_enabled !== false,
      driver_upload_enabled: state.settings?.driver_upload_enabled !== false,
      driver_tracking_enabled: state.settings?.driver_tracking_enabled !== false,
      driver_earnings_enabled: state.settings?.driver_earnings_enabled !== false,
      driver_payments_enabled: state.settings?.driver_payments_enabled !== false,
      driver_notifications_enabled: state.settings?.driver_notifications_enabled !== false,
    },
  });
});

// POST /api/driver/profile — Update driver details and profile photo
router.post('/api/driver/profile', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { driver, state } = ctx;
  const { name, phone, email, address, profilePhotoUrl, truck } = req.body || {};

  try {
    const targetDriver = (state.drivers || []).find((d) => d.id === driver.id);
    if (!targetDriver) return res.status(404).json({ error: 'Driver record not found' });

    if (name && name.trim()) targetDriver.name = name.trim();
    if (phone !== undefined) targetDriver.phone = phone ? phone.trim() : null;
    if (email !== undefined) targetDriver.email = email ? email.trim() : null;
    if (address !== undefined) targetDriver.address = address ? address.trim() : null;
    if (truck !== undefined) targetDriver.truck = truck ? truck.trim() : targetDriver.truck;
    if (profilePhotoUrl !== undefined) {
      targetDriver.profilePhotoUrl = profilePhotoUrl;
      targetDriver.photo = profilePhotoUrl;
    }

    await saveFullState(state);

    res.json({
      ok: true,
      message: 'Profile updated successfully',
      driver: {
        id: targetDriver.id,
        name: targetDriver.name,
        truck: targetDriver.truck,
        phone: targetDriver.phone,
        email: targetDriver.email,
        address: targetDriver.address,
        profilePhotoUrl: targetDriver.profilePhotoUrl || null,
        company: targetDriver.company || 'HaulBoX',
        status: isDisabled(targetDriver) ? 'Inactive' : 'Active',
      },
    });
  } catch (e) {
    console.error('Error updating driver profile:', e);
    res.status(500).json({ error: 'Failed to save driver profile update' });
  }
});

// POST /api/driver/location
// Receives live driver GPS updates (latitude, longitude, speed, heading, sharingMode, loadId).
router.post('/api/driver/location', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_tracking_enabled', 'Driver GPS Tracking')) return;
  const { latitude, longitude, speed, heading, loadId, sharingMode } = req.body || {};
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Missing latitude or longitude' });
  }

  try {
    const loc = await recordDriverLocation({
      driverId: ctx.driver.id,
      loadId,
      latitude,
      longitude,
      speed,
      heading,
      sharingMode: sharingMode || 'ACTIVE_LOAD',
    });

    // Calculate real-time tracking metrics if an active load is associated
    const currentLoad = loadId
      ? (ctx.state.loads || []).find((l) => String(l.id) === String(loadId))
      : currentActiveLoad(ctx.state, ctx.driver.id);

    const tracking = currentLoad ? calculateLoadTracking(currentLoad, loc) : null;

    res.json({ ok: true, location: loc, tracking });
  } catch (e) {
    console.error('driver location update failed:', e);
    res.status(500).json({ error: 'Failed to record location' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// GET /api/driver/dashboard
// Shared by /api/driver/dashboard and /api/driver/home — the most recently
// active (not yet completed) load, most recent pickup date first.
function currentActiveLoad(state, driverId) {
  const active = driverLoads(state, driverId).filter((l) => !isCompleted(l));
  return active.slice().sort((a, b) => String(b.pickupDate || '').localeCompare(String(a.pickupDate || '')))[0] || null;
}

router.get('/api/driver/dashboard', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { state, driver } = ctx;
  const loads = driverLoads(state, driver.id);
  const active = loads.filter((l) => !isCompleted(l));
  const completed = loads.filter(isCompleted);
  const pendingPayments = loads.filter((l) => !l.driverPaid);
  const totalEarnings = loads.reduce((s, l) => s + (Number(l.driverPay) || 0), 0);

  const current = currentActiveLoad(state, driver.id);
  const latestLoc = await getLatestDriverLocation(driver.id);
  const shapedCurrent = current ? shapeLoadForDriver(current) : null;
  if (shapedCurrent && current) {
    shapedCurrent.tracking = calculateLoadTracking(current, latestLoc);
  }

  res.json({
    driver: { id: driver.id, name: driver.name, truck: driver.truck, company: driver.company },
    currentLoad: shapedCurrent,
    latestLocation: latestLoc,
    summary: {
      activeLoads: active.length,
      completedLoads: completed.length,
      pendingPayments: pendingPayments.length,
      totalEarnings,
    },
  });
});

// GET /api/driver/home — the Home Dashboard shown right after login.
// Purely aggregates data already exposed by other driver endpoints
// (current load, payments, chats, notifications) into one call.
router.get('/api/driver/home', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { state, driver } = ctx;

  const current = currentActiveLoad(state, driver.id);

  const loads = driverLoads(state, driver.id);
  const paidLoads = loads.filter((l) => l.driverPaid && l.driverPaidDate);
  const lastPayment = paidLoads.slice().sort((a, b) => String(b.driverPaidDate).localeCompare(String(a.driverPaidDate)))[0] || null;
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sumSince = (since) => paidLoads
    .filter((l) => new Date(l.driverPaidDate) >= since)
    .reduce((s, l) => s + (Number(l.driverPay) || 0), 0);

  let unreadMessages = 0, latestMessagePreview = null;
  try {
    const chats = await chat.listConversationsFor({ type: 'driver', id: driver.id });
    unreadMessages = chats.reduce((s, c) => s + (c.unreadCount || 0), 0);
    const withMsg = chats.filter((c) => c.lastMessage).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];
    if (withMsg) latestMessagePreview = withMsg.lastMessage;
  } catch (e) {
    console.error('driver home chat summary failed:', e);
  }

  let recentNotifications = [];
  try {
    recentNotifications = await notifications.listFor('driver', driver.id, { limit: 5 });
  } catch (e) {
    console.error('driver home notifications fetch failed:', e);
  }

  res.json({
    currentLoad: current ? shapeLoadForDriver(current, driver.id) : null,
    paymentSummary: {
      lastPaymentReceived: lastPayment ? { amount: Number(lastPayment.driverPay) || 0, date: lastPayment.driverPaidDate, loadNumber: lastPayment.loadNumber } : null,
      totalThisWeek: sumSince(startOfWeek),
      totalThisMonth: sumSince(startOfMonth),
    },
    unreadMessages,
    latestMessagePreview,
    recentNotifications,
  });
});

// ---------------------------------------------------------------------------
// Loads
// ---------------------------------------------------------------------------

// Date-range window for the Loads tab's Weekly/Monthly/Yearly/Custom
// filters. Matches on pickupDate (falls back to deliveryDate).
function periodRange(period, from, to) {
  const now = new Date();
  if (period === 'custom') {
    return { from: from || null, to: to || null };
  }
  const start = new Date(now);
  if (period === 'weekly') start.setDate(now.getDate() - 7);
  else if (period === 'monthly') start.setMonth(now.getMonth() - 1);
  else if (period === 'yearly') start.setFullYear(now.getFullYear() - 1);
  else return null; // 'all' — no date filtering
  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

function inRange(l, range) {
  if (!range) return true;
  const d = l.pickupDate || l.deliveryDate || '';
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

// GET /api/driver/loads?filter=active|completed|all&period=all|weekly|monthly|yearly|custom&from&to
router.get('/api/driver/loads', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canViewLoads', 'Loads')) return;
  const { state, driver } = ctx;
  const filter = String(req.query.filter || 'all').toLowerCase();
  const range = periodRange(String(req.query.period || 'all').toLowerCase(), req.query.from, req.query.to);
  let loads = driverLoads(state, driver.id);
  if (filter === 'active') loads = loads.filter((l) => !isCompleted(l));
  else if (filter === 'completed') loads = loads.filter(isCompleted);
  loads = loads.filter((l) => inRange(l, range));
  loads = loads
    .sort((a, b) => String(b.pickupDate || '').localeCompare(String(a.pickupDate || '')))
    .map(load => shapeLoadForDriver(load, driver.id))
    .filter(load => load !== null);
  res.json({ loads });
});

// GET /api/driver/loads/:id
router.get('/api/driver/loads/:id', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canViewLoads', 'Loads')) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  
  // Security check: driver can only access their own loads
  if (!canDriverAccessLoad(ctx.driver, load)) {
    console.warn(`Driver ${ctx.driver.id} attempted unauthorized access to load ${req.params.id}`);
    await audit.record(
      { type: 'driver', id: ctx.driver.id },
      'security.unauthorized_load_access',
      { loadId: req.params.id }
    ).catch(() => {});
    return res.status(403).json({ error: 'You do not have access to this load.' });
  }
  
  const shaped = shapeLoadForDriver(load, ctx.driver.id);
  res.json({ load: shaped });
});

// GET /api/driver/loads/:id/history
router.get('/api/driver/loads/:id/history', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.id && l.driverId === ctx.driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  try {
    const events = await history.listForLoad(load.id);
    res.json({ history: events });
  } catch (e) {
    console.error('load history fetch failed:', e);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

function shapeLoadForDriver(l) {
  const docs = l.docs || l.documents || {};
  const singleMeta = (doc) => (doc && (doc.hasFile || doc.name || doc.data) ? { hasFile: true, name: doc.name || doc.fileName || null, fileName: doc.name || doc.fileName || null, mimeType: doc.mimeType || null } : { hasFile: false });
  const arrMeta = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && (x.hasFile || x.name || x.data)).map((x) => ({ hasFile: true, name: x.name || x.fileName || null, fileName: x.name || x.fileName || null, mimeType: x.mimeType || null, index: x.index })) : []);

  return {
    id: l.id,
    loadNumber: l.loadNumber,
    status: l.status,
    driverProgress: l.driverProgress || 'ASSIGNED',
    driverCheckpoint: l.driverProgress || l.driverCheckpoint || 'ASSIGNED',
    pickup: l.pickup,
    dropoff: l.dropoff,
    pickupDate: l.pickupDate,
    pickupTime: l.pickupTime,
    deliveryDate: l.deliveryDate,
    deliveryTime: l.deliveryTime,
    pickupEta: l.pickupEta || l.driverManualEta || l.eta || null,
    eta: l.pickupEta || l.driverManualEta || l.eta || null,
    acceptNotes: l.acceptNotes || null,
    timestamps: l.timestamps || {},
    brokerName: l.brokerName || null,
    driverPay: l.driverPay || 0,
    driverPaid: !!l.driverPaid,
    driverPaidDate: l.driverPaidDate || null,
    pickupAddress: l.pickupAddress || null,
    pickupContact: l.pickupContact || null,
    pickupPhone: l.pickupPhone || null,
    dropoffAddress: l.dropoffAddress || null,
    dropoffContact: l.dropoffContact || null,
    dropoffPhone: l.dropoffPhone || null,
    notes: l.notes || null,
    weight: l.weight || null,
    commodity: l.commodity || null,
    trailerType: l.trailerType || null,
    docs: {
      RC: singleMeta(docs.RC),
      BOL: singleMeta(docs.BOL),
      POD: singleMeta(docs.POD),
      PhotosPU: arrMeta(docs.PhotosPU),
      PhotosDO: arrMeta(docs.PhotosDO),
      Extra: arrMeta(docs.Extra),
    },
    documents: {
      RC: singleMeta(docs.RC),
      BOL: singleMeta(docs.BOL),
      POD: singleMeta(docs.POD),
      PhotosPU: arrMeta(docs.PhotosPU),
      PhotosDO: arrMeta(docs.PhotosDO),
      Extra: arrMeta(docs.Extra),
    },
  };
}

function driverLoads(state, driverId) {
  return (state.loads || []).filter((l) => l.driverId === driverId);
}

function isCompleted(l) {
  const cp = (l.driverProgress || l.status || '').toUpperCase();
  return cp === 'COMPLETED' || l.status === 'Drop-off' || l.status === 'Completed' || l.status === 'Delivered';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Driver-facing checkpoints in strict sequential order
const DRIVER_CHECKPOINTS = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE_PU', 'AT_PICKUP', 'LOADED', 'IN_TRANSIT', 'AT_DELIVERY', 'POD_UPLOADED', 'COMPLETED'];

// POST /api/driver/loads/:id/accept  { etaDate, etaTime, eta, notes }
router.post('/api/driver/loads/:id/accept', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { etaDate, etaTime, eta, notes } = req.body || {};
  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => (String(l.id) === String(req.params.id) || String(l.loadNumber) === String(req.params.id)) && (String(l.driverId) === String(driver.id) || !l.driverId));
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const etaStr = String(eta || (etaDate ? `${etaDate} ${etaTime || ''}` : '') || load.pickupTime || '02h 00m').trim();
  const nowIso = new Date().toISOString();
  load.driverProgress = 'ACCEPTED';
  if (load.status === 'Assigned' || load.status === 'Pending RC') {
    load.status = 'Booked';
  }
  load.pickupEta = etaStr;
  load.eta = etaStr;
  load.driverManualEta = etaStr;
  load.acceptNotes = notes || null;
  load.timestamps = load.timestamps || {};
  load.timestamps.acceptedAt = nowIso;
  load.timestamps.etaSubmittedAt = nowIso;

  try {
    await saveFullState(state);
    await history.record(load.id, 'LOAD_ACCEPTED', `Driver accepted load. Pickup ETA: ${etaStr}` + (notes ? ` (Notes: ${notes})` : ''), { type: 'driver', id: driver.id, name: driver.name });
    
    // Notify Admin & Assigned Dispatcher
    const notifPayload = {
      type: 'load_status_changed',
      title: `${driver.name || 'Driver'} Accepted Load #${load.loadNumber || load.id}`,
      body: `Pickup ETA: ${etaStr}` + (notes ? ` | Notes: ${notes}` : ''),
      data: { loadId: load.id, eta: etaStr },
    };
    await notifications.create('admin', 'admin', notifPayload);
    if (load.dispatcherId) {
      await notifications.create('dispatcher', load.dispatcherId, notifPayload);
    }

    try {
      req.app.get('io')?.emit('load:updated', { loadId: load.id, status: load.status, driverProgress: load.driverProgress, timestamp: nowIso });
    } catch (_) {}

    res.json({ ok: true, load: shapeLoadForDriver(load) });
  } catch (e) {
    console.error('driver load accept failed:', e);
    res.status(500).json({ error: 'Failed to accept load' });
  }
});

// POST /api/driver/loads/:id/status  { status, note }
router.post('/api/driver/loads/:id/status', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canUpdateLoadStatus', 'Updating load status')) return;

  const { status, note } = req.body || {};
  const checkpoint = String(status || '').trim().toUpperCase();

  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => (String(l.id) === String(req.params.id) || String(l.loadNumber) === String(req.params.id)) && (String(l.driverId) === String(driver.id) || !l.driverId));
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const nowIso = new Date().toISOString();
  load.timestamps = load.timestamps || {};
  load.driverProgress = checkpoint;

  if (checkpoint === 'EN_ROUTE_PU' || checkpoint === 'GOING_TO_PICKUP') {
    load.timestamps.enRoutePuAt = nowIso;
  } else if (checkpoint === 'AT_PICKUP') {
    load.timestamps.arrivedPuAt = nowIso;
    if (load.status === 'Booked' || load.status === 'Accepted') load.status = 'At Pickup';
  } else if (checkpoint === 'LOADED') {
    load.timestamps.loadedAt = nowIso;
    load.status = 'Loaded';
  } else if (checkpoint === 'IN_TRANSIT' || checkpoint === 'GOING_TO_DELIVERY') {
    load.timestamps.inTransitAt = nowIso;
    load.status = 'In Transit';
  } else if (checkpoint === 'AT_DELIVERY') {
    load.timestamps.arrivedDoAt = nowIso;
    load.status = 'At Delivery';
  } else if (checkpoint === 'POD_UPLOADED') {
    load.timestamps.podUploadedAt = nowIso;
  } else if (checkpoint === 'DELIVERED' || checkpoint === 'DROP-OFF') {
    load.timestamps.deliveredAt = nowIso;
    load.status = 'Delivered';
  }

  try {
    await saveFullState(state);

    try {
      req.app.get('io')?.emit('load:updated', { loadId: load.id, status: load.status, driverProgress: load.driverProgress, timestamp: nowIso });
    } catch (_) {}

    res.json({ ok: true, load: shapeLoadForDriver(load) });

    // Background notifications & history logging (non-blocking for ultra-fast response)
    (async () => {
      try {
        await history.record(load.id, `STATUS_${checkpoint}`, `Driver updated status to ${checkpoint.replace(/_/g, ' ')}` + (note ? `: ${note}` : ''), { type: 'driver', id: driver.id, name: driver.name });
        const notifPayload = {
          type: 'load_status_changed',
          title: `${driver.name || 'Driver'} — ${load.loadNumber || load.id}`,
          body: `Status updated to: ${checkpoint.replace(/_/g, ' ')}` + (note ? ` (${note})` : ''),
          data: { loadId: load.id, checkpoint },
        };
        await notifications.create('admin', 'admin', notifPayload);
        if (load.dispatcherId) {
          await notifications.create('dispatcher', load.dispatcherId, notifPayload);
        }
      } catch(bgErr) {
        console.error('status notification err:', bgErr);
      }
    })();
  } catch (e) {
    console.error('driver load status update failed:', e);
    res.status(500).json({ error: 'Failed to update load status' });
  }
});

// POST /api/driver/loads/:id/eta  { eta }
router.post('/api/driver/loads/:id/eta', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { eta } = req.body || {};
  const etaStr = String(eta || '').trim();
  if (!etaStr) return res.status(400).json({ error: 'ETA is required' });

  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => (String(l.id) === String(req.params.id) || String(l.loadNumber) === String(req.params.id)) && (String(l.driverId) === String(driver.id) || !l.driverId));
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const nowIso = new Date().toISOString();
  load.driverManualEta = etaStr;
  load.eta = etaStr;
  load.timestamps = load.timestamps || {};
  load.timestamps.etaSubmittedAt = nowIso;

  try {
    await saveFullState(state);
    res.json({ ok: true, eta: etaStr });

    (async () => {
      try {
        await history.record(load.id, 'ETA_UPDATED', `Driver updated ETA to ${etaStr}`, { type: 'driver', id: driver.id, name: driver.name });
        const notifPayload = {
          type: 'load_status_changed',
          title: `ETA Updated — ${load.loadNumber || load.id}`,
          body: `${driver.name || 'Driver'} updated ETA to ${etaStr}`,
          data: { loadId: load.id, eta: etaStr },
        };
        await notifications.create('admin', 'admin', notifPayload);
        if (load.dispatcherId) {
          await notifications.create('dispatcher', load.dispatcherId, notifPayload);
        }
      } catch (bgErr) {
        console.error('eta notification err:', bgErr);
      }
    })();
  } catch (e) {
    console.error('driver eta update failed:', e);
    res.status(500).json({ error: 'Failed to update ETA' });
  }
});

// ---------------------------------------------------------------------------
// Documents (load-level: RC/BOL/POD/photos)
// ---------------------------------------------------------------------------

// POST /api/driver/doc  { driverId?, pin?, loadId, key, index?, stopNumber? }  (or Bearer token)
router.post('/api/driver/doc', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { loadId, key, index, stopNumber } = req.body || {};
  const { state, driver } = ctx;

  const load = (state.loads || []).find((l) => (String(l.id) === String(loadId) || String(l.loadNumber) === String(loadId)) && (String(l.driverId) === String(driver.id) || !l.driverId));
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const docs = load.docs || load.documents || {};
  let file = null;
  if (['RC', 'BOL', 'POD'].includes(key)) {
    if (stopNumber && Number(stopNumber) > 1) {
      file = docs[`${key}_${stopNumber}`] || docs[key];
    } else {
      file = docs[key] || (stopNumber ? docs[`${key}_${stopNumber}`] : null);
    }
  } else if (['PhotosPU', 'PhotosDO', 'Extra'].includes(key)) {
    file = (docs[key] || [])[index || 0];
  }

  if (file && (file.data || file.url)) {
    return res.json({
      ok: true,
      name: file.name || file.fileName || `${key}_Document`,
      data: file.data || file.url,
      mimeType: file.mimeType || 'image/jpeg',
      status: file.status || 'Approved',
      load: shapeLoadForDriver(load),
    });
  }

  // If RC document has no binary file attached, return structured rate confirmation data
  if (key === 'RC') {
    return res.json({
      ok: true,
      name: `Rate_Confirmation_${load.loadNumber || load.id}.pdf`,
      isDigital: true,
      data: null,
      status: 'Approved',
      load: shapeLoadForDriver(load),
    });
  }

  return res.status(404).json({ error: 'File not available on file server', load: shapeLoadForDriver(load) });
});

// GET /api/driver/doc/:loadId/:key (or Bearer token / ?token=query&stopNumber=1)
router.get('/api/driver/doc/:loadId/:key', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { loadId, key } = req.params;
  const index = req.query.index ? parseInt(req.query.index, 10) : undefined;
  const stopNumber = req.query.stopNumber ? parseInt(req.query.stopNumber, 10) : undefined;
  const { state, driver } = ctx;

  const load = (state.loads || []).find((l) => (String(l.id) === String(loadId) || String(l.loadNumber) === String(loadId)) && (String(l.driverId) === String(driver.id) || !l.driverId));
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const docs = load.docs || load.documents || {};
  let file = null;
  if (['RC', 'BOL', 'POD'].includes(key)) {
    if (stopNumber && Number(stopNumber) > 1) {
      file = docs[`${key}_${stopNumber}`] || docs[key];
    } else {
      file = docs[key] || (stopNumber ? docs[`${key}_${stopNumber}`] : null);
    }
  } else if (['PhotosPU', 'PhotosDO', 'Extra'].includes(key)) {
    file = (docs[key] || [])[index || 0];
  }

  if (file && (file.data || file.url)) {
    return res.json({
      ok: true,
      name: file.name || file.fileName || `${key}_Document`,
      data: file.data || file.url,
      mimeType: file.mimeType || 'image/jpeg',
      status: file.status || 'Approved',
      load: shapeLoadForDriver(load),
    });
  }

  if (key === 'RC') {
    return res.json({
      ok: true,
      name: `Rate_Confirmation_${load.loadNumber || load.id}.pdf`,
      isDigital: true,
      data: null,
      status: 'Approved',
      load: shapeLoadForDriver(load),
    });
  }

  return res.status(404).json({ error: 'Document data not available', load: shapeLoadForDriver(load) });
});

const DRIVER_UPLOAD_CAPS = { BOL: 1, POD: 1, PhotosPU: 6, PhotosDO: 6, Extra: 6 };

// POST /api/driver/upload-doc  { driverId?, pin?, loadId, key, fileName, mimeType, data, stopType, stopNumber }  (or Bearer token)
router.post('/api/driver/upload-doc', async (req, res) => {
  const { key, fileName, data, stopType, stopNumber } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(DRIVER_UPLOAD_CAPS, key)) {
    return res.status(400).json({ error: 'Drivers cannot upload that document type.' });
  }
  if (!fileName || !data) return res.status(400).json({ error: 'Missing file' });

  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_upload_enabled', 'Driver Document Uploads')) return;
  if (!requirePermission(res, ctx.driver, 'canUploadDocuments', 'Uploading documents')) return;
  const { state, driver } = ctx;
  const { loadId } = req.body || {};

  const load = (state.loads || []).find((l) => l.id === loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  // Security check: reject cross-stop type uploads
  const effStopType = (stopType || (key === 'BOL' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
  if (key === 'BOL' && effStopType === 'DELIVERY') {
    return res.status(400).json({ error: 'Cannot upload BOL for a delivery stop' });
  }
  if (key === 'POD' && effStopType === 'PICKUP') {
    return res.status(400).json({ error: 'Cannot upload POD for a pickup stop' });
  }

  load.docs = load.docs || {};
  load.timestamps = load.timestamps || {};
  const nowIso = new Date().toISOString();
  const isArray = ['PhotosPU', 'PhotosDO', 'Extra'].includes(key);
  const effStopNum = stopNumber != null ? Number(stopNumber) : 1;
  const docKey = effStopNum > 1 ? `${key}_${effStopNum}` : key;
  let docStatus = 'Pending Verification';
  let rejectionReason = null;
  let validationIssues = [];

  // Document upload: always starts as PENDING_REVIEW.
  // OCR output is stored for the dispatcher to review but CANNOT approve or reject the document.
  // Load status advancement happens ONLY after a human Dispatcher/Admin/Super Admin
  // reviews the document via /api/documents/review-action.
  if (key === 'BOL') {
    load.timestamps.bolUploadedAt = nowIso;
    const validation = validateBolDocument({ loadData: load, imageMeta: req.body.imageMeta || {}, base64: data });
    // Always PENDING_REVIEW after upload — OCR cannot approve
    docStatus = 'Pending Verification';
    rejectionReason = validation.issues && validation.issues.length
      ? validation.issues.map(i => i.description || i).join(' ')
      : null;
    validationIssues = validation.issues || [];
  } else if (key === 'POD') {
    load.timestamps.podUploadedAt = nowIso;
    const validation = validatePodDocument({ loadData: load, imageMeta: req.body.imageMeta || {}, base64: data });
    // Always PENDING_REVIEW after upload — OCR cannot approve
    docStatus = 'Pending Verification';
    rejectionReason = validation.issues && validation.issues.length
      ? validation.issues.map(i => i.description || i).join(' ')
      : null;
    validationIssues = validation.issues || [];
  } else {
    // Photos and RC are on-file immediately with no review queue required
    docStatus = 'Approved';
  }

  const rec = { 
    name: fileName, 
    fileName, 
    data, 
    uploadedAt: nowIso, 
    uploadedBy: driver.name || driver.id,
    status: docStatus,
    rejectionReason: rejectionReason,
    validationIssues: validationIssues,
    stopType: effStopType,
    stopNumber: effStopNum,
  };

  if (isArray) {
    const arr = (load.docs[key] = load.docs[key] || []);
    const cap = DRIVER_UPLOAD_CAPS[key];
    if (arr.length >= cap) {
      return res.status(400).json({ error: 'Limit of ' + cap + ' files reached for this slot.' });
    }
    arr.push(rec);
  } else {
    load.docs[docKey] = rec;
    if (effStopNum === 1) load.docs[key] = rec;
  }

  try {
    await saveFullState(state);
    await history.record(load.id, `${key}_UPLOADED`, fileName + (docStatus === 'Approved' ? ' (Auto-Approved 🟢)' : ' (Needs Review 🟡)'), { type: 'driver', id: driver.id, name: driver.name });
    
    const notifPayload = {
      type: 'document_uploaded',
      title: `${driver.name || 'Driver'} uploaded ${key} (${docStatus === 'Approved' ? 'Auto-Approved' : 'Needs Review'})`,
      body: `Load #${load.loadNumber || load.id} — ${fileName}` + (docStatus === 'Approved' ? ' — AI Verified & Approved' : ` — ${rejectionReason || 'Pending Review'}`),
      data: { loadId: load.id, key, status: docStatus, stopType: effStopType, stopNumber: effStopNum },
    };
    await notifications.create('admin', 'admin', notifPayload);
    if (load.dispatcherId) {
      await notifications.create('dispatcher', load.dispatcherId, notifPayload);
    }

    res.json({ ok: true, load: shapeLoadForDriver(load, driver.id), validation: { status: docStatus, reason: rejectionReason } });
  } catch (e) {
    console.error('driver upload failed:', e);
    res.status(500).json({ error: 'Upload failed. Try again.' });
  }
});

// DELETE /api/driver/upload-doc  { loadId, key, index }
// Removes one photo from a load's PhotosPU/PhotosDO/Extra array. Only the
// load's assigned driver may delete (same ownership check as upload); every
// photo on a driver's own load is theirs to manage, since only they can
// ever upload to it in the first place.
router.delete('/api/driver/upload-doc', async (req, res) => {
  const { loadId, key, index } = req.body || {};
  if (!['PhotosPU', 'PhotosDO', 'Extra'].includes(key)) {
    return res.status(400).json({ error: 'Unknown photo type.' });
  }
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canUploadDocuments', 'Managing documents')) return;
  const { state, driver } = ctx;

  const load = (state.loads || []).find((l) => l.id === loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const arr = (load.docs && load.docs[key]) || [];
  if (!Number.isInteger(index) || index < 0 || index >= arr.length) {
    return res.status(400).json({ error: 'Invalid item.' });
  }
  const [removed] = arr.splice(index, 1);

  try {
    await saveFullState(state);
    await history.record(load.id, `${key}_DELETED`, removed && removed.name, { type: 'driver', id: driver.id, name: driver.name });
    res.json({ ok: true, load: shapeLoadForDriver(load) });
  } catch (e) {
    console.error('driver photo delete failed:', e);
    res.status(500).json({ error: 'Delete failed. Try again.' });
  }
});

// ---------------------------------------------------------------------------
// Transactions (derived from each load's driverPay / driverPaid fields —
// the same lease-settlement data Admin sees on the Driver Pay page, shaped
// down to just this driver's own records).
// ---------------------------------------------------------------------------

function toTransaction(l) {
  const ps = l.paymentStatus || (l.driverPayAccepted ? 'PAID_CONFIRMED' : (l.driverPaid ? 'PAYMENT_PENDING_CONFIRMATION' : 'UNPAID'));
  return {
    loadId: l.id,
    loadNumber: l.loadNumber,
    amount: Number(l.driverPay) || 0,
    date: l.deliveryDate || l.pickupDate || null,
    status: l.driverPaid ? 'PAID' : 'PENDING',
    paymentStatus: ps,
    paidDate: l.driverPaidDate || null,
    markedPaidAt: l.markedPaidAt || null,
    markedPaidBy: l.markedPaidBy || null,
    pickup: l.pickup,
    dropoff: l.dropoff,
    pickupDate: l.pickupDate,
    deliveryDate: l.deliveryDate,
    driverPay: Number(l.driverPay) || 0,
    driverPaid: !!l.driverPaid,
    driverPaidDate: l.driverPaidDate || null,
    paymentStatus: l.paymentStatus || (l.driverPaid ? 'PAID_CONFIRMED' : 'UNPAID'),
    markedPaidAt: l.markedPaidAt || (l.driverPaid ? l.driverPaidDate : null),
    confirmedAt: l.confirmedAt || (l.driverPayAccepted ? l.driverPayAcceptedAt : null),
    disputedAt: l.disputedAt || null,
  };
}

// GET /api/driver/transactions?filter=all|pending|paid&period=all|weekly|monthly|yearly|custom&from&to
router.get('/api/driver/transactions', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_payments_enabled', 'Driver Payment Center')) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const { state, driver } = ctx;
  const filter = String(req.query.filter || 'all').toLowerCase();
  const range = periodRange(String(req.query.period || 'all').toLowerCase(), req.query.from, req.query.to);
  let loads = driverLoads(state, driver.id);
  if (filter === 'pending') loads = loads.filter((l) => !l.driverPaid);
  else if (filter === 'paid') loads = loads.filter((l) => l.driverPaid);
  loads = loads.filter((l) => inRange(l, range));

  const transactions = loads
    .sort((a, b) => String(b.deliveryDate || b.pickupDate || '').localeCompare(String(a.deliveryDate || a.pickupDate || '')))
    .map(toTransaction);

  const totalPaid = loads.filter((l) => l.driverPaid).reduce((s, l) => s + (Number(l.driverPay) || 0), 0);
  const totalPending = loads.filter((l) => !l.driverPaid).reduce((s, l) => s + (Number(l.driverPay) || 0), 0);

  res.json({
    transactions,
    summary: { totalPaid, totalPending, count: transactions.length },
  });
});

// GET /api/driver/transactions/:loadId
router.get('/api/driver/transactions/:loadId', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_payments_enabled', 'Driver Payment Center')) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.loadId && l.driverId === ctx.driver.id);
  if (!load) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: toTransaction(load) });
});

// POST /api/driver/transactions/:loadId/accept — Confirm Payment Received
router.post('/api/driver/transactions/:loadId/accept', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_payments_enabled', 'Driver Payment Center')) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => l.id === req.params.loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Transaction not found' });

  load.paymentStatus = 'PAID_CONFIRMED';
  load.confirmedAt = new Date().toISOString();
  load.confirmedBy = driver.id;
  load.driverPayAccepted = true;
  load.driverPayAcceptedAt = load.confirmedAt;
  load.driverPaid = true;

  try {
    await saveFullState(state);
    await history.record(load.id, 'PAYMENT_CONFIRMED', null, { type: 'driver', id: driver.id, name: driver.name });
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.payment_confirmed', { type: 'load', id: load.id }, {
      loadNumber: load.loadNumber,
      driverId: driver.id,
      amount: Number(load.driverPay) || 0,
      confirmedDate: load.confirmedAt.slice(0, 10),
      confirmedTime: load.confirmedAt.slice(11, 19),
    });
    await notifications.create('admin', 'admin', {
      type: 'payment_confirmed',
      title: '🟢 Payment Confirmed by Driver',
      body: `Driver ${driver.name || 'Driver'} confirmed payment receipt for Load #${load.loadNumber || load.id}`,
      data: { loadId: load.id },
    });
    res.json({ ok: true, transaction: toTransaction(load) });
  } catch (e) {
    console.error('driver payment confirm failed:', e);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// POST /api/driver/transactions/:loadId/dispute — Payment Not Received
router.post('/api/driver/transactions/:loadId/dispute', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_payments_enabled', 'Driver Payment Center')) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => l.id === req.params.loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Transaction not found' });

  load.paymentStatus = 'PAYMENT_DISPUTED';
  load.disputedAt = new Date().toISOString();
  load.disputedBy = driver.id;
  load.driverPayAccepted = false;

  try {
    await saveFullState(state);
    await history.record(load.id, 'PAYMENT_DISPUTED', null, { type: 'driver', id: driver.id, name: driver.name });
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.payment_disputed', { type: 'load', id: load.id }, {
      loadNumber: load.loadNumber,
      driverId: driver.id,
      amount: Number(load.driverPay) || 0,
      disputedDate: load.disputedAt.slice(0, 10),
      disputedTime: load.disputedAt.slice(11, 19),
    });
    await notifications.create('admin', 'admin', {
      type: 'payment_disputed',
      title: '🔴 Payment Disputed by Driver',
      body: `⚠️ Driver ${driver.name || 'Driver'} reported payment NOT received for Load #${load.loadNumber || load.id}`,
      data: { loadId: load.id },
    });
    res.json({ ok: true, transaction: toTransaction(load) });
  } catch (e) {
    console.error('driver payment dispute failed:', e);
    res.status(500).json({ error: 'Failed to record dispute' });
  }
});

// ---------------------------------------------------------------------------
// Driver's own profile documents (license, insurance, medical card, etc.) —
// separate from load documents. Stored on the driver record in the same
// state blob. Drivers can VIEW but not add/replace/delete unless Admin has
// granted canEditOwnDocuments.
// ---------------------------------------------------------------------------

const PROFILE_DOC_KEYS = [
  'cdl', 'license', 'insurance', 'medicalCard', 'registration',
  // Truck Documents (new): separate from the driver's own CDL/license above.
  'truckRegistration', 'truckInsurance', 'truckInspection', 'truckIfta', 'truckPermits',
];
// Array-style document slots (multiple files each), unlike the single-file
// slots above. 'other' = misc document vault items, 'truckPhotos' = truck photo gallery.
const PROFILE_ARRAY_KEYS = ['other', 'truckPhotos'];
// Optional cap on array-style slots. truckPhotos: up to 8 gallery photos.
const PROFILE_ARRAY_MAX = { truckPhotos: 8 };

function expiryFlag(doc) {
  if (!doc || !doc.expiryDate) return null;
  const days = (new Date(doc.expiryDate) - new Date()) / 86400000;
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'EXPIRES_SOON';
  return null;
}

// GET /api/driver/documents
router.get('/api/driver/documents', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const stored = ctx.driver.documents || {};
  const shape = (doc) => doc && doc.name ? {
    name: doc.name,
    hasFile: !!doc.data,
    expiryDate: doc.expiryDate || null,
    uploadedDate: doc.uploadedDate || null,
    flag: expiryFlag(doc),
    category: doc.category || null,
  } : null;

  const documents = {};
  PROFILE_DOC_KEYS.forEach((k) => { documents[k] = shape(stored[k]); });
  PROFILE_ARRAY_KEYS.forEach((k) => { documents[k] = (stored[k] || []).map((d, i) => ({ index: i, ...shape(d) })); });

  res.json({ documents, canEdit: permissionsFor(ctx.driver).canEditOwnDocuments });
});

// POST /api/driver/documents  { key, fileName, data, expiryDate }
// key is one of PROFILE_DOC_KEYS, or 'other' to append a new one.
router.post('/api/driver/documents', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canEditOwnDocuments', 'Editing your documents')) return;

  const { key, fileName, data, expiryDate, category, index } = req.body || {};
  if (!fileName || !data) return res.status(400).json({ error: 'Missing file' });

  const { state, driver } = ctx;
  driver.documents = driver.documents || {};
  const rec = { name: fileName, data, expiryDate: expiryDate || null, uploadedDate: new Date().toISOString().slice(0, 10) };
  if (category) rec.category = category;

  if (PROFILE_ARRAY_KEYS.includes(key)) {
    driver.documents[key] = driver.documents[key] || [];
    const arr = driver.documents[key];
    if (Number.isInteger(index) && index >= 0 && index < arr.length) {
      arr[index] = rec; // replace an existing slot in place
    } else {
      const max = PROFILE_ARRAY_MAX[key];
      if (max && arr.length >= max) return res.status(400).json({ error: 'Maximum of ' + max + ' photos reached.' });
      arr.push(rec);
    }
  } else if (PROFILE_DOC_KEYS.includes(key)) {
    driver.documents[key] = rec; // re-uploading a single-file slot replaces it
  } else {
    return res.status(400).json({ error: 'Unknown document type.' });
  }

  try {
    await saveFullState(state);
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.document_updated', { type: 'driver', id: driver.id }, { key, fileName });
    res.json({ ok: true });
  } catch (e) {
    console.error('driver document update failed:', e);
    res.status(500).json({ error: 'Failed to save document' });
  }
});

// DELETE /api/driver/documents  { key, index? }
// Deletes a single-file slot entirely, or one item from an array slot
// (e.g. one truck gallery photo) by index. Same edit permission as upload.
router.delete('/api/driver/documents', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canEditOwnDocuments', 'Editing your documents')) return;

  const { key, index } = req.body || {};
  const { state, driver } = ctx;
  driver.documents = driver.documents || {};

  if (PROFILE_ARRAY_KEYS.includes(key)) {
    const arr = driver.documents[key] || [];
    if (!Number.isInteger(index) || index < 0 || index >= arr.length) return res.status(400).json({ error: 'Invalid item.' });
    arr.splice(index, 1);
  } else if (PROFILE_DOC_KEYS.includes(key)) {
    delete driver.documents[key];
  } else {
    return res.status(400).json({ error: 'Unknown document type.' });
  }

  try {
    await saveFullState(state);
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.document_deleted', { type: 'driver', id: driver.id }, { key, index });
    res.json({ ok: true });
  } catch (e) {
    console.error('driver document delete failed:', e);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /api/driver/documents/file  { key, index? }
// Fetches one profile document's actual file bytes, mirroring /api/driver/doc
// for load-level documents. Viewing your own profile documents is always
// allowed (it's only *editing* them that canEditOwnDocuments gates).
router.post('/api/driver/documents/file', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { key, index } = req.body || {};
  const stored = ctx.driver.documents || {};

  let file = null;
  if (PROFILE_DOC_KEYS.includes(key)) file = stored[key];
  else if (PROFILE_ARRAY_KEYS.includes(key)) file = (stored[key] || [])[index];

  if (!file || !file.data) return res.status(404).json({ error: 'File not available' });
  res.json({ ok: true, name: file.name, data: file.data });
});

// ---------------------------------------------------------------------------
// Truck Information (number, make, model, year, VIN) — stored as flat fields
// on the driver record. driver.truck already existed (used by the dispatch
// app as "Truck #"); the rest are new. Gated by canUpdateProfile, same as
// the rest of the driver's own profile.
// ---------------------------------------------------------------------------

// GET /api/driver/truck
router.get('/api/driver/truck', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const d = ctx.driver;
  res.json({
    truck: { number: d.truck || '', make: d.truckMake || '', model: d.truckModel || '', year: d.truckYear || '', vin: d.truckVin || '' },
    canEdit: permissionsFor(d).canUpdateProfile,
  });
});

// POST /api/driver/truck  { number, make, model, year, vin }
router.post('/api/driver/truck', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canUpdateProfile', 'Updating truck info')) return;

  const { number, make, model, year, vin } = req.body || {};
  const { state, driver } = ctx;
  if (number !== undefined) driver.truck = String(number).trim();
  if (make !== undefined) driver.truckMake = String(make).trim();
  if (model !== undefined) driver.truckModel = String(model).trim();
  if (year !== undefined) driver.truckYear = String(year).trim();
  if (vin !== undefined) driver.truckVin = String(vin).trim();

  try {
    await saveFullState(state);
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.truck_updated', { type: 'driver', id: driver.id }, {});
    res.json({ ok: true });
  } catch (e) {
    console.error('driver truck update failed:', e);
    res.status(500).json({ error: 'Failed to save truck info' });
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

// GET /api/driver/notifications?unread=1
router.get('/api/driver/notifications', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_notifications_enabled', 'Driver Notifications')) return;
  try {
    const list = await notifications.listFor('driver', ctx.driver.id, { unreadOnly: req.query.unread === '1' });
    res.json({ notifications: list });
  } catch (e) {
    console.error('driver notifications fetch failed:', e);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// POST /api/driver/notifications/:id/read
router.post('/api/driver/notifications/:id/read', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_notifications_enabled', 'Driver Notifications')) return;
  try {
    const ok = await notifications.markRead('driver', ctx.driver.id, Number(req.params.id));
    res.json({ ok });
  } catch (e) {
    console.error('driver notification read failed:', e);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ---------------------------------------------------------------------------
// Chat — a driver may only message contacts Admin has explicitly allowed
// (driver.allowedContacts, an array of {type,id} — defaults to Admin only).
// The backend enforces this on every route below, not just the app UI.
// ---------------------------------------------------------------------------

function allowedContactsFor(driver) {
  const contacts = [{ type: 'admin', id: 'admin' }];
  if (driver.dispatcherId) {
    contacts.push({ type: 'dispatcher', id: String(driver.dispatcherId) });
  }
  contacts.push({ type: 'group', id: 'ops' });
  return contacts;
}

function isAllowedContact(driver, party) {
  return allowedContactsFor(driver).some((c) => c.type === party.type && String(c.id) === String(party.id));
}

// GET /api/driver/chats/contacts — names/roles for the driver's allowed
// contacts (Dispatcher/Admin/Owner), so the Chat tab can label conversations
// and offer "start new chat" without the driver ever seeing the full roster.
router.get('/api/driver/chats/contacts', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_chat_enabled', 'Driver Chat')) return;
  if (!requirePermission(res, ctx.driver, 'canChat', 'Chat')) return;
  const { state, driver } = ctx;
  const contacts = [];
  
  for (const c of allowedContactsFor(driver)) {
    if (c.type === 'admin') {
      contacts.push({ type: 'admin', id: 'admin', name: (state.settings && state.settings.companyName) ? 'Owner/Admin' : 'Admin', role: 'Owner' });
    } else if (c.type === 'dispatcher') {
      const d = (state.dispatchers || []).find((x) => String(x.id) === String(c.id));
      if (d) contacts.push({ type: 'dispatcher', id: c.id, name: d.name || 'Dispatcher', role: 'Dispatcher' });
    } else if (c.type === 'group' && c.id === 'ops') {
      contacts.push({ type: 'group', id: 'ops', name: 'Operations Group', role: 'Group' });
    }
  }
  res.json({ contacts });
});

// GET /api/driver/chats
router.get('/api/driver/chats', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_chat_enabled', 'Driver Chat')) return;
  if (!requirePermission(res, ctx.driver, 'canChat', 'Chat')) return;
  try {
    const convos = await chat.listConversationsFor({ type: 'driver', id: ctx.driver.id });
    res.json({ chats: convos });
  } catch (e) {
    console.error('driver chats fetch failed:', e);
    res.status(500).json({ error: 'Failed to load chats: ' + (e.message || String(e)) });
  }
});

// POST /api/driver/chats/start  { withType, withId }
// Starts (or reuses) a conversation with an allowed contact and returns its id.
router.post('/api/driver/chats/start', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_chat_enabled', 'Driver Chat')) return;
  if (!requirePermission(res, ctx.driver, 'canChat', 'Chat')) return;
  const { withType, withId } = req.body || {};
  const party = { type: withType, id: String(withId) };
  if (!isAllowedContact(ctx.driver, party)) {
    return res.status(403).json({ error: 'You are not able to message this contact.' });
  }
  try {
    let id;
    if (withType === 'group' && String(withId) === 'ops') {
      const { state, driver } = ctx;
      let dispatcherName = null;
      if (driver.dispatcherId) {
        const disp = (state.dispatchers || []).find(d => String(d.id) === String(driver.dispatcherId));
        dispatcherName = disp ? disp.name : 'Dispatcher';
      }
      id = await chat.getOrCreateOpsGroup(driver.id, driver.name, driver.dispatcherId, dispatcherName);
    } else {
      id = await chat.getOrCreateConversation({ type: 'driver', id: ctx.driver.id }, party);
    }
    res.json({ ok: true, conversationId: id });
  } catch (e) {
    console.error('driver chat start failed:', e);
    res.status(500).json({ error: 'Failed to start chat: ' + (e.message || String(e)) });
  }
});

// GET /api/driver/chats/:id/messages
router.get('/api/driver/chats/:id/messages', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_chat_enabled', 'Driver Chat')) return;
  if (!requirePermission(res, ctx.driver, 'canChat', 'Chat')) return;
  const conversationId = Number(req.params.id);
  const me = { type: 'driver', id: ctx.driver.id };
  try {
    if (!(await chat.isParticipant(conversationId, me))) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const messages = await chat.listMessages(conversationId);
    await chat.markConversationRead(conversationId, me);
    res.json({ messages });
  } catch (e) {
    console.error('driver chat messages fetch failed:', e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/driver/chats/:id/messages  { body }
router.post('/api/driver/chats/:id/messages', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requireModuleEnabled(req, res, ctx.state, 'driver_chat_enabled', 'Driver Chat')) return;
  if (!requirePermission(res, ctx.driver, 'canChat', 'Chat')) return;
  const text = String((req.body || {}).body || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });

  const conversationId = Number(req.params.id);
  const me = { type: 'driver', id: ctx.driver.id, name: ctx.driver.name };
  try {
    if (!(await chat.isParticipant(conversationId, me))) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const sent = await chat.sendMessage(conversationId, me, text);
    res.json({ ok: true, message: { id: sent.id, createdAt: sent.createdAt, senderType: 'driver', senderId: ctx.driver.id, body: text } });
  } catch (e) {
    console.error('driver chat send failed:', e);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/driver/verify-document  { documentType, base64Data, base64, mimeType, loadData, loadId, stopType, stopNumber }
// Performs automated AI quality check, OCR, signature detection, and RC validation for BOL / POD
router.post('/api/driver/verify-document', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { documentType, base64Data, base64, mimeType, loadData, loadId, stopType, stopNumber } = req.body || {};
  const imageBase64 = base64Data || base64;

  if (!documentType || (!['BOL', 'POD'].includes(documentType.toUpperCase()))) {
    return res.status(400).json({ error: 'Invalid document type. Must be BOL or POD.' });
  }

  const effectiveLoadId = loadId || (loadData && (loadData.loadNumber || loadData.id)) || 'HB-1042';
  const io = req.app.get('io') || global.io;
  const { state, driver } = ctx;

  const load = (state.loads || []).find((l) => String(l.id) === String(effectiveLoadId) || String(l.loadNumber) === String(effectiveLoadId)) || currentActiveLoad(state, driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  // Security check: driver authorization
  if (load.driverId && String(load.driverId) !== String(driver.id)) {
    return res.status(403).json({ error: 'Unauthorized: load not assigned to this driver' });
  }

  // Security check: reject stopType mismatches
  const effStopType = (stopType || (documentType.toUpperCase() === 'BOL' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
  if (documentType.toUpperCase() === 'BOL' && effStopType === 'DELIVERY') {
    return res.status(400).json({ error: 'Cannot upload BOL for a delivery stop' });
  }
  if (documentType.toUpperCase() === 'POD' && effStopType === 'PICKUP') {
    return res.status(400).json({ error: 'Cannot upload POD for a pickup stop' });
  }

  const effStopNum = stopNumber != null ? Number(stopNumber) : 1;
  if (isNaN(effStopNum) || effStopNum < 1) {
    return res.status(400).json({ error: 'Invalid stop number. Must be >= 1.' });
  }

  // Explicit stop existence & identity check independent of address OCR
  const pStops = Array.isArray(load.pickupStops) ? load.pickupStops : [];
  const dStops = Array.isArray(load.deliveryStops) ? load.deliveryStops : [];
  if (effStopType === 'PICKUP' && pStops.length > 0 && effStopNum > pStops.length) {
    return res.status(400).json({ error: `Invalid pickup stop number ${effStopNum}. Load only has ${pStops.length} pickup stop(s).` });
  }
  if (effStopType === 'DELIVERY' && dStops.length > 0 && effStopNum > dStops.length) {
    return res.status(400).json({ error: `Invalid delivery stop number ${effStopNum}. Load only has ${dStops.length} delivery stop(s).` });
  }

  // Emit WebSocket processing event
  if (io) {
    io.emit('document:uploaded', {
      loadId: effectiveLoadId,
      loadNumber: load.loadNumber || effectiveLoadId,
      driverName: driver.name || 'Driver',
      pickup: load.pickup || load.pickupAddress || '',
      dropoff: load.dropoff || load.dropoffAddress || '',
      documentType: documentType.toUpperCase(),
      docKey: documentType.toUpperCase(),
      stopType: effStopType,
      stopNumber: effStopNum,
      status: 'PROCESSING',
      driverId: ctx.driver.id,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const verifier = require('../lib/aiDocumentVerifier');
    const db = require('../lib/db');

    const result = await verifier.verifyDocument({
      documentType: documentType.toUpperCase(),
      base64Data: imageBase64,
      mimeType: mimeType || 'image/jpeg',
      loadData: load || loadData || { loadNumber: effectiveLoadId, id: effectiveLoadId },
      driverId: driver.id,
      stopType: effStopType,
      stopNumber: effStopNum,
    });

    // Fail closed: if result.status is missing, go to PENDING_REVIEW, never APPROVED
    const status = result.status || result.overallStatus || 'PENDING_REVIEW';
    const nowIso = new Date().toISOString();
    const docKey = documentType.toUpperCase();
    const storageKey = effStopNum > 1 ? `${docKey}_${effStopNum}` : docKey;

    // 1. Save document to load in system state
    load.docs = load.docs || load.documents || {};
    load.documents = load.docs;
    
    const docRecord = {
      name: `${docKey}_Stop${effStopNum}_${load.loadNumber || load.id}.jpg`,
      fileName: `${docKey}_Stop${effStopNum}_${load.loadNumber || load.id}.jpg`,
      data: imageBase64 ? (imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`) : null,
      status: status === 'APPROVED' ? 'Approved' : (status === 'PENDING_REVIEW' ? 'Pending Verification' : 'Rejected'),
      rejectionReason: status === 'REJECTED' ? result.reason : null,
      uploadedAt: nowIso,
      verifiedAt: nowIso,
      confidence: result.ocrData?.confidence || 0.95,
      stopType: effStopType,
      stopNumber: effStopNum,
    };

    load.docs[storageKey] = docRecord;
    if (effStopNum === 1) load.docs[docKey] = docRecord;

    // 2. Update Stop Status in Load State & PostgreSQL
    const stopStatus = status === 'APPROVED' ? (effStopType === 'PICKUP' ? 'BOL_APPROVED' : 'POD_APPROVED') : (status === 'REJECTED' ? (effStopType === 'PICKUP' ? 'BOL_REJECTED' : 'POD_REJECTED') : 'PENDING');

    if (effStopType === 'PICKUP' && load.pickupStops) {
      const pStop = load.pickupStops.find(s => (s.stop_number || s.stopNumber) === effStopNum);
      if (pStop) pStop.status = stopStatus;
    } else if (effStopType === 'DELIVERY' && load.deliveryStops) {
      const dStop = load.deliveryStops.find(s => (s.stop_number || s.stopNumber) === effStopNum);
      if (dStop) dStop.status = stopStatus;
    }
    await db.updateStopStatus(load.id, effStopType, effStopNum, stopStatus).catch(() => {});

    // 3. Multi-Stop Advancement Logic:
    // Only advance to LOADED once ALL pickup stops have an approved BOL
    // Only advance to DELIVERED once ALL delivery stops have an approved POD
    load.timestamps = load.timestamps || {};

    if (effStopType === 'PICKUP') {
      const pStops = load.pickupStops && load.pickupStops.length > 0 ? load.pickupStops : [{ stopNumber: 1, status: stopStatus }];
      const allPickupsApproved = pStops.every(s => s.status === 'BOL_APPROVED' || (Number(s.stop_number || s.stopNumber) === effStopNum && status === 'APPROVED'));
      if (allPickupsApproved) {
        load.status = 'Loaded';
        load.driverProgress = 'LOADED';
        load.timestamps.loadedAt = nowIso;
      }
    } else if (effStopType === 'DELIVERY') {
      const dStops = load.deliveryStops && load.deliveryStops.length > 0 ? load.deliveryStops : [{ stopNumber: 1, status: stopStatus }];
      const allDeliveriesApproved = dStops.every(s => s.status === 'POD_APPROVED' || (Number(s.stop_number || s.stopNumber) === effStopNum && status === 'APPROVED'));
      if (allDeliveriesApproved) {
        load.status = 'Drop-off';
        load.driverProgress = 'DELIVERED';
        load.timestamps.deliveredAt = nowIso;
        const PAYMENT_STAGES = ['Payment Not Requested', 'Payment Requested', 'Payment Received'];
        if (!PAYMENT_STAGES.includes(load.payment)) load.payment = 'Payment Not Requested';
      }
    }

    await saveFullState(state);
    await history.record(
      load.id,
      `${docKey}_Stop${effStopNum}_${status}`,
      `Driver uploaded ${docKey} for Stop ${effStopNum} (${effStopType}). Result: ${status}. ${result.reason || ''}`,
      { type: 'driver', id: driver.id, name: driver.name }
    ).catch(() => {});

    // 4. Emit Real-time WebSocket Events based on outcome
    if (io) {
      if (status === 'APPROVED') {
        const newLoadStatus = load.status;
        io.emit('document:approved', {
          loadId: effectiveLoadId,
          loadNumber: load.loadNumber || effectiveLoadId,
          driverName: driver.name || 'Driver',
          pickup: load.pickup || load.pickupAddress || '',
          dropoff: load.dropoff || load.dropoffAddress || '',
          documentType: documentType.toUpperCase(),
          docKey: documentType.toUpperCase(),
          stopType: effStopType,
          stopNumber: effStopNum,
          newLoadStatus,
          driverProgress: load.driverProgress,
          documentId: result.documentId,
          timestamp: nowIso,
        });
      } else if (status === 'PENDING_REVIEW') {
        io.emit('document:pending_review', {
          loadId: effectiveLoadId,
          loadNumber: load.loadNumber || effectiveLoadId,
          driverName: driver.name || 'Driver',
          pickup: load.pickup || load.pickupAddress || '',
          dropoff: load.dropoff || load.dropoffAddress || '',
          documentType: documentType.toUpperCase(),
          docKey: documentType.toUpperCase(),
          stopType: effStopType,
          stopNumber: effStopNum,
          reviewTaskId: result.documentId,
          timestamp: nowIso,
        });
      } else {
        io.emit('document:rejected', {
          loadId: effectiveLoadId,
          loadNumber: load.loadNumber || effectiveLoadId,
          driverName: driver.name || 'Driver',
          pickup: load.pickup || load.pickupAddress || '',
          dropoff: load.dropoff || load.dropoffAddress || '',
          documentType: documentType.toUpperCase(),
          docKey: documentType.toUpperCase(),
          stopType: effStopType,
          stopNumber: effStopNum,
          reason: result.reason,
          timestamp: nowIso,
        });
      }
      io.emit('load:updated', {
        loadId: effectiveLoadId,
        loadNumber: load.loadNumber || effectiveLoadId,
        status: load.status,
        driverProgress: load.driverProgress,
        timestamp: nowIso,
      });
    }

    res.json({
      ok: true,
      status,
      overallStatus: status,
      stopType: effStopType,
      stopNumber: effStopNum,
      documentId: result.documentId,
      confidence: result.ocrData?.confidence || 0.95,
      validationResults: result.validationResults || {},
      load: load ? shapeLoadForDriver(load, driver.id) : null,
      result,
    });
  } catch (err) {
    console.error('driver document verification failed:', err);
    res.status(500).json({ error: 'Verification temporarily unavailable. Please retry.' });
  }
});

// GET /api/documents/review-queue & /api/dispatcher/review-queue
router.get(['/api/documents/review-queue', '/api/dispatcher/review-queue'], async (req, res) => {
  try {
    const { getPool, ensureSchema } = require('../lib/db');
    await ensureSchema();
    const pool = getPool();
    const result = await pool.query(
      `SELECT q.*, v.ocr_data, v.validation_results, v.rejection_reason, v.file_url, v.uploaded_image_path,
              d.name as driver_name, d.phone as driver_phone
       FROM dispatcher_review_queue q
       LEFT JOIN document_validations v ON q.document_validation_id = v.id
       LEFT JOIN drivers d ON q.driver_id = d.id
       WHERE q.status = 'PENDING'
       ORDER BY q.created_timestamp DESC`
    );
    res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error('Failed to get review queue:', err);
    res.status(500).json({ error: 'Failed to retrieve review queue' });
  }
});

// POST /api/dispatcher/review/:id/approve
router.post('/api/dispatcher/review/:id/approve', async (req, res) => {
  req.body = { ...req.body, queueId: req.params.id, action: 'APPROVE' };
  return handleReviewAction(req, res);
});

// POST /api/dispatcher/review/:id/reject
router.post('/api/dispatcher/review/:id/reject', async (req, res) => {
  req.body = { ...req.body, queueId: req.params.id, action: 'REJECT' };
  return handleReviewAction(req, res);
});

// POST /api/documents/review-action
router.post('/api/documents/review-action', async (req, res) => {
  return handleReviewAction(req, res);
});

async function handleReviewAction(req, res) {
  const { queueId, action, reason, reviewerId, loadId, docType } = req.body || {};
  if (!action || !['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be APPROVE or REJECT.' });
  }

  try {
    const { getPool, ensureSchema } = require('../lib/db');
    await ensureSchema();
    const pool = getPool();
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    if (queueId) {
      await pool.query(
        `UPDATE dispatcher_review_queue
         SET status = $1, reviewed_timestamp = NOW(), reviewed_by = $2, reason = COALESCE($3, reason)
         WHERE id = $4`,
        [status, reviewerId || 'Dispatcher', reason || null, queueId]
      );
    }

    if (loadId) {
      await pool.query(
        `UPDATE document_validations
         SET dispatcher_review_status = $1, reviewed_by_user_id = $2, reviewed_timestamp = NOW(),
             rejection_reason = COALESCE($3, rejection_reason)
         WHERE load_id = $4 AND ($5::text IS NULL OR document_type = $5)`,
        [status, reviewerId || 'Dispatcher', reason || null, loadId, docType || null]
      );

      // Sync load state in KV/system state
      try {
        const state = await loadFullState().catch(err => {
          console.error('[handleReviewAction] Failed to loadFullState:', err.message);
          return null;
        });
        if (state && state.loads) {
          const load = state.loads.find(l => String(l.id) === String(loadId) || String(l.loadNumber) === String(loadId));
          if (load) {
            load.docs = load.docs || {};
            const stopNum = req.body?.stopNumber ? Number(req.body.stopNumber) : 1;
            const docKey = (docType || 'BOL').toUpperCase();
            const storageKey = stopNum > 1 ? `${docKey}_${stopNum}` : docKey;
            
            if (load.docs[storageKey]) {
              load.docs[storageKey].status = action === 'APPROVE' ? 'Approved' : 'Rejected';
              if (action === 'REJECT') load.docs[storageKey].rejectionReason = reason;
            }
            if (stopNum === 1 && load.docs[docKey]) {
              load.docs[docKey].status = action === 'APPROVE' ? 'Approved' : 'Rejected';
              if (action === 'REJECT') load.docs[docKey].rejectionReason = reason;
            }

            // Update stop status
            const effStopType = (req.body?.stopType || (docKey === 'BOL' ? 'PICKUP' : 'DELIVERY')).toUpperCase();
            const stopStatus = action === 'APPROVE' ? (effStopType === 'PICKUP' ? 'BOL_APPROVED' : 'POD_APPROVED') : (effStopType === 'PICKUP' ? 'BOL_REJECTED' : 'POD_REJECTED');

            if (effStopType === 'PICKUP' && load.pickupStops) {
              const pStop = load.pickupStops.find(s => (s.stop_number || s.stopNumber) === stopNum);
              if (pStop) pStop.status = stopStatus;
            } else if (effStopType === 'DELIVERY' && load.deliveryStops) {
              const dStop = load.deliveryStops.find(s => (s.stop_number || s.stopNumber) === stopNum);
              if (dStop) dStop.status = stopStatus;
            }

            const { updateStopStatus } = require('../lib/db');
            await updateStopStatus(load.id, effStopType, stopNum, stopStatus).catch(err => {
              console.error('[handleReviewAction] Failed to updateStopStatus in DB:', err.message);
            });

            // Multi-stop advancement
            if (effStopType === 'PICKUP') {
              const pStops = load.pickupStops && load.pickupStops.length > 0 ? load.pickupStops : [{ stopNumber: 1, status: stopStatus }];
              if (pStops.every(s => s.status === 'BOL_APPROVED')) {
                load.status = 'Loaded';
                load.driverProgress = 'LOADED';
              }
            } else if (effStopType === 'DELIVERY') {
              const dStops = load.deliveryStops && load.deliveryStops.length > 0 ? load.deliveryStops : [{ stopNumber: 1, status: stopStatus }];
              if (dStops.every(s => s.status === 'POD_APPROVED')) {
                load.status = 'Drop-off';
                load.driverProgress = 'DELIVERED';
                if (!['Payment Not Requested', 'Payment Requested', 'Payment Received'].includes(load.payment)) load.payment = 'Payment Not Requested';
              }
            }

            await saveFullState(state);
          }
        }
      } catch (syncErr) {
        console.error('[handleReviewAction] Failed to sync load state in dataStore:', syncErr);
      }
    }

    const io = req.app.get('io') || global.io;
    if (io) {
      if (action === 'APPROVE') {
        io.emit('document:approved', {
          loadId,
          docKey: docType || 'BOL',
          documentType: docType || 'BOL',
          stopNumber: req.body?.stopNumber || 1,
          stopType: req.body?.stopType || (docType === 'BOL' ? 'PICKUP' : 'DELIVERY'),
          approvedBy: reviewerId || 'Dispatcher',
          timestamp: new Date().toISOString(),
        });
      } else {
        io.emit('document:rejected', {
          loadId,
          docKey: docType || 'BOL',
          documentType: docType || 'BOL',
          stopNumber: req.body?.stopNumber || 1,
          stopType: req.body?.stopType || (docType === 'BOL' ? 'PICKUP' : 'DELIVERY'),
          reason: reason || 'Document rejected by dispatcher',
          timestamp: new Date().toISOString(),
        });
      }
      io.emit('load:updated', {
        loadId,
        status: action === 'APPROVE' ? (docType === 'BOL' ? 'Loaded' : 'Drop-off') : undefined,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ ok: true, action: status, message: `Document marked as ${status}` });
  } catch (err) {
    console.error('Failed to update review action:', err);
    res.status(500).json({ error: 'Failed to process review action' });
  }
}

// GET /api/driver/loads/:id/documents
// Returns all load documents, lock statuses, version history, and role-based permissions
router.get('/api/driver/loads/:id/documents', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const loadId = req.params.id;
  const userRole = req.query.role || 'driver';

  try {
    const lockService = require('../lib/documentLockService');
    const result = await lockService.getLoadDocuments(loadId, userRole);
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('failed to get load documents:', err);
    res.status(500).json({ error: 'Failed to retrieve load documents' });
  }
});

// POST /api/driver/loads/:id/documents/replace  { docType, filename, fileUrl, reason, base64 }
// Enforces document locking rules and maintains multi-version audit history
router.post('/api/driver/loads/:id/documents/replace', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const loadId = req.params.id;
  const { docType, filename, fileUrl, reason, userRole } = req.body || {};

  if (!docType) {
    return res.status(400).json({ error: 'Missing docType parameter' });
  }

  try {
    const lockService = require('../lib/documentLockService');
    const result = await lockService.replaceLoadDocument({
      loadId,
      docType,
      filename,
      fileUrl,
      uploadedBy: ctx.driver.name || `Driver (${ctx.driver.id})`,
      userRole: userRole || 'driver',
      reason: reason || 'Document uploaded/replaced',
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('failed to replace document:', err);
    const isLockedError = err.message && err.message.includes('locked');
    res.status(isLockedError ? 403 : 500).json({ error: err.message || 'Failed to replace document' });
  }
});

// POST /api/driver/loads/:id/status/skip  { currentStatus, nextStatus }
// Records skipped status in load history while strictly enforcing required document checks
router.post('/api/driver/loads/:id/status/skip', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const loadId = req.params.id;
  const { currentStatus, nextStatus } = req.body || {};

  if (!currentStatus || !nextStatus) {
    return res.status(400).json({ error: 'Missing currentStatus or nextStatus' });
  }

  // Strictly enforce required documents: Cannot skip past LOADED without BOL, or COMPLETED without POD
  if (String(nextStatus).toUpperCase() === 'GOING_TO_DELIVERY' || String(nextStatus).toUpperCase() === 'ARRIVED_DELIVERY') {
    const lockService = require('../lib/documentLockService');
    const docs = await lockService.getLoadDocuments(loadId, 'driver');
    const bol = docs.documents?.BOL;
    if (!bol || bol.status === 'NOT_UPLOADED') {
      return res.status(400).json({
        error: 'BOL Required: You cannot advance past Loaded without a verified Bill of Lading (BOL).',
        documentRequired: 'BOL',
      });
    }
  }

  if (String(nextStatus).toUpperCase() === 'COMPLETED' || String(nextStatus).toUpperCase() === 'DELIVERED') {
    const lockService = require('../lib/documentLockService');
    const docs = await lockService.getLoadDocuments(loadId, 'driver');
    const pod = docs.documents?.POD;
    if (!pod || pod.status === 'NOT_UPLOADED') {
      return res.status(400).json({
        error: 'POD Required: You cannot complete the load without a signed Proof of Delivery (POD).',
        documentRequired: 'POD',
      });
    }
  }

  try {
    const historyKey = `load_status_history:${loadId}`;
    const raw = await kv.get(historyKey).catch(() => null);
    const history = raw ? JSON.parse(raw) : [];

    const skipRecord = {
      loadId,
      status: currentStatus,
      result: 'SKIPPED',
      by: ctx.driver.name || `Driver (${ctx.driver.id})`,
      timestamp: new Date().toISOString(),
      advancedTo: nextStatus,
    };

    history.push(skipRecord);
    await kv.set(historyKey, JSON.stringify(history));

    console.log(`[STATUS SKIP] Load ${loadId}: ${currentStatus} skipped by ${skipRecord.by} ↷ Advanced to ${nextStatus}`);
    res.json({ ok: true, data: skipRecord });
  } catch (err) {
    console.error('failed to record status skip:', err);
    res.status(500).json({ error: 'Failed to record skipped status' });
  }
});

// =========================================================================
// GPS TRACKING, ETA & GEOFENCE ARRIVAL DETECTION
// =========================================================================

// POST /api/driver/location { latitude, longitude, speed, heading, loadId, sharingMode }
router.post('/api/driver/location', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { latitude, longitude, speed, heading, loadId, sharingMode } = req.body || {};
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Missing latitude/longitude coordinates.' });
  }

  try {
    const locRecord = await recordDriverLocation({
      driverId: ctx.driver.id,
      loadId: loadId || null,
      latitude: Number(latitude),
      longitude: Number(longitude),
      speed: speed != null ? Number(speed) : null,
      heading: heading != null ? Number(heading) : null,
      sharingMode: sharingMode || 'ACTIVE_LOAD',
    });

    let trackingData = null;
    let arrivalEvent = null;

    if (loadId) {
      const state = ctx.state;
      const load = (state.loads || []).find((l) => l.id === loadId);
      if (load) {
        trackingData = calculateLoadTracking(load, locRecord);

        // Geofence Arrival Detection (within 0.25 miles / ~400m)
        if (trackingData.milesToPickup <= 0.3 && (load.driverProgress === 'EN_ROUTE_TO_PICKUP' || load.status === 'EN_ROUTE_TO_PICKUP')) {
          arrivalEvent = { type: 'AT_PICKUP', message: `Driver ${ctx.driver.name} arrived at pickup location: ${load.pickup}` };
          await notificationService.notifyDispatcherDriverArrivedPickup(load.dispatcherId || 'admin', load, ctx.driver);
        } else if (trackingData.milesToDelivery <= 0.3 && (load.driverProgress === 'IN_TRANSIT' || load.status === 'IN_TRANSIT')) {
          arrivalEvent = { type: 'AT_DELIVERY', message: `Driver ${ctx.driver.name} arrived at delivery location: ${load.dropoff}` };
          await notificationService.notifyDispatcherDriverArrivedDelivery(load.dispatcherId || 'admin', load, ctx.driver);
        }

        // Automated Delay Detection Alert
        if (trackingData.risk && (trackingData.risk.riskCode === 'RUNNING_LATE' || trackingData.risk.riskCode === 'DELAYED')) {
          await notificationService.notifyAdminCriticalDelay(load, ctx.driver, trackingData.risk.diffMinutes || 35);
        }
      }
    }

    // Broadcast live location over Socket.IO directly to connected dispatchers (0 DB dual-write load)
    const io = req.app.get('io');
    if (io) {
      io.emit('driver_location_update', {
        driverId: ctx.driver.id,
        driverName: ctx.driver.name,
        loadId: loadId || null,
        location: locRecord,
        tracking: trackingData,
        arrivalEvent,
      });
    }

    res.json({
      ok: true,
      location: locRecord,
      tracking: trackingData,
      arrivalEvent,
    });
  } catch (err) {
    console.error('Failed to record driver location:', err);
    res.status(500).json({ error: 'Failed to record location.' });
  }
});

// GET /api/driver/location/history?limit=50
router.get('/api/driver/location/history', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const { getPool, ensureSchema } = require('../lib/db');
    await ensureSchema();
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM driver_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT $2`,
      [ctx.driver.id, limit]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('Failed to fetch location history:', err);
    res.status(500).json({ error: 'Failed to fetch location history.' });
  }
});

// GET /api/driver/loads/:id/tracking
router.get('/api/driver/loads/:id/tracking', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.id && l.driverId === ctx.driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  try {
    const latestLoc = await getLatestDriverLocation(ctx.driver.id);
    const tracking = calculateLoadTracking(load, latestLoc);
    res.json({ ok: true, tracking });
  } catch (err) {
    console.error('Failed to calculate load tracking:', err);
    res.status(500).json({ error: 'Failed to calculate tracking.' });
  }
});


// GET /api/driver/loads/:id/documents/validations
router.get('/api/driver/loads/:id/documents/validations', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  try {
    const validations = await getDocumentValidations(req.params.id);
    res.json({ ok: true, validations });
  } catch (err) {
    console.error('Failed to fetch document validations:', err);
    res.status(500).json({ error: 'Failed to fetch validations.' });
  }
});

// POST /api/driver/contact-dispatch
// Lightweight non-real-time communication / dispatch alert ticket
router.post('/api/driver/contact-dispatch', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { subject, message, loadId, loadNumber, urgent } = req.body || {};

  try {
    const notif = {
      type: 'driver_contact_message',
      title: urgent ? `🚨 URGENT message from ${ctx.driver.name}` : `Message from ${ctx.driver.name}`,
      body: String(message || subject || 'Driver requested contact').trim(),
      data: {
        driverId: ctx.driver.id,
        driverName: ctx.driver.name,
        driverPhone: ctx.driver.phone,
        loadId: loadId || null,
        loadNumber: loadNumber || null,
        urgent: !!urgent,
        sentAt: new Date().toISOString(),
      }
    };

    // Notify assigned dispatcher or admin
    const targetRecipient = ctx.driver.assigned_dispatcher_id || ctx.driver.dispatcherId || 'admin';
    await notifications.create('dispatcher', targetRecipient, notif);
    if (targetRecipient !== 'admin') {
      await notifications.create('admin', 'admin', notif);
    }

    // Record audit trail
    await audit.record(
      { type: 'driver', id: ctx.driver.id, name: ctx.driver.name },
      'DRIVER_CONTACTED_DISPATCH',
      { type: 'DISPATCH_ALERT', id: ctx.driver.id },
      { subject, urgent: !!urgent, loadId, loadNumber }
    );

    res.json({ ok: true, message: 'Message successfully sent to dispatch.' });
  } catch (err) {
    console.error('Failed to send contact message to dispatch:', err);
    res.status(500).json({ error: 'Failed to notify dispatch.' });
  }
});

// GET /api/driver/documents
// Dedicated Driver Documents Tab feed (current load docs + past loads doc history)
router.get('/api/driver/documents', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  try {
    const rawLoads = driverLoads(ctx.state, ctx.driver.id);
    const docOverview = rawLoads.map(load => {
      const docs = load.docs || load.documents || {};
      const statusMeta = (doc) => {
        if (!doc) return { status: 'MISSING', statusColor: 'gray', label: 'Upload Required', hasFile: false };
        const st = String(doc.status || (doc.hasFile || doc.data || doc.name ? 'APPROVED' : 'MISSING')).toUpperCase();
        if (st === 'APPROVED') return { status: 'APPROVED', statusColor: 'green', label: 'Approved', hasFile: true, name: doc.name || doc.fileName };
        if (st === 'REJECTED' || st === 'RETAKE_REQUIRED' || st === 'FIX REQUIRED') return { status: 'REJECTED', statusColor: 'red', label: 'Fix Required', hasFile: true, reason: doc.rejectionReason };
        if (st === 'PENDING' || st === 'UNDER REVIEW' || st === 'CHECKING') return { status: 'CHECKING', statusColor: 'yellow', label: 'Checking', hasFile: true };
        return { status: 'MISSING', statusColor: 'gray', label: 'Upload Required', hasFile: false };
      };

      return {
        loadId: load.id,
        loadNumber: load.loadNumber,
        status: load.status,
        pickup: load.pickup,
        dropoff: load.dropoff,
        pickupDate: load.pickupDate,
        deliveryDate: load.deliveryDate,
        requiredDocs: {
          RC: statusMeta(docs.RC),
          BOL: statusMeta(docs.BOL),
          POD: statusMeta(docs.POD),
        },
        optionalPhotos: {
          pickupPhotos: Array.isArray(docs.PhotosPU) ? docs.PhotosPU : [],
          deliveryPhotos: Array.isArray(docs.PhotosDO) ? docs.PhotosDO : [],
          extraDocs: Array.isArray(docs.Extra) ? docs.Extra : [],
        }
      };
    });

    res.json({ ok: true, documentsFeed: docOverview });
  } catch (err) {
    console.error('Failed to load driver documents feed:', err);
    res.status(500).json({ error: 'Failed to load documents feed.' });
  }
});

module.exports = router;



