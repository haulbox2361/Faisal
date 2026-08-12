const { google } = require('googleapis');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets', // live load sync to a shared Google Sheet
];

function newOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Copy .env.example to .env and fill them in — see README.md.'
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Builds an authenticated OAuth2 client for a stored account record,
// refreshing + persisting new tokens automatically when Google rotates them.
function clientForAccount(record, store, accountId) {
  const client = newOAuthClient();
  client.setCredentials(record.tokens);
  client.on('tokens', (tokens) => {
    const merged = { ...record.tokens, ...tokens };
    store.set(accountId, { ...record, tokens: merged });
  });
  return client;
}

module.exports = { SCOPES, newOAuthClient, clientForAccount };
