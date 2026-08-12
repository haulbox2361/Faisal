// Append-only timeline per load — status changes, document uploads, driver
// checkpoints. Backs Load Details "Load History" in both the dispatch app
// and the driver app's GET /driver/loads/:id/history.

const { getPool, ensureSchema } = require('./db');

// actor: { type: 'admin'|'dispatcher'|'driver'|'system', id, name }
async function record(loadId, eventType, note, actor) {
  await ensureSchema();
  actor = actor || {};
  await getPool().query(
    `INSERT INTO load_history (load_id, event_type, note, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [loadId, eventType, note || null, actor.type || 'system', actor.id || null, actor.name || null]
  );
}

async function listForLoad(loadId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, event_type, note, actor_type, actor_id, actor_name, created_at
     FROM load_history WHERE load_id = $1 ORDER BY created_at ASC`,
    [loadId]
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    note: r.note,
    actorType: r.actor_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    createdAt: r.created_at,
  }));
}

module.exports = { record, listForLoad };
