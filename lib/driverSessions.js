// Bearer-token sessions for the driver mobile app. Issued once at login so
// the PIN never has to be stored on-device or resent on every call — the
// app stores just this opaque token (e.g. via flutter_secure_storage) and
// sends `Authorization: Bearer <token>` on subsequent requests.

const crypto = require('crypto');
const { getPool, ensureSchema } = require('./db');

const TTL_DAYS = 30;

async function issue(driverId) {
  await ensureSchema();
  const token = crypto.randomBytes(32).toString('hex');
  await getPool().query(
    `INSERT INTO driver_sessions (token, driver_id, expires_at)
     VALUES ($1, $2, now() + interval '${TTL_DAYS} days')`,
    [token, driverId]
  );
  return token;
}

// Returns the driverId for a valid, unexpired token, refreshing its
// last-seen timestamp — or null if the token is missing/expired/unknown.
async function verify(token) {
  if (!token) return null;
  await ensureSchema();
  const { rows } = await getPool().query(
    `UPDATE driver_sessions SET last_seen_at = now()
     WHERE token = $1 AND expires_at > now()
     RETURNING driver_id`,
    [token]
  );
  return rows.length ? rows[0].driver_id : null;
}

async function revoke(token) {
  await ensureSchema();
  await getPool().query('DELETE FROM driver_sessions WHERE token = $1', [token]);
}

// Used when Admin disables a driver's account — kills every device they're
// signed into immediately rather than waiting for tokens to expire.
async function revokeAllForDriver(driverId) {
  await ensureSchema();
  await getPool().query('DELETE FROM driver_sessions WHERE driver_id = $1', [driverId]);
}

module.exports = { issue, verify, revoke, revokeAllForDriver };
