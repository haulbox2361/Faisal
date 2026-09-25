const express = require('express');
const kv = require('../lib/kvstore');
const audit = require('../lib/auditStore');
const { requireAuth } = require('../lib/security');

const router = express.Router();
router.use(express.json({ limit: '25mb' })); // the whole app STATE blob round-trips through here

// GET /api/storage?prefix=... — list keys (Protected: requires active staff / admin session)
router.get('/api/storage', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const keys = await kv.list(req.query.prefix ? String(req.query.prefix) : undefined);
    res.json({ keys, prefix: req.query.prefix || undefined, shared: false });
  } catch (e) {
    console.error('storage list failed:', e);
    res.status(500).json({ error: e.message || 'Storage list failed' });
  }
});

// GET /api/storage/:key — reads app state / configuration
router.get('/api/storage/:key', async (req, res) => {
  try {
    let value = await kv.get(req.params.key);
    if (value === null) {
      if (req.params.key === 'haulline:state') {
        const defaultState = JSON.stringify({
          loads: [],
          drivers: [],
          brokers: [],
          dispatchers: [],
          settings: { companyName: 'HaulBoX' },
          chat: {},
          emailLogs: [],
          driveFiles: [],
          notifications: []
        });
        await kv.set('haulline:state', defaultState).catch(() => {});
        return res.json({ key: req.params.key, value: defaultState, shared: false });
      }
      return res.status(404).json({ error: 'Key not found: ' + req.params.key });
    }
    res.json({ key: req.params.key, value, shared: false });
  } catch (e) {
    console.error('storage get failed:', e);
    res.status(500).json({ error: e.message || 'Storage read failed' });
  }
});

// POST /api/storage  { key, value } (Protected: requires Admin role)
router.post('/api/storage', requireAuth(['ADMIN']), async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Missing key' });
  try {
    await kv.set(key, value);
    if (key === 'haulline:state') {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        const dataStore = require('../lib/dataStore');
        dataStore.saveFullState(parsed).catch(err => console.warn('[Storage] dataStore sync warn:', err.message));
      } catch (e) {}
    }

    // Audit Log sensitive storage writes
    await audit.record(
      { type: req.user?.type || 'admin', id: req.user?.id || 'admin', name: req.user?.name || req.user?.email || 'Admin' },
      'STORAGE_WRITE',
      { type: 'kv_key', id: key },
      { key, valueLength: typeof value === 'string' ? value.length : JSON.stringify(value || '').length, clientIp: req.ip }
    );

    res.json({ key, value, shared: false });
  } catch (e) {
    console.error('storage set failed:', e);
    res.status(500).json({ error: e.message || 'Storage write failed' });
  }
});

// DELETE /api/storage/:key (Protected: requires Admin role)
router.delete('/api/storage/:key', requireAuth(['ADMIN']), async (req, res) => {
  try {
    await kv.del(req.params.key);

    // Audit Log storage deletions
    await audit.record(
      { type: req.user?.type || 'admin', id: req.user?.id || 'admin', name: req.user?.name || req.user?.email || 'Admin' },
      'STORAGE_DELETE',
      { type: 'kv_key', id: req.params.key },
      { key: req.params.key, clientIp: req.ip }
    );

    res.json({ key: req.params.key, deleted: true, shared: false });
  } catch (e) {
    console.error('storage delete failed:', e);
    res.status(500).json({ error: e.message || 'Storage delete failed' });
  }
});

module.exports = router;

