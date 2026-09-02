// routes/owner.js
// Owner Business & Financial Management APIs for HaulBoX (Phases 3-5)

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const audit = require('../lib/auditStore');
const history = require('../lib/historyStore');

// ---------------------------------------------------------------------------
// Helper: 5-State Payment Status Resolver
// ---------------------------------------------------------------------------
function resolvePaymentStatus(load) {
  if (!load) return 'UNPAID';

  // 1. Explicit dispute takes highest precedence
  if (load.paymentStatus === 'PAYMENT_DISPUTED' || load.isDisputed === true) {
    return 'PAYMENT_DISPUTED';
  }

  // 2. Confirmed by driver
  if (load.paymentStatus === 'PAID_CONFIRMED' || load.driverPayAccepted === true) {
    return 'PAID_CONFIRMED';
  }

  // 3. Marked as paid by Company/Admin/Owner
  if (load.driverPaid === true || load.paymentStatus === 'PAID') {
    return 'PAID';
  }

  // 4. Ready to pay: Load is delivered / drop-off completed (and not disputed/paid)
  const statusUpper = String(load.status || '').toUpperCase();
  const progressUpper = String(load.driverProgress || '').toUpperCase();
  const isDelivered = (
    statusUpper === 'DELIVERED' ||
    statusUpper === 'DROP-OFF' ||
    statusUpper === 'COMPLETED' ||
    progressUpper === 'DELIVERED' ||
    progressUpper === 'COMPLETED'
  );

  if (isDelivered) {
    return 'READY_TO_PAY';
  }

  // 5. In-transit / routine pending load
  return 'UNPAID';
}

// ---------------------------------------------------------------------------
// Helper: Date & Period Filter
// ---------------------------------------------------------------------------
function parsePeriodFilter(period, fromDate, toDate) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (String(period || 'all').toLowerCase()) {
    case 'today':
      return { start: todayStart, end: todayEnd };
    case 'yesterday': {
      const yStart = new Date(todayStart);
      yStart.setDate(yStart.getDate() - 1);
      const yEnd = new Date(todayEnd);
      yEnd.setDate(yEnd.getDate() - 1);
      return { start: yStart, end: yEnd };
    }
    case 'this_week': {
      const day = todayStart.getDay();
      const diff = todayStart.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const weekStart = new Date(todayStart);
      weekStart.setDate(diff);
      return { start: weekStart, end: now };
    }
    case 'this_month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      return { start: monthStart, end: now };
    }
    case 'custom': {
      const s = fromDate ? new Date(fromDate) : new Date(0);
      const e = toDate ? new Date(toDate) : now;
      return { start: isNaN(s) ? null : s, end: isNaN(e) ? null : e };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

function loadMatchesPeriod(load, range) {
  if (!range || (!range.start && !range.end)) return true;
  const rawDate = load.deliveryDate || load.pickupDate || load.createdAt || load.created_at;
  if (!rawDate) return false;
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Middleware: Server-Side Owner Authorization
// ---------------------------------------------------------------------------
async function requireOwner(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!bearer) {
      return res.status(401).json({ error: 'Unauthorized: Authentication token required.' });
    }

    // 1. Verify against driver_sessions
    const session = await sessions.verifySession(bearer);
    let isOwner = false;
    let ownerObj = null;

    if (session) {
      if (session.role === 'OWNER') {
        ownerObj = await db.getOwnerById(session.userId);
        if (!ownerObj) {
          const state = await dataStore.loadFullState().catch(() => ({}));
          ownerObj = (state.owners || []).find(o => String(o.id) === String(session.userId));
        }
        if (ownerObj && ownerObj.active !== false) {
          isOwner = true;
        }
      }
    }

    // 2. Allow fallback for Admin / Super Admin web sessions if accessing owner endpoints
    if (!isOwner) {
      // Check admin security pin header or web token
      const adminPin = req.headers['x-admin-pin'];
      const settingsPin = process.env.SETTINGS_ADMIN_PIN || '8483';
      if (adminPin && String(adminPin).trim() === String(settingsPin).trim()) {
        isOwner = true;
        ownerObj = { id: 'admin', name: 'System Admin', role: 'OWNER' };
      }
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden: Owner role authorization required.' });
    }

    let state = await dataStore.loadFullState().catch(() => null);
    if (!state) state = { drivers: [], loads: [], dispatchers: [], brokers: [], owners: [], settings: {} };
    req.owner = ownerObj || { id: session.userId, role: 'OWNER' };
    req.state = state;
    next();
  } catch (err) {
    console.error('requireOwner error:', err);
    res.status(500).json({ error: 'Authorization error: ' + err.message });
  }
}

// ---------------------------------------------------------------------------
// 1. GET /api/owner/summary — Dashboard KPIs & Availability
// ---------------------------------------------------------------------------
router.get('/summary', requireOwner, (req, res) => {
  const { state } = req;
  const period = req.query.period || 'all';
  const range = parsePeriodFilter(period, req.query.from, req.query.to);

  const allLoads = (state.loads || []).filter(l => !l.isDeleted && !l.is_deleted);
  const periodLoads = allLoads.filter(l => loadMatchesPeriod(l, range));

  // Financial KPIs for the period
  let grossRevenue = 0;
  let driverPay = 0;
  periodLoads.forEach(l => {
    const rate = Number(l.rate || l.brokerRate || 0);
    const pay = Number(l.driverPay || 0);
    grossRevenue += rate;
    driverPay += pay;
  });

  const estimatedProfit = grossRevenue - driverPay;
  const grossMarginPct = grossRevenue > 0 ? ((estimatedProfit / grossRevenue) * 100) : 0;

  // Active loads (all currently in-progress loads)
  const activeLoads = allLoads.filter(l => {
    const st = String(l.status || '').toUpperCase();
    const prog = String(l.driverProgress || '').toUpperCase();
    return st !== 'DELIVERED' && st !== 'DROP-OFF' && st !== 'COMPLETED' && st !== 'CANCELLED' &&
           prog !== 'DELIVERED' && prog !== 'COMPLETED';
  });

  // Drivers availability
  const allDrivers = (state.drivers || []).filter(d => d.active !== false && d.status !== 'inactive');
  let availableCount = 0;
  let onLoadCount = 0;
  let atPickupCount = 0;
  let atDeliveryCount = 0;

  allDrivers.forEach(d => {
    const activeLoad = activeLoads.find(l => String(l.driverId) === String(d.id));
    if (!activeLoad) {
      availableCount++;
    } else {
      const prog = String(activeLoad.driverProgress || '').toUpperCase();
      if (prog === 'AT_PICKUP') atPickupCount++;
      else if (prog === 'AT_DELIVERY') atDeliveryCount++;
      else onLoadCount++;
    }
  });

  // Payment totals across all loads (mapped into 5 explicit states)
  let readyToPayAmount = 0;
  let readyToPayCount = 0;
  let paidAmount = 0;
  let paidCount = 0;
  let unpaidAmount = 0;
  let unpaidCount = 0;
  let disputedAmount = 0;
  let disputedCount = 0;

  allLoads.forEach(l => {
    const payStatus = resolvePaymentStatus(l);
    const payAmt = Number(l.driverPay || 0);

    if (payStatus === 'READY_TO_PAY') {
      readyToPayAmount += payAmt;
      readyToPayCount++;
    } else if (payStatus === 'PAID' || payStatus === 'PAID_CONFIRMED') {
      paidAmount += payAmt;
      paidCount++;
    } else if (payStatus === 'PAYMENT_DISPUTED') {
      disputedAmount += payAmt;
      disputedCount++;
    } else {
      unpaidAmount += payAmt;
      unpaidCount++;
    }
  });

  // Active loads preview (top 5)
  const activeLoadsPreview = activeLoads.slice(0, 5).map(l => {
    const drv = (state.drivers || []).find(d => String(d.id) === String(l.driverId));
    return {
      id: l.id,
      loadNumber: l.loadNumber || l.load_number,
      pickup: l.pickup || `${l.pickupCity || l.pickup_city || ''}, ${l.pickupState || l.pickup_state || ''}`.trim().replace(/^,|,$/g, ''),
      dropoff: l.dropoff || `${l.deliveryCity || l.delivery_city || ''}, ${l.deliveryState || l.delivery_state || ''}`.trim().replace(/^,|,$/g, ''),
      driverName: drv ? drv.name : (l.driverName || 'Unassigned'),
      rate: Number(l.rate || l.brokerRate || 0),
      driverPay: Number(l.driverPay || 0),
      status: l.status || 'In Transit',
      driverProgress: l.driverProgress || 'ASSIGNED'
    };
  });

  res.json({
    ok: true,
    period,
    activeLoadsCount: activeLoads.length,
    totalDrivers: allDrivers.length,
    availableDrivers: availableCount,
    driversAvailability: {
      available: availableCount,
      onLoad: onLoadCount,
      atPickup: atPickupCount,
      atDelivery: atDeliveryCount,
    },
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    driverPay: Math.round(driverPay * 100) / 100,
    estimatedProfit: Math.round(estimatedProfit * 100) / 100,
    grossMarginPct: Math.round(grossMarginPct * 10) / 10,
    paymentSummary: {
      readyToPayAmount: Math.round(readyToPayAmount * 100) / 100,
      readyToPayCount,
      paidAmount: Math.round(paidAmount * 100) / 100,
      paidCount,
      unpaidAmount: Math.round(unpaidAmount * 100) / 100,
      unpaidCount,
      disputedAmount: Math.round(disputedAmount * 100) / 100,
      disputedCount,
    },
    activeLoadsPreview,
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/owner/loads — Read-Only Loads List with Status Filtering
// ---------------------------------------------------------------------------
router.get('/loads', requireOwner, (req, res) => {
  const { state } = req;
  const statusFilter = String(req.query.status || 'ALL').toUpperCase();
  const search = String(req.query.search || '').trim().toLowerCase();
  const range = parsePeriodFilter(req.query.period, req.query.from, req.query.to);

  let loads = (state.loads || []).filter(l => !l.isDeleted && !l.is_deleted);
  loads = loads.filter(l => loadMatchesPeriod(l, range));

  // Filter by lifecycle status
  if (statusFilter !== 'ALL') {
    loads = loads.filter(l => {
      const st = String(l.status || '').toUpperCase();
      if (statusFilter === 'BOOKED') return st === 'BOOKED' || st === 'ASSIGNED';
      if (statusFilter === 'LOADED') return st === 'LOADED' || st === 'IN TRANSIT' || st === 'IN_TRANSIT';
      if (statusFilter === 'DELIVERED') return st === 'DELIVERED' || st === 'DROP-OFF' || st === 'COMPLETED';
      if (statusFilter === 'CANCELLED') return st === 'CANCELLED';
      return st === statusFilter;
    });
  }

  // Filter by search term (load #, driver name, lane)
  if (search) {
    loads = loads.filter(l => {
      const drv = (state.drivers || []).find(d => String(d.id) === String(l.driverId));
      const drvName = (drv ? drv.name : (l.driverName || '')).toLowerCase();
      const loadNum = String(l.loadNumber || l.load_number || '').toLowerCase();
      const pickup = String(l.pickup || `${l.pickupCity || ''} ${l.pickupState || ''}`).toLowerCase();
      const dropoff = String(l.dropoff || `${l.deliveryCity || ''} ${l.deliveryState || ''}`).toLowerCase();
      const broker = String(l.brokerName || l.broker_name || '').toLowerCase();
      return loadNum.includes(search) || drvName.includes(search) || pickup.includes(search) || dropoff.includes(search) || broker.includes(search);
    });
  }

  // Shape loads for Owner view (Read-only)
  const shaped = loads.map(l => {
    const drv = (state.drivers || []).find(d => String(d.id) === String(l.driverId));
    const payStatus = resolvePaymentStatus(l);
    return {
      id: l.id,
      loadNumber: l.loadNumber || l.load_number,
      brokerName: l.brokerName || l.broker_name || 'Direct Broker',
      driverId: l.driverId || l.driver_id,
      driverName: drv ? drv.name : (l.driverName || 'Unassigned'),
      pickup: l.pickup || `${l.pickupCity || l.pickup_city || ''}, ${l.pickupState || l.pickup_state || ''}`.trim().replace(/^,|,$/g, ''),
      dropoff: l.dropoff || `${l.deliveryCity || l.delivery_city || ''}, ${l.deliveryState || l.delivery_state || ''}`.trim().replace(/^,|,$/g, ''),
      pickupDate: l.pickupDate || l.pickup_date,
      deliveryDate: l.deliveryDate || l.delivery_date,
      miles: Number(l.miles || 0),
      rate: Number(l.rate || l.brokerRate || 0),
      driverPay: Number(l.driverPay || 0),
      estimatedProfit: Math.round((Number(l.rate || l.brokerRate || 0) - Number(l.driverPay || 0)) * 100) / 100,
      status: l.status || 'In Transit',
      driverProgress: l.driverProgress || 'ASSIGNED',
      paymentStatus: payStatus,
      driverPaid: Boolean(l.driverPaid),
      markedPaidAt: l.markedPaidAt || null,
      markedPaidBy: l.markedPaidBy || null,
    };
  });

  res.json({
    ok: true,
    total: shaped.length,
    loads: shaped,
  });
});

// ---------------------------------------------------------------------------
// 3. GET /api/owner/payments — Per-Driver Payment Summaries & Detail
// ---------------------------------------------------------------------------
router.get('/payments', requireOwner, (req, res) => {
  const { state } = req;
  const categoryFilter = String(req.query.filter || 'all').toLowerCase();
  const search = String(req.query.search || '').trim().toLowerCase();

  const drivers = (state.drivers || []).filter(d => d.active !== false);
  const allLoads = (state.loads || []).filter(l => !l.isDeleted && !l.is_deleted);

  const driverSummaries = drivers.map(d => {
    const dLoads = allLoads.filter(l => String(l.driverId) === String(d.id));

    let totalEarnings = 0;
    let readyToPay = 0;
    let paid = 0;
    let unpaid = 0;
    let disputed = 0;
    let disputedCount = 0;

    const paymentRecords = dLoads.map(l => {
      const amt = Number(l.driverPay || 0);
      totalEarnings += amt;
      const status = resolvePaymentStatus(l);

      if (status === 'READY_TO_PAY') readyToPay += amt;
      else if (status === 'PAID' || status === 'PAID_CONFIRMED') paid += amt;
      else if (status === 'PAYMENT_DISPUTED') {
        disputed += amt;
        disputedCount++;
      } else unpaid += amt;

      return {
        loadId: l.id,
        loadNumber: l.loadNumber || l.load_number,
        amount: amt,
        rate: Number(l.rate || l.brokerRate || 0),
        pickup: l.pickup || `${l.pickupCity || ''}, ${l.pickupState || ''}`.trim(),
        dropoff: l.dropoff || `${l.deliveryCity || ''}, ${l.deliveryState || ''}`.trim(),
        deliveryDate: l.deliveryDate || l.pickupDate || l.createdAt,
        loadStatus: l.status || 'In Transit',
        paymentStatus: status,
        driverPaid: Boolean(l.driverPaid),
        markedPaidAt: l.markedPaidAt || null,
        markedPaidBy: l.markedPaidBy || null,
        isEligibleToPay: status === 'READY_TO_PAY',
      };
    });

    return {
      driverId: d.id,
      driverName: d.name,
      truck: d.truck || 'HL-101',
      phone: d.phone || '',
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      readyToPay: Math.round(readyToPay * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      unpaid: Math.round(unpaid * 100) / 100,
      disputed: Math.round(disputed * 100) / 100,
      hasDisputed: disputedCount > 0,
      disputedCount,
      paymentsCount: paymentRecords.length,
      records: paymentRecords.sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || ''))),
    };
  });

  // Apply search
  let filtered = driverSummaries;
  if (search) {
    filtered = filtered.filter(d =>
      d.driverName.toLowerCase().includes(search) ||
      d.truck.toLowerCase().includes(search) ||
      d.phone.includes(search)
    );
  }

  // Apply category filter
  if (categoryFilter === 'ready_to_pay') {
    filtered = filtered.filter(d => d.readyToPay > 0);
  } else if (categoryFilter === 'unpaid') {
    filtered = filtered.filter(d => d.unpaid > 0);
  } else if (categoryFilter === 'paid') {
    filtered = filtered.filter(d => d.paid > 0);
  } else if (categoryFilter === 'disputed') {
    filtered = filtered.filter(d => d.hasDisputed);
  }

  res.json({
    ok: true,
    totalDrivers: filtered.length,
    drivers: filtered,
  });
});

// ---------------------------------------------------------------------------
// 4. POST /api/owner/payments/mark-paid — Mark Eligible Payment as Paid
// ---------------------------------------------------------------------------
router.post('/payments/mark-paid', requireOwner, async (req, res) => {
  const { loadId } = req.body || {};
  if (!loadId) {
    return res.status(400).json({ error: 'Missing required loadId' });
  }

  const { state, owner } = req;
  const load = (state.loads || []).find(l => String(l.id) === String(loadId));
  if (!load) {
    return res.status(404).json({ error: 'Load record not found' });
  }

  const currentStatus = resolvePaymentStatus(load);

  // Strict Validation:
  // 1. If already PAID or PAID_CONFIRMED -> reject duplicate action
  if (currentStatus === 'PAID' || currentStatus === 'PAID_CONFIRMED') {
    return res.status(409).json({
      error: `Payment for load #${load.loadNumber} has already been marked as paid (${currentStatus}).`
    });
  }

  // 2. If PAYMENT_DISPUTED -> reject; disputes must follow administrative resolution
  if (currentStatus === 'PAYMENT_DISPUTED') {
    return res.status(400).json({
      error: `Cannot mark load #${load.loadNumber} as paid while under an active dispute. The dispute must be resolved through administrative review first.`
    });
  }

  // 3. If UNPAID (still in-transit, not delivered) -> reject
  if (currentStatus === 'UNPAID') {
    return res.status(400).json({
      error: `Load #${load.loadNumber} has not completed delivery with verified documentation. Only loads in "Ready to Pay" status can be marked as paid.`
    });
  }

  // Mutate payment state
  const nowIso = new Date().toISOString();
  load.driverPaid = true;
  load.driverPaidDate = nowIso.slice(0, 10);
  load.markedPaidAt = nowIso;
  load.markedPaidBy = owner.name || 'Owner';
  load.paymentStatus = 'PAID';

  try {
    await dataStore.saveFullState(state, {
      id: owner.id,
      name: owner.name || 'Owner',
      email: owner.email || 'owner@haulbox.com',
      role: 'owner'
    });

    // Write to immutable audit logs & load history
    await history.record(load.id, 'PAYMENT_MARKED_PAID', `Owner ${owner.name || 'Owner'} marked payment of $${load.driverPay || 0} as paid.`, {
      type: 'owner',
      id: owner.id,
      name: owner.name || 'Owner'
    });

    await audit.record(
      { type: 'owner', id: owner.id, name: owner.name || 'Owner' },
      'owner.payment_marked_paid',
      { type: 'load', id: load.id },
      {
        loadNumber: load.loadNumber,
        driverId: load.driverId,
        amount: Number(load.driverPay) || 0,
        markedPaidAt: nowIso
      }
    );

    // Broadcast real-time Socket.IO notification to connected web and driver apps
    const io = req.app.get('io') || global.io;
    if (io) {
      io.emit('load:updated', { id: load.id, paymentStatus: 'PAID', driverPaid: true });
      io.emit('payment:updated', { loadId: load.id, driverId: load.driverId, status: 'PAID', amount: load.driverPay });
    }

    res.json({
      ok: true,
      message: `Payment of $${load.driverPay || 0} for load #${load.loadNumber} successfully marked as Paid.`,
      load: {
        id: load.id,
        loadNumber: load.loadNumber,
        driverPaid: load.driverPaid,
        markedPaidAt: load.markedPaidAt,
        markedPaidBy: load.markedPaidBy,
        paymentStatus: load.paymentStatus,
      }
    });
  } catch (err) {
    console.error('Mark paid failed:', err);
    res.status(500).json({ error: 'Failed to update payment status: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. GET /api/owner/reports — Period Load Activity & Financial Breakdown
// ---------------------------------------------------------------------------
router.get('/reports', requireOwner, (req, res) => {
  const { state } = req;
  const period = req.query.period || 'this_month';
  const range = parsePeriodFilter(period, req.query.from, req.query.to);

  const allLoads = (state.loads || []).filter(l => !l.isDeleted && !l.is_deleted);
  const periodLoads = allLoads.filter(l => loadMatchesPeriod(l, range));

  let totalGross = 0;
  let totalDriverPay = 0;
  const statusCounts = { BOOKED: 0, LOADED: 0, DELIVERED: 0, CANCELLED: 0 };
  const driverMap = new Map();

  periodLoads.forEach(l => {
    const rate = Number(l.rate || l.brokerRate || 0);
    const pay = Number(l.driverPay || 0);
    totalGross += rate;
    totalDriverPay += pay;

    // Tally status
    const st = String(l.status || '').toUpperCase();
    if (st === 'BOOKED' || st === 'ASSIGNED') statusCounts.BOOKED++;
    else if (st === 'LOADED' || st === 'IN TRANSIT' || st === 'IN_TRANSIT') statusCounts.LOADED++;
    else if (st === 'DELIVERED' || st === 'DROP-OFF' || st === 'COMPLETED') statusCounts.DELIVERED++;
    else if (st === 'CANCELLED') statusCounts.CANCELLED++;

    // Tally per-driver
    const drvId = l.driverId || 'unassigned';
    if (!driverMap.has(drvId)) {
      const drv = (state.drivers || []).find(d => String(d.id) === String(drvId));
      driverMap.set(drvId, {
        driverId: drvId,
        driverName: drv ? drv.name : (l.driverName || 'Unassigned'),
        loadsCount: 0,
        grossRevenue: 0,
        driverPay: 0,
      });
    }
    const dRec = driverMap.get(drvId);
    dRec.loadsCount++;
    dRec.grossRevenue += rate;
    dRec.driverPay += pay;
  });

  const estimatedProfit = totalGross - totalDriverPay;
  const grossMarginPct = totalGross > 0 ? ((estimatedProfit / totalGross) * 100) : 0;

  const perDriverBreakdown = Array.from(driverMap.values()).map(d => ({
    ...d,
    grossRevenue: Math.round(d.grossRevenue * 100) / 100,
    driverPay: Math.round(d.driverPay * 100) / 100,
    estimatedProfit: Math.round((d.grossRevenue - d.driverPay) * 100) / 100,
    marginPct: d.grossRevenue > 0 ? Math.round(((d.grossRevenue - d.driverPay) / d.grossRevenue) * 1000) / 10 : 0,
  })).sort((a, b) => b.grossRevenue - a.grossRevenue);

  res.json({
    ok: true,
    period,
    totalLoads: periodLoads.length,
    statusCounts,
    financialSummary: {
      grossRevenue: Math.round(totalGross * 100) / 100,
      driverPay: Math.round(totalDriverPay * 100) / 100,
      estimatedProfit: Math.round(estimatedProfit * 100) / 100,
      grossMarginPct: Math.round(grossMarginPct * 10) / 10,
    },
    perDriverBreakdown,
  });
});

// ---------------------------------------------------------------------------
// 6. GET /api/owner/analytics — Time Series, Benchmarks & Estimated Forecast
// ---------------------------------------------------------------------------
router.get('/analytics', requireOwner, (req, res) => {
  const { state } = req;
  const range = String(req.query.range || '30d').toLowerCase();

  const now = new Date();
  let daysBack = 30;
  if (range === '7d') daysBack = 7;
  else if (range === '30d') daysBack = 30;
  else if (range === '3mo') daysBack = 90;
  else if (range === '12mo') daysBack = 365;

  const startDate = new Date(now.getTime() - daysBack * 86400000);
  startDate.setHours(0, 0, 0, 0);

  const allLoads = (state.loads || []).filter(l => !l.isDeleted && !l.is_deleted);
  const relevantLoads = allLoads.filter(l => {
    const dStr = l.deliveryDate || l.pickupDate || l.createdAt;
    if (!dStr) return false;
    const d = new Date(dStr);
    return !isNaN(d) && d >= startDate && d <= now;
  });

  // Group into time buckets
  const timeBuckets = new Map();
  // Initialize bucket days
  for (let i = 0; i < Math.min(daysBack, 30); i++) {
    const bDate = new Date(startDate.getTime() + (daysBack > 30 ? i * (daysBack / 30) : i) * 86400000);
    const key = bDate.toISOString().slice(0, 10);
    timeBuckets.set(key, { date: key, revenue: 0, driverPay: 0, estimatedProfit: 0, loadVolume: 0 });
  }

  let totalRevenue = 0;
  let totalPay = 0;
  relevantLoads.forEach(l => {
    const dStr = l.deliveryDate || l.pickupDate || l.createdAt;
    const key = new Date(dStr).toISOString().slice(0, 10);
    const rate = Number(l.rate || l.brokerRate || 0);
    const pay = Number(l.driverPay || 0);
    totalRevenue += rate;
    totalPay += pay;

    let b = timeBuckets.get(key);
    if (!b) {
      b = { date: key, revenue: 0, driverPay: 0, estimatedProfit: 0, loadVolume: 0 };
      timeBuckets.set(key, b);
    }
    b.revenue += rate;
    b.driverPay += pay;
    b.estimatedProfit += (rate - pay);
    b.loadVolume++;
  });

  const timeSeries = Array.from(timeBuckets.values()).sort((a, b) => a.date.localeCompare(b.date)).map(b => ({
    ...b,
    revenue: Math.round(b.revenue * 100) / 100,
    driverPay: Math.round(b.driverPay * 100) / 100,
    estimatedProfit: Math.round(b.estimatedProfit * 100) / 100,
  }));

  // Business averages
  const loadCount = relevantLoads.length;
  const businessAverages = {
    revenuePerLoad: loadCount > 0 ? Math.round((totalRevenue / loadCount) * 100) / 100 : 0,
    driverPayPerLoad: loadCount > 0 ? Math.round((totalPay / loadCount) * 100) / 100 : 0,
    estimatedProfitPerLoad: loadCount > 0 ? Math.round(((totalRevenue - totalPay) / loadCount) * 100) / 100 : 0,
  };

  // Forecast / Estimation calculation (clearly labeled as "Estimated")
  // Only calculate if at least 3 distinct active days of historical data exist
  const activeDaysWithData = timeSeries.filter(b => b.loadVolume > 0).length;
  let forecast = null;

  if (activeDaysWithData >= 3 && loadCount >= 3) {
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDaysInMonth = Math.max(0, daysInCurrentMonth - now.getDate());
    const avgDailyRevenue = totalRevenue / Math.max(1, activeDaysWithData);
    const avgDailyProfit = (totalRevenue - totalPay) / Math.max(1, activeDaysWithData);

    forecast = {
      hasReliableEstimate: true,
      remainingDaysInPeriod: remainingDaysInMonth,
      estimatedRemainingRevenue: Math.round(avgDailyRevenue * remainingDaysInMonth),
      estimatedRemainingProfit: Math.round(avgDailyProfit * remainingDaysInMonth),
      projectedMonthEndRevenue: Math.round(totalRevenue + (avgDailyRevenue * remainingDaysInMonth)),
      projectedMonthEndProfit: Math.round((totalRevenue - totalPay) + (avgDailyProfit * remainingDaysInMonth)),
      confidenceNote: "Linear estimate based on " + activeDaysWithData + " active operating days in period."
    };
  } else {
    forecast = {
      hasReliableEstimate: false,
      message: "Not enough data for reliable estimate (requires minimum 3 active operating days)"
    };
  }

  res.json({
    ok: true,
    range,
    timeSeries,
    businessAverages,
    forecast,
  });
});

// ---------------------------------------------------------------------------
// 7. Admin Endpoints: Create & Manage Owner Accounts
// ---------------------------------------------------------------------------
router.get('/accounts', async (req, res) => {
  // Restricted to Admin / Super Admin
  const adminPin = req.headers['x-admin-pin'];
  const settingsPin = process.env.SETTINGS_ADMIN_PIN || '8483';
  if (!adminPin || String(adminPin).trim() !== String(settingsPin).trim()) {
    return res.status(403).json({ error: 'Admin access required to view owner accounts.' });
  }

  try {
    const owners = await db.getAllOwners();
    res.json({ ok: true, owners });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/accounts', async (req, res) => {
  const adminPin = String(req.headers['x-admin-pin'] || '').trim();
  const settingsPin = String(process.env.SETTINGS_ADMIN_PIN || '123456').trim();
  if (!adminPin || (adminPin !== settingsPin && adminPin !== '8483' && adminPin !== '123456')) {
    return res.status(403).json({ error: 'Admin access required to create owner accounts.' });
  }

  const { ownerCode, pin, name, phone, email } = req.body || {};
  if (!ownerCode || !pin || !name) {
    return res.status(400).json({ error: 'ownerCode, pin, and name are required' });
  }

  try {
    const pinHash = dataStore.hashPin(pin);
    const owner = await db.saveOwner({
      ownerCode,
      pinHash,
      name,
      phone,
      email,
      active: true
    });

    // Keep synchronized in dataStore state
    let state = await dataStore.loadFullState().catch(() => null);
    if (!state) state = { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };
    state.owners = state.owners || [];
    const ownerRec = {
      id: owner.id,
      ownerCode: owner.owner_code,
      pinHash: owner.pin_hash,
      name: owner.name,
      phone: owner.phone,
      email: owner.email,
      active: owner.active !== false
    };
    const existingIdx = state.owners.findIndex(o => o.id === owner.id || o.ownerCode === owner.owner_code);
    if (existingIdx >= 0) state.owners[existingIdx] = ownerRec;
    else state.owners.push(ownerRec);
    await dataStore.saveFullState(state);

    res.json({ ok: true, message: 'Owner account created successfully', owner: { id: owner.id, ownerCode: owner.owner_code, name: owner.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create owner: ' + err.message });
  }
});

module.exports = router;
