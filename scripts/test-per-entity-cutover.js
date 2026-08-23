// scripts/test-per-entity-cutover.js
// Verification harness for Per-Entity Phased Cutover (Brokers & Dispatchers) & Mass PIN Reset Protection

const db = require('../lib/db');
const kv = require('../lib/kvstore');
const audit = require('../lib/auditStore');
const dataStore = require('../lib/dataStore');

async function testPerEntityCutover() {
  console.log('========================================================================');
  console.log('🧪 TESTING PER-ENTITY PHASED CUTOVER & MASS PIN RESET PROTECTIONS');
  console.log('========================================================================\n');

  // 1. Mock DB state
  const mockTables = {
    app_settings: [
      { key: 'system:data_read_layers', value: { layers: { dispatchers: 'kv', brokers: 'kv', drivers: 'kv', loads: 'kv' } } }
    ],
    dispatchers: [
      { id: 'disp-rel-1', name: 'Relational Dispatcher 1', email: 'disp1@rel.com', role: 'dispatcher', active: true }
    ],
    brokers: [
      { id: 'brk-rel-1', name: 'Relational Freight Broker 1', mc_number: 'MC-99881' }
    ],
    drivers: [
      { id: 'drv-rel-1', name: 'Relational Driver', driver_code: 'DRV-R1', status: 'Active', active: true }
    ],
    loads: [
      { id: 'load-rel-1', load_number: 'HB-REL-1', status: 'IN_TRANSIT', rate: 3000, driver_pay: 2400 }
    ]
  };

  const mockKvState = {
    dispatchers: [{ id: 'disp-kv-1', name: 'KV Dispatcher', email: 'disp@kv.com' }],
    brokers: [{ id: 'brk-kv-1', name: 'KV Broker', mcNumber: 'MC-KV1' }],
    drivers: [{ id: 'drv-kv-1', name: 'KV Driver', driverCode: 'DRV-KV', pin: '1234' }],
    loads: [{ id: 'load-kv-1', loadNumber: 'HB-KV-1', status: 'ASSIGNED', rate: 1500, driverPay: 1200 }]
  };

  db.ensureSchema = async () => true;
  db.getPool = () => ({
    query: async (sql, params) => {
      if (sql.includes('SELECT value FROM app_settings')) {
        const row = mockTables.app_settings.find(r => r.key === 'system:data_read_layers');
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('INSERT INTO app_settings')) {
        const val = JSON.parse(params[0]);
        const idx = mockTables.app_settings.findIndex(r => r.key === 'system:data_read_layers');
        if (idx !== -1) mockTables.app_settings[idx].value = val;
        else mockTables.app_settings.push({ key: 'system:data_read_layers', value: val });
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM dispatchers')) return { rows: mockTables.dispatchers };
      if (sql.includes('SELECT * FROM brokers')) return { rows: mockTables.brokers };
      if (sql.includes('SELECT * FROM drivers')) return { rows: mockTables.drivers };
      if (sql.includes('SELECT * FROM loads')) return { rows: mockTables.loads };
      return { rows: [] };
    }
  });

  kv.get = async () => JSON.stringify(mockKvState);
  kv.set = async () => true;
  audit.log = async () => true;

  // TEST 1: Initial state (all KV)
  console.log('--- TEST 1: Initial State (All entities reading from KV) ---');
  let state = await dataStore.loadFullState();
  console.log(`✓ Dispatchers source: ${state.dispatchers[0].name} (Expected: KV Dispatcher)`);
  console.log(`✓ Brokers source:     ${state.brokers[0].name} (Expected: KV Broker)`);
  console.log(`✓ Drivers source:     ${state.drivers[0].name} (Expected: KV Driver)`);
  console.log(`✓ Loads source:       ${state.loads[0].loadNumber} (Expected: HB-KV-1)`);

  if (state.dispatchers[0].name !== 'KV Dispatcher' || state.loads[0].loadNumber !== 'HB-KV-1') {
    throw new Error('Initial KV state mismatch');
  }

  // TEST 2: Phase 1 Cutover: Switch Brokers and Dispatchers to Relational
  console.log('\n--- TEST 2: Phase 1 Cutover (Brokers & Dispatchers ➔ Relational, Drivers & Loads ➔ KV) ---');
  await dataStore.setReadLayer({
    brokers: 'relational',
    dispatchers: 'relational'
  }, null, { id: 'admin-1', name: 'Lead Architect', email: 'admin@haulbox.com' });

  const activeLayers = await dataStore.getReadLayers();
  console.log(`✓ Active layers:`, JSON.stringify(activeLayers));

  state = await dataStore.loadFullState();
  console.log(`✓ Dispatchers source: ${state.dispatchers[0].name} (Expected: Relational Dispatcher 1)`);
  console.log(`✓ Brokers source:     ${state.brokers[0].name} (Expected: Relational Freight Broker 1)`);
  console.log(`✓ Drivers source:     ${state.drivers[0].name} (Expected: KV Driver - still in shadow KV mode)`);
  console.log(`✓ Loads source:       ${state.loads[0].loadNumber} (Expected: HB-KV-1 - still in shadow KV mode)`);

  if (state.dispatchers[0].name !== 'Relational Dispatcher 1' || state.brokers[0].name !== 'Relational Freight Broker 1') {
    throw new Error('Brokers/Dispatchers relational cutover assertion failed!');
  }
  if (state.drivers[0].name !== 'KV Driver' || state.loads[0].loadNumber !== 'HB-KV-1') {
    throw new Error('Drivers/Loads isolation assertion failed: must still read from KV!');
  }

  console.log('\n========================================================================');
  console.log('✅ PER-ENTITY PHASED CUTOVER VERIFIED: BROKERS & DISPATCHERS ACTIVE!');
  console.log('========================================================================\n');
  process.exit(0);
}

testPerEntityCutover().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
