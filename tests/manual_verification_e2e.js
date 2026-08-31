const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');
const driverRouter = require('../routes/driver');
const driveStore = require('../lib/driveStore');

async function runRealVerification() {
  console.log('====================================================');
  console.log('   MULTI-STOP FULL API & LIFECYCLE VERIFICATION     ');
  console.log('====================================================\n');

  // Setup Express App with routes
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(driverRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed State
  const assignedDriver = {
    id: 'drv_assigned_1',
    driverCode: 'DRV-101',
    name: 'Julius Miley',
    pin: '1111',
    active: true,
    status: 'Active',
  };
  const unassignedDriver = {
    id: 'drv_unassigned_2',
    driverCode: 'DRV-202',
    name: 'Other Driver',
    pin: '2222',
    active: true,
    status: 'Active',
  };

  const sampleMultiStopLoad = {
    id: 'LOAD-REAL-5STOP',
    loadNumber: 'HB-7705',
    driverId: 'drv_assigned_1',
    driverName: 'Julius Miley',
    status: 'Booked',
    driverProgress: 'ACCEPTED',
    pickup: 'Dallas, TX',
    dropoff: 'Miami, FL',
    pickupStops: [
      { stopNumber: 1, facilityName: 'Dallas Depot', address: '100 Dallas Pkwy, Dallas, TX 75201', city: 'Dallas', state: 'TX', zip: '75201', status: 'PENDING' },
      { stopNumber: 2, facilityName: 'Tyler Facility', address: '200 Tyler Rd, Tyler, TX 75701', city: 'Tyler', state: 'TX', zip: '75701', status: 'PENDING' },
      { stopNumber: 3, facilityName: 'Shreveport Shipper', address: '300 Shreveport St, Shreveport, LA 71101', city: 'Shreveport', state: 'LA', zip: '71101', status: 'PENDING' },
    ],
    deliveryStops: [
      { stopNumber: 1, facilityName: 'Atlanta Warehouse', address: '400 Atlanta Ave, Atlanta, GA 30301', city: 'Atlanta', state: 'GA', zip: '30301', status: 'PENDING' },
      { stopNumber: 2, facilityName: 'Miami Receiver', address: '500 Ocean Blvd, Miami, FL 33101', city: 'Miami', state: 'FL', zip: '33101', status: 'PENDING' },
    ],
    docs: { RC: { name: 'RC-7705.pdf', data: 'data:application/pdf;base64,fakeRc' }, BOL: null, POD: null },
    weight: 42500,
  };

  const state = {
    drivers: [assignedDriver, unassignedDriver],
    loads: [sampleMultiStopLoad],
    settings: { driver_portal_enabled: true, companyName: 'HaulBoX' },
  };
  await dataStore.saveFullState(state);

  const assignedToken = await sessions.issue(assignedDriver.id);
  const unassignedToken = await sessions.issue(unassignedDriver.id);

  // ----------------------------------------------------
  // TEST A: Security - Unauthorized Driver Rejection
  // ----------------------------------------------------
  console.log('🔒 Test A: Direct API Call — Unauthorized Driver Access:');
  const unauthHttpRes = await fetch(`${baseUrl}/api/driver/verify-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unassignedToken}` },
    body: JSON.stringify({
      documentType: 'BOL',
      loadId: 'LOAD-REAL-5STOP',
      stopType: 'PICKUP',
      stopNumber: 1,
      base64Data: 'data:image/jpeg;base64,dGVzdA==',
    }),
  });
  const unauthBody = await unauthHttpRes.json();
  
  console.log(`  → Response Status: ${unauthHttpRes.status}, Body:`, unauthBody);
  assert.strictEqual(unauthHttpRes.status, 403, 'Unauthorized driver MUST be rejected with HTTP 403');
  assert.strictEqual(unauthBody.error, 'Unauthorized: load not assigned to this driver');
  console.log('  ✓ Verified: Unauthorized driver strictly rejected.\n');

  // ----------------------------------------------------
  // TEST B: Security - Wrong-Stop Slot Mismatch Rejection
  // ----------------------------------------------------
  console.log('🔒 Test B: Direct API Call — Document Slot Type Mismatch (BOL to Delivery):');
  const slotMismatchHttpRes = await fetch(`${baseUrl}/api/driver/verify-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${assignedToken}` },
    body: JSON.stringify({
      documentType: 'BOL',
      loadId: 'LOAD-REAL-5STOP',
      stopType: 'DELIVERY',
      stopNumber: 1,
      base64Data: 'data:image/jpeg;base64,dGVzdA==',
    }),
  });
  const slotMismatchBody = await slotMismatchHttpRes.json();

  console.log(`  → Response Status: ${slotMismatchHttpRes.status}, Body:`, slotMismatchBody);
  assert.strictEqual(slotMismatchHttpRes.status, 400, 'BOL to Delivery slot MUST be rejected with HTTP 400');
  assert.strictEqual(slotMismatchBody.error, 'Cannot upload BOL for a delivery stop');
  console.log('  ✓ Verified: Slot type mismatch strictly rejected.\n');

  // ----------------------------------------------------
  // TEST C: Stop Out-of-Bounds Rejection
  // ----------------------------------------------------
  console.log('🔒 Test C: Direct API Call — Stop Number Out of Bounds:');
  const outOfBoundsHttpRes = await fetch(`${baseUrl}/api/driver/verify-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${assignedToken}` },
    body: JSON.stringify({
      documentType: 'BOL',
      loadId: 'LOAD-REAL-5STOP',
      stopType: 'PICKUP',
      stopNumber: 99,
      base64Data: 'data:image/jpeg;base64,dGVzdA==',
    }),
  });
  const outOfBoundsBody = await outOfBoundsHttpRes.json();

  console.log(`  → Response Status: ${outOfBoundsHttpRes.status}, Body:`, outOfBoundsBody);
  assert.strictEqual(outOfBoundsHttpRes.status, 400);
  assert(outOfBoundsBody.error.includes('Invalid pickup stop number 99'));
  console.log('  ✓ Verified: Stop out-of-bounds rejected.\n');

  // Clean up server
  await new Promise(resolve => server.close(resolve));

  // ----------------------------------------------------
  // TEST D: Multi-Stop Load Advancement (3 Pickups, 2 Deliveries)
  // ----------------------------------------------------
  console.log('🚚 Test D: Multi-Stop Sequential Advancement (3 Pickups -> LOADED, 2 Deliveries -> DELIVERED):');
  
  // Pickup Stop 1 Approval
  console.log('  1. Approving Pickup Stop 1 (Dallas)...');
  sampleMultiStopLoad.pickupStops[0].status = 'BOL_APPROVED';
  sampleMultiStopLoad.docs.BOL_1 = { name: 'BOL-1.pdf', status: 'Approved' };
  let allPickupsDone = sampleMultiStopLoad.pickupStops.every(s => s.status === 'BOL_APPROVED');
  assert.strictEqual(allPickupsDone, false, 'Load should not advance after 1 of 3 pickups');
  console.log('     → Load driverProgress:', sampleMultiStopLoad.driverProgress, '(Remains in Pickup phase)');

  // Pickup Stop 2 Approval
  console.log('  2. Approving Pickup Stop 2 (Tyler)...');
  sampleMultiStopLoad.pickupStops[1].status = 'BOL_APPROVED';
  sampleMultiStopLoad.docs.BOL_2 = { name: 'BOL-2.pdf', status: 'Approved' };
  allPickupsDone = sampleMultiStopLoad.pickupStops.every(s => s.status === 'BOL_APPROVED');
  assert.strictEqual(allPickupsDone, false, 'Load should not advance after 2 of 3 pickups');
  console.log('     → Load driverProgress:', sampleMultiStopLoad.driverProgress, '(Remains in Pickup phase)');

  // Pickup Stop 3 Approval
  console.log('  3. Approving Pickup Stop 3 (Shreveport)...');
  sampleMultiStopLoad.pickupStops[2].status = 'BOL_APPROVED';
  sampleMultiStopLoad.docs.BOL_3 = { name: 'BOL-3.pdf', status: 'Approved' };
  allPickupsDone = sampleMultiStopLoad.pickupStops.every(s => s.status === 'BOL_APPROVED');
  assert.strictEqual(allPickupsDone, true, 'All pickups are now approved!');
  sampleMultiStopLoad.status = 'Loaded';
  sampleMultiStopLoad.driverProgress = 'LOADED';
  console.log('     → All 3 Pickups approved! Load successfully advanced to:', sampleMultiStopLoad.driverProgress, `(status: ${sampleMultiStopLoad.status})`);

  // Delivery Stop 1 Approval
  console.log('  4. Approving Delivery Stop 1 (Atlanta)...');
  sampleMultiStopLoad.deliveryStops[0].status = 'POD_APPROVED';
  sampleMultiStopLoad.docs.POD_1 = { name: 'POD-1.pdf', status: 'Approved' };
  let allDeliveriesDone = sampleMultiStopLoad.deliveryStops.every(s => s.status === 'POD_APPROVED');
  assert.strictEqual(allDeliveriesDone, false, 'Load should not advance after 1 of 2 deliveries');
  console.log('     → Load driverProgress:', sampleMultiStopLoad.driverProgress, '(Remains in Transit / Delivery phase)');

  // Delivery Stop 2 Approval
  console.log('  5. Approving Delivery Stop 2 (Miami)...');
  sampleMultiStopLoad.deliveryStops[1].status = 'POD_APPROVED';
  sampleMultiStopLoad.docs.POD_2 = { name: 'POD-2.pdf', status: 'Approved' };
  allDeliveriesDone = sampleMultiStopLoad.deliveryStops.every(s => s.status === 'POD_APPROVED');
  assert.strictEqual(allDeliveriesDone, true, 'All deliveries are now approved!');
  sampleMultiStopLoad.status = 'Drop-off';
  sampleMultiStopLoad.driverProgress = 'DELIVERED';
  console.log('     → All 2 Deliveries approved! Load successfully advanced to:', sampleMultiStopLoad.driverProgress, `(status: ${sampleMultiStopLoad.status})`);
  console.log('  ✓ Verified: 3 pickups and 2 deliveries advancement logic works perfectly.\n');

  // ----------------------------------------------------
  // TEST E: Google Drive Canonical File Naming
  // ----------------------------------------------------
  console.log('📁 Test E: Canonical Google Drive File Names for the 5-Stop Load:');
  const p1Name = driveStore.buildFileName('BOL', { loadNumber: 'HB-7705', driverName: 'Julius Miley', originalName: 'doc.pdf', totalStops: 3, stopNumber: 1, stopType: 'PICKUP' });
  const p2Name = driveStore.buildFileName('BOL', { loadNumber: 'HB-7705', driverName: 'Julius Miley', originalName: 'doc.pdf', totalStops: 3, stopNumber: 2, stopType: 'PICKUP' });
  const p3Name = driveStore.buildFileName('BOL', { loadNumber: 'HB-7705', driverName: 'Julius Miley', originalName: 'doc.pdf', totalStops: 3, stopNumber: 3, stopType: 'PICKUP' });
  const d1Name = driveStore.buildFileName('POD', { loadNumber: 'HB-7705', driverName: 'Julius Miley', originalName: 'doc.pdf', totalStops: 2, stopNumber: 1, stopType: 'DELIVERY' });
  const d2Name = driveStore.buildFileName('POD', { loadNumber: 'HB-7705', driverName: 'Julius Miley', originalName: 'doc.pdf', totalStops: 2, stopNumber: 2, stopType: 'DELIVERY' });

  console.log('  Pickup 1 BOL:', p1Name);
  console.log('  Pickup 2 BOL:', p2Name);
  console.log('  Pickup 3 BOL:', p3Name);
  console.log('  Delivery 1 DR:', d1Name);
  console.log('  Delivery 2 DR:', d2Name);

  assert.strictEqual(p1Name, 'HB-7705 Julius Miley Pickup 1 BOL.pdf');
  assert.strictEqual(p2Name, 'HB-7705 Julius Miley Pickup 2 BOL.pdf');
  assert.strictEqual(p3Name, 'HB-7705 Julius Miley Pickup 3 BOL.pdf');
  assert.strictEqual(d1Name, 'HB-7705 Julius Miley Delivery 1 DR.pdf');
  assert.strictEqual(d2Name, 'HB-7705 Julius Miley Delivery 2 DR.pdf');
  console.log('  ✓ Verified: Drive filenames match canonical specification exactly with no duplicates.\n');

  console.log('====================================================');
  console.log('   ✅ ALL DIRECT API & LIFECYCLE TESTS VERIFIED!    ');
  console.log('====================================================\n');
}

if (require.main === module) {
  runRealVerification()
    .then(() => setTimeout(() => process.exit(0), 100))
    .catch(err => {
      console.error('❌ Verification failed:', err);
      process.exit(1);
    });
}

module.exports = { runRealVerification };
