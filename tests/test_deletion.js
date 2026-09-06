/**
 * tests/test_deletion.js
 * Comprehensive integration test for Company Fleet and Driver deletion safeguards
 */

const assert = require('assert');

const BASE_URL = 'http://localhost:3000';
const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  'x-admin-pin': '8483'
};

async function getServerState() {
  const res = await fetch(`${BASE_URL}/api/storage/haulline:state`);
  if (!res.ok) throw new Error('Failed to get server state: ' + res.status);
  const data = await res.json();
  return typeof data.value === 'string' ? JSON.parse(data.value) : (data.value || {});
}

async function saveServerState(state) {
  const res = await fetch(`${BASE_URL}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'haulline:state', value: JSON.stringify(state) })
  });
  if (!res.ok) throw new Error('Failed to save server state: ' + res.status);
}

async function runTests() {
  console.log('--- STARTING DELETION INTEGRATION TESTS ---');

  // Test 1: Verify COMP-LEGACY cannot be deleted
  console.log('Test 1: Guarding COMP-LEGACY from deletion...');
  const res1 = await fetch(`${BASE_URL}/api/companies/COMP-LEGACY`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS
  });
  const data1 = await res1.json();
  assert.strictEqual(res1.status, 400, 'COMP-LEGACY deletion should return status 400');
  assert.strictEqual(data1.ok, false, 'COMP-LEGACY deletion should fail');
  console.log('✓ Test 1 Passed: COMP-LEGACY successfully protected.');

  // Test 2: Unauthorized request without Admin credentials
  console.log('Test 2: Unauthorized deletion attempt without credentials...');
  const res2 = await fetch(`${BASE_URL}/api/companies/COMP-FAKE-999`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res2.status, 403, 'Unauthorized company delete should return 403');

  const res2Drv = await fetch(`${BASE_URL}/api/drivers/DRV-FAKE-999`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res2Drv.status, 403, 'Unauthorized driver delete should return 403');
  console.log('✓ Test 2 Passed: 403 Forbidden enforced for unauthorized callers.');

  // Test 3: Create a test company and owner
  console.log('Test 3: Creating a test company and linked owner...');
  const testCompId = 'COMP-DELTEST-' + Date.now();
  const testOwnerCode = 'OWNDEL' + Math.floor(1000 + Math.random() * 9000);
  const testCompName = 'Deletion Test Logistics ' + Date.now();
  const res3 = await fetch(`${BASE_URL}/api/companies`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      id: testCompId,
      name: testCompName,
      ownerName: 'Dan Delete',
      ownerCode: testOwnerCode,
      pin: '9988',
      phone: '555-9876',
      email: 'delete@testlogistics.com'
    })
  });
  const data3 = await res3.json();
  assert.strictEqual(res3.status, 201, 'Company creation failed: ' + JSON.stringify(data3));
  console.log('✓ Test 3 Passed: Test company created (' + testCompId + ').');

  // Test 4: Create a test driver assigned to this company
  console.log('Test 4: Creating a test driver assigned to company...');
  const testDriverId = 'drv-deltest-' + Date.now();
  const state = await getServerState();
  state.drivers = state.drivers || [];
  state.loads = state.loads || [];

  const testDriver = {
    id: testDriverId,
    driverCode: 'D' + Math.floor(1000 + Math.random() * 9000),
    name: 'Davey Deletable',
    phone: '555-1122',
    companyId: testCompId,
    company: testCompName,
    active: true
  };
  state.drivers.push(testDriver);

  // Add an active in-transit load assigned to this driver
  const activeLoadId = 'load-deltest-' + Date.now();
  const activeLoad = {
    id: activeLoadId,
    loadNumber: 'HB-TEST-DEL-1',
    driverId: testDriverId,
    driver: 'Davey Deletable',
    companyId: testCompId,
    status: 'In Transit',
    rate: 1500,
    is_deleted: false
  };
  state.loads.push(activeLoad);
  await saveServerState(state);
  console.log('✓ Test 4 Passed: Driver and in-transit load initialized in server state.');

  // Test 5: Attempt to delete driver while assigned to an active in-transit load
  console.log('Test 5: Attempting to delete driver with active load (should be blocked)...');
  const res5 = await fetch(`${BASE_URL}/api/drivers/${testDriverId}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS
  });
  const data5 = await res5.json();
  assert.strictEqual(res5.status, 400, 'Driver deletion with active load should return 400');
  assert.strictEqual(data5.ok, false);
  console.log('✓ Test 5 Passed: Active load safeguard correctly blocked driver deletion.');

  // Test 6: Attempt to delete company while having active in-transit load
  console.log('Test 6: Attempting to delete company with active load (should be blocked)...');
  const res6 = await fetch(`${BASE_URL}/api/companies/${testCompId}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS
  });
  const data6 = await res6.json();
  assert.strictEqual(res6.status, 400, 'Company deletion with active load should return 400');
  assert.strictEqual(data6.ok, false);
  console.log('✓ Test 6 Passed: Active load safeguard correctly blocked company deletion.');

  // Test 7: Mark load Delivered, then delete driver
  console.log('Test 7: Delivering load and deleting driver...');
  const stateAfterDeliver = await getServerState();
  const targetLoad = stateAfterDeliver.loads.find(l => l.id === activeLoadId);
  if (targetLoad) targetLoad.status = 'Delivered';
  await saveServerState(stateAfterDeliver);

  const res7 = await fetch(`${BASE_URL}/api/drivers/${testDriverId}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS
  });
  const data7 = await res7.json();
  assert.strictEqual(res7.status, 200, 'Driver deletion should return 200: ' + JSON.stringify(data7));
  assert.strictEqual(data7.ok, true);

  const stateAfterDrvDel = await getServerState();
  const drvExists = (stateAfterDrvDel.drivers || []).some(d => d.id === testDriverId);
  assert.strictEqual(drvExists, false, 'Driver should no longer exist in state');
  console.log('✓ Test 7 Passed: Driver permanently deleted after completing loads.');

  // Test 8: Delete the test company fleet
  console.log('Test 8: Deleting test company fleet...');
  const res8 = await fetch(`${BASE_URL}/api/companies/${testCompId}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS
  });
  const data8 = await res8.json();
  assert.strictEqual(res8.status, 200, 'Company deletion should return 200: ' + JSON.stringify(data8));
  assert.strictEqual(data8.ok, true);

  const stateAfterCompDel = await getServerState();
  const compExists = (stateAfterCompDel.companies || []).some(c => c.id === testCompId);
  assert.strictEqual(compExists, false, 'Company should no longer exist in state.companies');

  const ownerExists = (stateAfterCompDel.owners || []).some(o => (o.companyId || o.company_id) === testCompId);
  assert.strictEqual(ownerExists, false, 'Linked owner should no longer exist in state.owners');
  console.log('✓ Test 8 Passed: Company fleet and linked owner deleted cleanly.');

  console.log('\n=============================================');
  console.log('ALL DELETION TESTS PASSED SUCCESSFULLY! (8/8)');
  console.log('=============================================\n');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
