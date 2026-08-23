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
const { consistencyWorker } = require('./lib/consistencyWorker');

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

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.set('io', io); // Make it accessible in routes

const chatStore = require('./lib/chatStore');

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // 1. Client Authentication & Personal Room Registration
  socket.on('authenticate', (data) => {
    const { accountId, role, name, type } = data || {};
    const partyType = type || (role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'));
    const partyId = String(accountId || (partyType === 'admin' ? 'admin' : '')).trim();

    if (partyId) {
      socket.user = { type: partyType, id: partyId, name: name || partyType };
      const userRoom = `user_${partyType}_${partyId}`;
      socket.join(userRoom);
      chatStore.setUserPresence(socket.user, true);
      io.emit('presence_change', { user: socket.user, isOnline: true, lastSeen: new Date().toISOString() });
      socket.emit('authenticated', { ok: true, user: socket.user, room: userRoom });
      console.log(`[Socket.IO] Authenticated socket ${socket.id} as ${partyType}:${partyId}`);
    }
  });

  // 2. Join Conversation Room
  socket.on('join_conversation', async (data, ack) => {
    const { conversationId, accountId, role, name } = data || {};
    const convId = Number(conversationId);
    if (!convId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid conversationId' });
      return;
    }

    if (!socket.user && accountId) {
      const partyType = role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin');
      socket.user = { type: partyType, id: String(accountId).trim(), name: name || partyType };
    }

    const roomName = `conv_${convId}`;
    socket.join(roomName);
    console.log(`[Socket.IO] Socket ${socket.id} joined room: ${roomName}`);
    if (typeof ack === 'function') ack({ ok: true, room: roomName, conversationId: convId });
  });

  // 3. Leave Conversation Room
  socket.on('leave_conversation', (data) => {
    const { conversationId } = data || {};
    const convId = Number(conversationId);
    if (convId) {
      const roomName = `conv_${convId}`;
      socket.leave(roomName);
      console.log(`[Socket.IO] Socket ${socket.id} left room: ${roomName}`);
    }
  });

  // 4. Send Message via Socket
  socket.on('send_message', async (data, ack) => {
    const { conversationId, body, loadId, loadNumber, attachment, tempId, accountId, role, name } = data || {};
    const convId = Number(conversationId);
    const user = socket.user || (accountId ? {
      type: role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'),
      id: String(accountId).trim(),
      name: name || 'User'
    } : null);

    if (!convId || !user) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Missing conversationId or auth' });
      return;
    }

    const text = String(body || '').trim();
    if (!text && !attachment) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Message cannot be empty' });
      return;
    }

    try {
      if (!(await chatStore.isParticipant(convId, user))) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized for this chat' });
        return;
      }

      const effectiveText = text || (attachment ? `[File: ${attachment.name || 'attachment'}]` : '');
      const sent = await chatStore.sendMessage(convId, user, effectiveText, loadId, loadNumber, attachment);

      const msgPayload = {
        id: sent.id,
        conversationId: convId,
        senderType: user.type,
        senderId: user.id,
        senderName: user.name,
        body: text,
        attachment: attachment || null,
        loadId: loadId || null,
        loadNumber: loadNumber || null,
        read: false,
        createdAt: sent.createdAt || new Date().toISOString(),
        tempId: tempId || null,
      };

      // Broadcast to all clients in this conversation room
      io.to(`conv_${convId}`).emit('new_message', msgPayload);

      if (typeof ack === 'function') {
        ack({ ok: true, message: msgPayload });
      }
    } catch (err) {
      console.error('[Socket.IO] send_message error:', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 5. Typing Indicator
  socket.on('typing', (data) => {
    const { conversationId, isTyping, accountId, role, name } = data || {};
    const convId = Number(conversationId);
    const user = socket.user || (accountId ? {
      type: role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'),
      id: String(accountId).trim(),
      name: name || 'User'
    } : null);

    if (convId && user) {
      chatStore.setTypingStatus(convId, user, !!isTyping);
      socket.to(`conv_${convId}`).emit('user_typing', {
        conversationId: convId,
        user,
        isTyping: !!isTyping,
      });
    }
  });

  // 6. Mark Read
  socket.on('mark_read', async (data, ack) => {
    const { conversationId, accountId, role } = data || {};
    const convId = Number(conversationId);
    const user = socket.user || (accountId ? {
      type: role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'),
      id: String(accountId).trim()
    } : null);

    if (convId && user) {
      try {
        if (await chatStore.isParticipant(convId, user)) {
          await chatStore.markConversationRead(convId, user);
          io.to(`conv_${convId}`).emit('messages_read', {
            conversationId: convId,
            reader: user,
            readAt: new Date().toISOString(),
          });
        }
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false });
      }
    }
  });

  // 7. Disconnect
  socket.on('disconnect', () => {
    if (socket.user) {
      chatStore.setUserPresence(socket.user, false);
      io.emit('presence_change', { user: socket.user, isOnline: false, lastSeen: new Date().toISOString() });
    }
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Broadcast wrapper for easy state updates
global.broadcastState = async (state) => {
  io.emit('state_update', state);
};

server.listen(PORT, () => {
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
      .then(() => {
        console.log('Database schema ready.');
        consistencyWorker.start();
      })
      .catch((e) => console.error('⚠️  Failed to reach the database:', e.message));
  }
});
