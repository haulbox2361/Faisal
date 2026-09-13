// tests/test_legacy_tokens_rejection.js
// Explicitly verifies that legacy/forged 'token_<driverId>' tokens are strictly rejected across all routes

const assert = require('assert');
const http = require('http');
const express = require('express');
const dataStore = require('../lib/dataStore');
const driverRoutes = require('../routes/driver');
const ownerRoutes = require('../routes/owner');

async function run() {
  console.log('================================================================');
  console.log('  TEST: REJECTION OF LEGACY & PSEUDO-TOKENS (token_<id>)');
  console.log('================================================================\n');

  // Seed sample driver and owner
  await dataStore.saveFullState({
    settings: { driver_portal_enabled: true },
    drivers: [{ id: 'DRV-999', driverCode: 'D999', name: 'Legacy Test Driver', pin: '5678', pinHash: dataStore.hashPin('5678'), active: true }],
    owners: [{ id: 'OWN-999', ownerCode: 'O999', name: 'Legacy Test Owner', pin_hash: dataStore.hashPin('5678'), active: true }],
    loads: []
  });

  const app = express();
  app.use(express.json());
  app.use(driverRoutes);
  app.use('/api/owner', ownerRoutes);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testCases = [
    { name: 'Driver Sync with pseudo-token', url: `${baseUrl}/api/driver/sync`, token: 'token_DRV-999_1234567890' },
    { name: 'Driver Profile with pseudo-token', url: `${baseUrl}/api/driver/me`, token: 'token_DRV-999' },
    { name: 'Driver Location with pseudo-token', url: `${baseUrl}/api/driver/location`, method: 'POST', body: { lat: 32.77, lng: -96.79 }, token: 'token_DRV-999_xyz' },
    { name: 'Owner Summary with pseudo-token', url: `${baseUrl}/api/owner/summary`, token: 'token_owner_OWN-999_12345' },
    { name: 'Owner Loads with pseudo-token', url: `${baseUrl}/api/owner/loads`, token: 'token_OWN-999' },
    { name: 'Owner Payments with pseudo-token', url: `${baseUrl}/api/owner/payments`, token: 'token_owner_999' }
  ];

  let passed = 0;

  for (const tc of testCases) {
    const res = await fetch(tc.url, {
      method: tc.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tc.token}`
      },
      body: tc.body ? JSON.stringify(tc.body) : undefined
    });

    const isRejected = (res.status === 401 || res.status === 403);
    assert.ok(isRejected, `Expected 401/403 for ${tc.name}, got ${res.status}`);
    console.log(`  ✓ ${tc.name}: HTTP ${res.status} (REJECTED AS EXPECTED)`);
    passed++;
  }

  server.close();
  console.log(`\n================================================================`);
  console.log(`  RESULT: ${passed}/${testCases.length} LEGACY TOKEN ATTEMPTS REJECTED CLEANLY!`);
  console.log(`================================================================\n`);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
