require('dotenv').config();
const express = require('express');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const storageRoutes = require('./routes/storage');
const driverRoutes = require('./routes/driver');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const mistralRoutes = require('./routes/mistral');
const { ensureSchema } = require('./lib/db');

// The ONLY Google account allowed to sign in as Admin. Everyone else who
// signs in must match a registered dispatcher email (checked in the
// frontend) or gets Access Denied. Override via env if you ever need to
// change the admin account without editing code.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'haulbox2361@gmail.com').trim();
// 6-digit security PIN required to open the Settings page (Configured in Render / environment)
const SETTINGS_ADMIN_PIN = String(process.env.SETTINGS_ADMIN_PIN || '123456').trim();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(authRoutes);
app.use(apiRoutes);
app.use(storageRoutes);
app.use(driverRoutes);
app.use(chatRoutes);
app.use(notificationRoutes);
app.use(mistralRoutes);

// Frontend fetches this on load to know which Google account is allowed to
// become Admin — kept server-side so it can't be tampered with client-side.
app.get('/api/config', (req, res) => {
  res.json({ adminEmail: ADMIN_EMAIL });
});

// Verifies the 6-digit Admin Settings PIN server-side
app.post('/api/verify-settings-pin', (req, res) => {
  const { pin } = req.body || {};
  const cleanPin = String(pin || '').trim();
  if (cleanPin === SETTINGS_ADMIN_PIN) {
    return res.json({ ok: true, message: 'PIN verified' });
  }
  return res.status(403).json({ ok: false, error: 'Incorrect 6-digit PIN. Access denied.' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/driver', async (req, res) => {
  try {
    const kv = require('./lib/kvstore');
    const raw = await kv.get('haulline:state').catch(() => null);
    const state = raw ? JSON.parse(raw) : null;
    if (state && state.settings && state.settings.driver_portal_enabled === false) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Driver Portal Disabled — HaulBoX</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; background: #0B0D10; color: #F8FAFC; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
            .card { max-width: 440px; background: #0F172A; border: 1px solid #1E293B; border-radius: 16px; padding: 36px 28px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
            .icon { font-size: 44px; margin-bottom: 16px; }
            h1 { font-size: 22px; font-weight: 800; margin: 0 0 10px; color: #fff; }
            p { font-size: 14px; color: #94A3B8; line-height: 1.5; margin: 0 0 24px; }
            a { display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; }
            a:hover { background: #0369a1; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🚫</div>
            <h1>Driver Portal Inactive</h1>
            <p>The Driver Mobile Portal has been disabled by the system administrator. Please contact your dispatch team or management for assistance.</p>
            <a href="/">← Return to Staff Sign-In</a>
          </div>
        </body>
        </html>
      `);
    }
  } catch (err) {
    console.error('Error checking driver_portal_enabled on /driver:', err);
  }
  res.sendFile(path.join(__dirname, 'public', 'driver-portal.html'));
});

app.listen(PORT, () => {
  const missingEnv = !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET;
  console.log(`HaulBoX backend running at http://localhost:${PORT}`);
  console.log(`Admin account locked to: ${ADMIN_EMAIL}`);
  if (missingEnv) {
    console.log('⚠️  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — Google sign-in will fail until you fill in .env (see README.md).');
  }
  if (!process.env.DATABASE_URL) {
    console.log('⚠️  DATABASE_URL is not set — the app will fail to load/save data until your Supabase connection string is in .env (see README.md).');
  } else {
    ensureSchema()
      .then(() => console.log('Database schema ready.'))
      .catch((e) => console.error('⚠️  Failed to reach the database:', e.message));
  }
});
