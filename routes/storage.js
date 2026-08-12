const express = require('express');
const kv = require('../lib/kvstore');

const router = express.Router();
router.use(express.json({ limit: '25mb' })); // the whole app STATE blob round-trips through here

// GET /api/storage?prefix=... — list keys (must come before the /:key route)
router.get('/api/storage', async (req, res) => {
  try {
    const keys = await kv.list(req.query.prefix ? String(req.query.prefix) : undefined);
    res.json({ keys, prefix: req.query.prefix || undefined, shared: false });
  } catch (e) {
    console.error('storage list failed:', e);
    res.status(500).json({ error: e.message || 'Storage list failed' });
  }
});

// GET /api/storage/:key
router.get('/api/storage/:key', async (req, res) => {
  try {
    const value = await kv.get(req.params.key);
    if (value === null) return res.status(404).json({ error: 'Key not found: ' + req.params.key });
    res.json({ key: req.params.key, value, shared: false });
  } catch (e) {
    console.error('storage get failed:', e);
    res.status(500).json({ error: e.message || 'Storage read failed' });
  }
});

// POST /api/storage  { key, value }
router.post('/api/storage', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Missing key' });
  try {
    await kv.set(key, value);
    res.json({ key, value, shared: false });
  } catch (e) {
    console.error('storage set failed:', e);
    res.status(500).json({ error: e.message || 'Storage write failed' });
  }
});

// DELETE /api/storage/:key
router.delete('/api/storage/:key', async (req, res) => {
  try {
    await kv.del(req.params.key);
    res.json({ key: req.params.key, deleted: true, shared: false });
  } catch (e) {
    console.error('storage delete failed:', e);
    res.status(500).json({ error: e.message || 'Storage delete failed' });
  }
});

module.exports = router;
