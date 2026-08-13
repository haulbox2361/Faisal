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

router.post('/api/ai/mistral-extract', async (req, res) => {
  const { apiKey, model, prompt, base64, mediaType, isPdf } = req.body || {};

  if (!apiKey || !String(apiKey).trim()) {
    return res.status(400).json({ error: 'No Mistral AI API key provided.' });
  }
  if (!base64 || !prompt) {
    return res.status(400).json({ error: 'Missing document data or prompt.' });
  }

  // Ensure a vision-capable model is used for document extraction
  let useModel = (model && String(model).trim()) || 'pixtral-12b-2409';
  if (useModel === 'mistral-small-latest' || useModel === 'mistral-tiny' || useModel === 'mistral-medium') {
    useModel = 'pixtral-12b-2409';
  }

  const dataUrl = 'data:' + (mediaType || 'image/jpeg') + ';base64,' + base64;
  const imageBlock = { type: 'image_url', image_url: { url: dataUrl } };

  let mistralResp;
  try {
    mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(apiKey).trim(),
      },
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, imageBlock] }],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    console.error('Mistral proxy request failed:', e.message);
    return res.status(502).json({ error: 'Could not reach Mistral AI: ' + e.message });
  }

  const text = await mistralResp.text().catch(() => '');
  if (!mistralResp.ok) {
    return res.status(mistralResp.status).json({
      error: 'Mistral API error ' + mistralResp.status + (text ? ': ' + text.slice(0, 300) : ''),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return res.status(502).json({ error: 'Mistral returned a non-JSON response.' });
  }

  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return res.status(502).json({ error: 'No response text from Mistral.' });
  }

  res.json({ content: typeof content === 'string' ? content : JSON.stringify(content) });
});

module.exports = router;
