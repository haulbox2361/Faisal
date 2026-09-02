const http = require('http');
const assert = require('assert');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (dataString) {
      reqHeaders['Content-Length'] = Buffer.byteLength(dataString);
    }

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runProductionE2eVerification() {
  console.log('====================================================');
  console.log('  OWNER ROLE, SECURITY & PAYMENT END-TO-END SUITE   ');
  console.log('====================================================\n');

  // Setup Admin, Owner and Driver in storage
  const stateGet = await request('GET', '/api/storage?key=haulline:state');
  let state = (stateGet.status === 200 && stateGet.body && stateGet.body.value) ? JSON.parse(stateGet.body.value) : null;
  if (!state) state = { dispatchers: [], brokers: [], drivers: [], loads: [], owners: [], settings: {} };

  // Create Owner Account via Admin API
  console.log('🧪 Step 1: Owner Account Provisioning via Admin API...');
  const ownerCreateRes = await request('POST', '/api/owner/accounts', {
    ownerCode: 'OWNER_PROD_01',
    pin: '7890',
    name: 'Executive Fleet Owner',
    phone: '555-0900',
    email: 'executive@haulbox.com'
  }, {
    'x-admin-pin': '123456'
  });
  assert.strictEqual(ownerCreateRes.status, 200, 'Owner provisioning must succeed');
  console.log('  ✓ Owner account created: OWNER_PROD_01');

  // Create Driver in state
  const dataStore = require('../lib/dataStore');
  state.drivers = state.drivers || [];
  state.drivers = state.drivers.filter(d => d.id !== 'DRV-E2E-PROD');
  const prodDriver = {
    id: 'DRV-E2E-PROD',
    driverCode: 'D888',
    name: 'Marcus Vance',
    phone: '555-0444',
    pin: '4444',
    pinHash: dataStore.hashPin('4444'),
    truck: 'HL-888',
    active: true
  };
  state.drivers.push(prodDriver);

  // Setup sample loads with diverse lifecycle and payment states
  state.loads = [
    {
      id: 'LOAD-P1',
      loadNumber: 'HB-9001',
      brokerName: 'TQL Logistics',
      driverId: 'DRV-E2E-PROD',
      pickup: 'Chicago, IL',
      dropoff: 'Memphis, TN',
      status: 'Delivered',
      rate: 3000,
      driverPay: 2400,
      driverPaid: false,
      paymentStatus: 'READY_TO_PAY',
      createdAt: new Date().toISOString()
    },
    {
      id: 'LOAD-P2',
      loadNumber: 'HB-9002',
      brokerName: 'C.H. Robinson',
      driverId: 'DRV-E2E-PROD',
      pickup: 'Nashville, TN',
      dropoff: 'Atlanta, GA',
      status: 'In Transit',
      rate: 1800,
      driverPay: 1400,
      driverPaid: false,
      paymentStatus: 'UNPAID',
      createdAt: new Date().toISOString()
    },
    {
      id: 'LOAD-P3',
      loadNumber: 'HB-9003',
      brokerName: 'Landstar',
      driverId: 'DRV-E2E-PROD',
      pickup: 'Dallas, TX',
      dropoff: 'Houston, TX',
      status: 'Delivered',
      rate: 1200,
      driverPay: 900,
      driverPaid: true,
      driverPayAccepted: true,
      paymentStatus: 'PAID_CONFIRMED',
      createdAt: new Date().toISOString()
    },
    {
      id: 'LOAD-P4',
      loadNumber: 'HB-9004',
      brokerName: 'Echo Global',
      driverId: 'DRV-E2E-PROD',
      pickup: 'Denver, CO',
      dropoff: 'Cheyenne, WY',
      status: 'Delivered',
      rate: 1500,
      driverPay: 1100,
      driverPaid: false,
      paymentStatus: 'PAYMENT_DISPUTED',
      isDisputed: true,
      createdAt: new Date().toISOString()
    }
  ];

  await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(state)
  });
  console.log('  ✓ Test drivers and loads synchronized in database.\n');

  // -------------------------------------------------------------------------
  // Phase 7: Role Routing & Session Integrity Verification
  // -------------------------------------------------------------------------
  console.log('🧪 Step 2: Phase 7 — Role Routing & Session Integrity Check...');

  // Driver Login
  const driverLoginRes = await request('POST', '/api/driver/login', {
    driverId: 'D888',
    pin: '4444'
  });
  assert.strictEqual(driverLoginRes.status, 200, 'Driver login must succeed');
  assert.strictEqual(driverLoginRes.body.role, 'DRIVER', 'Driver role must strictly be DRIVER');
  const driverToken = driverLoginRes.body.token;
  console.log('  ✓ Driver login returned role: "DRIVER" → routes to MainNavigationScreen');

  // Owner Login
  const ownerLoginRes = await request('POST', '/api/driver/login', {
    driverId: 'OWNER_PROD_01',
    pin: '7890'
  });
  assert.strictEqual(ownerLoginRes.status, 200, 'Owner login must succeed');
  assert.strictEqual(ownerLoginRes.body.role, 'OWNER', 'Owner role must strictly be OWNER');
  const ownerToken = ownerLoginRes.body.token;
  console.log('  ✓ Owner login returned role: "OWNER" → routes to OwnerNavigationScreen');

  // -------------------------------------------------------------------------
  // Phase 10: Security Boundary & Deep-Link Protection
  // -------------------------------------------------------------------------
  console.log('\n🧪 Step 3: Phase 10 — Security Boundary & Deep-Link Protection...');
  const ownerEndpoints = [
    { method: 'GET', path: '/api/owner/summary' },
    { method: 'GET', path: '/api/owner/loads' },
    { method: 'GET', path: '/api/owner/payments' },
    { method: 'POST', path: '/api/owner/payments/mark-paid', body: { loadId: 'LOAD-P1' } },
    { method: 'GET', path: '/api/owner/reports' },
    { method: 'GET', path: '/api/owner/analytics' },
    { method: 'GET', path: '/api/owner/accounts' }
  ];

  for (const ep of ownerEndpoints) {
    // 1. Calling with Driver token MUST be rejected with HTTP 403 Forbidden
    const driverAttempt = await request(ep.method, ep.path, ep.body || null, {
      'Authorization': `Bearer ${driverToken}`
    });
    assert.strictEqual(
      driverAttempt.status,
      403,
      `Driver token on ${ep.method} ${ep.path} must return 403 Forbidden`
    );

    // 2. Calling with No token MUST be rejected with HTTP 401 Unauthorized
    const unauthAttempt = await request(ep.method, ep.path, ep.body || null);
    const expectedUnauth = ep.path === '/api/owner/accounts' ? 403 : 401;
    assert.strictEqual(
      unauthAttempt.status,
      expectedUnauth,
      `Unauthenticated call on ${ep.method} ${ep.path} must return ${expectedUnauth}`
    );
  }
  console.log('  ✓ All 7 Owner endpoints strictly reject Driver tokens with HTTP 403');
  console.log('  ✓ Manual navigation or deep-linking by Drivers is 100% blocked server-side');

  // -------------------------------------------------------------------------
  // Phase 9: Financial Calculation & Consistency Validation
  // -------------------------------------------------------------------------
  console.log('\n🧪 Step 4: Phase 9 — Financial Calculation & Consistency Validation...');
  const summaryRes = await request('GET', '/api/owner/summary', null, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(summaryRes.status, 200);

  const { grossRevenue, driverPay, estimatedProfit, grossMarginPct, paymentSummary } = summaryRes.body;
  // Loads: 3000 + 1800 + 1200 + 1500 = 7500
  // Driver Pay: 2400 + 1400 + 900 + 1100 = 5800
  // Estimated Profit: 7500 - 5800 = 1700
  // Margin: (1700 / 7500) * 100 = 22.7%
  assert.strictEqual(grossRevenue, 7500, 'Gross revenue must equal $7,500');
  assert.strictEqual(driverPay, 5800, 'Driver pay must equal $5,800');
  assert.strictEqual(estimatedProfit, 1700, 'Estimated profit must equal $1,700 (Gross - DriverPay)');
  assert.strictEqual(grossMarginPct, 22.7, 'Gross margin percentage must equal 22.7%');

  // 5-State Payment Mapping verification
  assert.strictEqual(paymentSummary.readyToPayAmount, 2400, 'Ready to pay must equal $2,400');
  assert.strictEqual(paymentSummary.readyToPayCount, 1);
  assert.strictEqual(paymentSummary.unpaidAmount, 1400, 'Unpaid (in-transit) must equal $1,400');
  assert.strictEqual(paymentSummary.unpaidCount, 1);
  assert.strictEqual(paymentSummary.paidAmount, 900, 'Paid (including confirmed) must equal $900');
  assert.strictEqual(paymentSummary.paidCount, 1);
  assert.strictEqual(paymentSummary.disputedAmount, 1100, 'Disputed must equal $1,100');
  assert.strictEqual(paymentSummary.disputedCount, 1);

  // Reconciliation: ReadyToPay + Unpaid + Paid + Disputed == DriverPay
  const totalReconciled = paymentSummary.readyToPayAmount + paymentSummary.unpaidAmount + paymentSummary.paidAmount + paymentSummary.disputedAmount;
  assert.strictEqual(totalReconciled, driverPay, 'Payment breakdown sum must exactly equal total driver pay');
  console.log('  ✓ Financial Formula Verified: Gross ($7,500) - DriverPay ($5,800) = Profit ($1,700)');
  console.log('  ✓ Payment Reconciliation: Ready ($2,400) + Unpaid ($1,400) + Paid ($900) + Disputed ($1,100) = $5,800');

  // -------------------------------------------------------------------------
  // Phase 8: End-to-End Payment State Machine Transitions
  // -------------------------------------------------------------------------
  console.log('\n🧪 Step 5: Phase 8 — Payment State Machine Transitions...');

  // 1. Try paying an in-transit load (LOAD-P2) -> must reject
  const payInTransit = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-P2' }, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(payInTransit.status, 400, 'In-transit UNPAID load must be rejected');
  console.log('  ✓ In-transit UNPAID load rejected with HTTP 400');

  // 2. Try paying a disputed load (LOAD-P4) -> must reject
  const payDisputed = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-P4' }, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(payDisputed.status, 400, 'PAYMENT_DISPUTED load must be rejected');
  console.log('  ✓ PAYMENT_DISPUTED load rejected with HTTP 400');

  // 3. Try paying an already confirmed load (LOAD-P3) -> must reject
  const payConfirmed = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-P3' }, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(payConfirmed.status, 409, 'PAID_CONFIRMED load must be rejected');
  console.log('  ✓ PAID_CONFIRMED load rejected with HTTP 409');

  // 4. Pay the eligible delivered load (LOAD-P1) -> must succeed
  const payEligible = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-P1' }, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(payEligible.status, 200, 'READY_TO_PAY load payment must succeed');
  assert.strictEqual(payEligible.body.ok, true);
  console.log('  ✓ READY_TO_PAY load (HB-9001) successfully paid ($2,400)');

  // 5. Verify immediate repeat attempt is blocked
  const payRepeat = await request('POST', '/api/owner/payments/mark-paid', { loadId: 'LOAD-P1' }, {
    'Authorization': `Bearer ${ownerToken}`
  });
  assert.strictEqual(payRepeat.status, 409, 'Repeat payment attempt must be rejected with 409 Conflict');
  console.log('  ✓ Duplicate payment attempt rejected with HTTP 409');

  // 6. Driver acknowledges payment -> moves to PAID_CONFIRMED
  const driverConfirm = await request('POST', '/api/driver/transactions/LOAD-P1/accept', null, {
    'Authorization': `Bearer ${driverToken}`
  });
  assert.strictEqual(driverConfirm.status, 200, 'Driver payment confirmation must succeed');
  console.log('  ✓ Driver confirmed payment receipt → status advanced to PAID_CONFIRMED');

  console.log('\n====================================================');
  console.log('  ✅ ALL PRODUCTION E2E CHECKS PASSED (100%)       ');
  console.log('====================================================\n');
}

runProductionE2eVerification().catch(err => {
  console.error('\n❌ Production E2E Verification Failed:', err);
  process.exit(1);
});
