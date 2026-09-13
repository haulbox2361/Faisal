const http = require('http');
const assert = require('assert');

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

async function run() {
  console.log('=== Running Permissions & Role Isolation Audit ===\n');

  // Load state and prepare test fixtures
  const stateRes = await request('GET', '/api/storage/haulline:state');
  let state = {};
  if (stateRes.status === 200 && stateRes.body.value) {
    state = typeof stateRes.body.value === 'string' ? JSON.parse(stateRes.body.value) : stateRes.body.value;
  }
  state.loads = state.loads || [];
  state.drivers = state.drivers || [];
  state.dispatchers = state.dispatchers || [];

  // Setup Company A and Company B
  const compARes = await request('POST', '/api/companies', {
    name: 'Company Alpha Fleet',
    contact_name: 'Alpha Contact',
    email: 'alpha@fleet.test',
    phone: '555-1111'
  }, { 'x-admin-pin': '8483' });

  const compBRes = await request('POST', '/api/companies', {
    name: 'Company Bravo Fleet',
    contact_name: 'Bravo Contact',
    email: 'bravo@fleet.test',
    phone: '555-2222'
  }, { 'x-admin-pin': '8483' });

  const compAId = compARes.body.company ? compARes.body.company.id : 'COMP-ALPHA';
  const compBId = compBRes.body.company ? compBRes.body.company.id : 'COMP-BRAVO';

  // Setup Dispatcher A and Dispatcher B
  const dispA = {
    id: 'disp_alpha_test',
    name: 'Dispatcher Alpha',
    email: 'disp_alpha@test.com',
    role: 'dispatcher',
    sessionToken: 'token_disp_alpha'
  };
  const dispB = {
    id: 'disp_bravo_test',
    name: 'Dispatcher Bravo',
    email: 'disp_bravo@test.com',
    role: 'dispatcher',
    sessionToken: 'token_disp_bravo'
  };

  // Setup Driver 1 (assigned to Disp A, Company A) & Driver 2 (assigned to Disp B, Company B)
  const drv1 = {
    id: 'drv_alpha_1',
    name: 'Driver Alpha 1',
    driverCode: 'D1001',
    pin: '1111',
    dispatcherId: dispA.id,
    companyId: compAId,
    active: true
  };
  const drv2 = {
    id: 'drv_bravo_2',
    name: 'Driver Bravo 2',
    driverCode: 'D2002',
    pin: '2222',
    dispatcherId: dispB.id,
    companyId: compBId,
    active: true
  };

  // Setup Load A (assigned to Disp A & Drv 1) & Load B (assigned to Disp B & Drv 2)
  const loadA = {
    id: 'load_alpha_1',
    loadNumber: 'LA-101',
    dispatcherId: dispA.id,
    driverId: drv1.id,
    companyId: compAId,
    brokerRate: 3500,
    driverPay: 2975,
    pickup: 'Dallas, TX',
    dropoff: 'Denver, CO',
    status: 'Booked'
  };
  const loadB = {
    id: 'load_bravo_2',
    loadNumber: 'LB-202',
    dispatcherId: dispB.id,
    driverId: drv2.id,
    companyId: compBId,
    brokerRate: 4200,
    driverPay: 3570,
    pickup: 'Miami, FL',
    dropoff: 'Atlanta, GA',
    status: 'Booked'
  };

  state.dispatchers = state.dispatchers.filter(d => d.id !== dispA.id && d.id !== dispB.id);
  state.dispatchers.push(dispA, dispB);

  state.drivers = state.drivers.filter(d => d.id !== drv1.id && d.id !== drv2.id);
  state.drivers.push(drv1, drv2);

  state.loads = state.loads.filter(l => l.id !== loadA.id && l.id !== loadB.id);
  state.loads.push(loadA, loadB);

  await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(state)
  });

  console.log('✓ Test fixtures initialized: 2 companies, 2 dispatchers, 2 drivers, 2 loads\n');

  // -------------------------------------------------------------
  // TEST 1: Driver Authentication & Cross-Driver Isolation
  // -------------------------------------------------------------
  console.log('--- TEST 1: Driver Authentication & Isolation ---');
  const d1Login = await request('POST', '/api/driver/login', { driverId: drv1.driverCode, pin: drv1.pin });
  assert.strictEqual(d1Login.status, 200, 'Driver 1 should log in successfully');
  const d1Token = d1Login.body.token;

  const d2Login = await request('POST', '/api/driver/login', { driverId: drv2.driverCode, pin: drv2.pin });
  assert.strictEqual(d2Login.status, 200, 'Driver 2 should log in successfully');
  const d2Token = d2Login.body.token;

  // Driver 1 accessing Driver 1's load -> 200
  const d1OwnLoad = await request('GET', `/api/driver/loads/${loadA.id}`, null, { Authorization: `Bearer ${d1Token}` });
  assert.strictEqual(d1OwnLoad.status, 200, 'Driver 1 should access own load');

  // Driver 1 accessing Driver 2's load -> MUST BE 403 or null
  const d1OtherLoad = await request('GET', `/api/driver/loads/${loadB.id}`, null, { Authorization: `Bearer ${d1Token}` });
  const d1Blocked = d1OtherLoad.status === 403 || d1OtherLoad.status === 404 || !d1OtherLoad.body.load;
  assert(d1Blocked, 'Driver 1 MUST NOT be able to access Driver 2 load');
  console.log('✓ Driver 1 blocked from accessing Driver 2 load (Server-side enforced)');

  // -------------------------------------------------------------
  // TEST 2: Dispatcher Chat Isolation
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Dispatcher Chat Isolation ---');
  // Dispatcher A contacts
  const dispAContacts = await request('GET', `/api/chat/contacts?accountId=${dispA.id}&role=dispatcher`);
  assert.strictEqual(dispAContacts.status, 200);
  const contactsA = dispAContacts.body.contacts || [];
  const hasDriver1 = contactsA.some(c => c.id === drv1.id);
  const hasDriver2 = contactsA.some(c => c.id === drv2.id);
  assert(hasDriver1, 'Dispatcher A must see assigned Driver 1 in contacts');
  assert(!hasDriver2, 'Dispatcher A MUST NOT see unassigned Driver 2 in contacts');
  console.log('✓ Dispatcher A contacts only show assigned drivers, not Dispatcher B drivers');

  // Dispatcher A attempts to start chat with Driver 2 directly via API
  const dispAChatDrv2 = await request('POST', '/api/chat/start', {
    accountId: dispA.id,
    role: 'dispatcher',
    withType: 'driver',
    withId: drv2.id
  });
  assert.strictEqual(dispAChatDrv2.status, 403, 'Server must reject Dispatcher A messaging Driver 2 with 403');
  console.log('✓ Dispatcher A direct chat with Driver 2 rejected with 403 (Server-side enforced)');

  // -------------------------------------------------------------
  // TEST 3: Cross-Role Admin Endpoint Security
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Admin Endpoint Security & Role Spoofing ---');
  
  // 3a. Delete Load without admin credentials
  const deleteLoadNoAuth = await request('POST', `/api/loads/${loadA.id}/delete`, {
    reason: 'Unauthorized attempt'
  });
  console.log('Delete load with no auth header/role:', deleteLoadNoAuth.status, deleteLoadNoAuth.body.error);
  assert.strictEqual(deleteLoadNoAuth.status, 403, 'Delete load without auth must be 403');

  // 3b. Delete Load with spoofed body: { userRole: 'admin' } but no PIN or token
  const deleteLoadSpoofed = await request('POST', `/api/loads/${loadA.id}/delete`, {
    reason: 'Malicious deletion attempt',
    userRole: 'admin',
    userName: 'Attacker'
  });
  console.log('Delete load with spoofed userRole in body:', deleteLoadSpoofed.status, deleteLoadSpoofed.status === 403 ? 'REJECTED (SECURE)' : 'UNAUTHORIZED SUCCESS (VULNERABLE)');
  assert.strictEqual(deleteLoadSpoofed.status, 403, 'Spoofed userRole on delete load must be 403');

  // 3c. Create Dispatcher with spoofed body: { userRole: 'admin' }
  const createDispSpoofed = await request('POST', '/api/dispatchers/create', {
    name: 'Hacked Dispatcher',
    email: 'hacked@test.com',
    role: 'admin',
    userRole: 'admin'
  });
  console.log('Create dispatcher with spoofed userRole:', createDispSpoofed.status, createDispSpoofed.status === 403 ? 'REJECTED (SECURE)' : 'UNAUTHORIZED SUCCESS (VULNERABLE)');
  assert.strictEqual(createDispSpoofed.status, 403, 'Spoofed userRole on create dispatcher must be 403');

  // 3d. Delete Driver with spoofed body: { userRole: 'admin' }
  const deleteDrvSpoofed = await request('DELETE', `/api/drivers/${drv1.id}`, {
    userRole: 'admin'
  });
  console.log('Delete driver with spoofed userRole:', deleteDrvSpoofed.status, deleteDrvSpoofed.status === 403 ? 'REJECTED (SECURE)' : 'UNAUTHORIZED SUCCESS (VULNERABLE)');
  assert.strictEqual(deleteDrvSpoofed.status, 403, 'Spoofed userRole on delete driver must be 403');

  // 3e. Authorized Admin operation WITH valid admin PIN -> MUST SUCCEED (200)
  const authCreateDisp = await request('POST', '/api/dispatchers/create', {
    name: 'Legit Dispatcher Admin Created',
    email: 'legit_admin_created@test.com',
    role: 'dispatcher'
  }, { 'x-admin-pin': '8483' });
  assert.strictEqual(authCreateDisp.status, 200, 'Legitimate Admin with PIN can create dispatcher');
  console.log('✓ Legitimate Admin with valid PIN successfully authorized (200 OK)');

  // -------------------------------------------------------------
  // TEST 4: Owner Multi-Company Isolation
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Owner Multi-Company Isolation ---');
  // Create Owner A for Company Alpha
  console.log('Sending request to /api/owner/accounts...');
  const newOwnerCode = 'OWNER-ALPHA-' + Date.now();
  try {
    const createOwnerA = await request('POST', '/api/owner/accounts', {
      ownerCode: newOwnerCode,
      pin: '7777',
      name: 'Owner Alpha',
      companyId: compAId
    }, { 'x-admin-pin': '8483' });
    console.log('Owner A create response:', createOwnerA.status, createOwnerA.body.ok ? 'Created' : createOwnerA.body.error);
  } catch (err) {
    console.error('Error on createOwnerA:', err);
    throw err;
  }

  // Owner A login
  const ownerALogin = await request('POST', '/api/driver/login', {
    driverId: newOwnerCode,
    pin: '7777'
  });
  assert.strictEqual(ownerALogin.status, 200, 'Owner A should log in');
  const ownerAToken = ownerALogin.body.token;

  // Owner A fetches financial summary
  const ownerASummary = await request('GET', '/api/owner/summary', null, {
    Authorization: `Bearer ${ownerAToken}`
  });
  assert.strictEqual(ownerASummary.status, 200, 'Owner A summary succeeded');
  console.log('Owner A Summary companyId:', ownerASummary.body.summary?.companyId || compAId);

  // Owner A attempts to access Company B loads
  const ownerALoads = await request('GET', '/api/owner/loads', null, {
    Authorization: `Bearer ${ownerAToken}`
  });
  assert.strictEqual(ownerALoads.status, 200);
  const visibleLoadsToOwnerA = ownerALoads.body.loads || [];
  const sawCompBLoad = visibleLoadsToOwnerA.some(l => l.companyId === compBId || l.id === loadB.id);
  assert(!sawCompBLoad, 'Owner A MUST NOT see Company B loads');
  console.log('✓ Owner A strictly isolated to Company Alpha loads only');

  console.log('\n=== Permissions & Role Isolation Audit Completed ===\n');
}

run().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
