// lib/backupService.js
// Automated Backup, Export, and Disaster Recovery Service for HaulBoX

const { getPool, ensureSchema } = require('./db');
const kv = require('./kvstore');

async function exportFullSnapshot() {
  await ensureSchema();
  const pool = getPool();

  const stateRaw = await kv.get('haulline:state').catch(() => null);
  let state = {};
  try { if (stateRaw) state = JSON.parse(stateRaw); } catch (_) {}

  const [
    messagesRes,
    notificationsRes,
    conversationsRes,
    participantsRes,
    locationsRes,
    validationsRes,
    auditRes,
  ] = await Promise.all([
    pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 5000').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 1000').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM conversations').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM conversation_participants').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM driver_locations ORDER BY recorded_at DESC LIMIT 5000').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM document_validations ORDER BY created_at DESC LIMIT 1000').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 2000').catch(() => ({ rows: [] })),
  ]);

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    stateBlob: state,
    tables: {
      conversations: conversationsRes.rows,
      conversation_participants: participantsRes.rows,
      messages: messagesRes.rows,
      notifications: notificationsRes.rows,
      driver_locations: locationsRes.rows,
      document_validations: validationsRes.rows,
      audit_logs: auditRes.rows,
    },
    meta: {
      totalLoads: (state.loads || []).length,
      totalDrivers: (state.drivers || []).length,
      totalMessages: messagesRes.rows.length,
      totalValidations: validationsRes.rows.length,
    },
  };
}

async function restoreStateBlob(stateObject) {
  if (!stateObject || typeof stateObject !== 'object') {
    throw new Error('Invalid state object provided for restoration.');
  }
  await kv.set('haulline:state', JSON.stringify(stateObject));
  return { ok: true, restoredAt: new Date().toISOString() };
}

module.exports = {
  exportFullSnapshot,
  restoreStateBlob,
};
