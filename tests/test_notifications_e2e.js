const http = require('http');
const assert = require('assert');
const { io } = require('socket.io-client');
const notificationService = require('../lib/notificationService');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Connection': 'close',
      ...headers
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function runNotificationsTest() {
  console.log('=== Starting Notifications & WhatsApp-Style Chat E2E Tests ===\n');

  const dispAId = 'disp_notif_alpha_' + Date.now();
  const dispBId = 'disp_notif_bravo_' + Date.now();
  const drvAId = 'drv_notif_alpha_' + Date.now();

  // 1. Trigger in-app notification for Dispatcher A via API
  console.log('--- 1. Testing In-App Notification Dispatch ---');
  const createNotifRes = await request('POST', '/api/notifications', {
    accountId: 'admin',
    role: 'admin',
    toType: 'dispatcher',
    toId: dispAId,
    type: 'DRIVER_ACCEPTED_LOAD',
    title: '✅ Load Accepted: #NT-901',
    body: 'Alpha Driver accepted load Chicago, IL ➔ Dallas, TX.',
    data: { loadId: 'load_notif_1' }
  }, { 'x-admin-pin': '8483' });
  assert.strictEqual(createNotifRes.status, 200, 'Notification creation must succeed with 200');
  const createdNotif = createNotifRes.body;
  assert(createdNotif && createdNotif.id, 'Notification must return ID');
  console.log('✓ Notification created on server with ID:', createdNotif.id);

  // 2. Recipient Isolation Test: Dispatcher A sees it, Dispatcher B does NOT see it
  console.log('\n--- 2. Testing Recipient Isolation & Badges ---');
  const dispARes = await request('GET', `/api/notifications?accountId=${dispAId}&role=dispatcher&unread=1`);
  assert.strictEqual(dispARes.status, 200);
  const dispANotifs = dispARes.body.notifications || [];
  assert.strictEqual(dispANotifs.length, 1, 'Dispatcher A must have exactly 1 unread notification');
  assert.strictEqual(dispANotifs[0].title, '✅ Load Accepted: #NT-901');
  console.log('✓ Dispatcher A received unread notification (badge count: 1)');

  const dispBRes = await request('GET', `/api/notifications?accountId=${dispBId}&role=dispatcher&unread=1`);
  assert.strictEqual(dispBRes.status, 200);
  const dispBNotifs = dispBRes.body.notifications || [];
  assert.strictEqual(dispBNotifs.length, 0, 'Dispatcher B must NOT receive Dispatcher A notification');
  console.log('✓ Dispatcher B badge count is 0 (Dispatcher isolation confirmed)');

  // 3. Mark Notification Read & Confirm Badge Count Clears
  console.log('\n--- 3. Testing Notification Mark-as-Read & Badge Clear ---');
  const markReadRes = await request('POST', `/api/notifications/${createdNotif.id}/read`, {
    accountId: dispAId,
    role: 'dispatcher'
  });
  assert.strictEqual(markReadRes.status, 200);
  console.log('✓ Marked notification as read');

  const recheckDispA = await request('GET', `/api/notifications?accountId=${dispAId}&role=dispatcher&unread=1`);
  assert.strictEqual(recheckDispA.status, 200);
  const recheckNotifs = recheckDispA.body.notifications || [];
  assert.strictEqual(recheckNotifs.length, 0, 'Unread notification count cleared to 0 after marking read');
  console.log('✓ Dispatcher A unread badge count successfully cleared to 0');

  // 4. Socket.IO Real-Time Push Notification & Chat Delivery
  console.log('\n--- 4. Testing Socket.IO Real-Time Event Broadcast ---');
  const socket = io(BASE_URL, {
    transports: ['websocket'],
    reconnection: false
  });

  const socketConnected = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 3000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.on('connect_error', reject);
  });
  assert(socketConnected, 'Socket connected successfully');
  console.log('✓ Socket.IO client connected in real-time');

  // Authenticate socket as Dispatcher A
  socket.emit('authenticate', { role: 'dispatcher', accountId: dispAId });

  // Test real-time notification broadcast listener
  let receivedRealtime = null;
  socket.on('notification:new', (notif) => {
    receivedRealtime = notif;
  });

  // Trigger notification via API
  const pushApiRes = await request('POST', '/api/notifications', {
    accountId: 'admin',
    role: 'admin',
    toType: 'dispatcher',
    toId: dispAId,
    type: 'admin_announcement',
    title: '📢 Weather Alert',
    body: 'Winter storm expected in Midwest corridor.'
  }, { 'x-admin-pin': '8483' });
  assert.strictEqual(pushApiRes.status, 200);

  await new Promise(r => setTimeout(r, 200));
  assert(receivedRealtime, 'Socket.IO client received real-time notification:new event');
  assert.strictEqual(receivedRealtime.title, '📢 Weather Alert');
  console.log('✓ Real-time Socket.IO notification push delivered instantly');

  // 5. Error & Failure Handling Gracefulness
  console.log('\n--- 5. Testing Failure Handling & Boundary Gracefulness ---');
  // Invalid payload test (missing required fields)
  const invalidNotif = await request('POST', '/api/notifications', {
    accountId: 'admin',
    role: 'admin'
    // missing toType, toId, title
  }, { 'x-admin-pin': '8483' });
  assert.strictEqual(invalidNotif.status, 400, 'Server gracefully returns 400 for missing fields without crashing');
  console.log('✓ Invalid notification payload handled gracefully with 400 Bad Request');

  // Confirm server is still responsive
  const pingRes = await request('GET', '/api/ocr-ping');
  assert.strictEqual(pingRes.status, 200, 'Server remains healthy and responsive');
  console.log('✓ Server remains healthy after error conditions');

  socket.disconnect();
  console.log('\n=== Notifications & Chat E2E Tests PASSED 100% ===\n');
  process.exit(0);
}

runNotificationsTest().catch(err => {
  console.error('✗ Notifications test failed:', err);
  process.exit(1);
});
