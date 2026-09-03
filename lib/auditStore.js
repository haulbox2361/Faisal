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

module.exports = { record, log: record };
