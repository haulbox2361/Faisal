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

    return res.send(popupResponseHtml({ type: 'google-auth-success', accountId, email }));
  } catch (e) {
    console.error('OAuth callback failed:', e);
    return res.send(popupResponseHtml({ type: 'google-auth-error', error: e.message || 'Google sign-in failed.' }));
  }
});

// POST /auth/claim  { fromAccountId, toAccountId }
// Re-keys tokens stored under a throwaway loginAttemptId to the real
// 'admin' or dispatcher id once the frontend has matched the signed-in email.
router.post('/auth/claim', express.json(), async (req, res) => {
  const { fromAccountId, toAccountId } = req.body || {};
  if (!toAccountId) return res.status(400).json({ error: 'Missing toAccountId' });
  try {
    const rec = await store.claim(fromAccountId, toAccountId);
    res.json({ ok: true, connected: !!rec, email: rec ? rec.email : null });
  } catch (e) {
    console.error('claim failed:', e);
    res.status(500).json({ error: e.message || 'Failed to claim account' });
  }
});

// POST /auth/disconnect  { accountId }
router.post('/auth/disconnect', express.json(), async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) return res.status(400).json({ error: 'Missing accountId' });
  const rec = await store.get(accountId);
  if (rec && rec.tokens) {
    try {
      const client = newOAuthClient();
      client.setCredentials(rec.tokens);
      await client.revokeCredentials();
    } catch (e) {
      // Best-effort — token may already be invalid/expired. Still remove locally.
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

module.exports = router;
