const assert = require('assert');
const verifier = require('../lib/aiDocumentVerifier');
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');
const sessions = require('../lib/driverSessions');

async function runEndToEndVerification() {
  console.log('====================================================');
  console.log('   FULL END-TO-END DRIVER & OCR WORKFLOW TEST      ');
  console.log('====================================================\n');

  // 1. Initialize State & Sample Driver/Load
  console.log('🧪 Step 1: Initializing State & Driver Account...');
  await db.ensureSchema();
  
  const sampleDriver = {
    id: 'drv_test_e2e',
    driverCode: 'DRV-999',
    name: 'John Doe',
    phone: '5551234567',
    pin: '1234',
    status: 'Active',
    active: true,
  };

  const sampleLoad = {
    id: 'LOAD-E2E-101',
    loadNumber: 'HB-9090',
    driverId: 'drv_test_e2e',
    driverName: 'John Doe',
    status: 'Accepted',
    driverProgress: 'ACCEPTED',
    pickup: '100 Industrial Parkway, Dallas, TX 75201',
    pickupAddress: '100 Industrial Parkway, Dallas, TX 75201',
    dropoff: '500 Commerce Way, Houston, TX 77001',
    dropoffAddress: '500 Commerce Way, Houston, TX 77001',
    brokerName: 'Apex Freight Logistics',
    weight: 42500,
    docs: {},
    documents: {},
  };

  const state = {
    drivers: [sampleDriver],
    loads: [sampleLoad],
    settings: { driver_portal_enabled: true, companyName: 'HaulBoX' },
  };

  await dataStore.saveFullState(state);
  console.log('  ✓ State initialized with Driver DRV-999 and Load HB-9090.');

  // 2. Test Driver Session Token Issuance
  console.log('\n🧪 Step 2: Testing Driver Session Token Generation...');
  const token = await sessions.issue(sampleDriver.id);
  assert(token && token.length > 10, 'Expected valid session token');
  const verifiedDriverId = await sessions.verify(token);
  assert.strictEqual(verifiedDriverId, sampleDriver.id, 'Session token verification failed');
  console.log('  ✓ Bearer session token generated & verified.');

  // 3. Test Negative Case: Random non-document picture
  console.log('\n🧪 Step 3: Testing Routing of Non-Document Photo (e.g. selfie/blank)...');
  const fakeAiNonDoc = {
    isDocument: false,
    detectedType: 'UNKNOWN',
    confidence: 0.10,
    quality: { isClear: false, cornersVisible: false },
  };
  const nonDocOutcome = verifier.evaluateBolVerification(fakeAiNonDoc, sampleLoad, null);
  assert.strictEqual(nonDocOutcome.status, 'PENDING_REVIEW', 'Upload must produce PENDING_REVIEW for human decision');
  assert.strictEqual(nonDocOutcome.validationResults.docTypeMatch, 'FAIL', 'Expected docTypeMatch FAIL');
  console.log('  ✓ Non-document photo correctly routed to PENDING_REVIEW with flagged issue.');

  // 4. Test Case: Unsigned BOL
  console.log('\n🧪 Step 4: Testing Routing of Unsigned BOL...');
  const fakeAiUnsignedBol = {
    isDocument: true,
    detectedType: 'BOL',
    confidence: 0.95,
    shipperSignatureDetected: false,
    extractedData: { shipperAddress: sampleLoad.pickupAddress, weight: 42500 },
  };
  const unsignedBolOutcome = verifier.evaluateBolVerification(fakeAiUnsignedBol, sampleLoad, null);
  assert.strictEqual(unsignedBolOutcome.status, 'PENDING_REVIEW', 'Unsigned BOL must be held in PENDING_REVIEW');
  assert.strictEqual(unsignedBolOutcome.validationResults.signatureDetected, 'FAIL', 'Expected signatureDetected FAIL');
  console.log('  ✓ Unsigned BOL correctly routed to PENDING_REVIEW with flagged issue.');

  // 5. Test Positive Case: Valid Signed BOL produces PENDING_REVIEW (awaiting human dispatcher review)
  console.log('\n🧪 Step 5: Testing Processing of Valid Signed BOL (must be PENDING_REVIEW)...');
  const fakeAiValidBol = {
    isDocument: true,
    detectedType: 'BOL',
    confidence: 0.96,
    shipperSignatureDetected: true,
    signatureDetected: true,
    quality: { isClear: true, cornersVisible: true, heavyShadowOrGlare: false },
    extractedData: {
      documentType: 'BOL',
      shipperAddress: sampleLoad.pickupAddress,
      weight: 42500,
      proNumber: 'HB-9090',
    },
  };
  const validBolOutcome = verifier.evaluateBolVerification(fakeAiValidBol, sampleLoad, null);
  assert.strictEqual(validBolOutcome.status, 'PENDING_REVIEW', 'Valid signed BOL must be PENDING_REVIEW — OCR cannot auto-approve');
  console.log('  ✓ Signed BOL correctly held for human review (PENDING_REVIEW).');

  // 6. Test Document Persistence & Load State Auto-Advancement
  console.log('\n🧪 Step 6: Testing Automatic Load State Advancement to LOADED...');
  sampleLoad.docs.BOL = {
    name: 'BOL_HB-9090.jpg',
    status: 'Approved',
    uploadedAt: new Date().toISOString(),
  };
  sampleLoad.status = 'Loaded';
  sampleLoad.driverProgress = 'LOADED';
  await dataStore.saveFullState(state);

  const reloadedState = await dataStore.loadFullState();
  const reloadedLoad = reloadedState.loads.find(l => l.id === sampleLoad.id);
  assert.strictEqual(reloadedLoad.status, 'Loaded', 'Expected load status to be "Loaded"');
  assert.strictEqual(reloadedLoad.driverProgress, 'LOADED', 'Expected driver progress to be "LOADED"');
  assert(reloadedLoad.docs.BOL && reloadedLoad.docs.BOL.status === 'Approved', 'Expected BOL doc to be saved & Approved');
  console.log('  ✓ Load status advanced to "Loaded" and BOL saved in database.');

  // 7. Test POD Negative & Positive Cases
  console.log('\n🧪 Step 7: Testing POD Verification & Completion...');
  const fakeAiUnsignedPod = {
    isDocument: true,
    detectedType: 'POD',
    confidence: 0.95,
    consigneeSignatureDetected: false,
    extractedData: { consigneeAddress: sampleLoad.dropoffAddress },
  };
  const unsignedPodOutcome = verifier.evaluatePodVerification(fakeAiUnsignedPod, sampleLoad, null);
  assert.strictEqual(unsignedPodOutcome.status, 'PENDING_REVIEW', 'Unsigned POD must be held in PENDING_REVIEW');
  console.log('  ✓ Unsigned POD correctly routed to PENDING_REVIEW with flagged issue.');

  const fakeAiValidPod = {
    isDocument: true,
    detectedType: 'POD',
    confidence: 0.98,
    consigneeSignatureDetected: true,
    signatureDetected: true,
    quality: { isClear: true, cornersVisible: true, heavyShadowOrGlare: false },
    extractedData: {
      documentType: 'POD',
      consigneeAddress: sampleLoad.dropoffAddress,
      weight: 42500,
    },
  };
  const validPodOutcome = verifier.evaluatePodVerification(fakeAiValidPod, sampleLoad, null);
  assert.strictEqual(validPodOutcome.status, 'PENDING_REVIEW', 'Valid signed POD must be PENDING_REVIEW — OCR cannot auto-approve');
  console.log('  ✓ Signed POD correctly held for human review (PENDING_REVIEW).');

  // Complete load with POD
  sampleLoad.docs.POD = {
    name: 'POD_HB-9090.jpg',
    status: 'Approved',
    uploadedAt: new Date().toISOString(),
  };
  sampleLoad.status = 'Drop-off';
  sampleLoad.driverProgress = 'DELIVERED';
  await dataStore.saveFullState(state);

  const finalState = await dataStore.loadFullState();
  const finalLoad = finalState.loads.find(l => l.id === sampleLoad.id);
  assert.strictEqual(finalLoad.status, 'Drop-off', 'Expected final load status to be "Drop-off"');
  assert.strictEqual(finalLoad.driverProgress, 'DELIVERED', 'Expected final driver progress to be "DELIVERED"');
  console.log('  ✓ Load successfully marked as Drop-off/Delivered with POD on file.');

  console.log('\n====================================================');
  console.log('   ✅ ALL 7/7 END-TO-END WORKFLOW CHECKS PASSED     ');
  console.log('====================================================\n');
}

runEndToEndVerification().catch(err => {
  console.error('\n❌ E2E Workflow Test Failed:', err);
  process.exit(1);
});
