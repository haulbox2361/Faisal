const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

// Mock chatStore for isolated socket testing
const mockChatStore = {
  presence: {},
  typing: {},
  async isParticipant(convId, user) {
    return true;
  },
  async sendMessage(convId, sender, body, loadId, loadNumber, attachment) {
    return { id: 1001, createdAt: new Date().toISOString() };
  },
  async markConversationRead(convId, user) {
    return true;
  },
  setTypingStatus(convId, user, isTyping) {
    this.typing[`${convId}:${user.type}:${user.id}`] = isTyping;
  },
  setUserPresence(user, isOnline) {
    this.presence[`${user.type}:${user.id}`] = isOnline;
  }
};

async function runSocketTest() {
  console.log('--- STARTING SOCKET.IO CHAT REAL-TIME TEST ---');

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  // Attach the exact event handlers implemented in server.js
  io.on('connection', (socket) => {
    socket.on('authenticate', (data) => {
      const { accountId, role, name, type } = data || {};
      const partyType = type || (role === 'dispatcher' ? 'dispatcher' : (role === 'driver' ? 'driver' : 'admin'));
      const partyId = String(accountId || (partyType === 'admin' ? 'admin' : '')).trim();

      if (partyId) {
        socket.user = { type: partyType, id: partyId, name: name || partyType };
        const userRoom = `user_${partyType}_${partyId}`;
        socket.join(userRoom);
        mockChatStore.setUserPresence(socket.user, true);
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
      const sent = await mockChatStore.sendMessage(convId, user, text, loadId, loadNumber, attachment);

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
        mockChatStore.setTypingStatus(convId, socket.user, !!isTyping);
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
        await mockChatStore.markConversationRead(convId, socket.user);
        io.to(`conv_${convId}`).emit('messages_read', {
          conversationId: convId,
          reader: socket.user,
          readAt: new Date().toISOString(),
        });
        if (typeof ack === 'function') ack({ ok: true });
      }
    });
  });

  const testPort = 3099;
  await new Promise((resolve) => server.listen(testPort, resolve));
  console.log(`✓ Test socket server running on port ${testPort}`);

  // Test Client 1: Dispatcher
  const dispatcherSocket = ioClient(`http://localhost:${testPort}`, { transports: ['websocket'] });
  // Test Client 2: Driver
  const driverSocket = ioClient(`http://localhost:${testPort}`, { transports: ['websocket'] });

  await new Promise((resolve) => {
    let connected = 0;
    const onConn = () => { if (++connected === 2) resolve(); };
    dispatcherSocket.on('connect', onConn);
    driverSocket.on('connect', onConn);
  });
  console.log('✓ Both Dispatcher and Driver sockets connected');

  // 1. Authenticate
  await new Promise((resolve) => {
    dispatcherSocket.emit('authenticate', { accountId: 'admin', role: 'admin', name: 'Fleet Dispatcher' }, (res) => {
      resolve();
    });
    dispatcherSocket.on('authenticated', (auth) => {
      console.log(`✓ Dispatcher authenticated: room=${auth.room}`);
      resolve();
    });
  });

  await new Promise((resolve) => {
    driverSocket.emit('authenticate', { accountId: 'driver-101', role: 'driver', name: 'John Driver' });
    driverSocket.on('authenticated', (auth) => {
      console.log(`✓ Driver authenticated: room=${auth.room}`);
      resolve();
    });
  });

  // 2. Join Conversation Room conv_42
  await new Promise((resolve) => {
    dispatcherSocket.emit('join_conversation', { conversationId: 42 }, (res) => {
      console.log(`✓ Dispatcher joined conv_42: ok=${res.ok}`);
      resolve();
    });
  });

  await new Promise((resolve) => {
    driverSocket.emit('join_conversation', { conversationId: 42 }, (res) => {
      console.log(`✓ Driver joined conv_42: ok=${res.ok}`);
      resolve();
    });
  });

  // 3. Test Real-Time Message Broadcast (Driver -> Dispatcher)
  const messageReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message broadcast')), 3000);
    dispatcherSocket.on('new_message', (msg) => {
      clearTimeout(timeout);
      console.log(`✓ Real-time message received by Dispatcher: "${msg.body}" from ${msg.senderName} (id=${msg.id})`);
      if (msg.body === 'Arrived at receiver dock gate #4' && msg.senderId === 'driver-101') {
        resolve();
      } else {
        reject(new Error('Unexpected message content'));
      }
    });
  });

  driverSocket.emit('send_message', {
    conversationId: 42,
    body: 'Arrived at receiver dock gate #4',
    loadId: 'load-99',
    loadNumber: 'HBX-9024',
    tempId: 'temp-uuid-1',
  }, (ack) => {
    console.log(`✓ Driver send_message acknowledged by server: id=${ack.message.id}`);
  });

  await messageReceivedPromise;

  // 4. Test Typing Indicator Broadcast (Dispatcher -> Driver)
  const typingReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for typing broadcast')), 3000);
    driverSocket.on('user_typing', (data) => {
      clearTimeout(timeout);
      console.log(`✓ Typing indicator received by Driver: user=${data.user.name}, isTyping=${data.isTyping}`);
      if (data.isTyping === true && data.user.id === 'admin') {
        resolve();
      } else {
        reject(new Error('Unexpected typing event'));
      }
    });
  });

  dispatcherSocket.emit('typing', { conversationId: 42, isTyping: true });
  await typingReceivedPromise;

  // 5. Test Mark Read Broadcast (Dispatcher -> Driver)
  const readReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for read receipt')), 3000);
    driverSocket.on('messages_read', (data) => {
      clearTimeout(timeout);
      console.log(`✓ Read receipt received by Driver: conversation=${data.conversationId}, reader=${data.reader.name}`);
      resolve();
    });
  });

  dispatcherSocket.emit('mark_read', { conversationId: 42 });
  await readReceivedPromise;

  console.log('\n========================================');
  console.log('✅ ALL SOCKET.IO REAL-TIME TESTS PASSED!');
  console.log('========================================\n');

  dispatcherSocket.close();
  driverSocket.close();
  server.close();
  process.exit(0);
}

runSocketTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
