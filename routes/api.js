const express = require('express');
const { google } = require('googleapis');
const MailComposer = require('nodemailer/lib/mail-composer');
const { Readable } = require('stream');
const store = require('../lib/store');
const { clientForAccount } = require('../lib/googleClient');

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

// POST /api/drive-upload  { accountId, fileName, mimeType, data }
router.post('/api/drive-upload', async (req, res) => {
  const ctx = await requireAccount(req, res);
  if (!ctx) return;
  const { fileName, mimeType, data } = req.body;
  if (!fileName || !data) return res.status(400).json({ error: 'Missing fileName or data' });

  try {
    const auth = clientForAccount(ctx.record, store, ctx.accountId);
    const drive = google.drive({ version: 'v3', auth });
    const buffer = Buffer.from(data, 'base64');
    const media = { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) };

    const { data: file } = await drive.files.create({
      requestBody: { name: fileName },
      media,
      fields: 'id, webViewLink',
    });

    res.json({ ok: true, fileId: file.id, webViewLink: file.webViewLink });
  } catch (e) {
    console.error('drive-upload failed:', e);
    res.status(500).json({ error: e.message || 'Failed to upload to Drive' });
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
