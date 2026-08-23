const assert = require('assert');
const { validateBolDocument, validatePodDocument } = require('../lib/docValidator');
const dataStore = require('../lib/dataStore');

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---');

  // Test 1: BOL AI Optical Verification - Clean Document Auto-Approved
  const cleanBolResult = validateBolDocument({
    loadData: { pickupAddress: 'Dallas, TX', weight: 42500, loadNumber: '10425' },
    imageMeta: { isBlurry: false, cornersVisible: true, shipperSignaturePresent: true, detectedPickupAddress: 'Dallas, TX', detectedWeight: 42500 },
    base64: 'data:image/jpeg;base64,' + 'A'.repeat(6000)
  });
  assert.strictEqual(cleanBolResult.overallStatus, 'APPROVED', 'Clean BOL should be APPROVED');
  console.log('✓ Test 1 Passed: Clean BOL auto-approved (overallStatus = APPROVED)');

  // Test 2: BOL AI Optical Verification - Blurry Document flagged for Retake/Review
  const blurryBolResult = validateBolDocument({
    loadData: { pickupAddress: 'Dallas, TX', weight: 42500, loadNumber: '10425' },
    imageMeta: { isBlurry: true, cornersVisible: true, shipperSignaturePresent: true },
    base64: 'data:image/jpeg;base64,' + 'A'.repeat(6000)
  });
  assert.strictEqual(blurryBolResult.overallStatus, 'RETAKE_REQUIRED', 'Blurry BOL should be RETAKE_REQUIRED');
  console.log('✓ Test 2 Passed: Blurry BOL correctly flagged for review/retake (overallStatus = RETAKE_REQUIRED)');

  // Test 3: BOL Missing Signature - Flagged
  const noSigBolResult = validateBolDocument({
    loadData: { pickupAddress: 'Dallas, TX', weight: 42500, loadNumber: '10425' },
    imageMeta: { isBlurry: false, cornersVisible: true, shipperSignaturePresent: false },
    base64: 'data:image/jpeg;base64,' + 'A'.repeat(6000)
  });
  assert.strictEqual(noSigBolResult.overallStatus, 'RETAKE_REQUIRED', 'BOL missing signature flagged');
  console.log('✓ Test 3 Passed: BOL with missing signature correctly flagged (overallStatus = RETAKE_REQUIRED)');

  // Test 4: POD AI Optical Verification - Clean Document Auto-Approved
  const cleanPodResult = validatePodDocument({
    loadData: { dropoffAddress: 'Indianapolis, IN', loadNumber: '10425' },
    imageMeta: { isBlurry: false, cornersVisible: true, receiverSignaturePresent: true, detectedDropoffAddress: 'Indianapolis, IN' },
    base64: 'data:image/jpeg;base64,' + 'A'.repeat(6000)
  });
  assert.strictEqual(cleanPodResult.overallStatus, 'APPROVED', 'Clean POD should be APPROVED');
  console.log('✓ Test 4 Passed: Clean POD auto-approved (overallStatus = APPROVED)');

  // Test 5: POD Address Mismatch - Flagged for Dispatcher Review
  const mismatchPodResult = validatePodDocument({
    loadData: { dropoffAddress: 'Indianapolis, IN', loadNumber: '10425' },
    imageMeta: { isBlurry: false, cornersVisible: true, receiverSignaturePresent: true, detectedDropoffAddress: 'Miami, FL' },
    base64: 'data:image/jpeg;base64,' + 'A'.repeat(6000)
  });
  assert.strictEqual(mismatchPodResult.overallStatus, 'DISPATCHER_REVIEW', 'POD with mismatched address sent to DISPATCHER_REVIEW');
  console.log('✓ Test 5 Passed: POD with mismatched address sent to DISPATCHER_REVIEW');

  console.log('--- ALL BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('Verification tests failed:', err);
  process.exit(1);
});
