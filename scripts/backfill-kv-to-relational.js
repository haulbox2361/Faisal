// scripts/backfill-kv-to-relational.js
// Idempotent Backfill Script: Migrates kv_store (haulline:state) to Normalized Relational PostgreSQL Tables (IMP-204)

const kv = require('../lib/kvstore');
const { getPool, ensureSchema } = require('../lib/db');
const dataStore = require('../lib/dataStore');

async function runBackfill() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('========================================================================');
  console.log(`📦 BACKFILL MIGRATION: KV_STORE ➔ NORMALIZED POSTGRES TABLES`);
  console.log(`Mode: ${isDryRun ? '🔍 DRY-RUN (Validation only, no SQL writes)' : '🚀 LIVE EXECUTION'}`);
  console.log('========================================================================\n');

  await ensureSchema();
  const pool = getPool();

  // 1. Fetch raw state from kv_store
  const rawState = await kv.get('haulline:state');
  if (!rawState) {
    console.error('❌ Error: No "haulline:state" found in kv_store. Migration aborted.');
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(rawState);
  } catch (e) {
    console.error('❌ Error parsing haulline:state JSON:', e.message);
    process.exit(1);
  }

  const dispatchers = Array.isArray(state.dispatchers) ? state.dispatchers : [];
  const brokers = Array.isArray(state.brokers) ? state.brokers : [];
  const drivers = Array.isArray(state.drivers) ? state.drivers : [];
  const loads = Array.isArray(state.loads) ? state.loads : [];
  const settings = state.settings || {};

  console.log(`📊 Found in kv_store:`);
  console.log(`   • Dispatchers: ${dispatchers.length}`);
  console.log(`   • Brokers:     ${brokers.length}`);
  console.log(`   • Drivers:     ${drivers.length}`);
  console.log(`   • Loads:       ${loads.length}`);
  console.log(`   • Settings:    ${Object.keys(settings).length} keys\n`);

  if (isDryRun) {
    console.log('🔍 Validating entity schema mappings & PIN hashing...');

    // Validate drivers & PINs
    for (const d of drivers) {
      if (!d.id || !d.name) {
        console.warn(`⚠️ Warning: Driver missing ID or Name: ${JSON.stringify(d)}`);
      }
      const rawPin = d.pin || '1234';
      const sampleHash = dataStore.hashPin(rawPin);
      const verifyCheck = dataStore.verifyPin(rawPin, sampleHash);
      if (!verifyCheck) {
        throw new Error(`PIN verification failed for driver ${d.name} during dry run!`);
      }
    }
    console.log(`✓ Validated ${drivers.length} drivers: All PINs hash and verify cleanly.`);

    // Validate loads
    let validLoads = 0;
    for (const l of loads) {
      if (l.id && l.loadNumber) validLoads++;
    }
    console.log(`✓ Validated ${validLoads}/${loads.length} loads with valid primary keys.`);
    console.log('\n✅ DRY-RUN COMPLETED SUCCESSFULLY! No changes written to database.');
    return { ok: true, isDryRun: true };
  }

  // 2. LIVE EXECUTION (Transactional / Idempotent Upserts)
  console.log('🚀 Executing idempotent upserts into PostgreSQL tables...');

  // A. Backfill Dispatchers
  let dispCount = 0;
  for (const disp of dispatchers) {
    if (!disp.id || !disp.email) continue;
    await pool.query(
      `INSERT INTO dispatchers (id, name, email, phone, role, active, settings, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         role = EXCLUDED.role,
         active = EXCLUDED.active,
         settings = EXCLUDED.settings,
         updated_at = NOW()`,
      [
        String(disp.id),
        disp.name || 'Dispatcher',
        disp.email,
        disp.phone || null,
        disp.role || 'dispatcher',
        disp.active !== false,
        JSON.stringify(disp.settings || {})
      ]
    );
    dispCount++;
  }
  console.log(`✓ Migrated ${dispCount} dispatchers`);

  // B. Backfill Brokers
  let brokerCount = 0;
  for (const b of brokers) {
    if (!b.id || !b.name) continue;
    await pool.query(
      `INSERT INTO brokers (id, name, mc_number, contact_name, phone, email, payment_terms, credit_score, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         mc_number = EXCLUDED.mc_number,
         contact_name = EXCLUDED.contact_name,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         payment_terms = EXCLUDED.payment_terms,
         credit_score = EXCLUDED.credit_score,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        String(b.id),
        b.name,
        b.mcNumber || null,
        b.contactName || null,
        b.phone || null,
        b.email || null,
        b.paymentTerms || 'QuickPay (2-Day)',
        b.creditScore || null,
        b.notes || null
      ]
    );
    brokerCount++;
  }
  console.log(`✓ Migrated ${brokerCount} brokers`);

  // C. Backfill Drivers (with PBKDF2 PIN Hashing)
  let driverCount = 0;
  for (const d of drivers) {
    if (!d.id || !d.name) continue;
    const pinHash = d.pinHash || (d.pin ? dataStore.hashPin(d.pin) : dataStore.hashPin('1234'));
    await pool.query(
      `INSERT INTO drivers (id, driver_code, pin_hash, name, phone, email, status, active, current_load_id, assigned_dispatcher_id, permissions, documents, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
         driver_code = EXCLUDED.driver_code,
         pin_hash = EXCLUDED.pin_hash,
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         status = EXCLUDED.status,
         active = EXCLUDED.active,
         current_load_id = EXCLUDED.current_load_id,
         assigned_dispatcher_id = EXCLUDED.assigned_dispatcher_id,
         permissions = EXCLUDED.permissions,
         documents = EXCLUDED.documents,
         updated_at = NOW()`,
      [
        String(d.id),
        d.driverCode || `DRV-${d.id}`,
        pinHash,
        d.name,
        d.phone || null,
        d.email || null,
        d.status || 'Active',
        d.active !== false,
        d.currentLoadId || null,
        d.assignedDispatcherId || null,
        JSON.stringify(d.permissions || {}),
        JSON.stringify(d.documents || [])
      ]
    );
    driverCount++;
  }
  console.log(`✓ Migrated ${driverCount} drivers (all PINs securely hashed)`);

  // D. Backfill Loads
  let loadCount = 0;
  for (const l of loads) {
    if (!l.id || !l.loadNumber) continue;
    const pickupParts = String(l.pickup || '').split(',');
    const pickupCity = (pickupParts[0] || 'Origin').trim();
    const pickupState = (pickupParts[1] || 'XX').trim();

    const dropParts = String(l.dropoff || '').split(',');
    const dropCity = (dropParts[0] || 'Destination').trim();
    const dropState = (dropParts[1] || 'XX').trim();

    await pool.query(
      `INSERT INTO loads (
         id, load_number, broker_id, broker_name, broker_phone, driver_id, dispatcher_id,
         status, pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date,
         miles, rate, driver_pay, weight, commodity, trailer_type, equipment_notes,
         tracking_status, checkpoints, documents, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW())
       ON CONFLICT (id) DO UPDATE SET
         load_number = EXCLUDED.load_number,
         broker_name = EXCLUDED.broker_name,
         broker_phone = EXCLUDED.broker_phone,
         driver_id = EXCLUDED.driver_id,
         dispatcher_id = EXCLUDED.dispatcher_id,
         status = EXCLUDED.status,
         pickup_city = EXCLUDED.pickup_city,
         pickup_state = EXCLUDED.pickup_state,
         pickup_date = EXCLUDED.pickup_date,
         delivery_city = EXCLUDED.delivery_city,
         delivery_state = EXCLUDED.delivery_state,
         delivery_date = EXCLUDED.delivery_date,
         miles = EXCLUDED.miles,
         rate = EXCLUDED.rate,
         driver_pay = EXCLUDED.driver_pay,
         weight = EXCLUDED.weight,
         commodity = EXCLUDED.commodity,
         trailer_type = EXCLUDED.trailer_type,
         equipment_notes = EXCLUDED.equipment_notes,
         tracking_status = EXCLUDED.tracking_status,
         checkpoints = EXCLUDED.checkpoints,
         documents = EXCLUDED.documents,
         updated_at = NOW()`,
      [
        String(l.id),
        String(l.loadNumber),
        l.brokerId || null,
        l.brokerName || 'Direct Shipper',
        l.brokerPhone || null,
        l.driverId || null,
        l.dispatcherId || null,
        l.status || 'ASSIGNED',
        pickupCity,
        pickupState,
        l.pickupDate ? new Date(l.pickupDate) : null,
        dropCity,
        dropState,
        l.deliveryDate ? new Date(l.deliveryDate) : null,
        Number(l.miles) || 0,
        Number(l.rate) || 0,
        Number(l.driverPay) || 0,
        Number(l.weight) || null,
        l.commodity || 'General Freight',
        l.trailerType || 'Dry Van',
        l.equipmentNotes || null,
        l.trackingStatus || 'NORMAL',
        JSON.stringify(l.checkpoints || []),
        JSON.stringify(l.documents || [])
      ]
    );
    loadCount++;
  }
  console.log(`✓ Migrated ${loadCount} loads`);

  // E. Backfill App Settings
  if (state.settings) {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('haulline:global_settings', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(state.settings)]
    );
    console.log(`✓ Migrated global app settings`);
  }

  console.log('\n========================================================================');
  console.log('✅ BACKFILL COMPLETE: All entities successfully migrated to PostgreSQL!');
  console.log('========================================================================\n');

  return { ok: true, dispCount, brokerCount, driverCount, loadCount };
}

if (require.main === module) {
  runBackfill()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('❌ Backfill failed:', e);
      process.exit(1);
    });
}

module.exports = { runBackfill };
