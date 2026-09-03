// tests/test_companies_isolation.js
// Comprehensive Multi-Tenant Data Isolation & Company Scoping Test Suite (Phases 7 & 8)

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('    HAULBOX MULTI-TENANT COMPANIES & DATA ISOLATION TESTS       ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err.message}`);
        failed++;
      }
    };
  }

  const ADMIN_HEADERS = { 'x-admin-pin': '8483' };
  const uid = Date.now();
  const compA_Id = `COMP-A-${uid}`;
  const compB_Id = `COMP-B-${uid}`;
  const ownerA_Code = `OWNA${uid.toString().slice(-4)}`;
  const ownerB_Code = `OWNB${uid.toString().slice(-4)}`;
  const pinA = '4411';
  const pinB = '5522';

  let tokenOwnerA = null;
  let tokenOwnerB = null;
  const loadA_Id = `LD-A-${uid}`;
  const loadB_Id = `LD-B-${uid}`;
  const driverA_Id = `DRV-A-${uid}`;
  const driverB_Id = `DRV-B-${uid}`;
  const driverA_Code = `DA${uid.toString().slice(-4)}`;
  const driverB_Code = `DB${uid.toString().slice(-4)}`;

  // 1. Provision Company Alpha
  await test('Admin provisions Company Alpha with linked Owner', async () => {
    const res = await request('POST', '/api/companies', {
      id: compA_Id,
      name: `Alpha Freight Systems LLC ${uid}`,
      phone: '(555) 011-1111',
      email: 'ops@alphafreight.com',
      ownerName: 'Alexander Vance',
      ownerCode: ownerA_Code,
      pin: pinA
    }, ADMIN_HEADERS);

    assert.ok(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.company.id, compA_Id);
    assert.strictEqual(res.body.owner.ownerCode, ownerA_Code);
  })();

  // 2. Provision Company Bravo
  await test('Admin provisions Company Bravo with linked Owner', async () => {
    const res = await request('POST', '/api/companies', {
      id: compB_Id,
      name: `Bravo Hauling Corp ${uid}`,
      phone: '(555) 022-2222',
      email: 'dispatch@bravohaul.com',
      ownerName: 'Beatrice Miller',
      ownerCode: ownerB_Code,
      pin: pinB
    }, ADMIN_HEADERS);

    assert.ok(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.company.id, compB_Id);
    assert.strictEqual(res.body.owner.ownerCode, ownerB_Code);
  })();

  // 3. Admin Lists Companies
  await test('Admin GET /api/companies returns all fleets including Alpha and Bravo', async () => {
    const res = await request('GET', '/api/companies', null, ADMIN_HEADERS);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const comps = res.body.companies;
    const a = comps.find(c => c.id === compA_Id);
    const b = comps.find(c => c.id === compB_Id);
    assert.ok(a, 'Company Alpha must be in list');
    assert.ok(b, 'Company Bravo must be in list');
    assert.strictEqual(a.owner.ownerCode, ownerA_Code);
    assert.strictEqual(b.owner.ownerCode, ownerB_Code);
  })();

  // 4. Authenticate Owner Alpha & Bravo
  await test('Owner Alpha authenticates and receives company-scoped session token', async () => {
    const res = await request('POST', '/api/driver/login', {
      driverId: ownerA_Code,
      pin: pinA
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.role, 'OWNER');
    assert.strictEqual(res.body.owner.companyId, compA_Id);
    assert.ok(res.body.token, 'Token must be issued');
    tokenOwnerA = res.body.token;
  })();

  await test('Owner Bravo authenticates and receives company-scoped session token', async () => {
    const res = await request('POST', '/api/driver/login', {
      driverId: ownerB_Code,
      pin: pinB
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.role, 'OWNER');
    assert.strictEqual(res.body.owner.companyId, compB_Id);
    assert.ok(res.body.token, 'Token must be issued');
    tokenOwnerB = res.body.token;
  })();

  // 5. Seed Drivers and Loads via Server State Storage
  await test('Seed drivers and loads scoped to Company Alpha and Bravo', async () => {
    const stateGet = await request('GET', '/api/storage?key=haulline:state');
    let state = (stateGet.status === 200 && stateGet.body && stateGet.body.value) ? JSON.parse(stateGet.body.value) : null;
    if (!state) state = { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };

    state.drivers = state.drivers || [];
    state.loads = state.loads || [];

    // Company A Driver and Load
    state.drivers.push({
      id: driverA_Id,
      name: 'Driver Alpha 1',
      companyId: compA_Id,
      company: `Alpha Freight Systems LLC ${uid}`,
      driverCode: driverA_Code,
      pin: '1234',
      active: true
    });

    state.loads.push({
      id: loadA_Id,
      loadNumber: `LD-ALPHA-${uid.toString().slice(-4)}`,
      systemDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date().toISOString().slice(0, 10),
      driverId: driverA_Id,
      driverName: 'Driver Alpha 1',
      companyId: compA_Id,
      brokerRate: 4500,
      rate: 4500,
      driverPay: 3600,
      driverPayPct: 80,
      status: 'Delivered',
      driverProgress: 'DELIVERED',
      paymentStatus: 'READY_TO_PAY',
      driverPaid: false
    });

    // Company B Driver and Load
    state.drivers.push({
      id: driverB_Id,
      name: 'Driver Bravo 1',
      companyId: compB_Id,
      company: `Bravo Hauling Corp ${uid}`,
      driverCode: driverB_Code,
      pin: '5678',
      active: true
    });

    state.loads.push({
      id: loadB_Id,
      loadNumber: `LD-BRAVO-${uid.toString().slice(-4)}`,
      systemDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date().toISOString().slice(0, 10),
      driverId: driverB_Id,
      driverName: 'Driver Bravo 1',
      companyId: compB_Id,
      brokerRate: 6000,
      rate: 6000,
      driverPay: 4800,
      driverPayPct: 80,
      status: 'Delivered',
      driverProgress: 'DELIVERED',
      paymentStatus: 'READY_TO_PAY',
      driverPaid: false
    });

    const saveRes = await request('POST', '/api/storage', {
      key: 'haulline:state',
      value: JSON.stringify(state)
    });
    assert.strictEqual(saveRes.status, 200);
  })();

  // 6. Verify Owner Alpha Cross-Tenant Scoping (GET /api/owner/summary)
  await test('Owner Alpha GET /api/owner/summary reflects ONLY Company Alpha financials', async () => {
    const res = await request('GET', '/api/owner/summary?period=all', null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.grossRevenue, 4500, 'Gross revenue must equal $4,500 (Alpha only)');
    assert.strictEqual(res.body.driverPay, 3600, 'Driver pay must equal $3,600 (Alpha only)');
    assert.strictEqual(res.body.estimatedProfit, 900, 'Estimated profit must equal $900 (Alpha only)');
    assert.strictEqual(res.body.totalDrivers, 1, 'Total drivers must be 1 (Alpha only)');
  })();

  // 7. Verify Owner Bravo Cross-Tenant Scoping (GET /api/owner/summary)
  await test('Owner Bravo GET /api/owner/summary reflects ONLY Company Bravo financials', async () => {
    const res = await request('GET', '/api/owner/summary?period=all', null, {
      Authorization: `Bearer ${tokenOwnerB}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.grossRevenue, 6000, 'Gross revenue must equal $6,000 (Bravo only)');
    assert.strictEqual(res.body.driverPay, 4800, 'Driver pay must equal $4,800 (Bravo only)');
    assert.strictEqual(res.body.estimatedProfit, 1200, 'Estimated profit must equal $1,200 (Bravo only)');
    assert.strictEqual(res.body.totalDrivers, 1, 'Total drivers must be 1 (Bravo only)');
  })();

  // 8. Verify Owner Alpha GET /api/owner/loads returns ONLY Alpha loads
  await test('Owner Alpha GET /api/owner/loads returns ONLY Company Alpha loads', async () => {
    const res = await request('GET', '/api/owner/loads', null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const loads = res.body.loads;
    assert.strictEqual(loads.length, 1);
    assert.strictEqual(loads[0].id, loadA_Id);
    assert.strictEqual(loads[0].rate, 4500);

    // Cross-tenant verification: Bravo load must NOT be in the response
    const hasBravo = loads.some(l => l.id === loadB_Id);
    assert.strictEqual(hasBravo, false, 'Security violation: Bravo load found in Alpha owner response!');
  })();

  // 9. Tamper Proofing: Owner Alpha passes ?companyId=COMP-BRAVO query param
  await test('Security: Owner Alpha cannot override companyId via query parameter', async () => {
    const res = await request('GET', `/api/owner/summary?companyId=${compB_Id}`, null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    // MUST still return Alpha financials ($4,500), NOT Bravo ($6,000)
    assert.strictEqual(res.body.grossRevenue, 4500, 'Security failure: client overrode companyId via query string!');
  })();

  // 10. Cross-Tenant Mutation Tamper: Owner Alpha attempts to mark payment on Bravo Load
  await test('Security: Owner Alpha blocked (403 Forbidden) from modifying Bravo Load payments', async () => {
    const res = await request('POST', '/api/owner/payments/mark-paid', {
      loadId: loadB_Id,
      type: 'DRIVER_PAY',
      amount: 4800
    }, {
      Authorization: `Bearer ${tokenOwnerA}`
    });

    assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
    assert.strictEqual(res.body.ok, false);
    assert.ok(res.body.error.includes('authorized') || res.body.error.includes('denied'), 'Error must specify access violation');
  })();

  // 11. Soft-Disable / Status Toggle: Admin deactivates Company Alpha
  await test('Admin deactivates Company Alpha; verifies immediate login gating', async () => {
    const toggleRes = await request('POST', `/api/companies/${compA_Id}/toggle-status`, {
      status: 'disabled'
    }, ADMIN_HEADERS);

    assert.strictEqual(toggleRes.status, 200);
    assert.strictEqual(toggleRes.body.ok, true);
    assert.strictEqual(toggleRes.body.company.status, 'disabled');

    // Attempt Driver Alpha login -> MUST FAIL 401
    const drvLogin = await request('POST', '/api/driver/login', {
      driverId: driverA_Code,
      pin: '1234'
    });
    assert.strictEqual(drvLogin.status, 401);
    assert.strictEqual(drvLogin.body.ok, false);
    assert.ok(drvLogin.body.error.includes('deactivated') || drvLogin.body.error.includes('disabled'));

    // Attempt Owner Alpha login -> MUST FAIL 401
    const ownLogin = await request('POST', '/api/driver/login', {
      driverId: ownerA_Code,
      pin: pinA
    });
    assert.strictEqual(ownLogin.status, 401);
    assert.strictEqual(ownLogin.body.ok, false);
    assert.ok(ownLogin.body.error.includes('deactivated') || ownLogin.body.error.includes('disabled'));

    // Attempt Owner Alpha API call with existing Bearer token -> MUST FAIL 403
    const apiCall = await request('GET', '/api/owner/summary', null, {
      Authorization: `Bearer ${tokenOwnerA}`
    });
    assert.strictEqual(apiCall.status, 403);
    assert.strictEqual(apiCall.body.ok, false);
    assert.ok(apiCall.body.error.includes('deactivated') || apiCall.body.error.includes('disabled'));

    // Ensure Company Bravo is completely unaffected!
    const bravoApiCall = await request('GET', '/api/owner/summary', null, {
      Authorization: `Bearer ${tokenOwnerB}`
    });
    assert.strictEqual(bravoApiCall.status, 200);
    assert.strictEqual(bravoApiCall.body.ok, true);
    assert.strictEqual(bravoApiCall.body.grossRevenue, 6000);
  })();

  // 12. Reactivate Company Alpha
  await test('Admin reactivates Company Alpha; login and endpoint access restored', async () => {
    const toggleRes = await request('POST', `/api/companies/${compA_Id}/toggle-status`, {
      status: 'active'
    }, ADMIN_HEADERS);

    assert.strictEqual(toggleRes.status, 200);
    assert.strictEqual(toggleRes.body.ok, true);
    assert.strictEqual(toggleRes.body.company.status, 'active');

    // Owner Alpha login works again
    const ownLogin = await request('POST', '/api/driver/login', {
      driverId: ownerA_Code,
      pin: pinA
    });
    assert.strictEqual(ownLogin.status, 200);
    assert.strictEqual(ownLogin.body.ok, true);
  })();

  console.log('\n===============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
