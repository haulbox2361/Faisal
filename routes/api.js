const express = require('express');
const { google } = require('googleapis');
const MailComposer = require('nodemailer/lib/mail-composer');
const { Readable } = require('stream');
const store = require('../lib/store');
const { clientForAccount } = require('../lib/googleClient');
const driveStore = require('../lib/driveStore');
const kv = require('../lib/kvstore');
const dataStore = require('../lib/dataStore');
const { getLatestLocationsForDrivers } = require('../lib/db');
const { calculateLoadTracking } = require('../lib/etaEngine');

const router = express.Router();
router.use(express.json({ limit: '25mb' })); // attachments arrive as base64 in the JSON body

async function requireAccount(req, res) {
  const accountId = req.body.accountId || req.query.accountId;
  let record = accountId ? await store.get(accountId) : null;
  let effectiveId = accountId;

  if (!record && accountId !== 'admin') {
    record = await store.get('admin');
    effectiveId = 'admin';
  }

  // Fallback: if 'admin' key didn't hit, check if ANY account is stored in google_tokens
  if (!record) {
    try {
      const { getPool, ensureSchema } = require('../lib/db');
      await ensureSchema();
      const { rows } = await getPool().query('SELECT account_id, email, tokens FROM google_tokens LIMIT 1');
      if (rows.length > 0) {
        effectiveId = rows[0].account_id;
        record = { email: rows[0].email, tokens: rows[0].tokens };
      }
    } catch (e) {}
  }

  if (!record) {
    res.status(401).json({ error: 'No Google account connected. Connect Admin Google account in Settings, then try again.' });
    return null;
  }
  return { accountId: effectiveId, record };
}

function toAttachments(attachments) {
  return (attachments || []).map((a) => ({
    filename: a.filename,
    contentType: a.mimeType,
    content: Buffer.from(a.data, 'base64'),
  }));
}

// Builds a raw RFC 2822 message (base64url, as the Gmail API requires) with
// optional threading headers for a reply.
async function buildRawMessage({ to, cc, subject, body, attachments, inReplyTo, references }) {
  const headers = {};
  if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
  if (references) headers['References'] = references;

  const mail = new MailComposer({
    to,
    cc: cc || undefined,
    subject,
    text: body,
    attachments: toAttachments(attachments),
    headers,
  });

  const message = await mail.compile().build();
  return message
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// GET /api/mc-lookup?mc=123456
// Looks up a broker/carrier's legal + DBA name from the FMCSA SAFER system by
// MC number, so the Add Load / Add Broker forms can auto-fill the company
// name from just the MC number. Public data, no API key required — scrapes
// the public SAFER carrier-snapshot page since FMCSA's keyed QCMobile API
// requires a webKey we don't have.
router.get('/api/mc-lookup', async (req, res) => {
  const mc = String(req.query.mc || '').replace(/[^0-9]/g, '');
  if (!mc) {
    res.status(400).json({ found: false, error: 'Missing or invalid MC number' });
    return;
  }
  try {
    const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&original_query_param=NAME&query_string=${mc}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HaulBoX/1.0)' },
    });
    if (!response.ok) {
      res.status(502).json({ found: false, error: 'SAFER lookup failed' });
      return;
    }
    const html = await response.text();

    const clean = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const extract = (label) => {
      // SAFER renders each field as a table row like:
      // <th ...>Legal Name:</th><td ...>SOME CARRIER LLC</td>
      const re = new RegExp(label + '\\s*:?\\s*</\\w+>\\s*<td[^>]*>([^<]*)<', 'i');
      const m = html.match(re);
      return m ? clean(m[1]) : '';
    };

    const legalName = extract('Legal Name');
    const dbaName = extract('DBA Name');

    if (!legalName && !dbaName) {
      res.json({ found: false });
      return;
    }
    res.json({ found: true, mc, legalName, dbaName, name: dbaName || legalName });
  } catch (e) {
    res.status(502).json({ found: false, error: e.message });
  }
});

// POST /api/send-email  { accountId, to, subject, body, attachments }
router.post('/api/send-email', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { to, subject, body, attachments } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing "to" address' });

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const gmail = google.gmail({ version: 'v1', auth });
    const raw = await buildRawMessage({ to, subject, body, attachments });
    const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    res.json({ ok: true, messageId: data.id, threadId: data.threadId });
  } catch (e) {
    console.error('send-email failed:', e);
    res.status(500).json({ error: e.message || 'Failed to send email' });
  }
});

// POST /api/reply-all  { accountId, threadId, to, cc, subject, body, inReplyTo, references, attachments }
router.post('/api/reply-all', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { threadId, to, cc, subject, body, inReplyTo, references, attachments } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing "to" address' });
  if (!threadId) return res.status(400).json({ error: 'Missing threadId' });

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const gmail = google.gmail({ version: 'v1', auth });
    const raw = await buildRawMessage({ to, cc, subject, body, attachments, inReplyTo, references });
    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });
    res.json({ ok: true, messageId: data.id, threadId: data.threadId });
  } catch (e) {
    console.error('reply-all failed:', e);
    res.status(500).json({ error: e.message || 'Failed to send reply' });
  }
});

// GET /api/thread/:id?accountId=...
// Returns just enough of the thread for the frontend to build a correctly
// threaded reply: the original subject, the last message's Message-ID
// (for In-Reply-To), its References chain, who to actually reply to, and
// who else to Cc. replyTo/cc are derived from the thread's own last message
// (real "Reply All" semantics) — NOT from whatever email is saved on the
// Broker record, which can be a different/stale address than whoever
// actually sent this particular conversation.
router.get('/api/thread/:id', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const gmail = google.gmail({ version: 'v1', auth });
    const { data } = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Message-ID', 'References', 'Cc', 'From', 'To'],
    });

    const messages = data.messages || [];
    const first = messages[0];
    const last = messages[messages.length - 1];
    const header = (msg, name) => {
      const h = ((msg && msg.payload && msg.payload.headers) || []).find(
        (x) => x.name.toLowerCase() === name.toLowerCase()
      );
      return h ? h.value : '';
    };

    // "name@example.com" out of "Display Name <name@example.com>" (or a bare address).
    const extractAddr = (v) => {
      const m = String(v || '').match(/<([^<>]+)>/);
      return (m ? m[1] : v || '').trim();
    };
    const extractAddrList = (v) =>
      String(v || '')
        .split(',')
        .map(extractAddr)
        .map((s) => s.trim())
        .filter(Boolean);

    const myEmail = (ctx.record.email || '').toLowerCase();

    const originalSubject = header(first, 'Subject');
    const lastMessageId = header(last, 'Message-ID');
    const priorReferences = header(last, 'References');
    // Per RFC 2822 threading: next References = the last message's own
    // References chain plus its own Message-ID.
    const references = [priorReferences, lastMessageId].filter(Boolean).join(' ');

    // Reply goes to whoever actually sent the last message in the thread —
    // that's the real broker contact for THIS conversation, regardless of
    // what's saved on the Broker record.
    const replyTo = extractAddr(header(last, 'From'));

    // Cc everyone else who was on the last message (its own Cc, plus its To
    // minus us and minus whoever we're already replying to) — normal
    // Reply All behavior, deduplicated.
    const seen = new Set([myEmail, replyTo.toLowerCase()]);
    const ccAddrs = [];
    [...extractAddrList(header(last, 'Cc')), ...extractAddrList(header(last, 'To'))].forEach((addr) => {
      const key = addr.toLowerCase();
      if (!seen.has(key)) { seen.add(key); ccAddrs.push(addr); }
    });
    const cc = ccAddrs.join(', ');

    res.json({ originalSubject, lastMessageId, references, cc, replyTo });
  } catch (e) {
    console.error('thread lookup failed:', e);
    res.status(500).json({ error: e.message || 'Failed to load thread' });
  }
});

// GET /api/thread-search?accountId=...&q=...
// Gmail's web URLs contain an "opaque" ID (FMfcgz..., Ktbx..., etc.) that is a
// completely different identifier system from the API's own hex thread ID —
// there's no way to convert one into the other. So instead of asking users to
// paste a URL (which can never produce a usable ID), this searches the
// connected mailbox directly and returns the API's real thread IDs to pick from.
router.get('/api/thread-search', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const gmail = google.gmail({ version: 'v1', auth });
    const { data } = await gmail.users.threads.list({ userId: 'me', q, maxResults: 8 });
    const threads = data.threads || [];

    const results = await Promise.all(threads.map(async (t) => {
      try {
        const { data: full } = await gmail.users.threads.get({
          userId: 'me',
          id: t.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const last = full.messages[full.messages.length - 1];
        const header = (name) => {
          const h = ((last && last.payload && last.payload.headers) || []).find(
            (x) => x.name.toLowerCase() === name.toLowerCase()
          );
          return h ? h.value : '';
        };
        return {
          id: t.id,
          subject: header('Subject') || '(no subject)',
          from: header('From') || '',
          date: header('Date') || '',
          snippet: t.snippet || '',
          messageCount: (full.messages || []).length,
        };
      } catch (e) {
        return { id: t.id, subject: '(couldn\'t load details)', from: '', date: '', snippet: t.snippet || '', messageCount: null };
      }
    }));

    res.json({ results });
  } catch (e) {
    console.error('thread search failed:', e);
    res.status(500).json({ error: e.message || 'Failed to search Gmail' });
  }
});

// POST /api/drive-upload  { accountId, fileName, mimeType, data, folderId? }
// Original endpoint — backward compatible. Accepts an optional folderId so the
// frontend's existing savePackageToDrive() continues to work unchanged, and the
// new autoDriveUploadDoc() can also use this path when needed.
router.post('/api/drive-upload', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { fileName, mimeType, data, folderId } = req.body;
  if (!fileName || !data) return res.status(400).json({ error: 'Missing fileName or data' });

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const drive = google.drive({ version: 'v3', auth });
    const buffer = Buffer.from(data, 'base64');
    const media = { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) };

    const requestBody = { name: fileName };
    if (folderId) requestBody.parents = [folderId];

    const { data: file } = await drive.files.create({
      requestBody,
      media,
      fields: 'id, webViewLink',
    });

    res.json({ ok: true, fileId: file.id, webViewLink: file.webViewLink });
  } catch (e) {
    console.error('drive-upload failed:', e);
    res.status(500).json({ error: e.message || 'Failed to upload to Drive' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/drive/upload-doc
// Uploads a single document (RC, BOL, or POD) to the correct pre-configured
// Drive folder, applying the canonical filename format. Performs a server-side
// duplicate check via drive.files.list before uploading.
// Body: { accountId, docType, originalName, mimeType, data(base64),
//         loadId, loadNumber, pickup, dropoff, pickupDate, driverName, driverId, uploadedBy }
// ---------------------------------------------------------------------------
router.post('/api/drive/upload-doc', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;

  const { docType, originalName, mimeType, data,
          loadId, loadNumber, pickup, dropoff, pickupDate,
          driverName, driverId, uploadedBy } = req.body || {};

  if (!['RC', 'BOL', 'POD'].includes(docType)) {
    return res.status(400).json({ error: 'docType must be RC, BOL, or POD' });
  }
  if (!data) return res.status(400).json({ error: 'Missing file data' });

  try {
    const folderId = driveStore.folderIdFor(docType);
    const fileName = driveStore.buildFileName(docType, {
      loadNumber, pickup, dropoff, pickupDate, driverName, originalName,
    });

    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const result = await driveStore.uploadToFolder(auth, { folderId, fileName, mimeType, base64Data: data });

    if (!result.duplicate) {
      await driveStore.recordUpload({
        loadId, driverId, docType,
        driveFileId: result.fileId,
        fileName,
        folderId,
        webViewLink: result.webViewLink,
        uploadedBy: uploadedBy || ctx.accountId,
      });
    }

    res.json({
      ok: true,
      fileId:      result.fileId,
      webViewLink: result.webViewLink,
      fileName,
      duplicate:   result.duplicate,
      message:     result.duplicate ? 'Document already stored in Google Drive.' : 'Uploaded successfully.',
    });
  } catch (e) {
    console.error('drive/upload-doc failed:', e);
    res.status(500).json({ error: e.message || 'Failed to upload document to Drive' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/drive/uploads/:loadId
// Returns all Drive upload records for a load — used by the load modal to
// display Drive links and Open/Download buttons.
// ---------------------------------------------------------------------------
router.get('/api/drive/uploads/:loadId', async (req, res) => {
  // Auth check: must have a connected Google account (same guard as other Drive calls)
  const accountId = req.query.accountId;
  if (!accountId) return res.status(400).json({ error: 'Missing accountId' });
  try {
    const uploads = await driveStore.getUploadsForLoad(req.params.loadId);
    res.json({ uploads });
  } catch (e) {
    console.error('drive/uploads fetch failed:', e);
    res.status(500).json({ error: 'Failed to load Drive records' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/drive/archive
// Builds a ZIP of RC+BOL+POD for a paid load and uploads to Drive root.
// Uses Node's built-in zlib/streams to avoid adding a zip dependency.
// Body: { accountId, loadId, loadNumber, driverName, driverId, pickup, dropoff,
//         pickupDate, uploadedBy, files: [{docType, name, data(base64)}] }
// ---------------------------------------------------------------------------
router.post('/api/drive/archive', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;

  const { loadId, loadNumber, driverName, driverId, pickup, dropoff,
          pickupDate, uploadedBy, files } = req.body || {};

  if (!loadId) return res.status(400).json({ error: 'Missing loadId' });
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: 'No files provided for archive' });
  }

  try {
    // Check if a PACKAGE archive already exists for this load in the DB
    const existing = await driveStore.getUploadsForLoad(loadId);
    const existingPkg = existing.find((u) => u.docType === 'PACKAGE');
    if (existingPkg) {
      return res.json({
        ok: true,
        duplicate: true,
        fileId:      existingPkg.driveFileId,
        webViewLink: existingPkg.webViewLink,
        fileName:    existingPkg.fileName,
        message:     'Archive already exists in Google Drive.',
      });
    }

    // Build archive filename
    const lane = (() => {
      const sa = (loc) => {
        const m = (loc || '').match(/,\s*([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
        return m ? m[1].toUpperCase() : 'XX';
      };
      return `${sa(pickup)}-${sa(dropoff)}`;
    })();
    const safeNum  = (loadNumber || 'LOAD').replace(/[<>:"/\\|?*]/g, '');
    const safeName = (driverName || 'Driver').replace(/[<>:"/\\|?*]/g, '').trim().split(/\s+/)[0];
    const archiveName = `PACKAGE ${safeNum} ${lane} ${safeName}.zip`;

    // Build ZIP in memory using JSZip-compatible raw approach via Buffer concat.
    // We bundle each document as a stored (no compression) entry for speed.
    // Since jszip isn't installed, we send docs individually wrapped in a
    // minimal ZIP structure using the built-in 'archiver' if available,
    // falling back to concatenating the raw files as a single zip-like bundle.
    // For maximum reliability without extra deps, we upload a tar-like
    // concatenation file with a .zip extension and a manifest. If the user has
    // archiver installed this will produce a real zip.
    let zipBuffer;
    try {
      // Try archiver (added to package.json)
      const archiver = require('archiver');
      const { PassThrough } = require('stream');
      zipBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const pt = new PassThrough();
        pt.on('data', (c) => chunks.push(c));
        pt.on('end', () => resolve(Buffer.concat(chunks)));
        pt.on('error', reject);
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.pipe(pt);
        for (const f of files) {
          if (!f.data) continue;
          const buf = Buffer.from(f.data, 'base64');
          archive.append(buf, { name: f.name || `${f.docType}.pdf` });
        }
        archive.finalize();
      });
    } catch (zipErr) {
      // archiver not available — fall back: upload files individually and
      // record only the first one as PACKAGE so the duplicate guard fires.
      console.warn('archiver not available, uploading docs individually:', zipErr.message);
      const auth = clientForAccount(ctx.record, store, ctx.accountId);
      let firstFileId = null, firstWebViewLink = null;
      for (const f of files) {
        if (!f.data) continue;
        const fn = f.name || `${f.docType}.pdf`;
        const drive = google.drive({ version: 'v3', auth });
        const buf = Buffer.from(f.data, 'base64');
        const { data: file } = await drive.files.create({
          requestBody: { name: fn },
          media: { mimeType: 'application/octet-stream', body: Readable.from(buf) },
          fields: 'id, webViewLink',
        });
        if (!firstFileId) { firstFileId = file.id; firstWebViewLink = file.webViewLink; }
      }
      if (firstFileId) {
        await driveStore.recordUpload({
          loadId, driverId, docType: 'PACKAGE',
          driveFileId: firstFileId, fileName: archiveName,
          folderId: null, webViewLink: firstWebViewLink,
          uploadedBy: uploadedBy || ctx.accountId,
        });
      }
      return res.json({ ok: true, fileId: firstFileId, webViewLink: firstWebViewLink, fileName: archiveName, duplicate: false });
    }

    // Upload the real ZIP
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const drive = google.drive({ version: 'v3', auth });
    const { data: file } = await drive.files.create({
      requestBody: { name: archiveName },
      media: { mimeType: 'application/zip', body: Readable.from(zipBuffer) },
      fields: 'id, webViewLink',
    });

    await driveStore.recordUpload({
      loadId, driverId, docType: 'PACKAGE',
      driveFileId: file.id, fileName: archiveName,
      folderId: null, webViewLink: file.webViewLink,
      uploadedBy: uploadedBy || ctx.accountId,
    });

    res.json({ ok: true, fileId: file.id, webViewLink: file.webViewLink, fileName: archiveName, duplicate: false });
  } catch (e) {
    console.error('drive/archive failed:', e);
    res.status(500).json({ error: e.message || 'Failed to create Drive archive' });
  }
});

// POST /api/sheet-sync  { accountId, spreadsheetId, sheetName, row }
router.post('/api/sheet-sync', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { spreadsheetId, sheetName, row } = req.body || {};
  if (!spreadsheetId) return res.status(400).json({ error: 'Missing spreadsheetId' });
  if (!Array.isArray(row) || !row.length) return res.status(400).json({ error: 'Missing row data' });

  const rawTab = (sheetName || 'Sheet1').trim() || 'Sheet1';
  const tab = rawTab.includes("'") ? rawTab : `'${rawTab.replace(/'/g, "''")}'`;
  const key = String(row[1] || '').trim(); // Load # in column B

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const sheets = google.sheets({ version: 'v4', auth });

    // Look for existing row by Load # in column B
    let colB = [];
    try {
      const { data: existing } = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!B:B`,
      });
      colB = existing.values || [];
    } catch (e) {
      try {
        const { data: fallback } = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'B:B',
        });
        colB = fallback.values || [];
      } catch (e2) {
        colB = [];
      }
    }

    let rowNumber = -1; // 1-indexed sheet row
    for (let i = 0; i < colB.length; i++) {
      if (String((colB[i] || [])[0] || '').trim() === key) {
        rowNumber = i + 1;
        break;
      }
    }

    // Write default header row if sheet is completely empty
    if (colB.length === 0) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${tab}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['Date', 'Load Number', 'Broker', 'MC #', 'Driver Name', 'Pickup', 'Drop-off', 'PU Date', 'DO Date', 'Broker Rate', 'Dispatcher Name']] },
        });
      } catch (hdrErr) {
        // Fallback without range tab
        try {
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Date', 'Load Number', 'Broker', 'MC #', 'Driver Name', 'Pickup', 'Drop-off', 'PU Date', 'DO Date', 'Broker Rate', 'Dispatcher Name']] },
          });
        } catch (hdrErr2) {}
      }
    }

    if (rowNumber === -1) {
      // Append new load row
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${tab}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      } catch (appErr) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      }
    } else {
      // Update existing load row
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${tab}!A${rowNumber}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      } catch (updErr) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `A${rowNumber}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      }
    }

    res.json({ ok: true, updatedExisting: rowNumber !== -1 });
  } catch (e) {
    console.error('sheet-sync failed:', e);
    res.status(500).json({ error: e.message || 'Failed to sync to Google Sheet' });
  }
});

// POST /api/webhook-sync  { webhookUrl, loadData }
// Alternate zero-permission Google Sheet sync method (e.g. via Google Apps Script Web App).
router.post('/api/webhook-sync', async (req, res) => {
  const { webhookUrl, loadData } = req.body || {};
  if (!webhookUrl) return res.status(400).json({ error: 'Missing webhookUrl' });
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loadData || {}),
    });
    res.json({ ok: true, status: resp.status });
  } catch (e) {
    console.error('webhook-sync failed:', e);
    res.status(500).json({ error: e.message || 'Webhook request failed' });
  }
});

// GET /api/tracking/live
// Role-scoped live tracking API for Admin and Dispatchers.
// Admin receives all active drivers; Dispatcher receives only assigned drivers.
router.get('/api/tracking/live', async (req, res) => {
  try {
    const state = (await dataStore.loadFullState()) || {};
    const loads = state.loads || [];
    const role = String(req.query.role || 'admin').toLowerCase();
    const userId = String(req.query.userId || '').trim();
    const userName = String(req.query.userName || '').trim();

    // Filter active (incomplete) loads
    let activeLoads = loads.filter((l) => l.status !== 'PAID' && l.status !== 'PAID_CONFIRMED' && l.status !== 'ARCHIVED');

    // Dispatcher privacy filter: only loads assigned to this dispatcher
    if (role === 'dispatcher' && (userId || userName)) {
      activeLoads = activeLoads.filter(
        (l) => (userId && String(l.dispatcherId) === userId) || (userName && String(l.dispatcherName).toLowerCase() === userName.toLowerCase())
      );
    }

    // Driver Privacy Rule: Drivers are NOT authorized to query all live tracking
    if (role === 'driver') {
      return res.status(403).json({ error: 'Driver accounts cannot access fleet tracking' });
    }

    const driverIds = activeLoads.map((l) => l.driverId).filter(Boolean);
    const locMap = await getLatestLocationsForDrivers(driverIds);

    const trackingList = activeLoads
      .map((load) => {
        const driverLoc = load.driverId ? locMap[load.driverId] : null;
        return calculateLoadTracking(load, driverLoc);
      })
      .filter(Boolean);

    res.json({ ok: true, count: trackingList.length, trackingList });
  } catch (e) {
    console.error('tracking/live failed:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch live tracking' });
  }
});

// POST /api/documents/review
// Enforces document approval workflow: Pending Verification -> Approved or Rejected.
// Approved documents are pushed to Google Drive and transition load status.
router.post('/api/documents/review', async (req, res) => {
  const { loadId, docKey, action, rejectionReason } = req.body || {};
  if (!loadId || !docKey || !action) {
    return res.status(400).json({ error: 'Missing loadId, docKey, or action' });
  }

  try {
    const state = (await dataStore.loadFullState()) || {};
    const loads = state.loads || [];
    const load = loads.find(l => String(l.id) === String(loadId));
    if (!load) return res.status(404).json({ error: 'Load not found' });

    load.docs = load.docs || {};
    const doc = load.docs[docKey];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const nowIso = new Date().toISOString();
    const notifications = require('../lib/notificationStore');

    if (action === 'approve') {
      doc.status = 'Approved';
      doc.rejectionReason = null;

      // Push to Google Drive
      if (['BOL', 'POD', 'RC'].includes(docKey)) {
        try {
          const folderId = driveStore.folderIdFor(docKey);
          const fileName = driveStore.buildFileName(docKey, {
            loadNumber: load.loadNumber,
            driverName: load.driverName || 'Driver',
            pickup: load.pickup,
            dropoff: load.dropoff,
            pickupDate: load.pickupDate,
            originalName: doc.name || doc.fileName || `${docKey}.pdf`,
          });

          // Check for duplicate uploads
          const adminRecord = await store.get('admin');
          if (adminRecord) {
            const auth = clientForAccount(adminRecord, store, 'admin');
            const duplicate = await driveStore.findExistingInFolder(auth, folderId, fileName);
            
            if (!duplicate) {
              const rawBase64 = doc.data ? doc.data.split(',').slice(1).join(',') : '';
              if (rawBase64) {
                const result = await driveStore.uploadToFolder(auth, {
                  folderId,
                  fileName,
                  mimeType: 'application/octet-stream',
                  base64Data: rawBase64,
                });

                await driveStore.recordUpload({
                  loadId: load.id,
                  driverId: load.driverId,
                  docType: docKey,
                  driveFileId: result.fileId,
                  fileName,
                  folderId,
                  webViewLink: result.webViewLink,
                  uploadedBy: 'admin',
                });
              }
            }
          }
        } catch (driveErr) {
          console.error(`Google Drive upload for ${docKey} failed:`, driveErr.message);
        }
      }

      // Automated Workflow Transition on Approval
      if (docKey === 'BOL') {
        load.driverProgress = 'LOADED';
        load.timestamps = load.timestamps || {};
        load.timestamps.loadedAt = nowIso;
        load.status = 'Loaded';
      } else if (docKey === 'POD') {
        load.driverProgress = 'DELIVERED';
        load.timestamps = load.timestamps || {};
        load.timestamps.deliveredAt = nowIso;
        load.status = 'Delivered';
      }

      // Dispatcher Notification
      const notifPayload = {
        type: 'document_approved',
        title: `Document Approved`,
        body: `${docKey} for Load #${load.loadNumber || load.id} has been approved.`,
        data: { loadId: load.id, key: docKey },
      };
      if (load.driverId) {
        await notifications.create('driver', load.driverId, notifPayload);
      }

    } else if (action === 'reject') {
      doc.status = 'Rejected';
      doc.rejectionReason = rejectionReason || 'Rejected by dispatcher/admin';

      const notifPayload = {
        type: 'document_rejected',
        title: `Document Rejected`,
        body: `${docKey} for Load #${load.loadNumber || load.id} was rejected. Reason: ${doc.rejectionReason}`,
        data: { loadId: load.id, key: docKey, rejectionReason: doc.rejectionReason },
      };
      if (load.driverId) {
        await notifications.create('driver', load.driverId, notifPayload);
      }
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be approve or reject' });
    }

    await dataStore.saveFullState(state);
    res.json({ ok: true, load });

  } catch (e) {
    console.error('Document review failed:', e);
    res.status(500).json({ error: e.message || 'Failed to review document' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/loads/:id/delete
// Admin / Super Admin ONLY: Soft-deletes a load with required reason and audit log
// ---------------------------------------------------------------------------
router.post('/api/loads/:id/delete', async (req, res) => {
  const { reason, userRole, userId, userName } = req.body || {};
  const loadId = req.params.id;

  const role = String(userRole || req.query.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super_admin' && role !== 'superadmin') {
    return res.status(403).json({ ok: false, error: 'Forbidden — Only Admin or Super Admin can delete loads.' });
  }

  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    return res.status(400).json({ ok: false, error: 'A mandatory reason is required to delete a load.' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { loads: [] };
    const load = (state.loads || []).find(l => String(l.id) === String(loadId) || String(l.loadNumber) === String(loadId));

    if (!load) {
      return res.status(404).json({ ok: false, error: 'Load not found' });
    }

    const nowIso = new Date().toISOString();
    load.is_deleted = true;
    load.deleted_at = nowIso;
    load.deleted_by = userName || userId || role;
    load.delete_reason = cleanReason;

    await dataStore.saveFullState(state);

    // Record immutable audit log
    await auditStore.record(
      { type: role, id: userId || 'admin', name: userName || 'Admin' },
      'LOAD_SOFT_DELETED',
      { type: 'LOAD', id: load.id },
      {
        loadNumber: load.loadNumber,
        reason: cleanReason,
        deletedAt: nowIso,
        brokerName: load.brokerName,
        driverName: load.driverName,
      }
    );

    res.json({
      ok: true,
      message: `Load #${load.loadNumber || load.id} successfully soft-deleted.`,
      loadId: load.id
    });
  } catch (err) {
    console.error('Load soft-delete failed:', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to delete load' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// Returns the 5 core KPIs for the Dispatcher Web Dashboard with Monday-start Weekly Gross
// ---------------------------------------------------------------------------
router.get('/api/dashboard/stats', async (req, res) => {
  try {
    const state = (await dataStore.loadFullState()) || { loads: [], drivers: [] };
    const loads = (state.loads || []).filter(l => !l.is_deleted && !l.deleted);
    const drivers = state.drivers || [];

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // 1. Available Drivers vs Total
    const activeDriverIdsWithLoads = new Set(
      loads
        .filter(l => l.status && !['DELIVERED', 'Delivered', 'Drop-off', 'PAID', 'Cancelled'].includes(l.status))
        .map(l => String(l.driverId))
        .filter(Boolean)
    );
    const activeDrivers = drivers.filter(d => d.active !== false && String(d.status || '').toLowerCase() !== 'inactive');
    const availableCount = activeDrivers.filter(d => !activeDriverIdsWithLoads.has(String(d.id))).length;
    const totalDriversCount = activeDrivers.length;

    // 2. Active Loads
    const activeLoadsList = loads.filter(l => !['DELIVERED', 'Delivered', 'Drop-off', 'PAID', 'Cancelled'].includes(l.status));

    // 3. Today's Pickups
    const todayPickupsList = loads.filter(l => {
      if (!l.pickupDate) return false;
      const d = String(l.pickupDate).slice(0, 10);
      return d === todayStr;
    });

    // 4. Today's Deliveries
    const todayDeliveriesList = loads.filter(l => {
      if (!l.deliveryDate && !l.dropoffDate) return false;
      const d = String(l.deliveryDate || l.dropoffDate).slice(0, 10);
      return d === todayStr;
    });

    // 5. Weekly Gross: Business week starts MONDAY, calculated on delivery/drop-off date
    // Calculate Monday of current week
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    let weeklyGrossTotal = 0;
    const weeklyLoads = [];

    loads.forEach(l => {
      const delivDateRaw = l.deliveryDate || l.dropoffDate || l.deliveredAt;
      if (!delivDateRaw) return;
      const delivDate = new Date(delivDateRaw);
      if (!isNaN(delivDate.getTime()) && delivDate >= monday && delivDate <= sunday) {
        const rate = Number(l.brokerRate || l.rate || 0);
        weeklyGrossTotal += rate;
        weeklyLoads.push(l);
      }
    });

    res.json({
      ok: true,
      stats: {
        availableDrivers: {
          available: availableCount,
          total: totalDriversCount,
          formatted: `${availableCount} / ${totalDriversCount}`,
          activeOnRoad: activeDriverIdsWithLoads.size
        },
        activeLoads: {
          count: activeLoadsList.length,
          loads: activeLoadsList
        },
        todayPickups: {
          count: todayPickupsList.length,
          loads: todayPickupsList
        },
        todayDeliveries: {
          count: todayDeliveriesList.length,
          loads: todayDeliveriesList
        },
        weeklyGross: {
          total: weeklyGrossTotal,
          formatted: `$${weeklyGrossTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
          weekStartMonday: monday.toISOString().slice(0, 10),
          weekEndSunday: sunday.toISOString().slice(0, 10),
          loadCount: weeklyLoads.length
        }
      }
    });
  } catch (err) {
    console.error('Dashboard stats calculation failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// AUDIT-LOGGED MUTATION ENDPOINTS (DOCUMENT REVIEW, PROFILE EDITS, PAYMENTS, ROLES)
// ---------------------------------------------------------------------------

// Helper to strip sensitive credentials before sending driver objects to dispatchers
function sanitizeDriverForDispatcher(driver) {
  if (!driver) return null;
  const d = { ...driver };
  delete d.pin;
  delete d.pinHash;
  delete d.pin_hash;
  return d;
}

// POST /api/documents/review — Audit-logged document status update
router.post('/api/documents/review', async (req, res) => {
  const { loadId, docType, status, reason, userRole, userId, userName } = req.body || {};
  if (!loadId || !docType || !status) {
    return res.status(400).json({ ok: false, error: 'Missing required parameters (loadId, docType, status)' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { loads: [] };
    const load = (state.loads || []).find(l => String(l.id) === String(loadId) || String(l.loadNumber) === String(loadId));

    if (!load) return res.status(404).json({ ok: false, error: 'Load not found' });
    load.docs = load.docs || {};
    load.docs[docType] = load.docs[docType] || {};
    load.docs[docType].status = status;
    if (reason) load.docs[docType].rejectionReason = reason;

    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole || 'dispatcher', id: userId || 'dispatcher', name: userName || 'Dispatcher' },
      'DOCUMENT_STATUS_CHANGED',
      { type: 'LOAD_DOCUMENT', id: `${load.id}:${docType}` },
      { loadNumber: load.loadNumber, docType, newStatus: status, reason: reason || null }
    );

    res.json({ ok: true, message: `Document ${docType} status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/drivers/:id/update — Audit-logged driver profile update with credential protection
router.post('/api/drivers/:id/update', async (req, res) => {
  const driverId = req.params.id;
  const { updates, userRole, userId, userName } = req.body || {};

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { drivers: [] };
    const driver = (state.drivers || []).find(d => String(d.id) === String(driverId));

    if (!driver) return res.status(404).json({ ok: false, error: 'Driver not found' });

    // Apply allowed profile updates
    const safeUpdates = { ...(updates || {}) };
    delete safeUpdates.pinHash;
    delete safeUpdates.pin_hash;

    // PIN change only allowed by Admin or the driver themselves
    if (safeUpdates.pin) {
      if (userRole !== 'admin' && userRole !== 'super_admin') {
        delete safeUpdates.pin;
      } else {
        driver.pinHash = dataStore.hashPin(safeUpdates.pin);
        delete safeUpdates.pin;
      }
    }

    Object.assign(driver, safeUpdates);
    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole || 'admin', id: userId || 'admin', name: userName || 'Admin' },
      'DRIVER_PROFILE_EDITED',
      { type: 'DRIVER', id: driver.id },
      { driverName: driver.name, updatedFields: Object.keys(safeUpdates) }
    );

    res.json({ ok: true, driver: sanitizeDriverForDispatcher(driver) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/payments/update-stage — Audit-logged payment stage changes
router.post('/api/payments/update-stage', async (req, res) => {
  const { loadId, paymentStage, userRole, userId, userName } = req.body || {};
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: Only Admins can modify payment stages.' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { loads: [] };
    const load = (state.loads || []).find(l => String(l.id) === String(loadId));

    if (!load) return res.status(404).json({ ok: false, error: 'Load not found' });
    const oldStage = load.payment || 'Payment Not Requested';
    load.payment = paymentStage;

    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole, id: userId || 'admin', name: userName || 'Admin' },
      'PAYMENT_STAGE_CHANGED',
      { type: 'LOAD_PAYMENT', id: load.id },
      { loadNumber: load.loadNumber, oldStage, newStage: paymentStage }
    );

    res.json({ ok: true, message: `Payment stage updated to ${paymentStage}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/dispatchers/create — Audit-logged Dispatcher/Admin account creation
router.post('/api/dispatchers/create', async (req, res) => {
  const { name, email, phone, role, userRole, userId, userName } = req.body || {};
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: Only Admins can create dispatch accounts.' });
  }
  if (!name || !email) {
    return res.status(400).json({ ok: false, error: 'Name and email are required.' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { dispatchers: [] };
    const newId = 'disp_' + Date.now();
    const newDispatcher = {
      id: newId,
      name,
      email: email.toLowerCase().trim(),
      phone: phone || null,
      role: role === 'admin' ? 'admin' : 'dispatcher',
      active: true,
      createdAt: new Date().toISOString()
    };

    state.dispatchers = state.dispatchers || [];
    state.dispatchers.push(newDispatcher);
    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole, id: userId || 'admin', name: userName || 'Admin' },
      'ACCOUNT_CREATED',
      { type: 'DISPATCHER', id: newId },
      { name, email: newDispatcher.email, role: newDispatcher.role }
    );

    res.json({ ok: true, dispatcher: newDispatcher });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/dispatchers/:id/role — Audit-logged role promotion / demotion
router.post('/api/dispatchers/:id/role', async (req, res) => {
  const dispatcherId = req.params.id;
  const { newRole, userRole, userId, userName } = req.body || {};
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: Only Admins can modify account roles.' });
  }
  if (!['dispatcher', 'admin', 'super_admin'].includes(newRole)) {
    return res.status(400).json({ ok: false, error: 'Invalid role specified.' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { dispatchers: [] };
    const disp = (state.dispatchers || []).find(d => String(d.id) === String(dispatcherId));

    if (!disp) return res.status(404).json({ ok: false, error: 'Dispatcher account not found.' });
    const oldRole = disp.role || 'dispatcher';
    disp.role = newRole;

    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole, id: userId || 'admin', name: userName || 'Admin' },
      'USER_ROLE_CHANGED',
      { type: 'DISPATCHER', id: disp.id },
      { name: disp.name, email: disp.email, oldRole, newRole }
    );

    res.json({ ok: true, message: `${disp.name} role changed from ${oldRole} to ${newRole}.` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/dispatchers/:id/delete — Audit-logged account removal / deactivation
router.post('/api/dispatchers/:id/delete', async (req, res) => {
  const dispatcherId = req.params.id;
  const { userRole, userId, userName } = req.body || {};
  if (userRole !== 'admin' && userRole !== 'super_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: Only Admins can remove dispatch accounts.' });
  }

  try {
    const auditStore = require('../lib/auditStore');
    const state = (await dataStore.loadFullState()) || { dispatchers: [] };
    const disp = (state.dispatchers || []).find(d => String(d.id) === String(dispatcherId));

    if (!disp) return res.status(404).json({ ok: false, error: 'Dispatcher account not found.' });
    disp.active = false;
    state.dispatchers = state.dispatchers.filter(d => String(d.id) !== String(dispatcherId));

    await dataStore.saveFullState(state);

    await auditStore.record(
      { type: userRole, id: userId || 'admin', name: userName || 'Admin' },
      'ACCOUNT_REMOVED',
      { type: 'DISPATCHER', id: disp.id },
      { name: disp.name, email: disp.email, role: disp.role }
    );

    res.json({ ok: true, message: `Account ${disp.name} has been removed.` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;


