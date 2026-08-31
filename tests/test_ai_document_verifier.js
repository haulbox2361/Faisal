const assert = require('assert');
const verifier = require('../lib/aiDocumentVerifier');
const db = require('../lib/db');

async function runTests() {
  console.log('====================================================');
  console.log('   HAULBOX AI OCR & 3-TIER VERIFICATION TEST SUITE  ');
  console.log('====================================================\n');

  const testLoad = {
    id: 'HB-1042',
    loadNumber: 'HB-1042',
    pickup: '123 Logistics Blvd, Dallas, TX 75201',
    pickupAddress: '123 Logistics Blvd, Dallas, TX 75201',
    dropoff: '700 Warehouse St, Houston, TX 77001',
    dropoffAddress: '700 Warehouse St, Houston, TX 77001',
    brokerName: 'Dallas Freight Distribution',
    weight: 42500,
  };

  // Test 1: Normalization & String Similarity Helpers
  console.log('🧪 1. Testing Address and Weight Normalizers...');
  assert.strictEqual(verifier.normalizeWeight('42,500 lbs'), 42500);
  assert.strictEqual(verifier.normalizeWeight('19,277 kg'), 42498);
  const simExact = verifier.calculateAddressSimilarity('123 Main St, Dallas TX', '123 Main Street Dallas TX');
  assert(simExact >= 0.85, `Expected >=0.85 similarity, got ${simExact}`);
  console.log('  ✓ Normalizers and similarity calculations accurate.');

  // Test 2: Non-document photo flags issue and routes to PENDING_REVIEW
  console.log('\n🧪 2. Testing Non-document Photo: Held for review with issue...');
  const fakeAiNonDoc = {
    isDocument: false,
    detectedType: 'UNKNOWN',
    confidence: 0.15,
    quality: { isClear: false, cornersVisible: false },
  };
  const nonDocRes = verifier.evaluateBolVerification(fakeAiNonDoc, testLoad, null);
  assert.strictEqual(nonDocRes.status, 'PENDING_REVIEW', 'Upload must produce PENDING_REVIEW for human dispatcher decision');
  assert.strictEqual(nonDocRes.validationResults.docTypeMatch, 'FAIL', 'Expected docTypeMatch FAIL');
  assert(nonDocRes.issues.some(i => i.includes('Document type check flagged')), 'Expected document type issue');
  console.log('  ✓ Non-document photo correctly routed to PENDING_REVIEW with flagged issue.');

  // Test 3: BOL with missing shipper signature flags issue and routes to PENDING_REVIEW
  console.log('\n🧪 3. Testing BOL Missing Signature: Held for review with issue...');
  const fakeAiMissingSig = {
    isDocument: true,
    detectedType: 'BOL',
    confidence: 0.95,
    shipperSignatureDetected: false,
    extractedData: { shipperAddress: '123 Logistics Blvd, Dallas, TX 75201', weight: 42500 },
  };
  const missingSigRes = verifier.evaluateBolVerification(fakeAiMissingSig, testLoad, null);
  assert.strictEqual(missingSigRes.status, 'PENDING_REVIEW', 'Upload must produce PENDING_REVIEW for human dispatcher decision');
  assert.strictEqual(missingSigRes.validationResults.signatureDetected, 'FAIL', 'Expected signatureDetected FAIL');
  assert(missingSigRes.issues.some(i => i.includes('Shipper signature may be missing')), 'Expected signature issue');
  console.log('  ✓ Unsigned BOL correctly routed to PENDING_REVIEW with flagged issue.');

  // Test 4: Valid BOL — OCR passes ALL checks but must still produce PENDING_REVIEW.
  // OCR can never produce APPROVED; only a human Dispatcher/Admin review can approve.
  console.log('\n🧪 4. Testing Valid Signed BOL: must be PENDING_REVIEW (awaiting human review)...');
  const fakeAiValidBol = {
    isDocument: true,
    detectedType: 'BOL',
    confidence: 0.95,
    shipperSignatureDetected: true,
    signatureDetected: true,
    quality: { isClear: true, cornersVisible: true, heavyShadowOrGlare: false },
    extractedData: {
      documentType: 'BOL',
      shipperAddress: '123 Logistics Blvd, Dallas, TX 75201',
      weight: 42500,
    },
  };
  const validBolRes = verifier.evaluateBolVerification(fakeAiValidBol, testLoad, null);
  assert.strictEqual(validBolRes.status, 'PENDING_REVIEW', 'Valid BOL must be PENDING_REVIEW — OCR cannot auto-approve');
  assert(validBolRes.reason && validBolRes.reason.length > 0, 'Expected a review reason message');
  // OCR data must not contain hardcoded fake fallback values
  assert.strictEqual(validBolRes.ocrData.proNumber, null, 'proNumber must be null when not found in OCR');
  assert.strictEqual(validBolRes.ocrData.sealNumbers.length, 0, 'sealNumbers must be empty when not found in OCR');
  console.log('  ✓ Valid BOL correctly produces PENDING_REVIEW (awaiting Dispatcher approval).');

  // Test 5: POD with missing receiver signature flags issue and routes to PENDING_REVIEW
  console.log('\n🧪 5. Testing POD Missing Consignee Signature: Held for review with issue...');
  const fakeAiMissingPodSig = {
    isDocument: true,
    detectedType: 'POD',
    confidence: 0.95,
    consigneeSignatureDetected: false,
    signatureDetected: false,
    extractedData: { consigneeAddress: '700 Warehouse St, Houston, TX 77001' },
  };
  const missingPodSigRes = verifier.evaluatePodVerification(fakeAiMissingPodSig, testLoad, null);
  assert.strictEqual(missingPodSigRes.status, 'PENDING_REVIEW', 'Upload must produce PENDING_REVIEW for human dispatcher decision');
  assert.strictEqual(missingPodSigRes.validationResults.signatureDetected, 'FAIL', 'Expected signatureDetected FAIL');
  assert(missingPodSigRes.issues.some(i => i.includes('Receiver / Consignee signature may be missing')), 'Expected signature issue');
  console.log('  ✓ Unsigned POD correctly routed to PENDING_REVIEW with flagged issue.');

  // Test 6: Database Storage & Validation Retrieval
  console.log('\n🧪 6. Testing Database Schema & Persistence...');
  await db.ensureSchema();
  const pool = db.getPool();
  await verifier.verifyDocument({
    documentType: 'BOL',
    loadData: testLoad,
    driverId: 'drv_test_101',
  });
  const docRows = await pool.query('SELECT 1 FROM document_validations WHERE load_id = $1', ['HB-1042']);
  assert(docRows.rows.length > 0, 'Expected document_validations record in database');
  console.log('  ✓ Document validation properly persisted to PostgreSQL schema.');

  console.log('\n====================================================');
  console.log('   ✅ ALL OCR & VERIFICATION TESTS PASSED (6/6)      ');
  console.log('   (Policy: OCR never auto-approves; human review required)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
