const assert = require('assert');
const express = require('express');
const http = require('http');
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const driverRouter = require('../routes/driver');

async function verifyOcrNoAutoApproveLifecycle() {
  console.log('========================================================================');
  console.log('   MANUAL VERIFICATION: OCR 100% CLEAN DOC -> PENDING_REVIEW -> DISPATCHER APPROVE');
  console.log('========================================================================\n');

  await db.ensureSchema();

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(driverRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const driver = {
    id: 'drv_test_live',
    driverCode: 'DRV-777',
    name: 'Marcus Vance',
    pin: '7777',
    active: true,
    status: 'Active',
  };

  const load = {
    id: 'LOAD-VERIFY-101',
    loadNumber: 'HB-7701',
    driverId: 'drv_test_live',
    driverName: 'Marcus Vance',
    status: 'Accepted',
    driverProgress: 'ACCEPTED',
    pickup: '100 Industrial Pkwy, Dallas, TX 75201',
    pickupAddress: '100 Industrial Pkwy, Dallas, TX 75201',
    dropoff: '500 Logistics Way, Chicago, IL 60601',
    dropoffAddress: '500 Logistics Way, Chicago, IL 60601',
    brokerName: 'Midwest Freight',
    weight: 42500,
    timestamps: {},
    docs: {},
  };

  const state = {
    drivers: [driver],
    loads: [load],
    settings: { driver_portal_enabled: true },
  };
  await dataStore.saveFullState(state);

  const token = await sessions.issue(driver.id);

  console.log('📌 INITIAL STATE:');
  console.log(`   Load Status:     ${load.status}`);
  console.log(`   Driver Progress: ${load.driverProgress}`);
  console.log(`   BOL on file:     ${load.docs.BOL ? load.docs.BOL.status : 'None'}\n`);

  // STEP 1: Driver uploads 100% clean BOL with passing imageMeta
  console.log('📤 STEP 1: Driver uploads 100% clean BOL (passes all checks)...');
  const bolRes = await fetch(`${baseUrl}/api/driver/upload-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      loadId: load.id,
      key: 'BOL',
      fileName: 'BOL_HB-7701_Signed.jpg',
      data: 'data:image/jpeg;base64,' + Buffer.from('CLEAN_BOL_IMAGE_BYTES').toString('base64'),
      imageMeta: {
        isBlurry: false,
        cornersVisible: true,
        shipperSignaturePresent: true,
        detectedPickupAddress: '100 Industrial Pkwy, Dallas, TX 75201',
        detectedWeight: 42500,
      }
    }),
  });

  const bolJson = await bolRes.json();
  console.log('   Upload API Response:', {
    ok: bolJson.ok,
    validationStatus: bolJson.validation?.status,
    reason: bolJson.validation?.reason || null
  });

  // Verify that document landed in "Pending Verification", NOT "Approved"
  assert.strictEqual(bolJson.validation?.status, 'Pending Verification', 'BOL must land in "Pending Verification"');
  
  // Reload state from DB/store
  const stateAfterUpload = await dataStore.loadFullState();
  const loadAfterUpload = stateAfterUpload.loads.find(l => l.id === load.id);

  console.log('\n📌 STATE AFTER BOL UPLOAD (Awaiting Dispatcher Review):');
  console.log(`   Doc Status in Store: ${loadAfterUpload.docs.BOL.status}`);
  console.log(`   Load Status:         ${loadAfterUpload.status} (MUST STILL BE "Accepted")`);
  console.log(`   Driver Progress:     ${loadAfterUpload.driverProgress} (MUST STILL BE "ACCEPTED")`);

  assert.strictEqual(loadAfterUpload.docs.BOL.status, 'Pending Verification', 'Doc in store must be "Pending Verification"');
  assert.strictEqual(loadAfterUpload.status, 'Accepted', 'Load status must NOT have auto-advanced!');
  assert.strictEqual(loadAfterUpload.driverProgress, 'ACCEPTED', 'Driver progress must NOT have auto-advanced!');
  console.log('   ✓ CONFIRMED: Load DID NOT auto-advance on upload.\n');

  // STEP 2: Dispatcher approves the BOL
  console.log('👤 STEP 2: Dispatcher approves BOL via POST /api/documents/review-action...');
  const reviewRes = await fetch(`${baseUrl}/api/documents/review-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loadId: load.id,
      docType: 'BOL',
      action: 'APPROVE',
      reviewerId: 'disp_001',
      reviewerName: 'Dispatch Lead',
    }),
  });
  const reviewJson = await reviewRes.json();
  console.log('   Review API Response:', reviewJson);
  assert.strictEqual(reviewJson.ok, true, 'Review API call must succeed');

  const stateAfterReview = await dataStore.loadFullState();
  const loadAfterReview = stateAfterReview.loads.find(l => l.id === load.id);

  console.log('\n📌 STATE AFTER DISPATCHER APPROVAL:');
  console.log(`   Doc Status:      ${loadAfterReview.docs.BOL.status} (Now "Approved")`);
  console.log(`   Load Status:     ${loadAfterReview.status} (Advanced to "Loaded")`);
  console.log(`   Driver Progress: ${loadAfterReview.driverProgress} (Advanced to "LOADED")`);

  assert.strictEqual(loadAfterReview.docs.BOL.status, 'Approved', 'Doc status must now be "Approved"');
  assert.strictEqual(loadAfterReview.status, 'Loaded', 'Load status must now be "Loaded"');
  assert.strictEqual(loadAfterReview.driverProgress, 'LOADED', 'Driver progress must now be "LOADED"');
  console.log('   ✓ CONFIRMED: Load advances ONLY after Dispatcher human review.\n');

  await new Promise(resolve => server.close(resolve));
  console.log('========================================================================');
  console.log('   ✅ MANUAL VERIFICATION SUCCESSFUL: 0% AUTO-APPROVE, 100% HUMAN GATED');
  console.log('========================================================================\n');
}

verifyOcrNoAutoApproveLifecycle()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
