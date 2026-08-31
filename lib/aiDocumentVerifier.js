// HaulBoX Automated AI BOL & POD Document Verification Engine
// Performs Image Quality Check, Document Type Detection, OCR Extraction,
// Cross-Document RC Validation, Shipper/Receiver Signature Detection,
// and classifies documents into: APPROVED, PENDING_REVIEW, or REJECTED.

const kv = require('./kvstore');
const db = require('./db');

// Weight Normalization Helper
function normalizeWeight(val, unit = 'lbs') {
  if (val == null) return null;
  const str = String(val).toLowerCase();
  let num = typeof val === 'number' ? val : parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;
  const isKg = str.includes('kg') || unit === 'kg' || unit === 'kgs' || unit === 'kilograms';
  if (isKg) {
    num = num * 2.20462; // Convert KG to LBS
  }
  return Math.round(num);
}

// Address Normalization Helper (Handles standard USPS abbreviations)
function normalizeAddress(addr) {
  if (!addr) return '';
  return addr
    .toLowerCase()
    .replace(/\b(street|st\.?)\b/g, 'street')
    .replace(/\b(road|rd\.?)\b/g, 'road')
    .replace(/\b(avenue|ave\.?)\b/g, 'avenue')
    .replace(/\b(boulevard|blvd\.?)\b/g, 'boulevard')
    .replace(/\b(drive|dr\.?)\b/g, 'drive')
    .replace(/\b(lane|ln\.?)\b/g, 'lane')
    .replace(/\b(highway|hwy\.?)\b/g, 'highway')
    .replace(/\b(suite|ste\.?)\b/g, 'suite')
    .replace(/\b(north|n\.?)\b/g, 'north')
    .replace(/\b(south|s\.?)\b/g, 'south')
    .replace(/\b(east|e\.?)\b/g, 'east')
    .replace(/\b(west|w\.?)\b/g, 'west')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// String similarity (Token Jaccard + Substring containment for addresses)
function calculateAddressSimilarity(addrA, addrB) {
  const normA = normalizeAddress(addrA);
  const normB = normalizeAddress(addrB);
  if (!normA || !normB) return 0.5; // fallback
  if (normA === normB) return 1.0;
  if (normA.includes(normB) || normB.includes(normA)) return 0.95;

  const tokensA = new Set(normA.split(' ').filter(x => x.length > 1));
  const tokensB = new Set(normB.split(' ').filter(x => x.length > 1));
  if (!tokensA.size || !tokensB.size) return 0.5;

  let intersection = 0;
  tokensA.forEach(t => {
    if (tokensB.has(t)) intersection++;
  });
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

// Retrieve Mistral AI key from env, haulline:state (settings.aiMistralKey), or app_settings KV
async function getMistralApiKey() {
  // 1. Environment variable (Render / production)
  if (process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim()) {
    return process.env.MISTRAL_API_KEY.trim();
  }
  // 2. Primary state storage (dispatcher settings in haulline:state)
  try {
    const rawState = await kv.get('haulline:state');
    if (rawState) {
      const stateObj = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
      const mistralKey = stateObj?.settings?.aiMistralKey;
      if (mistralKey && String(mistralKey).trim()) {
        return String(mistralKey).trim();
      }
    }
  } catch (_) {}
  // 3. Fallback to standalone app_settings KV
  try {
    const raw = await kv.get('app_settings');
    if (raw) {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (s.aiMistralKey && String(s.aiMistralKey).trim()) {
        return String(s.aiMistralKey).trim();
      }
    }
  } catch (_) {}
  return '';
}

/**
 * Main verification entrypoint for BOL or POD uploads
 */
async function verifyDocument({
  documentType, // 'BOL' | 'POD'
  base64Data,
  mimeType = 'image/jpeg',
  loadData = {},
  driverId,
  stopType,
  stopNumber,
  expectedAddress,
  expectedWeight,
}) {
  const verifiedAt = new Date().toISOString();
  const documentId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  // 1. Resolve Mistral AI API key
  const apiKey = await getMistralApiKey();

  let aiExtraction = null;
  let ocrError = null;

  if (apiKey && base64Data) {
    try {
      aiExtraction = await callMistralVisionVerification({
        apiKey,
        base64: base64Data,
        mimeType,
        expectedType: documentType,
        expectedLoad: loadData,
      });
    } catch (err) {
      console.warn('[AI Verification] Mistral AI Vision call error:', err.message);
      ocrError = err.message;
    }
  } else if (!apiKey) {
    ocrError = 'Mistral API key not configured';
    console.warn('[AI Verification] No MISTRAL_API_KEY found in env or app_settings.');
  }

  // 2. Perform Strict 3-Tier Validation Logic with Stop Context
  const stopOptions = { stopType, stopNumber, expectedAddress, expectedWeight };
  let result;
  if (documentType.toUpperCase() === 'BOL') {
    result = evaluateBolVerification(aiExtraction, loadData, ocrError, stopOptions);
  } else {
    result = evaluatePodVerification(aiExtraction, loadData, ocrError, stopOptions);
  }

  result.documentId = documentId;
  result.loadId = loadData.loadNumber || loadData.id || 'HB-1042';
  result.driverId = driverId;
  result.verifiedAt = verifiedAt;
  result.stopType = stopType || (documentType.toUpperCase() === 'BOL' ? 'PICKUP' : 'DELIVERY');
  result.stopNumber = stopNumber != null ? Number(stopNumber) : 1;

  // 3. Store Verification Record & Audit Trail in DB & KV
  await storeVerificationResult(result);

  // 4. If Pending Review, create a Dispatcher Review Queue task
  if (result.status === 'PENDING_REVIEW' || result.overallStatus === 'PENDING_REVIEW' || result.overallStatus === 'DISPATCHER_REVIEW') {
    await createDispatcherIssue(result);
  }

  return result;
}

// 5. BOL Evaluation Logic (Strict 3-Tier Outcome)
function evaluateBolVerification(ai, load, ocrError, options = {}) {
  const issues = [];
  const validationResults = {
    imageQuality: 'PASS',
    docTypeMatch: 'PASS',
    signatureDetected: 'PASS',
    addressMatch: 'PASS',
    weightMatch: 'PASS',
  };

  // If OCR failed or was unavailable, NEVER silently auto-approve
  if (!ai) {
    validationResults.docTypeMatch = 'WARNING';
    validationResults.signatureDetected = 'WARNING';
    return {
      status: 'PENDING_REVIEW',
      overallStatus: 'PENDING_REVIEW',
      documentId: null,
      ocrData: {
        documentType: 'BOL',
        confidence: 0.50,
        ocrError: ocrError || 'OCR processing unavailable',
      },
      validationResults,
      reason: ocrError ? `AI Vision check held for Dispatch review (${ocrError})` : 'Held for human review.',
      issues: [ocrError || 'Automated OCR could not analyze document image'],
    };
  }

  // 1. Document Type Check & Non-document detection
  const detectedType = (ai.detectedType || '').toUpperCase().trim();
  const isDoc = ai.isDocument !== false && detectedType !== 'UNKNOWN' && detectedType !== 'OTHER';
  const typeConfidence = ai.confidence ?? 0.85;

  if (!isDoc || (detectedType !== 'BOL' && detectedType !== 'BILL OF LADING' && detectedType !== 'POD') || typeConfidence < 0.55) {
    validationResults.docTypeMatch = 'FAIL';
    issues.push(`Document type check flagged: detected "${detectedType || 'non-document'}" (${(typeConfidence * 100).toFixed(0)}% confidence).`);
  } else if (typeConfidence < 0.85) {
    validationResults.docTypeMatch = 'WARNING';
    issues.push(`Document type confidence is ${(typeConfidence * 100).toFixed(0)}% (marginal)`);
  }

  // 2. Image Quality Check
  const qualityPassed = ai.quality?.isClear !== false;
  const cornersVisible = ai.quality?.cornersVisible !== false;
  const shadowGlared = ai.quality?.heavyShadowOrGlare === true;

  if (!qualityPassed || !cornersVisible || shadowGlared) {
    const qualityReason = ai.quality?.reason || 'Image quality warning: Heavy shadow, blur, or cropped corners detected.';
    validationResults.imageQuality = 'FAIL';
    issues.push(qualityReason);
  }

  // 3. Signature Check
  const signatureDetected = ai.shipperSignatureDetected === true || (ai.signatureDetected === true && ai.consigneeSignatureDetected !== true);
  const signatureConfidence = ai.signatureConfidence ?? 0.90;

  if (!signatureDetected || ai.shipperSignatureDetected === false) {
    validationResults.signatureDetected = 'FAIL';
    issues.push('Shipper signature may be missing on the Bill of Lading.');
  } else if (signatureConfidence < 0.75) {
    validationResults.signatureDetected = 'WARNING';
    issues.push('Shipper signature detected with low clarity/contrast');
  }

  // 4. Address Validation (Per-stop aware)
  const extractedPickup = ai.extractedData?.shipperAddress || ai.extractedData?.pickupAddress || '';
  let expectedPickup = options.expectedAddress || '';
  if (!expectedPickup && load.pickupStops && load.pickupStops.length) {
    const sNum = Number(options.stopNumber || 1);
    const stop = load.pickupStops.find((s) => (s.stop_number || s.stopNumber) === sNum);
    if (stop) expectedPickup = stop.address || stop.city || '';
  }
  if (!expectedPickup) expectedPickup = load.pickup || load.pickupAddress || '';

  if (extractedPickup && expectedPickup) {
    const addressSim = calculateAddressSimilarity(extractedPickup, expectedPickup);
    if (addressSim < 0.55) {
      validationResults.addressMatch = 'FAIL';
      issues.push(`Pickup address discrepancy: BOL shows "${extractedPickup}" vs Expected "${expectedPickup}".`);
    } else if (addressSim < 0.85) {
      validationResults.addressMatch = 'WARNING';
      issues.push(`Pickup address minor discrepancy (${(addressSim * 100).toFixed(0)}% similarity)`);
    }
  }

  // 5. Weight Validation
  const extractedWeight = normalizeWeight(ai.extractedData?.weight);
  const expectedWeight = normalizeWeight(load.weight);

  if (extractedWeight && expectedWeight) {
    const diffPct = Math.abs(extractedWeight - expectedWeight) / expectedWeight;
    if (diffPct > 0.20) {
      validationResults.weightMatch = 'FAIL';
      issues.push(`Weight discrepancy: BOL shows ${extractedWeight.toLocaleString()} lbs vs Rate Confirmation ${expectedWeight.toLocaleString()} lbs (${(diffPct * 100).toFixed(1)}% difference).`);
    } else if (diffPct > 0.10) {
      validationResults.weightMatch = 'WARNING';
      issues.push(`Weight difference is ${(diffPct * 100).toFixed(1)}% (borderline 10-15%)`);
    }
  }

  // 6. Final Outcome Decision
  // NOTE: OCR NEVER approves or rejects documents automatically.
  // All uploads are placed into PENDING_REVIEW for human Dispatcher/Admin review.
  const finalStatus = 'PENDING_REVIEW';
  const reviewReason = issues.length > 0 ? issues.join('; ') : 'Awaiting Dispatcher/Admin review';

  return {
    status: finalStatus,
    overallStatus: finalStatus,
    documentType: 'BOL',
    ocrData: {
      documentType: 'BOL',
      confidence: typeConfidence,
      shipperName: ai.extractedData?.shipperName || null,
      shipperAddress: extractedPickup || null,
      consigneeName: ai.extractedData?.consigneeName || null,
      consigneeAddress: ai.extractedData?.consigneeAddress || null,
      weight: extractedWeight || null,
      pieces: ai.extractedData?.pieces || null,
      commodity: ai.extractedData?.commodity || null,
      proNumber: ai.extractedData?.proNumber || null,
      shipperSignatureDetected: ai.shipperSignatureDetected === true,
      consigneeSignatureDetected: ai.consigneeSignatureDetected === true,
      sealNumbers: ai.extractedData?.sealNumbers || [],
      issueDate: ai.extractedData?.issueDate || null,
    },
    validationResults,
    issues,
    reason: reviewReason,
  };
}

// 6. POD Evaluation Logic (Strict Outcome)
function evaluatePodVerification(ai, load, ocrError, options = {}) {
  const issues = [];
  const validationResults = {
    imageQuality: 'PASS',
    docTypeMatch: 'PASS',
    signatureDetected: 'PASS',
    addressMatch: 'PASS',
  };

  // If OCR failed or was unavailable, route to PENDING_REVIEW for human check
  if (!ai) {
    validationResults.docTypeMatch = 'WARNING';
    validationResults.signatureDetected = 'WARNING';
    return {
      status: 'PENDING_REVIEW',
      overallStatus: 'PENDING_REVIEW',
      documentId: null,
      ocrData: {
        documentType: 'POD',
        confidence: 0.50,
        ocrError: ocrError || 'OCR processing unavailable',
      },
      validationResults,
      reason: ocrError ? `AI Vision check held for Dispatch review (${ocrError})` : 'Held for human review.',
      issues: [ocrError || 'Automated OCR could not analyze document image'],
    };
  }

  // 1. Document Type Check & Non-document detection
  const detectedType = (ai.detectedType || '').toUpperCase().trim();
  const isDoc = ai.isDocument !== false && detectedType !== 'UNKNOWN' && detectedType !== 'OTHER';
  const typeConfidence = ai.confidence ?? 0.85;

  if (!isDoc || (detectedType !== 'POD' && detectedType !== 'PROOF OF DELIVERY' && detectedType !== 'BOL') || typeConfidence < 0.55) {
    validationResults.docTypeMatch = 'FAIL';
    issues.push(`Document type check flagged: detected "${detectedType || 'non-document'}" (${(typeConfidence * 100).toFixed(0)}% confidence).`);
  } else if (typeConfidence < 0.85) {
    validationResults.docTypeMatch = 'WARNING';
    issues.push(`Document type confidence is ${(typeConfidence * 100).toFixed(0)}% (marginal)`);
  }

  // 2. Image Quality Check
  const qualityPassed = ai.quality?.isClear !== false;
  const cornersVisible = ai.quality?.cornersVisible !== false;
  const shadowGlared = ai.quality?.heavyShadowOrGlare === true;

  if (!qualityPassed || !cornersVisible || shadowGlared) {
    const qualityReason = ai.quality?.reason || 'Image quality warning: Heavy shadow, blur, or cropped corners detected.';
    validationResults.imageQuality = 'FAIL';
    issues.push(qualityReason);
  }

  // 3. Consignee / Receiver Signature Check
  const signatureDetected = ai.consigneeSignatureDetected === true || ai.signatureDetected === true;
  const signatureConfidence = ai.signatureConfidence ?? 0.90;

  if (!signatureDetected || ai.consigneeSignatureDetected === false) {
    validationResults.signatureDetected = 'FAIL';
    issues.push('Receiver / Consignee signature may be missing on the Proof of Delivery.');
  } else if (signatureConfidence < 0.75) {
    validationResults.signatureDetected = 'WARNING';
    issues.push('Receiver signature detected with low clarity/contrast');
  }

  // 4. Address Validation (Drop-off Address - Per-stop aware)
  const extractedDropoff = ai.extractedData?.consigneeAddress || ai.extractedData?.deliveryAddress || '';
  let expectedDropoff = options.expectedAddress || '';
  if (!expectedDropoff && load.deliveryStops && load.deliveryStops.length) {
    const sNum = Number(options.stopNumber || 1);
    const stop = load.deliveryStops.find((s) => (s.stop_number || s.stopNumber) === sNum);
    if (stop) expectedDropoff = stop.address || stop.city || '';
  }
  if (!expectedDropoff) expectedDropoff = load.dropoff || load.dropoffAddress || load.deliveryAddress || '';

  if (extractedDropoff && expectedDropoff) {
    const addressSim = calculateAddressSimilarity(extractedDropoff, expectedDropoff);
    if (addressSim < 0.55) {
      validationResults.addressMatch = 'FAIL';
      issues.push(`Delivery address discrepancy: POD shows "${extractedDropoff}" vs Expected "${expectedDropoff}".`);
    } else if (addressSim < 0.85) {
      validationResults.addressMatch = 'WARNING';
      issues.push(`Delivery address minor discrepancy (${(addressSim * 100).toFixed(0)}% similarity)`);
    }
  }

  // 5. Final Outcome Decision: Always PENDING_REVIEW
  const finalStatus = 'PENDING_REVIEW';
  const reviewReason = issues.length > 0 ? issues.join('; ') : 'Awaiting Dispatcher/Admin review';

  return {
    status: finalStatus,
    overallStatus: finalStatus,
    documentType: 'POD',
    ocrData: {
      documentType: 'POD',
      confidence: typeConfidence,
      // Only include fields actually extracted by OCR — null means not found
      shipperName: ai.extractedData?.shipperName || null,
      shipperAddress: null,
      consigneeName: ai.extractedData?.consigneeName || null,
      consigneeAddress: extractedDropoff || null,
      weight: normalizeWeight(ai.extractedData?.weight) || null,
      pieces: ai.extractedData?.pieces || null,
      commodity: ai.extractedData?.commodity || null,
      proNumber: ai.extractedData?.proNumber || null,
      shipperSignatureDetected: ai.shipperSignatureDetected === true,
      consigneeSignatureDetected: ai.consigneeSignatureDetected === true,
      sealNumbers: ai.extractedData?.sealNumbers || [],
      issueDate: ai.extractedData?.issueDate || null,
    },
    validationResults,
    issues,
    reason: reviewReason,
  };
}

// 7. Mistral Vision API Call  strict zero-bias prompt (no positive example values)
async function callMistralVisionVerification({ apiKey, base64, mimeType, expectedType, expectedLoad }) {
  // IMPORTANT: JSON template shows null/false defaults  NOT positive defaults  to avoid model bias.
  const prompt = `You are a freight document inspector. Look at the photo carefully and answer HONESTLY based ONLY on what you can ACTUALLY SEE. DO NOT assume or guess.

STEP 1 - DOCUMENT TYPE:
Is this a photo of a real PRINTED freight document (Bill of Lading, Proof of Delivery)?
If YES: set isDocument=true, detectedType=BOL or POD.
If NO (photo of a laptop screen, phone screen, room, person, food, car, scenery, blank paper, or any object that is NOT a freight paper document): set isDocument=false, detectedType=UNKNOWN, confidence=0.05.

STEP 2 - SIGNATURES (look at the actual signature lines):
- shipperSignatureDetected: Is there a handwritten ink signature in the Shipper/Driver field? true ONLY if you can SEE an actual pen signature. Empty box = false. Typed name = false.
- consigneeSignatureDetected: Is there a handwritten ink signature in the Receiver/Consignee field? true ONLY if you can SEE an actual pen signature. Empty box = false.

STEP 3 - TEXT EXTRACTION: Extract text you can actually read. Return null if not visible.
Reference: Load#=${expectedLoad.loadNumber || expectedLoad.id || 'unknown'}, Pickup=${expectedLoad.pickupAddress || expectedLoad.pickup || ''}, Delivery=${expectedLoad.dropoffAddress || expectedLoad.dropoff || ''}, Weight=${expectedLoad.weight || '?'} lbs.

STEP 4 - IMAGE QUALITY: Is text readable? Are all 4 corners visible? Is there blur or glare?

Return ONLY valid JSON with HONEST values (negative defaults shown):
{"isDocument":false,"detectedType":"UNKNOWN","confidence":0.05,"quality":{"isClear":false,"cornersVisible":false,"heavyShadowOrGlare":false,"reason":"describe what you see"},"shipperSignatureDetected":false,"consigneeSignatureDetected":false,"signatureDetected":false,"signatureConfidence":0.0,"extractedData":{"documentType":null,"shipperName":null,"shipperAddress":null,"consigneeName":null,"consigneeAddress":null,"weight":null,"pieces":null,"commodity":null,"proNumber":null,"sealNumbers":[],"issueDate":null}}`;

  const cleanBase64 = base64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${cleanBase64}` } },
        ],
      }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Mistral API returned ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Mistral API returned empty response');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.warn('[AI Verification] Mistral non-JSON response:', content.substring(0, 200));
    throw new Error('Mistral response was not valid JSON');
  }

  // Defensive: missing fields default to rejection-safe values
  if (parsed.isDocument === undefined || parsed.isDocument === null) parsed.isDocument = false;
  if (!parsed.detectedType || !parsed.detectedType.trim()) parsed.detectedType = 'UNKNOWN';

  console.log(`[AI Verification] Mistral: isDocument=${parsed.isDocument}, type=${parsed.detectedType}, confidence=${parsed.confidence}, seen="${parsed.quality && parsed.quality.reason}"`);
  return parsed;
}

// 8. Storage & Audit Persistence
async function storeVerificationResult(result) {
  try {
    const key = `doc_verification:${result.documentId}`;
    await kv.set(key, JSON.stringify(result));

    // Append to load's verification history in KV
    const loadKey = `load_verifications:${result.loadId}`;
    const raw = await kv.get(loadKey).catch(() => null);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(result);
    await kv.set(loadKey, JSON.stringify(list.slice(0, 20)));

    // Save to Postgres document_validations table
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO document_validations (
        load_id, driver_id, document_type, overall_status, confidence,
        clarity_pass, address_match, weight_match, signature_present,
        rejection_reason, issues, extracted_data, validation_results, ocr_data, stop_type, stop_number, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id`,
      [
        result.loadId,
        result.driverId || null,
        result.documentType || 'BOL',
        result.status || result.overallStatus || 'PENDING_REVIEW', // fail closed
        result.ocrData?.confidence || 0.95,
        result.validationResults?.imageQuality === 'PASS',
        result.validationResults?.addressMatch === 'PASS',
        result.validationResults?.weightMatch !== 'FAIL',
        result.validationResults?.signatureDetected === 'PASS',
        result.status === 'REJECTED' ? result.reason : null,
        JSON.stringify(result.issues || []),
        JSON.stringify(result.ocrData || {}),
        JSON.stringify(result.validationResults || {}),
        JSON.stringify(result.ocrData || {}),
        result.stopType || null,
        result.stopNumber != null ? Number(result.stopNumber) : null,
      ]
    ).catch(e => console.warn('[AI Verification] Postgres insert non-fatal warning:', e.message));
  } catch (err) {
    console.error('[AI Verification] Failed to store result:', err);
  }
}

async function createDispatcherIssue(result) {
  try {
    const issueId = `issue_${Date.now()}`;
    const issue = {
      id: issueId,
      loadNumber: result.loadId,
      documentType: result.documentType,
      documentId: result.documentId,
      driverId: result.driverId,
      stopType: result.stopType || null,
      stopNumber: result.stopNumber || null,
      status: 'PENDING',
      reason: result.reason || 'Pending human verification',
      issues: result.issues,
      extractedData: result.ocrData,
      createdAt: result.verifiedAt,
    };
    const key = 'dispatcher_review_issues';
    const raw = await kv.get(key).catch(() => null);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(issue);
    await kv.set(key, JSON.stringify(list));

    // Save to Postgres dispatcher_review_queue table
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO dispatcher_review_queue (
        load_id, driver_id, document_type, status, reason, stop_type, stop_number, created_timestamp
      ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, NOW())`,
      [
        result.loadId,
        result.driverId || null,
        result.documentType || 'BOL',
        result.reason || 'Pending verification',
        result.stopType || null,
        result.stopNumber != null ? Number(result.stopNumber) : null,
      ]
    ).catch(e => console.warn('[AI Verification] Postgres review queue insert warning:', e.message));

    console.log(`[AI Verification] Created Dispatcher Review Issue ${issueId} for Load ${result.loadId}`);
  } catch (err) {
    console.error('[AI Verification] Failed to create dispatcher issue:', err);
  }
}

module.exports = {
  verifyDocument,
  evaluateBolVerification,
  evaluatePodVerification,
  normalizeWeight,
  normalizeAddress,
  calculateAddressSimilarity,
};
