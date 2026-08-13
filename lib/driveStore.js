// Google Drive document storage helper.
// All Drive API calls run server-side — no credentials ever reach the browser.
// Folder IDs come from Render env vars (RC_FOLDER_ID, BOL_FOLDER_ID, POD_FOLDER_ID)
// that the user already configured; this module never creates new folders.

const { google } = require('googleapis');
const { Readable } = require('stream');
const { getPool, ensureSchema } = require('./db');

// Returns the three folder IDs from environment variables.
function folderIds() {
  return {
    RC:  (process.env.RC_FOLDER_ID  || '').trim(),
    BOL: (process.env.BOL_FOLDER_ID || '').trim(),
    POD: (process.env.POD_FOLDER_ID || '').trim(),
  };
}

function folderIdFor(docType) {
  const id = folderIds()[docType];
  if (!id) {
    throw new Error(
      `${docType}_FOLDER_ID environment variable is not set. ` +
      `Add it in Render → Environment Variables and redeploy.`
    );
  }
  return id;
}

// Build the canonical Drive filename for a document, following the spec:
//   RC      → "MM-DD-YYYY PUState-DOState DriverName.ext"
//   BOL/POD → "LoadNumber DriverName.ext"
function buildFileName(docType, { loadNumber, pickup, dropoff, pickupDate, driverName, originalName } = {}) {
  const origExt = originalName ? ('.' + (originalName.split('.').pop() || 'pdf')) : '.pdf';
  const safeExt = /^\.[a-z0-9]{1,6}$/i.test(origExt) ? origExt : '.pdf';

  function stateAbbrev(loc) {
    const s = (loc || '').trim();
    const m = s.match(/,\s*([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
    if (m) return m[1].toUpperCase();
    const names = {
      alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',
      colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',
      hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',
      kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',
      michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',
      nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
      'new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',
      oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC',
      'south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',
      virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY',
      'district of columbia':'DC',
    };
    const key = s.toLowerCase().replace(/[^a-z ]/g, '').trim();
    for (const name in names) { if (key.includes(name)) return names[name]; }
    return 'XX';
  }

  function safe(str) {
    return (str || '').trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
  }

  if (docType === 'RC') {
    let datePart = 'no-date';
    if (pickupDate) {
      const d = new Date(String(pickupDate).includes('T') ? pickupDate : pickupDate + 'T00:00:00');
      if (!isNaN(d)) {
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        datePart = `${mm}-${dd}-${yyyy}`;
      }
    }
    const lane = `${stateAbbrev(pickup)}-${stateAbbrev(dropoff)}`;
    const name = safe(driverName) || 'Driver';
    return `${datePart} ${lane} ${name}${safeExt}`;
  }

  // BOL / POD
  const num  = safe(loadNumber) || 'LOAD';
  const name = safe(driverName) || 'Driver';
  return `${num} ${name}${safeExt}`;
}

// Server-side duplicate check: query Drive for this filename inside the folder.
async function findExistingInFolder(driveClient, folderId, fileName) {
  try {
    const escaped = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${escaped}' and '${folderId}' in parents and trashed = false`;
    const { data } = await driveClient.files.list({
      q,
      fields: 'files(id, name, webViewLink)',
      spaces: 'drive',
      pageSize: 1,
    });
    return (data.files && data.files.length > 0) ? data.files[0] : null;
  } catch (e) {
    console.error('Drive duplicate check failed:', e.message);
    return null;
  }
}

// Upload a document to the specified Drive folder.
// auth     — authenticated OAuth2 client (from clientForAccount())
// Returns { fileId, webViewLink, duplicate } — duplicate=true if already existed.
async function uploadToFolder(auth, { folderId, fileName, mimeType, base64Data }) {
  if (!folderId) throw new Error('No folder ID provided to uploadToFolder()');
  if (!fileName) throw new Error('No file name provided to uploadToFolder()');

  const driveClient = google.drive({ version: 'v3', auth });

  // Server-side duplicate check FIRST
  const existing = await findExistingInFolder(driveClient, folderId, fileName);
  if (existing) {
    return { fileId: existing.id, webViewLink: existing.webViewLink || null, duplicate: true };
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const { data: file } = await driveClient.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });

  return { fileId: file.id, webViewLink: file.webViewLink || null, duplicate: false };
}

// Persist a Drive upload record to the drive_uploads Postgres table.
async function recordUpload({ loadId, driverId, docType, driveFileId, fileName, folderId, webViewLink, uploadedBy }) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO drive_uploads
       (load_id, driver_id, doc_type, drive_file_id, file_name, folder_id, web_view_link, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (drive_file_id) DO NOTHING`,
    [loadId || null, driverId || null, docType, driveFileId, fileName, folderId || null, webViewLink || null, uploadedBy || null]
  );
}

// Return all Drive upload records for a given load, most-recent first.
async function getUploadsForLoad(loadId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, doc_type, drive_file_id, file_name, web_view_link, uploaded_by, uploaded_at
     FROM drive_uploads WHERE load_id=$1 ORDER BY uploaded_at DESC`,
    [loadId]
  );
  return rows.map((r) => ({
    id:           r.id,
    docType:      r.doc_type,
    driveFileId:  r.drive_file_id,
    fileName:     r.file_name,
    webViewLink:  r.web_view_link,
    uploadedBy:   r.uploaded_by,
    uploadedAt:   r.uploaded_at,
  }));
}

module.exports = { folderIds, folderIdFor, buildFileName, uploadToFolder, recordUpload, getUploadsForLoad };
