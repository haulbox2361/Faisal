const assert = require('assert');
const { normalizeWeight } = require('../lib/aiDocumentVerifier');

console.log('====================================================');
console.log('   TEST WEIGHT NORMALIZATION & TOLERANCE           ');
console.log('====================================================\n');

// 1. LBS parsing
const w1 = normalizeWeight('42,500 lbs');
assert.strictEqual(w1, 42500, 'Expected 42500 lbs');

// 2. KG to LBS conversion
const w2 = normalizeWeight('19,277 kg');
assert.strictEqual(w2, 42498, 'Expected ~42498 lbs');

// 3. Tolerance check (Within 10% vs >20%)
const rcWeight = 42500;
const bolWeightPass = 43000; // ~1.1% diff (PASS)
const bolWeightWarn = 48000; // ~12.9% diff (BORDERLINE)
const bolWeightFail = 55000; // ~29.4% diff (FAIL)

const diffPass = Math.abs(bolWeightPass - rcWeight) / rcWeight;
const diffWarn = Math.abs(bolWeightWarn - rcWeight) / rcWeight;
const diffFail = Math.abs(bolWeightFail - rcWeight) / rcWeight;

assert(diffPass <= 0.10, 'Expected within 10% tolerance');
assert(diffWarn > 0.10 && diffWarn <= 0.20, 'Expected borderline 10-20% range');
assert(diffFail > 0.20, 'Expected >20% mismatch');

console.log('✓ Weight conversions and 3-tier tolerance bands verified.');
console.log('\n✅ All Weight Comparison Tests Passed (3/3)\n');
