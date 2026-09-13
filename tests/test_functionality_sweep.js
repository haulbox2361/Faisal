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

async function runSweep() {
  console.log('=== Starting Section 6: General Functionality Sweep ===\n');

  // Ensure test driver fixture in state
  const stateRes = await request('GET', '/api/storage/haulline:state');
  let state = {};
  if (stateRes.status === 200 && stateRes.body.value) {
    state = typeof stateRes.body.value === 'string' ? JSON.parse(stateRes.body.value) : stateRes.body.value;
  }
  state.drivers = state.drivers || [];
  let testDriver = state.drivers.find(d => d.driverCode === 'SWEEP_D1');
  if (!testDriver) {
    testDriver = {
      id: 'drv_sweep_1',
      name: 'Sweep Test Driver',
      driverCode: 'SWEEP_D1',
      pin: '1234',
      active: true,
      dispatcherId: 'disp_1',
      companyId: 'COMP-LEGACY'
    };
    state.drivers.push(testDriver);
    await request('POST', '/api/storage', {
      key: 'haulline:state',
      value: JSON.stringify(state)
    });
  }

  // 1. Driver GPS / Live Tracking
  console.log('--- 1. Testing Driver GPS / Live Tracking ---');
  // Login a driver to record GPS
  const drvLogin = await request('POST', '/api/driver/login', { driverId: 'SWEEP_D1', pin: '1234' });
  assert.strictEqual(drvLogin.status, 200);
  const drvToken = drvLogin.body.token;

  const locRes = await request('POST', '/api/driver/location', {
    lat: 41.8781,
    lng: -87.6298,
    speed: 55.4,
    heading: 180,
    accuracy: 5.0
  }, { Authorization: `Bearer ${drvToken}` });
  assert.strictEqual(locRes.status, 200, 'Driver GPS record must return 200');
  console.log('✓ Driver GPS coordinates (41.8781, -87.6298) recorded successfully');

  // Verify tracking live and tracking summary
  const liveRes = await request('GET', '/api/tracking/live');
  assert.strictEqual(liveRes.status, 200);
  const summaryRes = await request('GET', '/api/tracking/summary');
  assert.strictEqual(summaryRes.status, 200);
  console.log('✓ Live tracking and tracking summary active with driver positions');

  // 2. Broker Management & MC Lookup
  console.log('\n--- 2. Testing Broker Management & MC Lookup ---');
  const mcRes = await request('GET', '/api/mc-lookup?mc=123456');
  assert.strictEqual(mcRes.status, 200);
  console.log('✓ FMCSA MC Lookup endpoint responsive (status: 200)');

  // 3. Document Upload & Review Queue
  console.log('\n--- 3. Testing Document Review Queue ---');
  const reviewQueueRes = await request('GET', '/api/documents/review-queue', null, { 'x-admin-pin': '8483' });
  assert.strictEqual(reviewQueueRes.status, 200);
  console.log('✓ Document Review Queue retrieved (status: 200, items:', (reviewQueueRes.body.issues || []).length, ')');

  // 4. Daily Notes
  console.log('\n--- 4. Testing Daily Notes ---');
  const todayStr = new Date().toISOString().slice(0, 10);
  const saveNoteRes = await request('POST', '/api/daily-notes', {
    date: todayStr,
    dispatcherId: 'disp_perf_1',
    driverId: 'drv_perf_1',
    driverName: 'Driver 1 Armstrong',
    note: 'Driver completed morning inspection. Clean pre-trip.',
    status: 'submitted'
  });
  assert.strictEqual(saveNoteRes.status, 200, 'Daily note creation must return 200');
  console.log('✓ Daily driver note submitted successfully');

  const getNotesRes = await request('GET', `/api/daily-notes?date=${todayStr}&dispatcherId=disp_perf_1`);
  assert.strictEqual(getNotesRes.status, 200);
  const notes = getNotesRes.body.notes || [];
  assert(notes.length > 0, 'Saved daily note must be retrieved');
  assert.strictEqual(notes[0].note, 'Driver completed morning inspection. Clean pre-trip.');
  console.log('✓ Daily driver note verified and retrieved');

  // 5. Settings & Config
  console.log('\n--- 5. Testing Settings & Config ---');
  const configRes = await request('GET', '/api/config');
  assert.strictEqual(configRes.status, 200);
  console.log('✓ System config active (admin email:', configRes.body.adminEmail || 'configured', ')');

  // 6. Multi-Tenant Companies API
  console.log('\n--- 6. Testing Multi-Tenant Companies API ---');
  const companiesRes = await request('GET', '/api/companies', null, { 'x-admin-pin': '8483' });
  assert.strictEqual(companiesRes.status, 200);
  const companies = companiesRes.body.companies || [];
  assert(companies.length > 0, 'Companies list retrieved');
  console.log(`✓ Companies endpoint active (${companies.length} companies configured)`);

  console.log('\n=== Section 6: General Functionality Sweep PASSED 100% ===\n');
}

runSweep().catch(err => {
  console.error('✗ Functionality sweep failed:', err);
  process.exit(1);
});
