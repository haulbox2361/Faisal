// tests/full_system_verification.js
// Comprehensive in-memory and endpoint test suite for security, roles, and business logic

const assert = require('assert');
const http = require('http');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const db = require('../lib/db');
const security = require('../lib/security');

async function startTestServer() {
  const app = require('express')();
  // We can import the actual server routes
  require('dotenv').config();
  const express = require('express');

  const authRoutes = require('../routes/auth');
  const apiRoutes = require('../routes/api');
  const storageRoutes = require('../routes/storage');
  const driverRoutes = require('../routes/driver');
  const chatRoutes = require('../routes/chat');
  const notificationRoutes = require('../routes/notifications');
  const mistralRoutes = require('../routes/mistral');
  const dailyNotesRoutes = require('../routes/dailyNotes');
  const ownerRoutes = require('../routes/owner');
  const companiesRoutes = require('../routes/companies');

  app.use(express.json({ limit: '10mb' }));
  app.use(authRoutes);
  app.use(apiRoutes);
  app.use(storageRoutes);
  app.use(driverRoutes);
  app.use(chatRoutes);
  app.use(notificationRoutes);
  app.use(mistralRoutes);
  app.use('/api/daily-notes', dailyNotesRoutes);
  app.use('/api/owner', ownerRoutes);
  app.use('/api/companies', companiesRoutes);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function run() {
  console.log('====================================================');
  console.log('  HAULBOX FULL-STACK SECURITY & FUNCTIONALITY SUITE');
  console.log('====================================================\n');

  const { server, port, baseUrl } = await startTestServer();
  console.log(`[Test Server] Running on temporary port: ${port}\n`);

  try {
    // -------------------------------------------------------------
    // Test 1: Unauthenticated /api/storage is Blocked (401)
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying /api/storage protection...');
    const storageRes = await fetch(`${baseUrl}/api/storage`);
    assert.strictEqual(storageRes.status, 401, 'Unauthenticated /api/storage should return 401');
    console.log('  ✓ PASSED: Unauthenticated access to /api/storage is securely blocked (401).\n');

    // -------------------------------------------------------------
    // Test 2: Admin PIN Verification (Correct PIN vs Backdoor PINs)
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Admin PIN Verification...');
    const validPin = process.env.SETTINGS_ADMIN_PIN || '123456';
    const pinRes1 = await fetch(`${baseUrl}/api/verify-settings-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: validPin }),
    });
    const pinData1 = await pinRes1.json();
    assert.strictEqual(pinRes1.status, 200);
    assert.strictEqual(pinData1.ok, true);

    const pinRes2 = await fetch(`${baseUrl}/api/verify-settings-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '8483' }),
    });
    assert.strictEqual(pinRes2.status, 403, 'Backdoor PIN 8483 should be rejected');
    console.log('  ✓ PASSED: Configured PIN verified; backdoor PIN 8483 rejected (403).\n');

    // -------------------------------------------------------------
    // Test 3: Seed Sample Fleet Data & Verify Driver Authentication
    // -------------------------------------------------------------
    console.log('[Test 3] Testing Driver Role Authentication & Token Handling...');
    const testState = {
      settings: { companyName: 'HaulBoX Express', driver_portal_enabled: true },
      drivers: [
        {
          id: 'D-TEST-1',
          driverCode: 'D101',
          name: 'John Doe',
          phone: '555-0101',
          truck: 'Unit 101',
          pin: '1234',
          pinHash: dataStore.hashPin('1234'),
          active: true,
          companyId: 'COMP-LEGACY'
        },
        {
          id: 'D-NOPIN',
          driverCode: 'D999',
          name: 'No Pin Driver',
          pin: '',
          pinHash: '',
          active: true,
        }
      ],
      owners: [
        {
          id: 'OWN-TEST-1',
          ownerCode: 'OWN-01',
          name: 'Apex Fleet Holdings',
          pin_hash: dataStore.hashPin('9999'),
          phone: '555-0999',
          email: 'owner@apex.com',
          company_id: 'COMP-LEGACY',
          active: true,
        }
      ],
      loads: [
        {
          id: 'L-1001',
          loadNumber: 'HB-1001',
          driverId: 'D-TEST-1',
          brokerName: 'TQL Logistics',
          rate: 2500,
          driverPay: 2000,
          status: 'In Transit',
          driverProgress: 'IN_TRANSIT',
          companyId: 'COMP-LEGACY',
          pickup: 'Dallas, TX',
          dropoff: 'Atlanta, GA',
        }
      ]
    };
    await dataStore.saveFullState(testState);

    // Driver login with valid credentials
    const drvLoginRes = await fetch(`${baseUrl}/api/driver/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: 'D101', pin: '1234' })
    });
    const drvLoginData = await drvLoginRes.json();
    assert.strictEqual(drvLoginRes.status, 200);
    assert.strictEqual(drvLoginData.ok, true);
    assert.strictEqual(drvLoginData.role, 'DRIVER');
    assert.strictEqual(drvLoginData.driver.name, 'John Doe');
    const driverToken = drvLoginData.token;
    assert.ok(driverToken, 'Driver should receive valid session token');

    // Attempt login on driver without PIN -> MUST fail
    const noPinLoginRes = await fetch(`${baseUrl}/api/driver/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: 'D999', pin: '0000' })
    });
    assert.strictEqual(noPinLoginRes.status, 401, 'Driver with no configured PIN must be rejected');

    // Attempt pseudo-token bypass `Bearer token_D-TEST-1`
    const fakeTokenRes = await fetch(`${baseUrl}/api/driver/sync`, {
      headers: { 'Authorization': 'Bearer token_D-TEST-1_123456789' }
    });
    assert.strictEqual(fakeTokenRes.status, 401, 'Forged pseudo-token must be rejected (401)');

    // Access with real session token
    const realTokenRes = await fetch(`${baseUrl}/api/driver/sync`, {
      headers: { 'Authorization': `Bearer ${driverToken}` }
    });
    assert.strictEqual(realTokenRes.status, 200);
    const realLoadsData = await realTokenRes.json();
    assert.strictEqual(realLoadsData.ok, true);
    assert.strictEqual(realLoadsData.loads.length, 1);
    assert.strictEqual(realLoadsData.loads[0].driverPay, 2000, 'Driver pay must reflect actual pay');
    assert.strictEqual(realLoadsData.loads[0].grossAmount, 2500, 'Gross rate must reflect broker rate');
    console.log('  ✓ PASSED: Driver authentication, session issuance, rate shaping, and token bypass defense verified.\n');

    // -------------------------------------------------------------
    // Test 4: Owner Role Authentication & Dashboard Scoping
    // -------------------------------------------------------------
    console.log('[Test 4] Testing Fleet Owner Role Authentication & Scoping...');
    const ownerLoginRes = await fetch(`${baseUrl}/api/driver/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: 'OWN-01', pin: '9999' })
    });
    const ownerLoginData = await ownerLoginRes.json();
    assert.strictEqual(ownerLoginRes.status, 200);
    assert.strictEqual(ownerLoginData.ok, true);
    assert.strictEqual(ownerLoginData.role, 'OWNER');
    assert.strictEqual(ownerLoginData.owner.name, 'Apex Fleet Holdings');
    const ownerToken = ownerLoginData.token;
    assert.ok(ownerToken, 'Owner should receive valid session token');

    // Owner summary API call
    const ownerSummaryRes = await fetch(`${baseUrl}/api/owner/summary`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    assert.strictEqual(ownerSummaryRes.status, 200);
    const ownerSummaryData = await ownerSummaryRes.json();
    assert.strictEqual(ownerSummaryData.ok, true);
    assert.strictEqual(ownerSummaryData.grossRevenue, 2500);
    assert.strictEqual(ownerSummaryData.driverPay, 2000);
    assert.strictEqual(ownerSummaryData.estimatedProfit, 500);
    console.log('  ✓ PASSED: Fleet Owner login, token generation, and company KPI summary verified.\n');

    // -------------------------------------------------------------
    // Test 5: Admin Endpoint Parameter Pollution Defense
    // -------------------------------------------------------------
    console.log('[Test 5] Testing Admin Endpoint Parameter Injection Defense...');
    const adminAttackRes = await fetch(`${baseUrl}/api/admin/system/data-layer?role=admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'relational' })
    });
    assert.strictEqual(adminAttackRes.status, 403, 'Unauthenticated admin endpoint must be blocked (403)');
    console.log('  ✓ PASSED: Admin endpoint parameter injection attack thwarted (403).\n');

    console.log('====================================================');
    console.log('  ALL 5 SECURITY & ROLE VERIFICATION TESTS PASSED!  ');
    console.log('====================================================\n');

  } finally {
    server.close();
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
