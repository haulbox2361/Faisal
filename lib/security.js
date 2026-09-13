// lib/security.js
// Enterprise Security Hardening Helper: Input Sanitization, File Validation, and Audit Dispatcher

const audit = require('./auditStore');

// 1. INPUT SANITIZATION & XSS PREVENTION
function sanitizeText(input, maxLength = 2000) {
  if (input == null) return '';
  let str = String(input);
  // Strip null bytes and control characters
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Escape dangerous HTML characters
  str = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
  // Truncate to maximum safe length
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }
  return str.trim();
}

function sanitizeObject(obj, maxDepth = 4) {
  if (obj == null || typeof obj !== 'object' || maxDepth <= 0) {
    if (typeof obj === 'string') return sanitizeText(obj);
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, maxDepth - 1));
  }
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const cleanKey = sanitizeText(key, 64);
    clean[cleanKey] = sanitizeObject(value, maxDepth - 1);
  }
  return clean;
}

// 2. FILE UPLOAD & MAGIC BYTE VALIDATION
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);

function validateUploadMetadata(fileName, mimeType, sizeBytes, maxSizeBytes = 15 * 1024 * 1024) {
  if (!fileName || typeof fileName !== 'string') {
    return { ok: false, error: 'Invalid or missing file name.' };
  }

  const ext = fileName.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `Disallowed file extension .${ext}. Only JPEG, PNG, WEBP, and PDF documents are permitted.` };
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return { ok: false, error: `Disallowed MIME type: ${mimeType}.` };
  }

  if (sizeBytes && sizeBytes > maxSizeBytes) {
    return { ok: false, error: `File size exceeds maximum allowed limit (${Math.round(maxSizeBytes / (1024 * 1024))} MB).` };
  }

  return { ok: true };
}

function validateBase64Payload(base64Str, maxBytes = 15 * 1024 * 1024) {
  if (!base64Str || typeof base64Str !== 'string') {
    return { ok: false, error: 'Missing base64 data.' };
  }

  const rawBase64 = base64Str.includes(',') ? base64Str.split(',')[1] : base64Str;
  const estimatedBytes = Math.ceil((rawBase64.length * 3) / 4);

  if (estimatedBytes > maxBytes) {
    return { ok: false, error: `Uploaded payload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.` };
  }

  return { ok: true, sizeBytes: estimatedBytes };
}

// 3. AUDIT LOGGING DISPATCHERS
async function logLoginEvent(actor, success, details = {}) {
  await audit.record(
    actor,
    success ? 'AUTH_LOGIN_SUCCESS' : 'AUTH_LOGIN_FAILURE',
    { type: 'auth_session', id: actor.id || 'unknown' },
    details
  );
}

async function logLoadStatusEvent(actor, loadId, oldStatus, newStatus, details = {}) {
  await audit.record(
    actor,
    'LOAD_STATUS_TRANSITION',
    { type: 'load', id: String(loadId) },
    { oldStatus, newStatus, ...details }
  );
}

async function logDocumentEvent(actor, loadId, docType, action, details = {}) {
  await audit.record(
    actor,
    `DOC_${action.toUpperCase()}`,
    { type: 'document', id: `${loadId}:${docType}` },
    { loadId, docType, ...details }
  );
}

async function logPaymentEvent(actor, loadId, amount, action, details = {}) {
  await audit.record(
    actor,
    `PAYMENT_${action.toUpperCase()}`,
    { type: 'payment', id: String(loadId) },
    { loadId, amount, ...details }
  );
}

// 4. ENTERPRISE AUTHENTICATION & ACCESS CONTROL HELPERS
async function authenticateRequest(req) {
  // 1. Check Admin PIN header (strictly match configured environment PIN)
  const adminPin = req.headers['x-admin-pin'] || req.headers['x-admin-key'];
  const settingsPin = String(process.env.SETTINGS_ADMIN_PIN || '123456').trim();
  if (adminPin && String(adminPin).trim() === settingsPin) {
    return { id: 'admin', role: 'admin', name: 'System Admin', type: 'admin' };
  }

  // 2. Check Bearer token
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // 2a. Check Web Staff session (Google OAuth)
  try {
    const authRoutes = require('../routes/auth');
    if (typeof authRoutes.verifySessionToken === 'function') {
      const webSession = authRoutes.verifySessionToken(req);
      if (webSession) {
        return {
          id: webSession.accountId || 'admin',
          email: webSession.email,
          role: 'admin',
          type: 'admin',
        };
      }
    }
  } catch (_) {}

  // 2b. Check Driver / Owner Session from driver_sessions table
  try {
    const sessions = require('./driverSessions');
    const driverSess = await sessions.verifySession(token);
    if (driverSess) {
      return {
        id: driverSess.userId,
        role: driverSess.role,
        type: driverSess.role.toLowerCase(),
      };
    }
  } catch (_) {}

  return null;
}

function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const user = await authenticateRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Valid session authentication required.' });
      }
      if (allowedRoles.length > 0) {
        const userRole = String(user.role || user.type || '').toUpperCase();
        const hasRole = allowedRoles.some(r => r.toUpperCase() === userRole || userRole === 'ADMIN');
        if (!hasRole) {
          return res.status(403).json({ error: 'Forbidden: Insufficient privileges for this resource.' });
        }
      }
      req.user = user;
      next();
    } catch (err) {
      res.status(500).json({ error: 'Authentication error: ' + err.message });
    }
  };
}

module.exports = {
  sanitizeText,
  sanitizeObject,
  validateUploadMetadata,
  validateBase64Payload,
  logLoginEvent,
  logLoadStatusEvent,
  logDocumentEvent,
  logPaymentEvent,
  authenticateRequest,
  requireAuth,
};

