// tests/test_owner_backend.js
// Complete automated test suite for Owner Backend & Financial State Machine (Phases 3-5)

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
  console.log('====================================================');
  console.log('   OWNER BACKEND & FINANCIAL STATE MACHINE TESTS    ');
  console.log('====================================================\n');

  let ownerToken = null;
  let driverToken = null;
  let sampleLoads = [];

  // -------------------------------------------------------------------------
  // Test 1: Owner Authentication
  // -------------------------------------------------------------------------
  console.log('🧪 Test 1: Testing Owner Authentication & Session Generation...');
  {
    // Create owner account via Admin API
    const createRes = await request('POST', '/api/owner/accounts', {
      ownerCode: 'OWNER01',
      pin: '1234',
      name: 'HaulBoX Test Owner',
      phone: '555-0199',
      email: 'owner@haulbox.com'
    }, {
      'x-admin-pin': '123456'
    });
    assert.strictEqual(createRes.status, 200, 'Admin creating owner account must succeed');

    // Invalid PIN
    const failRes = await request('POST', '/api/driver/login', { driverId: 'OWNER01', pin: '0000' });
    assert.strictEqual(failRes.status, 401, 'Should reject invalid owner PIN');

    // Valid Owner Login
    const loginRes = await request('POST', '/api/driver/login', { driverId: 'OWNER01', pin: '1234' });
    assert.strictEqual(loginRes.status, 200, 'Owner login should succeed with 200');
    assert.strictEqual(loginRes.body.ok, true, 'Response ok should be true');
    assert.strictEqual(loginRes.body.role, 'OWNER', 'Role must be OWNER');
    assert.ok(loginRes.body.token, 'Must return session token');
    assert.ok(loginRes.body.owner, 'Must return owner profile');
    assert.strictEqual(loginRes.body.owner.ownerCode, 'OWNER01', 'Owner code must match');

    ownerToken = loginRes.body.token;
    console.log(`  ✓ Owner login succeeded (Role: ${loginRes.body.role}, Code: ${loginRes.body.owner.ownerCode})`);
  }

  // -------------------------------------------------------------------------
  // Test 2: Driver Authentication & Compatibility Check
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 2: Testing Driver Authentication & Role Tagging...');
  {
    // Register a sample driver in state if needed
    const dataStore = require('../lib/dataStore');
    const db = require('../lib/db');
    await db.ensureSchema();

    const stateGet = await request('GET', '/api/storage?key=haulline:state');
    let state = (stateGet.status === 200 && stateGet.body && stateGet.body.value) ? JSON.parse(stateGet.body.value) : null;
    if (!state) state = { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };
    state.drivers = state.drivers || [];
    let testDriver = {
      id: 'DRV-OWN-TEST',
      driverCode: 'D909',
      name: 'Carlos Mendez',
      phone: '555-0188',
      pin: '9999',
      pinHash: dataStore.hashPin('9999'),
      truck: 'HL-202',
      active: true
    };
    state.drivers = state.drivers.filter(d => d.id !== 'DRV-OWN-TEST');
    state.drivers.push(testDriver);

    // Seed test loads representing all 5 payment states
    state.loads = [
      {
        id: 'LOAD-STATE-1',
        loadNumber: 'HB-8001',
        brokerName: 'C.H. Robinson',
        driverId: 'DRV-OWN-TEST',
        pickupCity: 'Dallas',
        pickupState: 'TX',
        deliveryCity: 'Atlanta',
        deliveryState: 'GA',
        status: 'Delivered',
        driverProgress: 'DELIVERED',
        rate: 2500,
        driverPay: 2000,
        driverPaid: false,
        paymentStatus: 'READY_TO_PAY',
        createdAt: new Date().toISOString(),
        deliveryDate: new Date().toISOString()
      },
      {
        id: 'LOAD-STATE-2',
        loadNumber: 'HB-8002',
        brokerName: 'TQL Logistics',
        driverId: 'DRV-OWN-TEST',
        pickupCity: 'Chicago',
        pickupState: 'IL',
        deliveryCity: 'Detroit',
        deliveryState: 'MI',
        status: 'In Transit',
        driverProgress: 'IN_TRANSIT',
        rate: 1800,
        driverPay: 1400,
        driverPaid: false,
        paymentStatus: 'UNPAID',
        createdAt: new Date().toISOString()
      },
      {
        id: 'LOAD-STATE-3',
        loadNumber: 'HB-8003',
        brokerName: 'Echo Global',
        driverId: 'DRV-OWN-TEST',
        pickupCity: 'Houston',
        pickupState: 'TX',
        deliveryCity: 'Dallas',
        deliveryState: 'TX',
        status: 'Delivered',
        driverProgress: 'DELIVERED',
        rate: 1200,
        driverPay: 950,
        driverPaid: true,
        driverPaidDate: new Date().toISOString().slice(0, 10),
        markedPaidAt: new Date().toISOString(),
        markedPaidBy: 'Owner',
        paymentStatus: 'PAID',
        createdAt: new Date().toISOString(),
        deliveryDate: new Date().toISOString()
      },
      {
        id: 'LOAD-STATE-4',
        loadNumber: 'HB-8004',
        brokerName: 'Landstar',
        driverId: 'DRV-OWN-TEST',
        pickupCity: 'Memphis',
        pickupState: 'TN',
        deliveryCity: 'Nashville',
        deliveryState: 'TN',
        status: 'Delivered',
        driverProgress: 'DELIVERED',
        rate: 1500,
        driverPay: 1200,
        driverPaid: true,
        driverPayAccepted: true,
        paymentStatus: 'PAID_CONFIRMED',
        createdAt: new Date().toISOString(),
        deliveryDate: new Date().toISOString()
      },
      {
        id: 'LOAD-STATE-5',
        loadNumber: 'HB-8005',
        brokerName: 'Coyote Logistics',
        driverId: 'DRV-OWN-TEST',
        pickupCity: 'Denver',
        pickupState: 'CO',
        deliveryCity: 'Salt Lake City',
        deliveryState: 'UT',
        status: 'Delivered',
        driverProgress: 'DELIVERED',
        rate: 2200,
        driverPay: 1750,
        driverPaid: false,
        paymentStatus: 'PAYMENT_DISPUTED',
        isDisputed: true,
        createdAt: new Date().toISOString(),
        deliveryDate: new Date().toISOString()
      }
    ];

    await request('POST', '/api/storage', {
      key: 'haulline:state',
      value: JSON.stringify(state)
    });

    const driverLogin = await request('POST', '/api/driver/login', { driverId: 'D909', pin: '9999' });
    assert.strictEqual(driverLogin.status, 200, 'Driver login should succeed');
    assert.strictEqual(driverLogin.body.role, 'DRIVER', 'Driver role must be DRIVER');
    assert.ok(driverLogin.body.token, 'Driver must receive session token');
    driverToken = driverLogin.body.token;
    console.log(`  ✓ Driver login succeeded (Role: ${driverLogin.body.role}, Name: ${driverLogin.body.driver.name})`);
  }

  // -------------------------------------------------------------------------
  // Test 3: Security & Authorization Enforcements
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 3: Security & Role Authorization Enforcements...');
  {
    // Unauthenticated
    const unauth = await request('GET', '/api/owner/summary');
    assert.strictEqual(unauth.status, 401, 'Unauthenticated request must be rejected with 401');
    console.log('  ✓ Unauthenticated call correctly rejected (HTTP 401)');

    // Driver attempting to call Owner endpoint
    const forbidden = await request('GET', '/api/owner/summary', null, {
      Authorization: `Bearer ${driverToken}`
    });
    assert.strictEqual(forbidden.status, 403, 'Driver token calling Owner endpoint must be rejected with 403 Forbidden');
    console.log('  ✓ Driver token calling Owner API correctly rejected (HTTP 403 Forbidden)');

    // Owner calling Owner endpoint
    const authorized = await request('GET', '/api/owner/summary', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(authorized.status, 200, 'Owner token calling Owner endpoint must succeed with 200');
    console.log('  ✓ Owner token successfully authenticated (HTTP 200)');
  }

  // -------------------------------------------------------------------------
  // Test 4: Financial Calculations & 5-State Payment Mapping
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 4: Financial Calculations & 5-State Payment Mapping...');
  {
    const summary = await request('GET', '/api/owner/summary', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(summary.status, 200);
    const s = summary.body;

    // Total gross: 2500 + 1800 + 1200 + 1500 + 2200 = 9200
    // Total pay: 2000 + 1400 + 950 + 1200 + 1750 = 7300
    // Profit: 9200 - 7300 = 1900
    assert.strictEqual(s.grossRevenue, 9200, 'Gross revenue must equal sum of load rates');
    assert.strictEqual(s.driverPay, 7300, 'Driver pay must equal sum of driver pays');
    assert.strictEqual(s.estimatedProfit, 1900, 'Estimated profit must equal Gross - Driver Pay');

    // Payment State Isolation Check:
    // Ready to Pay: LOAD-STATE-1 (2000)
    assert.strictEqual(s.paymentSummary.readyToPayAmount, 2000, 'Ready to Pay should be $2000');
    assert.strictEqual(s.paymentSummary.readyToPayCount, 1);

    // Paid (PAID + PAID_CONFIRMED): LOAD-STATE-3 (950) + LOAD-STATE-4 (1200) = 2150
    assert.strictEqual(s.paymentSummary.paidAmount, 2150, 'Paid should include PAID and PAID_CONFIRMED ($2150)');
    assert.strictEqual(s.paymentSummary.paidCount, 2);

    // Unpaid (in-transit): LOAD-STATE-2 (1400)
    assert.strictEqual(s.paymentSummary.unpaidAmount, 1400, 'Unpaid should be routine pending load ($1400)');
    assert.strictEqual(s.paymentSummary.unpaidCount, 1);

    // Disputed (isolated, NOT folded into unpaid or paid): LOAD-STATE-5 (1750)
    assert.strictEqual(s.paymentSummary.disputedAmount, 1750, 'Disputed must be isolated separately ($1750)');
    assert.strictEqual(s.paymentSummary.disputedCount, 1);

    console.log('  ✓ Gross Revenue ($9,200) - Driver Pay ($7,300) = Estimated Profit ($1,900) verified');
    console.log('  ✓ Ready to Pay: $2,000 (1 load)');
    console.log('  ✓ Paid (including PAID_CONFIRMED): $2,150 (2 loads)');
    console.log('  ✓ Unpaid (in-transit): $1,400 (1 load)');
    console.log('  ✓ Disputed (isolated): $1,750 (1 load)');
  }

  // -------------------------------------------------------------------------
  // Test 5: "Mark as Paid" State Machine Enforcements
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 5: "Mark as Paid" Action State Machine Validation...');
  {
    // Case 1: Reject on UNPAID (still in transit)
    const resUnpaid = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-STATE-2' }, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(resUnpaid.status, 400, 'Must reject mark-paid on in-transit unpaid load');
    console.log('  ✓ In-transit UNPAID load correctly blocked from payment (HTTP 400)');

    // Case 2: Reject on PAYMENT_DISPUTED
    const resDispute = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-STATE-5' }, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(resDispute.status, 400, 'Must reject mark-paid on disputed load');
    console.log('  ✓ Disputed load correctly blocked from payment (HTTP 400)');

    // Case 3: Reject duplicate payment on already PAID or PAID_CONFIRMED
    const resAlreadyPaid = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-STATE-4' }, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(resAlreadyPaid.status, 409, 'Must reject duplicate mark-paid on already paid load');
    console.log('  ✓ Already PAID_CONFIRMED load correctly blocked from duplicate payment (HTTP 409)');

    // Case 4: Succeeded on READY_TO_PAY load
    const resSuccess = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-STATE-1' }, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(resSuccess.status, 200, 'Mark-paid on READY_TO_PAY load must succeed');
    assert.strictEqual(resSuccess.body.ok, true);
    assert.strictEqual(resSuccess.body.load.driverPaid, true);
    assert.strictEqual(resSuccess.body.load.paymentStatus, 'PAID');
    assert.ok(resSuccess.body.load.markedPaidAt);
    console.log(`  ✓ Successfully marked load #HB-8001 as PAID ($2,000)`);

    // Case 5: Attempting again now must fail with 409
    const resDuplicateNow = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-STATE-1' }, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(resDuplicateNow.status, 409, 'Second attempt must be rejected as duplicate');
    console.log('  ✓ Immediate repeat attempt correctly rejected as duplicate (HTTP 409)');
  }

  // -------------------------------------------------------------------------
  // Test 6: Owner Loads & Payments Endpoints
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 6: Testing Owner Loads & Payments Query Endpoints...');
  {
    // Loads list
    const loadsRes = await request('GET', '/api/owner/loads?status=ALL', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(loadsRes.status, 200);
    assert.strictEqual(loadsRes.body.total, 5, 'Should return all 5 loads');

    // Search filter
    const searchRes = await request('GET', '/api/owner/loads?search=C.H.%20Robinson', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.total, 1);
    console.log('  ✓ Owner Loads list & search filter working');

    // Payments endpoint
    const paymentsRes = await request('GET', '/api/owner/payments', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(paymentsRes.status, 200);
    assert.ok(paymentsRes.body.drivers.length > 0, 'Must return driver summaries');
    const drv = paymentsRes.body.drivers.find(d => d.driverId === 'DRV-OWN-TEST');
    assert.ok(drv, 'Test driver must be in payments response');
    assert.strictEqual(drv.hasDisputed, true, 'Test driver must be flagged with hasDisputed: true');
    console.log('  ✓ Owner Payments per-driver summary working with disputed flag');
  }

  // -------------------------------------------------------------------------
  // Test 7: Reports & Analytics Endpoints
  // -------------------------------------------------------------------------
  console.log('\n🧪 Test 7: Testing Reports & Analytics Endpoints...');
  {
    const reportsRes = await request('GET', '/api/owner/reports?period=this_month', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(reportsRes.status, 200);
    assert.ok(reportsRes.body.financialSummary.grossRevenue > 0);
    assert.ok(reportsRes.body.perDriverBreakdown.length > 0);
    console.log('  ✓ Owner Reports aggregated breakdown working');

    const analyticsRes = await request('GET', '/api/owner/analytics?range=30d', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.strictEqual(analyticsRes.status, 200);
    assert.ok(Array.isArray(analyticsRes.body.timeSeries));
    assert.ok(analyticsRes.body.businessAverages.revenuePerLoad > 0);
    assert.ok(analyticsRes.body.forecast !== undefined);
    console.log('  ✓ Owner Analytics time-series and forecast working');
  }

  console.log('\n====================================================');
  console.log('   ✅ ALL OWNER BACKEND TESTS PASSED (100%)         ');
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
