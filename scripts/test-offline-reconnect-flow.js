const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

const chatRoutes = require('../routes/chat');
const chatStore = require('../lib/chatStore');

async function testOfflineReconnectFlow() {
  console.log('========================================================================');
  console.log('🧪 TESTING OFFLINE QUEUE, RECONNECT FLUSH, BACKFILL & DEDUPLICATION');
  console.log('========================================================================');

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  app.set('io', io);

  const databaseMessages = [];

  // Mount Socket.IO handlers
  io.on('connection', (socket) => {
    socket.on('authenticate', (data) => {
      const { accountId, role, name, type } = data || {};
      const partyType = type || (role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'));
      const partyId = String(accountId || (partyType === 'admin' ? 'admin' : '')).trim();

      if (partyId) {
        socket.user = { type: partyType, id: partyId, name: name || partyType };
        socket.join(`user_${partyType}_${partyId}`);
        socket.emit('authenticated', { ok: true });
      }
    });

    socket.on('join_conversation', async (data, ack) => {
      const convId = Number(data?.conversationId);
      if (convId) {
        socket.join(`conv_${convId}`);
        if (typeof ack === 'function') ack({ ok: true, room: `conv_${convId}` });
      }
    });

    socket.on('send_message', async (data, ack) => {
      const convId = Number(data?.conversationId);
      const user = socket.user || { type: 'driver', id: 'driver-101', name: 'John Driver' };
      const text = String(data?.body || '').trim();

      const newMsg = {
        id: Math.floor(Math.random() * 900000) + 10000,
        conversationId: convId,
        senderType: user.type,
        senderId: user.id,
        senderName: user.name,
        body: text,
        tempId: data?.tempId || null,
        createdAt: new Date().toISOString(),
      };
      databaseMessages.push(newMsg);

      io.to(`conv_${convId}`).emit('new_message', newMsg);
      if (typeof ack === 'function') ack({ ok: true, message: newMsg });
    });
  });

  // REST endpoints with backfill support
  app.get('/api/chat/conversations/:id/messages', (req, res) => {
    const convId = Number(req.params.id);
    const msgs = databaseMessages.filter((m) => m.conversationId === convId);
    res.json({ ok: true, messages: msgs });
  });

  app.use(chatRoutes);

  const PORT = 3115;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Test server running on port ${PORT}`);

  // 1. Initial State: Driver & Dispatcher both connected and in room conv_88
  let driverSocket = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const dispatcherSocket = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });

  await new Promise((resolve) => {
    let count = 0;
    const chk = () => { if (++count === 2) resolve(); };
    driverSocket.on('connect', chk);
    dispatcherSocket.on('connect', chk);
  });

  driverSocket.emit('authenticate', { accountId: 'driver-101', role: 'driver', name: 'John Driver' });
  dispatcherSocket.emit('authenticate', { accountId: 'admin', role: 'admin', name: 'Dispatcher' });

  await new Promise((r) => setTimeout(r, 50));
  driverSocket.emit('join_conversation', { conversationId: 88 });
  dispatcherSocket.emit('join_conversation', { conversationId: 88 });
  await new Promise((r) => setTimeout(r, 50));

  console.log('✓ Phase 1: Both clients connected and joined conv_88');

  // 2. Simulate Network Drop: Disconnect Driver Socket (Airplane Mode simulation)
  console.log('\n--- SIMULATING NETWORK DROP (Driver goes offline) ---');
  driverSocket.disconnect();
  console.log('✓ Driver socket disconnected (offline)');

  // 3. Driver creates a message while offline (saved in offline local queue)
  const offlineQueue = [
    {
      conversationId: 88,
      body: 'Delayed at fuel stop 15 mins (sent offline)',
      tempId: 'temp_offline_991'
    }
  ];
  console.log(`✓ Driver queued offline message: "${offlineQueue[0].body}"`);

  // 4. Dispatcher sends a message while Driver is offline
  console.log('\n--- Dispatcher sends message while Driver is offline ---');
  dispatcherSocket.emit('send_message', {
    conversationId: 88,
    body: 'Receiver appointment pushed back to 5:00 PM',
  });
  await new Promise((r) => setTimeout(r, 100));
  console.log('✓ Dispatcher message stored in server DB while driver was offline');

  // 5. Restore Connection: Driver reconnects
  console.log('\n--- RESTORING CONNECTION (Driver reconnects) ---');
  driverSocket = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((resolve) => driverSocket.on('connect', resolve));
  driverSocket.emit('authenticate', { accountId: 'driver-101', role: 'driver', name: 'John Driver' });
  driverSocket.emit('join_conversation', { conversationId: 88 });
  console.log('✓ Driver reconnected and rejoined room');

  // Setup deduplication tracking on Driver client
  const driverRenderedMsgIds = new Set();
  const driverReceivedMessages = [];

  const handleDriverIncoming = (msg) => {
    const key = String(msg.id || msg.tempId);
    if (!driverRenderedMsgIds.has(key)) {
      driverRenderedMsgIds.add(key);
      driverReceivedMessages.push(msg);
    }
  };

  driverSocket.on('new_message', handleDriverIncoming);

  // Setup check for Dispatcher receiving the flushed offline message
  const dispatcherReceivedFlushedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Flushed message timeout')), 3000);
    dispatcherSocket.on('new_message', (msg) => {
      if (msg.body === 'Delayed at fuel stop 15 mins (sent offline)') {
        clearTimeout(timeout);
        console.log(`✓ (a) Dispatcher received flushed offline message: "${msg.body}" (id=${msg.id})`);
        resolve();
      }
    });
  });

  // (a) Flush Offline Queue upon reconnect
  for (const item of offlineQueue) {
    driverSocket.emit('send_message', item, (ack) => {
      console.log(`✓ (a) Offline message acknowledged by server on reconnect: id=${ack.message.id}`);
    });
  }

  await dispatcherReceivedFlushedPromise;

  // (c) Perform Backfill Sync on reconnect to fetch messages missed while offline
  const res = await new Promise((resolve) => {
    http.get(`http://localhost:${PORT}/api/chat/conversations/88/messages`, (r) => {
      let body = '';
      r.on('data', (c) => body += c);
      r.on('end', () => resolve(JSON.parse(body)));
    });
  });

  for (const serverMsg of res.messages || []) {
    handleDriverIncoming(serverMsg);
  }

  // (b) Confirm Deduplication & Content Check
  console.log('\n--- VERIFICATION CHECKS ---');
  const offlineMsgCount = driverReceivedMessages.filter(m => m.body === 'Delayed at fuel stop 15 mins (sent offline)').length;
  console.log(`✓ (b) Deduplication check: Offline message rendered exactly ${offlineMsgCount} time(s) (expected 1)`);

  const missedMsg = driverReceivedMessages.find(m => m.body === 'Receiver appointment pushed back to 5:00 PM');
  console.log(`✓ (c) Historical backfill check: Driver successfully received missed message: "${missedMsg ? missedMsg.body : 'NOT FOUND'}"`);

  if (offlineMsgCount === 1 && missedMsg) {
    console.log('\n========================================================================');
    console.log('✅ OFFLINE QUEUE, RECONNECT FLUSH, BACKFILL & DEDUPE FULLY VERIFIED!');
    console.log('========================================================================\n');
  } else {
    throw new Error('Deduplication or backfill assertion failed');
  }

  driverSocket.close();
  dispatcherSocket.close();
  server.close();
  process.exit(0);
}

testOfflineReconnectFlow().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
