/* =========================================================================
   HaulBoX Core API Service & Network Layer
   ========================================================================= */

function currentAccountId() {
  if (STATE.role === 'admin') return 'admin';
  return STATE.currentDispatcherId || 'admin';
}

async function backendFetch(path, opts = {}) {
  const accountId = currentAccountId();
  const headers = Object.assign({}, opts.headers || {}, { 'X-Account-Id': accountId });
  return fetch('/api' + path, Object.assign({}, opts, { headers }));
}

function splitDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return { mimeType: 'application/octet-stream', base64: '' };
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { mimeType: m[1], base64: m[2] };
  return { mimeType: 'application/octet-stream', base64: dataUrl };
}
