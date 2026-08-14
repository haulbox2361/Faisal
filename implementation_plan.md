# Implementation Plan - Mistral AI Extraction, Auto-Fill, PDF Handling & BOL/POD Address Validation Fix

Fix all issues in the Mistral AI extraction pipeline, document handling, form auto-fill, driver portal synchronization, and address comparison logic.

## User Review Required

> [!IMPORTANT]
> All changes preserve backward compatibility with other AI providers (Gemini, Claude, OCR.space) while repairing and hardening the Mistral AI integration end-to-end.

## Proposed Changes

### Backend: Mistral API Proxy & PDF / OCR Support
#### [MODIFY] [routes/mistral.js](file:///c:/HaulBoX/haulbox-restored/Faisal/routes/mistral.js)
- Add `router.use(express.json({ limit: '25mb' }))` so requests with base64 documents are properly parsed.
- Add support for loading `process.env.MISTRAL_API_KEY` when `apiKey` is not sent or is set to `env`.
- Add PDF handling for Mistral:
  - If `isPdf` or `mediaType === 'application/pdf'`, support Mistral's OCR endpoint (`/v1/ocr`) or formatted document extraction payload with `document_url` (`data:application/pdf;base64,...`) and fallback strategy.
  - If image, format as `image_url` for `pixtral-12b-2409` / `pixtral-large-latest`.
- Add structured debug logging:
  - Log upload received, payload size, model, Mistral request dispatch, status code, response parse, and extraction result.
- Clean and normalize JSON response extraction from Mistral markdown code fences.

#### [MODIFY] [routes/driver.js](file:///c:/HaulBoX/haulbox-restored/Faisal/routes/driver.js)
- In `POST /api/driver/upload-doc`, when a driver uploads a BOL or POD, trigger asynchronous/non-blocking OCR address extraction using the configured AI provider (or Mistral backend helper) and store the result in `load.ocrValidation.bolAddress` or `load.ocrValidation.podAddress`.
- Execute address comparison against `load.pickup` (for BOL) or `load.dropoff` (for POD) and set `load.ocrValidation.pickupMatch` / `load.ocrValidation.deliveryMatch` and comparison details.

---

### Frontend: RC Extraction, Auto-Fill, and Address Validation
#### [MODIFY] [public/index.html](file:///c:/HaulBoX/haulbox-restored/Faisal/public/index.html)
- In `callMistralForDoc()`:
  - Ensure clear error reporting when Mistral fails without swallowing the error into silent false positives.
  - Add debug console logs at each step (request created, request sent, response received).
- In `extractRcWithAI()`:
  - If AI extraction fails, display an accurate warning/error in the UI (`setRcAiStatus('err', 'Extraction failed: ...')`) instead of falsely claiming `"RC uploaded — load fields updated."`.
  - Fix the auto-fill pipeline in `applyExtractedRcData()` to ensure all extracted keys (`load_number`, `pickup_date`, `delivery_date`, `pickup`, `dropoff`, `rate`, `miles`, `broker_name`, `broker_mc`, `notes`) cleanly populate the respective Step 1 and Step 2 fields and trigger recalculation.
- In `verifyDocAddress()` and address comparison logic:
  - Implement robust address comparison `compareAddresses(targetAddress, docAddress)`:
    - Normalizes street suffixes (St, Street, Rd, Road, Ave, Avenue, Pkwy, etc.), cities, and states.
    - Evaluates State match, City match, Street match, and ZIP match.
    - Categorizes outcome into `'MATCH'`, `'POSSIBLE_MATCH'`, or `'MISMATCH'` with human-readable diagnostic reasons.
  - Update `renderSideBySideValidationPanel()` to show Match / Possible Match / Mismatch badges with detailed comparison breakdown.

---

## Verification Plan

### Automated Tests
- Test Mistral endpoint `/api/ai/mistral-extract` with mock image and document payloads.
- Test address comparison normalization against sample pairs (exact match, abbreviation match, city mismatch, state mismatch).

### Manual Verification
- Test RC extraction with sample image/PDF.
- Verify form fields auto-fill correctly.
- Test BOL and POD upload and verify address comparison outputs Match / Possible Match / Mismatch with clear reasons.
- Verify debug logs appear in console and server output.
