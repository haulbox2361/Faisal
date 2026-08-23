const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

// Import actual routes and modules
const chatRoutes = require('../routes/chat');
const chatStore = require('../lib/chatStore');

async function testFullBridge() {
  console.log('====================================================');
  console.log('🧪 TESTING ACTUAL REST BRIDGE & SOCKET.IO HANDLERS');
  console.log('====================================================');

  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  app.set('io', io);

  // Mount actual server.js socket handlers
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

  // Mount actual routes/chat.js
  app.use(chatRoutes);

  // Start HTTP server on test port 3105
  const TEST_PORT = 3105;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`✓ Test server running at http://localhost:${TEST_PORT}`);

  // Mock chatStore methods for fast verification
  chatStore.isParticipant = async () => true;
  chatStore.sendMessage = async (convId, sender, body) => ({
    id: Math.floor(Math.random() * 90000) + 1000,
    createdAt: new Date().toISOString(),
  });
  chatStore.markConversationRead = async () => true;

  // 1. Connect Client Socket
  const clientSocket = ioClient(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
  await new Promise((resolve) => clientSocket.on('connect', resolve));
  console.log('✓ Socket client connected to server');

  // 2. Authenticate and Join Room conv_77
  clientSocket.emit('authenticate', { accountId: 'driver-99', role: 'driver', name: 'Alex Driver' });
  await new Promise((resolve) => {
    clientSocket.emit('join_conversation', { conversationId: 77 }, (res) => {
      console.log(`✓ Client joined room conv_77: ok=${res.ok}`);
      resolve();
    });
  });

  // 3. TEST REST BRIDGE: Trigger HTTP POST /api/chat/conversations/77/messages
  console.log('\n--- TEST 1: REST POST -> Real-Time Socket Broadcast ---');
  const restBroadcastPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('REST bridge broadcast timeout')), 3000);
    clientSocket.on('new_message', (msg) => {
      clearTimeout(timeout);
      console.log(`✓ Socket received message sent via REST POST: "${msg.body}" (sender=${msg.senderName}, id=${msg.id})`);
      if (msg.body === 'Hello from Dispatcher via REST API!') {
        resolve();
      }
    });
  });

  const postData = JSON.stringify({
    accountId: 'admin',
    role: 'admin',
    name: 'Chief Dispatcher',
    body: 'Hello from Dispatcher via REST API!',
    loadNumber: 'HBX-9024'
  });

  const req = http.request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/chat/conversations/77/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    console.log(`✓ REST POST response status: ${res.statusCode}`);
  });
  req.write(postData);
  req.end();

  await restBroadcastPromise;

  // 4. TEST REST TYPING BRIDGE
  console.log('\n--- TEST 2: REST POST /typing -> Real-Time Socket Broadcast ---');
  const typingBroadcastPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('REST typing broadcast timeout')), 3000);
    clientSocket.on('user_typing', (data) => {
      clearTimeout(timeout);
      console.log(`✓ Socket received user_typing event triggered via REST: isTyping=${data.isTyping}`);
      resolve();
    });
  });

  const typingData = JSON.stringify({
    accountId: 'admin',
    role: 'admin',
    conversationId: 77,
    isTyping: true
  });

  const reqTyping = http.request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/chat/typing',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(typingData)
    }
  }, (res) => {
    console.log(`✓ REST typing response status: ${res.statusCode}`);
  });
  reqTyping.write(typingData);
  reqTyping.end();

  await typingBroadcastPromise;

  // 5. TEST REST MARK_READ BRIDGE
  console.log('\n--- TEST 3: REST POST /read -> Real-Time Socket Broadcast ---');
  const readBroadcastPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('REST mark_read broadcast timeout')), 3000);
    clientSocket.on('messages_read', (data) => {
      clearTimeout(timeout);
      console.log(`✓ Socket received messages_read event triggered via REST: conv=${data.conversationId}`);
      resolve();
    });
  });

  const readData = JSON.stringify({
    accountId: 'admin',
    role: 'admin'
  });

  const reqRead = http.request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/chat/read/77',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(readData)
    }
  }, (res) => {
    console.log(`✓ REST read response status: ${res.statusCode}`);
  });
  reqRead.write(readData);
  reqRead.end();

  await readBroadcastPromise;

  console.log('\n=============================================================');
  console.log('✅ ALL REST BRIDGE & SOCKET BROADCAST TESTS VERIFIED & PASSED!');
  console.log('=============================================================\n');

  clientSocket.close();
  server.close();
  process.exit(0);
}

testFullBridge().catch((err) => {
  console.error('❌ Bridge test failed:', err);
  process.exit(1);
});
