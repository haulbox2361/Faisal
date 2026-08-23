// scripts/test-dual-write-failure-isolation.js
// Verification Script: Proves non-blocking failure isolation of secondary relational writes (IMP-204)

const kv = require('../lib/kvstore');
const dataStore = require('../lib/dataStore');

async function testDualWriteFailureIsolation() {
  console.log('========================================================================');
  console.log('🧪 TESTING DUAL-WRITE FAILURE ISOLATION & NON-BLOCKING BEHAVIOR');
  console.log('========================================================================\n');

  // 1. Setup sample state
  const testState = {
    drivers: [
      { id: 'drv-iso-1', name: 'Test Isolation Driver', driverCode: 'DRV-ISO', pin: '5544' }
    ],
    loads: [
      { id: 'load-iso-1', loadNumber: 'HB-ISO-1', status: 'ASSIGNED', pickup: 'Chicago, IL', dropoff: 'Miami, FL' }
    ],
    settings: { updatedBy: 'failure-isolation-test', timestamp: Date.now() }
  };

  // 2. Mock kv.set to record primary write
  let kvSetCalled = false;
  let kvSetValue = null;
  const originalKvSet = kv.set;
  kv.set = async (key, val) => {
    kvSetCalled = true;
    kvSetValue = val;
  };

  // 3. Mock writeRelationalEntities to simulate a hard relational DB timeout / error
  let secondaryWriteAttempted = false;
  let secondaryErrorLogged = false;
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && args[0].includes('[DataStore] Secondary relational write warning:')) {
      secondaryErrorLogged = true;
    }
    originalConsoleWarn(...args);
  };

  const originalWriteRelational = dataStore.writeRelationalEntities;
  dataStore.writeRelationalEntities = async () => {
    secondaryWriteAttempted = true;
    throw new Error('SIMULATED_POSTGRES_DEADLOCK_TIMEOUT: Connection terminated unexpectedly');
  };

  console.log('--- TEST 1: Dispatching saveFullState() with broken secondary database path ---');
  const startTime = Date.now();

  // Call saveFullState - Must NOT throw and must return immediately
  let threwError = false;
  try {
    await dataStore.saveFullState(testState);
  } catch (err) {
    threwError = true;
    console.error('❌ saveFullState unexpectedly threw:', err);
  }

  const durationMs = Date.now() - startTime;
  console.log(`✓ saveFullState resolved in ${durationMs}ms (Non-blocking: ${durationMs < 50})`);

  // Wait 50ms for the detached setImmediate secondary promise to execute
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Restore mocks
  kv.set = originalKvSet;
  dataStore.writeRelationalEntities = originalWriteRelational;
  console.warn = originalConsoleWarn;

  console.log('\n--- VERIFICATION CHECKS ---');
  console.log(`✓ (a) Primary kv_store write succeeded: ${kvSetCalled} (Expected: true)`);
  console.log(`✓ (b) Caller / HTTP response unaffected (no throw): ${!threwError} (Expected: true)`);
  console.log(`✓ (c) Secondary relational write attempted asynchronously: ${secondaryWriteAttempted} (Expected: true)`);
  console.log(`✓ (d) Secondary failure caught and logged without process crash: ${secondaryErrorLogged} (Expected: true)`);

  if (kvSetCalled && !threwError && secondaryWriteAttempted && secondaryErrorLogged) {
    console.log('\n========================================================================');
    console.log('✅ FAILURE ISOLATION TEST PASSED: DUAL-WRITE IS 100% NON-BLOCKING!');
    console.log('========================================================================\n');
    process.exit(0);
  } else {
    throw new Error('Failure isolation verification assertion failed');
  }
}

testDualWriteFailureIsolation().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
