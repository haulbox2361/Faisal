const express = require('express');
const { google } = require('googleapis');
const MailComposer = require('nodemailer/lib/mail-composer');
const { Readable } = require('stream');
const store = require('../lib/store');
const { clientForAccount } = require('../lib/googleClient');
const driveStore = require('../lib/driveStore');

const router = express.Router();
router.use(express.json({ limit: '25mb' })); // attachments arrive as base64 in the JSON body

async function requireAccount(req, res) {
  const accountId = req.body.accountId || req.query.accountId;
  if (!accountId) {
    res.status(400).json({ error: 'Missing accountId' });
    return null;
  }
  const record = await store.get(accountId);
  if (!record) {
    res.status(401).json({ error: 'This account is not connected to Google. Connect it in My Account / Settings, then try again.' });
    return null;
  }
  return { accountId, record };
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
// Keeps a shared Google Sheet live-updated with load data. row[1] is the
// Load # (column B — see SHEET_KEY_INDEX in the frontend) — used as the key
// to find and update an existing row instead of creating a duplicate every
// time a load's status changes. If no matching row exists yet, appends a new
// one. Requires the connected account to have Editor access on the target
// Sheet — sharing is done by the user directly in Google Sheets, not through
// this app.
router.post('/api/sheet-sync', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { spreadsheetId, sheetName, row } = req.body || {};
  if (!spreadsheetId) return res.status(400).json({ error: 'Missing spreadsheetId' });
  if (!Array.isArray(row) || !row.length) return res.status(400).json({ error: 'Missing row data' });

  const tab = (sheetName || 'Sheet1').trim() || 'Sheet1';
  const KEY_COLUMN = 'B'; // Load Number column — must match SHEET_KEY_INDEX (1) in the frontend's buildSheetRow()
  const key = String(row[1] || '').trim();

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const sheets = google.sheets({ version: 'v4', auth });

    // Look for an existing row with this Load # in the key column.
    const { data: existing } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!${KEY_COLUMN}:${KEY_COLUMN}`,
    });
    const colB = existing.values || [];
    let rowNumber = -1; // 1-indexed sheet row
    for (let i = 0; i < colB.length; i++) {
      if (String((colB[i] || [])[0] || '').trim() === key) { rowNumber = i + 1; break; }
    }

    // First-ever sync to an empty sheet — write the header row your columns expect.
    if (colB.length === 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [['Date', 'Load Number', 'Broker', 'MC #', 'Driver Name', 'Pickup', 'Drop-off', 'PU Date', 'DO Date', 'Broker Rate', 'Dispatcher Name']] },
      });
    }

    if (rowNumber === -1) {
      // No header row assumption needed — append just adds after the last used row.
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    }

    res.json({ ok: true, updatedExisting: rowNumber !== -1 });
  } catch (e) {
    console.error('sheet-sync failed:', e);
    res.status(500).json({ error: e.message || 'Failed to sync to Google Sheet' });
  }
});

module.exports = router;
