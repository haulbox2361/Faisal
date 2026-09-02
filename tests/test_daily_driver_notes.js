/**
 * tests/test_daily_driver_notes.js
 * Verification test suite for Daily Driver Notes and 4-5 PM mandatory submission logic.
 */

const assert = require('assert');
const http = require('http');
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

function getTodayIsoString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

async function runTests() {
  console.log('====================================================');
  console.log('   DAILY DRIVER REPORT & 4-5 PM REMINDER TEST SUITE ');
  console.log('====================================================\n');

  const today = getTodayIsoString(0);
  const yesterday = getTodayIsoString(1);
  const past6Days = getTodayIsoString(6);

  const runId = Math.random().toString(36).slice(2, 6);
  const dspAliId = 'dsp_ali_' + runId;
  const dspDanaId = 'dsp_dana_' + runId;
  const drvJuliusId = 'drv_julius_' + runId;
  const drvShahnanId = 'drv_shahnan_' + runId;
  const drvMikeId = 'drv_mike_' + runId;

  // Setup sample dispatchers and drivers in dataStore
  console.log('🧪 Test 1: Initializing sample dispatchers and allocated drivers...');
  const sampleDispatchers = [
    { id: dspAliId, name: 'Ali Khan', email: 'ali@haulbox.com' },
    { id: dspDanaId, name: 'Dana Jacobs', email: 'dana@haulbox.com' }
  ];
  const sampleDrivers = [
    { id: drvJuliusId, name: 'Julius Caesar', truck: 'Truck #101', dispatcherId: dspAliId },
    { id: drvShahnanId, name: 'Shahnan Roadrunner', truck: 'Truck #102', dispatcherId: dspAliId },
    { id: drvMikeId, name: 'Mike Miller', truck: 'Truck #103', dispatcherId: dspDanaId }
  ];

  const sampleState = {
    dispatchers: sampleDispatchers,
    drivers: sampleDrivers,
    loads: [],
    settings: {}
  };

  await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/storage',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    key: 'haulline:state',
    value: JSON.stringify(sampleState)
  });
  console.log('  ✓ Sample state loaded on server: Ali (2 drivers), Dana (1 driver).\n');

  // Test 2: Character Limit Enforcement (Strictly 100 characters max)
  console.log('🧪 Test 2: Character limit enforcement (100 chars max)...');
  const over100CharNote = 'A'.repeat(101);
  const rejectRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/daily-notes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    driverId: drvJuliusId,
    note: over100CharNote,
    dispatcherId: dspAliId
  });

  assert.strictEqual(rejectRes.status, 400, 'Expected HTTP 400 for note > 100 characters');
  assert(rejectRes.data?.error?.includes('100 characters'), 'Error message should mention 100 character limit');
  console.log('  ✓ Rejected 101-character note with HTTP 400.\n');

  // Test 3: Same-Day Edit Lock (Past days cannot be edited)
  console.log('🧪 Test 3: Past day edit locking...');
  const pastEditRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/daily-notes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    driverId: drvJuliusId,
    note: 'Trying to edit yesterday note',
    date: yesterday,
    dispatcherId: dspAliId
  });

  assert.strictEqual(pastEditRes.status, 400, 'Expected HTTP 400 when attempting to edit a past day note');
  assert(pastEditRes.data?.error?.includes('locked'), 'Error should specify that past dates are locked');
  console.log('  ✓ Attempted edit of past date rejected with HTTP 400.\n');

  // Test 4: Successful Submission & Same-Day Update
  console.log('🧪 Test 4: Submitting and updating valid notes for today...');
  const validNoteText = 'Booked for today and looking load for tomorrow';
  const submitRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/daily-notes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    driverId: drvJuliusId,
    note: validNoteText,
    dispatcherId: dspAliId
  });

  assert.strictEqual(submitRes.status, 200, 'Expected HTTP 200 for valid note submission');
  assert.strictEqual(submitRes.data?.ok, true);
  assert.strictEqual(submitRes.data?.note?.note, validNoteText);
  console.log('  ✓ Submitted Julius note successfully.');

  // Update note same-day
  const updatedNoteText = 'Booked for today, secured Chicago reload for tomorrow';
  const updateRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/daily-notes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    driverId: drvJuliusId,
    note: updatedNoteText,
    dispatcherId: dspAliId
  });

  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.data?.note?.note, updatedNoteText);
  console.log('  ✓ Updated Julius note same-day successfully.\n');

  // Test 5: Status Endpoint for 4-5 PM Closing Window
  console.log('🧪 Test 5: GET /api/daily-notes/status (Missing vs Submitted evaluation)...');
  const statusRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/daily-notes/status?dispatcherId=${dspAliId}&date=${today}`,
    method: 'GET'
  });

  assert.strictEqual(statusRes.status, 200);
  const statusData = statusRes.data;
  assert.strictEqual(statusData.totalDrivers, 2, 'Ali has 2 allocated drivers');
  assert.strictEqual(statusData.submittedCount, 1, '1 note submitted (Julius)');
  assert.strictEqual(statusData.missingCount, 1, '1 note missing (Shahnan)');
  assert.strictEqual(statusData.allSubmitted, false, 'allSubmitted must be false');
  assert.strictEqual(statusData.missingDrivers[0].driverId, drvShahnanId, 'Missing driver should be Shahnan');
  console.log(`  ✓ Status endpoint correctly flagged ${statusData.missingCount} missing driver(s) for Ali.`);

  // Submit Shahnan's note
  await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/daily-notes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    driverId: drvShahnanId,
    note: 'Not taken a load yet, still not open to the market',
    dispatcherId: dspAliId
  });

  // Re-check status: now all submitted!
  const statusAfterRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/daily-notes/status?dispatcherId=${dspAliId}&date=${today}`,
    method: 'GET'
  });
  assert.strictEqual(statusAfterRes.data.allSubmitted, true, 'allSubmitted should now be true');
  assert.strictEqual(statusAfterRes.data.missingCount, 0, '0 missing drivers');
  console.log('  ✓ After submitting Shahnan note, allSubmitted is true.\n');

  // Test 6: Admin Report Endpoint (Multi-Dispatcher Grouping & Missing Flags)
  console.log('🧪 Test 6: GET /api/daily-notes/report (Admin View)...');
  const reportRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/daily-notes/report?date=${today}`,
    method: 'GET'
  });

  assert.strictEqual(reportRes.status, 200);
  const report = reportRes.data;
  assert.strictEqual(report.summary.totalDispatchers, 2);
  assert.strictEqual(report.summary.totalDrivers, 3);
  assert.strictEqual(report.summary.submittedNotes, 2, 'Ali submitted 2 notes');
  assert.strictEqual(report.summary.missingNotes, 1, 'Dana has 1 missing note (Mike)');

  const aliReport = report.dispatchers.find(d => d.dispatcherId === dspAliId);
  assert.strictEqual(aliReport.allSubmitted, true);
  assert.strictEqual(aliReport.submittedCount, 2);

  const danaReport = report.dispatchers.find(d => d.dispatcherId === dspDanaId);
  assert.strictEqual(danaReport.allSubmitted, false);
  assert.strictEqual(danaReport.missingCount, 1);
  assert.strictEqual(danaReport.drivers[0].status, 'missing');
  console.log('  ✓ Admin report correctly grouped by dispatcher and flagged Dana\'s missing note.\n');

  // Test 7: Rolling Retention Purge
  console.log('🧪 Test 7: Rolling 5-day retention auto-purge...');
  // Manually save an old note 6 days ago
  await db.saveDailyDriverNote({
    date: past6Days,
    dispatcherId: dspAliId,
    driverId: drvJuliusId,
    driverName: 'Julius Caesar',
    note: 'Old note from 6 days ago'
  });

  const beforePurge = await db.getDailyDriverNotes({ date: past6Days });
  assert.strictEqual(beforePurge.length, 1, 'Old note should exist before purge');

  await db.purgeOldDailyNotes(5);
  const afterPurge = await db.getDailyDriverNotes({ date: past6Days });
  assert.strictEqual(afterPurge.length, 0, 'Old note should be purged (>5 days)');
  console.log('  ✓ Entries older than 5 days purged successfully.\n');

  console.log('====================================================');
  console.log('   ✅ ALL DAILY DRIVER REPORT TESTS PASSED!         ');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
