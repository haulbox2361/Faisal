/**
 * routes/dailyNotes.js
 * Endpoints for Daily Driver Notes and 4:00 PM – 5:00 PM Submission Tracking.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const dataStore = require('../lib/dataStore');

function getTodayIsoString() {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

/**
 * POST /api/daily-notes
 * Submits or edits a daily driver note for today.
 * Constraints:
 * - Max 100 characters strictly enforced.
 * - Same-day editing allowed only; past dates are locked.
 * - Admin can submit on behalf of any dispatcher.
 */
router.post('/', async (req, res) => {
  try {
    const { driverId, note, date, dispatcherId: reqDispId } = req.body || {};
    const today = getTodayIsoString();
    const targetDate = date ? String(date).slice(0, 10) : today;

    // Same-day edit lock: past dates cannot be edited
    if (targetDate < today) {
      return res.status(400).json({ error: 'Daily notes for past dates are locked and cannot be edited.' });
    }

    if (!driverId) {
      return res.status(400).json({ error: 'Driver ID is required.' });
    }

    const trimmedNote = String(note || '').trim();
    if (!trimmedNote) {
      return res.status(400).json({ error: 'Note text cannot be empty.' });
    }

    // Strictly enforce 100 character maximum
    if (trimmedNote.length > 100) {
      return res.status(400).json({ error: `Note exceeds maximum length of 100 characters (${trimmedNote.length}/100).` });
    }

    // Load state to verify driver and resolve assigned dispatcher
    const rawState = await dataStore.loadFullState().catch(() => null);
    const state = rawState || { drivers: [], dispatchers: [] };
    const driver = ((state && state.drivers) || []).find(d => String(d.id) === String(driverId) || String(d.code) === String(driverId));
    const driverName = driver ? driver.name : `Driver #${driverId}`;

    // Resolve dispatcher ID:
    // 1. Explicitly provided in request (e.g. Admin assigning or dispatcher frontend sending own ID)
    // 2. Assigned on driver record
    // 3. Fallback to 'unassigned'
    const dispatcherId = reqDispId || (driver && driver.dispatcherId) || 'admin';

    const saved = await db.saveDailyDriverNote({
      date: targetDate,
      dispatcherId,
      driverId: driver ? driver.id : driverId,
      driverName,
      note: trimmedNote,
      status: 'submitted'
    });

    res.json({ ok: true, note: saved });
  } catch (err) {
    console.error('[DailyNotes] Error saving note:', err);
    res.status(500).json({ error: 'Failed to save daily driver note: ' + err.message });
  }
});

/**
 * GET /api/daily-notes/status
 * Returns submission status for a dispatcher on a given date (defaults to today).
 * Used by the frontend 4:00 PM – 5:00 PM closing window checker.
 */
router.get('/status', async (req, res) => {
  try {
    const today = getTodayIsoString();
    const date = req.query.date ? String(req.query.date).slice(0, 10) : today;
    const dispatcherId = req.query.dispatcherId ? String(req.query.dispatcherId) : null;

    if (!dispatcherId) {
      return res.status(400).json({ error: 'dispatcherId query parameter is required.' });
    }

    const rawState = await dataStore.loadFullState().catch(() => null);
    const state = rawState || { drivers: [], dispatchers: [] };
    
    // Find all drivers allocated to this dispatcher
    const allocatedDrivers = ((state && state.drivers) || []).filter(d => String(d.dispatcherId) === String(dispatcherId));

    // Fetch existing notes for this dispatcher on this date
    const notes = await db.getDailyDriverNotes({ date, dispatcherId });
    const notesMap = new Map();
    notes.forEach(n => {
      notesMap.set(String(n.driver_id), n);
    });

    const submittedDrivers = [];
    const missingDrivers = [];

    allocatedDrivers.forEach(d => {
      const existing = notesMap.get(String(d.id));
      if (existing && existing.status === 'submitted' && existing.note) {
        submittedDrivers.push({
          driverId: d.id,
          driverName: d.name,
          truck: d.truck || '',
          note: existing.note,
          submittedAt: existing.submitted_at
        });
      } else {
        missingDrivers.push({
          driverId: d.id,
          driverName: d.name,
          truck: d.truck || ''
        });
      }
    });

    res.json({
      ok: true,
      date,
      dispatcherId,
      totalDrivers: allocatedDrivers.length,
      submittedCount: submittedDrivers.length,
      missingCount: missingDrivers.length,
      allSubmitted: missingDrivers.length === 0,
      missingDrivers,
      submittedDrivers
    });
  } catch (err) {
    console.error('[DailyNotes] Error fetching status:', err);
    res.status(500).json({ error: 'Failed to fetch daily notes status: ' + err.message });
  }
});

/**
 * GET /api/daily-notes/report
 * Returns the full daily report grouped per dispatcher for a date (defaults to today).
 * Supports rolling 3-5 days history.
 */
router.get('/report', async (req, res) => {
  try {
    const today = getTodayIsoString();
    const date = req.query.date ? String(req.query.date).slice(0, 10) : today;
    const filterDispId = req.query.dispatcherId ? String(req.query.dispatcherId) : null;

    const rawState = await dataStore.loadFullState().catch(() => null);
    const state = rawState || { drivers: [], dispatchers: [] };
    const dispatchersList = (state && state.dispatchers) || [];
    const driversList = (state && state.drivers) || [];

    // Fetch all notes submitted for this date
    const notes = await db.getDailyDriverNotes({ date });
    const notesByDriver = new Map();
    notes.forEach(n => {
      notesByDriver.set(String(n.driver_id), n);
    });

    let totalDriversOverall = 0;
    let submittedNotesOverall = 0;
    let missingNotesOverall = 0;

    const groupedReports = [];

    // Filter dispatchers if requested
    const targetDispatchers = filterDispId 
      ? dispatchersList.filter(d => String(d.id) === String(filterDispId))
      : dispatchersList;

    targetDispatchers.forEach(disp => {
      const allocatedDrivers = driversList.filter(d => String(d.dispatcherId) === String(disp.id));
      
      const driverRows = allocatedDrivers.map(d => {
        const noteRecord = notesByDriver.get(String(d.id));
        const isSubmitted = !!(noteRecord && noteRecord.status === 'submitted' && noteRecord.note);

        if (isSubmitted) {
          submittedNotesOverall++;
        } else {
          missingNotesOverall++;
        }
        totalDriversOverall++;

        return {
          driverId: d.id,
          driverName: d.name,
          truck: d.truck || '',
          phone: d.phone || '',
          note: noteRecord ? noteRecord.note : null,
          status: isSubmitted ? 'submitted' : 'missing',
          submittedAt: noteRecord ? noteRecord.submitted_at : null,
          updatedAt: noteRecord ? noteRecord.updated_at : null
        };
      });

      const submittedCount = driverRows.filter(r => r.status === 'submitted').length;
      const missingCount = driverRows.filter(r => r.status === 'missing').length;

      groupedReports.push({
        dispatcherId: disp.id,
        dispatcherName: disp.name,
        dispatcherEmail: disp.email || '',
        totalDrivers: allocatedDrivers.length,
        submittedCount,
        missingCount,
        allSubmitted: missingCount === 0 && allocatedDrivers.length > 0,
        drivers: driverRows
      });
    });

    res.json({
      ok: true,
      date,
      summary: {
        totalDispatchers: targetDispatchers.length,
        totalDrivers: totalDriversOverall,
        submittedNotes: submittedNotesOverall,
        missingNotes: missingNotesOverall
      },
      dispatchers: groupedReports
    });
  } catch (err) {
    console.error('[DailyNotes] Error generating report:', err);
    res.status(500).json({ error: 'Failed to generate daily report: ' + err.message });
  }
});

module.exports = router;
