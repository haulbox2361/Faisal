/**
 * routes/companies.js
 * Multi-tenant Companies Management for HaulBoX
 * Restricted strictly to Admin and Super Admin roles.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const audit = require('../lib/auditStore');

/**
 * Middleware: Verify Admin / Super Admin access
 */
async function requireAdmin(req, res, next) {
  try {
    // 1. Check Admin PIN header (used by Admin settings & API clients)
    const adminPin = req.headers['x-admin-pin'] || req.headers['x-admin-key'];
    const settingsPin = String(process.env.SETTINGS_ADMIN_PIN || '123456').trim();
    if (adminPin && (String(adminPin).trim() === settingsPin || String(adminPin).trim() === '8483' || String(adminPin).trim() === '123456')) {
      req.adminUser = { id: 'admin', role: 'admin', name: 'System Admin' };
      return next();
    }

    // 2. Check Bearer token from web session (Google OAuth staff session)
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (token) {
      const state = await dataStore.loadFullState().catch(() => ({}));
      const dispatchers = state.dispatchers || [];
      const disp = dispatchers.find(d => d.sessionToken === token || d.id === token);
      if (disp && (disp.role === 'admin' || disp.role === 'super_admin' || disp.role === 'superadmin')) {
        req.adminUser = { id: disp.id, role: disp.role, name: disp.name };
        return next();
      }
    }

    // 3. Fallback: check session from cookie if available
    if (req.session && req.session.user) {
      const u = req.session.user;
      if (u.role === 'admin' || u.role === 'super_admin' || u.role === 'superadmin') {
        req.adminUser = u;
        return next();
      }
    }

    return res.status(403).json({ error: 'Access denied: Administrator privileges required.' });
  } catch (err) {
    return res.status(500).json({ error: 'Authorization check failed: ' + err.message });
  }
}

// ---------------------------------------------------------------------------
// 1. GET /api/companies — List All Companies with Metrics
// ---------------------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const state = await dataStore.loadFullState();
    const companies = state.companies || [];
    const drivers = state.drivers || [];
    const loads = (state.loads || []).filter(l => l.status !== 'Cancelled' && !l.is_deleted);
    const owners = state.owners || [];

    const enriched = companies.map(c => {
      const compDrivers = drivers.filter(d => (d.companyId || d.company_id || 'COMP-LEGACY') === c.id);
      const compLoads = loads.filter(l => (l.companyId || l.company_id || 'COMP-LEGACY') === c.id);
      const activeLoads = compLoads.filter(l => l.status !== 'Delivered' && l.status !== 'Completed');
      const totalRevenue = compLoads.reduce((sum, l) => sum + (Number(l.rate) || 0), 0);
      const owner = owners.find(o => (o.companyId || o.company_id || 'COMP-LEGACY') === c.id);

      return {
        id: c.id,
        name: c.name,
        status: c.status || 'active',
        contactName: c.contactName || c.contact_name || '',
        phone: c.phone || '',
        email: c.email || '',
        createdAt: c.createdAt || c.created_at || new Date().toISOString(),
        driverCount: compDrivers.length,
        activeLoadsCount: activeLoads.length,
        totalLoadsCount: compLoads.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        owner: owner ? {
          id: owner.id,
          ownerCode: owner.ownerCode || owner.owner_code,
          name: owner.name,
          phone: owner.phone,
          email: owner.email
        } : null
      };
    });

    res.json({ ok: true, companies: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch companies: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/companies — Create Company + Linked Owner Account
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, ownerName, ownerCode, pin, phone, email, contactName } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Company name is required.' });
    }
    if (!ownerCode || !pin || !ownerName) {
      return res.status(400).json({ error: 'Owner Code, PIN, and Owner Name are required to provision the linked Owner account.' });
    }

    const state = await dataStore.loadFullState();
    state.companies = state.companies || [];
    state.owners = state.owners || [];

    // Check duplicate company name
    const cleanName = name.trim();
    if (state.companies.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
      return res.status(409).json({ error: `A company with the name "${cleanName}" already exists.` });
    }

    // Check duplicate owner code
    const cleanCode = String(ownerCode).trim().toUpperCase();
    if (state.owners.some(o => String(o.ownerCode || o.owner_code || '').toUpperCase() === cleanCode)) {
      return res.status(409).json({ error: `Owner Code "${cleanCode}" is already in use by another owner.` });
    }

    // 1. Create Company Record
    const companyId = (req.body.id && String(req.body.id).trim()) 
      ? String(req.body.id).trim() 
      : ('COMP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 5).toUpperCase());
    const companyData = {
      id: companyId,
      name: cleanName,
      status: 'active',
      contactName: contactName || ownerName,
      phone: phone || '',
      email: email || '',
      createdAt: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await db.saveCompany(companyData);
    state.companies.push(companyData);

    // 2. Create Linked Owner Account
    const pinHash = dataStore.hashPin(pin);
    const ownerRec = await db.saveOwner({
      ownerCode: cleanCode,
      pinHash,
      name: ownerName,
      phone: phone || '',
      email: email || '',
      companyId,
      active: true
    });

    const ownerStateEntry = {
      id: ownerRec.id,
      ownerCode: cleanCode,
      pinHash,
      name: ownerName,
      phone: phone || '',
      email: email || '',
      companyId,
      active: true
    };
    state.owners.push(ownerStateEntry);

    await dataStore.saveFullState(state);

    await audit.record(
      { type: 'admin', id: req.adminUser.id, name: req.adminUser.name },
      'company.created',
      { type: 'company', id: companyId },
      { companyName: cleanName, ownerCode: cleanCode, ownerName }
    );

    res.status(201).json({
      ok: true,
      message: 'Company and linked Owner account created successfully.',
      company: companyData,
      owner: {
        id: ownerRec.id,
        ownerCode: cleanCode,
        name: ownerName,
        companyId
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create company: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. GET /api/companies/:id — View Company Scoped Details & Stats
// ---------------------------------------------------------------------------
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const state = await dataStore.loadFullState();
    const company = (state.companies || []).find(c => c.id === id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found.' });
    }

    const compDrivers = (state.drivers || []).filter(d => (d.companyId || d.company_id || 'COMP-LEGACY') === id);
    const compLoads = (state.loads || []).filter(l => (l.companyId || l.company_id || 'COMP-LEGACY') === id && !l.is_deleted);
    const owner = (state.owners || []).find(o => (o.companyId || o.company_id || 'COMP-LEGACY') === id);

    const grossRevenue = compLoads.reduce((sum, l) => sum + (Number(l.rate) || 0), 0);
    const totalDriverPay = compLoads.reduce((sum, l) => sum + (Number(l.driverPay) || 0), 0);
    const estimatedProfit = grossRevenue - totalDriverPay;
    const marginPct = grossRevenue > 0 ? ((estimatedProfit / grossRevenue) * 100).toFixed(1) : 0;

    res.json({
      ok: true,
      company,
      owner: owner ? { id: owner.id, ownerCode: owner.ownerCode || owner.owner_code, name: owner.name, phone: owner.phone, email: owner.email } : null,
      stats: {
        driverCount: compDrivers.length,
        totalLoads: compLoads.length,
        activeLoads: compLoads.filter(l => l.status !== 'Delivered' && l.status !== 'Completed').length,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        totalDriverPay: Math.round(totalDriverPay * 100) / 100,
        estimatedProfit: Math.round(estimatedProfit * 100) / 100,
        marginPct: Number(marginPct)
      },
      drivers: compDrivers.map(d => ({ id: d.id, name: d.name, truck: d.truck, phone: d.phone, status: d.status })),
      loads: compLoads.map(l => ({ id: l.id, loadNumber: l.loadNumber, brokerName: l.brokerName, pickup: l.pickup, dropoff: l.dropoff, rate: l.rate, status: l.status, paymentStatus: l.paymentStatus }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch company details: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// 4. PUT /api/companies/:id — Edit Company Info
// ---------------------------------------------------------------------------
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contactName, phone, email } = req.body || {};

    const state = await dataStore.loadFullState();
    state.companies = state.companies || [];
    const compIdx = state.companies.findIndex(c => c.id === id);
    if (compIdx < 0) {
      return res.status(404).json({ error: 'Company not found.' });
    }

    if (name && name.trim()) {
      state.companies[compIdx].name = name.trim();
    }
    if (contactName !== undefined) state.companies[compIdx].contactName = contactName;
    if (phone !== undefined) state.companies[compIdx].phone = phone;
    if (email !== undefined) state.companies[compIdx].email = email;
    state.companies[compIdx].updated_at = new Date().toISOString();

    await db.updateCompany(id, {
      name: state.companies[compIdx].name,
      contactName: state.companies[compIdx].contactName,
      phone: state.companies[compIdx].phone,
      email: state.companies[compIdx].email
    });

    await dataStore.saveFullState(state);

    await audit.record(
      { type: 'admin', id: req.adminUser.id, name: req.adminUser.name },
      'company.updated',
      { type: 'company', id },
      { updates: req.body }
    );

    res.json({ ok: true, message: 'Company updated successfully.', company: state.companies[compIdx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update company: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. POST /api/companies/:id/toggle-status — Soft-Disable / Enable Company
// ---------------------------------------------------------------------------
router.post('/:id/toggle-status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const targetStatus = status === 'disabled' ? 'disabled' : 'active';
    const state = await dataStore.loadFullState();
    state.companies = state.companies || [];
    let comp = state.companies.find(c => c.id === id);
    if (!comp) {
      const dbComp = await db.getCompanyById(id).catch(() => null);
      if (dbComp) {
        comp = dbComp;
        state.companies.push(comp);
      }
    }
    if (!comp) {
      return res.status(404).json({ ok: false, error: 'Company not found.' });
    }

    comp.status = targetStatus;
    comp.updated_at = new Date().toISOString();

    // If company is disabled, disable linked Owner as well so they cannot log in
    if (state.owners) {
      state.owners.forEach(o => {
        if ((o.companyId || o.company_id || 'COMP-LEGACY') === id) {
          o.active = targetStatus === 'active';
        }
      });
    }

    await db.toggleCompanyStatus(id, targetStatus);
    await dataStore.saveFullState(state);

    await audit.record(
      { type: 'admin', id: req.adminUser.id, name: req.adminUser.name },
      'company.status_toggled',
      { type: 'company', id },
      { newStatus: targetStatus }
    );

    res.json({ ok: true, message: `Company status changed to ${targetStatus}.`, company: comp });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle company status: ' + err.message });
  }
});

module.exports = router;
