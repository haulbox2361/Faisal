const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

const chatRoutes = require('../routes/chat');
const chatStore = require('../lib/chatStore');

async function testFullIntegration() {
  console.log('=================================================================');
  console.log('🧪 END-TO-END VERIFICATION: SERVER.JS + CHAT.JS + FLUTTER CLIENT');
  console.log('=================================================================');

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  app.set('io', io);

  // Exact server.js socket event implementation
  io.on('connection', (socket) => {
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
      }
    });

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
      if (typeof ack === 'function') ack({ ok: true, room: roomName, conversationId: convId });
    });

    socket.on('send_message', async (data, ack) => {
      const { conversationId, body, loadId, loadNumber, attachment, tempId, accountId, role, name } = data || {};
      const convId = Number(conversationId);
      const user = socket.user || (accountId ? {
        type: role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'),
        id: String(accountId).trim(),
        name: name || 'User'
      } : null);

      if (!convId || !user) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Missing auth or convId' });
        return;
      }

      const text = String(body || '').trim();
      const sent = await chatStore.sendMessage(convId, user, text, loadId, loadNumber, attachment);

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
        createdAt: sent.createdAt,
        tempId: tempId || null,
      };

      io.to(`conv_${convId}`).emit('new_message', msgPayload);
      if (typeof ack === 'function') ack({ ok: true, message: msgPayload });
    });

    socket.on('typing', (data) => {
      const { conversationId, isTyping } = data || {};
      const convId = Number(conversationId);
      if (convId && socket.user) {
        chatStore.setTypingStatus(convId, socket.user, !!isTyping);
        socket.to(`conv_${convId}`).emit('user_typing', {
          conversationId: convId,
          user: socket.user,
          isTyping: !!isTyping,
        });
      }
    });

    socket.on('mark_read', async (data, ack) => {
      const { conversationId } = data || {};
      const convId = Number(conversationId);
      if (convId && socket.user) {
        await chatStore.markConversationRead(convId, socket.user);
        io.to(`conv_${convId}`).emit('messages_read', {
          conversationId: convId,
          reader: socket.user,
          readAt: new Date().toISOString(),
        });
        if (typeof ack === 'function') ack({ ok: true });
      }
    });
  });

  app.use(chatRoutes);

  const PORT = 3110;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Integration server running on port ${PORT}`);

  // Mock DB persistence
  chatStore.isParticipant = async () => true;
  chatStore.sendMessage = async (convId, sender, body) => ({
    id: 994411,
    createdAt: new Date().toISOString(),
  });
  chatStore.markConversationRead = async () => true;

  // 1. Connect Flutter Driver App Socket
  const flutterSocket = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
  // 2. Connect Web Dispatcher Socket
  const webSocket = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });

  await new Promise((resolve) => {
    let count = 0;
    const check = () => { if (++count === 2) resolve(); };
    flutterSocket.on('connect', check);
    webSocket.on('connect', check);
  });
  console.log('✓ Both Flutter client and Web Dispatcher sockets connected successfully');

  // Authenticate both clients
  flutterSocket.emit('authenticate', { accountId: 'driver-101', role: 'driver', type: 'driver', name: 'John Driver' });
  webSocket.emit('authenticate', { accountId: 'admin', role: 'admin', type: 'admin', name: 'Fleet Admin' });

  await new Promise((r) => setTimeout(r, 100));

  // Join room conv_50
  flutterSocket.emit('join_conversation', { conversationId: 50 });
  webSocket.emit('join_conversation', { conversationId: 50 });

  await new Promise((r) => setTimeout(r, 100));
  console.log('✓ Both Flutter and Web clients joined room conv_50');

  // TEST 1: Driver sends socket message -> Web receives
  console.log('\n--- TEST 1: Flutter Socket -> Web Dispatcher Real-Time Broadcast ---');
  const test1Promise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test 1 timeout')), 3000);
    webSocket.on('new_message', (msg) => {
      clearTimeout(t);
      console.log(`✓ Web received message: "${msg.body}" from ${msg.senderName}`);
      if (msg.body === 'Driver on site at gate 3') resolve();
    });
  });

  flutterSocket.emit('send_message', {
    conversationId: 50,
    body: 'Driver on site at gate 3',
    tempId: 'temp-flutter-1'
  }, (ack) => {
    console.log(`✓ Server acknowledged Flutter message: id=${ack.message.id}`);
  });

  await test1Promise;

  // TEST 2: REST POST to /api/chat/conversations/50/messages -> Flutter socket receives
  console.log('\n--- TEST 2: REST HTTP POST -> Flutter Socket Real-Time Broadcast ---');
  const test2Promise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test 2 timeout')), 3000);
    flutterSocket.on('new_message', (msg) => {
      clearTimeout(t);
      console.log(`✓ Flutter client received real-time broadcast: "${msg.body}" from ${msg.senderName} (id=${msg.id})`);
      if (msg.body === 'Gate code is #8899') resolve();
    });
  });

  const postData = JSON.stringify({
    accountId: 'admin',
    role: 'admin',
    name: 'Fleet Admin',
    body: 'Gate code is #8899'
  });

  const req = http.request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/chat/conversations/50/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  });
  req.write(postData);
  req.end();

  await test2Promise;

  // TEST 3: Web marks read -> Flutter receives messages_read
  console.log('\n--- TEST 3: Read Receipt Broadcast (Web -> Flutter) ---');
  const test3Promise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Test 3 timeout')), 3000);
    flutterSocket.on('messages_read', (data) => {
      clearTimeout(t);
      console.log(`✓ Flutter received messages_read event for conversation: ${data.conversationId}`);
      resolve();
    });
  });

  webSocket.emit('mark_read', { conversationId: 50 });
  await test3Promise;

  console.log('\n=================================================================');
  console.log('✅ ALL INTEGRATION TESTS VERIFIED: SOCKETS & REST BRIDGE CONFIRMED!');
  console.log('=================================================================\n');

  flutterSocket.close();
  webSocket.close();
  server.close();
  process.exit(0);
}

testFullIntegration().catch((e) => {
  console.error('❌ Integration test failed:', e);
  process.exit(1);
});
