const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const store = require('../lib/store');
const { SCOPES, newOAuthClient } = require('../lib/googleClient');

const router = express.Router();

// In-memory map of outstanding OAuth attempts: state -> accountId.
// Just CSRF/state protection for the popup round trip — nothing here is
// persisted, and entries are removed as soon as the callback runs.
const pendingStates = new Map();

function popupResponseHtml(payload) {
  // Posts the result back to the window that opened the popup, then closes
  // itself. `*` targetOrigin is fine here — the payload contains nothing
  // secret (an email address + accountId), and the opener only trusts
  // messages of type google-auth-success/google-auth-error anyway.
  return `<!DOCTYPE html><html><body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(payload)}, '*');
    }
  } catch (e) {}
  window.close();
</script>
<p>You can close this window.</p>
</body></html>`;
}

// In-memory web session store: sessionToken -> { email, accountId, createdAt, expiresAt }
const webSessions = new Map();

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifySessionToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const session = webSessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    webSessions.delete(token);
    return null;
  }
  return { token, ...session };
}

// GET /auth/google?accountId=<loginAttemptId | 'admin' | dispatcherId>
// Kicks off the real Google consent screen for that accountId.
router.get('/auth/google', (req, res) => {
  const accountId = String(req.query.accountId || '').trim();
  if (!accountId) return res.status(400).send('Missing accountId');

  let client;
  try {
    client = newOAuthClient();
  } catch (e) {
    return res.status(500).send(
      `<h2>Google OAuth is not configured</h2><p>${e.message}</p>`
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, accountId);
  // Clean the state up if nobody ever comes back (e.g. they closed the popup
  // at the Google screen itself, before we'd see it).
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  const url = client.generateAuthUrl({
    access_type: 'offline', // needed for a refresh_token so re-auth isn't required every hour
    prompt: 'consent',      // force a fresh refresh_token every time (simplest for a small team)
    scope: SCOPES,
    state,
  });
  res.redirect(url);
});

// GET /auth/google/callback — Google redirects here after consent.
router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(popupResponseHtml({ type: 'google-auth-error', error: String(error) }));
  }

  const accountId = pendingStates.get(state);
  pendingStates.delete(state);
  if (!accountId) {
    return res.send(popupResponseHtml({ type: 'google-auth-error', error: 'Sign-in session expired — please try again.' }));
  }

  try {
    const client = newOAuthClient();
    const { tokens } = await client.getToken(String(code));
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: client, version: 'v2' });
    const { data: profile } = await oauth2.userinfo.get();
    const email = profile.email;
    if (!email) throw new Error('Google did not return an email address for this account.');

    store.set(accountId, { email, tokens });

    // Issue cryptographic server-side session token (24h TTL)
    const sessionToken = generateSessionToken();
    webSessions.set(sessionToken, {
      email: email.toLowerCase().trim(),
      accountId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    return res.send(popupResponseHtml({ type: 'google-auth-success', accountId, email, sessionToken }));
  } catch (e) {
    console.error('OAuth callback failed:', e);
    return res.send(popupResponseHtml({ type: 'google-auth-error', error: e.message || 'Google sign-in failed.' }));
  }
});

// GET /auth/verify-session — Validates server-issued session token
router.get('/auth/verify-session', (req, res) => {
  const session = verifySessionToken(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session token' });
  }
  res.json({ ok: true, email: session.email, accountId: session.accountId });
});

// POST /auth/claim { fromAccountId, toAccountId }
// Re-keys tokens stored under a throwaway loginAttemptId to the real
// 'admin' or dispatcher id once the frontend has matched the signed-in email.
// STRICT: Requires valid sessionToken AND verifies session email matches target account.
router.post('/auth/claim', express.json(), async (req, res) => {
  const session = verifySessionToken(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized — valid session token required to claim account' });
  }

  const { fromAccountId, toAccountId } = req.body || {};
  if (!toAccountId) return res.status(400).json({ error: 'Missing toAccountId' });

  // STRICT DUAL ACCOUNT AUTHORIZATION CHECK:
  // Validate BOTH the source claim record (fromAccountId) AND the destination target account (toAccountId)
  const targetId = String(toAccountId).trim();
  const sessionEmail = session.email.toLowerCase().trim();

  // 1. Source check: Temporary login attempt record MUST exist AND match sessionEmail
  const tempRec = await store.get(fromAccountId);
  if (!tempRec || !tempRec.email || tempRec.email.toLowerCase().trim() !== sessionEmail) {
    console.warn(`[Security Alert] Session ${sessionEmail} attempted unauthorized claim from source ${fromAccountId}!`);
    return res.status(403).json({ error: 'Forbidden — verified session email does not match claim source or temporary session expired' });
  }

  // 2. Destination check: Target account MUST be authorized for sessionEmail
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'haulbox2361@gmail.com').toLowerCase().trim();
  const adminEmails = (process.env.ADMIN_EMAILS || superAdminEmail).split(',').map(e => e.trim().toLowerCase());

  if (targetId === 'admin') {
    if (!adminEmails.includes(sessionEmail)) {
      console.warn(`[Security Alert] Session ${sessionEmail} attempted unauthorized claim of admin account!`);
      return res.status(403).json({ error: 'Forbidden — verified session email is not an authorized Admin' });
    }
  } else {
    // FAIL-CLOSED AFFIRMATIVE RESOLUTION:
    // Destination account MUST be affirmatively resolved and confirmed to belong to sessionEmail.
    // Checks both primary fleet email (d.email) AND Google account email (d.googleAccountEmail).
    let candidateEmails = [];

    try {
      const dataStore = require('../lib/dataStore');
      const state = await dataStore.loadFullState();
      const targetDispatcher = (state.dispatchers || []).find(d => String(d.id) === targetId);
      if (targetDispatcher) {
        if (targetDispatcher.email) candidateEmails.push(targetDispatcher.email.toLowerCase().trim());
        if (targetDispatcher.googleAccountEmail) candidateEmails.push(targetDispatcher.googleAccountEmail.toLowerCase().trim());
      }
    } catch (e) {
      console.error('[Security Alert] Failed to load state during claim target validation:', e.message);
      return res.status(403).json({ error: 'Forbidden — system error resolving destination account' });
    }

    // Fall back to existing token store record if state did not yield dispatcher email candidates
    if (candidateEmails.length === 0) {
      const destRec = await store.get(targetId);
      if (destRec && destRec.email) {
        candidateEmails.push(destRec.email.toLowerCase().trim());
      }
    }

    // STRICT FAIL-CLOSED REJECTION:
    // If destination target cannot be resolved OR sessionEmail matches neither d.email nor d.googleAccountEmail -> REJECT WITH 403
    if (candidateEmails.length === 0 || !candidateEmails.includes(sessionEmail)) {
      console.warn(`[Security Alert] Session ${sessionEmail} attempted unauthorized claim of target ${targetId}!`);
      return res.status(403).json({ error: 'Forbidden — destination account cannot be verified for session owner' });
    }
  }

  try {
    const rec = await store.claim(fromAccountId, toAccountId);
    // Update session record with verified accountId
    session.accountId = toAccountId;
    webSessions.set(session.token, session);
    res.json({ ok: true, connected: !!rec, email: rec ? rec.email : null });
  } catch (e) {
    console.error('claim failed:', e);
    res.status(500).json({ error: e.message || 'Failed to claim account' });
  }
});

// POST /auth/logout — Revokes server session token
router.post('/auth/logout', express.json(), (req, res) => {
  const session = verifySessionToken(req);
  if (session) {
    webSessions.delete(session.token);
  }
  res.json({ ok: true });
});

// POST /auth/disconnect { accountId }
router.post('/auth/disconnect', express.json(), async (req, res) => {
  const session = verifySessionToken(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized — valid session token required' });
  }
  const { accountId } = req.body || {};
  if (!accountId) return res.status(400).json({ error: 'Missing accountId' });
  const rec = await store.get(accountId);
  if (rec && rec.tokens) {
    try {
      const client = newOAuthClient();
      client.setCredentials(rec.tokens);
      await client.revokeCredentials();
    } catch (e) {
      console.warn('Revoke failed (removing local record anyway):', e.message);
    }
  }
  store.remove(accountId);
  res.json({ ok: true });
});

// GET /auth/status?accountId=...
router.get('/auth/status', async (req, res) => {
  const accountId = String(req.query.accountId || '').trim();
  try {
    const rec = await store.get(accountId);
    res.json({ connected: !!rec, email: rec ? rec.email : null });
  } catch (e) {
    console.error('status check failed:', e);
    res.status(500).json({ error: e.message || 'Failed to check status' });
  }
});

router._webSessions = webSessions;
module.exports = router;
