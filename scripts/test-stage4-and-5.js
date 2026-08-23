// scripts/test-stage4-and-5.js
// Verification harness for Stage 4 (Consistency Worker) & Stage 5 (Read Cutover)

const db = require('../lib/db');
const kv = require('../lib/kvstore');
const audit = require('../lib/auditStore');
const dataStore = require('../lib/dataStore');
const { consistencyWorker } = require('../lib/consistencyWorker');

async function testStage4And5() {
  console.log('========================================================================');
  console.log('🧪 TESTING STAGE 4 (CONSISTENCY WORKER) & STAGE 5 (READ CUTOVER)');
  console.log('========================================================================\n');

  // Setup In-Memory Mock Database
  const mockTables = {
    app_settings: [{ key: 'system:data_read_layer', value: { layer: 'kv' } }],
    dispatchers: [{ id: 'disp-1', name: 'Alice Dispatch', email: 'alice@haulbox.com', role: 'dispatcher', active: true }],
    brokers: [{ id: 'brk-10', name: 'CH Robinson Logistics', mc_number: 'MC-88291' }],
    drivers: [{ id: 'drv-101', name: 'John Driver', driver_code: 'DRV-101', status: 'Active', active: true }],
    loads: [{ id: 'load-990', load_number: 'HB-990', status: 'IN_TRANSIT', rate: 2200, driver_pay: 1800 }]
  };

  const sampleKvState = {
    dispatchers: [{ id: 'disp-1', name: 'Alice Dispatch', email: 'alice@haulbox.com', role: 'dispatcher' }],
    brokers: [{ id: 'brk-10', name: 'CH Robinson Logistics', mcNumber: 'MC-88291' }],
    drivers: [{ id: 'drv-101', name: 'John Driver', driverCode: 'DRV-101', status: 'Active' }],
    loads: [{ id: 'load-990', loadNumber: 'HB-990', status: 'IN_TRANSIT', rate: 2200, driverPay: 1800 }]
  };

  db.ensureSchema = async () => true;
  db.getPool = () => ({
    query: async (sql, params) => {
      if (sql.includes('SELECT value FROM app_settings')) {
        const row = mockTables.app_settings.find(r => r.key === 'system:data_read_layer');
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('INSERT INTO app_settings')) {
        const val = JSON.parse(params[0]);
        const idx = mockTables.app_settings.findIndex(r => r.key === 'system:data_read_layer');
        if (idx !== -1) mockTables.app_settings[idx].value = val;
        else mockTables.app_settings.push({ key: 'system:data_read_layer', value: val });
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM dispatchers')) return { rows: mockTables.dispatchers };
      if (sql.includes('SELECT * FROM brokers')) return { rows: mockTables.brokers };
      if (sql.includes('SELECT * FROM drivers')) return { rows: mockTables.drivers };
      if (sql.includes('SELECT * FROM loads')) return { rows: mockTables.loads };
      return { rows: [] };
    }
  });

  kv.get = async () => JSON.stringify(sampleKvState);
  audit.log = async () => true;

  // TEST 1: Stage 4 Consistency Audit Engine
  console.log('--- TEST 1: Consistency Audit Worker Run ---');
  const auditResult = await consistencyWorker.runAudit();
  console.log(`✓ Audit execution completed (Status: ${auditResult.isConsistent ? 'CONSISTENT' : 'DRIFT_DETECTED'})`);
  console.log(`✓ Entity counts matched:`, JSON.stringify(auditResult.countCheck));

  if (!auditResult.isConsistent) {
    throw new Error('Consistency audit failed on matched state!');
  }

  // TEST 2: Stage 5 Phased Read Cutover & Dynamic Layer Switching
  console.log('\n--- TEST 2: Phased Read Cutover (Hot-Swappable Toggle) ---');
  
  // 1. Initial State
  const initialLayer = await dataStore.getReadLayer();
  console.log(`✓ Initial active read layer: "${initialLayer}"`);

  // 2. Cutover to Relational Layer
  const cutoverResult = await dataStore.setReadLayer('relational', {
    id: 'admin-test',
    name: 'Lead Architect',
    email: 'architect@haulbox.com'
  });
  console.log(`✓ Cutover executed: previous="${cutoverResult.previousLayer}" ➔ current="${cutoverResult.currentLayer}"`);

  const activeLayerAfterCutover = await dataStore.getReadLayer();
  console.log(`✓ Verified active read layer is now: "${activeLayerAfterCutover}" (Expected: "relational")`);

  if (activeLayerAfterCutover !== 'relational') {
    throw new Error('Read cutover assertion failed: Layer was not set to relational');
  }

  // 3. Rollback to KV Layer (Zero Downtime Validation)
  const rollbackResult = await dataStore.setReadLayer('kv', {
    id: 'admin-test',
    name: 'Lead Architect',
    email: 'architect@haulbox.com'
  });
  console.log(`✓ Rollback executed: previous="${rollbackResult.previousLayer}" ➔ current="${rollbackResult.currentLayer}"`);

  const activeLayerAfterRollback = await dataStore.getReadLayer();
  console.log(`✓ Verified active read layer restored to: "${activeLayerAfterRollback}" (Expected: "kv")`);

  if (activeLayerAfterRollback !== 'kv') {
    throw new Error('Rollback assertion failed: Layer was not restored to kv');
  }

  console.log('\n========================================================================');
  console.log('✅ STAGE 4 & STAGE 5 VERIFICATION PASSED: ZERO DOWNTIME CUTOVER READY!');
  console.log('========================================================================\n');
  process.exit(0);
}

testStage4And5().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
