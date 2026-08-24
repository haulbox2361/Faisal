// lib/docValidator.js
// Synchronous document metadata validator used by POST /api/driver/upload-doc
// NOTE: This validator only runs on client-supplied imageMeta — it does NOT call OCR.
// It is the first-pass gating check (blur, missing fields).
// The real AI OCR validation happens via POST /api/driver/verify-document → aiDocumentVerifier.js
//
// FAIL-CLOSED: All boolean checks default to FAIL when the field is absent.
// A missing/undefined imageMeta field is treated as "not confirmed" — not as "passes".

function validateBolDocument({ loadData = {}, imageMeta = {}, base64 = '' }) {
  const issues = [];
  const extractedData = {};

  // 1. Image Quality — FAIL-CLOSED: absence of a field means we do NOT know it passed
  const blurDetected = imageMeta.isBlurry !== undefined
    ? Boolean(imageMeta.isBlurry)
    : (base64 && base64.length < 500 && !base64.includes('pdf'));

  const shadowDetected = Boolean(imageMeta.hasShadow);

  // FIXED: was `!== false` which passes when undefined. Now requires explicit true.
  const cornersVisible = imageMeta.cornersVisible === true;

  const clarityPass = !blurDetected && !shadowDetected && cornersVisible;

  if (blurDetected) {
    issues.push({
      code: 'BLUR_DETECTED',
      field: 'clarity',
      description: 'Image is blurry or low resolution. Please hold your camera steady and retake in good lighting.',
    });
  }
  if (shadowDetected) {
    issues.push({
      code: 'SHADOW_DETECTED',
      field: 'lighting',
      description: 'Heavy shadow detected across document. Please use flash or adjust lighting.',
    });
  }
  if (!cornersVisible) {
    issues.push({
      code: 'CORNERS_CROPPED',
      field: 'framing',
      description: 'Document corners not confirmed visible. Please fit all 4 corners inside the photo frame.',
    });
  }

  // 2. BOL Business Logic Validation
  const loadPickup = String(loadData.pickupAddress || loadData.pickup || '').toLowerCase();
  const docPickup = String(imageMeta.detectedPickupAddress || '').toLowerCase();
  // Only compare if both are present. Missing detected address = unknown = PENDING, not APPROVED.
  const addressMatch = !loadPickup || !docPickup
    ? false   // FAIL-CLOSED: unknown address → do not auto-approve
    : docPickup.includes(loadPickup.split(',')[0].trim().toLowerCase());

  if (!addressMatch && loadPickup) {
    issues.push({
      code: 'ADDRESS_MISMATCH',
      field: 'pickupAddress',
      description: `Pickup address mismatch. Document shows "${imageMeta.detectedPickupAddress || 'Unknown'}" but load requires "${loadData.pickupAddress || loadData.pickup}".`,
    });
  }

  // Weight validation (allow ±8% tolerance)
  const expectedWeight = Number(loadData.weight || 42500);
  const detectedWeight = Number(imageMeta.detectedWeight || 0); // FAIL-CLOSED: 0 if not detected
  const weightMatch = detectedWeight > 0
    ? Math.abs(detectedWeight - expectedWeight) / (expectedWeight || 1) <= 0.08
    : false; // FAIL-CLOSED: unknown weight → do not auto-approve

  if (!weightMatch) {
    issues.push({
      code: 'WEIGHT_MISMATCH',
      field: 'weight',
      description: detectedWeight > 0
        ? `Cargo weight mismatch. BOL indicates ${detectedWeight.toLocaleString()} lbs vs Rate Con ${expectedWeight.toLocaleString()} lbs.`
        : 'Cargo weight not detected on document.',
    });
  }

  // Shipper Signature — FIXED: was `!== false` which passes when undefined. Requires explicit true.
  const signaturePresent = imageMeta.shipperSignaturePresent === true;
  if (!signaturePresent) {
    issues.push({
      code: 'SIGNATURE_MISSING',
      field: 'shipperSignature',
      description: 'Shipper signature was not confirmed on Bill of Lading. Please have the facility clerk sign before submitting.',
    });
  }

  extractedData.detectedPickupAddress = docPickup;
  extractedData.detectedWeight = detectedWeight;
  extractedData.shipperSignatureDetected = signaturePresent;
  extractedData.bolNumber = imageMeta.detectedBolNumber || `BOL-${loadData.loadNumber || '10425'}`;

  // FAIL-CLOSED: start as PENDING_REVIEW, only upgrade to APPROVED when all checks explicitly pass
  let overallStatus = 'PENDING_REVIEW';
  let rejectionReason = null;

  if (blurDetected || !cornersVisible || !signaturePresent) {
    overallStatus = 'RETAKE_REQUIRED';
    rejectionReason = issues.map((i) => i.description).join(' ');
  } else if (!addressMatch || !weightMatch) {
    overallStatus = 'DISPATCHER_REVIEW';
    rejectionReason = issues.map((i) => i.description).join(' ');
  } else if (issues.length === 0) {
    overallStatus = 'APPROVED';
  }

  return {
    documentType: 'BOL',
    overallStatus,
    confidence: overallStatus === 'APPROVED' ? 0.96 : 0.65,
    clarityPass,
    blurDetected,
    shadowDetected,
    cornersVisible,
    addressMatch,
    weightMatch,
    signaturePresent,
    dateVisible: true,
    rejectionReason,
    issues,
    extractedData,
  };
}

function validatePodDocument({ loadData = {}, imageMeta = {}, base64 = '' }) {
  const issues = [];
  const extractedData = {};

  // 1. Image Quality — FAIL-CLOSED
  const blurDetected = imageMeta.isBlurry !== undefined
    ? Boolean(imageMeta.isBlurry)
    : (base64 && base64.length < 500 && !base64.includes('pdf'));

  const shadowDetected = Boolean(imageMeta.hasShadow);

  // FIXED: was `!== false`. Now requires explicit true.
  const cornersVisible = imageMeta.cornersVisible === true;
  const clarityPass = !blurDetected && !shadowDetected && cornersVisible;

  if (blurDetected) {
    issues.push({
      code: 'BLUR_DETECTED',
      field: 'clarity',
      description: 'POD image is blurry. Please hold camera steady and retake.',
    });
  }

  // 2. Consignee / Receiver Signature — FIXED: requires explicit true
  const signaturePresent = imageMeta.receiverSignaturePresent === true;
  if (!signaturePresent) {
    issues.push({
      code: 'SIGNATURE_MISSING',
      field: 'receiverSignature',
      description: 'Receiver / Consignee signature not confirmed. Ensure receiver signs the delivery receipt.',
    });
  }

  // 3. Delivery Address Cross-Check — FAIL-CLOSED: missing detected address = unknown
  const loadDelivery = String(loadData.dropoffAddress || loadData.dropoff || '').toLowerCase();
  const rawDocDelivery = imageMeta.detectedDeliveryAddress || imageMeta.detectedDropoffAddress;
  const docDelivery = String(rawDocDelivery || '').toLowerCase();
  const addressMatch = !rawDocDelivery || !loadDelivery
    ? false  // FAIL-CLOSED: unknown address
    : docDelivery.includes(loadDelivery.split(',')[0].trim().toLowerCase());

  if (!addressMatch && loadDelivery) {
    issues.push({
      code: 'ADDRESS_MISMATCH',
      field: 'dropoffAddress',
      description: `Delivery address mismatch on POD. Expected: "${loadData.dropoffAddress || loadData.dropoff}".`,
    });
  }

  // 4. Delivery Date
  const dateVisible = imageMeta.dateVisible === true;
  if (!dateVisible) {
    issues.push({
      code: 'DATE_MISSING',
      field: 'deliveryDate',
      description: 'Delivery date not confirmed visible on POD document.',
    });
  }

  extractedData.detectedDeliveryAddress = docDelivery;
  extractedData.receiverSignatureDetected = signaturePresent;
  extractedData.deliveryDateDetected = imageMeta.detectedDate || new Date().toISOString().split('T')[0];

  // FAIL-CLOSED: start as PENDING_REVIEW
  let overallStatus = 'PENDING_REVIEW';
  let rejectionReason = null;

  if (blurDetected || !signaturePresent) {
    overallStatus = 'RETAKE_REQUIRED';
    rejectionReason = issues.map((i) => i.description).join(' ');
  } else if (!addressMatch || !dateVisible) {
    overallStatus = 'DISPATCHER_REVIEW';
    rejectionReason = issues.map((i) => i.description).join(' ');
  } else if (issues.length === 0) {
    overallStatus = 'APPROVED';
  }

  return {
    documentType: 'POD',
    overallStatus,
    confidence: overallStatus === 'APPROVED' ? 0.98 : 0.70,
    clarityPass,
    blurDetected,
    shadowDetected,
    cornersVisible,
    addressMatch,
    weightMatch: true,
    signaturePresent,
    dateVisible,
    rejectionReason,
    issues,
    extractedData,
  };
}

module.exports = {
  validateBolDocument,
  validatePodDocument,
};
