const assert = require('assert');
const { normalizeAddress, calculateAddressSimilarity } = require('../lib/aiDocumentVerifier');

console.log('====================================================');
console.log('   TEST ADDRESS NORMALIZER & SIMILARITY            ');
console.log('====================================================\n');

// 1. Basic Normalization
const norm1 = normalizeAddress('123 Main St., Dallas, TX 75201');
const norm2 = normalizeAddress('123 Main Street Dallas TX 75201');
assert.strictEqual(norm1, norm2, 'Normalized address strings should match exactly');
console.log('✓ USPS Street abbreviations match normalized forms.');

// 2. High Similarity Match (>85%)
const simHigh = calculateAddressSimilarity('700 Warehouse Rd, Houston TX', '700 Warehouse Road, Houston, TX 77001');
assert(simHigh >= 0.85, `Expected >=0.85 similarity, got ${simHigh}`);
console.log('✓ High similarity detected for minor variations.');

// 3. Low Similarity Mismatch (<60%)
const simLow = calculateAddressSimilarity('100 Main St, Dallas TX', '900 Broadway Ave, New York NY');
assert(simLow < 0.60, `Expected <0.60 similarity, got ${simLow}`);
console.log('✓ Correctly rejects mismatching addresses.');

console.log('\n✅ All Address Normalizer Tests Passed (3/3)\n');
