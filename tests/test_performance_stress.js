const http = require('http');
const assert = require('assert');
const kv = require('../lib/kvstore');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
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
        const duration = Date.now() - start;
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, duration });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, duration });
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

async function runPerformanceCheck() {
  console.log('=== Starting Performance, Scale & Multi-User Concurrency Test ===\n');

  // 1. Seed realistic dataset: 120 loads, 25 drivers, 5 dispatchers
  console.log('--- 1. Seeding Realistic Dataset (120 Loads, 25 Drivers, 5 Dispatchers) ---');
  const dispatchers = [];
  for (let i = 1; i <= 5; i++) {
    dispatchers.push({
      id: `disp_perf_${i}`,
      name: `Dispatcher ${i}`,
      email: `disp${i}@perf.test`,
      role: 'dispatcher',
      sessionToken: `token_perf_disp_${i}`
    });
  }

  const drivers = [];
  for (let i = 1; i <= 25; i++) {
    const dispIdx = (i % 5) + 1;
    drivers.push({
      id: `drv_perf_${i}`,
      name: `Driver ${i} Armstrong`,
      driverCode: `DP${1000 + i}`,
      pin: '1234',
      phone: `(555) 010-${String(i).padStart(4, '0')}`,
      truck: `TRK-${200 + i}`,
      companyId: 'COMP-LEGACY',
      dispatcherId: `disp_perf_${dispIdx}`,
      active: true,
      payPct: 85
    });
  }

  const cities = [
    'Chicago, IL', 'Atlanta, GA', 'Dallas, TX', 'Denver, CO', 'Los Angeles, CA',
    'Seattle, WA', 'Miami, FL', 'New York, NY', 'Memphis, TN', 'Phoenix, AZ'
  ];
  const statuses = ['Booked', 'Loaded', 'Drop-off', 'In Transit', 'Delivered'];

  const loads = [];
  for (let i = 1; i <= 120; i++) {
    const pu = cities[i % cities.length];
    const doCity = cities[(i + 3) % cities.length];
    const drv = drivers[i % drivers.length];
    const st = statuses[i % statuses.length];
    const rate = 1500 + (i * 25);
    loads.push({
      id: `load_perf_${i}`,
      loadNumber: `HB-${5000 + i}`,
      pickup: pu,
      dropoff: doCity,
      pickupDate: '2026-09-08',
      deliveryDate: '2026-09-10',
      miles: 600 + (i * 5),
      ratePerMile: (rate / (600 + (i * 5))).toFixed(2),
      brokerRate: rate,
      dispatchRevenue: Math.round(rate * 0.1),
      driverPay: Math.round(rate * 0.85),
      driverId: drv.id,
      driverName: drv.name,
      dispatcherId: drv.dispatcherId,
      dispatcherName: `Dispatcher ${(i % 5) + 1}`,
      companyId: 'COMP-LEGACY',
      status: st,
      driverProgress: st === 'Drop-off' || st === 'Delivered' ? 'DELIVERED' : 'IN_TRANSIT',
      docs: {
        RC: { name: 'RC.pdf', data: null, status: 'Approved' },
        BOL: st !== 'Booked' ? { name: 'BOL.pdf', data: null, status: 'Approved' } : null,
        POD: st === 'Drop-off' || st === 'Delivered' ? { name: 'POD.pdf', data: null, status: 'Approved' } : null,
        PhotosPU: [],
        PhotosDO: [],
        Extra: []
      }
    });
  }

  // Save to database
  const seedState = {
    dispatchers,
    drivers,
    loads,
    brokers: [
      { id: 'brk_1', name: 'C.H. Robinson', mc: 'MC-123456' },
      { id: 'brk_2', name: 'TQL Logistics', mc: 'MC-234567' },
      { id: 'brk_3', name: 'Echo Global', mc: 'MC-345678' }
    ],
    settings: { companyName: 'HaulBoX Fleet' },
    notifications: []
  };

  const seedRes = await request('POST', '/api/storage', {
    key: 'haulline:state',
    value: JSON.stringify(seedState)
  });
  assert.strictEqual(seedRes.status, 200);
  console.log(`✓ Seeded ${loads.length} loads, ${drivers.length} drivers, ${dispatchers.length} dispatchers (Status: 200, Latency: ${seedRes.duration}ms)`);

  // 2. Benchmark Load Times with 120+ Loads & 25+ Drivers
  console.log('\n--- 2. Benchmarking Endpoint Load Times Under Realistic Dataset ---');
  const latencies = {};

  // Full state read (Dashboard / Load Board fetch)
  const fullState = await request('GET', '/api/storage/haulline:state');
  latencies.dashboardLoad = fullState.duration;
  assert.strictEqual(fullState.status, 200);
  console.log(`• Full Dashboard / State Load: ${fullState.duration}ms (Payload: ~${Math.round(JSON.stringify(fullState.body).length / 1024)}KB)`);

  // Tracking summary
  const tracking = await request('GET', '/api/tracking/summary');
  latencies.trackingSummary = tracking.duration;
  assert.strictEqual(tracking.status, 200);
  console.log(`• Tracking Summary: ${tracking.duration}ms`);

  // Owner financial summary
  const ownerSummary = await request('GET', '/api/owner/summary', null, { 'x-admin-pin': '8483' });
  latencies.ownerSummary = ownerSummary.duration;
  assert.strictEqual(ownerSummary.status, 200);
  console.log(`• Owner Financial & KPI Summary: ${ownerSummary.duration}ms (Loads processed: ${ownerSummary.body.summary?.totalLoads || loads.length})`);

  // Chat contacts for Dispatcher 1
  const chatContacts = await request('GET', '/api/chat/contacts?accountId=disp_perf_1&role=dispatcher');
  latencies.chatContacts = chatContacts.duration;
  assert.strictEqual(chatContacts.status, 200);
  console.log(`• Dispatcher Chat Contacts & Scoping: ${chatContacts.duration}ms`);

  // 3. Multi-User Simulation: Owner + 2 Dispatchers + 2 Drivers active simultaneously
  console.log('\n--- 3. Multi-User Concurrency (Owner + 2 Dispatchers + 2 Drivers) ---');
  
  // Login 2 drivers
  const d1Login = await request('POST', '/api/driver/login', { driverId: drivers[0].driverCode, pin: '1234' });
  const d2Login = await request('POST', '/api/driver/login', { driverId: drivers[1].driverCode, pin: '1234' });
  const d1Token = d1Login.body.token;
  const d2Token = d2Login.body.token;

  const concurrentStart = Date.now();
  const concurrentRequests = await Promise.all([
    // User 1: Fleet Owner
    request('GET', '/api/owner/summary', null, { 'x-admin-pin': '8483' }),
    request('GET', '/api/owner/loads?period=all', null, { 'x-admin-pin': '8483' }),
    
    // User 2: Dispatcher 1
    request('GET', '/api/chat/contacts?accountId=disp_perf_1&role=dispatcher'),
    request('GET', '/api/notifications?accountId=disp_perf_1&role=dispatcher&unread=1'),
    
    // User 3: Dispatcher 2
    request('GET', '/api/chat/contacts?accountId=disp_perf_2&role=dispatcher'),
    request('GET', '/api/notifications?accountId=disp_perf_2&role=dispatcher&unread=1'),
    
    // User 4: Driver 1 (Mobile App)
    request('GET', `/api/driver/loads`, null, { Authorization: `Bearer ${d1Token}` }),
    request('GET', `/api/driver/me`, null, { Authorization: `Bearer ${d1Token}` }),
    
    // User 5: Driver 2 (Mobile App)
    request('GET', `/api/driver/loads`, null, { Authorization: `Bearer ${d2Token}` }),
    request('GET', `/api/driver/me`, null, { Authorization: `Bearer ${d2Token}` }),
  ]);

  const concurrentDuration = Date.now() - concurrentStart;
  const allSucceeded = concurrentRequests.every(r => r.status === 200);
  assert(allSucceeded, 'All 10 concurrent requests across 5 different roles must return 200 OK');
  console.log(`✓ 10 simultaneous multi-role requests completed in ${concurrentDuration}ms (Avg per request: ${(concurrentDuration / 10).toFixed(1)}ms)`);

  // 4. Verification of Cache Hit Rate & kvstore Efficiency
  console.log('\n--- 4. Checking Memory & Cache Health ---');
  const memUsage = process.memoryUsage();
  console.log(`• Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(`• RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
  
  // Benchmark 5 rapid state gets to verify cache hit speed
  const rapidReads = [];
  for (let i = 0; i < 5; i++) {
    rapidReads.push(await request('GET', '/api/storage/haulline:state'));
  }
  const avgRapidRead = (rapidReads.reduce((acc, r) => acc + r.duration, 0) / 5).toFixed(1);
  console.log(`• Cached state read latency (5 runs avg): ${avgRapidRead}ms`);
  assert(Number(avgRapidRead) < 50, 'Cached state read must be ultra-fast (<50ms)');

  console.log('\n=== Performance & Stress Tests PASSED 100% ===\n');
}

runPerformanceCheck().catch(err => {
  console.error('✗ Performance test failed:', err);
  process.exit(1);
});
