require('dotenv').config();
const express = require('express');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const storageRoutes = require('./routes/storage');
const driverRoutes = require('./routes/driver');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const { ensureSchema } = require('./lib/db');

// The ONLY Google account allowed to sign in as Admin. Everyone else who
// signs in must match a registered dispatcher email (checked in the
// frontend) or gets Access Denied. Override via env if you ever need to
// change the admin account without editing code.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'haulbox2361@gmail.com').trim();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(authRoutes);
app.use(apiRoutes);
app.use(storageRoutes);
app.use(driverRoutes);
app.use(chatRoutes);
app.use(notificationRoutes);

// Frontend fetches this on load to know which Google account is allowed to
// become Admin — kept server-side so it can't be tampered with client-side.
app.get('/api/config', (req, res) => {
  res.json({ adminEmail: ADMIN_EMAIL });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/driver', (req, res) => {
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
