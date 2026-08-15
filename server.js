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

// Admin and Super Admin Google accounts allowed to sign in.
// Supports comma-separated emails or SUPER_ADMIN_EMAIL / ADMIN_EMAIL env vars.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_EMAILS_RAW = (process.env.ADMIN_EMAIL || process.env.ADMIN_EMAILS || 'haulbox2361@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

if (SUPER_ADMIN_EMAIL && !ADMIN_EMAILS_RAW.includes(SUPER_ADMIN_EMAIL)) {
  ADMIN_EMAILS_RAW.unshift(SUPER_ADMIN_EMAIL);
}

// 6-digit security PIN required to open the Settings page (Configured in Render / environment)
const SETTINGS_ADMIN_PIN = String(process.env.SETTINGS_ADMIN_PIN || '123456').trim();

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// High-performance gzip/deflate response compression (reduces payload by ~85%)
app.use(compression({
  threshold: 1024,
  level: 6,
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));
app.use(authRoutes);
app.use(apiRoutes);
app.use(storageRoutes);
app.use(driverRoutes);
app.use(chatRoutes);
app.use(notificationRoutes);
app.use(mistralRoutes);

// Health check & monitoring endpoint for load balancers and uptime monitors
app.get('/api/health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;
  let dbError = null;

  try {
    const { getPool, ensureSchema } = require('./lib/db');
    await ensureSchema();
    const dbStart = Date.now();
    await getPool().query('SELECT 1');
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = 'degraded';
    dbError = err.message;
  }

  const memory = process.memoryUsage();
  const isHealthy = dbStatus === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    server: {
      port: PORT,
      responseLatencyMs: Date.now() - startTime,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    },
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      error: dbError,
    },
  });
});

// Frontend fetches this on load to know which Google accounts are allowed as Admin / Super Admin
app.get('/api/config', (req, res) => {

  res.json({
    adminEmail: ADMIN_EMAILS_RAW[0] || 'haulbox2361@gmail.com',
    adminEmails: ADMIN_EMAILS_RAW,
    superAdminEmail: SUPER_ADMIN_EMAIL || ADMIN_EMAILS_RAW[0] || 'haulbox2361@gmail.com'
  });
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

// Drivers use the HaulBoX Native Android APK App
app.get('/driver', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  const missingEnv = !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET;
  console.log(`HaulBoX backend running at http://localhost:${PORT}`);
  console.log(`Admin accounts active: ${ADMIN_EMAILS_RAW.join(', ')}`);
  if (SUPER_ADMIN_EMAIL) console.log(`Super Admin locked to: ${SUPER_ADMIN_EMAIL}`);
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
