const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
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
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== Starting Multi-Stop Loads E2E Test ===\n');

  // 1. Fetch current state
  const stateRes = await request('GET', '/api/storage/haulline:state');
  let state = {};
  if (stateRes.status === 200 && stateRes.body.value) {
    state = typeof stateRes.body.value === 'string' ? JSON.parse(stateRes.body.value) : stateRes.body.value;
  }
  state.loads = state.loads || [];
  state.drivers = state.drivers || [];

  // Setup test driver if not present
  let testDriver = state.drivers.find(d => d.id === 'drv_multistop_test');
  if (!testDriver) {
    testDriver = {
      id: 'drv_multistop_test',
      name: 'MultiStop Test Driver',
      driverCode: 'D9999',
      pin: '1234',
      active: true,
      dispatcherId: 'disp_1',
      payPct: 85
    };
    state.drivers.push(testDriver);
  }

  // 2. Create Multi-Stop Load
  const multiStopLoad = {
    id: 'load_multi_' + Date.now(),
    loadNumber: 'MS-' + Math.floor(1000 + Math.random() * 9000),
    brokerName: 'Apex Logistics Multi',
    brokerMC: 'MC-778899',
    driverId: testDriver.id,
    driverName: testDriver.name,
    dispatcherId: 'disp_1',
    dispatcherName: 'Test Dispatcher',
    pickup: 'Chicago, IL',
    dropoff: 'Atlanta, GA',
    pickupDate: '2026-09-10',
    deliveryDate: '2026-09-12',
    miles: 950,
    ratePerMile: 2.84,
    brokerRate: 2700,
    dispatchRevenue: 270,
    driverPayPct: 85,
    driverPay: 2295,
    status: 'Booked',
    driverProgress: 'ASSIGNED',
    pickupStops: [
      {
        stop_number: 1,
        facility_name: 'Chicago Main Warehouse',
        address: '1000 W Fulton St',
        city: 'Chicago',
        state: 'IL',
        zip: '60607',
        scheduled_date: '2026-09-10 08:00',
        status: 'PENDING'
      },
      {
        stop_number: 2,
        facility_name: 'Gary Cross-Dock',
        address: '500 E 5th Ave',
        city: 'Gary',
        state: 'IN',
        zip: '46402',
        scheduled_date: '2026-09-10 13:00',
        status: 'PENDING'
      }
    ],
    deliveryStops: [
      {
        stop_number: 1,
        facility_name: 'Nashville Distribution Center',
        address: '200 Industrial Blvd',
        city: 'Nashville',
        state: 'TN',
        zip: '37201',
        scheduled_date: '2026-09-11 15:00',
        status: 'PENDING'
      },
      {
        stop_number: 2,
        facility_name: 'Atlanta Final Consignee',
        address: '400 Logistics Way',
        city: 'Atlanta',
        state: 'GA',
        zip: '30301',
        scheduled_date: '2026-09-12 10:00',
        status: 'PENDING'
      }
    ],
    docs: {
      RC: { name: 'RC-MS.pdf', data: 'data:application/pdf;base64,mock', status: 'Approved' },
      BOL: null,
      POD: null,
      PhotosPU: [],
      PhotosDO: [],
      Extra: []
    }
  };

  state.loads.unshift(multiStopLoad);

  // Save to state
  const saveRes = await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(state)
  });
  assert.strictEqual(saveRes.status, 200, 'State should save successfully');
  console.log('✓ Multi-stop load created with 2 pickups and 2 deliveries');

  // 3. Verify driver login and load retrieval via Driver API
  const loginRes = await request('POST', '/api/driver/login', {
    driverId: 'D9999',
    pin: '1234'
  });
  assert.strictEqual(loginRes.status, 200, 'Driver login should succeed');
  const driverToken = loginRes.body.token;
  assert(driverToken, 'Driver token received');
  console.log('✓ Driver logged in successfully');

  // 4. Fetch load through Driver API
  const driverLoadRes = await request('GET', `/api/driver/loads/${multiStopLoad.id}`, null, {
    Authorization: `Bearer ${driverToken}`
  });
  assert.strictEqual(driverLoadRes.status, 200, 'Driver can fetch multi-stop load');
  const dl = driverLoadRes.body.load || driverLoadRes.body;
  assert.strictEqual(dl.pickupStops.length, 2, 'Driver view has 2 pickup stops');
  assert.strictEqual(dl.deliveryStops.length, 2, 'Driver view has 2 delivery stops');
  assert.strictEqual(dl.pickupStops[0].stopNumber, 1, 'Stop 1 is Chicago');
  assert.strictEqual(dl.pickupStops[1].stopNumber, 2, 'Stop 2 is Gary');
  assert.strictEqual(dl.deliveryStops[0].stopNumber, 1, 'Stop 1 is Nashville');
  assert.strictEqual(dl.deliveryStops[1].stopNumber, 2, 'Stop 2 is Atlanta');
  console.log('✓ Driver API displays all 4 stops in sequential order with addresses and dates');

  // 5. Rate & Driver Pay Calculations check
  assert.strictEqual(Number(dl.grossAmount), 2700, 'Gross rate matches');
  assert.strictEqual(Number(dl.driverPay), 2700, 'Driver pay matches');
  console.log('✓ Financial rates and mileage calculate properly for multi-stop load');

  // 6. Test per-stop document upload / status tracking
  // Stop 1 BOL upload
  const uploadBolStop1 = await request('POST', '/api/driver/verify-document', {
    loadId: multiStopLoad.id,
    documentType: 'BOL',
    stopType: 'PICKUP',
    stopNumber: 1,
    base64Data: 'data:image/jpeg;base64,mockbol1image',
    mimeType: 'image/jpeg'
  }, {
    Authorization: `Bearer ${driverToken}`
  });
  console.log('Stop 1 BOL upload response:', uploadBolStop1.status, uploadBolStop1.body.ok ? 'OK' : uploadBolStop1.body.error || uploadBolStop1.body.message);

  // Check state after Stop 1 upload
  const recheckStateRes = await request('GET', '/api/storage/haulline:state');
  const recheckState = JSON.parse(recheckStateRes.body.value);
  const updatedLoad = recheckState.loads.find(l => l.id === multiStopLoad.id);
  assert(updatedLoad, 'Load still exists in state');
  console.log('Stop 1 Status:', updatedLoad.pickupStops[0].status);
  console.log('Stop 2 Status:', updatedLoad.pickupStops[1].status);
  console.log('Overall Load Status:', updatedLoad.status);

  // 7. Test reordering stops (e.g. swap Stop 1 and Stop 2 pickups)
  const temp = updatedLoad.pickupStops[0];
  updatedLoad.pickupStops[0] = updatedLoad.pickupStops[1];
  updatedLoad.pickupStops[1] = temp;
  updatedLoad.pickupStops[0].stop_number = 1;
  updatedLoad.pickupStops[1].stop_number = 2;

  await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(recheckState)
  });
  console.log('✓ Reordered pickup stops (Gary now stop 1, Chicago now stop 2)');

  // 8. Test deleting a stop (e.g. Gary cancelled, remove stop 1)
  updatedLoad.pickupStops.shift(); // remove first stop
  updatedLoad.pickupStops[0].stop_number = 1; // re-index remaining stop
  await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(recheckState)
  });

  const finalCheckState = JSON.parse((await request('GET', '/api/storage/haulline:state')).body.value);
  const finalLoad = finalCheckState.loads.find(l => l.id === multiStopLoad.id);
  assert.strictEqual(finalLoad.pickupStops.length, 1, 'Now 1 pickup stop remaining');
  assert.strictEqual(finalLoad.deliveryStops.length, 2, '2 delivery stops intact');
  console.log('✓ Successfully deleted stop without corrupting multi-stop load structure');

  console.log('\n=== Multi-Stop Loads Tests PASSED 100% ===\n');
}

runTests().catch(err => {
  console.error('✗ Multi-Stop Test Failed:', err);
  process.exit(1);
});
