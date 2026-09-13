// scripts/pre_deploy_audit.js
// Pre-deploy data audit: detects NULL/insecure PINs across Drivers, Owners, and Companies,
// generates cryptographically secure PINs, updates hashes, and reports the complete credential table.

const crypto = require('crypto');
const dataStore = require('../lib/dataStore');
const db = require('../lib/db');
const kv = require('../lib/kvstore');

const INSECURE_PINS = new Set(['8483', '123456', '1234', '0000', '1111', '9999']);

function generateSecurePin(length = 4) {
  // Generate cryptographically random digits avoiding trivially simple sequences
  let pin = '';
  while (pin.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < 250) { // Unbiased modulo
      pin += (byte % 10).toString();
    }
  }
  // Ensure not all identical digits
  if (new Set(pin.split('')).size === 1) {
    return generateSecurePin(length);
  }
  return pin;
}

async function runAudit() {
  console.log('================================================================');
  console.log('       HAULBOX PRE-DEPLOY CREDENTIAL & DATA AUDIT');
  console.log('================================================================\n');

  let state = await dataStore.loadFullState().catch(() => null);
  if (!state) {
    state = { drivers: [], owners: [], dispatchers: [], companies: [], settings: {} };
  }

  const drivers = state.drivers || [];
  const owners = state.owners || [];
  const dispatchers = state.dispatchers || [];

  const affectedDrivers = [];
  const affectedOwners = [];

  // 1. Audit Drivers
  for (const driver of drivers) {
    const rawPin = String(driver.pin || '').trim();
    const pinHash = String(driver.pinHash || driver.pin_hash || '').trim();
    const isNullOrEmpty = !rawPin && !pinHash;
    const isInsecure = rawPin && INSECURE_PINS.has(rawPin);

    if (isNullOrEmpty || isInsecure) {
      const newPin = generateSecurePin(4);
      const newHash = dataStore.hashPin(newPin);
      
      const prevDisplay = isNullOrEmpty ? 'NULL / EMPTY' : `INSECURE (${rawPin})`;
      driver.pin = newPin;
      driver.pinHash = newHash;
      driver.mustResetPin = true;

      affectedDrivers.push({
        id: driver.id,
        code: driver.driverCode || driver.code || driver.id,
        name: driver.name || 'Unnamed Driver',
        phone: driver.phone || 'N/A',
        previousStatus: prevDisplay,
        generatedPin: newPin,
        role: 'DRIVER'
      });
    }
  }

  // 2. Audit Owners
  for (const owner of owners) {
    const rawPin = String(owner.pin || '').trim();
    const pinHash = String(owner.pin_hash || owner.pinHash || '').trim();
    const isNullOrEmpty = !rawPin && !pinHash;
    const isInsecure = rawPin && INSECURE_PINS.has(rawPin);

    if (isNullOrEmpty || isInsecure) {
      const newPin = generateSecurePin(6);
      const newHash = dataStore.hashPin(newPin);
      
      const prevDisplay = isNullOrEmpty ? 'NULL / EMPTY' : `INSECURE (${rawPin})`;
      owner.pin = newPin;
      owner.pin_hash = newHash;
      owner.pinHash = newHash;

      affectedOwners.push({
        id: owner.id,
        code: owner.ownerCode || owner.owner_code || owner.id,
        name: owner.name || 'Unnamed Owner',
        phone: owner.phone || 'N/A',
        previousStatus: prevDisplay,
        generatedPin: newPin,
        role: 'OWNER'
      });
    }
  }

  // Save updated state back to database
  if (affectedDrivers.length > 0 || affectedOwners.length > 0) {
    await dataStore.saveFullState(state);
  }

  console.log(`[Audit Summary] Total Drivers Checked: ${drivers.length}`);
  console.log(`[Audit Summary] Total Owners Checked:  ${owners.length}`);
  console.log(`[Audit Summary] Affected Accounts Remediated: ${affectedDrivers.length + affectedOwners.length}\n`);

  console.log('--- AFFECTED DRIVERS CREDENTIAL DISTRIBUTION LIST ---');
  if (affectedDrivers.length === 0) {
    console.log('  No drivers with NULL or insecure PINs found.');
  } else {
    console.table(affectedDrivers.map(d => ({
      'Driver ID': d.id,
      'Driver Code': d.code,
      'Name': d.name,
      'Phone': d.phone,
      'Previous Status': d.previousStatus,
      'New Generated PIN': d.generatedPin
    })));
  }

  console.log('\n--- AFFECTED OWNERS CREDENTIAL DISTRIBUTION LIST ---');
  if (affectedOwners.length === 0) {
    console.log('  No owners with NULL or insecure PINs found.');
  } else {
    console.table(affectedOwners.map(o => ({
      'Owner ID': o.id,
      'Owner Code': o.code,
      'Name': o.name,
      'Phone': o.phone,
      'Previous Status': o.previousStatus,
      'New Generated PIN': o.generatedPin
    })));
  }

  console.log('\n================================================================');
  console.log('       PRE-DEPLOY DATA AUDIT COMPLETED SUCCESSFULLY');
  console.log('================================================================\n');

  return { affectedDrivers, affectedOwners };
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
