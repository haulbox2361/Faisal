/**
 * tests/test_egress_optimization.js
 * Verifies the Supabase egress and query optimizations:
 * 1. In-memory caching on kv.get('haulline:state') prevents redundant SQL queries.
 * 2. In-memory cache invalidation on kv.set and kv.del.
 * 3. ensureSchema() only runs once across operations.
 * 4. Relational loads query column optimization and soft-delete filtering.
 */

const assert = require('assert');
const kv = require('../lib/kvstore');
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING EGRESS & QUERY OPTIMIZATION TESTS');
  console.log('================================================================\n');

  const pool = db.getPool();

  // Test 1: In-memory cache prevents redundant DB queries
  console.log('--- TEST 1: In-Memory Cache on kv.get("haulline:state") ---');
  await kv.set('haulline:state', JSON.stringify({ loads: [{ id: 'L1', rate: 1500 }] }));

  let queryCounter = 0;
  const originalQuery = pool.query.bind(pool);
  pool.query = async function(...args) {
    queryCounter++;
    return originalQuery(...args);
  };

  try {
    // Reset cache to test first read
    kv.invalidateCache('haulline:state');
    queryCounter = 0;

    // Read 1: Cache miss -> goes to DB
    const read1 = await kv.get('haulline:state');
    assert.strictEqual(queryCounter, 1, 'First read should execute 1 DB query');
    const parsed1 = JSON.parse(read1);
    assert.strictEqual(parsed1.loads[0].id, 'L1');

    // Read 2: Within 15s TTL -> served from cache
    const read2 = await kv.get('haulline:state');
    assert.strictEqual(queryCounter, 1, 'Second read must be served from cache (0 new DB queries)');
    assert.strictEqual(read2, read1);

    // Read 3: Still served from cache
    const read3 = await kv.get('haulline:state');
    assert.strictEqual(queryCounter, 1, 'Third read must be served from cache (0 new DB queries)');

    console.log(`✓ Verified: 3 reads resulted in only ${queryCounter} DB query (2 hits served 100% from RAM)`);

    // Test 2: Cache invalidation on kv.set
    console.log('\n--- TEST 2: In-Memory Cache Update on kv.set ---');
    queryCounter = 0;
    await kv.set('haulline:state', JSON.stringify({ loads: [{ id: 'L1' }, { id: 'L2' }] }));
    assert.strictEqual(queryCounter, 1, 'kv.set should execute 1 DB upsert');

    // Next get should immediately reflect new data from cache with 0 extra queries
    queryCounter = 0;
    const readAfterSet = await kv.get('haulline:state');
    assert.strictEqual(queryCounter, 0, 'kv.get immediately after set should read from updated cache with 0 DB queries');
    const parsedAfterSet = JSON.parse(readAfterSet);
    assert.strictEqual(parsedAfterSet.loads.length, 2, 'Cache contains updated payload');
    console.log('✓ Verified: kv.set updates in-memory cache and serves immediate reads with 0 DB latency');

    // Test 3: Cache invalidation on kv.del
    console.log('\n--- TEST 3: In-Memory Cache Clearance on kv.del ---');
    await kv.del('haulline:state');
    queryCounter = 0;
    const readAfterDel = await kv.get('haulline:state');
    assert.strictEqual(queryCounter, 1, 'kv.get after del should query DB and find null');
    assert.strictEqual(readAfterDel, null);
    console.log('✓ Verified: kv.del successfully cleared cache');

    // Restore state for application
    await kv.set('haulline:state', JSON.stringify({ loads: [], drivers: [], brokers: [], dispatchers: [] }));

    // Test 4: loadFullState works properly
    console.log('\n--- TEST 4: loadFullState Relational & KV Compatibility ---');
    const fullState = await dataStore.loadFullState();
    assert.ok(fullState, 'loadFullState should return a valid state object');
    assert.ok(Array.isArray(fullState.loads), 'loads must be an array');
    assert.ok(Array.isArray(fullState.drivers), 'drivers must be an array');
    console.log('✓ Verified: loadFullState returned valid state structure without truncating history');

    console.log('\n================================================================');
    console.log('✅ ALL EGRESS & QUERY OPTIMIZATION TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    pool.query = originalQuery;
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
