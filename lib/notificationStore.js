// Notification center shared by the dispatch web app and the driver app.
// Recipients are addressed the same way accountId already works elsewhere
// in this backend: ('admin', 'admin'), ('dispatcher', dispatcherId), or
// ('driver', driver.id).

const { getPool, ensureSchema } = require('./db');

async function create(recipientType, recipientId, { type, title, body, data }) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [recipientType, recipientId, type, title, body || null, data ? JSON.stringify(data) : null]
  );
  return { id: rows[0].id, createdAt: rows[0].created_at };
}

function shape(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    data: r.data || null,
    read: !!r.read_at,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

async function listFor(recipientType, recipientId, { unreadOnly = false, limit = 50 } = {}) {
  await ensureSchema();
  const q = unreadOnly
    ? `SELECT * FROM notifications WHERE recipient_type=$1 AND recipient_id=$2 AND read_at IS NULL ORDER BY created_at DESC LIMIT $3`
    : `SELECT * FROM notifications WHERE recipient_type=$1 AND recipient_id=$2 ORDER BY created_at DESC LIMIT $3`;
  const { rows } = await getPool().query(q, [recipientType, recipientId, limit]);
  return rows.map(shape);
}

async function unreadCount(recipientType, recipientId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_type=$1 AND recipient_id=$2 AND read_at IS NULL`,
    [recipientType, recipientId]
  );
  return rows[0].n;
}

// Only marks a notification read if it actually belongs to this recipient —
// callers must always pass the authenticated recipient, never trust an id
// from the request body alone.
async function markRead(recipientType, recipientId, notificationId) {
  await ensureSchema();
  const { rowCount } = await getPool().query(
    `UPDATE notifications SET read_at = now()
     WHERE id=$1 AND recipient_type=$2 AND recipient_id=$3 AND read_at IS NULL`,
    [notificationId, recipientType, recipientId]
  );
  return rowCount > 0;
}

module.exports = { create, listFor, unreadCount, markRead };
