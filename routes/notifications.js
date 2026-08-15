// Notification endpoints for the Admin/Dispatcher (web) side. The driver
// app has its own read-only + mark-read routes in routes/driver.js; this
// file additionally lets Admin/Dispatcher push a notification to any
// recipient (e.g. "Admin announcement" broadcasts, or a dispatcher notifying
// a driver their ETA changed).

const express = require('express');
const notifications = require('../lib/notificationStore');
const fcm = require('../lib/fcmService');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

function requireParty(req, res) {
  const { accountId, role } = req.body || req.query || {};
  const type = role === 'dispatcher' ? 'dispatcher' : 'admin';
  const id = String(accountId || (type === 'admin' ? 'admin' : '')).trim();
  if (!id) {
    res.status(400).json({ error: 'Missing accountId' });
    return null;
  }
  return { type, id };
}

// GET /api/notifications?accountId=...&role=...&unread=1
router.get('/api/notifications', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  try {
    const list = await notifications.listFor(me.type, me.id, { unreadOnly: req.query.unread === '1' });
    res.json({ notifications: list });
  } catch (e) {
    console.error('notifications fetch failed:', e);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// POST /api/notifications/:id/read  { accountId, role }
router.post('/api/notifications/:id/read', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  try {
    const ok = await notifications.markRead(me.type, me.id, Number(req.params.id));
    res.json({ ok });
  } catch (e) {
    console.error('notification read failed:', e);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// POST /api/notifications  { accountId, role, toType, toId, type, title, body, data }
// Sends a notification to any recipient — a driver, another dispatcher, or
// admin. Used for things like "Admin announcement" or a dispatcher's ETA
// update reaching the assigned driver.
router.post('/api/notifications', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { toType, toId, type, title, body, data } = req.body || {};
  if (!toType || !toId) return res.status(400).json({ error: 'Missing toType/toId' });
  if (!title) return res.status(400).json({ error: 'Missing title' });
  try {
    const created = await notifications.create(toType, String(toId), {
      type: type || 'admin_announcement',
      title,
      body,
      data,
    });

    // Send native Android FCM Push Notification if recipient is a Driver
    if (toType === 'driver') {
      fcm.sendToDriver(String(toId), {
        title,
        body,
        type: type || 'announcement',
        data: data || {},
      }).catch(err => console.error('[FCM] Push send error:', err));
    }

    res.json({ ok: true, id: created.id, createdAt: created.createdAt });
  } catch (e) {
    console.error('notification send failed:', e);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

module.exports = router;
