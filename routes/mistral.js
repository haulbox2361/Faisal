// Server-side proxy for Mistral AI RC/document extraction.
//
// Why this exists: Anthropic and Google's APIs both allow direct
// browser-to-API calls (Anthropic via the
// `anthropic-dangerous-direct-browser-access` header, Google's
// Generative Language API via open CORS).
// Mistral's API does not send Access-Control-Allow-Origin for browser
// requests, so a direct fetch from api.mistral.ai gets blocked by CORS in the browser.
// Routing the call through this same-origin backend endpoint fixes CORS completely.

const express = require('express');
const router = express.Router();

// Enable JSON body parsing for document payloads up to 25MB
router.use(express.json({ limit: '25mb' }));

router.post('/api/ai/mistral-extract', async (req, res) => {
  const { apiKey: reqKey, model, prompt, base64, mediaType, isPdf } = req.body || {};

  const apiKey = (reqKey && String(reqKey).trim()) || (process.env.MISTRAL_API_KEY || '').trim();

  console.log('[MISTRAL] 📥 Document extraction request received');
  console.log('[MISTRAL] Payload details:', {
    hasKey: !!apiKey,
    keySource: reqKey ? 'client' : (process.env.MISTRAL_API_KEY ? 'env' : 'none'),
    mediaType: mediaType || 'unknown',
    isPdf: !!isPdf,
    base64Length: base64 ? base64.length : 0,
    requestedModel: model || 'default'
  });

  if (!apiKey) {
    console.error('[MISTRAL] ❌ Rejected: No Mistral API key provided.');
    return res.status(400).json({ error: 'No Mistral AI API key provided. Please configure one in Settings → AI RC Extraction or set MISTRAL_API_KEY in .env.' });
  }
  if (!base64 || !prompt) {
    console.error('[MISTRAL] ❌ Rejected: Missing document base64 data or prompt.');
    return res.status(400).json({ error: 'Missing document data or prompt.' });
  }

  // Ensure a vision/document-capable model is used for document extraction
  let useModel = (model && String(model).trim()) || 'pixtral-12b-2409';
  if (useModel === 'mistral-small-latest' || useModel === 'mistral-tiny' || useModel === 'mistral-medium') {
    useModel = 'pixtral-12b-2409';
  }

  const effectiveMime = mediaType || (isPdf ? 'application/pdf' : 'image/jpeg');
  const isDocumentPdf = isPdf || effectiveMime === 'application/pdf';

  // Construct payload appropriate for Mistral API
  let contentBlocks = [];
  contentBlocks.push({ type: 'text', text: prompt });

  if (isDocumentPdf) {
    // For PDFs: send document_url or data URL format supported by Mistral
    const pdfDataUrl = 'data:application/pdf;base64,' + base64;
    contentBlocks.push({
      type: 'document_url',
      document_url: pdfDataUrl
    });
  } else {
    // For images: JPEG/PNG/WebP
    const imgDataUrl = 'data:' + effectiveMime + ';base64,' + base64;
    contentBlocks.push({
      type: 'image_url',
      image_url: { url: imgDataUrl }
    });
  }

  const mistralRequestBody = {
    model: useModel,
    messages: [{ role: 'user', content: contentBlocks }],
    response_format: { type: 'json_object' },
  };

  console.log(`[MISTRAL] 🚀 Sending extraction request to Mistral API (model: ${useModel})...`);

  let mistralResp;
  try {
    mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(mistralRequestBody),
    });
  } catch (e) {
    console.error('[MISTRAL] 💥 Network error reaching Mistral AI:', e.message);
    return res.status(502).json({ error: 'Could not reach Mistral AI: ' + e.message });
  }

  const rawText = await mistralResp.text().catch(() => '');
  console.log(`[MISTRAL] 📬 Mistral API responded with status ${mistralResp.status}`);

  if (!mistralResp.ok) {
    console.error(`[MISTRAL] ❌ Mistral API returned error ${mistralResp.status}:`, rawText);
    
    // If document_url type is rejected by this model version, fallback to image_url or error
    if (isDocumentPdf && (mistralResp.status === 400 || mistralResp.status === 422)) {
      console.log('[MISTRAL] 🔄 Attempting fallback format for PDF document...');
      try {
        const fallbackResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            model: useModel,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } }
              ]
            }],
            response_format: { type: 'json_object' },
          }),
        });
        const fallbackText = await fallbackResp.text().catch(() => '');
        if (fallbackResp.ok) {
          const fallbackData = JSON.parse(fallbackText);
          const fallbackContent = fallbackData.choices && fallbackData.choices[0] && fallbackData.choices[0].message && fallbackData.choices[0].message.content;
          if (fallbackContent) {
            console.log('[MISTRAL] ✅ Fallback extraction succeeded');
            return res.json({ content: typeof fallbackContent === 'string' ? fallbackContent : JSON.stringify(fallbackContent) });
          }
        }
      } catch (fbErr) {
        console.warn('[MISTRAL] Fallback attempt failed:', fbErr.message);
      }
    }

    return res.status(mistralResp.status).json({
      error: 'Mistral API error ' + mistralResp.status + (rawText ? ': ' + rawText.slice(0, 300) : ''),
    });
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    console.error('[MISTRAL] ❌ Failed to parse JSON response from Mistral:', rawText);
    return res.status(502).json({ error: 'Mistral returned a non-JSON response.' });
  }

  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    console.error('[MISTRAL] ❌ No message content in Mistral response choices:', data);
    return res.status(502).json({ error: 'No response text from Mistral.' });
  }

  console.log('[MISTRAL] ✅ Successfully extracted structured data from document');
  res.json({ content: typeof content === 'string' ? content : JSON.stringify(content) });
});

module.exports = router;
