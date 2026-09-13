// Insert-only audit trail for permission-sensitive actions (logins, status
// changes, document uploads, permission edits). Never exposed to drivers;
// intended for Admin-only review later.

const { getPool, ensureSchema } = require('./db');

// actor: { type, id, name }
async function record(actor, action, target, details) {
  await ensureSchema();
  actor = actor || {};
  target = target || {};
  try {
    await getPool().query(
      `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actor.type || 'system',
        actor.id || null,
        actor.name || null,
        action,
        target.type || null,
        target.id || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (e) {
    // Audit logging must never break the request it's logging.
    console.warn('audit log write failed:', e.message);
  }
}

async function list(filter = {}) {
  await ensureSchema();
  const pool = getPool();
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (filter.loadId) {
    params.push(String(filter.loadId));
    sql += ` AND (target_id = $${params.length} OR details->>'loadId' = $${params.length} OR details->>'loadNumber' = $${params.length})`;
  }
  if (filter.action) {
    params.push(filter.action);
    sql += ` AND action = $${params.length}`;
  }
  if (filter.actorId) {
    params.push(String(filter.actorId));
    sql += ` AND actor_id = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC LIMIT ' + (Number(filter.limit) || 100);
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    return [];
  }
}

module.exports = { record, log: record, list };

