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

  // Test 2: Rejection of non-document images
  console.log('\n🧪 2. Testing Non-document Photo: REJECTED...');
  const fakeAiNonDoc = {
    isDocument: false,
    detectedType: 'UNKNOWN',
    confidence: 0.15,
    quality: { isClear: false, cornersVisible: false },
  };
  const nonDocRes = verifier.evaluateBolVerification(fakeAiNonDoc, testLoad, null);
  assert.strictEqual(nonDocRes.status, 'REJECTED', 'Random photo must be REJECTED');
  assert(nonDocRes.reason.includes('not a Bill of Lading'), 'Expected invalid document rejection reason');
  console.log('  ✓ Random/non-document photo correctly REJECTED.');

  // Test 3: Rejection of BOL with missing shipper signature
  console.log('\n🧪 3. Testing BOL Missing Signature: REJECTED...');
  const fakeAiMissingSig = {
    isDocument: true,
    detectedType: 'BOL',
    confidence: 0.95,
    shipperSignatureDetected: false,
    extractedData: { shipperAddress: '123 Logistics Blvd, Dallas, TX 75201', weight: 42500 },
  };
  const missingSigRes = verifier.evaluateBolVerification(fakeAiMissingSig, testLoad, null);
  assert.strictEqual(missingSigRes.status, 'REJECTED', 'Unsigned BOL must be REJECTED');
  assert(missingSigRes.reason.includes('signature is missing'), 'Expected signature rejection reason');
  console.log('  ✓ Unsigned BOL correctly REJECTED.');

  // Test 4: Approval of valid BOL with signature & matching data
  console.log('\n🧪 4. Testing Valid Signed BOL: APPROVED...');
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
  assert.strictEqual(validBolRes.status, 'APPROVED', 'Valid BOL must be APPROVED');
  console.log('  ✓ Valid BOL correctly APPROVED.');

  // Test 5: Rejection of POD with missing receiver signature
  console.log('\n🧪 5. Testing POD Missing Consignee Signature: REJECTED...');
  const fakeAiMissingPodSig = {
    isDocument: true,
    detectedType: 'POD',
    confidence: 0.95,
    consigneeSignatureDetected: false,
    signatureDetected: false,
    extractedData: { consigneeAddress: '700 Warehouse St, Houston, TX 77001' },
  };
  const missingPodSigRes = verifier.evaluatePodVerification(fakeAiMissingPodSig, testLoad, null);
  assert.strictEqual(missingPodSigRes.status, 'REJECTED', 'Unsigned POD must be REJECTED');
  console.log('  ✓ Unsigned POD correctly REJECTED.');

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
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
