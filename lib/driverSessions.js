// Bearer-token sessions for the driver mobile app. Issued once at login so
// the PIN never has to be stored on-device or resent on every call — the
// app stores just this opaque token (e.g. via flutter_secure_storage) and
// sends `Authorization: Bearer <token>` on subsequent requests.

const crypto = require('crypto');
const { getPool, ensureSchema } = require('./db');

const TTL_DAYS = 30;

async function issue(userId, role = 'DRIVER') {
  await ensureSchema();
  const token = crypto.randomBytes(32).toString('hex');
  await getPool().query(
    `INSERT INTO driver_sessions (token, driver_id, role, expires_at)
     VALUES ($1, $2, $3, now() + interval '${TTL_DAYS} days')`,
    [token, String(userId), String(role).toUpperCase()]
  );
  return token;
}

// Returns the driver_id as a primitive string for full backward compatibility
async function verify(token) {
  if (!token) return null;
  await ensureSchema();
  const { rows } = await getPool().query(
    `UPDATE driver_sessions SET last_seen_at = now()
     WHERE token = $1 AND expires_at > now()
     RETURNING driver_id, role`,
    [token]
  );
  return rows.length ? rows[0].driver_id : null;
}

async function verifySession(token) {
  if (!token) return null;
  await ensureSchema();
  const { rows } = await getPool().query(
    `UPDATE driver_sessions SET last_seen_at = now()
     WHERE token = $1 AND expires_at > now()
     RETURNING driver_id, role`,
    [token]
  );
  if (!rows.length) return null;
  return {
    userId: rows[0].driver_id,
    role: String(rows[0].role || 'DRIVER').toUpperCase(),
    token
  };
}

async function revoke(token) {
  await ensureSchema();
  await getPool().query('DELETE FROM driver_sessions WHERE token = $1', [token]);
}

// Used when Admin disables a driver's or owner's account — kills every device they're
// signed into immediately rather than waiting for tokens to expire.
async function revokeAllForDriver(userId) {
  await ensureSchema();
  await getPool().query('DELETE FROM driver_sessions WHERE driver_id = $1', [userId]);
}

module.exports = { issue, verify, verifySession, revoke, revokeAllForDriver };
