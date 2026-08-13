const express = require('express');
const kv = require('../lib/kvstore');
const sessions = require('../lib/driverSessions');
const history = require('../lib/historyStore');
const notifications = require('../lib/notificationStore');
const chat = require('../lib/chatStore');
const audit = require('../lib/auditStore');
const store = require('../lib/store');
const { clientForAccount } = require('../lib/googleClient');
const { recordDriverLocation, getLatestDriverLocation } = require('../lib/db');
const { calculateLoadTracking } = require('../lib/etaEngine');

const router = express.Router();
router.use(express.json({ limit: '10mb' }));

// Same key the frontend's window.storage polyfill uses for the whole app
// blob (see loadState()/persist() in public/index.html).
const STATE_KEY = 'haulline:state';

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
  const raw = await kv.get(STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function saveFullState(state) {
  await kv.set(STATE_KEY, JSON.stringify(state));
}

// Looks a driver up by Driver ID + PIN (both set by Admin on the driver
// record). Intentionally case/whitespace-forgiving on the ID, exact on the PIN.
function findDriverByCredentials(state, driverId, pin) {
  const code = String(driverId || '').trim().toUpperCase();
  const p = String(pin || '').trim();
  if (!code || !p) return null;
  return (
    (state.drivers || []).find(
      (d) => (d.driverCode || '').trim().toUpperCase() === code && (d.pin || '').trim() === p
    ) || null
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
  const state = await loadFullState();
  if (!state) {
    res.status(500).json({ error: 'Something went wrong. Try again.' });
    return null;
  }

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  let driver = null;
  if (bearer) {
    const driverId = await sessions.verify(bearer);
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

// Shapes a load down to only what a driver should ever see about their own
// run — no dispatch revenue, no broker rate, no other drivers' pay, nothing
// belonging to anyone else. Document contents are summarized (name + whether
// a file is on record) rather than sent in full, to keep payloads small;
// actual file bytes are fetched on demand via /api/driver/doc.
// Remaining-miles estimate for the Current Load dashboard, derived from the
// driver's own checkpoint progress (no separate GPS/mileage tracking exists,
// so this reuses the existing driverProgress field rather than adding one).
const PROGRESS_REMAINING_PCT = { ACCEPTED: 1, AT_PICKUP: 1, IN_TRANSIT: 0.5, AT_DELIVERY: 0.1 };
function remainingMiles(l) {
  const total = Number(l.miles) || 0;
  const pct = PROGRESS_REMAINING_PCT[l.driverProgress] ?? 1;
  return Math.round(total * pct);
}

function shapeLoadForDriver(l) {
  const docs = l.docs || {};
  const singleMeta = (v) => (v && v.name ? { name: v.name, hasFile: !!v.data } : null);
  const arrMeta = (arr) => (arr || []).map((f, i) => ({ index: i, name: f.name, hasFile: !!f.data, uploadedAt: f.uploadedAt || null, uploadedBy: f.uploadedBy || null }));
  return {
    id: l.id,
    loadNumber: l.loadNumber,
    status: l.status,
    driverProgress: l.driverProgress || null,
    brokerName: l.brokerName || null,
    pickup: l.pickup,
    dropoff: l.dropoff,
    pickupDate: l.pickupDate,
    pickupTime: l.pickupTime || null,
    deliveryDate: l.deliveryDate,
    deliveryTime: l.deliveryTime || null,
    eta: l.eta || null,
    etaUpdatedAt: l.etaUpdatedAt || null,
    etaUpdatedBy: l.etaUpdatedBy || null,
    miles: l.miles,
    milesRemaining: remainingMiles(l),
    driverPay: l.driverPay,
    driverPaid: !!l.driverPaid,
    driverPaidDate: l.driverPaidDate || null,
    notes: l.notes || '',
    docs: {
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
  return l.status === 'Drop-off' || l.status === 'Completed' || l.status === 'Delivered';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// POST /api/driver/login  { driverId, pin }
// Returns ONLY this driver's own profile + their own loads — never the
// company-wide state blob other roles load in full on the client. Also
// issues a Bearer session token for every subsequent call.
router.post('/api/driver/login', async (req, res) => {
  const { driverId, pin } = req.body || {};
  try {
    const state = await loadFullState();
    const driver = state && findDriverByCredentials(state, driverId, pin);
    if (!driver || isDisabled(driver)) {
      // Deliberately identical message whether the Driver ID doesn't exist,
      // the PIN is wrong, or the account is disabled.
      return res.status(401).json({ error: 'Invalid Driver ID or PIN' });
    }
    const loads = driverLoads(state, driver.id)
      .sort((a, b) => String(b.pickupDate || '').localeCompare(String(a.pickupDate || '')))
      .map(shapeLoadForDriver);

    const token = await sessions.issue(driver.id);
    await audit.record({ type: 'driver', id: driver.id, name: driver.name }, 'driver.login', { type: 'driver', id: driver.id });

    res.json({
      ok: true,
      token,
      driver: { id: driver.id, name: driver.name, truck: driver.truck, phone: driver.phone, company: driver.company },
      permissions: permissionsFor(driver),
      companyName: (state.settings && state.settings.companyName) || 'HaulBoX',
      loads,
    });
  } catch (e) {
    console.error('driver login failed:', e);
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
  const { driver } = ctx;
  res.json({
    driver: { id: driver.id, name: driver.name, truck: driver.truck, phone: driver.phone, email: driver.email || null, company: driver.company, status: isDisabled(driver) ? 'Inactive' : 'Active' },
    permissions: permissionsFor(driver),
  });
});

// POST /api/driver/location
// Receives live driver GPS updates (latitude, longitude, speed, heading, sharingMode, loadId).
router.post('/api/driver/location', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
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
    currentLoad: current ? shapeLoadForDriver(current) : null,
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
    .map(shapeLoadForDriver);
  res.json({ loads });
});

// GET /api/driver/loads/:id
router.get('/api/driver/loads/:id', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canViewLoads', 'Loads')) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.id && l.driverId === ctx.driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  res.json({ load: shapeLoadForDriver(load) });
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

// Driver-facing checkpoints. Deliberately a separate field
// (`driverProgress`) from the dispatch-owned `status` field that
// computeStatus()/handleDocUpload() manage in public/index.html — a driver
// tapping "In Transit" should never silently overwrite dispatch's own status
// logic tied to RC/BOL/POD uploads.
const DRIVER_CHECKPOINTS = ['ACCEPTED', 'AT_PICKUP', 'IN_TRANSIT', 'AT_DELIVERY'];

// POST /api/driver/loads/:id/status  { status, note }
router.post('/api/driver/loads/:id/status', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canUpdateLoadStatus', 'Updating load status')) return;

  const { status, note } = req.body || {};
  const checkpoint = String(status || '').trim().toUpperCase();
  if (!DRIVER_CHECKPOINTS.includes(checkpoint)) {
    return res.status(400).json({ error: 'Invalid status. Must be one of: ' + DRIVER_CHECKPOINTS.join(', ') });
  }

  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => l.id === req.params.id && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  load.driverProgress = checkpoint;
  try {
    await saveFullState(state);
    await notifications.create('admin', 'admin', {
      type: 'load_status_changed',
      title: `${driver.name || 'Driver'} — ${load.loadNumber || load.id}`,
      body: `Marked ${checkpoint.replace('_', ' ').toLowerCase()}` + (note ? `: ${note}` : ''),
      data: { loadId: load.id },
    });
    res.json({ ok: true, load: shapeLoadForDriver(load) });
  } catch (e) {
    console.error('driver status update failed:', e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// POST /api/driver/loads/:id/eta  { eta }
router.post('/api/driver/loads/:id/eta', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { eta } = req.body || {};
  if (!eta) return res.status(400).json({ error: 'Missing ETA string' });

  const { state, driver } = ctx;
  const load = (state.loads || []).find((l) => l.id === req.params.id && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  load.eta = eta;
  load.driverManualEta = eta;
  load.etaUpdatedAt = new Date().toISOString();
  load.etaUpdatedBy = driver.name || 'Driver';

  try {
    await saveFullState(state);
    await history.record(load.id, 'ETA_UPDATED', `Driver updated ETA to: ${eta}`, { type: 'driver', id: driver.id, name: driver.name });
    res.json({ ok: true, load: shapeLoadForDriver(load) });
  } catch (e) {
    console.error('driver eta update failed:', e);
    res.status(500).json({ error: 'Failed to save ETA' });
  }
});

// ---------------------------------------------------------------------------
// Documents (load-level: RC/BOL/POD/photos)
// ---------------------------------------------------------------------------

// POST /api/driver/doc  { driverId?, pin?, loadId, key, index? }  (or Bearer token)
// Fetches one document's actual file data, only for a load that belongs to
// the authenticated driver.
router.post('/api/driver/doc', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  const { loadId, key, index } = req.body || {};
  const { state, driver } = ctx;

  const load = (state.loads || []).find((l) => l.id === loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const docs = load.docs || {};
  let file = null;
  if (['RC', 'BOL', 'POD'].includes(key)) file = docs[key];
  else if (['PhotosPU', 'PhotosDO', 'Extra'].includes(key)) file = (docs[key] || [])[index];

  if (!file || !file.data) return res.status(404).json({ error: 'File not available' });
  res.json({ ok: true, name: file.name, data: file.data });
});

// Document slots a driver is allowed to add to themselves, and each slot's
// cap — mirrors the limits the Admin/Dispatcher UI enforces (see docCap() in
// public/index.html). Rate Confirmation (RC) is deliberately excluded: only
// Admin/Dispatcher can attach that one, since it's what books the load.
const DRIVER_UPLOAD_CAPS = { BOL: 1, POD: 1, PhotosPU: 6, PhotosDO: 6, Extra: 6 };

// POST /api/driver/upload-doc  { driverId?, pin?, loadId, key, fileName, mimeType, data }  (or Bearer token)
router.post('/api/driver/upload-doc', async (req, res) => {
  const { key, fileName, data } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(DRIVER_UPLOAD_CAPS, key)) {
    return res.status(400).json({ error: 'Drivers cannot upload that document type.' });
  }
  if (!fileName || !data) return res.status(400).json({ error: 'Missing file' });

  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canUploadDocuments', 'Uploading documents')) return;
  const { state, driver } = ctx;
  const { loadId } = req.body || {};

  const load = (state.loads || []).find((l) => l.id === loadId && l.driverId === driver.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  load.docs = load.docs || {};
  const isArray = ['PhotosPU', 'PhotosDO', 'Extra'].includes(key);
  const rec = { name: fileName, data, uploadedAt: new Date().toISOString(), uploadedBy: driver.name || driver.id };

  if (isArray) {
    const arr = (load.docs[key] = load.docs[key] || []);
    const cap = DRIVER_UPLOAD_CAPS[key];
    if (arr.length >= cap) {
      return res.status(400).json({ error: 'Limit of ' + cap + ' files reached for this slot.' });
    }
    arr.push(rec);
  } else {
    load.docs[key] = rec;
  }

  // Uploading BOL/POD also advances the load's status, same rule the
  // Admin/Dispatcher UI uses (see computeStatus() in public/index.html).
  if (load.docs.POD) load.status = 'Drop-off';
  else if (load.docs.BOL) load.status = 'Loaded';
  else if (load.docs.RC) load.status = 'Booked';
  else load.status = 'Pending RC';

  // Payment stage only ever applies once a load hits Drop-off — same rule
  // handleDocUpload() uses on the Admin/Dispatcher side.
  const PAYMENT_STAGES = ['Payment Not Requested', 'Payment Requested', 'Payment Received'];
  if (load.status === 'Drop-off' && !PAYMENT_STAGES.includes(load.payment)) load.payment = 'Payment Not Requested';
  if (load.status !== 'Drop-off') load.payment = null;

  try {
    await saveFullState(state);
    await history.record(load.id, `${key}_UPLOADED`, fileName, { type: 'driver', id: driver.id, name: driver.name });
    await notifications.create('admin', 'admin', {
      type: 'document_uploaded',
      title: `${driver.name || 'Driver'} uploaded ${key}`,
      body: `${load.loadNumber || load.id} — ${fileName}`,
      data: { loadId: load.id, key },
    });

    // Auto-upload BOL and POD to Google Drive using the admin's connected
    // account token (drivers have no Google OAuth account of their own).
    // Fire-and-forget — never blocks the driver's response even on Drive errors.
    if (['BOL', 'POD'].includes(key)) {
      (async () => {
        try {
          const folderId = driveStore.folderIds()[key];
          if (!folderId) return; // folder env var not configured — skip silently
          const adminRecord = await store.get('admin');
          if (!adminRecord) return; // admin not connected to Google — skip silently
          const { clientForAccount: cfa } = require('../lib/googleClient');
          const auth = cfa(adminRecord, store, 'admin');
          const driveFileName = driveStore.buildFileName(key, {
            loadNumber: load.loadNumber,
            driverName: driver.name,
            originalName: fileName,
          });
          const rawBase64 = rec.data ? rec.data.split(',').slice(1).join(',') : '';
          if (!rawBase64) return;
          const result = await driveStore.uploadToFolder(auth, {
            folderId,
            fileName: driveFileName,
            mimeType: 'application/octet-stream',
            base64Data: rawBase64,
          });
          if (!result.duplicate) {
            await driveStore.recordUpload({
              loadId: load.id,
              driverId: driver.id,
              docType: key,
              driveFileId: result.fileId,
              fileName: driveFileName,
              folderId,
              webViewLink: result.webViewLink,
              uploadedBy: `driver:${driver.id}`,
            });
          }
        } catch (driveErr) {
          console.error(`driver ${key} Drive upload failed (non-blocking):`, driveErr.message);
        }
      })();
    }

    res.json({ ok: true, load: shapeLoadForDriver(load) });
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
    confirmedAt: l.confirmedAt || l.driverPayAcceptedAt || null,
    disputedAt: l.disputedAt || null,
    note: l.driverPayNote || l.driverPaySettlementNote || null,
    accepted: !!(l.driverPayAccepted || ps === 'PAID_CONFIRMED'),
    acceptedAt: l.driverPayAcceptedAt || l.confirmedAt || null,
    acceptanceStatus: ps === 'PAID_CONFIRMED' ? 'Confirmed' : (ps === 'PAYMENT_DISPUTED' ? 'Disputed' : (ps === 'PAYMENT_PENDING_CONFIRMATION' ? 'Pending Confirmation' : 'Unpaid')),
  };
}

// GET /api/driver/transactions
router.get('/api/driver/transactions', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const loads = driverLoads(ctx.state, ctx.driver.id);
  const txns = loads
    .sort((a, b) => String(b.deliveryDate || b.pickupDate || '').localeCompare(String(a.deliveryDate || a.pickupDate || '')))
    .map(toTransaction);
  const totalEarnings = txns.reduce((s, t) => s + t.amount, 0);
  const paidTxns = txns.filter((t) => t.paymentStatus === 'PAID_CONFIRMED' || t.status === 'PAID');
  const paid = paidTxns.reduce((s, t) => s + t.amount, 0);
  const pending = totalEarnings - paid;
  res.json({ summary: { totalEarnings, paid, pending, totalPaymentsReceived: paidTxns.length, totalAmountReceived: paid }, transactions: txns });
});

// GET /api/driver/transactions/:loadId
router.get('/api/driver/transactions/:loadId', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
  if (!requirePermission(res, ctx.driver, 'canViewTransactions', 'Transactions')) return;
  const load = (ctx.state.loads || []).find((l) => l.id === req.params.loadId && l.driverId === ctx.driver.id);
  if (!load) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: toTransaction(load) });
});

// POST /api/driver/transactions/:loadId/accept — Confirm Payment Received
router.post('/api/driver/transactions/:loadId/accept', async (req, res) => {
  const ctx = await requireDriver(req, res);
  if (!ctx) return;
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

module.exports = router;
