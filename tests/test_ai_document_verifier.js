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

  // Test 2: Standard BOL Verification (Default Rules: Approved)
  console.log('\n🧪 2. Testing BOL Evaluation: APPROVED...');
  const bolRes = await verifier.verifyDocument({
    documentType: 'BOL',
    loadData: testLoad,
    driverId: 'drv_test_101',
  });
  assert(bolRes.status === 'APPROVED' || bolRes.overallStatus === 'APPROVED', 'Expected BOL to be APPROVED');
  assert(bolRes.ocrData.shipperSignatureDetected === true, 'Expected shipper signature detected');
  console.log('  ✓ BOL correctly evaluated as APPROVED.');

  // Test 3: Standard POD Verification (Default Rules: Approved)
  console.log('\n🧪 3. Testing POD Evaluation: APPROVED...');
  const podRes = await verifier.verifyDocument({
    documentType: 'POD',
    loadData: testLoad,
    driverId: 'drv_test_101',
  });
  assert(podRes.status === 'APPROVED' || podRes.overallStatus === 'APPROVED', 'Expected POD to be APPROVED');
  assert(podRes.ocrData.consigneeSignatureDetected === true, 'Expected consignee signature detected');
  console.log('  ✓ POD correctly evaluated as APPROVED.');

  // Test 4: Database Storage & Validation Retrieval
  console.log('\n🧪 4. Testing Database Schema & Persistence...');
  await db.ensureSchema();
  const pool = db.getPool();
  const docRows = await pool.query('SELECT 1 FROM document_validations WHERE load_id = $1', ['HB-1042']);
  assert(docRows.rows.length > 0, 'Expected document_validations record in database');
  console.log('  ✓ Document validation properly persisted to PostgreSQL schema.');

  console.log('\n====================================================');
  console.log('   ✅ ALL OCR & VERIFICATION TESTS PASSED (4/4)      ');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
