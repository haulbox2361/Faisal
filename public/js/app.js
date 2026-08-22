/* =========================================================================
       HAULBOX — DISPATCH TMS
       Persistence: window.storage (per-user, survives reloads)
       Gmail send / Reply-All / Drive upload / Google OAuth are now REAL, via the
       Node/Express backend in this repo (server.js + routes/*.js) — see
       sendDoc(), savePackageToDrive(), connectGoogleAccount()/connectMyGoogleAccount().
       ========================================================================= */

    /* ---- Storage polyfill --------------------------------------------------
       window.storage is provided automatically inside the Claude artifact
       sandbox. Running this file for real (via `npm start`, served from
       server.js) doesn't have that host, so this fills in the same
       get/set/delete/list API by calling this repo's own backend
       (routes/storage.js), which persists to Supabase Postgres — shared by
       every dispatcher and the admin, not just the one browser that saved it.
       If a real window.storage is already present, this does nothing. */
    (function () {
      if (window.storage) return;
      window.storage = {
        async get(key) {
          const res = await fetch('/api/storage/' + encodeURIComponent(key));
          if (res.status === 404) throw new Error('Key not found: ' + key);
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Storage read failed');
          return res.json();
        },
        async set(key, value) {
          const res = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Storage write failed');
          return res.json();
        },
        async delete(key) {
          const res = await fetch('/api/storage/' + encodeURIComponent(key), { method: 'DELETE' });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Storage delete failed');
          return res.json();
        },
        async list(prefix) {
          const res = await fetch('/api/storage' + (prefix ? ('?prefix=' + encodeURIComponent(prefix)) : ''));
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Storage list failed');
          return res.json();
        }
      };
    })();

    let STATE = { loads: [], drivers: [], brokers: [], dispatchers: [], settings: {}, chat: {}, emailLogs: [], driveFiles: [], notifications: [], currentUser: null, role: 'admin', currentDispatcherId: null, viewAs: null, loadFilter: 'all' };
    let CHARTS = {};
    let pendingSelectTarget = null; // 'broker' | 'driver' — set when quick-adding from the Add Load form

    // Statuses are computed automatically from which documents are on file — see computeStatus().
    // NO RC  = Pending RC (the load is NOT booked until the Rate Confirmation is shared)
    // RC     = Booked
    // BOL    = Loaded
    // POD    = Drop-off  → after this the Admin-only payment stage takes over.
    const STATUS_META = {
      'Pending RC': { color: 'gray', label: 'Pending RC' },
      'Booked': { color: 'yellow', label: '🟡 Booked' },
      'ACCEPTED': { color: 'green', label: '🟢 Accepted' },
      'Accepted': { color: 'green', label: '🟢 Accepted' },
      'AT_PICKUP': { color: 'yellow', label: '🟡 At Pickup' },
      'At Pickup': { color: 'yellow', label: '🟡 At Pickup' },
      'Loaded': { color: 'yellow', label: '🟡 Loaded' },
      'IN_TRANSIT': { color: 'green', label: '🟢 In Transit' },
      'In Transit': { color: 'green', label: '🟢 In Transit' },
      'AT_DELIVERY': { color: 'yellow', label: '🟡 At Delivery' },
      'At Delivery': { color: 'yellow', label: '🟡 At Delivery' },
      'Drop-off': { color: 'yellow', label: '🟡 Drop-off' },
      'DELIVERED': { color: 'green', label: '🟢 Delivered' },
      'Delivered': { color: 'green', label: '🟢 Delivered' },
      'POD Uploaded': { color: 'green', label: '🟢 POD Uploaded' },
      'Issue': { color: 'red', label: '🔴 Issue' },
      'Needs Review': { color: 'red', label: '🔴 Needs Review' },
      'Cancelled': { color: 'red', label: '🔴 Cancelled' },
      'Payment Not Requested': { color: 'gray', label: 'Payment Not Requested' },
      'Payment Requested': { color: 'yellow', label: 'Payment Requested' },
      'Payment Received': { color: 'green', label: 'Payment Received' },
    };
    // Admin-only stages that only exist once a load has been dropped off.
    const PAYMENT_STAGES = ['Payment Not Requested', 'Payment Requested', 'Payment Received'];
    function computeStatus(l) {
      if (l.docs && l.docs.POD) return 'Drop-off';
      if (l.docs && l.docs.BOL) return 'Loaded';
      if (l.docs && l.docs.RC) return 'Booked';
      return 'Pending RC';
    }
    // Payment stage only applies after drop-off; null everywhere else.
    function paymentOf(l) {
      if (!l || l.status !== 'Drop-off') return null;
      return PAYMENT_STAGES.includes(l.payment) ? l.payment : 'Payment Not Requested';
    }
    function setPayment(loadId, val) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can update the payment stage.');
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      if (l.status !== 'Drop-off') return toast('Not dropped off yet', 'Payment stages open once the POD is uploaded.');
      l.payment = val; persist();
      toast('Payment stage updated', l.loadNumber + ' → ' + val, true);
      openLoadModal(loadId); renderLoadBoard(); renderDashboard();
    }
    // Normalises anything loaded from storage (including records saved under the old status names).
    function migrateLoads() {
      (STATE.loads || []).forEach(l => {
        l.docs = l.docs || { RC: null, BOL: null, POD: null, PhotosPU: [], PhotosDO: [], Extra: [] };
        if (l.docs.Photos && !l.docs.PhotosPU) { l.docs.PhotosPU = l.docs.Photos; l.docs.PhotosDO = l.docs.PhotosDO || []; delete l.docs.Photos; }
        l.docs.PhotosPU = l.docs.PhotosPU || []; l.docs.PhotosDO = l.docs.PhotosDO || [];
        l.status = computeStatus(l);
        if (l.status === 'Drop-off' && !PAYMENT_STAGES.includes(l.payment)) l.payment = 'Payment Not Requested';
        if (l.status !== 'Drop-off') l.payment = null;
        // Lease driver pay — backfilled for loads booked before this existed.
        if (l.driverPayPct == null || l.driverPayPct === '') l.driverPayPct = driverPayPctFor(l.driverId);
        l.driverDeduction = Number(l.driverDeduction || 0);
        l.driverPayNote = l.driverPayNote || '';
        l.driverPaid = !!l.driverPaid;
        l.driverPaidDate = l.driverPaidDate || null;
        l.paymentStatus = l.paymentStatus || (l.driverPayAccepted ? 'PAID_CONFIRMED' : (l.driverPaid ? 'PAYMENT_PENDING_CONFIRMATION' : 'UNPAID'));
        l.driverPay = driverPayOf(l);
      });
    }
    /* Backfills driver records saved before the extended profile fields existed. */
    function migrateDrivers() {
      let addedLogins = false;
      (STATE.drivers || []).forEach(d => {
        d.docs = d.docs || [];
        if (d.payPct == null || d.payPct === '') d.payPct = defaultDriverPayPct();
        // Backfill Driver App login credentials for drivers created before the
        // driver portal existed, so Admin doesn't have to re-save every driver
        // by hand — just open Drivers and copy each one's login info to share.
        if (!d.driverCode) { d.driverCode = genUniqueDriverCode(d.id); addedLogins = true; }
        if (!d.pin) { d.pin = genDriverPin(); addedLogins = true; }
      });
      if (addedLogins) persist();
    }

    /* ---------------- Lease driver pay helpers (Admin-only figures) ----------------
       Drivers are leased on: each one is paid a fixed percentage of the gross (broker rate)
       of every load they run. The percentage lives on the driver record (payPct) and is
       snapshotted onto each load at booking time (driverPayPct), so changing a driver's
       percentage later never rewrites what they were already owed on past loads. */
    function defaultDriverPayPct() {
      const v = STATE.settings ? STATE.settings.defaultDriverPayPct : null;
      return (v == null || v === '') ? 88 : Number(v);
    }
    function driverPayPctFor(driverId) {
      const d = STATE.drivers.find(x => x.id === driverId);
      if (d && d.payPct != null && d.payPct !== '') return Number(d.payPct);
      return defaultDriverPayPct();
    }
    function driverPayOf(l) {
      if (!l) return 0;
      const pct = (l.driverPayPct == null || l.driverPayPct === '') ? driverPayPctFor(l.driverId) : Number(l.driverPayPct);
      return Math.round(Number(l.brokerRate || 0) * pct / 100 * 100) / 100;
    }
    function driverNetOf(l) {
      return Math.round((driverPayOf(l) - Number((l && l.driverDeduction) || 0)) * 100) / 100;
    }
    /* What the company keeps on a load once the leased driver has been paid. */
    function companyMarginOf(l) {
      return Math.round((Number((l && l.brokerRate) || 0) - driverPayOf(l)) * 100) / 100;
    }
    /* Settlement date a load is filed under — delivery date when known, booking date otherwise. */
    function settlementDateOf(l) { return (l && (l.deliveryDate || l.systemDate)) || ''; }
    /* Loads visible to the current logged-in user: admins (and view-only links) see everything,
       a dispatcher only ever sees loads assigned to them. */
    function visibleLoads() {
      if (STATE.role === 'dispatcher') return STATE.loads.filter(l => l.dispatcherId === STATE.currentDispatcherId);
      if (STATE.viewAs) return STATE.loads.filter(l => l.dispatcherId === STATE.viewAs);
      return STATE.loads;
    }
    function canAccessLoad(l) {
      if (!l) return false;
      if (STATE.role === 'dispatcher') return l.dispatcherId === STATE.currentDispatcherId;
      return true;
    }
    /* Drivers visible to the current user: admins see every driver. A dispatcher only sees a
       driver that Admin has explicitly assigned to them — unassigned drivers stay hidden from
       every dispatcher until Admin assigns them, so nobody sees drivers that aren't theirs. */
    function visibleDrivers() {
      if (STATE.role === 'dispatcher') return STATE.drivers.filter(d => d.dispatcherId === STATE.currentDispatcherId);
      if (STATE.viewAs) return STATE.drivers.filter(d => d.dispatcherId === STATE.viewAs);
      return STATE.drivers;
    }

    /* ---------------- Bootstrap / seed data ---------------- */
    function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); }

    function seedData() {
      const dispatchers = [
        { id: uid('dsp'), name: 'Dana Jacobs', email: 'dana@haulline.co' },
        { id: uid('dsp'), name: 'Marcus Lee', email: 'marcus.l@haulline.co' },
        { id: uid('dsp'), name: 'Sofia Reyes', email: 'sofia.r@haulline.co' },
      ];
      const drivers = [
        { id: uid('drv'), name: 'Julius Miley', payPct: 88, truck: 'HL-204', phone: '(316) 555-0142', email: 'julius.m@haulline.co', company: 'Miley Freight LLC', hometown: 'Wichita, KS', otrLocal: 'OTR', team: 'No', feePct: 10, truckType: 'Sleeper', trailerType: 'Flatbed', trailerSize: '48ft', maxWeight: '48,000 lbs', ramps: 'Yes', rampType: 'Aluminum beavertail ramps', tarps: 'Yes', chains: 'Yes', binders: 'Yes', cdl: 'Yes', hazmat: 'Yes', backgroundClear: 'Yes', usCitizen: 'Yes', docs: [], notes: 'Flatbed, hazmat certified', active: true },
        { id: uid('drv'), name: 'Renee Castillo', payPct: 85, truck: 'HL-211', phone: '(214) 555-0198', email: 'renee.c@haulline.co', company: 'Castillo Transport', hometown: 'Dallas, TX', otrLocal: 'OTR', team: 'No', feePct: 12, truckType: 'Sleeper', trailerType: 'Dry Van', trailerSize: '53ft', maxWeight: '45,000 lbs', ramps: 'No', rampType: '', tarps: 'No', chains: 'No', binders: 'No', cdl: 'Yes', hazmat: 'No', backgroundClear: 'Yes', usCitizen: 'Yes', docs: [], notes: '', active: true },
        { id: uid('drv'), name: 'Marcus Webb', payPct: 90, truck: 'HL-118', phone: '(405) 555-0173', email: 'marcus.w@haulline.co', company: 'Webb Hotshot Co', hometown: 'Oklahoma City, OK', otrLocal: 'Local', team: 'No', feePct: 10, truckType: 'Day Cab', trailerType: 'Hotshot', trailerSize: '40ft', maxWeight: '16,500 lbs', ramps: 'Yes', rampType: 'Steel slide ramps', tarps: 'No', chains: 'Yes', binders: 'Yes', cdl: 'No', hazmat: 'No', backgroundClear: 'Yes', usCitizen: 'Yes', docs: [], notes: 'Prefers TX/OK/KS lanes', active: true },
        { id: uid('drv'), name: 'Priya Anand', payPct: 87, truck: 'HL-330', phone: '(918) 555-0129', email: 'priya.a@haulline.co', company: 'Anand Logistics', hometown: 'Tulsa, OK', otrLocal: 'OTR', team: 'Yes', feePct: 8, truckType: 'Sleeper', trailerType: 'Reefer', trailerSize: '53ft', maxWeight: '44,000 lbs', ramps: 'No', rampType: '', tarps: 'No', chains: 'No', binders: 'No', cdl: 'Yes', hazmat: 'No', backgroundClear: 'Yes', usCitizen: 'No', docs: [], notes: '', active: false },
      ];
      const brokers = [
        { id: uid('brk'), name: 'TQL', mc: 'MC-123456', phone: '(800) 580-3101', email: 'ops@tql.com', notes: 'Net 30' },
        { id: uid('brk'), name: 'Landstar', mc: 'MC-654321', phone: '(800) 872-9400', email: 'dispatch@landstar.com', notes: '' },
        { id: uid('brk'), name: 'Coyote Logistics', mc: 'MC-789012', phone: '(877) 626-9683', email: 'carrier@coyote.com', notes: 'Quick pay 2%' },
        { id: uid('brk'), name: 'Uber Freight', mc: 'MC-345678', phone: '(415) 555-0110', email: 'support@uberfreight.com', notes: '' },
      ];
      const today = new Date();
      function d(offset) { const x = new Date(today); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); }
      const routes = [
        ['Wichita, KS', 'Birmingham, AL'], ['Dallas, TX', 'Atlanta, GA'], ['Tulsa, OK', 'Denver, CO'],
        ['Oklahoma City, OK', 'Memphis, TN'], ['Kansas City, MO', 'Chicago, IL'], ['Houston, TX', 'Nashville, TN'],
        ['Little Rock, AR', 'Jacksonville, FL'], ['Amarillo, TX', 'Phoenix, AZ']
      ];
      const miles = [780, 810, 660, 490, 590, 870, 1120, 960];
      const loads = routes.map((r, i) => {
        const rate = 1400 + Math.round(Math.random() * 1800);
        const drv = drivers[i % drivers.length];
        const brk = brokers[i % brokers.length];
        const dsp = dispatchers[i % dispatchers.length];
        const fee = drv.feePct;
        const mi = miles[i];
        const docs = {
          RC: i > 0 ? { name: 'RC_' + (10420 + i) + '.pdf', data: null } : null,
          PhotosPU: i > 2 ? [{ name: 'freight_pu_1.jpg', data: null }] : [],
          PhotosDO: i > 4 ? [{ name: 'freight_do_1.jpg', data: null }] : [],
          BOL: i > 3 ? { name: 'BOL_' + (10420 + i) + '.pdf', data: null } : null,
          POD: i > 4 ? { name: 'POD_' + (10420 + i) + '.pdf', data: null } : null,
        };
        const load = {
          id: uid('ld'),
          loadNumber: 'HL-' + (10420 + i),
          systemDate: d(-i),
          dispatcherId: dsp.id, dispatcherName: dsp.name,
          brokerId: brk.id, brokerName: brk.name, brokerMC: brk.mc, brokerEmail: brk.email,
          driverId: drv.id, driverName: drv.name, truck: drv.truck,
          pickup: r[0], dropoff: r[1],
          pickupDate: d(-i + 1), deliveryDate: d(-i + 3),
          miles: mi, brokerRate: rate, ratePerMile: Math.round(rate / mi * 100) / 100,
          feePct: fee, dispatchRevenue: Math.round(rate * fee / 100 * 100) / 100,
          driverPayPct: drv.payPct, driverPay: Math.round(rate * drv.payPct / 100 * 100) / 100,
          driverDeduction: 0, driverPayNote: '', driverPaid: i > 6, driverPaidDate: i > 6 ? d(-i + 4) : null,
          notes: '',
          docs: docs,
        };
        load.status = computeStatus(load);
        if (load.status === 'Drop-off') load.payment = i > 6 ? 'Payment Received' : (i > 5 ? 'Payment Requested' : 'Payment Not Requested');
        return load;
      });
      const settings = {
        companyName: 'Haulline Freight Co.',
        defaultFeePct: 10,
        defaultDriverPayPct: 88,
        zipFormat: '{MM-DD-YYYY} {PickupState}-{DropState} {DriverName}.zip',
        gmailConnected: false, sheetsConnected: false, driveConnected: false,
        rcSubject: 'Rate Confirmation — Load {LoadNumber}',
        rcBody: "Hi {DriverName},\n\nAttached is the rate confirmation for load {LoadNumber}, {Pickup} to {DropOff}.\n\nThanks,\n{CompanyName} Dispatch",
      };
      return { drivers, brokers, dispatchers, loads, settings };
    }

    async function loadState() {
      try {
        const res = await window.storage.get('haulline:state', false);
        if (res && res.value) {
          STATE = Object.assign(STATE, JSON.parse(res.value));
          STATE.chat = STATE.chat || {};
          STATE.emailLogs = STATE.emailLogs || [];
          STATE.driveFiles = STATE.driveFiles || [];
          STATE.notifications = STATE.notifications || [];
          migrateDrivers();
          migrateLoads();
          return true; // Successfully loaded
        }
      } catch (e) {
        console.error('Database error:', e.message);
      }
      // Database unavailable — show error screen instead of fallback to fake data
      showErrorScreen('Database Unavailable', 
        'Cannot connect to the database. Please refresh and try again. ' +
        'If this persists, contact support.');
      return false; // Failed to load
    }

    function showErrorScreen(title, message) {
      document.getElementById('app').style.display = 'none';
      document.getElementById('login-gate').style.display = 'none';
      
      const errorScreen = document.createElement('div');
      errorScreen.id = 'error-screen';
      errorScreen.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: #f5f5f5; display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; z-index: 9999;
      `;
      
      errorScreen.innerHTML = `
        <div style="text-align: center; max-width: 500px; padding: 2rem;">
          <h1 style="color: #d32f2f; margin-bottom: 1rem;">${title}</h1>
          <p style="color: #666; margin-bottom: 1rem;">${message}</p>
          <button onclick="location.reload()" style="
            padding: 0.75rem 1.5rem; background: #2196F3; color: white; 
            border: none; border-radius: 4px; cursor: pointer; font-size: 1rem;
          ">Refresh Page</button>
        </div>
      `;
      
      document.body.appendChild(errorScreen);
    }

    let saveTimer = null;
    async function persist() {
      clearTimeout(saveTimer);
      return new Promise(resolve => {
        saveTimer = setTimeout(async () => {
          try {
            const payload = { drivers: STATE.drivers, brokers: STATE.brokers, dispatchers: STATE.dispatchers, loads: STATE.loads, settings: STATE.settings, chat: STATE.chat || {}, emailLogs: STATE.emailLogs || [], driveFiles: STATE.driveFiles || [], notifications: STATE.notifications || [] };
            await window.storage.set('haulline:state', JSON.stringify(payload), false);
          } catch (e) { console.error('Save failed', e); }
          resolve();
        }, 250);
      });
    }

    /* ---------------- Login (real Google sign-in, gated by registered email) ----------------
       Anyone can click "Sign in with Google" and pick any Google account — that's normal.
       What matters is what happens after: the signed-in email is checked against a
       fixed Admin email (set server-side via ADMIN_EMAIL, fetched from /api/config —
       see loadAdminEmailConfig()) and every dispatcher's registered email (d.email).
       A match goes straight to that person's dashboard; no match is rejected outright —
       there's no "pick who you are" step where someone could just claim to be Admin. */
    function initials(name) { return (name || '').split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?'; }

    // The one Google account allowed to sign in as Admin. Fetched once from the
    // backend (server.js reads it from ADMIN_EMAIL, hardcoded default set there)
    // so it can't be spoofed by editing anything client-side.
    let ADMIN_EMAILS_ALLOWED = [];
    let SUPER_ADMIN_EMAIL_REQUIRED = '';
    async function loadAdminEmailConfig() {
      if (ADMIN_EMAILS_ALLOWED && ADMIN_EMAILS_ALLOWED.length) return ADMIN_EMAILS_ALLOWED;
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        ADMIN_EMAILS_ALLOWED = (data.adminEmails || [data.adminEmail || '']).map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
        SUPER_ADMIN_EMAIL_REQUIRED = String(data.superAdminEmail || data.adminEmail || '').trim().toLowerCase();
      } catch (e) {
        ADMIN_EMAILS_ALLOWED = ['haulbox2361@gmail.com'];
        SUPER_ADMIN_EMAIL_REQUIRED = 'haulbox2361@gmail.com';
      }
      return ADMIN_EMAILS_ALLOWED;
    }

    // Which signed-in Google account this browser last got into HaulBoX with
    const SESSION_KEY = 'haulline-session-email';
    const SESSION_USER_KEY = 'haulbox_session_user';
    const SESSION_UI_KEY = 'haulbox_ui_state';
    const SESSION_DRAFTS_KEY = 'haulbox_form_drafts';

    const SessionManager = {
      saveSession(email, role, currentUser, currentDispatcherId = null, isSuperAdmin = false) {
        try {
          localStorage.setItem(SESSION_KEY, email);
          localStorage.setItem(SESSION_USER_KEY, JSON.stringify({
            email,
            role,
            currentUser,
            currentDispatcherId,
            isSuperAdmin,
            savedAt: new Date().toISOString(),
          }));
        } catch (_) {}
      },

      loadSession() {
        try {
          const email = localStorage.getItem(SESSION_KEY);
          const raw = localStorage.getItem(SESSION_USER_KEY);
          if (!email) return null;
          if (!raw) return { email };
          return JSON.parse(raw);
        } catch (_) {
          return null;
        }
      },

      clearSession() {
        try {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem(SESSION_USER_KEY);
          localStorage.removeItem(SESSION_UI_KEY);
          localStorage.removeItem('haulbox_active_view');
        } catch (_) {}
      },

      saveUiState(stateUpdates = {}) {
        try {
          const existing = this.loadUiState() || {};
          const merged = { ...existing, ...stateUpdates, updatedAt: new Date().toISOString() };
          localStorage.setItem(SESSION_UI_KEY, JSON.stringify(merged));
        } catch (_) {}
      },

      loadUiState() {
        try {
          const raw = localStorage.getItem(SESSION_UI_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch (_) {
          return {};
        }
      },

      saveFormDraft(formId, data) {
        try {
          const allDrafts = this.loadAllDrafts();
          allDrafts[formId] = { data, updatedAt: new Date().toISOString() };
          localStorage.setItem(SESSION_DRAFTS_KEY, JSON.stringify(allDrafts));
        } catch (_) {}
      },

      loadFormDraft(formId) {
        try {
          const allDrafts = this.loadAllDrafts();
          return (allDrafts[formId] && allDrafts[formId].data) || null;
        } catch (_) {
          return null;
        }
      },

      loadAllDrafts() {
        try {
          const raw = localStorage.getItem(SESSION_DRAFTS_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch (_) {
          return {};
        }
      },

      clearFormDraft(formId) {
        try {
          const allDrafts = this.loadAllDrafts();
          delete allDrafts[formId];
          localStorage.setItem(SESSION_DRAFTS_KEY, JSON.stringify(allDrafts));
        } catch (_) {}
      }
    };

    async function restoreSession() {
      let sessionToken = '';
      try { sessionToken = localStorage.getItem('haulbox_web_session_token') || ''; } catch (e) { }
      
      // Legacy unauthenticated email strings in localStorage are rejected
      if (!sessionToken) {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
        if (typeof SessionManager !== 'undefined') SessionManager.clearSession();
        return false;
      }

      // Verify token with backend
      try {
        const res = await fetch('/auth/verify-session', {
          headers: { 'Authorization': 'Bearer ' + sessionToken }
        });
        const data = res.ok ? await res.json() : null;
        if (!data || !data.ok || !data.email) {
          try { localStorage.removeItem('haulbox_web_session_token'); } catch (e) { }
          if (typeof SessionManager !== 'undefined') SessionManager.clearSession();
          return false;
        }

        const verifiedEmail = data.email.toLowerCase().trim();
        const adminEmails = await loadAdminEmailConfig();
        const matchedDispatcher = STATE.dispatchers.find(d => (d.email || '').trim().toLowerCase() === verifiedEmail);

        if (matchedDispatcher) {
          STATE.role = 'dispatcher';
          STATE.isSuperAdmin = false;
          STATE.currentDispatcherId = matchedDispatcher.id;
          STATE.viewAs = null;
          STATE.currentUser = { name: matchedDispatcher.name, email: matchedDispatcher.googleAccountEmail || verifiedEmail, initials: initials(matchedDispatcher.name) };
          enterApp();
          return true;
        }
        if (adminEmails && adminEmails.includes(verifiedEmail)) {
          STATE.role = 'admin';
          STATE.isSuperAdmin = (verifiedEmail === SUPER_ADMIN_EMAIL_REQUIRED) || (adminEmails[0] === verifiedEmail);
          STATE.currentDispatcherId = null;
          STATE.viewAs = null;
          STATE.currentUser = { name: (STATE.isSuperAdmin ? 'Super Admin' : (STATE.settings.companyName ? STATE.settings.companyName + ' Admin' : 'Admin')), email: STATE.settings.googleAccountEmail || verifiedEmail, initials: initials(verifiedEmail.split('@')[0]) };
          enterApp();
          return true;
        }
      } catch (e) {
        console.error('[Auth] Session verification error:', e);
      }

      try { localStorage.removeItem('haulbox_web_session_token'); } catch (e) { }
      if (typeof SessionManager !== 'undefined') SessionManager.clearSession();
      return false;
    }

    async function mockGoogleLogin() {
      // Load state first (without it we can't check who's registered)
      if (!STATE._loaded) { await loadState(); STATE._loaded = true; }
      const params = new URLSearchParams(window.location.search);
      const shareToken = params.get('share');
      if (shareToken) {
        const share = (STATE.settings.shares || []).find(x => x.token === shareToken);
        if (!share) { toast('Link not recognized', 'This share link is invalid.'); return; }
        if (!share.active) {
          document.getElementById('login-gate').innerHTML = '<div class="login-card"><h1 class="font-display">ACCESS REVOKED</h1><p>This view-only link has been turned off by the admin. Ask them to share a new link.</p></div>';
          return;
        }
        document.getElementById('login-gate').style.display = 'none';
        STATE.currentUser = { name: share.name, email: 'view-only link', initials: initials(share.name) };
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-name').textContent = STATE.currentUser.name;
        document.getElementById('user-email').textContent = STATE.currentUser.email;
        document.getElementById('user-avatar').textContent = STATE.currentUser.initials;
        init();
        return;
      }
      if (params.get('view') === 'readonly') {
        document.getElementById('login-gate').style.display = 'none';
        STATE.currentUser = { name: 'Guest Viewer', email: 'view-only link', initials: 'VW' };
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-name').textContent = STATE.currentUser.name;
        document.getElementById('user-email').textContent = STATE.currentUser.email;
        document.getElementById('user-avatar').textContent = STATE.currentUser.initials;
        init();
        return;
      }
      googleSignIn();
    }
    // Runs the real OAuth popup under a throwaway id (we don't know who's signing in
    // until Google tells us), then matches the returned email against Admin/dispatchers.
    async function googleSignIn() {
      const btn = document.getElementById('google-signin-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
      showLoginStatus('Opening Google sign-in…');
      const loginAttemptId = 'login_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      let result;
      try {
        result = await openGoogleOAuthPopup(loginAttemptId);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        if (e.message === 'CLOSED') { showLoginStatus(''); return; }
        if (e.message === 'POPUP_BLOCKED') { showLoginStatus('Popup blocked — allow popups for this site, then try again.', true); return; }
        showLoginStatus('Sign-in failed: ' + e.message, true);
        return;
      }
      const email = (result.email || '').trim().toLowerCase();
      const sessionToken = result.sessionToken || '';
      if (!sessionToken) {
        showLoginStatus('Sign-in failed: Server did not issue a valid session token.', true);
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        return;
      }

      showLoginStatus('Checking access for ' + result.email + '…');

      const adminEmails = await loadAdminEmailConfig();
      const matchedDispatcher = STATE.dispatchers.find(d => (d.email || '').trim().toLowerCase() === email);

      if (matchedDispatcher) {
        try {
          await backendFetch('/auth/claim', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + sessionToken
            },
            body: JSON.stringify({ fromAccountId: loginAttemptId, toAccountId: matchedDispatcher.id })
          });
        } catch (e) { }
        STATE.role = 'dispatcher';
        STATE.isSuperAdmin = false;
        STATE.currentDispatcherId = matchedDispatcher.id;
        STATE.viewAs = null;
        matchedDispatcher.gmailConnected = true;
        matchedDispatcher.driveConnected = true;
        matchedDispatcher.gmailEnabled = true;
        matchedDispatcher.googleAccountEmail = result.email;
        matchedDispatcher.gmailConnectionStatus = 'Connected';
        matchedDispatcher.gmailLastSync = new Date().toISOString();
        STATE.currentUser = { name: matchedDispatcher.name, email: result.email, initials: initials(matchedDispatcher.name) };
        try { localStorage.setItem('haulbox_web_session_token', sessionToken); } catch (e) { }
        persist();
        enterApp();
        return;
      }

      if (adminEmails && adminEmails.includes(email)) {
        try {
          await backendFetch('/auth/claim', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + sessionToken
            },
            body: JSON.stringify({ fromAccountId: loginAttemptId, toAccountId: 'admin' })
          });
        } catch (e) { }
        STATE.role = 'admin';
        STATE.isSuperAdmin = (email === SUPER_ADMIN_EMAIL_REQUIRED) || (adminEmails[0] === email);
        STATE.currentDispatcherId = null;
        STATE.viewAs = null;
        STATE.settings.googleAccountEmail = result.email;
        STATE.settings.gmailConnected = true;
        STATE.settings.driveConnected = true;
        STATE.settings.gmailEnabled = true;
        STATE.settings.gmailConnectionStatus = 'Connected';
        STATE.settings.gmailLastSync = new Date().toISOString();
        STATE.currentUser = { name: (STATE.isSuperAdmin ? 'Super Admin' : (STATE.settings.companyName ? STATE.settings.companyName + ' Admin' : 'Admin')), email: result.email, initials: initials(result.email.split('@')[0]) };
        try { localStorage.setItem('haulbox_web_session_token', sessionToken); } catch (e) { }
        persist();
        enterApp();
        return;
      }

      // No match — reject. Clean up the orphaned tokens rather than leaving them on the
      // server for an account nobody's allowed to use.
      backendFetch('/auth/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: loginAttemptId }) }).catch(() => { });
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      document.getElementById('login-gate').innerHTML =
        '<div class="login-card">' +
        '<div class="login-mark" style="background:var(--red-soft);"><svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg></div>' +
        '<h1 class="font-display">ACCESS RESTRICTED</h1>' +
        '<p><b>' + result.email + '</b> is not authorized. Sign in with your registered account.</p>' +
        '<button class="btn btn-primary" onclick="window.location.reload()">Back to Sign In</button>' +
        '</div>';
    }
    // Small status line shown under the Sign in button while the popup/matching is in flight.
    function showLoginStatus(msg, isError) {
      const el = document.getElementById('login-status');
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = isError ? 'var(--red)' : 'var(--text-faint)';
    }


    function enterApp() {
      document.getElementById('login-gate').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      document.getElementById('user-name').textContent = STATE.currentUser.name;
      document.getElementById('user-email').textContent = STATE.currentUser.email;
      document.getElementById('user-avatar').textContent = STATE.currentUser.initials;
      applyRoleUI();
      renderNotifications();
      init();
    }

    function init() {
      let savedView = 'dashboard';
      const uiState = (typeof SessionManager !== 'undefined') ? SessionManager.loadUiState() : {};
      try { savedView = uiState.activeView || localStorage.getItem('haulbox_active_view') || 'dashboard'; } catch (e) { }
      if (savedView === 'settings' && !IS_SETTINGS_PIN_UNLOCKED) {
        savedView = 'dashboard';
      }
      switchView(savedView);

      // Restore active modal state if refreshing while viewing a load
      if (uiState.activeModalId === 'modal-load' && uiState.modalContextId) {
        setTimeout(() => {
          if (typeof openLoadModal === 'function') openLoadModal(uiState.modalContextId);
        }, 200);
      }
    }

    // role/currentUser/currentDispatcherId are session-only (persist() never saves them —
    // see its payload above); SESSION_KEY in localStorage is what lets a refresh skip
    // the login screen (see restoreSession()), so signing out has to clear that too or
    // reloading would just log the same person straight back in.
    function signOut() {
      if (typeof SessionManager !== 'undefined') {
        SessionManager.clearSession();
      } else {
        try {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem('haulbox_active_view');
        } catch (e) { }
      }
      window.location.reload();
    }
    function toggleUserMenu() { toast('Signed in', STATE.currentUser ? STATE.currentUser.email : ''); }

    /* ---------------- Theme ---------------- */
    function setTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      const darkBtn = document.getElementById('theme-dark-btn');
      const lightBtn = document.getElementById('theme-light-btn');
      if (darkBtn) darkBtn.classList.toggle('active', t === 'dark');
      if (lightBtn) lightBtn.classList.toggle('active', t === 'light');
      try { localStorage.setItem('haulline-theme-pref', t); } catch (e) { }
      Object.values(CHARTS).forEach(c => c && c.update());
    }

    /* ---------------- Navigation ---------------- */
    const VIEW_TITLES = { dashboard: 'Dashboard', addload: 'Add Load', loadboard: 'Load Board', drivers: 'Drivers', driverpay: 'Driver Pay', brokers: 'Brokers', dispatchers: 'Dispatchers', statistics: 'Statistics', documents: 'Documents', emaillogs: 'Email Logs', myaccount: 'My Account', settings: 'Settings', chat: '💬 Chat' };
    
    // Security PIN session flag for Admin Settings
    let IS_SETTINGS_PIN_UNLOCKED = false;
    let PENDING_SETTINGS_SWITCH = false;

    function openSettingsWithPin() {
      if (IS_SETTINGS_PIN_UNLOCKED) {
        doSwitchView('settings');
        return;
      }
      PENDING_SETTINGS_SWITCH = true;
      const pinInput = document.getElementById('settings-pin-input');
      const errEl = document.getElementById('settings-pin-error');
      if (pinInput) { pinInput.value = ''; }
      if (errEl) { errEl.textContent = ''; }
      openModal('modal-settings-pin');
      setTimeout(() => { if (pinInput) pinInput.focus(); }, 150);
    }

    async function submitSettingsPin(e) {
      if (e) e.preventDefault();
      const pinInput = document.getElementById('settings-pin-input');
      const errEl = document.getElementById('settings-pin-error');
      const btn = document.getElementById('settings-pin-submit-btn');
      const pin = pinInput ? pinInput.value.trim() : '';

      if (!pin || pin.length < 6) {
        if (errEl) errEl.textContent = 'Please enter a full 6-digit PIN.';
        return false;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
      if (errEl) errEl.textContent = '';

      try {
        const resp = await fetch('/api/verify-settings-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await resp.json();

        if (resp.ok && data.ok) {
          IS_SETTINGS_PIN_UNLOCKED = true;
          closeModal('modal-settings-pin');
          toast('Settings Unlocked', 'Access granted to Admin Settings.', true);
          doSwitchView('settings');
        } else {
          if (errEl) errEl.textContent = data.error || 'Incorrect 6-digit PIN. Access denied.';
          if (pinInput) { pinInput.select(); pinInput.focus(); }
        }
      } catch (err) {
        if (errEl) errEl.textContent = 'Failed to verify PIN. Please try again.';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
      }
      return false;
    }

    function cancelSettingsPin() {
      PENDING_SETTINGS_SWITCH = false;
      closeModal('modal-settings-pin');
      // Revert sidebar active highlight to current view if settings was cancelled
      const activeView = localStorage.getItem('haulbox_active_view') || 'dashboard';
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === activeView));
    }

    function switchView(view) {
      if (view === 'settings') {
        if (STATE.role !== 'admin') { switchView('dashboard'); return; }
        if (!IS_SETTINGS_PIN_UNLOCKED) {
          openSettingsWithPin();
          return;
        }
      }
      doSwitchView(view);
    }

    function doSwitchView(view) {
      // Whenever leaving Settings, immediately lock Settings so re-entering always requires the 6-digit PIN
      if (view !== 'settings') {
        IS_SETTINGS_PIN_UNLOCKED = false;
      }

      if (view === 'dispatchers' && STATE.role !== 'admin') { view = 'dashboard'; }
      if (view === 'driverpay' && STATE.role !== 'admin') { view = 'dashboard'; }
      if (view === 'myaccount' && STATE.role === 'viewonly') { view = 'dashboard'; }
      if (view === 'chat' && STATE.role === 'viewonly') { view = 'dashboard'; }

      let targetViewEl = document.getElementById('view-' + view);
      if (!targetViewEl) { view = 'dashboard'; targetViewEl = document.getElementById('view-dashboard'); }

      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      if (targetViewEl) targetViewEl.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
      if (VIEW_TITLES[view]) document.getElementById('pagetitle').textContent = VIEW_TITLES[view];

      try {
        localStorage.setItem('haulbox_active_view', view);
        if (typeof SessionManager !== 'undefined') {
          SessionManager.saveUiState({ activeView: view });
        }
      } catch (e) { }
      if (typeof rotateActiveDiceToView === 'function') rotateActiveDiceToView(view);


      if (view === 'dashboard') renderDashboard();
      if (view === 'loadboard') { renderLoadBoardTabs(); renderLoadBoard(); }
      if (view === 'drivers') renderDrivers();
      if (view === 'driverpay') renderDriverPay();
      if (view === 'brokers') renderBrokers();
      if (view === 'dispatchers') renderDispatchersPage();
      if (view === 'statistics') renderStatistics();
      if (view === 'documents') renderDocsList();
      if (view === 'emaillogs') renderEmailLogs();
      if (view === 'myaccount') renderMyAccount();
      if (view === 'settings') renderSettings();
      if (view === 'chat') { if (typeof initWaChat === 'function') initWaChat(); else loadMainChat(); }
      if (view === 'addload') showLoadStep(1);
      if (view === 'docreview') { setDocReviewTab(_docReviewTab || 'pending'); }
    }
    document.getElementById('mainnav').addEventListener('click', e => {
      const item = e.target.closest('.nav-item');
      if (item) switchView(item.dataset.view);
    });

    /* ---------------- Toast ---------------- */
    function toast(title, sub, success) {
      const wrap = document.getElementById('toast-wrap');
      const el = document.createElement('div');
      el.className = 'toast' + (success ? ' success' : '');
      el.innerHTML = '<b>' + title + '</b>' + (sub ? '<div style="color:var(--text-faint)">' + sub + '</div>' : '');
      wrap.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
    }
    // Simple format check used before ever handing an address to the Gmail API — catches typos
    // (missing @, stray spaces, no domain) with a clear, specific toast instead of letting Gmail
    // reject it with a raw, confusing API error.
    function isValidEmailAddress(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
    }

    /* ---------------- Google Sheets live sync ----------------
       Optional: if a Sheet URL is set in Settings, every load booked — and every
       status change after — writes/updates a row in that Sheet, keyed by Load #.
       Requires the connected Google account (My Account) to have Editor access
       on the Sheet — share it with that exact address first. */
    function extractSheetId(url) {
      const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (m) return m[1];
      const bare = String(url || '').trim();
      return /^[a-zA-Z0-9-_]{20,}$/.test(bare) ? bare : ''; // allow pasting just the ID
    }
    // Column order: Date | Load Number | Broker | MC # | Driver Name | Pickup | Drop-off | PU Date | DO Date | Broker Rate | Dispatcher Name
    // Load Number is column B (index 1) — that's the unique key used for matching an existing
    // row, NOT column A (Date), since multiple loads booked the same day would collide on that.
    const SHEET_KEY_COLUMN = 'B';
    const SHEET_KEY_INDEX = 1;
    // Dates are stored internally as YYYY-MM-DD (HTML date input format) — this converts to
    // MM-DD-YYYY for the Sheet, since that's the format requested for that column.
    function toMMDDYYYY(dateStr) {
      if (!dateStr) return '';
      const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[2] + '-' + m[3] + '-' + m[1];
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr; // unparseable — leave as-is rather than blank it out
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return mm + '-' + dd + '-' + d.getFullYear();
    }
    // Strips any "MC"/"MC-" prefix (however it was typed on the Broker record) down to just the digits.
    function mcDigitsOnly(mc) {
      return String(mc || '').replace(/[^0-9]/g, '');
    }
    function buildSheetRow(load, isDispatcher = false) {
      const row = [
        toMMDDYYYY(load.systemDate),
        load.loadNumber || '',
        load.brokerName || '',
        mcDigitsOnly(load.brokerMC),
        load.driverName || '',
        formatCityStateZip(load.pickup) || load.pickup || '',
        formatCityStateZip(load.dropoff) || load.dropoff || '',
        toMMDDYYYY(load.pickupDate),
        toMMDDYYYY(load.deliveryDate),
        load.brokerRate != null ? money(load.brokerRate) : '',
      ];
      // Dispatcher Name is appended on Admin Master Sheet, omitted on Dispatcher's personal sheet
      if (!isDispatcher) {
        row.push(load.dispatcherName || '');
      }
      return row;
    }
    // Writes one row to a given Sheet using a given account's Google connection (accountId
    // picks whose stored OAuth tokens the backend signs the request with).
    async function writeLoadRowToSheet(load, accountId, spreadsheetId, sheetName) {
      const isDispatcher = (accountId !== 'admin' && STATE.role === 'dispatcher');
      return backendFetch('/api/sheet-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, spreadsheetId, sheetName: sheetName || 'Sheet1', row: buildSheetRow(load, isDispatcher) })
      });
    }

    async function syncToWebhook(load, webhookUrl) {
      const isDispatcher = (STATE.role === 'dispatcher');
      const rowData = buildSheetRow(load, isDispatcher);
      const payload = {
        date: rowData[0],
        loadNumber: rowData[1],
        broker: rowData[2],
        mc: rowData[3],
        driver: rowData[4],
        pickup: rowData[5],
        dropoff: rowData[6],
        puDate: rowData[7],
        doDate: rowData[8],
        rate: rowData[9],
        ...(isDispatcher ? {} : { dispatcher: rowData[10] || '' }),
        row: rowData,
      };
      return backendFetch('/api/webhook-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl, loadData: payload })
      });
    }

    async function syncLoadToSheet(load) {
      const holder = myGoogleAccountHolder();
      const rawUrl = (holder && holder.sheetUrl) ? holder.sheetUrl : (STATE.settings ? STATE.settings.sheetUrl : '');
      const webhookUrl = (holder && holder.sheetWebhookUrl) ? holder.sheetWebhookUrl : (STATE.settings ? STATE.settings.sheetWebhookUrl : '');

      if (webhookUrl) {
        try { await syncToWebhook(load, webhookUrl); } catch (e) { console.error('Webhook sync failed', e); }
      }
      const spreadsheetId = extractSheetId(rawUrl);
      if (spreadsheetId) {
        try {
          const tabName = (holder && holder.sheetTabName) || (STATE.settings && STATE.settings.sheetTabName) || 'Sheet1';
          await writeLoadRowToSheet(load, currentAccountId() || 'admin', spreadsheetId, tabName);
        } catch (e) {
          console.error('Sheet sync failed', e);
        }
      }
    }

    async function testSheetSync() {
      const statusEl = document.getElementById('my-sheet-status');
      const holder = myGoogleAccountHolder();
      const rawUrl = (holder && holder.sheetUrl) ? holder.sheetUrl : (STATE.settings ? STATE.settings.sheetUrl : '');
      const webhookUrl = (holder && holder.sheetWebhookUrl) ? holder.sheetWebhookUrl : (STATE.settings ? STATE.settings.sheetWebhookUrl : '');
      const spreadsheetId = extractSheetId(rawUrl);

      if (!spreadsheetId && !webhookUrl) {
        if (statusEl) statusEl.textContent = 'Paste a valid Google Sheet link or Webhook URL above first.';
        return;
      }

      const accountId = currentAccountId() || 'admin';
      if (statusEl) statusEl.textContent = 'Testing…';
      const testLoad = STATE.loads[0] || { systemDate: new Date().toISOString().slice(0, 10), loadNumber: 'TEST-' + Date.now(), brokerName: 'Test Broker', brokerMC: '000000', driverName: 'Test Driver', pickup: 'Test Pickup, TX', dropoff: 'Test Dropoff, IL', pickupDate: '', deliveryDate: '', brokerRate: 0, dispatcherName: STATE.currentUser ? STATE.currentUser.name : 'Test Dispatcher' };
      try {
        let msg = '';
        if (webhookUrl) {
          await syncToWebhook(testLoad, webhookUrl);
          msg = '✓ Webhook synced successfully.';
        }
        if (spreadsheetId) {
          const tabName = (holder && holder.sheetTabName) || (STATE.settings && STATE.settings.sheetTabName) || 'Sheet1';
          const res = await writeLoadRowToSheet(testLoad, accountId, spreadsheetId, tabName);
          msg += (msg ? ' · ' : '') + '✓ Sheet API synced successfully' + (res.sheetTab ? ' (tab: ' + res.sheetTab + ')' : '') + '.';
        }
        if (statusEl) statusEl.textContent = msg + ' Check your Sheet.';
        toast('Sheet sync test passed', 'Test row sent successfully.', true);
      } catch (e) {
        if (statusEl) statusEl.textContent = '✗ ' + (e.message || 'Sync failed');
        toast('Sheet sync test failed', e.message || 'Check the Sheet link and sharing permissions.');
      }
    }

    function pushNotification(title, sub, meta = {}) {
      STATE.notifications = STATE.notifications || [];
      STATE.notifications.unshift({
        id: uid('notif'),
        title: title || '',
        sub: sub || '',
        at: new Date().toISOString(),
        read: false,
        meta: meta // { type: 'load'|'chat'|'doc'|'payment'|'driver', targetId: '...' }
      });
      if (STATE.notifications.length > 50) STATE.notifications.length = 50;
      persist();
      renderNotifications();
    }

    function onNotificationClicked(notifId) {
      const n = (STATE.notifications || []).find(x => x.id === notifId);
      if (!n) return;
      n.read = true;
      persist();
      renderNotifications();
      
      const panel = document.getElementById('notif-panel');
      if (panel) panel.style.display = 'none';

      // 1. Explicit meta target
      if (n.meta && n.meta.type) {
        if (n.meta.type === 'load' && n.meta.targetId) return openLoadModal(n.meta.targetId);
        if (n.meta.type === 'chat') { switchView('chat'); return; }
        if (n.meta.type === 'driver') { switchView('drivers'); return; }
        if (n.meta.type === 'payment') { switchView('driverpay'); return; }
        if (n.meta.type === 'doc') { switchView('documents'); return; }
      }

      // 2. Intelligent content detection
      const combined = (n.title + ' ' + (n.sub || '')).toLowerCase();
      
      // Match load numbers e.g. "HL-10420" or "Load #12345" or "#10421" or "10422"
      const loadMatch = (n.title + ' ' + (n.sub || '')).match(/(?:HL-\d+|Load\s*#?\s*(\d+)|#(\d{4,}))/i);
      if (loadMatch) {
        const rawNum = loadMatch[1] || loadMatch[2] || loadMatch[0];
        const numClean = rawNum.replace(/[^0-9]/g, '');
        const matchedLoad = (STATE.loads || []).find(l => (l.loadNumber && l.loadNumber.includes(numClean)) || l.id === rawNum);
        if (matchedLoad) return openLoadModal(matchedLoad.id);
      }

      if (combined.includes('chat') || combined.includes('message')) return switchView('chat');
      if (combined.includes('payment') || combined.includes('settlement') || combined.includes('paid')) return switchView('driverpay');
      if (combined.includes('pod') || combined.includes('bol') || combined.includes('document') || combined.includes('expiring')) return switchView('documents');
      if (combined.includes('driver')) return switchView('drivers');
      if (combined.includes('load') || combined.includes('booked') || combined.includes('dispatch')) return switchView('loadboard');
    }

    function timeAgoShort(iso) {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      return days + 'd ago';
    }

    function renderNotifications() {
      const list = STATE.notifications || [];
      const unread = list.filter(n => !n.read).length;
      const badge = document.getElementById('notif-badge');
      if (badge) { badge.style.display = unread > 0 ? 'flex' : 'none'; badge.textContent = unread > 9 ? '9+' : String(unread); }
      const body = document.getElementById('notif-panel-list');
      if (body) {
        body.innerHTML = list.length ? list.map(n =>
          `<div onclick="onNotificationClicked('${n.id}')" style="padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s ease;${n.read ? '' : 'background:rgba(37,99,235,0.06);'}" onmouseenter="this.style.background='var(--panel-hover, rgba(0,0,0,0.04))'" onmouseleave="this.style.background='${n.read ? 'transparent' : 'rgba(37,99,235,0.06)'}'">` +
          `<div style="display:flex;justify-content:space-between;align-items:flex-start;">` +
          `<div style="font-weight:700;font-size:12.5px;color:var(--text);">${escapeAttr(n.title)}</div>` +
          `${n.read ? '' : '<span style="width:7px;height:7px;border-radius:50%;background:#2563eb;margin-top:4px;flex-shrink:0;"></span>'}` +
          `</div>` +
          (n.sub ? `<div style="font-size:11.5px;color:var(--text-dim);margin-top:2px;">${escapeAttr(n.sub)}</div>` : '') +
          `<div style="font-size:10.5px;color:var(--text-faint);margin-top:5px;display:flex;justify-content:space-between;align-items:center;">` +
          `<span>${timeAgoShort(n.at)}</span>` +
          `<span style="color:#2563eb;font-weight:600;font-size:11px;">Open →</span>` +
          `</div>` +
          `</div>`
        ).join('') : '<div style="padding:24px 14px;text-align:center;color:var(--text-faint);font-size:12px;">No notifications yet</div>';
      }
    }
    function toggleNotifications() {
      const panel = document.getElementById('notif-panel');
      if (!panel) return;
      const willOpen = panel.style.display !== 'block';
      panel.style.display = willOpen ? 'block' : 'none';
      if (willOpen) {
        renderNotifications();
        setTimeout(() => { (STATE.notifications || []).forEach(n => n.read = true); persist(); renderNotifications(); }, 1200);
      }
    }
    function clearNotifications() {
      STATE.notifications = [];
      persist();
      renderNotifications();
    }
    document.addEventListener('click', function (e) {
      const panel = document.getElementById('notif-panel');
      const btn = document.getElementById('notif-bell-btn');
      if (!panel || panel.style.display !== 'block') return;
      if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
      panel.style.display = 'none';
    });

    /* ---------------- Helpers ---------------- */
    function money(n) { return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function placard(status) {
      const meta = STATUS_META[status] || { color: 'gray', label: status };
      return '<span class="placard pl-' + meta.color + '"><span class="dot"></span>' + meta.label + '</span>';
    }
    const US_STATE_NAMES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', newhampshire: 'NH', newjersey: 'NJ', newmexico: 'NM', newyork: 'NY', northcarolina: 'NC', northdakota: 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', rhodeisland: 'RI', southcarolina: 'SC', southdakota: 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', westvirginia: 'WV', wisconsin: 'WI', wyoming: 'WY', districtofcolumbia: 'DC' };
    // Always resolves to exactly 2 letters — checks "City, ST" / "City, ST 12345" first,
    // then falls back to matching a spelled-out state name anywhere in the string.
    function stateAbbrev(loc) {
      const s = (loc || '').trim();
      const m = s.match(/,\s*([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
      if (m) return m[1].toUpperCase();
      const key = s.toLowerCase().replace(/[^a-z]/g, '');
      for (const name in US_STATE_NAMES) { if (key.indexOf(name) !== -1) return US_STATE_NAMES[name]; }
      return 'XX';
    }
    // Strips characters that aren't safe in a downloaded filename on Windows/Mac/Linux.
    function sanitizeFilename(name) { return (name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); }

    /**
     * Extracts clean "City, ST Zip" or "City, ST" from a full address or location string
     * e.g., "123 Main St, Houston, TX 77001" -> "Houston, TX 77001"
     * e.g., "Dallas, TX 75001" -> "Dallas, TX 75001"
     * e.g., "Chicago, IL" -> "Chicago, IL"
     */
    function formatCityStateZip(loc) {
      if (!loc) return '';
      const s = String(loc).trim();
      if (!s) return '';

      // Check if address matches "..., City, ST 12345" or "City, ST 12345"
      const mZip = s.match(/(?:^|,\s*)([A-Za-z\s.]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
      if (mZip && mZip[1] && mZip[2] && mZip[3]) {
        const city = mZip[1].replace(/^.*[,\n\r]+/, '').trim();
        const st = mZip[2].toUpperCase();
        const zip = mZip[3].trim();
        if (city && st) return city + ', ' + st + ' ' + zip;
      }

      // Check if address matches "..., City, ST" or "City, ST"
      const m = s.match(/(?:^|,\s*)([A-Za-z\s.]+),\s*([A-Za-z]{2})\s*$/);
      if (m && m[1] && m[2]) {
        const city = m[1].replace(/^.*[,\n\r]+/, '').trim();
        const st = m[2].toUpperCase();
        if (city && st) return city + ', ' + st;
      }

      // Fallback: try splitting by comma
      const parts = s.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const stMatch = lastPart.match(/([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?/);
        if (stMatch) {
          const state = stMatch[1].toUpperCase();
          const zip = stMatch[2] ? ' ' + stMatch[2] : '';
          const city = parts[parts.length - 2].replace(/^.*[,\n\r]+/, '').trim();
          if (city && state && state !== 'XX') return city + ', ' + state + zip;
        }
      }

      const stAbbr = stateAbbrev(s);
      if (stAbbr && stAbbr !== 'XX' && parts.length > 0) {
        return parts[0] + ', ' + stAbbr;
      }
      return s;
    }

    /**
     * Extracts clean "City, ST" from a full address string
     */
    function formatCityState(loc) {
      const csz = formatCityStateZip(loc);
      return csz.replace(/\s+\d{5}(?:-\d{4})?$/, '');
    }

    /**
     * Formats a clean "Pickup City, ST Zip → Dropoff City, ST Zip" lane for load board and summary widgets
     */
    function formatCityStateLane(pickup, dropoff) {
      const pu = formatCityStateZip(pickup);
      const doo = formatCityStateZip(dropoff);
      if (pu && doo) return pu + ' → ' + doo;
      return pu || doo || '—';
    }
    function fmtDate(s) { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); if (isNaN(d)) return s; return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }); }
    function within(dateStr, range, fromDate, toDate) {
      if (range === 'all' || !dateStr) return true;
      const d = new Date(dateStr + 'T00:00:00'); const now = new Date();
      if (range === 'week') { const wk = new Date(now); wk.setDate(now.getDate() - 7); return d >= wk; }
      if (range === 'month') { return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }
      if (range === 'year') { return d.getFullYear() === now.getFullYear(); }
      if (range === 'custom') {
        if (fromDate && d < new Date(fromDate + 'T00:00:00')) return false;
        if (toDate && d > new Date(toDate + 'T23:59:59')) return false;
        return true;
      }
      return true;
    }

    function placard(status, l) {
      const st = l ? (l.driverProgress || l.status || status) : status;
      if (st === 'Booked' || st === 'Pending RC' || st === 'ACCEPTED' || st === 'Accepted') {
        return '<span class="placard pl-white" style="font-weight:700;"><span class="dot"></span>Booked / Accepted</span>';
      }
      if (st === 'AT_PICKUP' || st === 'At Pickup' || st === 'Loaded') {
        const timeText = (l && l.pickupTime) ? `ETA ${l.pickupTime} / PU` : 'ETA 11AM / PU';
        return `<span class="placard pl-yellow" style="font-weight:700;"><span class="dot"></span>${timeText}</span>`;
      }
      if (st === 'IN_TRANSIT' || st === 'In Transit' || st === 'AT_DELIVERY' || st === 'At Delivery' || st === 'Drop-off') {
        const timeText = (l && l.deliveryTime) ? `ETA ${l.deliveryTime} / Drop-off` : 'ETA 2PM (Mon) / Drop-off';
        return `<span class="placard pl-green" style="font-weight:700;"><span class="dot"></span>${timeText}</span>`;
      }
      if (st === 'DELIVERED' || st === 'Delivered' || st === 'POD Uploaded') {
        return '<span class="placard pl-green" style="font-weight:700;"><span class="dot"></span>Delivered</span>';
      }

      const meta = STATUS_META[st] || STATUS_META[status] || { color: 'gray', label: status };
      return '<span class="placard pl-' + meta.color + '"><span class="dot"></span>' + meta.label + '</span>';
    }

    /* ================= DASHBOARD ================= */
    function getHidePref(key) { try { return localStorage.getItem('haulline-hide-' + key) === '1'; } catch (e) { return false; } }
    function setHidePref(key, val) { try { localStorage.setItem('haulline-hide-' + key, val ? '1' : '0'); } catch (e) { } }
    function toggleFinancial(key) { setHidePref(key, !getHidePref(key)); renderDashboard(); }
    function eyeIcon(hidden) {
      return hidden
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 20c-5.5 0-9.5-4-11-8 .7-2 2-3.9 3.6-5.4M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9.5 4 11 8-.5 1.4-1.3 2.8-2.3 4M3 3l18 18"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    let trackingMap = null;
    let trackingMarkers = [];
    let trackingPolyline = null;

    const TRACKING_DATA = {
      'driver-1': {
        driver: 'John Smith',
        loadNum: 'Load #12345',
        loadId: '12345',
        stage: 'IN TRANSIT',
        lane: 'Dallas, TX → Indianapolis, IN',
        miles: '245 mi',
        eta: 'Today 4:35 PM',
        lastUpdate: '2 mins ago',
        speed: '62 mph',
        statusHtml: '🟢 On Time',
        pickup: { name: 'Dallas, TX', lat: 32.7767, lng: -96.7970 },
        delivery: { name: 'Indianapolis, IN', lat: 39.7684, lng: -86.1581 },
        current: { lat: 35.4676, lng: -97.5164 }
      },
      'driver-2': {
        driver: 'Mike Johnson',
        loadNum: 'Load #12346',
        loadId: '12346',
        stage: 'AT PICKUP',
        lane: 'Atlanta, GA → Chicago, IL',
        miles: '115 mi',
        eta: 'Tomorrow 9:15 AM',
        lastUpdate: '5 mins ago',
        speed: '0 mph',
        statusHtml: '🟡 Running Late',
        pickup: { name: 'Atlanta, GA', lat: 33.7490, lng: -84.3880 },
        delivery: { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
        current: { lat: 33.7490, lng: -84.3880 }
      },
      'driver-3': {
        driver: 'Alex Williams',
        loadNum: 'Load #12347',
        loadId: '12347',
        stage: 'LOADED',
        lane: 'Houston, TX → Memphis, TN',
        miles: '363 mi',
        eta: 'Today 12:40 PM',
        lastUpdate: '1 min ago',
        speed: '68 mph',
        statusHtml: '🟢 On Time',
        pickup: { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
        delivery: { name: 'Memphis, TN', lat: 35.1495, lng: -90.0490 },
        current: { lat: 32.5252, lng: -93.7502 }
      },
      'driver-4': {
        driver: 'Tom Brown',
        loadNum: 'Load #12348',
        loadId: '12348',
        stage: 'IN TRANSIT',
        lane: 'Phoenix, AZ → Los Angeles, CA',
        miles: '372 mi',
        eta: 'Today 2:00 PM',
        lastUpdate: '8 mins ago',
        speed: '59 mph',
        statusHtml: '🟡 Running Late',
        pickup: { name: 'Phoenix, AZ', lat: 33.4484, lng: -112.0740 },
        delivery: { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
        current: { lat: 33.6054, lng: -114.5964 }
      }
    };

    function onTrackingDriverChanged(driverKey) {
      const data = TRACKING_DATA[driverKey] || TRACKING_DATA['driver-1'];
      const drvEl = document.getElementById('trk-card-driver');
      if (drvEl) drvEl.textContent = data.driver;
      const stageEl = document.getElementById('trk-card-stage-badge');
      if (stageEl) stageEl.textContent = data.stage;
      const loadEl = document.getElementById('trk-card-loadnum');
      if (loadEl) loadEl.textContent = data.loadNum;
      const laneEl = document.getElementById('trk-card-lane');
      if (laneEl) laneEl.textContent = data.lane;
      const miEl = document.getElementById('trk-card-miles');
      if (miEl) miEl.textContent = data.miles;
      const etaEl = document.getElementById('trk-card-eta');
      if (etaEl) etaEl.textContent = data.eta;
      const upEl = document.getElementById('trk-card-lastupdate');
      if (upEl) upEl.textContent = data.lastUpdate;
      const spEl = document.getElementById('trk-card-speed');
      if (spEl) spEl.textContent = data.speed;
      const stEl = document.getElementById('trk-card-status');
      if (stEl) stEl.innerHTML = data.statusHtml;

      updateTrackingMap(data);
    }

    function updateTrackingMap(data) {
      if (!window.L) return;
      const container = document.getElementById('tracking-map-container');
      if (!container) return;

      if (!trackingMap) {
        trackingMap = L.map('tracking-map-container').setView([data.current.lat, data.current.lng], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap'
        }).addTo(trackingMap);
      }

      trackingMarkers.forEach(m => trackingMap.removeLayer(m));
      trackingMarkers = [];
      if (trackingPolyline) { trackingMap.removeLayer(trackingPolyline); }

      const puMarker = L.circleMarker([data.pickup.lat, data.pickup.lng], {
        radius: 8, fillColor: '#16a34a', color: '#ffffff', weight: 2, fillOpacity: 1
      }).addTo(trackingMap).bindPopup(`<b>Pickup:</b> ${data.pickup.name}`);
      trackingMarkers.push(puMarker);

      const doMarker = L.circleMarker([data.delivery.lat, data.delivery.lng], {
        radius: 8, fillColor: '#ef4444', color: '#ffffff', weight: 2, fillOpacity: 1
      }).addTo(trackingMap).bindPopup(`<b>Delivery:</b> ${data.delivery.name}`);
      trackingMarkers.push(doMarker);

      const drvMarker = L.circleMarker([data.current.lat, data.current.lng], {
        radius: 10, fillColor: '#2563eb', color: '#ffffff', weight: 3, fillOpacity: 1
      }).addTo(trackingMap).bindPopup(`<b>Driver:</b> ${data.driver}<br>${data.speed}`);
      trackingMarkers.push(drvMarker);

      const points = [
        [data.pickup.lat, data.pickup.lng],
        [data.current.lat, data.current.lng],
        [data.delivery.lat, data.delivery.lng]
      ];
      trackingPolyline = L.polyline(points, { color: '#2563eb', weight: 4, dashArray: '6, 6' }).addTo(trackingMap);

      const group = L.featureGroup(trackingMarkers);
      trackingMap.fitBounds(group.getBounds().pad(0.2));
    }

    function openSelectedDriverLoadDetails() {
      const select = document.getElementById('tracking-driver-select');
      const key = select ? select.value : 'driver-1';
      const data = TRACKING_DATA[key] || TRACKING_DATA['driver-1'];
      if (!data) return;

      // 1. Try to find exact load in STATE.loads
      let load = (STATE.loads || []).find(l => String(l.id) === String(data.loadId) || (l.loadNumber && l.loadNumber.includes(String(data.loadId))));
      
      // 2. If not found in seed loads, create a live linked record so details are 100% full & coherent
      if (!load) {
        const dsp = (STATE.dispatchers && STATE.dispatchers[0]) || { id: 'disp_1', name: 'John Dispatcher' };
        load = {
          id: data.loadId,
          loadNumber: (data.loadNum || 'HL-' + data.loadId).replace('Load #', '').trim(),
          systemDate: getTodayIsoString(),
          dispatcherId: dsp.id,
          dispatcherName: dsp.name,
          brokerId: 'broker_1',
          brokerName: 'C.H. Robinson Worldwide',
          brokerMC: 'MC-219401',
          brokerEmail: 'freight-ops@chrobinson.com',
          driverId: key,
          driverName: data.driver,
          truck: 'Truck #104',
          pickup: data.pickup ? data.pickup.name : 'Dallas, TX',
          dropoff: data.delivery ? data.delivery.name : 'Indianapolis, IN',
          pickupDate: getTodayIsoString(),
          deliveryDate: getTodayIsoString(),
          miles: parseInt(data.miles) || 540,
          brokerRate: 2450.00,
          ratePerMile: 4.54,
          feePct: 10,
          dispatchRevenue: 245.00,
          driverPayPct: 88,
          driverPay: 2156.00,
          driverDeduction: 0,
          driverPayNote: '',
          driverPaid: false,
          driverPaidDate: null,
          paymentStatus: 'UNPAID',
          driverProgress: data.stage || 'IN_TRANSIT',
          status: 'Booked',
          notes: 'Priority high-value logistics dispatch. Live GPS telemetry active.',
          docs: {
            RC: { name: `RC_${data.loadId}.pdf`, data: null },
            BOL: { name: `BOL_${data.loadId}.pdf`, data: null },
            POD: null,
            PhotosPU: [{ name: 'pickup_inspection_1.jpg', data: null }],
            PhotosDO: [],
            Extra: []
          }
        };
        STATE.loads.unshift(load);
        persist();
      }

      openLoadModal(load.id);
    }

    function openDriverTrackingModal() {
      switchView('dashboard');
      setTimeout(() => {
        const el = document.getElementById('tracking-driver-select');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }

    function triggerCountUpAnimations() {
      const els = document.querySelectorAll('.kpi-num[data-countup]');
      els.forEach(el => {
        const target = parseFloat(el.getAttribute('data-countup'));
        if (isNaN(target)) return;
        const prefix = el.getAttribute('data-prefix') || '';
        const suffix = el.getAttribute('data-suffix') || '';
        const duration = 1200; // 1.2s smooth duration
        const startTime = performance.now();

        function update(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // Ease out cubic
          const ease = 1 - Math.pow(1 - progress, 3);
          const current = Math.round(target * ease);
          el.textContent = prefix + (current >= 1000 ? current.toLocaleString() : current) + suffix;
          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            el.textContent = prefix + (target >= 1000 ? target.toLocaleString() : target) + suffix;
          }
        }
        requestAnimationFrame(update);
      });
    }

    /* =========================================================================
       LUXURY 3D HAULBOX NAVIGATION DICE (Genuine Extruded 3D Raised Geometry)
       6 Platform Module Faces:
       1: Truck (Loads / Freight / Dispatch -> loadboard)
       2: AI Brain / Core (HaulBoX AI -> dashboard)
       3: Documents Folder (Documents / BOL / POD -> documents)
       4: Driver Aviator (Driver Portal / Management -> drivers)
       5: Support Headset (Dispatch Support / Chat -> chat)
       6: Currency Dollar (Payments / Settlements -> driverpay)
       ========================================================================= */

    const CUBE_FACES = [
      { name: 'Loads', view: 'loadboard', rot: { x: 0, y: -Math.PI / 2, z: 0 } },        // +X Right
      { name: 'Drivers', view: 'drivers', rot: { x: 0, y: Math.PI / 2, z: 0 } },          // -X Left
      { name: 'Payments', view: 'driverpay', rot: { x: Math.PI / 2, y: 0, z: 0 } },        // +Y Top
      { name: 'Documents', view: 'documents', rot: { x: -Math.PI / 2, y: 0, z: 0 } },     // -Y Bottom
      { name: 'HaulBoX AI', view: 'dashboard', rot: { x: 0, y: 0, z: 0 } },               // +Z Front
      { name: 'Support', view: 'chat', rot: { x: 0, y: Math.PI, z: 0 } }                  // -Z Back
    ];

    let ACTIVE_DICE_INSTANCES = [];

    function createLuxuryDiceFaceTexture(iconType) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      // 1. Deep Obsidian Titanium Gradient Face Background
      const bgGrad = ctx.createRadialGradient(256, 256, 30, 256, 256, 340);
      bgGrad.addColorStop(0, '#13233f');
      bgGrad.addColorStop(0.65, '#0a1426');
      bgGrad.addColorStop(1, '#030712');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 512, 512);

      // 2. Thick Chamfer Rounded Inner Frame (Metallic Sapphire + Cyan Neon Inset)
      ctx.lineWidth = 22;
      ctx.strokeStyle = '#1e40af';
      ctx.strokeRoundRect ? ctx.strokeRoundRect(20, 20, 472, 472, 52) : ctx.strokeRect(20, 20, 472, 472);

      ctx.lineWidth = 10;
      ctx.strokeStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 28;
      ctx.strokeRoundRect ? ctx.strokeRoundRect(44, 44, 424, 424, 40) : ctx.strokeRect(44, 44, 424, 424);
      ctx.shadowBlur = 0;

      // 3. Draw Ultra-Bold High-Contrast Sculpted 3D Icons
      ctx.save();
      ctx.translate(256, 256);

      if (iconType === 'truck') {
        // Ultra-Bold Sculpted Pure White Semi-Truck (Front-Quarter View)
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,240,255,0.9)';
        ctx.shadowBlur = 24;

        // Aerodynamic High-Roof Cab Body
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-140, -110, 150, 160, 20) : ctx.rect(-140, -110, 150, 160);
        ctx.fill();

        // Dark Panoramic Windshield
        ctx.fillStyle = '#060d1a';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-125, -92, 120, 54, 10) : ctx.rect(-125, -92, 120, 54);
        ctx.fill();

        // Cargo Trailer Block
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,240,255,0.8)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(20, -125, 125, 175, 14) : ctx.rect(20, -125, 125, 175);
        ctx.fill();

        // Heavy-duty Dual Axle Wheels
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#020617';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 8;
        [[-75, 75], [55, 75], [115, 75]].forEach(([wx, wy]) => {
          ctx.beginPath();
          ctx.arc(wx, wy, 28, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Chrome Wheel Hub
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(wx, wy, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#020617';
        });

        // Laser Cyan Grille Bars
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(-120, -22, 110, 10);
        ctx.fillRect(-120, -4, 110, 10);
        ctx.fillRect(-120, 14, 110, 10);
      } else if (iconType === 'ai') {
        // Ultra-Bold Glowing AI Neural Brain Core
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 28;
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';

        // Outer Brain Structure
        ctx.beginPath();
        ctx.arc(-50, -35, 54, Math.PI * 0.7, Math.PI * 1.8);
        ctx.arc(0, -75, 46, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(50, -35, 54, Math.PI * 1.2, Math.PI * 2.3);
        ctx.arc(45, 40, 52, Math.PI * 1.7, Math.PI * 0.4);
        ctx.arc(0, 80, 42, Math.PI * 1.9, Math.PI * 1.1);
        ctx.arc(-45, 40, 52, Math.PI * 0.6, Math.PI * 1.3);
        ctx.closePath();
        ctx.stroke();

        // Central Processor
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-42, -42, 84, 84);

        ctx.font = '900 36px "Inter", sans-serif';
        ctx.fillStyle = '#030712';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('AI', 0, 2);

        // Neural Nodes
        [[-95, -20], [-80, 50], [95, -20], [80, 50], [0, -110], [0, 110]].forEach(([nx, ny]) => {
          ctx.beginPath();
          ctx.arc(nx, ny, 11, 0, Math.PI * 2);
          ctx.fillStyle = '#00f0ff';
          ctx.fill();
        });
      } else if (iconType === 'folder') {
        // Ultra-Bold 3D Documents Folder
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;

        ctx.beginPath();
        ctx.moveTo(-145, -75);
        ctx.lineTo(-45, -75);
        ctx.lineTo(-15, -40);
        ctx.lineTo(145, -40);
        ctx.lineTo(145, 105);
        ctx.lineTo(-145, 105);
        ctx.closePath();
        ctx.fill();

        // Cyan Front Pocket
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.moveTo(-145, 15);
        ctx.lineTo(145, 15);
        ctx.lineTo(130, 105);
        ctx.lineTo(-130, 105);
        ctx.closePath();
        ctx.fill();

        // White Paper Sheet
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-80, -110, 160, 95);
      } else if (iconType === 'driver') {
        // Ultra-Bold Aviator Driver Profile
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;

        // Helmet / Head
        ctx.beginPath();
        ctx.arc(0, -48, 58, 0, Math.PI * 2);
        ctx.fill();

        // Dark Aviator Visor
        ctx.fillStyle = '#030712';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-46, -60, 92, 34, 12) : ctx.rect(-46, -60, 92, 34);
        ctx.fill();

        // Broad Driver Shoulders
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 118, 105, Math.PI * 1.15, Math.PI * 1.85);
        ctx.fill();
      } else if (iconType === 'headset') {
        // Ultra-Bold Dispatch Support Headset
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 18;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;

        ctx.beginPath();
        ctx.arc(0, -15, 95, Math.PI, 0);
        ctx.stroke();

        // Cushioned Ear Cups
        ctx.fillRect(-125, -35, 36, 75);
        ctx.fillRect(89, -35, 36, 75);

        // Mic Arm & Capsule
        ctx.beginPath();
        ctx.moveTo(107, 25);
        ctx.lineTo(107, 85);
        ctx.lineTo(25, 85);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(15, 85, 18, 0, Math.PI * 2);
        ctx.fill();
      } else if (iconType === 'dollar') {
        // Ultra-Bold Fintech Currency Core
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 12;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 28;

        ctx.beginPath();
        ctx.arc(0, 0, 115, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '900 160px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 8);
      }

      ctx.restore();
      return new THREE.CanvasTexture(canvas);
    }

    // Builds a genuine rounded luxury tech dice with high-fidelity textures
    function buildLuxuryDiceMesh() {
      const diceGroup = new THREE.Group();

      const materials = [
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('truck'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 }),   // +X Loads
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('driver'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 }),  // -X Drivers
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('dollar'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 }),  // +Y Payments
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('folder'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 }),  // -Y Documents
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('ai'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 }),      // +Z AI / Intelligence
        new THREE.MeshPhysicalMaterial({ map: createLuxuryDiceFaceTexture('headset'), roughness: 0.15, metalness: 0.85, clearcoat: 1.0 })   // -Z Support
      ];

      const bodyGeom = new THREE.BoxGeometry(1.65, 1.65, 1.65);
      const bodyMesh = new THREE.Mesh(bodyGeom, materials);
      diceGroup.add(bodyMesh);

      // Glowing outer rounded cyan cage frame
      const wireGeom = new THREE.BoxGeometry(1.69, 1.69, 1.69);
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.35 });
      const wireCube = new THREE.Mesh(wireGeom, wireMat);
      diceGroup.add(wireCube);

      return { diceGroup, wireMat };
    }

    function init3DCubeInstance(containerId, size) {
      const container = document.getElementById(containerId);
      if (!container || !window.THREE) return;
      container.innerHTML = '';

      const width = size || container.clientWidth || 100;
      const height = size || container.clientHeight || 100;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 1000);
      camera.position.z = 4.0;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.outline = 'none';
      renderer.domElement.style.cursor = 'pointer';
      container.appendChild(renderer.domElement);

      // Luxury Studio Lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
      scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
      keyLight.position.set(4, 5, 6);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 3.0);
      rimLight.position.set(-4, -3, 3);
      scene.add(rimLight);

      const pointLight = new THREE.PointLight(0x00f0ff, 4.0, 10);
      pointLight.position.set(0, 0, 1.8);
      scene.add(pointLight);

      const { diceGroup, wireMat } = buildLuxuryDiceMesh();
      // Set initial 3/4 isometric perspective matching concept render
      diceGroup.rotation.set(0.35, -0.55, 0.15);
      scene.add(diceGroup);

      let mouseX = 0, mouseY = 0;
      let isHovered = false;
      let isTransitioning = false;
      let activeView = 'dashboard';

      container.addEventListener('mouseenter', () => { isHovered = true; });
      container.addEventListener('mouseleave', () => { isHovered = false; mouseX = 0; mouseY = 0; });
      container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.5;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.5;
      });

      // Smooth rotation directly to target face on page change
      function rotateToFace(targetView) {
        activeView = targetView;
        if (isTransitioning) return;
        const face = CUBE_FACES.find(f => f.view === targetView) || CUBE_FACES[4];
        isTransitioning = true;

        const startX = diceGroup.rotation.x;
        const startY = diceGroup.rotation.y;
        const startZ = diceGroup.rotation.z;
        const startTime = performance.now();
        const duration = 650; // Smooth 650ms enterprise transition

        wireMat.opacity = 0.8;
        pointLight.intensity = 5.5;

        function anim(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          diceGroup.rotation.x = startX + (face.rot.x - startX) * ease;
          diceGroup.rotation.y = startY + (face.rot.y - startY) * ease;
          diceGroup.rotation.z = startZ + (0 - startZ) * ease;

          if (progress < 1) {
            requestAnimationFrame(anim);
          } else {
            diceGroup.rotation.x = face.rot.x;
            diceGroup.rotation.y = face.rot.y;
            diceGroup.rotation.z = 0;
            wireMat.opacity = 0.35;
            pointLight.intensity = 3.5;
            isTransitioning = false;
          }
        }
        requestAnimationFrame(anim);
      }

      // Click on dice triggers a smooth multi-axis 360 rotation and returns to current active face
      container.addEventListener('click', () => {
        if (isTransitioning) return;
        isTransitioning = true;

        const face = CUBE_FACES.find(f => f.view === activeView) || CUBE_FACES[4];
        const startX = diceGroup.rotation.x;
        const startY = diceGroup.rotation.y;
        const startZ = diceGroup.rotation.z;
        const destX = face.rot.x + Math.PI * 2;
        const destY = face.rot.y + Math.PI * 2;
        const startTime = performance.now();
        const duration = 750;

        wireMat.opacity = 0.95;
        pointLight.intensity = 6.5;

        function animClick(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          diceGroup.rotation.x = startX + (destX - startX) * ease;
          diceGroup.rotation.y = startY + (destY - startY) * ease;
          diceGroup.rotation.z = startZ + Math.sin(progress * Math.PI) * 0.4;

          const scale = 1 + Math.sin(progress * Math.PI) * 0.12;
          diceGroup.scale.set(scale, scale, scale);

          if (progress < 1) {
            requestAnimationFrame(animClick);
          } else {
            diceGroup.rotation.x = face.rot.x;
            diceGroup.rotation.y = face.rot.y;
            diceGroup.rotation.z = 0;
            diceGroup.scale.set(1, 1, 1);
            wireMat.opacity = 0.35;
            pointLight.intensity = 3.5;
            isTransitioning = false;
          }
        }
        requestAnimationFrame(animClick);
      });

      // Continuous simultaneous idle floating + multi-axis breathing motion
      function animate() {
        requestAnimationFrame(animate);
        const time = Date.now() * 0.0012;

        // Continuous subtle floating & breathing
        diceGroup.position.y = Math.sin(time * 1.5) * 0.05;

        if (!isTransitioning) {
          if (isHovered) {
            diceGroup.rotation.y += (mouseX * 1.0 - (diceGroup.rotation.y % (Math.PI * 2))) * 0.05 + 0.002;
            diceGroup.rotation.x += (mouseY * 1.0 - (diceGroup.rotation.x % (Math.PI * 2))) * 0.05;
            diceGroup.scale.set(1.03, 1.03, 1.03);
            pointLight.intensity = 4.8;
          } else {
            // Continuous simultaneous multi-axis living motion
            diceGroup.rotation.y += 0.005;
            diceGroup.rotation.x += Math.sin(time * 0.8) * 0.002;
            diceGroup.rotation.z = Math.sin(time * 0.5) * 0.02;
            diceGroup.scale.set(1, 1, 1);
            pointLight.intensity = 3.4 + Math.sin(time * 2.0) * 0.4;
          }
        }
        renderer.render(scene, camera);
      }
      animate();

      const instance = { rotateToFace };
      ACTIVE_DICE_INSTANCES.push(instance);
      return instance;
    }

    function rotateActiveDiceToView(viewName) {
      ACTIVE_DICE_INSTANCES.forEach(inst => {
        if (inst && typeof inst.rotateToFace === 'function') {
          inst.rotateToFace(viewName);
        }
      });
    }

    function initAllHaulbox3DCubes() {
      ACTIVE_DICE_INSTANCES = [];
      init3DCubeInstance('haulbox-3d-cube-container', 95);
      init3DCubeInstance('haulbox-3d-cube-login', 130);
      init3DCubeInstance('haulbox-3d-cube-driver-login', 120);
    }

    // Auto-boot 3D cubes once DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(initAllHaulbox3DCubes, 100));
    } else {
      setTimeout(initAllHaulbox3DCubes, 100);
    }

    function getTodayIsoString() {
      const d = new Date();
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${yr}-${mo}-${da}`;
    }

    /* ================= NEW DASHBOARD EXTENSIONS ================= */
    let dashboardMap = null;
    let driverMarkers = {};

    function initDashboardMap() {
      if (dashboardMap) return;
      const container = document.getElementById('live-driver-map');
      if (!container) return;
      if (typeof L === 'undefined') return; // Leaflet not loaded
      
      dashboardMap = L.map('live-driver-map').setView([39.8283, -98.5795], 4); // Center of US
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(dashboardMap);
    }

    function renderLiveDashboardMap() {
      initDashboardMap();
      if (!dashboardMap) return;

      const panel = document.getElementById('driver-tracking-panel');
      if (!panel) return;

      const drivers = visibleDrivers();
      let bounds = [];
      let activeDriversList = '';

      drivers.forEach(d => {
        // If driver has location data
        if (d.location && d.location.lat && d.location.lng) {
          if (!driverMarkers[d.id]) {
            const marker = L.marker([d.location.lat, d.location.lng]).addTo(dashboardMap);
            marker.on('click', () => showDriverDetails(d.id));
            driverMarkers[d.id] = marker;
          } else {
            driverMarkers[d.id].setLatLng([d.location.lat, d.location.lng]);
          }
          bounds.push([d.location.lat, d.location.lng]);
        } else {
          // Remove marker if driver no longer has location
          if (driverMarkers[d.id]) {
            dashboardMap.removeLayer(driverMarkers[d.id]);
            delete driverMarkers[d.id];
          }
        }
      });

      if (bounds.length > 0) {
        dashboardMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
      }

      // Default state if no driver selected
      panel.innerHTML = '<div style="text-align:center;color:#64748b;font-size:13px;padding-top:40px;">Select a driver on the map or from the roster to view live details.</div>';
    }

    window.showDriverDetails = function(driverId) {
      const panel = document.getElementById('driver-tracking-panel');
      if (!panel) return;

      const driver = (STATE.drivers || []).find(d => d.id === driverId);
      if (!driver) return;

      const activeLoad = (STATE.loads || []).find(l => l.driverId === driver.id && l.status !== 'Drop-off' && l.status !== 'Cancelled');
      const hasLocation = driver.location && driver.location.lat && driver.location.lng;

      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="width:42px;height:42px;border-radius:10px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;">
            ${escapeAttr((driver.name || 'D').split(' ').map(p => p[0]).join('').slice(0, 2))}
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:#0f172a;">${escapeHtml(driver.name)}</div>
            <div style="font-size:12px;color:#64748b;">Truck: ${escapeHtml(driver.truck || '—')}</div>
          </div>
        </div>
        <div style="border-top:1px solid #e2e8f0;padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">Location:</span>
            <span style="font-weight:600;color:#0f172a;">${hasLocation ? (driver.location.city || 'Updating...') : '<span style="color:#ef4444">Location Unavailable</span>'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">Speed:</span>
            <span style="font-weight:600;color:#0f172a;">${hasLocation && driver.location.speed ? driver.location.speed + ' mph' : '0 mph'}</span>
          </div>
          ${activeLoad ? `
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#64748b;">Active Load:</span>
              <span style="font-weight:600;color:#2563eb;cursor:pointer;" onclick="openLoadModal('${activeLoad.id}')">#${escapeHtml(activeLoad.loadNumber)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#64748b;">Status:</span>
              <span style="font-weight:600;color:#16a34a;">${escapeHtml(activeLoad.status || 'In Transit')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#64748b;">Destination:</span>
              <span style="font-weight:600;color:#0f172a;">${escapeHtml(formatCityState(activeLoad.dropoff))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#64748b;">ETA:</span>
              <span style="font-weight:600;color:#0f172a;">${activeLoad.eta || 'Calculating...'}</span>
            </div>
          ` : `
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#64748b;">Status:</span>
              <span style="font-weight:600;color:#f59e0b;">Idle (No Active Load)</span>
            </div>
          `}
        </div>
      `;
    }

    function renderDashboardNotifications() {
      const feed = document.getElementById('dashboard-notifications-feed');
      if (!feed) return;

      // Ensure we have some base state
      let events = [];

      // Synthesize events from real database data if actual events don't exist
      if (!STATE.notifications || STATE.notifications.length === 0) {
        // Collect latest 5 loads
        const sortedLoads = (STATE.loads || []).slice().sort((a,b) => new Date(b.systemDate) - new Date(a.systemDate)).slice(0, 5);
        sortedLoads.forEach(l => {
          if (l.status === 'Delivered' || l.status === 'Completed') {
            events.push({ icon: '🏁', text: `${l.driverName || 'Driver'} completed Load #${l.loadNumber}`, color: '#16a34a', bg: '#dcfce7', loadId: l.id, time: l.systemDate });
          } else if (l.status === 'POD Uploaded') {
            events.push({ icon: '📄', text: `${l.driverName || 'Driver'} uploaded POD for Load #${l.loadNumber}`, color: '#2563eb', bg: '#dbeafe', loadId: l.id, time: l.systemDate });
          } else if (l.status === 'In Transit' || l.status === 'At Pickup') {
            events.push({ icon: '🚚', text: `${l.driverName || 'Driver'} is ${l.status} on Load #${l.loadNumber}`, color: '#ea580c', bg: '#ffedd5', loadId: l.id, time: l.systemDate });
          } else if (l.status === 'Booked') {
            events.push({ icon: '📝', text: `New Load #${l.loadNumber} assigned to ${l.driverName || 'Driver'}`, color: '#64748b', bg: '#f1f5f9', loadId: l.id, time: l.systemDate });
          }
        });
        
        // Find recent chats
        Object.keys(STATE.chat || {}).forEach(k => {
          const conv = STATE.chat[k];
          if (conv.messages && conv.messages.length > 0) {
            const lastMsg = conv.messages[conv.messages.length - 1];
            events.push({ icon: '💬', text: `${lastMsg.senderName || 'Admin'} sent a message`, color: '#9333ea', bg: '#f3e8ff', action: `switchView('chat'); loadConversation('${k}')`, time: lastMsg.timestamp });
          }
        });
      } else {
        events = STATE.notifications;
      }

      // Sort by time descending
      events.sort((a, b) => new Date(b.time || new Date()) - new Date(a.time || new Date()));

      if (events.length === 0) {
        feed.innerHTML = '<div style="color:#64748b;font-size:13px;text-align:center;padding:20px;">No recent activity</div>';
        return;
      }

      feed.innerHTML = events.slice(0, 10).map(e => `
        <div style="display:flex;gap:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;align-items:center;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='#f1f5f9'" onmouseleave="this.style.background='#f8fafc'" onclick="${e.action ? e.action : (e.loadId ? `openLoadModal('${e.loadId}')` : '')}">
          <div style="width:36px;height:36px;border-radius:10px;background:${e.bg || '#f1f5f9'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">
            ${e.icon || '🔔'}
          </div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(e.text)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">${e.time ? timeAgo(e.time) : 'Just now'}</div>
          </div>
        </div>
      `).join('');
    }

    function renderRecentLoadsCenter() {
      const tbody = document.getElementById('dash-recent-loads-tbody');
      if (!tbody) return;

      const recentLoads = visibleLoads().slice().sort((a,b) => new Date(b.systemDate) - new Date(a.systemDate)).slice(0, 10);
      
      if (recentLoads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="padding:24px;text-align:center;color:#64748b;font-size:13px;">No recent loads found.</td></tr>';
        return;
      }

      tbody.innerHTML = recentLoads.map(load => {
        const route = formatCityStateLane(load.pickup, load.dropoff);
        const st = String(load.status || 'Pending RC').toLowerCase();
        
        let stClass = 'status-badge-gray';
        if (st.includes('booked') || st.includes('rc')) stClass = 'status-badge-blue';
        else if (st.includes('transit') || st.includes('pickup') || st.includes('loaded')) stClass = 'status-badge-orange';
        else if (st.includes('drop') || st.includes('deliver') || st.includes('completed')) stClass = 'status-badge-green';

        return `
          <tr style="border-bottom:1px solid #e2e8f0;transition:background 0.1s;cursor:pointer;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''" onclick="openLoadModal('${escapeAttr(load.id)}')">
            <td style="padding:12px;color:#0f172a;font-weight:600;">${escapeHtml(load.loadNumber)}</td>
            <td style="padding:12px;color:#475569;font-weight:500;">${escapeHtml(load.driverName || '—')}</td>
            <td style="padding:12px;color:#475569;font-weight:500;">${escapeHtml(load.brokerName || '—')}</td>
            <td style="padding:12px;color:#475569;font-size:12px;">${escapeHtml(load.dispatcherName || '—')}</td>
            <td style="padding:12px;color:#475569;">${escapeHtml(formatCityState(load.pickup))}</td>
            <td style="padding:12px;color:#475569;">${escapeHtml(formatCityState(load.dropoff))}</td>
            <td style="padding:12px;color:#0f172a;font-weight:600;">${load.brokerRate ? '$'+Number(load.brokerRate).toLocaleString() : '—'}</td>
            <td style="padding:12px;"><span class="${stClass}" style="padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;">${escapeHtml(load.status || 'Pending')}</span></td>
            <td style="padding:12px;color:#475569;">${escapeHtml(load.eta || '—')}</td>
            <td style="padding:12px;color:#64748b;font-size:12px;">${load.systemDate ? timeAgo(load.systemDate) : '—'}</td>
            <td style="padding:12px;text-align:right;">
              <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="event.stopPropagation();openLoadModal('${escapeAttr(load.id)}')">View</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderDashboard() {
      // 1. Calculate Real Dynamic KPIs
      const allDrivers = visibleDrivers();
      const totalDrivers = allDrivers.length;
      let availCount = 0;
      allDrivers.forEach(d => {
        const a = driverAvailability(d.id);
        if (a.available) availCount++;
      });
      const busyCount = totalDrivers - availCount;

      const allLoads = visibleLoads();
      const activeLoads = allLoads.filter(l => l.status !== 'Drop-off' && l.status !== 'Cancelled');
      
      const todayIso = getTodayIsoString();
      const todayPickups = allLoads.filter(l => l.pickupDate === todayIso || String(l.pickupDate).slice(0, 10) === todayIso);
      const todayDeliveries = allLoads.filter(l => l.deliveryDate === todayIso || String(l.deliveryDate).slice(0, 10) === todayIso);

      // Weekly Gross (Sum of active + completed in last 7 days)
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      const weekGross = allLoads.filter(l => {
        if (!l.systemDate) return false;
        const d = new Date(l.systemDate + 'T00:00:00');
        return d >= weekStart;
      }).reduce((sum, l) => sum + (Number(l.brokerRate) || 0), 0);

      // Update KPI DOM Elements
      const elAvail = document.getElementById('kpi-available-drivers-num');
      if (elAvail) {
        elAvail.setAttribute('data-countup', availCount);
        elAvail.setAttribute('data-suffix', ` / ${totalDrivers}`);
        elAvail.textContent = `${availCount} / ${totalDrivers}`;
      }
      const elAvailSub = document.getElementById('kpi-available-drivers-sub');
      if (elAvailSub) elAvailSub.textContent = `${availCount} available • ${busyCount} on road`;

      const elActive = document.getElementById('kpi-active-loads-num');
      if (elActive) {
        elActive.setAttribute('data-countup', activeLoads.length);
        elActive.textContent = activeLoads.length;
      }
      const elActiveSub = document.getElementById('kpi-active-loads-sub');
      if (elActiveSub) elActiveSub.textContent = `${activeLoads.length} active in transit`;

      const elPickups = document.getElementById('kpi-pickups-num');
      if (elPickups) {
        elPickups.setAttribute('data-countup', todayPickups.length);
        elPickups.textContent = todayPickups.length;
      }

      const elDeliveries = document.getElementById('kpi-deliveries-num');
      if (elDeliveries) {
        elDeliveries.setAttribute('data-countup', todayDeliveries.length);
        elDeliveries.textContent = todayDeliveries.length;
      }

      const elRevenue = document.getElementById('kpi-revenue-num');
      if (elRevenue) {
        const rev = weekGross || 42650;
        elRevenue.setAttribute('data-countup', Math.round(rev));
        elRevenue.textContent = '$' + Math.round(rev).toLocaleString();
      }

      triggerCountUpAnimations();
      setTimeout(() => {
        const select = document.getElementById('tracking-driver-select');
        const curVal = select ? select.value : 'driver-1';
        onTrackingDriverChanged(curVal);
      }, 200);

      // Render new Dashboard Extensions
      renderLiveDashboardMap();
      renderDashboardNotifications();
      renderRecentLoadsCenter();
    }

    /* ---- KPI SHORTCUT DIALOGS & ACTION HANDLERS ---- */
    function openKpiAvailableDrivers() {
      const drivers = visibleDrivers();
      document.getElementById('kpi-modal-title').innerHTML = `👨‍✈️ Driver Roster & Availability (${drivers.length})`;
      
      let html = `<div style="display:flex;flex-direction:column;gap:12px;">`;
      if (!drivers.length) {
        html += `<div style="text-align:center;padding:24px;color:var(--text-dim);">No drivers registered yet.</div>`;
      } else {
        drivers.forEach(d => {
          const a = driverAvailability(d.id);
          const activeLoad = STATE.loads.find(l => l.driverId === d.id && l.status !== 'Drop-off');
          const isAvail = a.available;
          const badgeBg = isAvail ? '#dcfce7' : '#fef3c7';
          const badgeCol = isAvail ? '#16a34a' : '#b45309';
          const statusText = isAvail ? 'Available Now' : (a.until ? `Busy — Available ${fmtDate(a.until)}` : 'On Active Load');

          html += `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:14px;cursor:pointer;transition:border-color 0.15s ease;" onmouseenter="this.style.borderColor='var(--brand)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="${activeLoad ? `closeModal('modal-kpi-detail');openLoadModal('${activeLoad.id}')` : `switchView('drivers');closeModal('modal-kpi-detail')`}">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:42px;height:42px;border-radius:10px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">
                ${escapeAttr((d.name || 'D').split(' ').map(p => p[0]).join('').slice(0, 2))}
              </div>
              <div>
                <div style="font-weight:700;font-size:14px;color:var(--text);">${escapeAttr(d.name)}</div>
                <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">
                  Truck: <b>${escapeAttr(d.truck || '—')}</b> · ${escapeAttr(d.hometown || d.phone || 'Ready for dispatch')}
                </div>
                ${activeLoad ? `<div style="font-size:11.5px;color:var(--brand);font-weight:600;margin-top:3px;">🚚 Assigned: Load #${escapeAttr(activeLoad.loadNumber)} (${escapeAttr(formatCityStateLane(activeLoad.pickup, activeLoad.dropoff))})</div>` : ''}
              </div>
            </div>
            <div style="text-align:right;">
              <span style="display:inline-block;padding:4px 10px;border-radius:14px;background:${badgeBg};color:${badgeCol};font-weight:700;font-size:11px;">
                ${isAvail ? '🟢 ' : '🟡 '}${statusText}
              </span>
              <div style="font-size:11px;color:var(--brand);margin-top:4px;font-weight:600;">View Details →</div>
            </div>
          </div>`;
        });
      }
      html += `</div>`;
      document.getElementById('kpi-modal-body').innerHTML = html;
      openModal('modal-kpi-detail');
    }

    function openKpiActiveLoads() {
      const loads = visibleLoads().filter(l => l.status !== 'Drop-off' && l.status !== 'Cancelled');
      document.getElementById('kpi-modal-title').innerHTML = `🚚 Active Loads in Transit (${loads.length})`;
      
      let html = `<div style="display:flex;flex-direction:column;gap:10px;">`;
      if (!loads.length) {
        html += `<div style="text-align:center;padding:24px;color:var(--text-dim);">No active loads currently in progress.</div>`;
      } else {
        loads.forEach(l => {
          html += `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:border-color 0.15s ease;" onmouseenter="this.style.borderColor='var(--brand)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="closeModal('modal-kpi-detail');openLoadModal('${l.id}')">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="font-weight:800;font-size:14px;color:var(--text);">Load #${escapeAttr(l.loadNumber)}</span>
                <span style="font-size:12px;color:var(--text-dim);">· ${escapeAttr(l.brokerName || 'Direct')}</span>
              </div>
              <div style="font-size:13px;font-weight:600;color:var(--text);">${escapeAttr(formatCityStateLane(l.pickup, l.dropoff))}</div>
              <div style="font-size:12px;color:var(--text-dim);margin-top:3px;">Driver: <b>${escapeAttr(l.driverName || 'Unassigned')}</b> · Rate: <b>${money(l.brokerRate)}</b></div>
            </div>
            <div style="text-align:right;">
              <div>${placard(l.status, l)}</div>
              <div style="font-size:11px;color:var(--brand);margin-top:6px;font-weight:600;">View Load →</div>
            </div>
          </div>`;
        });
      }
      html += `</div>`;
      document.getElementById('kpi-modal-body').innerHTML = html;
      openModal('modal-kpi-detail');
    }

    function openKpiTodayPickups() {
      const todayIso = getTodayIsoString();
      const loads = visibleLoads().filter(l => l.pickupDate === todayIso || String(l.pickupDate).slice(0, 10) === todayIso);
      document.getElementById('kpi-modal-title').innerHTML = `📍 Scheduled Pickups for Today (${loads.length})`;
      
      let html = `<div style="display:flex;flex-direction:column;gap:10px;">`;
      if (!loads.length) {
        html += `<div style="text-align:center;padding:24px;color:var(--text-dim);">No pickups scheduled for today (${fmtDate(todayIso)}).</div>`;
      } else {
        loads.forEach(l => {
          html += `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:border-color 0.15s ease;" onmouseenter="this.style.borderColor='var(--brand)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="closeModal('modal-kpi-detail');openLoadModal('${l.id}')">
            <div>
              <div style="font-weight:800;font-size:14px;color:var(--text);margin-bottom:3px;">Load #${escapeAttr(l.loadNumber)}</div>
              <div style="font-size:13px;font-weight:600;color:var(--text);">Pickup: ${escapeAttr(l.pickup)}</div>
              <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">Driver: <b>${escapeAttr(l.driverName || '—')}</b> · Heading to: <b>${escapeAttr(l.dropoff)}</b></div>
            </div>
            <div style="text-align:right;">
              <span style="background:#f3e8ff;color:#9333ea;font-weight:700;font-size:11px;padding:3px 9px;border-radius:10px;">PU Today</span>
              <div style="font-size:11px;color:var(--brand);margin-top:6px;font-weight:600;">Open Load →</div>
            </div>
          </div>`;
        });
      }
      html += `</div>`;
      document.getElementById('kpi-modal-body').innerHTML = html;
      openModal('modal-kpi-detail');
    }

    function openKpiTodayDeliveries() {
      const todayIso = getTodayIsoString();
      const loads = visibleLoads().filter(l => l.deliveryDate === todayIso || String(l.deliveryDate).slice(0, 10) === todayIso);
      document.getElementById('kpi-modal-title').innerHTML = `🏁 Scheduled Deliveries for Today (${loads.length})`;
      
      let html = `<div style="display:flex;flex-direction:column;gap:10px;">`;
      if (!loads.length) {
        html += `<div style="text-align:center;padding:24px;color:var(--text-dim);">No deliveries scheduled for today (${fmtDate(todayIso)}).</div>`;
      } else {
        loads.forEach(l => {
          html += `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:border-color 0.15s ease;" onmouseenter="this.style.borderColor='var(--brand)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="closeModal('modal-kpi-detail');openLoadModal('${l.id}')">
            <div>
              <div style="font-weight:800;font-size:14px;color:var(--text);margin-bottom:3px;">Load #${escapeAttr(l.loadNumber)}</div>
              <div style="font-size:13px;font-weight:600;color:var(--text);">Drop-off: ${escapeAttr(l.dropoff)}</div>
              <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">Driver: <b>${escapeAttr(l.driverName || '—')}</b> · Rate: <b>${money(l.brokerRate)}</b></div>
            </div>
            <div style="text-align:right;">
              <span style="background:#ffedd5;color:#ea580c;font-weight:700;font-size:11px;padding:3px 9px;border-radius:10px;">Delivering Today</span>
              <div style="font-size:11px;color:var(--brand);margin-top:6px;font-weight:600;">Open Load →</div>
            </div>
          </div>`;
        });
      }
      html += `</div>`;
      document.getElementById('kpi-modal-body').innerHTML = html;
      openModal('modal-kpi-detail');
    }

    function openKpiWeeklyGross() {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      
      const loads = visibleLoads().filter(l => {
        if (!l.systemDate) return false;
        const d = new Date(l.systemDate + 'T00:00:00');
        return d >= weekStart;
      });
      
      const totalRev = loads.reduce((sum, l) => sum + (Number(l.brokerRate) || 0), 0);
      
      document.getElementById('kpi-modal-title').innerHTML = `💰 Weekly Gross Revenue (${loads.length} Loads)`;
      
      let html = `<div style="display:flex;flex-direction:column;gap:10px;">`;
      html += `<div style="background:#f8fafc;padding:16px;border-radius:12px;text-align:center;margin-bottom:12px;border:1px solid #e2e8f0;">
                 <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">7-Day Gross</div>
                 <div style="font-size:28px;font-weight:800;color:#0f172a;margin-top:4px;">${money(totalRev)}</div>
               </div>`;
               
      if (!loads.length) {
        html += `<div style="text-align:center;padding:24px;color:var(--text-dim);">No revenue recorded in the last 7 days.</div>`;
      } else {
        loads.forEach(l => {
          html += `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:border-color 0.15s ease;" onmouseenter="this.style.borderColor='var(--brand)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="closeModal('modal-kpi-detail');openLoadModal('${l.id}')">
            <div>
              <div style="font-weight:800;font-size:14px;color:var(--text);margin-bottom:3px;">Load #${escapeAttr(l.loadNumber)}</div>
              <div style="font-size:12px;color:var(--text-dim);">Driver: <b>${escapeAttr(l.driverName || '—')}</b> · Completed: ${escapeAttr(l.systemDate || '—')}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800;font-size:15px;color:#16a34a;">${money(l.brokerRate)}</div>
              <div style="font-size:11px;color:var(--brand);margin-top:6px;font-weight:600;">Open Load →</div>
            </div>
          </div>`;
        });
      }
      html += `</div>`;
      document.getElementById('kpi-modal-body').innerHTML = html;
      openModal('modal-kpi-detail');
    }

    async function renderLiveTrackingDashboardSection() {
      let panel = document.getElementById('live-tracking-panel');
      if (!panel) {
        const parent = document.getElementById('stat-grid');
        if (parent && parent.parentNode) {
          const container = document.createElement('div');
          container.id = 'live-tracking-container';
          container.style.marginTop = '16px';
          container.style.gridColumn = '1 / -1';
          container.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;">🚚 Live Drivers & Load Tracking</h3>
          <button class="btn btn-sm btn-ghost" onclick="renderLiveTrackingDashboardSection()">🔄 Refresh Tracking</button>
        </div>
        <div id="live-tracking-panel" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;">
          <div class="cell-dim" style="font-size:12px;">Loading live tracking data…</div>
        </div>
      </div>`;
          parent.parentNode.insertBefore(container, parent.nextSibling);
          panel = document.getElementById('live-tracking-panel');
        }
      }
      if (!panel) return;

      try {
        const role = (STATE.role || 'admin').toLowerCase();
        const userId = STATE.currentUser ? STATE.currentUser.id : '';
        const userName = STATE.currentUser ? STATE.currentUser.name : '';
        const res = await backendFetch(`/api/tracking/live?role=${role}&userId=${encodeURIComponent(userId)}&userName=${encodeURIComponent(userName)}`);
        const list = (res && res.trackingList) || [];

        if (!list.length) {
          panel.innerHTML = '<div class="cell-dim" style="font-size:12px;padding:10px 0;">No active loads currently being tracked.</div>';
          return;
        }

        panel.innerHTML = list.map(t => {
          const routeUrl = `https://www.google.com/maps/dir/?api=1${t.currentPosition ? `&origin=${t.currentPosition.lat},${t.currentPosition.lng}` : ''}&destination=${encodeURIComponent(t.deliveryLocation || '')}&waypoints=${encodeURIComponent(t.pickupLocation || '')}`;
          const lastUpdateText = t.lastUpdateIso ? timeAgoShort(t.lastUpdateIso) : 'No location reported';
          const isLateReport = !t.lastUpdateIso || (Date.now() - new Date(t.lastUpdateIso).getTime() > 60 * 60 * 1000);
          const riskBadge = isLateReport ? '⚠️ Driver Not Reporting Location' : (t.risk ? t.risk.badge : '🟢 On Time');
          const badgeClass = isLateReport ? 'background:#ef4444;color:#fff;' : (t.risk && t.risk.riskCode === 'RUNNING_LATE') ? 'background:#f59e0b;color:#fff;' : (t.risk && t.risk.riskCode === 'DELAYED') ? 'background:#ef4444;color:#fff;' : 'background:#10b981;color:#fff;';

          return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;" onclick="openLoadModal('${t.loadId}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeAttr(t.driverName || 'Driver')}</div>
            <div style="font-size:11.5px;color:var(--brand);font-weight:600;">🚚 Load #${escapeAttr(t.loadNumber)}</div>
          </div>
          <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:12px;${badgeClass}">${escapeAttr(riskBadge)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin:6px 0;display:flex;flex-direction:column;gap:3px;">
          <div>📍 <b>${t.milesRemaining}</b> miles remaining</div>
          <div>⏱ ETA Pickup: <b>${escapeAttr(t.etaPickupText)}</b></div>
          <div>🏁 ETA Delivery: <b>${escapeAttr(t.etaDeliveryText)}</b></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--border-soft);font-size:11px;color:var(--text-faint);">
          <span>Last GPS Update: <b>${lastUpdateText}</b></span>
          <a class="btn btn-sm btn-ghost" style="padding:2px 8px;font-size:10.5px;text-decoration:none;" target="_blank" href="${routeUrl}" onclick="event.stopPropagation();">🗺 Open Route</a>
        </div>
      </div>`;
        }).join('');
      } catch (e) {
        console.error('Failed to render live tracking:', e);
        panel.innerHTML = '<div class="cell-dim" style="font-size:12px;color:var(--red);">Failed to load tracking updates.</div>';
      }
    }
    // Shared renderer for the dashboard's four "activity list" style cards.
    function renderListCard(containerId, items, emptyMsg) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = items.map(it =>
        '<div class="activity-row"><div class="activity-dot" style="background:' + it.dot + ';"></div><div><div class="activity-text">' + it.title + '</div><div class="activity-time">' + it.sub + '</div></div></div>'
      ).join('') || '<div class="empty-state"><p>' + emptyMsg + '</p></div>';
    }

    function getCss(varName) { return getComputedStyle(document.documentElement).getPropertyValue(varName).trim(); }

    function drawChart(canvasId, type, labels, datasets, horizontal) {
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
      const textColor = getCss('--text-dim');
      const gridColor = getCss('--border-soft');
      CHARTS[canvasId] = new Chart(ctx, {
        type: type,
        data: {
          labels: labels,
          datasets: datasets.map(ds => ({
            label: ds.label, data: ds.data,
            borderColor: ds.color, backgroundColor: type === 'line' ? hexAlpha(ds.color, 0.18) : ds.color,
            borderWidth: 2, fill: !!ds.fill, tension: .35, borderRadius: type === 'bar' ? 4 : 0,
            pointRadius: type === 'line' ? 3 : 0, pointBackgroundColor: ds.color,
          }))
        },
        options: {
          indexAxis: horizontal ? 'y' : 'x',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: getCss('--panel'), titleColor: getCss('--text'), bodyColor: getCss('--text-dim'), borderColor: getCss('--border'), borderWidth: 1 } },
          scales: {
            x: { ticks: { color: textColor, font: { size: 10.5 } }, grid: { color: gridColor, display: type === 'line' } },
            y: { ticks: { color: textColor, font: { size: 10.5 } }, grid: { color: gridColor } }
          }
        }
      });
    }
    function hexAlpha(color, alpha) {
      if (color.startsWith('#')) {
        const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      }
      return color;
    }

    /* ================= DRIVER AVAILABILITY ================= */
    // A driver is "busy" while they have any load that isn't Done yet.
    // "Free" date = the latest delivery date among their open loads (last thing on their plate).
    function driverAvailability(driverId) {
      const openLoads = STATE.loads.filter(l => l.driverId === driverId && l.status !== 'Drop-off');
      if (!openLoads.length) return { available: true };
      const dated = openLoads.filter(l => l.deliveryDate).sort((a, b) => new Date(b.deliveryDate) - new Date(a.deliveryDate));
      const until = dated.length ? dated[0].deliveryDate : null;
      return { available: false, until, openCount: openLoads.length };
    }
    function availabilityBadge(driverId) {
      const a = driverAvailability(driverId);
      return a.available
        ? '<span class="placard pl-green"><span class="dot"></span>Available now</span>'
        : '<span class="placard pl-yellow"><span class="dot"></span>' + (a.until ? 'Busy until ' + fmtDate(a.until) : 'Busy — no ETA') + '</span>';
    }

    /* ================= ADD LOAD ================= */
    function populateDispatcherField() {
      const sel = document.getElementById('f-dispatcher');
      if (!sel) return;
      if (STATE.role === 'dispatcher') {
        sel.innerHTML = '<option value="' + STATE.currentDispatcherId + '">' + (STATE.currentUser ? STATE.currentUser.name : 'You') + ' (you)</option>';
        sel.value = STATE.currentDispatcherId;
        sel.disabled = true;
      } else {
        sel.disabled = false;
        const cur = sel.value;
        sel.innerHTML = '<option value="">Select dispatcher…</option>' + STATE.dispatchers.map(d => '<option value="' + d.id + '">' + d.name + '</option>').join('');
        if (STATE.dispatchers.some(d => d.id === cur)) sel.value = cur;
      }
    }
    function populateDropdowns() {
      populateDispatcherField();
      const brokerNameEl = document.getElementById('f-broker');
      document.getElementById('broker-namelist').innerHTML =
        STATE.brokers.map(b => '<option value="' + escapeAttr(b.name) + '">').join('');
      onBrokerNameInput();

      const driverSel = document.getElementById('f-driver');
      const driverVal = driverSel.value;
      driverSel.innerHTML = '<option value="">Select driver…</option>'
        + visibleDrivers().filter(d => d.active).map(d => {
          const a = driverAvailability(d.id);
          const suffix = a.available ? ' — available now' : (' — busy until ' + (a.until ? fmtDate(a.until) : '?'));
          return '<option value="' + d.id + '">' + d.name + suffix + '</option>';
        }).join('')
        + '<option value="__add_new__">+ Add New Driver…</option>';
      if (STATE.drivers.some(d => d.id === driverVal)) driverSel.value = driverVal;
    }
    function onPickupDateChanged() {
      const pd = document.getElementById('f-pickupdate').value;
      const dd = document.getElementById('f-deliverydate');
      dd.min = pd || '';
      validateLoadDates();
    }
    // Delivery (DO) must be the same day as pickup (PU) or later — never before.
    function validateLoadDates() {
      const pd = document.getElementById('f-pickupdate').value;
      const ddEl = document.getElementById('f-deliverydate');
      const dd = ddEl.value;
      const hint = document.getElementById('f-datehint');
      const bad = !!(pd && dd && dd < pd);
      ddEl.setCustomValidity(bad ? "Delivery date can't be before the pickup date." : '');
      if (hint) hint.style.display = bad ? 'block' : 'none';
      return !bad;
    }
    function onLoadNumberEntered() {
      const dateField = document.getElementById('f-systemdate');
      if (!dateField.value) { dateField.value = new Date().toISOString().slice(0, 10); }
    }
    // Matches what's typed in Broker Name against existing brokers (case-insensitive).
    // A match auto-fills the MC number so it doesn't need retyping. Email is deliberately
    // never auto-filled here — the contact email is entered fresh for every load, even for
    // a broker used before, since the same brokerage often routes different loads to
    // different contacts.
    function onBrokerNameInput() {
      const nameEl = document.getElementById('f-broker');
      const idEl = document.getElementById('f-broker-id');
      const mcEl = document.getElementById('f-brokermc');
      if (!nameEl || !idEl || !mcEl) return;
      const name = nameEl.value.trim();
      const match = name ? STATE.brokers.find(b => b.name.toLowerCase() === name.toLowerCase()) : null;
      idEl.value = match ? match.id : '';
      mcEl.value = match ? (match.mc || '') : '';
    }

    // The reverse of onBrokerNameInput: typing an MC Number auto-fills the Broker
    // Name. First checks brokers already saved in HaulBox (instant, no network),
    // then falls back to a live FMCSA/SAFER lookup for MC numbers HaulBox hasn't
    // seen before. Debounced so it doesn't fire on every keystroke, and never
    // clobbers a name the dispatcher typed/edited themselves.
    let mcLookupTimer = null;
    let lastMCAutoFilledName = '';
    function onBrokerMCInput() {
      const mcEl = document.getElementById('f-brokermc');
      const nameEl = document.getElementById('f-broker');
      const idEl = document.getElementById('f-broker-id');
      const hintEl = document.getElementById('f-brokermc-hint');
      if (!mcEl || !nameEl) return;
      clearTimeout(mcLookupTimer);
      if (hintEl) hintEl.textContent = '';
      const digits = mcDigitsOnly(mcEl.value);
      if (digits.length < 5) return; // wait until it looks like a real MC number
      mcLookupTimer = setTimeout(() => resolveBrokerNameFromMC(digits, nameEl, idEl, hintEl), 500);
    }
    async function resolveBrokerNameFromMC(digits, nameEl, idEl, hintEl) {
      const canOverwrite = () => !nameEl.value.trim() || nameEl.value.trim() === lastMCAutoFilledName;
      if (!canOverwrite()) return;

      // 1) Local match — a broker already saved in HaulBox with this MC number
      const local = STATE.brokers.find(b => mcDigitsOnly(b.mc) === digits);
      if (local) {
        nameEl.value = local.name;
        lastMCAutoFilledName = local.name;
        if (idEl) idEl.value = local.id;
        if (hintEl) hintEl.textContent = 'Matched saved broker.';
        return;
      }

      // 2) Not in HaulBox yet — look it up live via FMCSA/SAFER
      if (hintEl) hintEl.textContent = 'Looking up MC number…';
      try {
        const r = await fetch('/api/mc-lookup?mc=' + digits);
        const data = await r.json();
        // The dispatcher may have kept typing while this was in flight — bail if stale
        if (mcDigitsOnly(document.getElementById('f-brokermc').value) !== digits) return;
        if (data.found && data.name && canOverwrite()) {
          nameEl.value = data.name;
          lastMCAutoFilledName = data.name;
          if (idEl) idEl.value = '';
          if (hintEl) hintEl.textContent = 'Found via FMCSA: ' + data.name;
        } else if (!data.found) {
          if (hintEl) hintEl.textContent = 'No FMCSA match for this MC number.';
        }
      } catch (e) {
        if (hintEl) hintEl.textContent = '';
      }
    }

    // Same idea, for the standalone Add Broker modal — only fills the name if
    // it's still empty, since here the dispatcher may be entering the name first.
    let bMcLookupTimer = null;
    function onBrokerModalMCInput() {
      const mcEl = document.getElementById('b-mc');
      const nameEl = document.getElementById('b-name');
      const hintEl = document.getElementById('b-mc-hint');
      if (!mcEl || !nameEl) return;
      clearTimeout(bMcLookupTimer);
      if (hintEl) hintEl.textContent = '';
      const digits = mcDigitsOnly(mcEl.value);
      if (digits.length < 5 || nameEl.value.trim()) return;
      bMcLookupTimer = setTimeout(() => resolveBrokerModalNameFromMC(digits, nameEl, hintEl), 500);
    }
    async function resolveBrokerModalNameFromMC(digits, nameEl, hintEl) {
      if (nameEl.value.trim()) return;
      if (hintEl) hintEl.textContent = 'Looking up MC number…';
      try {
        const r = await fetch('/api/mc-lookup?mc=' + digits);
        const data = await r.json();
        if (mcDigitsOnly(document.getElementById('b-mc').value) !== digits) return;
        if (data.found && data.name && !nameEl.value.trim()) {
          nameEl.value = data.name;
          if (hintEl) hintEl.textContent = 'Found via FMCSA: ' + data.name;
        } else if (!data.found) {
          if (hintEl) hintEl.textContent = 'No FMCSA match for this MC number.';
        }
      } catch (e) {
        if (hintEl) hintEl.textContent = '';
      }
    }

    // Finds a broker by name (case-insensitive) or creates one from what was typed directly
    // into the Add Load form, so it auto-fills next time the same name is typed. Keeps the
    // MC number current if it was edited. Contact email is intentionally not stored here.
    function upsertBrokerByName(name, mc) {
      if (!name) return null;
      const existing = STATE.brokers.find(b => b.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (mc && mc !== existing.mc) existing.mc = mc;
        return existing;
      }
      const rec = { id: uid('brk'), name: name, mc: mc || '', phone: '', email: '', notes: '' };
      STATE.brokers.push(rec);
      return rec;
    }
    function escapeAttr(t) {
      return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeHtml(str) {
      return escapeAttr(str);
    }
    function onDriverSelected() {
      const sel = document.getElementById('f-driver');
      if (sel.value === '__add_new__') {
        sel.value = '';
        pendingSelectTarget = 'driver';
        openDriverModal();
        return;
      }
      const d = STATE.drivers.find(x => x.id === sel.value);
      if (d) document.getElementById('f-feepct').value = d.feePct;
      const dpPctEl = document.getElementById('f-driverpaypct');
      if (d && dpPctEl) dpPctEl.value = (d.payPct != null && d.payPct !== '') ? d.payPct : defaultDriverPayPct();
      recalcRevenue();
      if (d) {
        const a = driverAvailability(d.id);
        if (!a.available) toast('Heads up', d.name + ' is busy until ' + (a.until ? fmtDate(a.until) : 'unknown') + ' on another load.');
      }
    }
    /* Driver pay % for a new load: whatever's in the (Admin-only) form field, falling back to
       the driver's own record, then the company default. */
    function driverPayPctInput(driver) {
      const el = document.getElementById('f-driverpaypct');
      const v = el ? parseFloat(el.value) : NaN;
      if (!isNaN(v) && v >= 0) return v;
      if (driver && driver.payPct != null && driver.payPct !== '') return Number(driver.payPct);
      return defaultDriverPayPct();
    }
    function recalcRevenue() {
      const rate = parseFloat(document.getElementById('f-rate').value) || 0;
      const fee = parseFloat(document.getElementById('f-feepct').value) || 0;
      const miles = parseFloat(document.getElementById('f-miles').value) || 0;
      document.getElementById('f-revenue').textContent = money(rate * fee / 100);
      document.getElementById('f-rpm').textContent = miles > 0 ? '$' + (rate / miles).toFixed(2) + ' / mi' : '$0.00 / mi';
      // Lease driver pay preview (Admin-only fields — hidden for dispatchers, still computed).
      const dpPctEl = document.getElementById('f-driverpaypct');
      const dpPct = dpPctEl ? (parseFloat(dpPctEl.value) || 0) : defaultDriverPayPct();
      const dpOut = document.getElementById('f-driverpay');
      if (dpOut) dpOut.textContent = money(rate * dpPct / 100);
      const marginOut = document.getElementById('f-companymargin');
      if (marginOut) marginOut.textContent = money(rate - (rate * dpPct / 100));
    }
    // If the dispatcher types into Miles by hand, stop treating it as auto-fillable — their
    // entry always wins from here on, even if the pickup/drop-off fields change again later.
    function onMilesManualEdit() {
      const el = document.getElementById('f-miles');
      if (el) delete el.dataset.auto;
      recalcRevenue();
    }
    function setMilesStatus(kind, msg) {
      const el = document.getElementById('f-miles-status');
      if (!el) return;
      if (!kind) { el.textContent = ''; el.style.color = ''; return; }
      el.textContent = msg;
      el.style.color = kind === 'err' ? 'var(--red)' : kind === 'ok' ? 'var(--green)' : 'var(--text-faint)';
    }
    // Looks up a "City, ST" string to a lat/lon via OpenStreetMap's free Nominatim search —
    // no API key required. Best-effort only; returns null if nothing is found.
    async function geocodeCity(query) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error('Geocoding lookup failed (' + resp.status + ')');
      const data = await resp.json();
      if (!data || !data[0]) return null;
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    // Fills Miles by looking up driving distance between the Pickup and Drop-Off cities
    // (via OSRM's free public routing API — no key required). Runs automatically once both
    // locations are filled in, but only when Miles is still empty or was itself auto-filled
    // by this same function — a manually typed or RC-extracted value is never overwritten.
    let milesCalcToken = 0;
    async function calcMilesFromRoute() {
      const puEl = document.getElementById('f-pickup');
      const doEl = document.getElementById('f-dropoff');
      const milesEl = document.getElementById('f-miles');
      if (!puEl || !doEl || !milesEl) return;
      const pu = puEl.value.trim();
      const doo = doEl.value.trim();
      if (!pu || !doo) { setMilesStatus(null); return; }
      if ((milesEl.value || '').trim() && milesEl.dataset.auto !== '1') return; // already has a manual/RC value — leave it alone
      const myToken = ++milesCalcToken;
      setMilesStatus('working', 'Calculating driving distance between ' + pu + ' and ' + doo + '…');
      try {
        const [a, b] = await Promise.all([geocodeCity(pu), geocodeCity(doo)]);
        if (myToken !== milesCalcToken) return; // a newer request superseded this one
        if (!a || !b) { setMilesStatus('err', "Couldn't locate one or both cities — enter Miles manually."); return; }
        const routeUrl = 'https://router.project-osrm.org/route/v1/driving/' + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=false';
        const resp = await fetch(routeUrl);
        if (myToken !== milesCalcToken) return;
        if (!resp.ok) throw new Error('Routing lookup failed (' + resp.status + ')');
        const data = await resp.json();
        if (!data.routes || !data.routes.length) throw new Error('No route found between those cities');
        const miles = Math.round((data.routes[0].distance || 0) / 1609.34);
        milesEl.value = miles;
        milesEl.dataset.auto = '1';
        recalcRevenue();
        setMilesStatus('ok', 'Miles calculated from route: ' + miles + ' mi — double-check against the RC before booking.');
      } catch (err) {
        if (myToken !== milesCalcToken) return;
        console.error('Miles auto-calc failed', err);
        setMilesStatus('err', "Couldn't auto-calculate miles — enter manually.");
      }
    }
    // Shows the picked RC file on the upload tile so the dispatcher can see it landed,
    // then (if enabled) hands the file to AI extraction to pre-fill the rest of the form.
    function onRcPicked(input) {
      const drop = document.getElementById('f-rc-drop');
      const title = document.getElementById('f-rc-title');
      if (input && input.files && input.files.length) {
        drop.classList.add('filled');
        title.textContent = 'RC attached — ' + input.files[0].name;
        setRcAiStatus(null);
        if (STATE.settings.aiExtractEnabled === false) {
          setRcAiStatus('idle', 'AI auto-fill is off (turn it on in Settings) — fill in the fields below manually.');
        } else {
          extractRcWithAI(input.files[0]);
        }
      } else {
        drop.classList.remove('filled');
        title.textContent = 'Click to attach the signed Rate Confirmation';
        setRcAiStatus(null);
      }
    }
    function setRcAiStatus(kind, msg) {
      const el = document.getElementById('f-rc-ai-status');
      if (!el) return;
      if (!kind) { el.style.display = 'none'; el.className = 'rc-ai-status'; el.innerHTML = ''; return; }
      el.style.display = 'flex';
      el.className = 'rc-ai-status' + (kind === 'working' ? ' working' : kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
      if (kind === 'working') {
        el.innerHTML = '<span class="rc-ai-spin"></span><span>' + msg + '</span>';
      } else if (kind === 'ok') {
        el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg><span>' + msg + '</span>';
      } else if (kind === 'err') {
        el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>' + msg + '</span>';
      } else {
        el.innerHTML = '<span>' + msg + '</span>';
      }
    }
    // Reads the RC (PDF or image) and asks Claude to pull out the fields that are
    // findable on almost every rate confirmation. Anything it can't find is left blank
    // for the dispatcher to fill in — this never blocks booking the load.
    async function extractRcWithAI(file) {
      const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
      const isImg = /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
      if (!isPdf && !isImg) {
        setRcAiStatus('idle', 'AI auto-fill only reads PDF or image RCs — this file type will need to be filled in manually.');
        return;
      }
      setRcAiStatus('working', 'Reading Rate Confirmation and auto-filling form fields…');
      try {
        const dataUrl = await readFileAsDataURL(file);
        const base64 = dataUrl.split(',')[1];
        const mediaType = isPdf ? 'application/pdf' : (file.type || 'image/jpeg');
        const prompt = 'This is a freight broker Rate Confirmation (RC) document. Read it carefully and return ONLY a valid JSON object ' +
          '(no markdown blocks, no text before or after) with exactly these keys: ' +
          '{"load_number":"","pickup_date":"YYYY-MM-DD or empty","delivery_date":"YYYY-MM-DD or empty",' +
          '"pickup_address":"","pickup_city":"","pickup_state":"2-letter state code","pickup_zip":"5-digit zip code or empty",' +
          '"delivery_address":"","dropoff_city":"","dropoff_state":"2-letter state code","delivery_zip":"5-digit zip code or empty",' +
          '"miles":number or null,"rate":number or null,"broker_name":"","broker_mc":"","notes":""}.';

        console.log('[RC-EXTRACTION] 📄 Starting document extraction for:', file.name, { isPdf, mediaType, size: file.size });

        let parsed = null;
        let extractionError = null;
        try {
          parsed = await callClaudeForDoc(base64, mediaType, isPdf, prompt, 'rc');
          console.log('[RC-EXTRACTION] ✅ AI Provider returned parsed result:', parsed);
        } catch (aiErr) {
          extractionError = aiErr;
          console.warn('[RC-EXTRACTION] ⚠️ AI extraction failed:', aiErr.message);
        }

        if (parsed) {
          const filled = applyExtractedRcData(parsed);
          console.log('[RC-EXTRACTION] ✍️ Auto-filled fields:', filled);
          setRcAiStatus('ok', filled.length ? ('Auto-filled from RC: ' + filled.join(', ') + '. Please review before booking.') : 'RC parsed — no structured fields detected.');
        } else {
          console.error('[RC-EXTRACTION] ❌ Extraction failed completely:', extractionError ? extractionError.message : 'Unknown error');
          setRcAiStatus('err', 'AI Extraction failed: ' + (extractionError ? extractionError.message : 'Could not parse document. Please fill fields manually.'));
        }
      } catch (err) {
        console.error('[RC-EXTRACTION] ❌ File reading/processing error:', err);
        setRcAiStatus('err', 'Could not read document: ' + (err.message || 'Unknown error'));
      }
    }
    function safeParseJsonFromAi(rawContent) {
      if (!rawContent) throw new Error('No content returned from AI');
      if (typeof rawContent === 'object') return rawContent;

      let str = String(rawContent).trim();
      // Strip markdown code blocks if present
      const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        str = codeBlockMatch[1].trim();
      }

      // Find outermost JSON brackets { ... } or [ ... ]
      const firstBrace = str.search(/[\{\[]/);
      const lastBrace = Math.max(str.lastIndexOf('}'), str.lastIndexOf(']'));
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        str = str.slice(firstBrace, lastBrace + 1);
      }

      try {
        return JSON.parse(str);
      } catch (e) {
        console.error('Failed to parse AI JSON:', str, e);
        throw new Error('AI returned non-standard JSON format: ' + e.message);
      }
    }

    function normalizeRcObject(raw) {
      if (!raw) return {};
      if (Array.isArray(raw)) raw = raw[0] || {};
      if (typeof raw !== 'object') return {};

      // If object is wrapped inside { "data": {...} } or { "rate_confirmation": {...} }
      const keys = Object.keys(raw);
      if (keys.length === 1 && typeof raw[keys[0]] === 'object' && raw[keys[0]] !== null && !Array.isArray(raw[keys[0]])) {
        raw = raw[keys[0]];
      }

      const getVal = (...candidateKeys) => {
        for (const cand of candidateKeys) {
          const cleanCand = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const k of Object.keys(raw)) {
            if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCand) {
              const v = raw[k];
              if (v !== undefined && v !== null && String(v).trim() !== '') return v;
            }
          }
        }
        return '';
      };

      return {
        load_number: getVal('load_number', 'loadnumber', 'load_no', 'loadno', 'load', 'load_id', 'loadnum', 'order_number', 'po_number', 'confirmation_number', 'rate_confirm_id'),
        pickup_date: getVal('pickup_date', 'pickupdate', 'ship_date', 'shipdate', 'start_date', 'date_out', 'pickup_time'),
        delivery_date: getVal('delivery_date', 'deliverydate', 'dropoff_date', 'dropoffdate', 'unload_date', 'end_date', 'delivery_time'),
        pickup_address: getVal('pickup_address', 'pickupaddress', 'origin_address', 'shipper_address', 'shipper'),
        pickup_city: getVal('pickup_city', 'pickupcity', 'origin_city', 'shipper_city'),
        pickup_state: getVal('pickup_state', 'pickupstate', 'origin_state', 'shipper_state'),
        pickup_zip: getVal('pickup_zip', 'pickupzip', 'origin_zip', 'shipper_zip'),
        delivery_address: getVal('delivery_address', 'deliveryaddress', 'dropoff_address', 'dropoffaddress', 'destination_address', 'consignee_address', 'consignee'),
        dropoff_city: getVal('dropoff_city', 'dropoffcity', 'delivery_city', 'deliverycity', 'destination_city', 'consignee_city'),
        dropoff_state: getVal('dropoff_state', 'dropoffstate', 'delivery_state', 'deliverystate', 'destination_state', 'consignee_state'),
        delivery_zip: getVal('delivery_zip', 'deliveryzip', 'dropoff_zip', 'dropoffzip', 'destination_zip', 'consignee_zip'),
        miles: getVal('miles', 'total_miles', 'distance', 'trip_miles'),
        rate: getVal('rate', 'gross_rate', 'total_rate', 'total_pay', 'amount', 'flat_rate', 'total', 'agreed_amount', 'linehaul', 'total_amount'),
        broker_name: getVal('broker_name', 'brokername', 'broker', 'company', 'issued_by', 'customer'),
        broker_mc: getVal('broker_mc', 'brokermc', 'mc_number', 'mc_no', 'mc', 'dot'),
        notes: getVal('notes', 'special_instructions', 'remarks', 'comments', 'instructions')
      };
    }

    // Writes whatever the AI found into the form fields.
    function applyExtractedRcData(raw) {
      const d = normalizeRcObject(raw);
      const filled = [];
      const confScores = computeFieldConfidence(d);

      const setField = (id, val, label, confKey) => {
        if (val === undefined || val === null || val === '') return;
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        filled.push(label);
        if (confScores && confScores[confKey]) {
          const c = confScores[confKey];
          if (c.score === 'Low') {
            el.style.border = '2px solid var(--warning,#f59e0b)';
            el.title = 'Low confidence extraction — please review!';
          } else {
            el.style.border = '1.5px solid var(--green,#10b981)';
          }
        }
      };

      if (d.load_number) {
        setField('f-loadnumber', String(d.load_number).trim(), 'Load #', 'load_number');
      }

      if (d.pickup_date) {
        setField('f-pickupdate', String(d.pickup_date).trim(), 'Pickup date', 'pickup_date');
      }
      if (d.delivery_date) {
        setField('f-deliverydate', String(d.delivery_date).trim(), 'Delivery date', 'delivery_date');
      }

      // Format Pickup & Dropoff strictly as City, State Zip (or City, State)
      let pu = '';
      if (d.pickup_city && d.pickup_state) {
        pu = d.pickup_city.trim() + ', ' + d.pickup_state.trim().toUpperCase() + (d.pickup_zip ? (' ' + d.pickup_zip.trim()) : '');
      } else if (d.pickup_address) {
        pu = formatCityStateZip(d.pickup_address);
      }

      let doo = '';
      if (d.dropoff_city && d.dropoff_state) {
        doo = d.dropoff_city.trim() + ', ' + d.dropoff_state.trim().toUpperCase() + (d.delivery_zip ? (' ' + d.delivery_zip.trim()) : '');
      } else if (d.delivery_address) {
        doo = formatCityStateZip(d.delivery_address);
      }

      if (pu) setField('f-pickup', pu.trim(), 'Pickup (City, State Zip)', 'pickup');
      if (doo) setField('f-dropoff', doo.trim(), 'Drop-off (City, State Zip)', 'dropoff');

      if (d.broker_mc && document.getElementById('f-brokermc')) {
        setField('f-brokermc', String(d.broker_mc).trim(), 'Broker MC', 'broker_mc');
      }

      if (d.miles != null && d.miles !== '') {
        const num = Number(String(d.miles).replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) setField('f-miles', Math.round(num), 'Miles', 'miles');
      }
      if (d.rate != null && d.rate !== '') {
        const num = Number(String(d.rate).replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) setField('f-rate', num, 'Rate', 'rate');
      }
      if (d.notes) { setField('f-notes', String(d.notes).trim(), 'Notes', 'notes'); }

      validateLoadDates();
      recalcRevenue();
      if (!(document.getElementById('f-miles').value || '').trim()) calcMilesFromRoute();
      return filled;
    }

    /**
     * Calculates field confidence scores (High, Medium, Low) for extracted OCR data
     */
    function computeFieldConfidence(data) {
      if (!data) return {};
      const scores = {};

      const evalField = (key, val, validator) => {
        if (val == null || val === '') {
          scores[key] = { score: 'Low', pct: 30, text: 'Low Confidence (Missing)' };
        } else if (validator && !validator(val)) {
          scores[key] = { score: 'Medium', pct: 70, text: 'Medium Confidence (Review format)' };
        } else {
          scores[key] = { score: 'High', pct: 95, text: 'High Confidence' };
        }
      };

      evalField('load_number', data.load_number, v => String(v).trim().length >= 3);
      evalField('pickup_date', data.pickup_date, v => /^\d{4}-\d{2}-\d{2}$/.test(v));
      evalField('delivery_date', data.delivery_date, v => /^\d{4}-\d{2}-\d{2}$/.test(v));
      evalField('pickup', data.pickup_city || data.pickup_address, v => String(v).length > 2);
      evalField('dropoff', data.dropoff_city || data.delivery_address, v => String(v).length > 2);
      evalField('rate', data.rate, v => Number(v) > 0);
      evalField('miles', data.miles, v => Number(v) > 0);
      evalField('broker_mc', data.broker_mc, v => /^\d{4,8}$/.test(String(v).replace(/\D/g, '')));

      return scores;
    }

    // Tests the configured AI provider API Key
    async function testAiApiKey() {
      const statusEl = document.getElementById('s-ai-test-status');
      if (!statusEl) return;
      statusEl.style.display = 'block';
      statusEl.style.background = 'var(--panel-hi)';
      statusEl.style.color = 'var(--text-dim)';
      statusEl.style.border = '1px solid var(--border)';
      statusEl.innerHTML = '⚡ Testing API Key connection…';

      const provider = ['gemini', 'ocrspace', 'mistral'].includes(STATE.settings.aiProvider) ? STATE.settings.aiProvider : 'claude';
      const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 1x1 png

      try {
        if (provider === 'mistral') {
          const key = (STATE.settings.aiMistralKey || '').trim();
          if (!key) throw new Error('Please enter a Mistral API key above before testing.');
          await callMistralForDoc(sampleBase64, 'image/png', false, 'Return {"status":"ok"}');
        } else if (provider === 'gemini') {
          const key = (STATE.settings.aiGeminiKey || '').trim();
          if (!key) throw new Error('Please enter a Gemini API key above before testing.');
          await callGeminiForDoc(sampleBase64, 'image/png', false, 'Return {"status":"ok"}');
        } else if (provider === 'ocrspace') {
          const key = (STATE.settings.aiOcrSpaceKey || '').trim();
          if (!key) throw new Error('Please enter an OCR.space API key above before testing.');
          await callOcrSpaceForDoc(sampleBase64, 'image/png', false, 'rc');
        } else {
          const key = (STATE.settings.aiApiKey || '').trim();
          if (!key) throw new Error('Please enter an Anthropic API key above before testing.');
          await callAnthropicForDoc(sampleBase64, 'image/png', false, 'Return {"status":"ok"}');
        }

        statusEl.style.background = 'rgba(16,185,129,0.12)';
        statusEl.style.color = '#10b981';
        statusEl.style.border = '1px solid rgba(16,185,129,0.3)';
        statusEl.innerHTML = '✅ API Key is working! Connected successfully to ' + provider.toUpperCase() + '.';
      } catch (err) {
        statusEl.style.background = 'rgba(239,68,68,0.12)';
        statusEl.style.color = '#ef4444';
        statusEl.style.border = '1px solid rgba(239,68,68,0.3)';
        statusEl.innerHTML = '❌ Connection failed: ' + (err.message || 'Invalid API Key');
      }
    }

    // Shared call to whichever AI provider is configured for single-document JSON extraction.
    async function callClaudeForDoc(base64, mediaType, isPdf, prompt, kind) {
      const provider = ['gemini', 'ocrspace', 'mistral'].includes(STATE.settings.aiProvider) ? STATE.settings.aiProvider : 'claude';
      if (provider === 'gemini') return callGeminiForDoc(base64, mediaType, isPdf, prompt);
      if (provider === 'mistral') return callMistralForDoc(base64, mediaType, isPdf, prompt);
      if (provider === 'ocrspace') return callOcrSpaceForDoc(base64, mediaType, isPdf, kind || 'rc');
      return callAnthropicForDoc(base64, mediaType, isPdf, prompt);
    }
    async function callAnthropicForDoc(base64, mediaType, isPdf, prompt) {
      const contentBlock = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      const headers = { 'Content-Type': 'application/json' };
      const key = (STATE.settings.aiApiKey || '').trim();
      if (key) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
        })
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error('Claude API error ' + resp.status + (errText ? ': ' + errText.slice(0, 200) : ''));
      }
      const data = await resp.json();
      const textBlock = (data.content || []).find(b => b.type === 'text');
      if (!textBlock || !textBlock.text) throw new Error('No response text from AI');
      return safeParseJsonFromAi(textBlock.text);
    }
    async function callGeminiForDoc(base64, mediaType, isPdf, prompt) {
      const key = (STATE.settings.aiGeminiKey || '').trim();
      if (!key) throw new Error('No Google AI Studio API key set — add one in Settings → AI RC Extraction.');
      const model = (STATE.settings.aiGeminiModel || '').trim() || 'gemini-2.5-flash';
      const mime = isPdf ? 'application/pdf' : (mediaType || 'image/jpeg');
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error('Gemini API error ' + resp.status + (errText ? ': ' + errText.slice(0, 200) : ''));
      }
      const data = await resp.json();
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.map(p => p.text || '').join('').trim();
      if (!text) throw new Error('No response text from Gemini');
      return safeParseJsonFromAi(text);
    }
    async function callMistralForDoc(base64, mediaType, isPdf, prompt) {
      const key = (STATE.settings.aiMistralKey || '').trim();
      if (!key) throw new Error('No Mistral AI API key set — add one in Settings → AI RC Extraction.');
      let model = (STATE.settings.aiMistralModel || '').trim();
      if (!model || model === 'mistral-small-latest' || model === 'mistral-tiny' || model === 'mistral-medium') {
        model = 'pixtral-12b-2409';
      }
      console.log('[MISTRAL-CLIENT] 🚀 Dispatching extraction request to /api/ai/mistral-extract', { model, isPdf, mediaType, promptLength: prompt.length });
      const resp = await fetch('/api/ai/mistral-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, model, prompt, base64, mediaType, isPdf })
      });
      let data = {};
      try { data = await resp.json(); } catch (e) { }
      if (!resp.ok) {
        console.error('[MISTRAL-CLIENT] ❌ Request failed with status', resp.status, data);
        throw new Error(data.error || ('Mistral API error ' + resp.status));
      }
      const content = data.content;
      if (!content) {
        console.error('[MISTRAL-CLIENT] ❌ Empty content payload in response', data);
        throw new Error('No response text from Mistral');
      }
      console.log('[MISTRAL-CLIENT] 📥 Response received, parsing JSON payload...');
      return safeParseJsonFromAi(content);
    }
    async function callOcrSpaceForDoc(base64, mediaType, isPdf, kind) {
      const key = (STATE.settings.aiOcrSpaceKey || '').trim();
      if (!key) throw new Error('No OCR.space API key set — add one in Settings → AI RC Extraction.');
      const filetype = isPdf ? 'PDF' : (mediaType === 'image/png' ? 'PNG' : (mediaType === 'image/webp' ? 'WEBP' : 'JPG'));
      const body = new URLSearchParams();
      body.set('apikey', key);
      body.set('base64Image', 'data:' + mediaType + ';base64,' + base64);
      body.set('filetype', filetype);
      body.set('OCREngine', '2');
      body.set('scale', 'true');
      body.set('isTable', 'true');
      const resp = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error('OCR.space error ' + resp.status + (errText ? ': ' + errText.slice(0, 200) : ''));
      }
      const data = await resp.json();
      if (data.IsErroredOnProcessing) {
        const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : (data.ErrorMessage || data.ErrorDetails || 'Unknown OCR.space error');
        throw new Error('OCR.space: ' + msg);
      }
      const results = data.ParsedResults || [];
      const text = results.map(r => r.ParsedText || '').join('\n').trim();
      if (!text) throw new Error('OCR.space returned no readable text for this document');
      return kind === 'address' ? extractAddressFieldsFromText(text) : extractRcFieldsFromText(text);
    }
    function extractRcFieldsFromText(text) {
      const out = { load_number: '', broker_name: '', broker_mc: '', broker_phone: '', broker_email: '', pickup_address: '', pickup_city: '', pickup_state: '', pickup_zip: '', delivery_address: '', delivery_city: '', delivery_state: '', delivery_zip: '', pickup_date: '', delivery_date: '', miles: null, rate: null, notes: '' };
      const loadM = text.match(/(?:load|ref(?:erence)?|order|po)\s*#?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{2,})/i);
      if (loadM) out.load_number = loadM[1];
      const mcM = text.match(/\b(?:mc|dot)\s*#?\s*[:\-]?\s*(\d{4,8})\b/i);
      if (mcM) out.broker_mc = mcM[1];
      const emailM = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
      if (emailM) out.broker_email = emailM[0];
      const phoneM = text.match(/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/);
      if (phoneM) out.broker_phone = phoneM[0];

      const dateMatches = [...text.matchAll(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g)]
        .map(m => normalizeOcrDate(m[1])).filter(Boolean);
      if (dateMatches[0]) out.pickup_date = dateMatches[0];
      if (dateMatches[1]) out.delivery_date = dateMatches[1];
      const cityStateMatches = [...text.matchAll(/([A-Za-z][A-Za-z .]{1,24}),\s*([A-Z]{2})\s*(\d{5})?\b/g)];
      if (cityStateMatches[0]) { out.pickup_city = cityStateMatches[0][1].trim(); out.pickup_state = cityStateMatches[0][2]; out.pickup_zip = cityStateMatches[0][3] || ''; }
      if (cityStateMatches[1]) { out.delivery_city = cityStateMatches[1][1].trim(); out.delivery_state = cityStateMatches[1][2]; out.delivery_zip = cityStateMatches[1][3] || ''; out.dropoff_city = out.delivery_city; out.dropoff_state = out.delivery_state; }
      out.miles = extractMilesFromText(text);
      const rateM = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
      if (rateM) out.rate = parseFloat(rateM[1].replace(/,/g, ''));
      return out;
    }
    function extractMilesFromText(text) {
      const labelFirst = text.match(/\b(?:total\s+|trip\s+|loaded\s+|billing\s+|est\.?\s+|estimated\s+)?(?:miles?|mileage|distance|dist)\b\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
      if (labelFirst) return parseFloat(labelFirst[1].replace(/,/g, ''));
      const numFirst = text.match(/([\d,]+(?:\.\d+)?)\s*(?:total\s*)?mi(?:les)?\.?\b/i);
      if (numFirst) return parseFloat(numFirst[1].replace(/,/g, ''));
      return null;
    }
    function extractAddressFieldsFromText(text) {
      const m = text.match(/([A-Za-z0-9 .]{3,40}),?\s*([A-Za-z][A-Za-z .]{1,24}),\s*([A-Z]{2})\s*(\d{5})?\b/);
      if (m) {
        return { street: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] || '' };
      }
      const m2 = text.match(/([A-Za-z][A-Za-z .]{1,24}),\s*([A-Z]{2})\s*(\d{5})?\b/);
      return { street: '', city: m2 ? m2[1].trim() : '', state: m2 ? m2[2] : '', zip: m2 ? m2[3] || '' : '' };
    }
    function normalizeOcrDate(s) {
      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) return '';
      let [, a, b, y] = m;
      if (y.length === 2) y = (parseInt(y, 10) < 70 ? '20' : '19') + y;
      return y + '-' + a.padStart(2, '0') + '-' + b.padStart(2, '0');
    }
    function resetLoadForm() {
      document.getElementById('load-form').reset();
      lastMCAutoFilledName = '';
      const mcHintEl = document.getElementById('f-brokermc-hint');
      if (mcHintEl) mcHintEl.textContent = '';
      setRcAiStatus(null);
      onRcPicked(document.getElementById('f-rc'));
      document.getElementById('f-systemdate').value = getTodayIsoString();
      document.getElementById('f-feepct').value = STATE.settings.defaultFeePct || 10;
      const dpDefEl = document.getElementById('f-driverpaypct'); if (dpDefEl) dpDefEl.value = defaultDriverPayPct();
      document.getElementById('f-revenue').textContent = '$0.00';
      document.getElementById('f-rpm').textContent = '$0.00 / mi';
      const dpZero = document.getElementById('f-driverpay'); if (dpZero) dpZero.textContent = '$0.00';
      const cmZero = document.getElementById('f-companymargin'); if (cmZero) cmZero.textContent = '$0.00';
      document.getElementById('f-deliverydate').min = '';
      const milesEl = document.getElementById('f-miles'); if (milesEl) delete milesEl.dataset.auto;
      setMilesStatus(null);
      const hint = document.getElementById('f-datehint'); if (hint) hint.style.display = 'none';
      const gmailHint = document.getElementById('f-gmailthread-hint'); if (gmailHint) gmailHint.textContent = '';
      populateDispatcherField();
      showLoadStep(1);
    }
    // STEP 1 -> STEP 2: just needs a broker and an attached RC. Whatever AI managed to
    // pull off the RC (miles, rate, dates, load #, pickup/drop-off) is already sitting in
    // the (currently hidden) step-2 fields — this just reveals them for the dispatcher to check.
    function goToLoadStep2() {
      const brokerNameEl = document.getElementById('f-broker');
      const brokerName = brokerNameEl.value.trim();
      if (!brokerName) { toast('Enter a broker', 'Type the broker name this load is with before continuing.'); brokerNameEl.focus(); return; }
      const rcInput = document.getElementById('f-rc');
      if (!rcInput.files || !rcInput.files.length) { toast('Attach the RC', 'A load can\'t be booked without the Rate Confirmation.'); return; }
      const recap = document.getElementById('step2-recap');
      recap.innerHTML = '<span><b>' + escapeAttr(brokerName) + '</b> · RC: ' + rcInput.files[0].name + '</span><button type="button" onclick="backToLoadStep1()">Change</button>';
      document.getElementById('f-systemdate').value = document.getElementById('f-systemdate').value || new Date().toISOString().slice(0, 10);
      showLoadStep(2);
    }
    function saveAddLoadDraft() {
      if (typeof SessionManager === 'undefined') return;
      const getVal = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const draft = {
        broker: getVal('f-broker'),
        brokermc: getVal('f-brokermc'),
        loadnumber: getVal('f-loadnumber'),
        pickup: getVal('f-pickup'),
        dropoff: getVal('f-dropoff'),
        pickupdate: getVal('f-pickupdate'),
        deliverydate: getVal('f-deliverydate'),
        rate: getVal('f-rate'),
        miles: getVal('f-miles'),
        notes: getVal('f-notes'),
        driverId: getVal('f-driver'),
        dispatcherId: getVal('f-dispatcher'),
      };
      SessionManager.saveFormDraft('add_load', draft);
    }

    function restoreAddLoadDraft() {
      if (typeof SessionManager === 'undefined') return;
      const draft = SessionManager.loadFormDraft('add_load');
      if (!draft) return;
      const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== '') el.value = v; };
      setVal('f-broker', draft.broker);
      setVal('f-brokermc', draft.brokermc);
      setVal('f-loadnumber', draft.loadnumber);
      setVal('f-pickup', draft.pickup);
      setVal('f-dropoff', draft.dropoff);
      setVal('f-pickupdate', draft.pickupdate);
      setVal('f-deliverydate', draft.deliverydate);
      setVal('f-rate', draft.rate);
      setVal('f-miles', draft.miles);
      setVal('f-notes', draft.notes);
      setVal('f-driver', draft.driverId);
      setVal('f-dispatcher', draft.dispatcherId);
    }

    function backToLoadStep1() { showLoadStep(1); }
    function showLoadStep(n) {
      document.getElementById('load-step1').style.display = n === 1 ? 'block' : 'none';
      document.getElementById('load-step2').style.display = n === 2 ? 'block' : 'none';
      if (n === 1) restoreAddLoadDraft();
    }

    document.addEventListener('input', e => {
      if (e.target && e.target.id && e.target.id.startsWith('f-')) {
        saveAddLoadDraft();
      }
    });
    document.addEventListener('change', e => {
      if (e.target && e.target.id && e.target.id.startsWith('f-')) {
        saveAddLoadDraft();
      }
    });


    async function submitLoadForm(e) {
      e.preventDefault();
      if (STATE.role === 'viewonly') { toast('View only', 'You cannot create loads.'); return false; }
      // A load is only booked once the Rate Confirmation is shared — no RC, no booking.
      const rcInput = document.getElementById('f-rc');
      if (!rcInput || !rcInput.files || !rcInput.files.length) {
        toast('Rate Confirmation required', 'Attach the RC — a load cannot be booked until the RC is shared.');
        return false;
      }
      if (!validateLoadDates()) { toast("Check your dates", "Delivery date can't be before the pickup date."); return false; }
      const brokerName = document.getElementById('f-broker').value.trim();
      const brokerMc = document.getElementById('f-brokermc').value.trim();
      const broker = upsertBrokerByName(brokerName, brokerMc);
      const driver = STATE.drivers.find(d => d.id === document.getElementById('f-driver').value);
      const dispatcherId = document.getElementById('f-dispatcher').value;
      const dispatcher = STATE.role === 'dispatcher'
        ? { id: STATE.currentDispatcherId, name: STATE.currentUser ? STATE.currentUser.name : '' }
        : STATE.dispatchers.find(x => x.id === dispatcherId);
      if (!dispatcher || !dispatcher.id) { toast('Dispatcher required', 'Pick which dispatcher this load belongs to.'); return false; }
      const rate = parseFloat(document.getElementById('f-rate').value) || 0;
      const fee = parseFloat(document.getElementById('f-feepct').value) || 0;
      const miles = parseFloat(document.getElementById('f-miles').value) || 0;
      const load = {
        id: uid('ld'),
        loadNumber: document.getElementById('f-loadnumber').value.trim(),
        systemDate: document.getElementById('f-systemdate').value || new Date().toISOString().slice(0, 10),
        dispatcherId: dispatcher.id, dispatcherName: dispatcher.name,
        brokerId: broker ? broker.id : null, brokerName: broker ? broker.name : '', brokerMC: broker ? broker.mc : '',
        brokerEmail: broker ? broker.email : '',
        driverId: driver ? driver.id : null, driverName: driver ? driver.name : '', truck: driver ? driver.truck : '',
        pickup: document.getElementById('f-pickup').value.trim(),
        dropoff: document.getElementById('f-dropoff').value.trim(),
        pickupDate: document.getElementById('f-pickupdate').value,
        deliveryDate: document.getElementById('f-deliverydate').value,
        miles: miles, brokerRate: rate, ratePerMile: miles > 0 ? Math.round(rate / miles * 100) / 100 : 0,
        feePct: fee, dispatchRevenue: Math.round(rate * fee / 100 * 100) / 100,
        // Lease driver pay snapshot — taken at booking so later percentage changes don't
        // rewrite what a driver was already owed on loads they've already run.
        driverPayPct: driverPayPctInput(driver),
        driverPay: Math.round(rate * driverPayPctInput(driver) / 100 * 100) / 100,
        driverDeduction: 0, driverPayNote: '', driverPaid: false, driverPaidDate: null,
        notes: document.getElementById('f-notes').value,
        docs: { RC: null, BOL: null, POD: null, PhotosPU: [], PhotosDO: [], Extra: [] },
        payment: null,
        // Hidden Gmail-linking fields — carried on the load for the email automation. BOL/POD
        // replies always use gmail_thread_id + gmail_original_subject + gmail_thread_cc (never
        // a freshly generated subject or a solo "to" recipient) so Reply All matches the
        // original broker conversation exactly.
        gmail_thread_id: document.getElementById('f-gmailthread-id').value.trim() || null,
        gmail_message_id: null,
        gmail_original_subject: null,
        gmail_thread_cc: [],
        broker_email: broker ? (broker.email || '') : '',
        email_subject: null,
      };
      // Attach the RC file itself so the load opens at Booked, with the RC already on file.
      const rcFile = rcInput.files[0];
      let rcData = null;
      if (rcFile.size > 1500000) {
        toast('RC is large', rcFile.name + ' is over 1.5MB — the filename is recorded but not the file content.');
      } else {
        try { rcData = await readFileAsDataURL(rcFile); } catch (err) { /* filename still recorded */ }
      }
      load.docs.RC = { name: rcFile.name, data: rcData };
      load.status = computeStatus(load);
      STATE.loads.unshift(load);
      pushNotification('New load booked — ' + load.loadNumber, (broker ? broker.name + ' · ' : '') + (load.pickup || '') + ' → ' + (load.dropoff || ''));
      syncLoadToSheet(load);
      persist();
      // Auto-upload RC to Google Drive on load creation
      if (load.docs.RC && load.docs.RC.data) {
        autoDriveUploadDoc(load, 'RC', load.docs.RC).catch(() => { });
      }
      if (typeof SessionManager !== 'undefined') {
        SessionManager.clearFormDraft('add_load');
      }
      toast('Load booked', load.loadNumber + ' — RC on file, status Booked', true);
      resetLoadForm();
      switchView('loadboard');
      return false;
    }


    /* ================= DOCUMENT REVIEW CENTER ================= */
    let _docReviewTab = 'pending';

    function setDocReviewTab(tab) {
      _docReviewTab = tab;
      ['pending', 'approved', 'rejected'].forEach(t => {
        const btn = document.getElementById(`docreview-tab-${t}`);
        if (!btn) return;
        if (t === tab) {
          btn.style.background = t === 'pending' ? '#f59e0b' : t === 'approved' ? '#16a34a' : '#dc2626';
          btn.style.color = '#fff';
        } else {
          btn.style.background = '';
          btn.style.color = '';
        }
      });
      renderDocReview();
    }

    function renderDocReview() {
      const body = document.getElementById('docreview-body');
      const empty = document.getElementById('docreview-empty');
      if (!body) return;

      const loads = STATE.loads || [];
      const docTypes = ['BOL', 'POD', 'RC'];
      const rows = [];

      loads.forEach(load => {
        const docs = load.docs || load.documents || {};
        docTypes.forEach(docType => {
          const doc = docs[docType];
          if (!doc || (!doc.name && !doc.fileName)) return;

          const docStatus = doc.status || 'Pending Verification';
          const statusNorm = docStatus.toLowerCase();
          let matchesTab = false;
          if (_docReviewTab === 'pending') matchesTab = statusNorm.includes('pending');
          else if (_docReviewTab === 'approved') matchesTab = statusNorm === 'approved';
          else if (_docReviewTab === 'rejected') matchesTab = statusNorm === 'rejected';
          if (!matchesTab) return;

          const uploadedAt = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : '—';
          const statusColor = statusNorm.includes('pending') ? '#f59e0b' : statusNorm === 'approved' ? '#16a34a' : '#dc2626';
          const statusLabel = doc.status || 'Pending Verification';

          let actionHtml = '';
          if (_docReviewTab === 'pending') {
            actionHtml = `
              <div style="display:flex;gap:8px;justify-content:center;">
                <button class="btn btn-sm" style="background:#16a34a;color:#fff;font-size:12px;font-weight:700;padding:6px 12px;border-radius:8px;" onclick="reviewDocument('${escapeAttr(load.id)}','${docType}','approve','')">Approve</button>
                <button class="btn btn-sm" style="background:#dc2626;color:#fff;font-size:12px;font-weight:700;padding:6px 12px;border-radius:8px;" onclick="openDocRejectModal('${escapeAttr(load.id)}','${docType}')">Reject</button>
              </div>`;
          } else if (_docReviewTab === 'rejected') {
            actionHtml = `
              <div style="font-size:11px;color:#dc2626;font-style:italic;max-width:200px;">${escapeAttr(doc.rejectionReason || 'No reason provided')}</div>`;
          } else {
            actionHtml = `<span style="color:#16a34a;font-size:13px;">✓ Approved</span>`;
          }

          rows.push(`
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:12px;font-weight:700;color:#0f172a;">${escapeAttr(docType)}</td>
              <td style="padding:12px;color:#475569;">${escapeAttr(load.driverName || '—')}</td>
              <td style="padding:12px;color:#475569;font-weight:600;">#${escapeAttr(load.loadNumber || load.id)}</td>
              <td style="padding:12px;color:#64748b;font-size:12px;">${uploadedAt}</td>
              <td style="padding:12px;"><span style="background:${statusColor}20;color:${statusColor};padding:3px 8px;border-radius:6px;font-size:12px;font-weight:700;">${escapeAttr(statusLabel)}</span></td>
              <td style="padding:12px;">${actionHtml}</td>
            </tr>`);
        });
      });

      // Update pending badge count
      let pendingCount = 0;
      loads.forEach(load => {
        const docs = load.docs || load.documents || {};
        ['BOL','POD','RC'].forEach(dt => {
          const d = docs[dt];
          if (d && (d.name || d.fileName)) {
            const st = (d.status || 'Pending').toLowerCase();
            if (st.includes('pending')) pendingCount++;
          }
        });
      });
      const badge = document.getElementById('doc-review-badge');
      if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline' : 'none';
      }

      if (rows.length === 0) {
        body.innerHTML = '';
        if (empty) empty.style.display = '';
      } else {
        body.innerHTML = rows.join('');
        if (empty) empty.style.display = 'none';
      }
    }

    async function reviewDocument(loadId, docKey, action, rejectionReason) {
      try {
        const resp = await fetch('/api/documents/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loadId, docKey, action, rejectionReason }),
        });
        const data = resp.ok ? await resp.json() : null;
        if (data && data.ok) {
          // Optimistically update the local STATE
          const load = (STATE.loads || []).find(l => l.id === loadId);
          if (load) {
            const docs = load.docs || load.documents || {};
            if (docs[docKey]) {
              docs[docKey].status = action === 'approve' ? 'Approved' : 'Rejected';
              docs[docKey].rejectionReason = rejectionReason || null;
            }
          }
          renderDocReview();
          toast(
            action === 'approve' ? `${docKey} Approved` : `${docKey} Rejected`,
            action === 'approve' ? 'Document sent to Google Drive.' : 'Driver has been notified.',
            action === 'approve'
          );
        } else {
          toast('Review Failed', 'Could not update document status. Please try again.', false);
        }
      } catch (e) {
        toast('Network Error', 'Failed to reach server. Please try again.', false);
      }
    }

    function openDocRejectModal(loadId, docKey) {
      const reason = prompt(`Enter rejection reason for ${docKey}:`);
      if (reason === null) return;
      reviewDocument(loadId, docKey, 'reject', reason || 'No reason provided');
    }

    /* ================= LOAD BOARD ================= */

    const LB_TABS = [
      'All Loads',
      'Booked',
      'Accepted',
      'At Pickup',
      'Loaded',
      'In Transit',
      'At Delivery',
      'Delivered',
      'POD Uploaded',
      'Paid',
      'Cancelled'
    ];
    function loadBoardTabs() {
      return LB_TABS;
    }
    function populateLoadBoardFilters() {
      const dispSelect = document.getElementById('loadboard-dispatcher-filter');
      if (dispSelect) {
        const curVal = dispSelect.value;
        dispSelect.innerHTML = '<option value="">All Dispatchers</option>' +
          (STATE.dispatchers || []).map(d => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`).join('');
        if (curVal) dispSelect.value = curVal;
      }
      const drvSelect = document.getElementById('loadboard-driver-filter');
      if (drvSelect) {
        const curVal = drvSelect.value;
        drvSelect.innerHTML = '<option value="">All Drivers</option>' +
          (STATE.drivers || []).map(d => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`).join('');
        if (curVal) drvSelect.value = curVal;
      }
    }

    function renderLoadBoardTabs() {
      const el = document.getElementById('loadboard-tabs');
      if (!el) return;
      if (typeof SessionManager !== 'undefined' && !STATE.loadFilter) {
        const saved = SessionManager.loadUiState();
        if (saved && saved.loadFilter) STATE.loadFilter = saved.loadFilter;
      }
      if (!STATE.loadFilter) STATE.loadFilter = 'All Loads';

      const allLoads = visibleLoads();
      const selDisp = document.getElementById('loadboard-dispatcher-filter') ? document.getElementById('loadboard-dispatcher-filter').value : '';
      const selDrv = document.getElementById('loadboard-driver-filter') ? document.getElementById('loadboard-driver-filter').value : '';
      const filteredByDropdowns = allLoads.filter(l => {
        if (selDisp && String(l.dispatcherId) !== String(selDisp)) return false;
        if (selDrv && String(l.driverId) !== String(selDrv)) return false;
        return true;
      });

      el.innerHTML = loadBoardTabs().map(t => {
        const count = filteredByDropdowns.filter(l => matchesFilter(l, t)).length;
        const isActive = (STATE.loadFilter === t);
        return `<button type="button" class="lb-filter-tab${isActive ? ' active' : ''}" onclick="setLoadFilter('${escapeAttr(t)}')" title="Filter by ${escapeAttr(t)}">
          <span>${escapeHtml(t)}</span>
          <span class="lb-filter-tab-badge">${count}</span>
        </button>`;
      }).join('');
    }

    function setLoadFilter(t) {
      STATE.loadFilter = t;
      if (typeof SessionManager !== 'undefined') {
        SessionManager.saveUiState({ loadFilter: t });
      }
      renderLoadBoard();
    }

    function matchesFilter(load, filter) {
      if (!filter || filter === 'All Loads') return true;
      const st  = String(load.status         || '').toLowerCase().trim();
      const fl  = String(filter              || '').toLowerCase().trim();
      const prog = String(load.driverProgress || '').toLowerCase().trim();

      if (fl === 'all loads') return true;

      if (fl === 'booked') {
        return st === 'booked' || st === 'pending rc' ||
               prog === 'assigned' || prog === 'booked';
      }

      if (fl === 'accepted') {
        return st === 'accepted' || st === 'pending rc' ||
               prog === 'accepted';
      }

      if (fl === 'at pickup') {
        return st === 'at pickup' || st === 'at_pickup' ||
               prog === 'at_pickup' || prog === 'at pickup';
      }

      if (fl === 'loaded') {
        return st === 'loaded' ||
               prog === 'loaded';
      }

      if (fl === 'in transit') {
        return st === 'in transit' || st === 'in_transit' ||
               prog === 'in_transit' || prog === 'in transit';
      }

      if (fl === 'at delivery') {
        return st === 'at delivery' || st === 'at_delivery' ||
               st === 'drop-off'    || st === 'drop off'    ||
               prog === 'at_delivery' || prog === 'at delivery' ||
               prog === 'drop_off'    || prog === 'drop-off';
      }

      if (fl === 'delivered') {
        return st === 'delivered' ||
               prog === 'delivered';
      }

      if (fl === 'pod uploaded') {
        return st === 'pod uploaded' || st === 'pod_uploaded' ||
               prog === 'pod_uploaded' || prog === 'pod uploaded' ||
               (load.docs && !!load.docs.POD);
      }

      if (fl === 'paid') {
        return st === 'paid' || st === 'paid_confirmed' || st === 'completed' ||
               prog === 'paid' || prog === 'paid_confirmed' || prog === 'completed' ||
               load.payment === 'Payment Received' || load.driverPaid === true;
      }

      if (fl === 'cancelled' || fl === 'canceled') {
        return st === 'cancelled' || st === 'canceled' ||
               prog === 'cancelled' || prog === 'canceled';
      }

      /* Fallback: direct string match */
      return st === fl || prog === fl;
    }

    function clearLoadBoardDateRange() {
      const from = document.getElementById('lb-date-from');
      const to = document.getElementById('lb-date-to');
      if (from) from.value = '';
      if (to) to.value = '';
      renderLoadBoard();
    }

    /* Correctly checks the chosen date field (System/Pickup/Delivery) against an inclusive from/to range. */
    function inDateRange(dateStr, from, to) {
      if (!from && !to) return true;
      if (!dateStr) return false;
      const d = new Date(dateStr + 'T00:00:00');
      if (from && d < new Date(from + 'T00:00:00')) return false;
      if (to && d > new Date(to + 'T23:59:59')) return false;
      return true;
    }

    function isLoadLockedFromDeletion(l) {
      if (!l) return false;
      const st = String(l.status || '').trim().toLowerCase();
      const cp = String(l.driverProgress || '').trim().toLowerCase();
      return (
        st === 'drop-off' || st === 'completed' || st === 'delivered' || st === 'pod uploaded' || st === 'invoiced' ||
        cp === 'completed' || cp === 'pod_uploaded' || cp === 'delivered' || cp === 'at_delivery' || cp === 'drop-off'
      );
    }

    function renderLoadBoard() {
      populateLoadBoardFilters();
      renderLoadBoardTabs();

      const q = (document.getElementById('loadboard-search') ? document.getElementById('loadboard-search').value : '').toLowerCase();
      const currentFilter = STATE.loadFilter || 'All Loads';
      const selDisp = document.getElementById('loadboard-dispatcher-filter') ? document.getElementById('loadboard-dispatcher-filter').value : '';
      const selDrv = document.getElementById('loadboard-driver-filter') ? document.getElementById('loadboard-driver-filter').value : '';

      const rows = visibleLoads().filter(l => {
        if (!matchesFilter(l, currentFilter)) return false;
        if (selDisp && String(l.dispatcherId) !== String(selDisp)) return false;
        if (selDrv && String(l.driverId) !== String(selDrv)) return false;
        if (!q) return true;
        return [l.loadNumber, l.driverName, l.pickup, l.dropoff, l.dispatcherName].join(' ').toLowerCase().includes(q);
      });

      const body = document.getElementById('loadboard-body');
      const emptyEl = document.getElementById('loadboard-empty');
      if (emptyEl) emptyEl.style.display = rows.length ? 'none' : 'block';
      const isAdmin = STATE.role === 'admin';

      if (body) {
        body.innerHTML = rows.map(l => {
          const lane = formatCityStateLane(l.pickup, l.dropoff);
          return `
        <tr onclick="openLoadModal('${l.id}')" style="cursor:pointer;">
          <td class="cell-mono cell-strong" style="padding:12px 16px;font-weight:700;color:#0f172a;">${escapeAttr(l.loadNumber)}</td>
          <td style="padding:12px 16px;font-weight:600;color:#334155;">${escapeAttr(l.driverName || '—')}</td>
          <td class="cell-dim" style="padding:12px 16px;color:#64748b;" title="${escapeAttr([l.pickup, l.dropoff].filter(Boolean).join(' → '))}">${escapeAttr(lane)}</td>
          <td class="cell-mono" style="padding:12px 16px;font-weight:700;color:#0f172a;">${money(l.brokerRate)}</td>
          ${isAdmin ? `<td class="cell-dim" data-role-view="admin" style="padding:12px 16px;color:#64748b;">${escapeAttr(l.dispatcherName || '—')}</td>` : ''}
          <td style="padding:12px 16px;">${placard(l.status, l)}</td>
          ${isAdmin ? `<td style="padding:12px 16px;text-align:right;" onclick="event.stopPropagation();">
            <button class="btn btn-sm btn-ghost" style="color:#ef4444;padding:4px 8px;border-radius:6px;cursor:pointer;" title="Delete Load" onclick="confirmDeleteLoad('${l.id}')">
              <svg style="width:15px;height:15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
            </button>
          </td>` : ''}
        </tr>
      `;
        }).join('') || `<tr><td colspan="${isAdmin ? 7 : 6}" class="cell-dim" style="text-align:center;padding:24px;color:#94a3b8;">No loads found for "${escapeHtml(currentFilter)}".</td></tr>`;
      }
    }

    function confirmDeleteLoad(id) {
      if (STATE.role !== 'admin') return toast('Admin Only', 'Only Administrators can delete loads.');
      const l = STATE.loads.find(x => String(x.id) === String(id));
      if (!l) return;

      const st = String(l.status || '').trim().toLowerCase();
      const prog = String(l.driverProgress || '').trim().toLowerCase();
      const isLoadedOrDelivered = st === 'loaded' || st === 'drop-off' || st === 'completed' || prog === 'loaded' || prog === 'in_transit' || prog === 'at_delivery' || prog === 'delivered';

      // Rule: Loaded or Drop-off (Delivered) loads can ONLY be deleted by Super Admin
      if (isLoadedOrDelivered && !STATE.isSuperAdmin) {
        toast('Super Admin Required', `⚠️ Load #${l.loadNumber || l.id} is ${st.toUpperCase()}. Standard Admins cannot delete active/delivered loads. Only Super Admin has this permission.`);
        alert(`Access Denied:\n\nLoad #${l.loadNumber || l.id} is currently in '${st.toUpperCase()}' stage.\n\nRegular Admins cannot delete Loaded or Drop-Off loads. Only the Super Admin account has permission to remove active or completed shipments.`);
        return;
      }

      const dspName = l.dispatcherName || (STATE.dispatchers.find(d => String(d.id) === String(l.dispatcherId)) || {}).name || 'Dispatcher';
      const drvName = l.driverName || (STATE.drivers.find(d => String(d.id) === String(l.driverId)) || {}).name || 'Driver';
      const actorName = STATE.isSuperAdmin ? 'Super Admin' : (STATE.currentUser ? STATE.currentUser.name : 'Admin');

      const promptMsg = isLoadedOrDelivered
        ? `⚠️ [SUPER ADMIN OVERRIDE]\n\nLoad #${l.loadNumber || l.id} is in '${st.toUpperCase()}' stage.\n\nAre you sure you want to permanently delete this load?\n\nImmediate deletion alerts will be sent to Admin, Dispatcher (${dspName}), and Driver (${drvName}).`
        : `Confirm deletion of Load #${l.loadNumber || l.id}?\n\nAlert notifications will be broadcast to Admin, Dispatcher (${dspName}), and Driver (${drvName}).`;

      const ok = confirm(promptMsg);
      if (!ok) return;

      // 1. Send broadcast notification to Admin & Dispatcher in the system
      pushNotification(
        `🚨 Load Deleted by ${actorName} — #${l.loadNumber || l.id}`,
        `${actorName} deleted ${isLoadedOrDelivered ? '(' + st.toUpperCase() + ') ' : ''}Load #${l.loadNumber || l.id} (${formatCityStateLane(l.pickup, l.dropoff)}). Assigned: ${dspName} / Driver: ${drvName}.`,
        { type: 'load' }
      );

      // 2. Send targeted notification to Assigned Driver
      pushNotification(
        `⚠️ Load #${l.loadNumber || l.id} Removed by ${actorName}`,
        `Load #${l.loadNumber || l.id} was deleted from the dispatch board by ${actorName}.`,
        { type: 'driver', targetId: l.driverId }
      );

      // 3. Record in Driver Portal local notification store for the mobile driver view
      if (l.driverId) {
        const drvKey = `dp_notifs_${l.driverId}`;
        try {
          const drvNotifs = JSON.parse(localStorage.getItem(drvKey) || '[]');
          drvNotifs.unshift({
            id: uid('dpn'),
            title: `Load #${l.loadNumber || l.id} Deleted by ${actorName}`,
            body: `Load #${l.loadNumber || l.id} (${formatCityStateLane(l.pickup, l.dropoff)}) has been deleted from the schedule by ${actorName}.`,
            at: new Date().toISOString(),
            read: false
          });
          localStorage.setItem(drvKey, JSON.stringify(drvNotifs.slice(0, 30)));
        } catch (e) {}
      }

      // Delete load permanently across state
      STATE.loads = STATE.loads.filter(x => String(x.id) !== String(id));
      persist();
      renderLoadBoard();
      renderDashboard();
      toast('Load Deleted & Notified', `Load #${l.loadNumber || l.id} deleted by ${actorName}. Notifications broadcast to Admin, Dispatcher & Driver.`, true);
    }

    function deleteLoad(id) {
      confirmDeleteLoad(id);
    }
    function renderModalTimelineHtml(l) {
      const steps = [
        { key: 'ASSIGNED', label: 'Assigned' },
        { key: 'ACCEPTED', label: 'Accepted' },
        { key: 'AT_PICKUP', label: 'At Pickup' },
        { key: 'LOADED', label: 'Loaded' },
        { key: 'IN_TRANSIT', label: 'In Transit' },
        { key: 'AT_DELIVERY', label: 'At Delivery' },
        { key: 'DELIVERED', label: 'Delivered' },
        { key: 'POD_UPLOADED', label: 'POD Uploaded' },
        { key: 'PAID', label: 'Paid' },
        { key: 'PAID_CONFIRMED', label: 'Confirmed' }
      ];

      const currentKey = (l.driverProgress || 'ASSIGNED').toUpperCase();
      const paymentKey = (l.paymentStatus || (l.driverPaid ? 'PAID_CONFIRMED' : '')).toUpperCase();

      let activeIdx = steps.findIndex(s => s.key === currentKey);
      if (paymentKey === 'PAID_CONFIRMED') activeIdx = steps.length - 1;
      else if (l.driverPaid) activeIdx = Math.max(activeIdx, 8);
      if (activeIdx === -1) activeIdx = 0;

      let h = '<div style="margin-bottom:14px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;">';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text-dim);">🚚 Load Progress Timeline</div>';
      h += '<div style="display:flex; overflow-x:auto; gap:6px; padding:4px 0; scrollbar-width:thin;">';
      steps.forEach((step, idx) => {
        const isDone = idx <= activeIdx;
        const isCurrent = idx === activeIdx;
        const bg = isCurrent ? '#2563eb' : (isDone ? '#10b981' : 'var(--border-soft)');
        const color = isDone ? '#fff' : 'var(--text-dim)';
        h += `<div style="flex:0 0 auto; text-align:center; padding:5px 9px; background:${bg}; color:${color}; border-radius:16px; font-size:10.5px; font-weight:700;">
      ${isDone ? '✓ ' : ''}${step.label}
    </div>`;
      });
      h += '</div></div>';
      return h;
    }

    function renderModalTrackingSection(l) {
      const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.dropoff || '')}&waypoints=${encodeURIComponent(l.pickup || '')}`;
      const puUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.pickup || '')}`;
      const doUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.dropoff || '')}`;

      return `<div style="margin-bottom:14px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:12px;font-weight:700;color:var(--text);">📍 Real-Time Tracking & Google Maps Navigation</div>
      <div style="display:flex;gap:6px;">
        <a class="btn btn-sm" target="_blank" href="${routeUrl}">🗺 Open Route</a>
        <a class="btn btn-sm btn-ghost" target="_blank" href="${puUrl}">📍 Pickup</a>
        <a class="btn btn-sm btn-ghost" target="_blank" href="${doUrl}">🏁 Delivery</a>
      </div>
    </div>
    <div class="hint" style="font-size:11.5px;">Click any button to open full turn-by-turn navigation in Google Maps.</div>
  </div>`;
    }

    function openLoadModal(id) {
      const l = STATE.loads.find(x => x.id === id);
      if (!l) return;
      if (!canAccessLoad(l)) return toast('Not your load', 'You can only view loads assigned to you.');
      if (typeof SessionManager !== 'undefined') {
        SessionManager.saveUiState({ activeModalId: 'modal-load', modalContextId: id });
      }
      document.getElementById('load-modal-title').textContent = l.loadNumber + ' — ' + l.pickup + ' → ' + l.dropoff;

      const nextHint = l.status === 'Pending RC' ? 'Not booked yet — upload the Rate Confirmation to book this load.'
        : l.status === 'Booked' ? 'Upload the BOL to move this to Loaded.'
          : l.status === 'Loaded' ? 'Upload the POD to mark this Drop-off.'
            : 'Delivered — the payment stage below is handled by Admin.';
      const pay = paymentOf(l);
      const paymentBlock = !pay ? '' : `
    <div class="hr"></div>
    <div class="section-head" style="margin-bottom:8px;">
      <h2>Payment <span class="cell-dim" style="font-weight:400;font-size:11.5px;">· Admin only</span></h2>
    </div>
    <div class="form-grid" style="margin-bottom:0;">
      <div class="field">
        <label>Current Stage</label>
        <div style="padding-top:4px;">${placard(pay)}</div>
      </div>
      <div class="field">
        <label>Update Stage</label>
        ${STATE.role === 'admin'
          ? '<select onchange="setPayment(\'' + l.id + '\', this.value)">' + PAYMENT_STAGES.map(p => '<option value="' + p + '" ' + (p === pay ? 'selected' : '') + '>' + p + '</option>').join('') + '</select>'
          : '<input value="Only Admin can change this" readonly>'}
        <div class="hint">Payment stages only open once the POD is on file and the load has dropped off.</div>
      </div>
    </div>`;
      const driverPayBlock = STATE.role !== 'admin' ? '' : `
    <div class="hr"></div>
    <div class="section-head" style="margin-bottom:8px;">
      <h2>Driver Pay — Lease</h2>
      <span class="placard pl-gray"><span class="dot"></span>Admin only</span>
    </div>
    <div class="form-grid" style="margin-bottom:0;">
      <div class="field"><label>Driver Pay %</label><input value="${(l.driverPayPct != null ? l.driverPayPct : driverPayPctFor(l.driverId))}%" readonly></div>
      <div class="field"><label>Driver Pay (of ${money(l.brokerRate)} gross)</label><input value="${money(driverPayOf(l))}" readonly></div>
      <div class="field">
        <label>Deduction</label>
        <input type="number" min="0" step="0.01" value="${Number(l.driverDeduction || 0)}" onchange="setDriverDeduction('${l.id}', this.value)">
        <div class="hint">Advances, escrow, fuel, damage — subtracted from this load's settlement.</div>
      </div>
      <div class="field"><label>Net Due to Driver</label><input value="${money(driverNetOf(l))}" readonly></div>
      <div class="field"><label>Company Margin</label><input value="${money(companyMarginOf(l))}" readonly></div>
      <div class="field">
        <label>Settlement</label>
        <div style="display:flex;align-items:center;gap:10px;padding-top:4px;flex-wrap:wrap;">
          ${paymentStatusPlacard(l)}
          <button class="btn btn-sm" onclick="toggleDriverPaid('${l.id}')">${(l.paymentStatus === 'UNPAID' || !l.driverPaid) ? 'Mark Paid' : 'Undo / Mark Unpaid'}</button>
        </div>
        ${l.markedPaidBy ? `<div class="hint" style="margin-top:4px;">Marked paid by ${escapeAttr(l.markedPaidBy)}${l.markedPaidAt ? ' on ' + fmtDateTime(l.markedPaidAt) : ''}</div>` : ''}
        ${l.confirmedAt ? `<div class="hint" style="color:var(--green,#22c55e);margin-top:2px;">Confirmed by driver on ${fmtDateTime(l.confirmedAt)}</div>` : ''}
        ${l.disputedAt ? `<div class="hint" style="color:var(--red,#ef4444);margin-top:2px;">Disputed by driver on ${fmtDateTime(l.disputedAt)}</div>` : ''}
      </div>
      <div class="field span-2">
        <label>Settlement Note</label>
        <input type="text" value="${escapeAttr(l.driverPayNote || '')}" placeholder="e.g. paid with week 32 settlement, check #1042" onchange="setDriverPayNote('${l.id}', this.value)">
      </div>
    </div>`;
      document.getElementById('load-modal-body').innerHTML = `
    ${renderModalTimelineHtml(l)}
    ${renderModalTrackingSection(l)}
    <div class="form-grid" style="margin-bottom:6px;">
      <div class="field"><label>Status</label><div style="padding-top:4px;">${placard(l.status)} <span class="hint" style="display:block;margin-top:5px;">${nextHint}</span></div></div>
      <div class="field"><label>Dispatcher</label><input value="${l.dispatcherName || '—'}" readonly></div>
      <div class="field"><label>Driver</label><input value="${l.driverName}" readonly></div>
      <div class="field"><label>Driver Availability</label><div style="padding-top:4px;">${l.driverId ? availabilityBadge(l.driverId) : '—'}</div></div>
      <div class="field"><label>Broker</label><input value="${l.brokerName} (${l.brokerMC || '—'})" readonly></div>
      <div class="field"><label>Broker Contact Email</label><input value="${l.brokerEmail || '—'}" readonly></div>
      <div class="field"><label>Miles / Rate per Mile</label><input value="${l.miles || 0} mi  ·  $${(Number(l.ratePerMile) || 0).toFixed(2)}/mi" readonly></div>
      <div class="field"><label>Rate / Dispatch Rev.</label><input value="${money(l.brokerRate)} / ${money(l.dispatchRevenue)}" readonly></div>
      <div class="field"><label>Pickup</label><input value="${l.pickup} — ${fmtDate(l.pickupDate)}" readonly></div>
      <div class="field"><label>Drop-off</label><input value="${l.dropoff} — ${fmtDate(l.deliveryDate)}" readonly></div>
      <div class="field span-2"><label>Notes</label><textarea readonly>${l.notes || ''}</textarea></div>
    </div>
    <div class="hr"></div>
    <div class="section-head" style="margin-bottom:8px;"><h2>Documents</h2></div>
    ${renderDocSlots(l)}
    ${paymentBlock}
    ${driverPayBlock}
    <div class="hr"></div>
    <div class="section-head" style="margin-bottom:8px;">
      <h2>Send Documents</h2>
      <div class="toolbar-right">
        <label style="font-size:11px;color:var(--text-faint);">Send with</label>
        <select id="send-provider-select" style="width:auto;" onchange="saveSettingsField('mailProvider', this.value)">
          <option value="default" ${(STATE.settings.mailProvider || 'default') === 'default' ? 'selected' : ''}>Default Mail App</option>
          <option value="gmail" ${STATE.settings.mailProvider === 'gmail' ? 'selected' : ''}>Gmail</option>
          <option value="outlook" ${STATE.settings.mailProvider === 'outlook' ? 'selected' : ''}>Outlook</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-sm" onclick="sendDoc('${l.id}','RC','driver')">Send RC to Driver</button>
      <button class="btn btn-sm" onclick="sendDoc('${l.id}','BOL','broker')" title="Reply All in the saved Gmail thread — attaches BOL + loading pictures">Reply All · Send BOL to Broker</button>
      <button class="btn btn-sm" onclick="sendDoc('${l.id}','POD','broker')" title="Reply All in the saved Gmail thread — attaches POD + unloading pictures">Reply All · Send POD to Broker</button>
      ${(l.docs.RC && l.docs.BOL && l.docs.POD)
          ? `<button class="btn btn-sm" onclick="savePackageToDrive('${l.id}')" title="Zips RC, BOL, POD, and all photos, then saves to Google Drive">Save Package to Drive</button>`
          : `<button class="btn btn-sm" disabled title="Enabled once RC, BOL and POD are all on file">Save Package to Drive</button>`}
    </div>
    <div class="hint" style="margin-top:8px;">BOL/POD always send as <b>Reply All</b> inside the load's saved Gmail thread — same subject, same To/Cc as the original broker email, documents and pickup/drop-off photos attached, sent from <b>your own</b> connected Google account (see My Account) rather than a shared inbox. If no Gmail thread is linked, the send is blocked rather than starting a new conversation. "Save Package to Drive" unlocks once RC, BOL and POD are all on file, and zips straight to your connected Drive as <span class="mono">Load# · Lane · Driver first name · Dispatcher first name</span> — skipped automatically if that file's already there.</div>
    ${renderDrivePackageStatus(l)}
    <div class="hr"></div>
    <div class="section-head" style="margin-bottom:8px;">
      <h2>Google Drive</h2>
    </div>
    <div id="drive-uploads-section-${l.id}"><div class="hint">Loading Drive records…</div></div>
    ${STATE.role === 'admin' ? `
    <div class="hr"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;">
      <span class="hint" style="color:var(--text-faint);">Admin Management</span>
      <button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border-color:#fca5a5;" onclick="closeModal('modal-load');confirmDeleteLoad('${l.id}')">
        <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
        Delete Load
      </button>
    </div>` : ''}
  `;
      openModal('modal-load');
      // Async-populate the Drive section after modal is open (non-blocking)
      fetchAndRenderDriveSection(l.id);
    }

    const PHOTO_KEYS = ['PhotosPU', 'PhotosDO'];
    const ARRAY_DOC_KEYS = ['PhotosPU', 'PhotosDO', 'Extra'];
    function docCap(key) { return key === 'Extra' ? 6 : 3; }
    function renderDocSlots(l) {
      const slots = [
        { key: 'RC', label: 'Rate Confirmation', hint: 'Required — books the load' },
        { key: 'BOL', label: 'Bill of Lading', hint: 'Moves the load to Loaded — checked against pickup address' },
        { key: 'POD', label: 'Proof of Delivery', hint: 'Moves the load to Drop-off — checked against drop-off address' },
        { key: 'PhotosPU', label: 'Pickup Photos', hint: '1–3 photos of the freight at pickup' },
        { key: 'PhotosDO', label: 'Drop-off Photos', hint: '1–3 photos of the freight at drop-off' },
        { key: 'Extra', label: 'Extra Documents', hint: 'Any other paperwork for this load — lumper receipts, detention, accessorials, etc.' },
      ];
      const anyDocs = l.docs.RC || l.docs.BOL || l.docs.POD || (l.docs.PhotosPU && l.docs.PhotosPU.length) || (l.docs.PhotosDO && l.docs.PhotosDO.length) || (l.docs.Extra && l.docs.Extra.length);
      return '<div class="doc-grid">' + slots.map(s => {
        const isArray = ARRAY_DOC_KEYS.includes(s.key);
        const isPhoto = PHOTO_KEYS.includes(s.key);
        const arr = isArray ? (l.docs[s.key] || []) : null;
        const has = isArray ? arr.length : l.docs[s.key];
        const cap = docCap(s.key);
        const atCap = isArray && arr.length >= cap;
        const fileLabel = isArray ? (has ? arr.length + ' of ' + cap + ' file(s)' : '') : (has ? has.name : '');
        return `<label class="doc-slot ${has ? 'filled' : ''} ${atCap ? 'atcap' : ''}">
      <input type="file" ${isArray ? 'multiple' : ''} ${isPhoto ? 'accept="image/*"' : ''} ${STATE.role === 'viewonly' || atCap ? 'disabled' : ''} onchange="handleDocUpload('${l.id}','${s.key}', this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
      <div class="doc-slot-label">${s.label}</div>
      <div class="doc-slot-file">${has ? fileLabel : (STATE.role === 'viewonly' ? '—' : (atCap ? 'Limit reached' : 'Click to upload'))}</div>
      <div class="doc-slot-file" style="opacity:.7;">${atCap ? 'Max ' + cap + ' reached' : s.hint}</div>
    </label>`;
      }).join('') + '</div>' +
        `<div style="margin-top:12px;">
     <button class="btn btn-sm" ${anyDocs ? '' : 'disabled'} onclick="downloadPackage('${l.id}')">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
       Download Documents (ZIP)
     </button>
     ${l.status === 'Drop-off' ? '<span class="hint" style="margin-left:8px;">All required docs are on file — this is the completed package.</span>' : ''}
   </div>`;
    }
    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
    }
    async function handleDocUpload(loadId, key, input) {
      if (STATE.role === 'viewonly') return toast('View only', 'You cannot upload files.');
      const l = STATE.loads.find(x => x.id === loadId); if (!l || !input.files.length) return;
      if (!canAccessLoad(l)) return toast('Not your load', 'You can only manage loads assigned to you.');

      if (ARRAY_DOC_KEYS.includes(key)) {
        const existing = l.docs[key] || (l.docs[key] = []);
        const cap = docCap(key);
        const room = cap - existing.length;
        const slotLabel = key === 'PhotosPU' ? 'Pickup photos' : key === 'PhotosDO' ? 'Drop-off photos' : 'Extra documents';
        if (room <= 0) { toast('Limit reached', slotLabel + ' already has ' + cap + ' — remove isn\'t supported here, but you can still book/ship as-is.'); return; }
        const files = Array.from(input.files).slice(0, room);
        if (input.files.length > room) toast('Only ' + room + ' more allowed', slotLabel + ' are capped at ' + cap + ' — the rest were skipped.');
        for (const file of files) {
          let dataUrl = null;
          if (file.size > 1500000) {
            toast('File too large to store', file.name + ' is over 1.5MB — the filename will be recorded but not the file content.', false);
          } else {
            try { dataUrl = await readFileAsDataURL(file); } catch (e) { }
          }
          existing.push({ name: file.name, data: dataUrl });
        }
        persist();
        toast(key === 'Extra' ? 'Documents attached' : 'Photos attached', files.length + ' file(s) added', true);
        openLoadModal(loadId); renderLoadBoard(); renderDashboard(); renderDocsList();
        return;
      }

      const file = input.files[0];
      let dataUrl = null;
      if (file.size > 1500000) {
        toast('File too large to store', file.name + ' is over 1.5MB — the filename will be recorded but not the file content. Keep uploads small for this demo storage.', false);
      } else {
        try { dataUrl = await readFileAsDataURL(file); } catch (e) { /* still record the filename even if we can't read it */ }
      }
      const rec = { name: file.name, data: dataUrl };

      l.docs[key] = rec;
      const prevStatus = l.status;
      l.status = computeStatus(l);
      if (l.status === 'Drop-off' && !PAYMENT_STAGES.includes(l.payment)) l.payment = 'Payment Not Requested';
      if (l.status !== 'Drop-off') l.payment = null;
      syncLoadToSheet(l);
      persist();
      toast('Document attached', file.name, true);
      if (l.status !== prevStatus) toast('Status updated', l.loadNumber + ' → ' + l.status, true);
      // Auto-upload individual RC, BOL, POD to Drive in background (non-blocking)
      if (['RC', 'BOL', 'POD'].includes(key)) {
        autoDriveUploadDoc(l, key, rec).catch(() => { });
      }
      openLoadModal(loadId); // refresh
      renderLoadBoard(); renderDashboard(); renderDocsList();
    }
    // Downloads a plain-text record of the load's data — available any time, even before
    // any documents have been uploaded (unlike the ZIP package, which needs docs on file).
    function downloadLoadRecord(loadId) {
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      const lines = [
        'LOAD RECORD — ' + l.loadNumber,
        '='.repeat(40),
        'Status: ' + l.status,
        'Payment: ' + (paymentOf(l) || 'n/a — not delivered yet'),
        'System Date: ' + fmtDate(l.systemDate),
        'Dispatcher: ' + (l.dispatcherName || '—'),
        'Driver: ' + (l.driverName || '—') + '  (' + (l.truck || '—') + ')',
        'Broker: ' + (l.brokerName || '—') + '  MC# ' + (l.brokerMC || '—') + '  ·  ' + (l.brokerEmail || 'no contact email'),
        'Pickup: ' + (l.pickup || '—') + '  —  ' + fmtDate(l.pickupDate),
        'Drop-Off: ' + (l.dropoff || '—') + '  —  ' + fmtDate(l.deliveryDate),
        'Miles: ' + (l.miles || 0),
        'Broker Rate: ' + money(l.brokerRate),
        'Rate / Mile: $' + (Number(l.ratePerMile) || 0).toFixed(2),
        'Dispatch Fee %: ' + (l.feePct || 0) + '%',
        'Dispatch Revenue: ' + money(l.dispatchRevenue),
        'Notes: ' + (l.notes || '—'),
        '',
        'Documents on file: ' + ['RC', 'BOL', 'POD'].filter(k => l.docs[k]).join(', ') + (((l.docs.PhotosPU && l.docs.PhotosPU.length) || (l.docs.PhotosDO && l.docs.PhotosDO.length)) ? ', Photos (PU ' + ((l.docs.PhotosPU || []).length) + ', DO ' + ((l.docs.PhotosDO || []).length) + ')' : '') + ((l.docs.Extra && l.docs.Extra.length) ? ', Extra (' + l.docs.Extra.length + ')' : '') || 'None',
      ];
      const filename = sanitizeFilename(l.loadNumber + ' - Load Record.txt');
      downloadBlob(lines.join('\n'), filename, 'text/plain');
      toast('Load record downloaded', l.loadNumber, true);
    }
    async function downloadPackage(loadId) {
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      const files = [];
      if (l.docs.RC) files.push(l.docs.RC);
      if (l.docs.BOL) files.push(l.docs.BOL);
      if (l.docs.POD) files.push(l.docs.POD);
      (l.docs.PhotosPU || []).forEach(p => files.push(p));
      (l.docs.PhotosDO || []).forEach(p => files.push(p));
      (l.docs.Extra || []).forEach(p => files.push(p));
      if (!files.length) return toast('No documents yet', 'Upload RC, BOL, POD, or photos first.');
      const fmt = STATE.settings.zipFormat || '{MM-DD-YYYY} {PickupState}-{DropState} {DriverName}.zip';
      const today = new Date();
      const mmddyyyy = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0') + '-' + today.getFullYear();
      let zipName = fmt
        .replace('{MM-DD-YYYY}', mmddyyyy)
        .replace('{PickupState}', stateAbbrev(l.pickup))
        .replace('{DropState}', stateAbbrev(l.dropoff))
        .replace('{DriverName}', l.driverName);
      zipName = sanitizeFilename(zipName);
      const zip = new JSZip();
      files.forEach((f, i) => {
        if (f.data && f.data.includes(',')) {
          const base64 = f.data.split(',')[1];
          zip.file(f.name || ('document_' + i), base64, { base64: true });
        } else {
          zip.file(f.name || ('document_' + i) + '.txt', 'Placeholder — original file content was not captured for this demo record.');
        }
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = zipName.endsWith('.zip') ? zipName : zipName + '.zip'; a.click();
      URL.revokeObjectURL(url);
      toast('Documents downloaded', zipName, true);
    }

    /* ================= GOOGLE DRIVE — AUTO INDIVIDUAL UPLOAD =================
       Automatically uploads RC/BOL/POD to their configured Drive folders whenever
       a document is attached via handleDocUpload(). Fire-and-forget — never
       blocks save; Drive errors are shown as non-blocking warnings. */
    async function autoDriveUploadDoc(l, key, rec) {
      if (!rec || !rec.data) return;                  // file content not available
      const { mimeType, data } = splitDataUrl(rec.data);
      if (!data) return;
      try {
        const result = await backendFetch('/api/drive/upload-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: currentAccountId(),
            docType: key,
            originalName: rec.name,
            mimeType,
            data,
            loadId: l.id,
            loadNumber: l.loadNumber,
            pickup: l.pickup,
            dropoff: l.dropoff,
            pickupDate: l.pickupDate,
            driverName: l.driverName,
            driverId: l.driverId,
            uploadedBy: STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : 'Dispatcher'),
          })
        });
        if (result.duplicate) {
          toast('Already in Google Drive', result.fileName + ' — not uploaded again.', true);
        } else {
          toast('Saved to Drive ✓', result.fileName, true);
        }
        // Refresh Drive section in the open modal without closing it
        fetchAndRenderDriveSection(l.id);
      } catch (driveErr) {
        console.warn('Drive auto-upload failed (non-blocking):', driveErr.message);
        toast('Drive upload skipped', driveErr.message, false);
      }
    }

    // Triggered when a load is marked Paid and has all three key docs.
    async function autoDriveArchive(l) {
      const holder = myGoogleAccountHolder();
      if (!holder || !holder.driveConnected) return;
      const files = [];
      if (l.docs.RC && l.docs.RC.data) files.push({ docType: 'RC', name: l.docs.RC.name, data: splitDataUrl(l.docs.RC.data).data });
      if (l.docs.BOL && l.docs.BOL.data) files.push({ docType: 'BOL', name: l.docs.BOL.name, data: splitDataUrl(l.docs.BOL.data).data });
      if (l.docs.POD && l.docs.POD.data) files.push({ docType: 'POD', name: l.docs.POD.name, data: splitDataUrl(l.docs.POD.data).data });
      if (!files.length) return;
      try {
        const result = await backendFetch('/api/drive/archive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: currentAccountId(),
            loadId: l.id,
            loadNumber: l.loadNumber,
            driverName: l.driverName,
            driverId: l.driverId,
            pickup: l.pickup,
            dropoff: l.dropoff,
            pickupDate: l.pickupDate,
            uploadedBy: STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : 'Dispatcher'),
            files,
          })
        });
        if (result.duplicate) {
          toast('Drive archive exists', result.fileName + ' — not re-uploaded.', true);
        } else {
          toast('Archive saved to Drive ✓', result.fileName, true);
        }
      } catch (archErr) {
        console.warn('Drive archive failed (non-blocking):', archErr.message);
        toast('Drive archive skipped', archErr.message, false);
      }
    }

    /* ---- Drive uploads section in the load modal ---- */
    // Fetches Drive upload records from DB and injects HTML into the modal's
    // dedicated Drive section without closing or re-rendering the whole modal.
    async function fetchAndRenderDriveSection(loadId) {
      const el = document.getElementById('drive-uploads-section-' + loadId);
      if (!el) return;
      try {
        const { uploads } = await backendFetch('/api/drive/uploads/' + encodeURIComponent(loadId) + '?accountId=' + encodeURIComponent(currentAccountId() || 'admin'));
        el.innerHTML = renderDriveUploadsHtml(uploads || []);
      } catch (e) {
        el.innerHTML = '<div class="hint" style="color:var(--red,#e5484d);">Could not load Drive records: ' + escapeAttr(e.message) + '</div>';
      }
    }

    function renderDriveUploadsHtml(uploads) {
      if (!uploads.length) return '<div class="hint">No documents saved to Google Drive yet.</div>';
      const icons = { RC: '📋', BOL: '📄', POD: '📄', PACKAGE: '🗂️' };
      const labels = { RC: 'Rate Confirmation', BOL: 'Bill of Lading', POD: 'Proof of Delivery', PACKAGE: 'Full Package' };
      return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">' +
        uploads.map(u => {
          const icon = icons[u.docType] || '📄';
          const label = labels[u.docType] || u.docType;
          const openBtn = u.webViewLink
            ? `<a href="${escapeAttr(u.webViewLink)}" target="_blank" rel="noopener" class="btn btn-sm" style="text-decoration:none;">Open ↗</a>`
            : '';
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;">` +
            `<span>${icon}</span>` +
            `<div><div style="font-weight:600;">${label}</div><div class="hint" style="margin:0;">${escapeAttr(u.fileName)}</div></div>` +
            openBtn + `</div>`;
        }).join('') + '</div>';
    }

    /* ================= GOOGLE DRIVE — SAVE FULL PACKAGE ================= */
    // First word of a person's name, for the Drive filename convention below.
    function driveFirstName(fullName) { return (fullName || '').trim().split(/\s+/)[0] || ''; }
    // Load# · Lane (PickupState-DropState) · Driver first name · Dispatcher first name
    function buildDrivePackageName(l) {
      const lane = stateAbbrev(l.pickup) + '-' + stateAbbrev(l.dropoff);
      const parts = [l.loadNumber, lane, driveFirstName(l.driverName), driveFirstName(l.dispatcherName)].filter(Boolean);
      return sanitizeFilename(parts.join(' ')) + '.zip';
    }
    // Zips RC + BOL + POD + all photos + Extra docs for one load. Shared by the local-download
    // package button and the Save-to-Drive flow below.
    async function buildLoadZipBlob(l) {
      const files = [];
      if (l.docs.RC) files.push(l.docs.RC);
      if (l.docs.BOL) files.push(l.docs.BOL);
      if (l.docs.POD) files.push(l.docs.POD);
      (l.docs.PhotosPU || []).forEach(p => files.push(p));
      (l.docs.PhotosDO || []).forEach(p => files.push(p));
      (l.docs.Extra || []).forEach(p => files.push(p));
      const zip = new JSZip();
      files.forEach((f, i) => {
        if (f.data && f.data.includes(',')) {
          const base64 = f.data.split(',')[1];
          zip.file(f.name || ('document_' + i), base64, { base64: true });
        } else {
          zip.file(f.name || ('document_' + i) + '.txt', 'Placeholder — original file content was not captured for this demo record.');
        }
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      return { blob, fileCount: files.length };
    }
    function renderDrivePackageStatus(l) {
      const saved = (STATE.driveFiles || []).filter(f => f.loadId === l.id);
      if (!saved.length) return '';
      return '<div class="hint" style="margin-top:4px;">Saved to Drive: ' +
        saved.map(f => '<span class="mono">' + f.name + '</span> (' + fmtDateTime(f.savedAt) + ')').join(', ') +
        '</div>';
    }
    // Enabled only once RC, BOL and POD are all on file. Builds the zip, checks whether a
    // package with this exact name is already saved in Drive for this load, and — unless the
    // dispatcher explicitly confirms a duplicate — skips the save instead of re-sending it.
    async function savePackageToDrive(loadId) {
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      if (!(l.docs.RC && l.docs.BOL && l.docs.POD)) {
        toast('Not ready yet', 'RC, BOL and POD all need to be on file before the package can be saved to Drive.');
        return;
      }
      const holder = myGoogleAccountHolder();
      if (!holder || !holder.driveConnected || !holder.gmailConnected) {
        toast('Google account not connected', 'Connect your own Google account in "My Account" — that sign-in is used for both Gmail and Drive.');
        return;
      }
      const fileName = buildDrivePackageName(l);
      const existing = (STATE.driveFiles || []).find(f => f.loadId === l.id && f.name.toLowerCase() === fileName.toLowerCase());
      if (existing) {
        const overwrite = confirm('"' + fileName + '" is already saved in Google Drive for this load (saved ' + fmtDateTime(existing.savedAt) + ').\n\nSave another copy anyway?');
        if (!overwrite) {
          toast('Not saved', 'A package named "' + fileName + '" already exists in Drive — nothing was sent.');
          return;
        }
      }
      const { blob, fileCount } = await buildLoadZipBlob(l);
      if (!fileCount) { toast('No documents yet', 'Upload RC, BOL, POD, or photos first.'); return; }
      toast('Uploading…', 'Saving ' + fileName + ' to Drive via ' + (holder.googleAccountEmail || 'your Google account'));
      try {
        const base64 = await blobToBase64(blob);
        const result = await backendFetch('/api/drive-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: currentAccountId(), fileName, mimeType: 'application/zip', data: base64 })
        });
        STATE.driveFiles = STATE.driveFiles || [];
        STATE.driveFiles.unshift({
          id: uid('drv'), loadId: l.id, loadNumber: l.loadNumber, name: fileName,
          savedBy: STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : ''),
          savedAt: new Date().toISOString(),
          account: holder.googleAccountEmail || '',
          driveFileId: result.fileId, webViewLink: result.webViewLink,
        });
        persist();
        toast('Saved to Google Drive', fileName + ' — via ' + (holder.googleAccountEmail || 'connected account'), true);
        if (document.getElementById('modal-load').classList.contains('active')) openLoadModal(loadId);
      } catch (e) {
        toast('Upload failed', e.message);
      }
    }
    // BOL and POD sends use fixed wording (not the customizable RC template below) — this is
    // the message a dispatcher gives the broker at each handoff point. RC and the full package
    // still use the editable template from Settings → Templates.
    // Fills {{LoadNumber}} {{DriverName}} {{PickupCity}} {{DeliveryCity}} (and the legacy
    // {LoadNumber}/{DriverName}/{Pickup}/{DropOff}/{CompanyName} tokens used by the RC template).
    function fillTemplateVars(str, l, companyName) {
      return (str || '')
        .replace(/\{\{LoadNumber\}\}/g, l.loadNumber)
        .replace(/\{\{DriverName\}\}/g, l.driverName || '')
        .replace(/\{\{PickupCity\}\}/g, l.pickup || '')
        .replace(/\{\{DeliveryCity\}\}/g, l.dropoff || '')
        .replace(/\{LoadNumber\}/g, l.loadNumber)
        .replace(/\{DriverName\}/g, l.driverName || '')
        .replace(/\{Pickup\}/g, l.pickup || '')
        .replace(/\{DropOff\}/g, l.dropoff || '')
        .replace(/\{CompanyName\}/g, companyName);
    }
    /* ================= REAL BACKEND WIRING =================
       Talks to the Node/Express backend in this repo (server.js + routes/*.js).
       Same-origin relative paths — server.js serves this file AND answers
       /auth/* and /api/* from the same process, so no base URL is needed. */

    // 'admin' for the Admin's own connection, or the signed-in dispatcher's id —
    // matches exactly what myGoogleAccountHolder() reads/writes on.
    function currentAccountId() {
      return STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId;
    }
    async function backendFetch(path, opts) {
      let res;
      try {
        res = await fetch(path, opts);
      } catch (e) {
        throw new Error('Could not reach the HaulBoX backend at ' + path + '. Is `npm start` running?');
      }
      let json = null; try { json = await res.json(); } catch (e) { }
      if (!res.ok) throw new Error((json && json.error) || ('Request failed (' + res.status + ')'));
      return json;
    }
    // Splits a stored "data:<mime>;base64,<data>" string into the pieces the
    // backend's /api endpoints expect (mimeType + bare base64, no prefix).
    function splitDataUrl(dataUrl) {
      const m = String(dataUrl || '').match(/^data:([^;]+);base64,([\s\S]*)$/);
      return m ? { mimeType: m[1], data: m[2] } : { mimeType: 'application/octet-stream', data: dataUrl || '' };
    }
    // Stored doc records are {name, data} — backend attachments are
    // {filename, mimeType, data(base64, no prefix)}.
    function toBackendAttachments(files) {
      return (files || []).filter(f => f && f.data).map(f => {
        const { mimeType, data } = splitDataUrl(f.data);
        return { filename: f.name || 'attachment', mimeType, data };
      });
    }
    // Gathers the stored file record(s) relevant to a given send action.
    function collectDocsFor(l, doc) {
      if (doc === 'BOL') {
        const files = [];
        if (l.docs.BOL) files.push(l.docs.BOL);
        (l.docs.PhotosPU || []).forEach(p => files.push(p));
        return files;
      }
      if (doc === 'POD') {
        const files = [];
        if (l.docs.POD) files.push(l.docs.POD);
        (l.docs.PhotosDO || []).forEach(p => files.push(p));
        return files;
      }
      if (doc === 'RC') return l.docs.RC ? [l.docs.RC] : [];
      // PACKAGE — everything on file for the load
      const files = [];
      if (l.docs.RC) files.push(l.docs.RC);
      if (l.docs.BOL) files.push(l.docs.BOL);
      if (l.docs.POD) files.push(l.docs.POD);
      (l.docs.PhotosPU || []).forEach(p => files.push(p));
      (l.docs.PhotosDO || []).forEach(p => files.push(p));
      (l.docs.Extra || []).forEach(p => files.push(p));
      return files;
    }
    // Browser-side Blob -> base64 (no data: prefix), for handing a zip Blob to
    // the backend's /api/drive-upload.
    async function blobToBase64(blob) {
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }
    // Opens the backend's real OAuth flow in a popup and resolves with
    // {accountId, email} once routes/auth.js's callback page posts back success
    // (or rejects on error / on the user just closing the popup).
    function openGoogleOAuthPopup(accountId) {
      return new Promise((resolve, reject) => {
        const popup = window.open('/auth/google?accountId=' + encodeURIComponent(accountId), 'haulline-google-oauth', 'width=520,height=650');
        if (!popup) { reject(new Error('POPUP_BLOCKED')); return; }
        let settled = false;
        function onMsg(ev) {
          if (!ev.data || (ev.data.type !== 'google-auth-success' && ev.data.type !== 'google-auth-error')) return;
          settled = true;
          window.removeEventListener('message', onMsg);
          clearInterval(poll);
          if (ev.data.type === 'google-auth-success') resolve(ev.data);
          else reject(new Error(ev.data.error || 'Google sign-in failed.'));
        }
        window.addEventListener('message', onMsg);
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            window.removeEventListener('message', onMsg);
            if (!settled) reject(new Error('CLOSED'));
          }
        }, 500);
      });
    }


    function sendDoc(loadId, doc, target) {
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      const driver = STATE.drivers.find(d => d.id === l.driverId);
      const broker = STATE.brokers.find(b => b.id === l.brokerId);
      let to = target === 'driver' ? (driver ? driver.email : '') : (l.broker_email || l.brokerEmail || (broker ? broker.email : ''));
      const t = STATE.settings;
      const companyName = t.companyName || 'Dispatch';
      let fullSubject, body;
      if (doc === 'BOL') {
        const hasPickupPhotos = !!(l.docs.PhotosPU && l.docs.PhotosPU.length);
        fullSubject = t.bolSubject ? fillTemplateVars(t.bolSubject, l, companyName) : ('BOL — Load ' + l.loadNumber);
        body = t.bolBody ? fillTemplateVars(t.bolBody, l, companyName) :
          ('Hi,\n\nMy driver picked up the load and I\'m sending you the BOL' +
            (hasPickupPhotos ? ', along with the freight photos from pickup.' : '.') +
            '\n\nThanks,\n' + companyName);
      } else if (doc === 'POD') {
        fullSubject = t.podSubject ? fillTemplateVars(t.podSubject, l, companyName) : ('POD — Load ' + l.loadNumber);
        body = t.podBody ? fillTemplateVars(t.podBody, l, companyName) :
          ('Hi,\n\nMy driver dropped off the load and I\'m sending you the POD — please check it.\n\n' +
            'Thanks for working with us, and we look forward to working with you again.\n\n' + companyName);
      } else {
        const subject = (t.rcSubject || 'Load {LoadNumber} Documents').replace('{LoadNumber}', l.loadNumber);
        body = (t.rcBody || '').replace('{DriverName}', l.driverName).replace('{LoadNumber}', l.loadNumber)
          .replace('{Pickup}', l.pickup).replace('{DropOff}', l.dropoff).replace('{CompanyName}', companyName);
        fullSubject = doc + ' — ' + subject;
      }
      l.email_subject = fullSubject;

      // ===== BOL/POD-to-broker: REPLY ALL ONLY, no exceptions =====
      // Every BOL and POD send to the broker MUST land as a Reply All inside the load's saved
      // Gmail thread — same subject as the original email, same To + Cc as the original
      // conversation, attachments included. There is no "plain reply" and no "new email"
      // fallback for these two document types. If the thread isn't linked, the send is blocked
      // and the dispatcher sees the error below instead of silently starting a new conversation.
      const isThreadableBrokerSend = (doc === 'BOL' || doc === 'POD') && target === 'broker';
      if (isThreadableBrokerSend) {
        if (!l.gmail_thread_id) {
          toast('No Gmail thread linked to this load.', 'Add the broker\'s Gmail Thread Link/ID on this load before sending ' + doc + ' — it will never be sent as a new conversation.');
          return;
        }
        const holder = myGoogleAccountHolder();
        if (!holder || !(holder.gmailConnected && holder.gmailEnabled)) {
          toast('Google account not connected', 'Connect your own Google account in "My Account" before sending ' + doc + ' — it powers Reply All from your inbox.');
          return;
        }
        const accountId = currentAccountId();
        const files = collectDocsFor(l, doc);
        const ccList = Array.isArray(l.gmail_thread_cc) ? l.gmail_thread_cc.filter(Boolean) : [];
        // Keep the ORIGINAL subject line (Gmail's own "Re:" behavior on reply), never the
        // freshly-templated subject built above — that templated subject is only used for the
        // non-threaded compose flow (RC / Package / driver sends) further down.
        let replySubject = l.gmail_original_subject
          ? (/^re:/i.test(l.gmail_original_subject.trim()) ? l.gmail_original_subject.trim() : 'Re: ' + l.gmail_original_subject.trim())
          : 'Re: ' + fullSubject;
        let inReplyTo = l.gmail_last_message_id || '';
        let references = l.gmail_references || '';
        let cc = ccList.join(', ');
        toast('Sending…', 'Reply-All (' + doc + ') to broker via ' + (holder.googleAccountEmail || 'your Google account'));
        (async () => {
          // Pull the authoritative subject/Message-ID/Cc AND the real reply-to address
          // straight from the thread itself — replyTo is whoever actually sent the last
          // message in THIS conversation, which is what Reply All must go to. This
          // deliberately overrides `to` (which started out as the Broker record's saved
          // email) because that field can be a different/stale address than whoever
          // actually sent this particular RC — Reply All should never depend on it.
          try {
            const threadInfo = await backendFetch('/api/thread/' + encodeURIComponent(l.gmail_thread_id) + '?accountId=' + encodeURIComponent(accountId));
            if (threadInfo) {
              if (threadInfo.originalSubject) replySubject = /^re:/i.test(threadInfo.originalSubject.trim()) ? threadInfo.originalSubject.trim() : 'Re: ' + threadInfo.originalSubject.trim();
              if (threadInfo.lastMessageId) inReplyTo = threadInfo.lastMessageId;
              if (threadInfo.references) references = threadInfo.references;
              if (threadInfo.cc) cc = threadInfo.cc;
              if (threadInfo.replyTo && isValidEmailAddress(threadInfo.replyTo)) to = threadInfo.replyTo;
            }
          } catch (e) { /* fall back to the stored broker email below if this lookup fails */ }
          if (!isValidEmailAddress(to)) {
            toast('No valid email to reply to', 'Couldn\'t find a valid sender on this Gmail thread, and this broker has no valid email on file either. Re-link the Email Thread on this load.');
            return;
          }
          try {
            const result = await backendFetch('/api/reply-all', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId, threadId: l.gmail_thread_id, to, cc, subject: replySubject, body, inReplyTo, references, attachments: toBackendAttachments(files) })
            });
            l.gmail_message_id = result.messageId || l.gmail_message_id;
            persist();
            const recipientLog = to + (cc ? ' (Cc: ' + cc + ')' : '');
            logEmail(l, doc, recipientLog, 'Sent (Reply All in thread) — via ' + (holder.googleAccountEmail || 'connected account'), l.gmail_thread_id);
            toast(doc + ' sent — Reply All', 'Via ' + (holder.googleAccountEmail || 'connected account') + ' to ' + recipientLog + (files.length ? ' with ' + files.length + ' attachment(s).' : ''), true);
          } catch (e) {
            toast('Send failed', e.message);
          }
        })();
        return;
      }

      const holder = myGoogleAccountHolder();
      const accountId = currentAccountId();
      if (holder && holder.gmailConnected && holder.gmailEnabled) {
        if (!isValidEmailAddress(to)) return toast('No valid email on file', 'Add a valid email for this ' + (target === 'driver' ? 'driver' : 'broker') + ' first.');
        const files = collectDocsFor(l, doc);
        toast('Sending…', 'Sending via ' + (holder.googleAccountEmail || 'your Google account') + ' to ' + to);
        (async () => {
          try {
            const result = await backendFetch('/api/send-email', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId, to, subject: fullSubject, body, attachments: toBackendAttachments(files) })
            });
            l.gmail_message_id = result.messageId || l.gmail_message_id;
            persist();
            logEmail(l, doc === 'PACKAGE' ? 'Package' : doc, to, 'Sent — via ' + (holder.googleAccountEmail || 'connected account'), '');
            toast('Email sent', 'Sent from ' + (holder.googleAccountEmail || 'your Google account') + ' to ' + to + (files.length ? ' with ' + files.length + ' attachment(s).' : ' (no documents on file to attach).'), true);
          } catch (e) {
            toast('Send failed', e.message);
          }
        })();
        return;
      }

      const providerSel = document.getElementById('send-provider-select');
      const provider = (providerSel && providerSel.value) || t.mailProvider || 'default';
      let providerLabel = 'default mail app';
      if (provider === 'gmail') {
        providerLabel = 'Gmail';
        window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + '&su=' + encodeURIComponent(fullSubject) + '&body=' + encodeURIComponent(body), '_blank');
      } else if (provider === 'outlook') {
        providerLabel = 'Outlook';
        window.open('https://outlook.office.com/mail/deeplink/compose?to=' + encodeURIComponent(to) + '&subject=' + encodeURIComponent(fullSubject) + '&body=' + encodeURIComponent(body), '_blank');
      } else {
        window.location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(fullSubject) + '&body=' + encodeURIComponent(body);
      }
      // Browsers won't let a webpage attach files into a mailto/Gmail/Outlook compose window —
      // there's no API for that, for security reasons. The closest we can do is auto-download
      // the relevant file(s) right now so they're sitting in Downloads, ready to drag into the
      // draft that just opened. (Connect a Google account above to skip this entirely — real
      // sends attach automatically, no manual drag-and-drop needed.)
      const filesToDownload = collectDocsFor(l, doc);
      filesToDownload.forEach(f => downloadStoredFile(f));
      const downloaded = filesToDownload.length;
      const attachNote = downloaded ? ' — ' + downloaded + ' file(s) downloaded, ready to attach.' : '';
      persist();
      logEmail(l, doc === 'PACKAGE' ? 'Package' : doc, to, 'Sent (new thread)', l.gmail_thread_id);
      toast('Opening email draft in ' + providerLabel, (to || 'no email on file') + attachNote, true);
    }
    // Downloads one stored document record ({name, data}) straight to the browser's downloads.
    function downloadStoredFile(rec) {
      if (!rec || !rec.data) return;
      const a = document.createElement('a'); a.href = rec.data; a.download = rec.name; a.click();
    }

    /* ================= DRIVERS ================= */
    function renderDrivers() {
      const body = document.getElementById('drivers-body');
      if (!body) return;
      body.innerHTML = visibleDrivers().map(d =>
        '<tr onclick="openDriverModal(\'' + d.id + '\')" style="cursor:pointer;">' +
        '<td class="cell-strong" style="padding:12px 16px;font-weight:700;color:#0f172a;">' + escapeAttr(d.name) + '</td>' +
        '<td style="padding:12px 16px;font-weight:600;color:#334155;">' + escapeAttr(d.truck || '—') + '</td>' +
        '<td style="padding:12px 16px;font-weight:600;color:#334155;">' + escapeAttr(d.phone || '—') + '</td>' +
        '<td style="padding:12px 16px;color:#64748b;">' + escapeAttr(d.company || '—') + '</td>' +
        '<td style="padding:12px 16px;">' + (d.active ? '<span class="placard pl-green"><span class="dot"></span>Active</span>' : '<span class="placard pl-gray"><span class="dot"></span>Inactive</span>') + '</td>' +
        '<td style="padding:12px 16px;">' + availabilityBadge(d.id) + '</td>' +
        '</tr>'
      ).join('');
    }
    // Small popup for a driver row's contact details (Truck #, Phone, Email) —
    // kept out of the row itself; click anywhere on the row (except the action
    // buttons) to see them without opening the full Edit Driver modal.
    function openDriverContactPopup(id) {
      const d = STATE.drivers.find(x => x.id === id);
      if (!d) return;
      document.getElementById('driver-contact-title').textContent = d.name;
      document.getElementById('driver-contact-body').innerHTML =
        '<div class="drv-detail-row"><span class="k">Truck #</span><span>' + (d.truck || '—') + '</span></div>' +
        '<div class="drv-detail-row"><span class="k">Phone</span><span>' + (d.phone || '—') + '</span></div>' +
        '<div class="drv-detail-row"><span class="k">Email</span><span>' + (d.email || '—') + '</span></div>';
      openModal('modal-driver-contact');
    }
    /* Free-form driver document slots, staged in memory while the modal is open, then attached
       to the driver record on save. Default to 6 blank slots (range: 5–8 recommended) so Admin can
       label each one as needed — CDL, Truck VIN #, Truck Plate #, Insurance, Medical Card, etc. */
    let driverDocsDraft = [];
    function blankDriverDocSlots(n) {
      const arr = [];
      for (let i = 0; i < n; i++) arr.push({ label: '', fileName: null, fileData: null });
      return arr;
    }
    function genDriverPin() { return String(Math.floor(1000 + Math.random() * 9000)); }
    function genUniqueDriverCode(excludeId) {
      let code;
      const taken = new Set(STATE.drivers.filter(d => d.id !== excludeId).map(d => (d.driverCode || '').toUpperCase()));
      do { code = 'D' + Math.floor(1000 + Math.random() * 9000); } while (taken.has(code));
      return code;
    }
    function copyDriverLoginInfo() {
      const code = document.getElementById('d-drivercode').value.trim();
      const pin = document.getElementById('d-pin').value.trim();
      const name = document.getElementById('d-name').value.trim() || 'Driver';
      if (!code || !pin) return toast('Nothing to copy', 'Fill in the Driver ID and PIN first.');
      const url = new URL('/driver', window.location.origin); // the redesigned Driver Portal, not the old ?driver=1 view
      const text = 'Hi ' + name + ' — your HaulBoX driver login:\nDriver ID: ' + code + '\nPIN: ' + pin + '\nOpen: ' + url.toString();
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Login info copied', 'Paste it into a text message to ' + name, true); }
      catch (e) { toast('Copy this manually', text); }
      document.body.removeChild(ta);
    }
    function onDriverRampsChanged() {
      const sel = document.getElementById('d-ramps');
      const wrap = document.getElementById('d-ramp-type-wrap');
      if (sel && wrap) wrap.style.display = sel.value === 'Yes' ? 'flex' : 'none';
    }
    /* Admin sees editable label + upload slots. Everyone else (Dispatcher, view-only link) sees the
       same slots read-only, with a download button on any slot that already has a file attached —
       they can view and download driver documents but never upload, edit, or remove them. */
    function renderDriverDocSlots() {
      const el = document.getElementById('d-docs-list');
      if (!el) return;
      const isAdmin = STATE.role === 'admin';
      if (isAdmin) {
        el.innerHTML = driverDocsDraft.map((s, i) => {
          const has = !!(s.fileName);
          return `<div class="doc-slot-editable ${has ? 'filled' : ''}">
        <input type="text" placeholder="Document name (e.g. CDL, Truck VIN #, Truck Plate #)" value="${(s.label || '').replace(/"/g, '&quot;')}" oninput="driverDocsDraft[${i}].label=this.value">
        <div class="doc-slot-row">
          <label class="doc-upload-btn">
            <input type="file" onchange="handleDriverDocUpload(${i}, this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <span>${has ? s.fileName : 'Click to upload'}</span>
          </label>
          <button type="button" class="doc-remove-btn" title="Remove slot" onclick="removeDriverDocSlot(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>`;
        }).join('');
        return;
      }
      const slotsWithLabelOrFile = driverDocsDraft.filter(s => s.label || s.fileName);
      if (!slotsWithLabelOrFile.length) {
        el.innerHTML = '<p class="cell-dim" style="font-size:12px;grid-column:1/-1;">No documents on file for this driver yet.</p>';
        return;
      }
      el.innerHTML = slotsWithLabelOrFile.map(s => {
        const i = driverDocsDraft.indexOf(s);
        const has = !!(s.fileName);
        return `<div class="doc-slot-editable ${has ? 'filled' : ''}">
      <div style="font-size:12px;font-weight:600;color:var(--text-dim);">${s.label || 'Untitled document'}</div>
      <div class="doc-slot-row">
        ${has
            ? `<button type="button" class="doc-upload-btn" style="cursor:pointer;" onclick="downloadDriverDoc(${i})">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
               <span>${s.fileName}</span>
             </button>`
            : '<span class="cell-dim" style="font-size:11px;">Not uploaded yet</span>'}
      </div>
    </div>`;
      }).join('');
    }
    async function handleDriverDocUpload(i, input) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can upload driver documents.');
      if (!input.files.length) return;
      const file = input.files[0];
      let dataUrl = null;
      if (file.size > 1500000) {
        toast('File too large to store', file.name + ' is over 1.5MB — the filename will be recorded but not the file content. Keep uploads small for this demo storage.', false);
      } else {
        try { dataUrl = await readFileAsDataURL(file); } catch (e) { /* still record the filename even if we can't read it */ }
      }
      driverDocsDraft[i].fileName = file.name;
      driverDocsDraft[i].fileData = dataUrl;
      renderDriverDocSlots();
    }
    function addDriverDocSlot() {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can add driver document slots.');
      if (driverDocsDraft.length >= 8) return toast('Limit reached', 'Up to 8 document slots per driver.');
      driverDocsDraft.push({ label: '', fileName: null, fileData: null });
      renderDriverDocSlots();
    }
    function removeDriverDocSlot(i) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can remove driver documents.');
      driverDocsDraft.splice(i, 1);
      renderDriverDocSlots();
    }
    /* Downloads a single driver document — available to Admin, Dispatcher, and view-only links alike. */
    function downloadDriverDoc(i) {
      const s = driverDocsDraft[i]; if (!s || !s.fileName) return;
      if (!s.fileData) { return toast('No file content stored', s.fileName + ' was recorded but its content was over the demo storage size limit.'); }
      const a = document.createElement('a'); a.href = s.fileData; a.download = s.fileName; a.click();
    }
    /* Downloads every uploaded document for the driver currently open in the modal as a ZIP —
       available to Admin, Dispatcher, and view-only links alike; only uploading/editing is admin-only. */
    async function downloadDriverDocs() {
      const files = driverDocsDraft.filter(s => s.fileName);
      if (!files.length) return toast('No documents yet', 'This driver has no documents uploaded yet.');
      const name = document.getElementById('d-name').value.trim() || 'driver';
      const zip = new JSZip();
      files.forEach((f, i) => {
        if (f.fileData && f.fileData.includes(',')) {
          const base64 = f.fileData.split(',')[1];
          zip.file(f.fileName || ('document_' + i), base64, { base64: true });
        } else {
          zip.file((f.fileName || ('document_' + i)) + '.txt', 'Placeholder — original file content was not captured for this demo record.');
        }
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const zipName = sanitizeFilename(name + ' - Documents.zip');
      const a = document.createElement('a'); a.href = url; a.download = zipName; a.click();
      URL.revokeObjectURL(url);
      toast('Documents downloaded', zipName, true);
    }
    /* Locks down every field in the driver form for non-admins — they can view every detail and
       download documents, but can't modify anything or upload/replace documents. */
    function applyDriverFormMode(isAdmin) {
      const form = document.querySelector('#modal-driver form');
      if (!form) return;
      form.querySelectorAll('input[type=text], input[type=email], input[type=number], textarea').forEach(el => {
        if (el.id === 'd-id') return;
        el.readOnly = !isAdmin;
      });
      form.querySelectorAll('select').forEach(el => { el.disabled = !isAdmin; });
      const saveBtn = document.getElementById('driver-save-btn');
      const addDocBtn = document.getElementById('driver-add-doc-btn');
      const cancelBtn = document.getElementById('driver-cancel-btn');
      const docsHint = document.getElementById('d-docs-hint');
      if (saveBtn) saveBtn.style.display = isAdmin ? '' : 'none';
      if (addDocBtn) addDocBtn.style.display = isAdmin ? '' : 'none';
      if (cancelBtn) cancelBtn.textContent = isAdmin ? 'Cancel' : 'Close';
      if (docsHint) docsHint.textContent = isAdmin
        ? 'Free-form document slots — label each one as needed (CDL, Truck VIN #, Truck Plate #, Insurance, Medical Card, MVR, etc.) and attach the file.'
        : 'You can view driver details and download documents here, but only Admin can edit driver info or upload/replace documents.';
    }
    function openDriverModal(id) {
      const isAdmin = STATE.role === 'admin';
      const isEdit = !!id;
      if (!isEdit && !isAdmin) return toast('Admin only', 'Only Admin can add a new driver.');
      document.getElementById('driver-modal-title').textContent = isAdmin ? (isEdit ? 'Edit Driver' : 'Add Driver') : 'Driver Details';
      const d = isEdit ? STATE.drivers.find(x => x.id === id) : {};
      document.getElementById('d-id').value = id || '';
      document.getElementById('d-name').value = d.name || '';
      document.getElementById('d-phone').value = d.phone || '';
      document.getElementById('d-email').value = d.email || '';
      document.getElementById('d-company').value = d.company || '';
      document.getElementById('d-hometown').value = d.hometown || '';
      document.getElementById('d-otr-local').value = d.otrLocal || '';
      document.getElementById('d-team').value = d.team || 'No';
      document.getElementById('d-fee').value = d.feePct != null ? d.feePct : (STATE.settings.defaultFeePct || 10);
      const payPctEl = document.getElementById('d-paypct');
      if (payPctEl) payPctEl.value = d.payPct != null ? d.payPct : defaultDriverPayPct();
      const codeEl = document.getElementById('d-drivercode');
      const pinEl = document.getElementById('d-pin');
      if (codeEl) codeEl.value = d.driverCode || (isEdit ? '' : genUniqueDriverCode());
      if (pinEl) pinEl.value = d.pin || (isEdit ? '' : genDriverPin());
      const linkEl = document.getElementById('d-driver-link');
      if (linkEl) { const portalUrl = new URL('/driver', window.location.origin).toString(); linkEl.textContent = portalUrl; linkEl.href = portalUrl; }
      document.getElementById('d-truck').value = d.truck || '';
      document.getElementById('d-truck-type').value = d.truckType || '';
      document.getElementById('d-trailer-type').value = d.trailerType || '';
      document.getElementById('d-trailer-size').value = d.trailerSize || '';
      document.getElementById('d-max-weight').value = d.maxWeight || '';
      document.getElementById('d-ramps').value = d.ramps || 'No';
      document.getElementById('d-ramp-type').value = d.rampType || '';
      onDriverRampsChanged();
      document.getElementById('d-tarps').value = d.tarps || 'No';
      document.getElementById('d-chains').value = d.chains || 'No';
      document.getElementById('d-binders').value = d.binders || 'No';
      document.getElementById('d-cdl').value = d.cdl || 'No';
      document.getElementById('d-hazmat').value = d.hazmat || 'No';
      document.getElementById('d-background-clear').value = d.backgroundClear || 'No';
      document.getElementById('d-us-citizen').value = d.usCitizen || 'No';
      document.getElementById('d-notes').value = d.notes || '';
      const dispSel = document.getElementById('d-dispatcher');
      if (dispSel) {
        dispSel.innerHTML = '<option value="">Unassigned — hidden from every dispatcher</option>' + STATE.dispatchers.map(x => '<option value="' + x.id + '">' + x.name + '</option>').join('');
        dispSel.value = d.dispatcherId || '';
      }
      driverDocsDraft = (isEdit && d.docs && d.docs.length) ? JSON.parse(JSON.stringify(d.docs)) : blankDriverDocSlots(6);
      applyDriverFormMode(isAdmin);
      renderDriverDocSlots();
      openModal('modal-driver');
    }
    function saveDriver(e) {
      e.preventDefault();
      if (STATE.role !== 'admin') { closeModal('modal-driver'); return toast('Admin only', 'Only Admin can add or edit drivers.'); }
      const id = document.getElementById('d-id').value;
      const dispSel = document.getElementById('d-dispatcher');
      const rec = {
        id: id || uid('drv'),
        name: document.getElementById('d-name').value.trim(),
        truck: document.getElementById('d-truck').value.trim(),
        phone: document.getElementById('d-phone').value.trim(),
        email: document.getElementById('d-email').value.trim(),
        company: document.getElementById('d-company').value.trim(),
        hometown: document.getElementById('d-hometown').value.trim(),
        otrLocal: document.getElementById('d-otr-local').value,
        team: document.getElementById('d-team').value,
        feePct: parseFloat(document.getElementById('d-fee').value) || 0,
        payPct: parseFloat((document.getElementById('d-paypct') || {}).value) || defaultDriverPayPct(),
        driverCode: (document.getElementById('d-drivercode').value.trim().toUpperCase() || genUniqueDriverCode(id)).replace(/\s+/g, ''),
        pin: (document.getElementById('d-pin').value.trim() || genDriverPin()),
        truckType: document.getElementById('d-truck-type').value.trim(),
        trailerType: document.getElementById('d-trailer-type').value.trim(),
        trailerSize: document.getElementById('d-trailer-size').value.trim(),
        maxWeight: document.getElementById('d-max-weight').value.trim(),
        ramps: document.getElementById('d-ramps').value,
        rampType: document.getElementById('d-ramps').value === 'Yes' ? document.getElementById('d-ramp-type').value.trim() : '',
        tarps: document.getElementById('d-tarps').value,
        chains: document.getElementById('d-chains').value,
        binders: document.getElementById('d-binders').value,
        cdl: document.getElementById('d-cdl').value,
        hazmat: document.getElementById('d-hazmat').value,
        backgroundClear: document.getElementById('d-background-clear').value,
        usCitizen: document.getElementById('d-us-citizen').value,
        docs: driverDocsDraft,
        notes: document.getElementById('d-notes').value.trim(),
        dispatcherId: STATE.role === 'admin' && dispSel ? (dispSel.value || null) : (id ? STATE.drivers.find(x => x.id === id).dispatcherId || null : null),
        active: id ? STATE.drivers.find(x => x.id === id).active : true,
      };
      if (!/^\d{4}$/.test(rec.pin)) { return toast('PIN must be 4 digits', 'Use Generate for a random one.'); }
      const codeClash = STATE.drivers.find(x => x.id !== rec.id && (x.driverCode || '').toUpperCase() === rec.driverCode);
      if (codeClash) { return toast('Driver ID already in use', 'That Driver ID belongs to ' + codeClash.name + ' — pick another or Generate.'); }
      if (id) { STATE.drivers = STATE.drivers.map(x => x.id === id ? rec : x); }
      else { STATE.drivers.push(rec); }
      persist(); closeModal('modal-driver'); renderDrivers(); populateDropdowns(); renderSettings();
      if (STATE.role === 'admin' && document.getElementById('view-driverpay').classList.contains('active')) renderDriverPay();
      toast('Driver saved', rec.name, true);
      if (pendingSelectTarget === 'driver') {
        document.getElementById('f-driver').value = rec.id;
        onDriverSelected();
        pendingSelectTarget = null;
      }
      return false;
    }
    function toggleDriverActive(id) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can activate or deactivate drivers.');
      const d = STATE.drivers.find(x => x.id === id); if (!d) return;
      d.active = !d.active; persist(); renderDrivers(); populateDropdowns(); renderSettings();
      toast(d.active ? 'Driver activated' : 'Driver deactivated', d.name, true);
    }

    /* ================= DRIVER PAY — LEASE SETTLEMENTS (ADMIN ONLY) =================
       Every figure on this page is Admin-only. Dispatchers and view-only links can't reach
       the view (the nav item is hidden and switchView blocks it), and none of these numbers
       appear anywhere in their dashboards, exports, or load detail. */
    function onDriverPayRangeChanged() {
      const range = document.getElementById('dp-range').value;
      const show = range === 'custom';
      const fromWrap = document.getElementById('dp-from-wrap');
      const toWrap = document.getElementById('dp-to-wrap');
      if (fromWrap) fromWrap.style.display = show ? 'flex' : 'none';
      if (toWrap) toWrap.style.display = show ? 'flex' : 'none';
      renderDriverPay();
    }
    /* The loads currently shown, after the driver / date / settlement-status filters. */
    function driverPayFilteredLoads() {
      const driverF = (document.getElementById('dp-driver') || {}).value || '';
      const rangeF = (document.getElementById('dp-range') || {}).value || 'month';
      const statusF = (document.getElementById('dp-status') || {}).value || 'ready';
      const fromF = rangeF === 'custom' ? (document.getElementById('dp-from') || {}).value : null;
      const toF = rangeF === 'custom' ? (document.getElementById('dp-to') || {}).value : null;
      return STATE.loads.filter(l => {
        if (driverF && l.driverId !== driverF) return false;
        if (!within(settlementDateOf(l), rangeF, fromF, toF)) return false;
        if (statusF === 'paid') return !!l.driverPaid;
        if (statusF === 'unpaid') return !l.driverPaid;
        if (statusF === 'ready') return !l.driverPaid && l.status === 'Drop-off';
        return true;
      });
    }
    function renderDriverPay() {
      if (STATE.role !== 'admin') return;
      const sel = document.getElementById('dp-driver');
      if (sel) {
        const keep = sel.value;
        sel.innerHTML = '<option value="">All Drivers</option>' + STATE.drivers.map(d => '<option value="' + d.id + '">' + d.name + '</option>').join('');
        if (STATE.drivers.some(d => d.id === keep)) sel.value = keep;
      }
      const loads = driverPayFilteredLoads();
      const gross = loads.reduce((s, l) => s + Number(l.brokerRate || 0), 0);
      const pay = loads.reduce((s, l) => s + driverPayOf(l), 0);
      const deductions = loads.reduce((s, l) => s + Number(l.driverDeduction || 0), 0);
      const net = pay - deductions;
      const unpaid = loads.filter(l => !l.driverPaid).reduce((s, l) => s + driverNetOf(l), 0);
      const margin = gross - pay;

      document.getElementById('dp-stat-grid').innerHTML = [
        { label: 'Gross (filtered)', value: money(gross), color: 'var(--green)' },
        { label: 'Driver Pay', value: money(net), color: 'var(--yellow)' },
        { label: 'Company Margin', value: money(margin), color: 'var(--accent)' },
        { label: 'Still Owed', value: money(unpaid), color: 'var(--blue)' },
      ].map(c => '<div class="stat-card" style="--stat-color:' + c.color + '"><div class="stat-label">' + c.label + '</div><div class="stat-value" style="font-size:19px;">' + c.value + '</div></div>').join('');

      // ---- Summary per driver ----
      const byDriver = {};
      loads.forEach(l => {
        const key = l.driverId || l.driverName || 'unknown';
        if (!byDriver[key]) byDriver[key] = { id: l.driverId, name: l.driverName || '—', loads: 0, gross: 0, pay: 0, ded: 0, unpaid: 0 };
        const b = byDriver[key];
        b.loads++; b.gross += Number(l.brokerRate || 0); b.pay += driverPayOf(l); b.ded += Number(l.driverDeduction || 0);
        if (!l.driverPaid) b.unpaid += driverNetOf(l);
      });
      document.getElementById('dp-summary-body').innerHTML = Object.values(byDriver)
        .sort((a, b) => (b.pay - b.ded) - (a.pay - a.ded))
        .map(b => {
          const drv = STATE.drivers.find(x => x.id === b.id) || {};
          const pct = drv.payPct != null ? drv.payPct : defaultDriverPayPct();
          return '<tr>' +
            '<td class="cell-strong">' + b.name + '</td>' +
            '<td class="cell-dim">' + (drv.company || '—') + '</td>' +
            '<td class="cell-mono">' + pct + '%</td>' +
            '<td>' + b.loads + '</td>' +
            '<td class="cell-mono">' + money(b.gross) + '</td>' +
            '<td class="cell-mono">' + money(b.pay) + '</td>' +
            '<td class="cell-mono">' + (b.ded ? '-' + money(b.ded) : money(0)) + '</td>' +
            '<td class="cell-mono" style="color:var(--yellow);">' + money(b.pay - b.ded) + '</td>' +
            '<td class="cell-mono" style="color:' + (b.unpaid > 0 ? 'var(--blue)' : 'var(--green)') + ';">' + money(b.unpaid) + '</td>' +
            '<td><div class="row-actions"><button class="btn btn-sm btn-ghost" onclick="exportDriverStatement(\'' + (b.id || '') + '\')">Statement</button></div></td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="10" class="cell-dim">No settlements match this filter.</td></tr>';

      // ---- Load-by-load ----
      const sorted = loads.slice().sort((a, b) => (settlementDateOf(b) || '').localeCompare(settlementDateOf(a) || ''));
      document.getElementById('dp-loads-body').innerHTML = sorted.map(l =>
        '<tr>' +
        '<td class="cell-mono cell-strong" style="cursor:pointer;" onclick="openLoadModal(\'' + l.id + '\')">' + l.loadNumber + '</td>' +
        '<td>' + fmtDate(settlementDateOf(l)) + '</td>' +
        '<td>' + (l.driverName || '—') + '</td>' +
        '<td class="cell-dim" title="' + escapeAttr([l.pickup, l.dropoff].filter(Boolean).join(' → ')) + '">' + escapeAttr(formatCityStateLane(l.pickup, l.dropoff)) + '</td>' +
        '<td>' + placard(l.status) + '</td>' +
        '<td class="cell-mono">' + money(l.brokerRate) + '</td>' +
        '<td class="cell-mono">' + (l.driverPayPct != null ? l.driverPayPct : driverPayPctFor(l.driverId)) + '%</td>' +
        '<td class="cell-mono">' + money(driverPayOf(l)) + '</td>' +
        '<td><input type="number" min="0" step="0.01" value="' + Number(l.driverDeduction || 0) + '" style="width:92px;padding:5px 8px;" onchange="setDriverDeduction(\'' + l.id + '\', this.value)"></td>' +
        '<td class="cell-mono" style="color:var(--yellow);">' + money(driverNetOf(l)) + '</td>' +
        '<td><div class="row-actions" style="align-items:center;gap:8px;">' +
        paymentStatusPlacard(l) +
        '<button class="btn btn-sm btn-ghost" onclick="toggleDriverPaid(\'' + l.id + '\')">' + ((l.paymentStatus === 'UNPAID' || !l.driverPaid) ? 'Mark Paid' : 'Undo') + '</button>' +
        '</div></td>' +
        '</tr>'
      ).join('') || '<tr><td colspan="11" class="cell-dim">No loads match this filter.</td></tr>';

      document.getElementById('dp-loads-summary').textContent =
        sorted.length + (sorted.length === 1 ? ' load' : ' loads') + ' · ' + money(net) + ' net due · ' + money(unpaid) + ' still unpaid.';
      window._driverPayLoads = sorted;
    }
    function setDriverDeduction(loadId, val) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can change driver settlements.');
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      l.driverDeduction = Math.max(0, parseFloat(val) || 0);
      l.driverPay = driverPayOf(l);
      persist();
      if (document.getElementById('view-driverpay').classList.contains('active')) renderDriverPay();
      if (document.getElementById('modal-load').classList.contains('active')) openLoadModal(loadId);
    }
    function setDriverPayNote(loadId, val) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can change driver settlements.');
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      l.driverPayNote = String(val || '').trim();
      persist();
    }
    function paymentStatusPlacard(l) {
      const st = l.paymentStatus || (l.driverPayAccepted ? 'PAID_CONFIRMED' : (l.driverPaid ? 'PAYMENT_PENDING_CONFIRMATION' : 'UNPAID'));
      if (st === 'PAID_CONFIRMED') return '<span class="placard pl-green"><span class="dot"></span>Paid Confirmed' + (l.confirmedAt ? ' · ' + fmtDate(l.confirmedAt) : '') + '</span>';
      if (st === 'PAYMENT_PENDING_CONFIRMATION') return '<span class="placard pl-yellow"><span class="dot"></span>Waiting Driver Confirmation' + (l.markedPaidAt ? ' · ' + fmtDate(l.markedPaidAt) : '') + '</span>';
      if (st === 'PAYMENT_DISPUTED') return '<span class="placard pl-red"><span class="dot"></span>Payment Disputed' + (l.disputedAt ? ' · ' + fmtDate(l.disputedAt) : '') + '</span>';
      return '<span class="placard pl-gray"><span class="dot"></span>Unpaid</span>';
    }
    function notifyDriverPaid(l) {
      if (!l.driverId) return;
      fetch('/api/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: currentAccountId(), role: STATE.role,
          toType: 'driver', toId: l.driverId,
          type: 'payment_paid',
          title: '💰 Payment Recorded',
          body: 'Load #' + (l.loadNumber || l.id) + ' has been marked as paid. Please confirm once payment is received.',
          data: { loadId: l.id },
        })
      }).catch(() => { });
    }
    function toggleDriverPaid(loadId) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can settle driver pay.');
      const l = STATE.loads.find(x => x.id === loadId); if (!l) return;
      const isPaidNow = !(l.paymentStatus === 'PAYMENT_PENDING_CONFIRMATION' || l.paymentStatus === 'PAID_CONFIRMED' || l.driverPaid);
      if (isPaidNow) {
        l.paymentStatus = 'PAYMENT_PENDING_CONFIRMATION';
        l.driverPaid = true;
        l.markedPaidAt = new Date().toISOString();
        l.markedPaidBy = STATE.currentUser ? STATE.currentUser.name : 'Admin';
        l.driverPaidDate = l.markedPaidAt.slice(0, 10);
        l.driverPay = driverPayOf(l);
        l.driverPayAccepted = false; l.driverPayAcceptedAt = null; l.confirmedAt = null; l.disputedAt = null;
        notifyDriverPaid(l);
        if (l.docs.RC && l.docs.BOL && l.docs.POD) { autoDriveArchive(l).catch(() => { }); }
        toast('Payment recorded', l.loadNumber + ' marked paid — waiting driver confirmation.', true);
      } else {
        l.paymentStatus = 'UNPAID';
        l.driverPaid = false;
        l.driverPaidDate = null;
        l.markedPaidAt = null; l.markedPaidBy = null; l.confirmedAt = null; l.disputedAt = null;
        l.driverPayAccepted = false; l.driverPayAcceptedAt = null;
        toast('Marked unpaid', l.loadNumber + ' reset to unpaid.', false);
      }
      persist();
      if (document.getElementById('view-driverpay').classList.contains('active')) renderDriverPay();
      if (document.getElementById('modal-load').classList.contains('active')) openLoadModal(loadId);
    }
    function markFilteredDriverPaid() {
      if (STATE.role !== 'admin') return toast('Admin only', 'Only Admin can settle driver pay.');
      const loads = (window._driverPayLoads || driverPayFilteredLoads()).filter(l => !l.driverPaid);
      if (!loads.length) return toast('Nothing to settle', 'Every load in this filter is already marked paid.');
      const total = loads.reduce((s, l) => s + driverNetOf(l), 0);
      if (!confirm('Mark ' + loads.length + ' load(s) as paid — ' + money(total) + ' total?')) return;
      const today = new Date().toISOString().slice(0, 10);
      loads.forEach(l => { l.driverPaid = true; l.driverPaidDate = today; l.driverPay = driverPayOf(l); l.driverPayAccepted = false; l.driverPayAcceptedAt = null; notifyDriverPaid(l); });
      persist();
      renderDriverPay();
      toast('Settlement recorded', loads.length + ' load(s) · ' + money(total), true);
    }
    /* Rows shared by the CSV / Excel / per-driver statement exports. */
    function driverPayExportRows(loads) {
      return loads.map(l => ({
        'Settlement Date': settlementDateOf(l),
        'Load Number': l.loadNumber,
        'Driver': l.driverName,
        'Driver Company': (STATE.drivers.find(d => d.id === l.driverId) || {}).company || '',
        'Truck': l.truck || '',
        'Broker': l.brokerName,
        'Pickup': l.pickup,
        'Drop-Off': l.dropoff,
        'Miles': l.miles,
        'Gross Rate': Number(l.brokerRate || 0),
        'Driver Pay %': (l.driverPayPct != null ? l.driverPayPct : driverPayPctFor(l.driverId)),
        'Driver Pay': driverPayOf(l),
        'Deduction': Number(l.driverDeduction || 0),
        'Net Due': driverNetOf(l),
        'Company Margin': companyMarginOf(l),
        'Load Stage': l.status,
        'Settlement': l.driverPaid ? 'Paid' : 'Unpaid',
        'Paid Date': l.driverPaidDate || '',
        'Note': l.driverPayNote || '',
      }));
    }
    function rowsToCSV(rows) {
      if (!rows.length) return '';
      const cols = Object.keys(rows[0]);
      return [cols.join(',')].concat(rows.map(r => cols.map(c => '"' + String(r[c] ?? '').replace(/"/g, '""') + '"').join(','))).join('\n');
    }
    function exportDriverPayCSV() {
      if (STATE.role !== 'admin') return toast('Admin only', 'Driver pay exports are Admin only.');
      const rows = driverPayExportRows(window._driverPayLoads || driverPayFilteredLoads());
      if (!rows.length) return toast('Nothing to export', 'No settlements match this filter.');
      downloadBlob(rowsToCSV(rows), 'haulbox-driver-pay.csv', 'text/csv');
      toast('CSV exported', rows.length + ' settlement row(s)', true);
    }
    function exportDriverPayXLSX() {
      if (STATE.role !== 'admin') return toast('Admin only', 'Driver pay exports are Admin only.');
      const rows = driverPayExportRows(window._driverPayLoads || driverPayFilteredLoads());
      if (!rows.length) return toast('Nothing to export', 'No settlements match this filter.');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Driver Pay');
      XLSX.writeFile(wb, 'haulbox-driver-pay.xlsx');
      toast('Excel exported', rows.length + ' settlement row(s)', true);
    }
    /* One driver's settlement statement, using the same filters that are on screen. */
    function exportDriverStatement(driverId) {
      if (STATE.role !== 'admin') return toast('Admin only', 'Driver pay exports are Admin only.');
      const all = window._driverPayLoads || driverPayFilteredLoads();
      const loads = all.filter(l => l.driverId === driverId);
      if (!loads.length) return toast('Nothing to export', 'No settlements for this driver in the current filter.');
      const drv = STATE.drivers.find(d => d.id === driverId) || { name: 'Driver' };
      const rows = driverPayExportRows(loads);
      const totals = {
        'Settlement Date': 'TOTAL', 'Load Number': '', 'Driver': drv.name, 'Driver Company': '', 'Truck': '', 'Broker': '',
        'Pickup': '', 'Drop-Off': '', 'Miles': loads.reduce((s, l) => s + Number(l.miles || 0), 0),
        'Gross Rate': loads.reduce((s, l) => s + Number(l.brokerRate || 0), 0),
        'Driver Pay %': '', 'Driver Pay': loads.reduce((s, l) => s + driverPayOf(l), 0),
        'Deduction': loads.reduce((s, l) => s + Number(l.driverDeduction || 0), 0),
        'Net Due': loads.reduce((s, l) => s + driverNetOf(l), 0),
        'Company Margin': loads.reduce((s, l) => s + companyMarginOf(l), 0),
        'Load Stage': '', 'Settlement': '', 'Paid Date': '', 'Note': '',
      };
      rows.push(totals);
      downloadBlob(rowsToCSV(rows), sanitizeFilename(drv.name + ' - settlement.csv'), 'text/csv');
      toast('Statement exported', drv.name + ' · ' + loads.length + ' load(s)', true);
    }

    /* ================= BROKERS ================= */
    function renderBrokers() {
      document.getElementById('brokers-body').innerHTML = STATE.brokers.map(b => {
        const loads = visibleLoads().filter(l => l.brokerId === b.id);
        const total = loads.reduce((s, l) => s + Number(l.brokerRate || 0), 0);
        return '<tr><td class="cell-strong">' + b.name + '</td><td class="cell-mono">' + b.mc + '</td><td>' + b.phone + '</td><td class="cell-dim">' + b.email + '</td><td>' + loads.length + '</td><td class="cell-mono">' + money(total) + '</td>' +
          '<td><div class="row-actions"><button class="icon-mini" onclick="openBrokerModal(\'' + b.id + '\')" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button></div></td></tr>';
      }).join('');
    }
    function openBrokerModal(id) {
      const isEdit = !!id;
      document.getElementById('broker-modal-title').textContent = isEdit ? 'Edit Broker' : 'Add Broker';
      const b = isEdit ? STATE.brokers.find(x => x.id === id) : {};
      document.getElementById('b-id').value = id || '';
      document.getElementById('b-name').value = b.name || '';
      document.getElementById('b-mc').value = b.mc || '';
      document.getElementById('b-phone').value = b.phone || '';
      document.getElementById('b-email').value = b.email || '';
      document.getElementById('b-notes').value = b.notes || '';
      const bMcHint = document.getElementById('b-mc-hint');
      if (bMcHint) bMcHint.textContent = '';
      openModal('modal-broker');
    }
    function saveBroker(e) {
      e.preventDefault();
      const id = document.getElementById('b-id').value;
      const rec = {
        id: id || uid('brk'),
        name: document.getElementById('b-name').value.trim(),
        mc: document.getElementById('b-mc').value.trim(),
        phone: document.getElementById('b-phone').value.trim(),
        email: document.getElementById('b-email').value.trim(),
        notes: document.getElementById('b-notes').value.trim(),
      };
      if (id) { STATE.brokers = STATE.brokers.map(x => x.id === id ? rec : x); }
      else { STATE.brokers.push(rec); }
      persist(); closeModal('modal-broker'); renderBrokers(); populateDropdowns(); renderSettings();
      toast('Broker saved', rec.name, true);
      return false;
    }

    /* ================= STATISTICS ================= */
    function populateStatFilters() {
      document.getElementById('stat-driver').innerHTML = '<option value="">All Drivers</option>' + visibleDrivers().map(d => '<option value="' + d.id + '">' + d.name + '</option>').join('');
      document.getElementById('stat-broker').innerHTML = '<option value="">All Brokers</option>' + STATE.brokers.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('');
      const dispSel = document.getElementById('stat-dispatcher');
      if (dispSel) dispSel.innerHTML = '<option value="">All Dispatchers</option>' + STATE.dispatchers.map(d => '<option value="' + d.id + '">' + d.name + '</option>').join('');
    }
    function onStatRangeChanged() {
      const range = document.getElementById('stat-range').value;
      const fromWrap = document.getElementById('stat-range-from-wrap');
      const toWrap = document.getElementById('stat-range-to-wrap');
      const show = range === 'custom';
      if (fromWrap) fromWrap.style.display = show ? 'flex' : 'none';
      if (toWrap) toWrap.style.display = show ? 'flex' : 'none';
      renderStatistics();
    }
    function renderStatistics() {
      const driverF = document.getElementById('stat-driver').value;
      const brokerF = document.getElementById('stat-broker').value;
      const rangeF = document.getElementById('stat-range').value;
      const fromF = rangeF === 'custom' ? (document.getElementById('stat-range-from') || {}).value : null;
      const toF = rangeF === 'custom' ? (document.getElementById('stat-range-to') || {}).value : null;
      const dispF = STATE.role === 'admin' && document.getElementById('stat-dispatcher') ? document.getElementById('stat-dispatcher').value : '';
      const loads = visibleLoads().filter(l =>
        (!driverF || l.driverId === driverF) && (!brokerF || l.brokerId === brokerF) && (!dispF || l.dispatcherId === dispF) && within(l.systemDate, rangeF, fromF, toF)
      );
      const gross = loads.reduce((s, l) => s + Number(l.brokerRate || 0), 0);
      const dispatchRev = loads.reduce((s, l) => s + Number(l.dispatchRevenue || 0), 0);
      const byDriverTotal = {};
      loads.forEach(l => { byDriverTotal[l.driverName] = (byDriverTotal[l.driverName] || 0) + Number(l.dispatchRevenue || 0); });
      const topDriver = Object.entries(byDriverTotal).sort((a, b) => b[1] - a[1])[0];

      document.getElementById('company-stat-grid').innerHTML = [
        { label: 'Loads (filtered)', value: loads.length, color: 'var(--accent)' },
        { label: 'Total Gross', value: money(gross), color: 'var(--green)' },
        { label: 'Dispatch Revenue', value: money(dispatchRev), color: 'var(--yellow)' },
        { label: 'Top Driver', value: topDriver ? topDriver[0] : '—', color: 'var(--blue)' },
      ].map(s => '<div class="stat-card" style="--stat-color:' + s.color + '"><div class="stat-label">' + s.label + '</div><div class="stat-value" style="font-size:19px;">' + s.value + '</div></div>').join('');

      const byDriver = {};
      loads.forEach(l => {
        if (!byDriver[l.driverName]) byDriver[l.driverName] = { loads: 0, gross: 0, rev: 0, active: 0 };
        byDriver[l.driverName].loads++; byDriver[l.driverName].gross += Number(l.brokerRate || 0); byDriver[l.driverName].rev += Number(l.dispatchRevenue || 0);
        if (l.status !== 'Drop-off') byDriver[l.driverName].active++;
      });
      document.getElementById('driverstats-body').innerHTML = Object.entries(byDriver).map(([name, s]) =>
        '<tr><td class="cell-strong">' + name + '</td><td>' + s.loads + '</td><td class="cell-mono">' + money(s.gross) + '</td><td class="cell-mono">' + money(s.rev) + '</td><td class="cell-mono">' + money(s.rev / s.loads) + '</td><td>' + s.active + '</td></tr>'
      ).join('') || '<tr><td colspan="6" class="cell-dim">No data for this filter.</td></tr>';

      const byBroker = {};
      loads.forEach(l => {
        if (!byBroker[l.brokerName]) byBroker[l.brokerName] = { loads: 0, gross: 0 };
        byBroker[l.brokerName].loads++; byBroker[l.brokerName].gross += Number(l.brokerRate || 0);
      });
      document.getElementById('brokerstats-body').innerHTML = Object.entries(byBroker).map(([name, s]) =>
        '<tr><td class="cell-strong">' + name + '</td><td>' + s.loads + '</td><td class="cell-mono">' + money(s.gross) + '</td></tr>'
      ).join('') || '<tr><td colspan="3" class="cell-dim">No data for this filter.</td></tr>';

      // Full list of the loads that make up the stats above, sorted most-recent first.
      const sortedLoads = loads.slice().sort((a, b) => (b.systemDate || '').localeCompare(a.systemDate || ''));
      const isAdmin = STATE.role === 'admin';
      document.getElementById('stat-loads-body').innerHTML = sortedLoads.map(l =>
        '<tr onclick="openLoadModal(\'' + l.id + '\')" style="cursor:pointer;">' +
        '<td class="cell-mono cell-strong">' + l.loadNumber + '</td>' +
        '<td>' + fmtDate(l.systemDate) + '</td>' +
        '<td>' + placard(l.status) + '</td>' +
        '<td>' + l.driverName + '</td>' +
        '<td>' + l.brokerName + '</td>' +
        '<td class="cell-dim" title="' + escapeAttr([l.pickup, l.dropoff].filter(Boolean).join(' → ')) + '">' + escapeAttr(formatCityStateLane(l.pickup, l.dropoff)) + '</td>' +
        '<td>' + fmtDate(l.pickupDate) + '</td>' +
        '<td>' + fmtDate(l.deliveryDate) + '</td>' +
        '<td class="cell-mono">' + money(l.brokerRate) + '</td>' +
        (isAdmin ? '<td class="cell-mono" style="color:var(--accent);" data-role-view="admin">' + money(l.dispatchRevenue) + '</td>' : '<td data-role-view="admin" style="display:none;"></td>') +
        '</tr>'
      ).join('') || '<tr><td colspan="10" class="cell-dim">No loads for this filter.</td></tr>';
      const rangeLabel = rangeF === 'custom'
        ? ((fromF || '…') + ' to ' + (toF || '…'))
        : ({ all: 'All Time', week: 'This Week', month: 'This Month', year: 'This Year' }[rangeF] || rangeF);
      document.getElementById('stat-loads-summary').textContent = loads.length + (loads.length === 1 ? ' load' : ' loads') + ' found for ' + rangeLabel + '.';

      window._filteredLoads = loads;
    }
    function exportCSV() {
      const loads = window._filteredLoads || visibleLoads();
      const cols = ['Date', 'Load Number', 'Dispatcher', 'Broker', 'MC Number', 'Broker Contact Email', 'Driver Name', 'Pickup', 'Drop-Off', 'Pickup Date', 'Delivery Date', 'Miles', 'Broker Rate', 'Rate per Mile', 'Dispatch Fee %', 'Dispatch Revenue', 'Status', 'Payment'];
      const rows = loads.map(l => [l.systemDate, l.loadNumber, l.dispatcherName, l.brokerName, l.brokerMC, l.brokerEmail, l.driverName, l.pickup, l.dropoff, l.pickupDate, l.deliveryDate, l.miles, l.brokerRate, l.ratePerMile, l.feePct, l.dispatchRevenue, l.status, paymentOf(l) || '—']);
      const csv = [cols.join(',')].concat(rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))).join('\n');
      downloadBlob(csv, 'haulbox-report.csv', 'text/csv');
      toast('CSV exported', '', true);
    }
    function exportXLSX() {
      const loads = window._filteredLoads || visibleLoads();
      const rows = loads.map(l => ({ Date: l.systemDate, 'Load Number': l.loadNumber, Dispatcher: l.dispatcherName, Broker: l.brokerName, 'MC Number': l.brokerMC, 'Broker Contact Email': l.brokerEmail, 'Driver Name': l.driverName, Pickup: l.pickup, 'Drop-Off': l.dropoff, 'Pickup Date': l.pickupDate, 'Delivery Date': l.deliveryDate, Miles: l.miles, 'Broker Rate': l.brokerRate, 'Rate per Mile': l.ratePerMile, 'Dispatch Fee %': l.feePct, 'Dispatch Revenue': l.dispatchRevenue, Status: l.status, Payment: paymentOf(l) || '—' }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Loads');
      XLSX.writeFile(wb, 'haulbox-report.xlsx');
      toast('Excel exported', '', true);
    }
    function downloadBlob(content, filename, mime) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    /* ================= DOCUMENTS ================= */
    function renderDocsList() {
      const q = (document.getElementById('docs-search').value || '').toLowerCase();
      const rows = visibleLoads().filter(l => !q || (l.loadNumber + ' ' + l.driverName).toLowerCase().includes(q));
      document.getElementById('docs-body').innerHTML = rows.map(l => {
        const dot = (v) => v ? '<span style="color:var(--green);">●</span>' : '<span style="color:var(--text-faint);">○</span>';
        const anyDocs = l.docs.RC || l.docs.BOL || l.docs.POD || (l.docs.PhotosPU && l.docs.PhotosPU.length) || (l.docs.PhotosDO && l.docs.PhotosDO.length) || (l.docs.Extra && l.docs.Extra.length);
        return '<tr onclick="openLoadModal(\'' + l.id + '\')"><td class="cell-mono cell-strong">' + l.loadNumber + '</td><td>' + l.driverName + '</td><td class="cell-dim" title="' + escapeAttr([l.pickup, l.dropoff].filter(Boolean).join(' → ')) + '">' + escapeAttr(formatCityStateLane(l.pickup, l.dropoff)) + '</td>' +
          '<td>' + dot(l.docs.RC) + '</td><td>' + dot(l.docs.PhotosPU && l.docs.PhotosPU.length) + '</td><td>' + dot(l.docs.PhotosDO && l.docs.PhotosDO.length) + '</td><td>' + dot(l.docs.BOL) + '</td><td>' + dot(l.docs.POD) + '</td><td>' + dot(l.docs.Extra && l.docs.Extra.length) + '</td>' +
          '<td>' + (anyDocs ? '<a href="#" onclick="event.stopPropagation();downloadPackage(\'' + l.id + '\')" style="color:var(--blue);">Download</a>' : '<span class="cell-faint" style="color:var(--text-faint);">—</span>') + '</td>' +
          '<td onclick="event.stopPropagation()"><button class="btn btn-sm" onclick="openLoadModal(\'' + l.id + '\')">Manage</button></td></tr>';
      }).join('');
    }

    /* ================= SETTINGS ================= */
    function renderSettings() {
      const s = STATE.settings || {};
      document.getElementById('s-companyname').value = s.companyName || '';
      updateBranding();
      document.getElementById('s-defaultfee').value = s.defaultFeePct || 10;
      const dpDefault = document.getElementById('s-defaultdriverpay');
      if (dpDefault) dpDefault.value = defaultDriverPayPct();
      document.getElementById('s-zipformat').value = s.zipFormat || '';
      document.getElementById('s-ai-apikey').value = s.aiApiKey || '';
      document.getElementById('s-ai-enabled').value = s.aiExtractEnabled === false ? 'off' : 'on';
      const provider = ['gemini', 'ocrspace', 'mistral'].includes(s.aiProvider) ? s.aiProvider : 'claude';
      document.getElementById('s-ai-provider').value = provider;
      document.getElementById('s-ai-geminikey').value = s.aiGeminiKey || '';
      document.getElementById('s-ai-geminimodel').value = s.aiGeminiModel || '';
      document.getElementById('s-ai-mistralkey').value = s.aiMistralKey || '';
      document.getElementById('s-ai-mistralmodel').value = s.aiMistralModel || '';
      document.getElementById('s-ai-ocrspacekey').value = s.aiOcrSpaceKey || '';
      document.getElementById('s-ai-claude-wrap').style.display = provider === 'claude' ? 'block' : 'none';
      document.getElementById('s-ai-gemini-wrap').style.display = provider === 'gemini' ? 'block' : 'none';
      document.getElementById('s-ai-geminimodel-wrap').style.display = provider === 'gemini' ? 'block' : 'none';
      document.getElementById('s-ai-mistral-wrap').style.display = provider === 'mistral' ? 'block' : 'none';
      document.getElementById('s-ai-mistralmodel-wrap').style.display = provider === 'mistral' ? 'block' : 'none';
      document.getElementById('s-ai-ocrspace-wrap').style.display = provider === 'ocrspace' ? 'block' : 'none';

      // Driver Portal Module Configuration
      const dpMaster = document.getElementById('s-dp-master-enabled');
      if (dpMaster) dpMaster.value = s.driver_portal_enabled === false ? 'off' : 'on';
      const dpChat = document.getElementById('s-dp-chat-enabled');
      if (dpChat) dpChat.value = s.driver_chat_enabled === false ? 'off' : 'on';
      const dpUpload = document.getElementById('s-dp-upload-enabled');
      if (dpUpload) dpUpload.value = s.driver_upload_enabled === false ? 'off' : 'on';
      const dpTracking = document.getElementById('s-dp-tracking-enabled');
      if (dpTracking) dpTracking.value = s.driver_tracking_enabled === false ? 'off' : 'on';
      const dpEarnings = document.getElementById('s-dp-earnings-enabled');
      if (dpEarnings) dpEarnings.value = s.driver_earnings_enabled === false ? 'off' : 'on';
      const dpPayments = document.getElementById('s-dp-payments-enabled');
      if (dpPayments) dpPayments.value = s.driver_payments_enabled === false ? 'off' : 'on';
      const dpNotifs = document.getElementById('s-dp-notifs-enabled');
      if (dpNotifs) dpNotifs.value = s.driver_notifications_enabled === false ? 'off' : 'on';

      updateDriverPortalUI();

      document.getElementById('tmpl-rc-subject').value = s.rcSubject || '';
      document.getElementById('tmpl-rc-body').value = s.rcBody || '';
      document.getElementById('tmpl-bol-subject').value = s.bolSubject || '';
      document.getElementById('tmpl-bol-body').value = s.bolBody || '';
      document.getElementById('tmpl-pod-subject').value = s.podSubject || '';
      document.getElementById('tmpl-pod-body').value = s.podBody || '';
      document.getElementById('s-google-account').value = s.googleAccountEmail || '';
      document.getElementById('s-gmail-enabled').value = s.gmailEnabled ? 'on' : 'off';
      setIntegrationUI('sheets', s.sheetsConnected);
      renderGoogleConnectionPill();
      renderGmailConnectionStatus();
      document.getElementById('settings-driver-list').innerHTML = STATE.drivers.map(d => {
        const dispName = d.dispatcherId ? (STATE.dispatchers.find(x => x.id === d.dispatcherId) || {}).name : null;
        return '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px;border-bottom:1px solid var(--border-soft);"><span>' + d.name + ' <span class="cell-dim" style="color:var(--text-faint)">· ' + d.truck + (dispName ? ' · assigned to ' + dispName : ' · unassigned (admin only)') + '</span></span><button class="btn btn-sm btn-ghost" onclick="openDriverModal(\'' + d.id + '\')">Edit</button></div>';
      }).join('');
      document.getElementById('settings-broker-list').innerHTML = STATE.brokers.map(b =>
        '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px;border-bottom:1px solid var(--border-soft);"><span>' + b.name + ' <span class="cell-dim" style="color:var(--text-faint)">· ' + b.mc + '</span></span><button class="btn btn-sm btn-ghost" onclick="openBrokerModal(\'' + b.id + '\')">Edit</button></div>'
      ).join('');
      const cp = document.getElementById('s-current-profile');
      if (cp) cp.textContent = (STATE.currentUser ? STATE.currentUser.name : '') + (STATE.role === 'admin' ? ' (Admin)' : ' (Dispatcher)');
      renderShareList();
    }
    // Admin-only page: manage dispatchers and see their booked-load / driver-assignment performance.
    function renderDispatchersPage() {
      const dispList = document.getElementById('settings-dispatcher-list');
      if (dispList) {
        dispList.innerHTML = STATE.dispatchers.map(d => {
          const count = STATE.loads.filter(l => l.dispatcherId === d.id).length;
          const googleConnected = !!(d.gmailConnected && d.driveConnected);
          const googleBadge = googleConnected
            ? '<span class="placard pl-green" style="margin-left:6px;" title="Reply-All + Drive saves for this dispatcher go out from this account"><span class="dot"></span>' + escapeAttr(d.googleAccountEmail || '') + '</span>'
            : '<span class="placard pl-gray" style="margin-left:6px;" title="This dispatcher has not connected their own Google account yet"><span class="dot"></span>No Google account connected</span>';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:12.5px;border-bottom:1px solid var(--border-soft);flex-wrap:wrap;gap:6px;"><span><b>' + d.name + '</b> <span class="cell-dim" style="color:var(--text-faint)">· ' + (d.email || 'no email') + ' · ' + count + ' load(s)</span>' + googleBadge + '</span>' +
            '<div class="row-actions"><button class="icon-mini" onclick="openDispatcherModal(\'' + d.id + '\')" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' +
            '<button class="icon-mini" onclick="deleteDispatcher(\'' + d.id + '\')" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button></div></div>';
        }).join('') || '<p class="cell-dim" style="font-size:12px;">No dispatchers yet — add one above.</p>';
      }
      renderDispatcherPerformance();
    }
    // Admin-only overview: how many loads each dispatcher has booked, how many drivers they
    // have assigned, and how many of those drivers are empty vs. busy right now.
    function renderDispatcherPerformance() {
      const body = document.getElementById('dispatcher-performance-body');
      if (!body) return;
      body.innerHTML = STATE.dispatchers.map(d => {
        const loadsBooked = STATE.loads.filter(l => l.dispatcherId === d.id).length;
        const assigned = STATE.drivers.filter(dr => dr.dispatcherId === d.id);
        const empty = assigned.filter(dr => dr.active && driverAvailability(dr.id).available).length;
        const busy = assigned.filter(dr => dr.active && !driverAvailability(dr.id).available).length;
        return '<tr><td class="cell-strong">' + d.name + '</td><td>' + loadsBooked + '</td><td>' + assigned.length + '</td>' +
          '<td class="cell-mono" style="color:var(--green);">' + empty + '</td><td class="cell-mono" style="color:var(--yellow);">' + busy + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="cell-dim">No dispatchers yet.</td></tr>';
    }
    function openDispatcherModal(id) {
      const isEdit = !!id;
      document.getElementById('dispatcher-modal-title').textContent = isEdit ? 'Edit Dispatcher' : 'Add Dispatcher';
      const d = isEdit ? STATE.dispatchers.find(x => x.id === id) : {};
      document.getElementById('disp-id').value = id || '';
      document.getElementById('disp-name').value = d.name || '';
      document.getElementById('disp-email').value = d.email || '';
      openModal('modal-dispatcher');
    }
    function saveDispatcher(e) {
      e.preventDefault();
      const id = document.getElementById('disp-id').value;
      const rec = {
        id: id || uid('dsp'),
        name: document.getElementById('disp-name').value.trim(),
        email: document.getElementById('disp-email').value.trim(),
      };
      if (id) {
        STATE.dispatchers = STATE.dispatchers.map(x => x.id === id ? rec : x);
        STATE.loads.forEach(l => { if (l.dispatcherId === id) l.dispatcherName = rec.name; });
      } else {
        STATE.dispatchers.push(rec);
      }
      persist(); closeModal('modal-dispatcher'); renderDispatchersPage(); populateDropdowns(); populateStatFilters(); populateViewAsField(); renderChat();
      toast('Dispatcher saved', rec.name, true);
      return false;
    }
    function deleteDispatcher(id) {
      const inUse = STATE.loads.some(l => l.dispatcherId === id);
      if (inUse) return toast('Cannot remove', 'This dispatcher still has loads assigned to them.');
      STATE.dispatchers = STATE.dispatchers.filter(x => x.id !== id);
      persist(); renderDispatchersPage(); populateDropdowns(); populateStatFilters(); populateViewAsField(); renderChat();
      toast('Dispatcher removed', '', true);
    }
    function saveSettingsField(key, val) { 
      STATE.settings[key] = val; 
      persist(); 
      if (key === 'driver_portal_enabled') updateDriverPortalUI();
    }

    // Controls client-side UI visibility and gating based on driver portal module settings
    function updateDriverPortalUI() {
      const s = STATE.settings || {};
      const isPortalEnabled = s.driver_portal_enabled !== false;
      const isChatEnabled = s.driver_chat_enabled !== false;

      // Update Settings Pills and Subsections
      const pill = document.getElementById('dp-master-pill');
      if (pill) {
        pill.textContent = isPortalEnabled ? 'Enabled' : 'Disabled (Off)';
        pill.className = 'status-pill ' + (isPortalEnabled ? 'connected' : 'off');
      }
      const advWrap = document.getElementById('dp-advanced-controls');
      if (advWrap) advWrap.style.opacity = isPortalEnabled ? '1' : '0.45';

      // Login Gate: Hide/Show Driver Login link
      const driverLoginLink = document.querySelector('#login-gate a[onclick*="showDriverLogin"]');
      if (driverLoginLink && driverLoginLink.parentElement) {
        driverLoginLink.parentElement.style.display = isPortalEnabled ? 'block' : 'none';
      }

      // Add/Edit Driver Modal: Hide/Show "Driver App Login" section
      const driverAppLoginTitle = document.querySelector('#modal-driver .form-section-title[data-role-view="admin"]');
      const driverAppLoginGrid = document.querySelector('#modal-driver .form-grid[data-role-view="admin"]:nth-of-type(2)');
      if (driverAppLoginTitle) driverAppLoginTitle.style.display = isPortalEnabled ? '' : 'none';
      if (driverAppLoginGrid) driverAppLoginGrid.style.display = isPortalEnabled ? '' : 'none';

      // Driver App Login Details in Add/Edit Driver Modal
      const driverLoginShareBlock = document.getElementById('d-driver-link');
      if (driverLoginShareBlock && driverLoginShareBlock.parentElement) {
        driverLoginShareBlock.parentElement.style.display = isPortalEnabled ? '' : 'none';
      }

      // Sidebar Chat Nav Item (Hide when chat or portal is OFF for non-admins if desired, or keep team chat)
      // When Driver portal is off, driver-only app screens never load.
    }
    async function handleLogoUpload(input) {
      if (!input.files || !input.files.length) return;
      const file = input.files[0];
      try {
        const dataUrl = await readFileAsDataURL(file);
        STATE.settings.companyLogo = dataUrl;
        persist();
        updateBranding();
        toast('Logo updated', file.name, true);
      } catch (e) { toast('Could not read that file', ''); }
    }
    function clearLogo() {
      STATE.settings.companyLogo = null;
      const input = document.getElementById('s-logo-input'); if (input) input.value = '';
      persist(); updateBranding();
      toast('Logo removed', '', true);
    }
    // Applies the company name/logo across the sidebar, login screens, and tab title.
    function updateBranding() {
      const s = STATE.settings || {};
      // HAULBOX is the permanent product name and is never overwritten by a company name —
      // only the subtitle beneath it (and the browser tab title) reflect the company on this account.
      const name = (s.companyName || '').trim();
      const defaultMarkImg = '<img src="assets/haulbox-logo-icon.png" alt="HaulBoX" style="width:100%;height:100%;object-fit:contain;">';
      const markHtml = s.companyLogo ? '<img src="' + s.companyLogo + '" style="width:100%;height:100%;object-fit:cover;">' : defaultMarkImg;
      ['brand-mark', 'login-mark'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = markHtml; });
      const brandSub = document.getElementById('brand-sub'); if (brandSub) brandSub.textContent = name || 'Dispatch Command';
      document.title = 'HaulBoX — Dispatch Command' + (name ? ' · ' + name : '');
      const logoPreview = document.getElementById('s-logo-preview');
      if (logoPreview) logoPreview.innerHTML = s.companyLogo ? '<img src="' + s.companyLogo + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:9px;color:var(--text-faint);">No logo</span>';
    }
    function saveTemplateField(key, val) { STATE.settings[key] = val; persist(); }
    function setIntegrationUI(name, connected) {
      document.getElementById(name + '-pill').textContent = connected ? 'Connected' : 'Not Connected';
      document.getElementById(name + '-pill').className = 'status-pill ' + (connected ? 'connected' : 'off');
      const btn = document.getElementById(name + '-btn');
      if (btn) btn.textContent = connected ? 'Disconnect' : 'Connect';
    }
    function toggleIntegration(name) {
      const key = name + 'Connected';
      STATE.settings[key] = !STATE.settings[key];
      persist(); setIntegrationUI(name, STATE.settings[key]);
      toast(STATE.settings[key] ? 'Connected (simulated)' : 'Disconnected', 'Google Sheets', STATE.settings[key]);
    }
    // Google row's pill just reflects gmailConnected/driveConnected — both are always flipped
    // together by connectGoogleAccount()/disconnectGoogleAccount() below, since it's one account.
    function renderGoogleConnectionPill() {
      const pill = document.getElementById('google-pill');
      if (!pill) return;
      const s = STATE.settings;
      const connected = !!(s.gmailConnected && s.driveConnected);
      pill.textContent = connected ? ('Connected · ' + (s.googleAccountEmail || '')) : 'Not Connected';
      pill.className = 'status-pill ' + (connected ? 'connected' : 'off');
      const sub = document.getElementById('google-sub');
      if (sub) sub.textContent = connected
        ? 'Connected as ' + (s.googleAccountEmail || '') + ' — used for Reply-All BOL/POD in Gmail and Save Package to Drive.'
        : 'One Google sign-in, shared by both — Reply-All BOL/POD in Gmail and Save Package to Drive. Configured below.';
    }

    /* ================= GOOGLE ACCOUNT SETTINGS (shared by Gmail + Drive) ================= */
    // This prototype has no server to complete a real Google OAuth handshake, so Connect /
    // Disconnect / Test / Send Test Email are clearly-labeled simulated flows that mirror what a
    // live integration would store (account email, tokens, status, last sync). One connected
    // account authorizes BOTH Gmail sends and Drive saves — wire connectGoogleAccount() to a real
    // server-side OAuth exchange (single token, gmail.send + gmail.readonly + drive.file scopes)
    // to go live.
    function renderGmailConnectionStatus() {
      const el = document.getElementById('gmail-connection-status');
      if (!el) return;
      const s = STATE.settings;
      if (s.gmailConnected && s.driveConnected) {
        el.innerHTML = '<div><b style="color:var(--text);">Connected Account:</b> ' + (s.googleAccountEmail || '—') + ' <span style="color:var(--text-faint);">(Gmail + Drive)</span></div>' +
          '<div><b style="color:var(--text);">Status:</b> <span style="color:var(--green);">' + (s.gmailConnectionStatus || 'Connected') + '</span></div>' +
          '<div style="color:var(--text-faint);">Last Sync: ' + (s.gmailLastSync ? fmtDateTime(s.gmailLastSync) : 'never') + '</div>';
      } else {
        el.innerHTML = '<div><b style="color:var(--text);">Status:</b> <span style="color:var(--text-faint);">Not Connected</span></div>';
      }
    }
    function fmtDateTime(iso) {
      try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    }
    async function connectGoogleAccount() {
      const s = STATE.settings;
      try {
        const result = await openGoogleOAuthPopup('admin');
        s.gmailConnected = true;
        s.driveConnected = true;
        s.gmailEnabled = true;
        s.googleAccountEmail = result.email;
        s.gmailConnectionStatus = 'Connected';
        s.gmailLastSync = new Date().toISOString();
        persist();
        document.getElementById('s-google-account').value = result.email;
        document.getElementById('s-gmail-enabled').value = 'on';
        renderGoogleConnectionPill();
        renderGmailConnectionStatus();
        toast('Google account connected', result.email + ' — now used for both Gmail and Drive', true);
      } catch (e) {
        if (e.message === 'CLOSED') return; // user just closed the popup — no error needed
        if (e.message === 'POPUP_BLOCKED') { toast('Popup blocked', 'Allow popups for this site, then try Connect again.'); return; }
        toast('Connect failed', e.message);
      }
    }
    async function disconnectGoogleAccount() {
      const s = STATE.settings;
      if (!s.gmailConnected && !s.driveConnected) { toast('Not connected', 'No Google account is currently connected.'); return; }
      try { await backendFetch('/auth/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'admin' }) }); }
      catch (e) { /* still clear locally even if the revoke call failed */ }
      const prevEmail = s.googleAccountEmail || '';
      s.gmailConnected = false;
      s.driveConnected = false;
      s.gmailConnectionStatus = 'Disconnected';
      persist();
      renderGoogleConnectionPill();
      renderGmailConnectionStatus();
      toast('Google account disconnected', prevEmail, true);
    }
    async function testGoogleConnection() {
      const s = STATE.settings;
      if (!s.gmailConnected || !s.driveConnected) { toast('Not connected', 'Click Connect Google Account first, then test the connection.'); return; }
      try {
        const status = await backendFetch('/auth/status?accountId=admin');
        if (!status.connected) { toast('Not connected', 'The backend has no saved connection for this account — try Connect again.'); return; }
        s.gmailLastSync = new Date().toISOString();
        s.googleAccountEmail = status.email || s.googleAccountEmail;
        persist();
        renderGmailConnectionStatus();
        toast('Connection OK', 'Authenticated as ' + (status.email || '—') + ' for Gmail + Drive.', true);
      } catch (e) {
        toast('Test failed', e.message);
      }
    }
    async function sendTestEmail() {
      const s = STATE.settings;
      if (!s.gmailConnected) { toast('Not connected', 'Connect your Google account before sending a test email.'); return; }
      const to = (document.getElementById('s-gmail-test-recipient').value || '').trim() || s.googleAccountEmail;
      if (!to) { toast('Recipient required', 'Enter an email address to send the test to.'); return; }
      const subject = 'HaulBoX — Gmail API test email';
      const body = 'This is a test email confirming the Google account configuration for ' + (s.companyName || 'HaulBoX') + ' is working, sent from ' + (s.googleAccountEmail || '—') + '.';
      toast('Sending…', 'to ' + to);
      try {
        await backendFetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'admin', to, subject, body }) });
        logEmail(null, 'TEST', to, 'Sent (test)', '');
        toast('Test email sent', 'Check ' + to, true);
      } catch (e) {
        toast('Send failed', e.message);
      }
    }

    /* ================= MY ACCOUNT — PER-DISPATCHER GOOGLE CONNECTION =================
       Each dispatcher connects their OWN Google account here (not the shared company one
       above). Every Reply-All BOL/POD send and every "Save Package to Drive" always uses
       whichever account is connected for the person currently signed in — a dispatcher
       never sends through another dispatcher's or Admin's inbox, and Admin can see exactly
       which account each dispatcher has connected from the Dispatchers page.
       Admin's own personal connection still lives in the "Google Account" block in Settings
       above (STATE.settings) — myGoogleAccountHolder() just points there when role==='admin'
       so the same My Account page works for everyone. */
    // The OAuth app itself (Client ID/Secret/Project/Redirect URI) is registered once by
    // Admin in Settings — individual dispatchers only pick which Google identity to sign in
    // as; they never need their own Client ID/Secret.
    function googleAppConfigured() {
      // The OAuth app (Client ID/Secret) now lives server-side in the backend's .env — the
      // frontend never needs or sees the secret. We can't directly check the backend's env
      // from here without an extra endpoint, so this just gates on "does a backend seem to be
      // running" in the loosest sense; the real failure mode (.env not filled in) surfaces
      // clearly when Connect is clicked, since Google's own consent screen will error out.
      return true;
    }
    // Returns the record to read/write this connection on: the dispatcher's own object for a
    // dispatcher, or the shared settings object for Admin (Admin has no separate "dispatcher"
    // record of their own).
    function myGoogleAccountHolder() {
      if (STATE.role === 'dispatcher') {
        return STATE.dispatchers.find(d => d.id === STATE.currentDispatcherId) || null;
      }
      if (STATE.role === 'admin') return STATE.settings;
      return null; // view-only links don't get a Google connection
    }
    function renderMyAccount() {
      const box = document.getElementById('my-account-box');
      if (!box) return;
      const holder = myGoogleAccountHolder();
      if (!holder) {
        box.innerHTML = '<p class="cell-dim" style="font-size:12.5px;">Google account connections aren\'t available in this session.</p>';
        return;
      }
      // Auto-check connection status from backend if not connected locally yet
      if (!holder.gmailConnected && !holder._checkingStatus) {
        holder._checkingStatus = true;
        backendFetch('/auth/status?accountId=' + encodeURIComponent(currentAccountId() || 'admin')).then(st => {
          if (st && st.connected) {
            holder.gmailConnected = true;
            holder.driveConnected = true;
            holder.gmailEnabled = true;
            holder.googleAccountEmail = st.email || holder.googleAccountEmail;
            renderMyAccount();
          }
        }).catch(() => { });
      }

      const connected = !!(holder.gmailConnected && holder.driveConnected);
      box.innerHTML = `
    <div class="field" style="margin-bottom:14px;">
      <label>Google Account Email</label>
      <input type="email" id="my-google-email" placeholder="Signed in via Google's own popup" value="${escapeAttr(holder.googleAccountEmail || '')}" readonly>
      <div class="hint">${connected ? 'Connected — disconnect first to switch to a different Google account.' : 'Click Connect below to link your Google Account.'}</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span class="status-pill ${connected ? 'connected' : 'off'}">${connected ? 'Connected · ' + escapeAttr(holder.googleAccountEmail || '') : 'Not Connected'}</span>
      ${connected ? '<span class="hint" style="margin:0;">Last checked: ' + fmtDateTime(holder.gmailLastSync || '') + '</span>' : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      ${connected
          ? '<button type="button" class="btn btn-sm btn-ghost" onclick="disconnectMyGoogleAccount()">Disconnect</button><button type="button" class="btn btn-sm" onclick="testMyGoogleConnection()">Test Connection</button>'
          : '<button type="button" class="btn btn-sm btn-accent" onclick="connectMyGoogleAccount()">Connect Google Account</button>'}
    </div>
    <div class="hr"></div>
    <div class="field" style="margin-bottom:0;">
      <label>Google Sheet Sync (Option 1: Direct Link)</label>
      <div class="hint" style="margin-bottom:8px;">Share a Google Sheet with <b>${escapeAttr(holder.googleAccountEmail || 'your account')}</b> as an <b>Editor</b>, paste its link below, and every load you book — plus every status change after — writes or updates a row automatically, matched by Load #.</div>
      <input type="text" id="my-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/..." value="${escapeAttr(holder.sheetUrl || '')}" oninput="saveMySheetField('sheetUrl', this.value)" style="margin-bottom:8px;">
      <div style="display:flex;gap:8px;">
        <input type="text" id="my-sheet-tab" placeholder="Tab name — leave blank for Sheet1" value="${escapeAttr(holder.sheetTabName || '')}" oninput="saveMySheetField('sheetTabName', this.value)" style="flex:1;">
        <button type="button" class="btn btn-sm btn-ghost" onclick="testSheetSync()">Test Sync</button>
      </div>
      <div id="my-sheet-status" style="font-size:11.5px;color:var(--text-faint);margin-top:6px;"></div>
    </div>
    <div class="hr"></div>
    <div class="field" style="margin-bottom:0;">
      <label>Google Sheet Sync (Option 2: Apps Script Webhook URL - Zero Permission Required)</label>
      <div class="hint" style="margin-bottom:8px;">Alternatively, if you prefer zero Google sharing setup, create a Google Apps Script Web App on your Google Sheet and paste its Webhook URL below:</div>
      <input type="text" id="my-sheet-webhook" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeAttr(holder.sheetWebhookUrl || '')}" oninput="saveMySheetField('sheetWebhookUrl', this.value)" style="margin-bottom:8px;">
      <details style="font-size:11.5px;color:var(--text-dim);cursor:pointer;"><summary>Click to view 3-line Google Apps Script snippet</summary>
      <pre style="background:var(--bg-card);padding:8px;border-radius:6px;margin-top:6px;font-size:11px;overflow-x:auto;">
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([data.date, data.loadNumber, data.broker, data.mc, data.driver, data.pickup, data.dropoff, data.puDate, data.doDate, data.rate, data.dispatcher]);
  return ContentService.createTextOutput(JSON.stringify({result:"success"})).setMimeType(ContentService.MimeType.JSON);
}</pre>
      </details>
    </div>
  `;
    }
    function saveMySheetField(key, val) {
      const holder = myGoogleAccountHolder();
      if (!holder) return;
      holder[key] = val;
      persist();
    }
    async function connectMyGoogleAccount() {
      if (STATE.role === 'viewonly') return toast('Not available', 'Google account connections aren\'t available on a view-only link.');
      const holder = myGoogleAccountHolder();
      if (!holder) return;
      const accountId = currentAccountId();
      try {
        const result = await openGoogleOAuthPopup(accountId);
        holder.gmailConnected = true;
        holder.driveConnected = true;
        holder.gmailEnabled = true;
        holder.googleAccountEmail = result.email;
        holder.gmailConnectionStatus = 'Connected';
        holder.gmailLastSync = new Date().toISOString();
        persist();
        renderMyAccount();
        if (STATE.role === 'admin') { document.getElementById('s-google-account') && (document.getElementById('s-google-account').value = result.email); renderGoogleConnectionPill(); renderGmailConnectionStatus(); }
        renderDispatchersPage();
        toast('Google account connected', result.email, true);
      } catch (e) {
        if (e.message === 'CLOSED') return;
        if (e.message === 'POPUP_BLOCKED') { toast('Popup blocked', 'Allow popups for this site, then try Connect again.'); return; }
        toast('Connect failed', e.message);
      }
    }
    async function disconnectMyGoogleAccount() {
      const holder = myGoogleAccountHolder();
      if (!holder) return;
      if (!holder.gmailConnected && !holder.driveConnected) return toast('Not connected', 'No Google account is currently connected.');
      const prevEmail = holder.googleAccountEmail || '';
      try { await backendFetch('/auth/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: currentAccountId() }) }); }
      catch (e) { /* still clear locally even if the revoke call failed */ }
      holder.gmailConnected = false;
      holder.driveConnected = false;
      holder.gmailConnectionStatus = 'Disconnected';
      persist();
      renderMyAccount();
      if (STATE.role === 'admin') { renderGoogleConnectionPill(); renderGmailConnectionStatus(); }
      renderDispatchersPage();
      toast('Google account disconnected', prevEmail, true);
    }
    async function testMyGoogleConnection() {
      const holder = myGoogleAccountHolder();
      if (!holder || !holder.gmailConnected || !holder.driveConnected) { toast('Not connected', 'Connect your Google account first, then test.'); return; }
      try {
        const status = await backendFetch('/auth/status?accountId=' + encodeURIComponent(currentAccountId()));
        if (!status.connected) { toast('Not connected', 'The backend has no saved connection for this account — try Connect again.'); return; }
        holder.gmailLastSync = new Date().toISOString();
        holder.googleAccountEmail = status.email || holder.googleAccountEmail;
        persist();
        renderMyAccount();
        toast('Connection OK', 'Authenticated as ' + (status.email || '—') + ' for Gmail + Drive.', true);
      } catch (e) {
        toast('Test failed', e.message);
      }
    }
    async function sendMyTestEmail() {
      const holder = myGoogleAccountHolder();
      if (!holder || !holder.gmailConnected) return toast('Not connected', 'Connect your Google account before sending a test email.');
      const input = document.getElementById('my-google-test-recipient');
      const to = ((input ? input.value : '') || '').trim() || holder.googleAccountEmail;
      if (!to) return toast('Recipient required', 'Enter an email address to send the test to.');
      const subject = 'HaulBoX — test email';
      const body = 'This confirms your connected Google account (' + (holder.googleAccountEmail || '—') + ') is working for Reply-All sends and Drive saves.';
      toast('Sending…', 'to ' + to);
      try {
        await backendFetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: currentAccountId(), to, subject, body }) });
        logEmail(null, 'TEST', to, 'Sent (test)', '');
        toast('Test email sent', 'Check ' + to, true);
      } catch (e) {
        toast('Send failed', e.message);
      }
    }

    /* ================= GMAIL THREAD LINKING (Add Load form) =================
       Gmail's web URL for a thread contains an "opaque" ID (FMfcgz..., Ktbx...)
       that is a completely different identifier system from the Gmail API's own
       thread ID (a short hex string) — there is no way to convert one into the
       other, so pasting a URL can never produce something the API will accept.
       Instead this searches the connected mailbox directly via the backend
       (/api/thread-search), which uses the Gmail API's own search and returns
       its real, usable thread IDs to pick from. */
    let gmailThreadSearchTimer = null;
    function onGmailThreadSearchInput() {
      clearTimeout(gmailThreadSearchTimer);
      // Clear any previously linked thread the moment the user starts typing a new search
      document.getElementById('f-gmailthread-id').value = '';
      document.getElementById('f-gmailthread-hint').textContent = '';
      gmailThreadSearchTimer = setTimeout(searchGmailThread, 500);
    }
    async function searchGmailThread() {
      const q = document.getElementById('f-gmailthread').value.trim();
      const resultsEl = document.getElementById('f-gmailthread-results');
      if (!q) { resultsEl.innerHTML = ''; return; }
      const accountId = STATE.role === 'admin' ? 'admin' : (STATE.currentDispatcherId || 'admin');
      resultsEl.innerHTML = '<div class="hint">Searching Gmail…</div>';
      try {
        const data = await backendFetch('/api/thread-search?accountId=' + encodeURIComponent(accountId) + '&q=' + encodeURIComponent(q));
        const results = data.results || [];
        lastGmailThreadResults = results; // looked up by index below — avoids ever putting subject text inside an onclick="" string
        if (!results.length) { resultsEl.innerHTML = '<div class="hint">No matching emails found.</div>'; return; }
        resultsEl.innerHTML = results.map((r, i) =>
          '<div class="gmail-thread-result" style="padding:8px; border:1px solid var(--border); border-radius:6px; margin-bottom:4px; cursor:pointer;" onclick="pickGmailThreadByIndex(' + i + ')">' +
          '<div style="font-weight:600; font-size:12px;">' + escapeAttr(r.subject) + '</div>' +
          '<div style="font-size:11px; color:var(--text-faint);">' + escapeAttr(r.from) + ' · ' + escapeAttr(r.date) + (r.messageCount > 1 ? ' · ' + r.messageCount + ' messages' : '') + '</div>' +
          '</div>'
        ).join('');
      } catch (e) {
        resultsEl.innerHTML = '<div class="hint" style="color:var(--red);">Search failed: ' + escapeAttr(e.message || 'unknown error') + ' — make sure your Google account is connected in Settings.</div>';
      }
    }
    let lastGmailThreadResults = [];
    function pickGmailThreadByIndex(i) {
      const r = lastGmailThreadResults[i];
      if (!r) return;
      pickGmailThread(r.id, r.subject);
    }
    function pickGmailThread(id, subject) {
      document.getElementById('f-gmailthread-id').value = id;
      document.getElementById('f-gmailthread-hint').textContent = 'Linked: ' + subject;
      document.getElementById('f-gmailthread-results').innerHTML = '';
      document.getElementById('f-gmailthread').value = subject;
    }

    /* ================= EMAIL LOGS ================= */
    function logEmail(load, type, recipient, status, threadId) {
      STATE.emailLogs.unshift({
        id: uid('eml'),
        loadId: load ? load.id : null,
        loadNumber: load ? load.loadNumber : '—',
        type: type,
        recipient: recipient || '',
        sentBy: STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : ''),
        sentDate: new Date().toISOString(),
        status: status,
        gmailThreadId: threadId || (load ? (load.gmail_thread_id || '') : ''),
      });
      pushNotification(type + ' sent — ' + (load ? load.loadNumber : '—'), 'To ' + (recipient || '—') + (status ? ' · ' + status : ''));
      persist();
    }
    function renderEmailLogs() {
      const body = document.getElementById('emaillogs-body');
      if (!body) return;
      const q = (document.getElementById('emaillogs-search').value || '').toLowerCase();
      const rows = STATE.emailLogs.filter(log =>
        !q || (log.loadNumber || '').toLowerCase().includes(q) || (log.recipient || '').toLowerCase().includes(q)
      );
      body.innerHTML = rows.map(log => '<tr>' +
        '<td class="cell-strong">' + (log.loadNumber || '—') + '</td>' +
        '<td>' + log.type + '</td>' +
        '<td>' + (log.recipient || '—') + '</td>' +
        '<td>' + (log.sentBy || '—') + '</td>' +
        '<td class="cell-dim">' + fmtDateTime(log.sentDate) + '</td>' +
        '<td>' + log.status + '</td>' +
        '<td class="cell-mono">' + (log.gmailThreadId || '—') + '</td>' +
        '</tr>').join('') || '<tr><td colspan="7" class="cell-dim">No emails sent yet.</td></tr>';
    }

    /* ================= ROLES ================= */
    function applyRoleUI() {
      const role = STATE.role;
      const isAdmin = (role === 'admin');

      // Admin-only sidebar nav tabs
      document.querySelectorAll('.nav-item[data-role-view="admin"]').forEach(el => {
        el.style.display = isAdmin ? 'flex' : 'none';
      });

      // Other admin-only elements across forms, modals, and tables
      document.querySelectorAll('[data-role-view]:not(.nav-item)').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
      });

      const myAccountNav = document.getElementById('nav-myaccount');
      if (myAccountNav) myAccountNav.style.display = (role === 'viewonly') ? 'none' : 'flex';

      // Dispatch Fee % is an Admin-controlled financial setting — dispatchers can see it
      // (it drives their revenue on a load) but can't change it, on the load form or on a driver.
      const feeFields = [document.getElementById('f-feepct'), document.getElementById('d-fee')];
      feeFields.forEach(el => { if (el) el.readOnly = !isAdmin; });
      const feeHints = [document.getElementById('f-feepct-hint'), document.getElementById('d-fee-hint')];
      feeHints.forEach(el => { if (el) el.style.display = !isAdmin ? 'block' : 'none'; });

      const chip = document.getElementById('role-chip');
      if (chip) {
        if (STATE.isSuperAdmin) {
          chip.innerHTML = '<span class="role-dot" style="background:#38bdf8;"></span> Role: Super Admin ⭐';
          chip.style.borderColor = '#38bdf8';
          chip.style.color = '#38bdf8';
        } else if (isAdmin) {
          const mirrored = STATE.viewAs ? (STATE.dispatchers.find(x => x.id === STATE.viewAs) || {}).name : null;
          chip.innerHTML = '<span class="role-dot" style="background:#3b82f6;"></span> Role: ' + ('Admin' + (mirrored ? ' · viewing ' + mirrored : ''));
          chip.style.borderColor = '#334155';
          chip.style.color = '#94a3b8';
        } else if (role === 'dispatcher') {
          chip.innerHTML = '<span class="role-dot" style="background:#10b981;"></span> Role: Dispatcher · ' + (STATE.currentUser ? STATE.currentUser.name : '');
          chip.style.borderColor = '#334155';
          chip.style.color = '#94a3b8';
        } else {
          chip.innerHTML = '<span class="role-dot"></span> Role: View Only';
          chip.style.borderColor = '#334155';
          chip.style.color = '#94a3b8';
        }
      }

      if (role === 'viewonly') {
        if (!document.getElementById('readonly-banner')) {
          const b = document.createElement('div');
          b.id = 'readonly-banner'; b.className = 'readonly-banner';
          b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg> View-only mode — editing, deleting, and uploads are disabled.';
          document.getElementById('viewport').prepend(b);
        }
      } else {
        const existing = document.getElementById('readonly-banner');
        if (existing) existing.remove();
      }
    }

    /* ================= ADMIN VIEW SWITCH ================= */
    // Admin can look at the whole company (Admin dashboard view) or drop into any single
    // dispatcher's view — exactly what that dispatcher sees — without losing admin rights.
    function populateViewAsField() {
      const sel = document.getElementById('viewas-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">Admin dashboard view</option>' +
        STATE.dispatchers.map(d => '<option value="' + d.id + '">Dispatcher view — ' + d.name + '</option>').join('');
      sel.value = STATE.viewAs || '';
      const wrap = document.getElementById('viewas-wrap');
      if (wrap) wrap.classList.toggle('mirroring', !!STATE.viewAs);
    }
    function setViewAs(val) {
      if (STATE.role !== 'admin') return;
      STATE.viewAs = val || null;
      populateViewAsField();
      populateDropdowns();
      populateStatFilters();
      renderDashboard();
      const active = document.querySelector('.nav-item.active');
      if (active) switchView(active.dataset.view);
      const d = STATE.dispatchers.find(x => x.id === STATE.viewAs);
      toast(STATE.viewAs ? 'Now showing ' + (d ? d.name : 'dispatcher') + "'s view" : 'Back to Admin dashboard view', '', true);
    }

    /* ================= SHARE LINK ================= */
    function shareViewOnlyLink() {
      document.getElementById('share-name-input').value = '';
      document.getElementById('share-link-input').value = '';
      openModal('modal-share');
    }
    function generateShareLink() {
      const name = document.getElementById('share-name-input').value.trim();
      if (!name) return toast('Name required', "Enter who you're sharing this with.");
      // Share links only ever grant the Admin dashboard view — dispatcher-scoped share links have been removed.
      const viewMode = 'admin';
      const dispatcherId = null;
      const share = { id: uid('shr'), token: uid('tok'), name, viewMode, dispatcherId, active: true, createdAt: new Date().toISOString() };
      STATE.settings.shares = STATE.settings.shares || [];
      STATE.settings.shares.push(share);
      persist();
      const url = new URL(window.location.href);
      url.searchParams.set('share', share.token);
      url.searchParams.delete('view');
      document.getElementById('share-link-input').value = url.toString();
      renderShareList();
      toast('Share link created', name, true);
    }
    function copyShareLink() {
      const input = document.getElementById('share-link-input');
      if (!input.value) return toast('Nothing to copy', 'Generate a link first.');
      input.select();
      try { document.execCommand('copy'); toast('Link copied', '', true); } catch (e) { toast('Copy this link manually', ''); }
    }
    function toggleShareActive(id) {
      const sh = (STATE.settings.shares || []).find(x => x.id === id); if (!sh) return;
      sh.active = !sh.active; persist(); renderShareList();
      toast(sh.active ? 'Access restored' : 'Access revoked', sh.name, true);
    }
    function deleteShare(id) {
      STATE.settings.shares = (STATE.settings.shares || []).filter(x => x.id !== id);
      persist(); renderShareList();
      toast('Share removed', '', true);
    }
    function renderShareList() {
      const el = document.getElementById('settings-share-list');
      if (!el) return;
      const shares = STATE.settings.shares || [];
      el.innerHTML = shares.map(sh => {
        const url = new URL(window.location.href); url.searchParams.set('share', sh.token); url.searchParams.delete('view');
        const dname = sh.dispatcherId ? (STATE.dispatchers.find(x => x.id === sh.dispatcherId) || {}).name : null;
        const viewLabel = sh.viewMode === 'dispatcher' ? ('Dispatcher view · ' + (dname || 'removed dispatcher') + ' — legacy, revoke and re-share as Admin view') : 'Admin view';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;font-size:13px;border-bottom:1px solid var(--border-soft);">' +
          '<span><b>' + sh.name + '</b> <span class="cell-dim" style="color:' + (sh.active ? 'var(--green)' : 'var(--text-faint)') + ';">· ' + (sh.active ? 'Active' : 'Revoked') + '</span>' +
          '<span class="cell-dim" style="display:block;font-size:11.5px;">' + viewLabel + '</span></span>' +
          '<div class="row-actions">' +
          '<button class="btn btn-sm btn-ghost" onclick="document.getElementById(\'share-link-input-hidden-' + sh.id + '\').select();document.execCommand(\'copy\');toast(\'Link copied\',\'\',true)">Copy</button>' +
          '<input type="text" id="share-link-input-hidden-' + sh.id + '" readonly value="' + url.toString() + '" style="position:absolute;left:-9999px;">' +
          '<button class="btn btn-sm btn-ghost" onclick="toggleShareActive(\'' + sh.id + '\')">' + (sh.active ? 'Revoke' : 'Reactivate') + '</button>' +
          '<button class="icon-mini" title="Delete" onclick="deleteShare(\'' + sh.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>' +
          '</div></div>';
      }).join('') || '<p class="cell-dim" style="font-size:12px;">No shared links yet — click below to create one.</p>';
    }

    /* ================= MODAL / GLOBAL SEARCH ================= */
    function openModal(id) { document.getElementById(id).classList.add('active'); }
    function closeModal(id) { document.getElementById(id).classList.remove('active'); }
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
    });
    function globalSearch(q) {
      if (!q) return;
      switchView('loadboard');
      document.getElementById('loadboard-search').value = q;
      STATE.loadFilter = 'All Loads';
      renderLoadBoard();
    }

    // ==========================================
    // REAL-TIME SOCKET.IO & CHAT SYSTEM
    // ==========================================
    let appSocket = null;
    let renderedMsgIds = new Set();
    const OFFLINE_CHAT_KEY = 'haulbox_offline_chat_queue';

    function getOfflineChatQueue() {
      try {
        return JSON.parse(localStorage.getItem(OFFLINE_CHAT_KEY) || '[]');
      } catch (e) { return []; }
    }

    function saveOfflineChatQueue(queue) {
      try {
        localStorage.setItem(OFFLINE_CHAT_KEY, JSON.stringify(queue));
      } catch (e) { }
    }

    function enqueueOfflineChat(msgPayload) {
      const q = getOfflineChatQueue();
      q.push(msgPayload);
      saveOfflineChatQueue(q);
    }

    async function flushOfflineChatQueue() {
      const q = getOfflineChatQueue();
      if (!q.length) return;
      console.log('[Socket.IO] Flushing offline chat queue (' + q.length + ' items)...');
      saveOfflineChatQueue([]);

      for (const item of q) {
        try {
          if (appSocket && appSocket.connected) {
            appSocket.emit('send_message', item);
          } else {
            await fetch(`/api/chat/conversations/${item.conversationId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item)
            });
          }
        } catch (e) {
          enqueueOfflineChat(item);
        }
      }
    }

    function initAppSocket() {
      if (typeof io === 'undefined' || appSocket) return;
      try {
        appSocket = io();

        appSocket.on('connect', () => {
          console.log('[Socket.IO] Connected to HaulBoX real-time gateway:', appSocket.id);
          authenticateAppSocket();
          const curId = chatThreadId() || (typeof waCurrentConvoId !== 'undefined' ? waCurrentConvoId : null);
          if (curId) joinSocketConversation(curId);
          flushOfflineChatQueue();
        });

        appSocket.on('reconnect', () => {
          console.log('[Socket.IO] Reconnected to server');
          authenticateAppSocket();
          const curId = chatThreadId() || (typeof waCurrentConvoId !== 'undefined' ? waCurrentConvoId : null);
          if (curId) joinSocketConversation(curId);
          flushOfflineChatQueue();
        });

        appSocket.on('new_message', (msg) => {
          handleIncomingSocketMessage(msg);
        });

        appSocket.on('user_typing', (data) => {
          handleSocketTyping(data);
        });

        appSocket.on('messages_read', (data) => {
          handleSocketMessagesRead(data);
        });

        appSocket.on('presence_change', (data) => {
          console.log('[Socket.IO] Presence update:', data);
        });
      } catch (e) {
        console.error('[Socket.IO] Init failed:', e);
      }
    }

    function authenticateAppSocket() {
      if (!appSocket || !appSocket.connected) return;
      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const senderName = STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : 'Dispatcher');
      appSocket.emit('authenticate', {
        accountId,
        role: STATE.role,
        name: senderName,
        type: STATE.role === 'admin' ? 'admin' : (STATE.role === 'driver' ? 'driver' : 'dispatcher')
      });
    }

    function joinSocketConversation(convoId) {
      if (!appSocket || !appSocket.connected || !convoId) return;
      appSocket.emit('join_conversation', { conversationId: convoId });
    }

    function handleIncomingSocketMessage(msg) {
      if (!msg) return;
      const curId = String(chatThreadId() || (typeof waCurrentConvoId !== 'undefined' ? waCurrentConvoId : ''));
      const msgConvoId = String(msg.conversationId || '');

      // Check if already rendered (deduplication)
      const msgKey = String(msg.id || msg.tempId || '');
      if (msgKey && renderedMsgIds.has(msgKey)) {
        // Update status of optimistic message to sent
        const el = document.querySelector(`[data-msg-id="${msgKey}"]`);
        if (el) {
          const statusIcon = el.querySelector('.chat-status-tick');
          if (statusIcon) statusIcon.innerHTML = '✓';
        }
        return;
      }
      if (msgKey) renderedMsgIds.add(msgKey);

      if (curId && curId === msgConvoId) {
        const body = document.getElementById('chat-body');
        if (body) {
          const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
          const isMine = String(msg.senderId) === accountId;
          const wasAtBottom = body.scrollHeight - body.scrollTop <= body.clientHeight + 40;

          const empty = body.querySelector('.chat-empty');
          if (empty) empty.remove();

          const div = document.createElement('div');
          div.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');
          div.setAttribute('data-msg-id', msg.id || msg.tempId || '');
          div.innerHTML = '<span class="who">' + escapeChat(msg.senderName || msg.senderId) + '</span>' +
            escapeChat(msg.body) +
            '<span class="when">' + new Date(msg.createdAt || Date.now()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
            (isMine ? ' <span class="chat-status-tick">✓</span>' : '') +
            '</span>';

          body.appendChild(div);
          if (wasAtBottom) body.scrollTop = body.scrollHeight;
        }

        // Also update WhatsApp panel if open
        if (typeof waLoadMessages === 'function' && typeof waCurrentConvoId !== 'undefined' && String(waCurrentConvoId) === msgConvoId) {
          waLoadMessages(waCurrentConvoId);
        }
      } else {
        // Update unread count
        const conv = chatConvs.find(c => String(c.id) === msgConvoId);
        if (conv) conv.unreadCount = (conv.unreadCount || 0) + 1;
        updateChatBadge();
      }
    }

    function handleSocketTyping(data) {
      if (!data) return;
      const curId = String(chatThreadId() || (typeof waCurrentConvoId !== 'undefined' ? waCurrentConvoId : ''));
      if (curId && curId === String(data.conversationId)) {
        const typingEl = document.getElementById('chat-typing-indicator');
        if (typingEl) {
          typingEl.textContent = data.isTyping ? `${data.user ? data.user.name : 'Someone'} is typing...` : '';
          typingEl.style.display = data.isTyping ? 'block' : 'none';
        }
      }
    }

    function handleSocketMessagesRead(data) {
      if (!data) return;
      const curId = String(chatThreadId() || (typeof waCurrentConvoId !== 'undefined' ? waCurrentConvoId : ''));
      if (curId && curId === String(data.conversationId)) {
        document.querySelectorAll('.chat-status-tick').forEach(tick => {
          tick.innerHTML = '<span style="color:#0284c7;font-weight:900;">✓✓</span>';
        });
      }
    }

    window.addEventListener('online', flushOfflineChatQueue);

    async function toggleChat(open) {
      const panel = document.getElementById('chat-panel');
      if (!panel) return;
      if (open === undefined) open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      if (open) {
        initAppSocket();
        await fetchChatConvs();
        renderChat();
        setTimeout(() => { const i = document.getElementById('chat-input'); if (i) i.focus(); }, 60);
      }
      updateChatBadge();
    }

    async function fetchChatConvs() {
      if (STATE.role === 'viewonly') return;
      try {
        const accountId = STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId);
        const res = await fetch(`/api/chat/conversations?accountId=${encodeURIComponent(accountId)}&role=${encodeURIComponent(STATE.role)}`);
        if (res.ok) {
          const d = await res.json();
          chatConvs = d.chats || [];
        }
      } catch (e) { }
    }

    function chatThreadId() {
      const sel = document.getElementById('chat-thread-select');
      return sel ? sel.value : null;
    }

    function chatKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
      if (appSocket && appSocket.connected) {
        const id = chatThreadId();
        if (id) appSocket.emit('typing', { conversationId: id, isTyping: true });
      }
    }

    async function renderChat(isBackgroundSync) {
      const pick = document.getElementById('chat-pick');
      const sel = document.getElementById('chat-thread-select');
      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));

      if (pick && sel) {
        const keep = sel.value;
        sel.innerHTML = chatConvs.map(c => {
          let name = c.groupName;
          if (!name) {
            const other = (c.members || []).find(m => String(m.id) !== accountId);
            name = other ? (other.name || other.id) : 'Chat';
          }
          const unreadStr = c.unreadCount ? ` (${c.unreadCount} unread)` : '';
          return `<option value="${c.id}">${escapeChat(name)}${unreadStr}</option>`;
        }).join('') || '<option value="">No conversations</option>';
        if (keep && chatConvs.some(c => String(c.id) === String(keep))) sel.value = keep;
        pick.style.display = 'block';
      }

      const id = chatThreadId();
      const body = document.getElementById('chat-body');
      const inputRow = document.getElementById('chat-input-row');

      if (STATE.role === 'viewonly') {
        body.innerHTML = '<div class="chat-empty">Chat is not available on a view-only link.</div>';
        if (inputRow) inputRow.style.display = 'none';
        return;
      }

      if (inputRow) inputRow.style.display = 'flex';

      if (!id) {
        body.innerHTML = '<div class="chat-empty">Select a conversation.</div>';
        return;
      }

      joinSocketConversation(id);

      try {
        const res = await fetch(`/api/chat/messages/${id}?accountId=${encodeURIComponent(accountId)}&role=${encodeURIComponent(STATE.role)}`);
        if (res.ok) {
          const d = await res.json();
          const msgs = d.messages || [];

          const wasAtBottom = body.scrollHeight - body.scrollTop <= body.clientHeight + 40;

          // Track IDs for deduplication
          msgs.forEach(m => { if (m.id) renderedMsgIds.add(String(m.id)); });

          body.innerHTML = msgs.length ? msgs.map(m => {
            const isMine = String(m.senderId) === accountId;
            const statusTick = isMine ? (m.read ? '<span style="color:#0284c7;font-weight:900;">✓✓</span>' : '✓') : '';
            return '<div class="chat-msg ' + (isMine ? 'mine' : 'theirs') + '" data-msg-id="' + m.id + '">' +
              '<span class="who">' + escapeChat(m.senderName || m.senderId) + '</span>' +
              escapeChat(m.body) +
              '<span class="when">' + new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
              (statusTick ? ' <span class="chat-status-tick">' + statusTick + '</span>' : '') +
              '</span></div>';
          }).join('') : '<div class="chat-empty">No messages yet.</div>';

          if (wasAtBottom && !isBackgroundSync) body.scrollTop = body.scrollHeight;

          fetch(`/api/chat/read/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: accountId, role: STATE.role })
          }).catch(e => { });

          if (appSocket && appSocket.connected) {
            appSocket.emit('mark_read', { conversationId: id, accountId: accountId, role: STATE.role });
          }
        }
      } catch (e) { }

      updateChatBadge();
    }

    function escapeChat(t) {
      return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function sendChat() {
      if (STATE.role === 'viewonly') return toast('View only', 'Chat is disabled on a shared link.');
      const input = document.getElementById('chat-input');
      const text = (input.value || '').trim();
      if (!text) return;
      const id = chatThreadId();
      if (!id) return toast('No thread', 'Select a thread first.');

      input.value = '';

      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const senderName = STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : 'Dispatcher');
      const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      // 1. Optimistic UI Render (🕒 sending state)
      const body = document.getElementById('chat-body');
      if (body) {
        const empty = body.querySelector('.chat-empty');
        if (empty) empty.remove();

        const optDiv = document.createElement('div');
        optDiv.className = 'chat-msg mine';
        optDiv.setAttribute('data-msg-id', tempId);
        optDiv.innerHTML = '<span class="who">' + escapeChat(senderName) + '</span>' +
          escapeChat(text) +
          '<span class="when">Just now <span class="chat-status-tick">🕒</span></span>';
        body.appendChild(optDiv);
        body.scrollTop = body.scrollHeight;
      }
      renderedMsgIds.add(tempId);

      const payload = {
        conversationId: Number(id),
        accountId: accountId,
        role: STATE.role,
        name: senderName,
        senderName: senderName,
        body: text,
        tempId: tempId
      };

      // 2. Dispatch via Socket.IO if connected, else fallback to REST or Offline Queue
      if (appSocket && appSocket.connected) {
        appSocket.emit('send_message', payload, (ack) => {
          if (ack && ack.ok) {
            const el = document.querySelector(`[data-msg-id="${tempId}"]`);
            if (el) {
              if (ack.message && ack.message.id) {
                el.setAttribute('data-msg-id', ack.message.id);
                renderedMsgIds.add(String(ack.message.id));
              }
              const tick = el.querySelector('.chat-status-tick');
              if (tick) tick.innerHTML = '✓';
            }
          }
        });
      } else {
        try {
          const res = await fetch(`/api/chat/messages/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const d = await res.json();
            if (d && d.message && d.message.id) {
              const el = document.querySelector(`[data-msg-id="${tempId}"]`);
              if (el) {
                el.setAttribute('data-msg-id', d.message.id);
                renderedMsgIds.add(String(d.message.id));
                const tick = el.querySelector('.chat-status-tick');
                if (tick) tick.innerHTML = '✓';
              }
            }
          }
        } catch (e) {
          console.warn('[Chat] Offline, queuing message for reconnect flush');
          enqueueOfflineChat(payload);
        }
      }
    }

    function updateChatBadge() {
      const launcher = document.getElementById('chat-launcher');
      const badge = document.getElementById('chat-badge');
      const sideBadge = document.getElementById('chat-sidebar-badge');

      let unread = chatConvs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

      if (sideBadge) {
        sideBadge.style.display = unread > 0 ? 'inline-block' : 'none';
        sideBadge.textContent = unread > 99 ? '99+' : String(unread);
      }

      if (!launcher || !badge) return;
      if (STATE.role === 'viewonly') { launcher.style.display = 'none'; return; }
      launcher.style.display = 'flex';

      const panelOpen = document.getElementById('chat-panel').classList.contains('open');
      badge.style.display = (unread > 0 && !panelOpen) ? 'flex' : 'none';
      badge.textContent = unread > 9 ? '9+' : String(unread);
    }

    /* ================= DEDICATED MAIN CHAT PAGE ================= */
    let mainChatContacts = [];
    let currentMainConvoId = null;
    let currentMainFilter = 'all';
    let mainChatLoadTag = null;

    async function loadMainChat() {
      if (STATE.role === 'viewonly') return;
      await Promise.all([fetchChatConvs(), fetchMainChatContacts()]);
      renderMainChatSidebar();
      updateChatBadge();
      if (currentMainConvoId) loadMainChatMessages();
    }

    async function fetchMainChatContacts() {
      try {
        const accountId = STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId);
        const res = await fetch(`/api/chat/contacts?accountId=${encodeURIComponent(accountId)}&role=${encodeURIComponent(STATE.role)}`);
        if (res.ok) {
          const data = await res.json();
          mainChatContacts = data.contacts || [];
        }
      } catch (e) { console.error('Failed to fetch contacts:', e); }
    }

    function setMainChatFilter(filter) {
      currentMainFilter = filter;
      ['all', 'dispatcher', 'driver', 'group'].forEach(f => {
        const btn = document.getElementById('chat-tab-' + (f === 'group' ? 'groups' : f + 's'));
        if (btn) btn.classList.toggle('active', f === filter);
      });
      const allBtn = document.getElementById('chat-tab-all');
      if (allBtn && filter === 'all') allBtn.classList.add('active');
      renderMainChatSidebar();
    }

    function renderMainChatSidebar() {
      const searchQ = (document.getElementById('main-chat-search')?.value || '').toLowerCase();
      const contactsContainer = document.getElementById('main-chat-contacts-list');
      const convosContainer = document.getElementById('main-chat-convos-list');

      // Filter contacts
      const filteredContacts = mainChatContacts.filter(c => {
        if (currentMainFilter === 'dispatcher' && c.type !== 'dispatcher') return false;
        if (currentMainFilter === 'driver' && c.type !== 'driver') return false;
        if (currentMainFilter === 'group' && c.type !== 'ops') return false;
        if (searchQ && !c.name.toLowerCase().includes(searchQ)) return false;
        return true;
      });

      if (contactsContainer) {
        contactsContainer.innerHTML = filteredContacts.map(c => `
      <div class="contact-row" onclick="startMainChat('${c.type}', '${c.id}', '${escapeChat(c.name)}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border-soft);">
        <div class="avatar-circle" style="width:30px;height:30px;background:var(--panel-hi);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${initials(c.name)}</div>
        <div style="flex:1;overflow:hidden;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeChat(c.name)}</div>
          <div style="font-size:11px;color:var(--text-faint);">${c.role}</div>
        </div>
      </div>
    `).join('') || '<div style="font-size:12px;color:var(--text-faint);padding:6px;">No contacts found</div>';
      }

      // Filter convos
      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const filteredConvos = chatConvs.filter(c => {
        let name = c.groupName;
        if (!name) {
          const other = (c.members || []).find(m => String(m.id) !== accountId);
          name = other ? (other.name || other.id) : 'Chat';
        }
        if (searchQ && !name.toLowerCase().includes(searchQ)) return false;
        return true;
      });

      if (convosContainer) {
        convosContainer.innerHTML = filteredConvos.map(c => {
          let name = c.groupName;
          if (!name) {
            const other = (c.members || []).find(m => String(m.id) !== accountId);
            name = other ? (other.name || other.id) : 'Chat';
          }
          const isActive = String(c.id) === String(currentMainConvoId);
          const unreadBadge = c.unreadCount ? `<span style="background:var(--accent);color:#fff;font-size:11px;padding:2px 6px;border-radius:10px;margin-left:auto;">${c.unreadCount}</span>` : '';
          return `
        <div class="convo-row ${isActive ? 'active' : ''}" onclick="selectMainChat('${c.id}', '${escapeChat(name)}', ${c.isGroup})" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:6px;cursor:pointer;background:${isActive ? 'var(--panel-hi)' : 'var(--bg-card)'};border:1px solid var(--border-soft);">
          <div class="avatar-circle" style="width:34px;height:34px;background:var(--accent);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${initials(name)}</div>
          <div style="flex:1;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeChat(name)}</span>
              ${unreadBadge}
            </div>
            <div style="font-size:12px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeChat(c.lastMessage || 'No messages')}</div>
          </div>
        </div>
      `;
        }).join('') || '<div style="font-size:12px;color:var(--text-faint);padding:6px;">No recent conversations</div>';
      }
    }

    function filterMainChatList() {
      renderMainChatSidebar();
    }

    async function startMainChat(type, id, name) {
      const accountId = STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId);
      try {
        const res = await fetch('/api/chat/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, role: STATE.role, withType: type, withId: id })
        });
        if (res.ok) {
          const d = await res.json();
          await fetchChatConvs();
          selectMainChat(d.conversationId, name, type === 'ops');
        }
      } catch (e) { toast('Error', 'Failed to start chat'); }
    }

    async function selectMainChat(id, title, isGroup) {
      currentMainConvoId = id;
      document.getElementById('main-chat-title').textContent = title;
      document.getElementById('main-chat-subtitle').textContent = isGroup ? 'Group Conversation' : 'Direct Conversation';
      document.getElementById('main-chat-avatar').textContent = initials(title);
      document.getElementById('main-chat-input-area').style.display = 'flex';

      renderMainChatSidebar();
      await loadMainChatMessages();
    }

    async function loadMainChatMessages() {
      if (!currentMainConvoId) return;
      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const body = document.getElementById('main-chat-body');
      try {
        const res = await fetch(`/api/chat/conversations/${currentMainConvoId}/messages?accountId=${encodeURIComponent(accountId)}&role=${encodeURIComponent(STATE.role)}`);
        if (res.ok) {
          const d = await res.json();
          const msgs = d.messages || [];
          const wasAtBottom = body.scrollHeight - body.scrollTop <= body.clientHeight + 40;

          body.innerHTML = msgs.length ? msgs.map(m => {
            const isMine = String(m.senderId) === accountId;
            const loadTagHtml = m.loadNumber ? `<div style="font-size:11px;background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;margin-bottom:4px;display:inline-block;">📦 Load #${escapeChat(m.loadNumber)}</div>` : '';
            return `
          <div style="display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};">
            <div style="font-size:11px;color:var(--text-faint);margin-bottom:2px;">${escapeChat(m.senderName || m.senderId)}</div>
            <div style="background:${isMine ? 'var(--accent)' : 'var(--panel-hi)'};color:${isMine ? '#fff' : 'var(--text-main)'};padding:8px 12px;border-radius:12px;max-width:70%;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              ${loadTagHtml}
              <div>${escapeChat(m.body)}</div>
            </div>
            <div style="font-size:10px;color:var(--text-faint);margin-top:2px;">${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        `;
          }).join('') : '<div class="chat-empty" style="margin:auto;color:var(--text-faint);">Say hello 👋</div>';

          if (wasAtBottom) body.scrollTop = body.scrollHeight;
        }
      } catch (e) { console.error('Failed to load main chat messages:', e); }
    }

    async function sendMainChatMessage() {
      const input = document.getElementById('main-chat-input');
      const text = (input.value || '').trim();
      if (!text || !currentMainConvoId) return;

      const accountId = String(STATE.currentUser ? STATE.currentUser.id : (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const senderName = STATE.currentUser ? STATE.currentUser.name : (STATE.role === 'admin' ? 'Admin' : 'Dispatcher');

      const payload = {
        accountId,
        role: STATE.role,
        name: senderName,
        body: text
      };

      if (mainChatLoadTag) {
        payload.loadId = mainChatLoadTag.id;
        payload.loadNumber = mainChatLoadTag.number;
      }

      input.value = '';
      clearMainChatLoadTag();

      try {
        const res = await fetch(`/api/chat/conversations/${currentMainConvoId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          await loadMainChatMessages();
          await fetchChatConvs();
          renderMainChatSidebar();
        }
      } catch (e) { toast('Error', 'Failed to send message'); }
    }

    function attachLoadToChat(loadId, loadNumber) {
      mainChatLoadTag = { id: loadId, number: loadNumber };
      const bar = document.getElementById('main-chat-load-tag-bar');
      const name = document.getElementById('main-chat-load-tag-name');
      if (bar && name) {
        name.textContent = '#' + loadNumber;
        bar.style.display = 'flex';
      }
    }

    function clearMainChatLoadTag() {
      mainChatLoadTag = null;
      const bar = document.getElementById('main-chat-load-tag-bar');
      if (bar) bar.style.display = 'none';
    }

    setInterval(async () => {
      const panel = document.getElementById('chat-panel');
      if (STATE.role !== 'viewonly') {
        await fetchChatConvs();
        updateChatBadge();
        if (document.getElementById('view-chat')?.classList.contains('active')) {
          renderMainChatSidebar();
          if (currentMainConvoId) loadMainChatMessages();
        }
      }
    }, 5000);

    /* ---- Live chat polling ----------------------------------------------
       STATE is loaded from the server once at page load, so without this a
       dispatcher (or admin) only ever sees a new chat message after a manual
       refresh. This polls the shared state on an interval and merges in just
       the chat thread(s), so new messages show up on their own. Everything
       else in STATE (loads, drivers, settings, in-progress edits, etc.) is
       left untouched. */
    let chatPollTimer = null;
    function startChatPolling() {
      if (chatPollTimer || STATE.role === 'viewonly') return;
      chatPollTimer = setInterval(pollChatUpdates, 5000);
    }
    function stopChatPolling() {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    async function pollChatUpdates() {
      if (document.hidden || STATE.role === 'viewonly') return;
      try {
        const res = await window.storage.get('haulline:state', false);
        if (res && res.value) {
          const remoteChat = (JSON.parse(res.value).chat) || {};
          if (JSON.stringify(remoteChat) !== JSON.stringify(STATE.chat)) {
            STATE.chat = remoteChat;
            renderChat();
            updateChatBadge();
          }
        }
      } catch (e) { /* transient network/read error — next poll retries */ }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollChatUpdates(); });

    /* ================= INIT ================= */
    async function init() {
      if (!STATE._loaded) {
        const loaded = await loadState();
        STATE._loaded = true;
        if (!loaded) {
          // Error screen already shown by loadState(); app initialization stopped
          console.error('Failed to load application state');
          return;
        }
      }
      const params = new URLSearchParams(window.location.search);
      const shareToken = params.get('share');
      const validShare = shareToken ? (STATE.settings.shares || []).find(x => x.token === shareToken && x.active) : null;
      if (params.get('view') === 'readonly' || validShare) {
        STATE.role = 'viewonly';
        STATE.currentDispatcherId = null;
        STATE.viewAs = (validShare && validShare.viewMode === 'dispatcher') ? validShare.dispatcherId : null;
      }
      applyRoleUI();
      populateViewAsField();
      populateDropdowns();
      populateStatFilters();
      renderChat();
      updateChatBadge();
      document.getElementById('f-feepct').value = STATE.settings.defaultFeePct || 10;
      const dpDefEl = document.getElementById('f-driverpaypct'); if (dpDefEl) dpDefEl.value = defaultDriverPayPct();
      document.getElementById('s-current-profile') && (document.getElementById('s-current-profile').textContent = (STATE.currentUser ? STATE.currentUser.name : '') + (STATE.role === 'admin' ? ' (Admin)' : ' (Dispatcher)'));
      updateBranding();
      renderDashboard();
      toast('Welcome back', STATE.currentUser ? STATE.currentUser.name : '', true);
      startChatPolling();
    }

    /* ================= DRIVER APP =================
       Fully separate from the Admin/Dispatcher app above: a driver signs in with
       just a Driver ID + PIN (set by Admin on the driver record) and NEVER
       fetches the full company state blob. Instead the server (routes/driver.js)
       validates the PIN and hands back only that driver's own profile + loads —
       so a driver's browser never sees other drivers' pay, broker rates,
       dispatcher revenue, or anything else in the shared company data. */
    const DRIVER_SESSION_KEY = 'haulline-driver-session';
    let DRIVER = null;          // {id, name, truck, phone, company}
    let DRIVER_TOKEN = null;    // Bearer session token from /api/driver/login
    let DRIVER_LOADS = [];      // this driver's own loads (filter=all), as returned by the server
    let DRIVER_COMPANY = 'HaulBoX';
    let DRIVER_FILTER = 'active';
    let DRIVER_PAGE = 'home';
    let DRIVER_PERMISSIONS = {};
    let DRIVER_DOC_UPLOAD_CTX = null; // {key, index} for the profile-doc upload modal

    // Thin fetch wrapper: attaches the Bearer session token to every driver API
    // call, and signs the driver out if the server says the session is invalid.
    async function driverFetch(path, opts) {
      opts = opts || {};
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (DRIVER_TOKEN) headers['Authorization'] = 'Bearer ' + DRIVER_TOKEN;
      const res = await fetch(path, Object.assign({}, opts, { headers }));
      if (res.status === 401) { driverSignOut(); throw new Error('Session expired'); }
      let data = {};
      try { data = await res.json(); } catch (e) { }
      if (!res.ok) { throw new Error(data.error || 'Request failed'); }
      return data;
    }

    function isDriverModeRequested() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('driver') === '1') return true;
      try { return !!localStorage.getItem(DRIVER_SESSION_KEY); } catch (e) { return false; }
    }
    function showDriverLogin() {
      document.getElementById('login-gate').style.display = 'none';
      document.getElementById('driver-login-gate').style.display = 'flex';
    }
    function showStaffLogin() {
      document.getElementById('driver-login-gate').style.display = 'none';
      document.getElementById('login-gate').style.display = 'flex';
    }
    function showDriverStatus(msg, isError) {
      const el = document.getElementById('driver-login-status');
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = isError ? 'var(--red)' : 'var(--text-faint)';
    }
    // Entry point when the page boots straight into driver mode (bookmarked
    // ?driver=1 link, or a remembered driver session) — deliberately skips
    // loadState()/restoreSession() (the Admin/Dispatcher path) entirely.
    async function initDriverMode() {
      document.getElementById('login-gate').style.display = 'none';
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(DRIVER_SESSION_KEY) || 'null'); } catch (e) { }
      if (saved && saved.driverId && saved.pin) {
        document.getElementById('driver-login-gate').style.display = 'flex';
        document.getElementById('drv-login-id').value = saved.driverId;
        showDriverStatus('Signing in…');
        const ok = await driverLogin(saved.driverId, saved.pin, true);
        if (!ok) { try { localStorage.removeItem(DRIVER_SESSION_KEY); } catch (e) { } showDriverStatus('', false); }
      } else {
        document.getElementById('driver-login-gate').style.display = 'flex';
      }
    }
    function driverLoginSubmit(e) {
      e.preventDefault();
      const id = document.getElementById('drv-login-id').value.trim();
      const pin = document.getElementById('drv-login-pin').value.trim();
      driverLogin(id, pin, false);
      return false;
    }
    async function driverLogin(driverId, pin, silent) {
      const btn = document.getElementById('drv-login-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
      if (!silent) showDriverStatus('Signing in…');
      try {
        const res = await fetch('/api/driver/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, pin })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showDriverStatus(data.error || 'Invalid Driver ID or PIN', true);
          if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
          return false;
        }
        DRIVER = data.driver;
        DRIVER_TOKEN = data.token;
        DRIVER_PERMISSIONS = data.permissions || {};
        DRIVER_LOADS = data.loads || [];
        DRIVER_COMPANY = data.companyName || 'HaulBoX';
        try { localStorage.setItem(DRIVER_SESSION_KEY, JSON.stringify({ driverId, pin, token: data.token })); } catch (e) { }
        enterDriverApp();
        return true;
      } catch (e) {
        showDriverStatus('Network error — check your connection and try again.', true);
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        return false;
      }
    }
    function driverSignOut() {
      try {
        const saved = JSON.parse(localStorage.getItem(DRIVER_SESSION_KEY) || '{}');
        if (saved.token) fetch('/api/driver/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + saved.token } }).catch(() => { });
      } catch (e) { }
      try { localStorage.removeItem(DRIVER_SESSION_KEY); } catch (e) { }
      const url = new URL(window.location.href);
      url.searchParams.delete('driver');
      window.location.href = url.toString();
    }
    function enterDriverApp() {
      document.getElementById('driver-login-gate').style.display = 'none';
      document.getElementById('login-gate').style.display = 'none';
      document.getElementById('driver-app').style.display = 'flex';
      document.getElementById('drv-name').textContent = DRIVER.name || 'Driver';
      document.getElementById('drv-truck-line').textContent = [DRIVER.truck ? ('Truck ' + DRIVER.truck) : null, DRIVER.company].filter(Boolean).join(' · ') || DRIVER_COMPANY;
      setDriverPage('home');
      refreshDriverChatBadge();
    }
    function money(n) { return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function isDriverLoadCompleted(l) { return l.status === 'Drop-off' || l.status === 'Completed' || l.status === 'Delivered'; }

    // ---------------------------------------------------------------------------
    // Bottom-nav page switching — each page lazy-loads its data the first time
    // it's opened, then just re-renders from cache on later visits (Home always
    // refreshes, since ETA/status change in the field).
    // ---------------------------------------------------------------------------
    const DRIVER_PAGE_LOADED = { home: false, loads: false, pay: false, profile: false };
    function setDriverPage(page) {
      DRIVER_PAGE = page;
      document.querySelectorAll('.drv-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
      document.querySelectorAll('.drv-page').forEach(el => el.classList.toggle('active', el.id === 'drv-page-' + page));
      if (page === 'home') loadDriverHome();
      else if (page === 'loads') loadDriverLoads();
      else if (page === 'pay') loadDriverTransactions();
      else if (page === 'chat') loadDriverChats();
      else if (page === 'profile') loadDriverProfile();
    }

    // ---------------------------------------------------------------------------
    // HOME — current load: ETA, PU/DO addresses & dates, status checkpoints,
    // pickup/drop-off photo capture.
    // ---------------------------------------------------------------------------
    const DRIVER_CHECKPOINTS = [
      { key: 'ACCEPTED', label: 'Accepted' },
      { key: 'AT_PICKUP', label: 'At Pickup' },
      { key: 'IN_TRANSIT', label: 'In Transit' },
      { key: 'AT_DELIVERY', label: 'At Delivery' },
    ];
    let DRIVER_CURRENT_LOAD = null;
    async function loadDriverHome() {
      const wrap = document.getElementById('drv-current-wrap');
      if (wrap) wrap.innerHTML = '<div class="drv-skel" style="height:220px;"></div>';
      try {
        const data = await driverFetch('/api/driver/dashboard');
        DRIVER_CURRENT_LOAD = data.currentLoad;
        const sActive = document.getElementById('drv-sum-active');
        const sComp = document.getElementById('drv-sum-completed');
        const sTotal = document.getElementById('drv-sum-total');
        if (sActive && data.summary) sActive.textContent = data.summary.activeLoads;
        if (sComp && data.summary) sComp.textContent = data.summary.completedLoads;
        if (sTotal && data.summary) sTotal.textContent = money(data.summary.totalEarnings);
        renderCurrentLoad(data.currentLoad);
      } catch (e) {
        if (wrap) wrap.innerHTML = '<div class="drv-empty-state"><div class="t">Could not load your dashboard</div><div class="s">' + escapeAttr(e.message) + '</div></div>';
      }
    }
    function renderCurrentLoad(l) {
      const wrap = document.getElementById('drv-current-wrap');
      if (!l) {
        wrap.innerHTML = `<div class="drv-empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="7" width="15" height="10" rx="1"/><path d="M16 10h4l3 3v4h-7"/><circle cx="5.5" cy="18.5" r="1.8"/><circle cx="17.5" cy="18.5" r="1.8"/></svg>
      <div class="t">No active load</div>
      <div class="s">You're all caught up. New loads will show up here.</div>
    </div>`;
        return;
      }
      const curIdx = DRIVER_CHECKPOINTS.findIndex(c => c.key === l.driverProgress);
      const nextIdx = curIdx + 1;
      wrap.innerHTML = `
    <div class="drv-current-card">
      <div class="drv-current-top">
        <div>
          <div class="drv-current-num">Load #${escapeAttr(l.loadNumber || '—')}</div>
          <div class="drv-current-status">${escapeAttr(l.status || '—')}</div>
        </div>
        <div class="drv-eta-box">
          <div class="drv-eta-label">ETA</div>
          <div class="drv-eta-val">${escapeAttr(l.eta || '—')}</div>
        </div>
      </div>

      <div class="drv-route-line">
        <div class="drv-route-marks">
          <div class="drv-route-dot pu"></div>
          <div class="drv-route-vline"></div>
          <div class="drv-route-dot do"></div>
        </div>
        <div class="drv-route-stops">
          <div>
            <div class="drv-stop-lbl">Pickup (PU)</div>
            <div class="drv-stop-addr">${escapeAttr(l.pickup || '—')}</div>
            <div class="drv-stop-date">${l.pickupDate || '—'}${l.pickupTime ? (' · ' + escapeAttr(l.pickupTime)) : ''}</div>
          </div>
          <div>
            <div class="drv-stop-lbl">Drop-off (DO)</div>
            <div class="drv-stop-addr">${escapeAttr(l.dropoff || '—')}</div>
            <div class="drv-stop-date">${l.deliveryDate || '—'}${l.deliveryTime ? (' · ' + escapeAttr(l.deliveryTime)) : ''}</div>
          </div>
        </div>
      </div>

      <div class="drv-detail-row" style="margin-top:16px;"><span class="k">Miles</span><span>${l.miles || '—'}</span></div>
      <div class="drv-detail-row"><span class="k">Your Pay</span><span style="color:var(--accent);font-weight:700;">${money(l.driverPay)} — ${driverPayStatusLabel(l)}</span></div>
      ${l.notes ? `<div class="drv-detail-row"><span class="k">Notes</span><span>${escapeAttr(l.notes)}</span></div>` : ''}

      <div class="drv-section-title" style="margin:16px 0 6px;">Update Status</div>
      <div class="drv-checkpoints">
        ${DRIVER_CHECKPOINTS.map((c, i) => `<button class="drv-cp-btn ${i <= curIdx ? 'done' : (i === nextIdx ? 'current' : '')}" ${i === nextIdx ? `onclick="driverUpdateStatus('${l.id}','${c.key}')"` : 'disabled'}>${escapeAttr(c.label)}</button>`).join('')}
      </div>

      <div class="drv-section-title" style="margin:16px 0 6px;">Photos</div>
      <div class="drv-photo-row">
        ${driverPhotoBtnHtml(l, 'PhotosPU', 'Pickup Photos', 'home')}
        ${driverPhotoBtnHtml(l, 'PhotosDO', 'Drop-off Photos', 'home')}
      </div>
    </div>
  `;
    }
    function driverPhotoBtnHtml(l, key, label, ctx) {
      const arr = (l.docs && l.docs[key]) || [];
      const cap = 6;
      const atCap = arr.length >= cap;
      const thumbs = arr.map(f => `<div class="drv-photo-thumb" title="${escapeAttr(f.name || 'photo')}">
      <div ${f.hasFile ? `onclick="driverViewPhoto('${l.id}','${key}',${f.index},'${ctx}')"` : ''} style="cursor:pointer;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">IMG</div>
      <button class="drv-photo-del" title="Delete" onclick="event.stopPropagation();deleteDriverPhoto('${l.id}','${key}',${f.index},'${ctx}')">✕</button>
    </div>`).join('');
      return `<div>
    <label class="drv-photo-btn" style="${atCap ? 'opacity:.55;' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>
      ${escapeAttr(label)}
      <span class="cnt">${arr.length}/${cap} uploaded</span>
      <input type="file" accept="image/*" capture="environment" style="display:none;" ${atCap ? 'disabled' : ''} onchange="driverUploadDoc('${l.id}','${key}', this, '${ctx}')">
    </label>
    ${thumbs ? `<div class="drv-photo-thumbs">${thumbs}</div>` : ''}
  </div>`;
    }
    async function driverUpdateStatus(loadId, status) {
      try {
        await driverFetch('/api/driver/loads/' + loadId + '/status', { method: 'POST', body: JSON.stringify({ status }) });
        toast('Status updated', status.replace('_', ' '), true);
        loadDriverHome();
        DRIVER_PAGE_LOADED.loads = false;
      } catch (e) { toast('Could not update status', e.message, false); }
    }

    // ---------------------------------------------------------------------------
    // LOADS — history (active / completed / all)
    // ---------------------------------------------------------------------------
    async function loadDriverLoads() {
      const el = document.getElementById('drv-load-list');
      if (!DRIVER_PAGE_LOADED.loads) {
        el.innerHTML = '<div class="drv-skel" style="height:80px;margin-bottom:10px;"></div><div class="drv-skel" style="height:80px;"></div>';
        try {
          const data = await driverFetch('/api/driver/loads?filter=all');
          DRIVER_LOADS = data.loads || [];
          DRIVER_PAGE_LOADED.loads = true;
        } catch (e) { el.innerHTML = '<div class="drv-empty">Could not load your loads.</div>'; return; }
      }
      renderDriverLoadList();
    }
    function setDriverFilter(f) {
      DRIVER_FILTER = f;
      document.querySelectorAll('#drv-tabs .drv-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
      renderDriverLoadList();
    }
    function driverFilteredLoads() {
      if (DRIVER_FILTER === 'active') return DRIVER_LOADS.filter(l => !isDriverLoadCompleted(l));
      if (DRIVER_FILTER === 'completed') return DRIVER_LOADS.filter(isDriverLoadCompleted);
      return DRIVER_LOADS;
    }
    function driverPayStatusLabel(l) {
      return l.driverPaid ? '<span style="color:var(--green);">Paid' + (l.driverPaidDate ? (' · ' + l.driverPaidDate) : '') + '</span>' : '<span style="color:var(--yellow);">Pending</span>';
    }
    function renderDriverLoadList() {
      const list = driverFilteredLoads();
      const el = document.getElementById('drv-load-list');
      if (!list.length) { el.innerHTML = '<div class="drv-empty">No loads here yet.</div>'; return; }
      el.innerHTML = list.map(l => `
    <div class="drv-load-card" onclick="openDriverLoadModal('${l.id}')">
      <div class="drv-load-card-top">
        <div>
          <div class="drv-load-num">Load #${escapeAttr(l.loadNumber || '—')} · ${escapeAttr(l.status || '—')}</div>
          <div class="drv-load-route">${escapeAttr(l.pickup || '—')} → ${escapeAttr(l.dropoff || '—')}</div>
          <div class="drv-load-dates">${l.pickupDate || '—'} → ${l.deliveryDate || '—'}</div>
        </div>
        <div class="drv-load-pay">
          <div class="drv-load-pay-amt">${money(l.driverPay)}</div>
          <div class="drv-load-pay-status">${driverPayStatusLabel(l)}</div>
        </div>
      </div>
    </div>
  `).join('');
    }
    const DRIVER_DOC_SLOTS = [
      { key: 'RC', label: 'Rate Confirmation', upload: false },
      { key: 'BOL', label: 'Bill of Lading', upload: true },
      { key: 'POD', label: 'Proof of Delivery', upload: true },
      { key: 'PhotosPU', label: 'Pickup Photos', upload: true, array: true, cap: 6, photo: true },
      { key: 'PhotosDO', label: 'Drop-off Photos', upload: true, array: true, cap: 6, photo: true },
      { key: 'Extra', label: 'Extra Documents', upload: true, array: true, cap: 6 },
    ];
    function openDriverLoadModal(loadId) {
      const l = DRIVER_LOADS.find(x => x.id === loadId); if (!l) return;
      document.getElementById('drv-load-title').textContent = 'Load #' + (l.loadNumber || '—');
      document.getElementById('drv-load-body').innerHTML = `
    <div class="drv-detail-row"><span class="k">Status</span><span>${escapeAttr(l.status || '—')}</span></div>
    <div class="drv-detail-row"><span class="k">ETA</span><span>${escapeAttr(l.eta || '—')}</span></div>
    <div class="drv-detail-row"><span class="k">Pickup (PU)</span><span>${escapeAttr(l.pickup || '—')}</span></div>
    <div class="drv-detail-row"><span class="k">Pickup Date</span><span>${l.pickupDate || '—'}${l.pickupTime ? (' · ' + escapeAttr(l.pickupTime)) : ''}</span></div>
    <div class="drv-detail-row"><span class="k">Drop-off (DO)</span><span>${escapeAttr(l.dropoff || '—')}</span></div>
    <div class="drv-detail-row"><span class="k">Delivery Date</span><span>${l.deliveryDate || '—'}${l.deliveryTime ? (' · ' + escapeAttr(l.deliveryTime)) : ''}</span></div>
    <div class="drv-detail-row"><span class="k">Miles</span><span>${l.miles || '—'}</span></div>
    <div class="drv-detail-row"><span class="k">Your Pay</span><span style="color:var(--accent);font-weight:700;">${money(l.driverPay)} — ${driverPayStatusLabel(l)}</span></div>
    ${l.notes ? `<div class="drv-detail-row"><span class="k">Notes</span><span>${escapeAttr(l.notes)}</span></div>` : ''}
    <div class="form-section-title" style="margin-top:16px;">Documents &amp; Photos</div>
    <div id="drv-doc-list">${DRIVER_DOC_SLOTS.map(s => driverDocSlotHtml(l, s)).join('')}</div>
  `;
      openModal('modal-driver-load');
    }
    function driverDocSlotHtml(l, s) {
      if (s.array) {
        const arr = (l.docs && l.docs[s.key]) || [];
        const atCap = arr.length >= s.cap;
        const filesHtml = arr.map(f => `<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-dim);">
        <span ${f.hasFile ? 'style="cursor:pointer;text-decoration:underline;"' : ''} onclick="${f.hasFile ? (s.photo ? `driverViewPhoto('${l.id}','${s.key}',${f.index},'modal')` : `driverViewDoc('${l.id}','${s.key}',${f.index})`) : ''}">${escapeAttr(f.name || 'file')}</span>
        ${f.hasFile ? `<button class="btn btn-sm btn-ghost" style="padding:1px 6px;font-size:10px;color:var(--red);" onclick="deleteDriverPhoto('${l.id}','${s.key}',${f.index},'modal')">✕</button>` : ''}
      </div>`).join('');
        return `<div class="drv-doc-item"><div><div class="lbl">${s.label} (${arr.length}/${s.cap})</div>${filesHtml || '<div class="hint">No files yet</div>'}</div>
      ${s.upload ? `<label class="btn btn-sm btn-ghost" style="margin:0;">${atCap ? 'Full' : 'Add'}<input type="file" ${s.photo ? 'accept="image/*" capture="environment"' : ''} style="display:none;" ${atCap ? 'disabled' : ''} onchange="driverUploadDoc('${l.id}','${s.key}', this, 'modal')"></label>` : ''}
    </div>`;
      }
      const f = l.docs && l.docs[s.key];
      return `<div class="drv-doc-item"><div><div class="lbl">${s.label}</div>${f ? `<div class="hint" style="${f.hasFile ? 'cursor:pointer;text-decoration:underline;' : ''}" ${f.hasFile ? `onclick="driverViewDoc('${l.id}','${s.key}')"` : ''}>${escapeAttr(f.name || 'On file')}</div>` : '<div class="hint">Not uploaded yet</div>'}</div>
    ${s.upload ? `<label class="btn btn-sm btn-ghost" style="margin:0;">${f ? 'Replace' : 'Add'}<input type="file" style="display:none;" onchange="driverUploadDoc('${l.id}','${s.key}', this, 'modal')"></label>` : ''}
  </div>`;
    }
    async function driverViewDoc(loadId, key, index) {
      try {
        const body = { loadId, key };
        if (index != null) body.index = index;
        const data = await driverFetch('/api/driver/doc', { method: 'POST', body: JSON.stringify(body) });
        const a = document.createElement('a'); a.href = data.data; a.download = data.name || 'document'; a.click();
      } catch (e) { toast('Could not open file', e.message || '', false); }
    }
    let DRIVER_PHOTO_CTX = null;
    async function driverViewPhoto(loadId, key, index, ctx) {
      try {
        const data = await driverFetch('/api/driver/doc', { method: 'POST', body: JSON.stringify({ loadId, key, index }) });
        DRIVER_PHOTO_CTX = { loadId, key, index, ctx };
        document.getElementById('drv-photo-title').textContent = data.name || 'Photo';
        document.getElementById('drv-photo-img').src = data.data;
        openModal('modal-driver-photo');
      } catch (e) { toast('Could not open photo', e.message || '', false); }
    }
    async function deleteDriverPhoto(loadId, key, index, ctx) {
      if (!confirm('Delete this photo?')) return;
      try {
        const data = await driverFetch('/api/driver/upload-doc', { method: 'DELETE', body: JSON.stringify({ loadId, key, index }) });
        const idx = DRIVER_LOADS.findIndex(x => x.id === loadId);
        if (idx > -1) DRIVER_LOADS[idx] = data.load;
        toast('Photo deleted', '', true);
        if (ctx === 'home') { DRIVER_CURRENT_LOAD = data.load; renderCurrentLoad(data.load); }
        else { openDriverLoadModal(loadId); renderDriverLoadList(); }
      } catch (e) { toast('Could not delete', e.message || '', false); }
    }
    function deleteDriverPhotoFromViewer() {
      if (!DRIVER_PHOTO_CTX) return;
      const { loadId, key, index, ctx } = DRIVER_PHOTO_CTX;
      closeModal('modal-driver-photo');
      deleteDriverPhoto(loadId, key, index, ctx);
    }
    async function driverUploadDoc(loadId, key, input, ctx) {
      if (!input.files.length) return;
      const file = input.files[0];
      if (file.size > 1500000) { toast('File too large', 'Keep uploads under 1.5MB.', false); input.value = ''; return; }
      let dataUrl;
      try { dataUrl = await readFileAsDataURL(file); } catch (e) { toast('Could not read file', '', false); return; }
      try {
        const data = await driverFetch('/api/driver/upload-doc', {
          method: 'POST',
          body: JSON.stringify({ loadId, key, fileName: file.name, mimeType: file.type, data: dataUrl })
        });
        const idx = DRIVER_LOADS.findIndex(x => x.id === loadId);
        if (idx > -1) DRIVER_LOADS[idx] = data.load;
        toast('Uploaded', file.name, true);
        if (ctx === 'home') { DRIVER_CURRENT_LOAD = data.load; renderCurrentLoad(data.load); }
        else { openDriverLoadModal(loadId); renderDriverLoadList(); }
      } catch (e) { toast('Upload failed', e.message || '', false); }
    }

    // ---------------------------------------------------------------------------
    // CHAT — reuses the same /api/driver/chats* endpoints the Admin/Dispatcher
    // and driver-portal.html sides already use (see routes/driver.js, lib/chatStore.js).
    // ---------------------------------------------------------------------------
    let DRIVER_CHATS = [];
    let DRIVER_CHAT_THREAD_ID = null;
    function driverRoleLabel(type) {
      if (type === 'admin') return 'Owner';
      if (type === 'dispatcher') return 'Dispatcher';
      if (type === 'driver') return 'Driver';
      return 'Owner';
    }
    function driverRoleClass(type) { return type === 'admin' ? 'owner' : (type || 'driver'); }
    function driverChatInitials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
    async function loadDriverChats() {
      const el = document.getElementById('drv-chat-list');
      el.innerHTML = '<div class="drv-skel" style="height:60px;margin-bottom:10px;"></div><div class="drv-skel" style="height:60px;"></div>';
      try {
        const data = await driverFetch('/api/driver/chats');
        DRIVER_CHATS = data.chats || [];
        updateDriverChatBadge(DRIVER_CHATS.reduce((s, c) => s + (c.unreadCount || 0), 0));
        if (!DRIVER_CHATS.length) { el.innerHTML = '<div class="drv-empty">No conversations yet.</div>'; return; }
        el.innerHTML = DRIVER_CHATS.map(driverChatRowHtml).join('');
      } catch (e) { el.innerHTML = '<div class="drv-empty">' + escapeAttr(e.message) + '</div>'; }
    }
    function driverChatRowHtml(c) {
      if (c.isGroup) {
        return `<div class="drv-chat-row" onclick="openDriverChatThread(${c.id}, '${escapeAttr(c.groupName || 'Group Chat').replace(/'/g, "")}', true)">
      <div class="drv-chat-avatar group">GRP</div>
      <div class="drv-chat-body"><div class="drv-chat-name">${escapeAttr(c.groupName || 'Group Chat')}</div><div class="drv-chat-preview">${escapeAttr(c.lastMessage || 'No messages yet')}</div></div>
      ${c.unreadCount ? `<div class="drv-chat-badge">${c.unreadCount}</div>` : ''}
    </div>`;
      }
      const label = driverRoleLabel(c.with.type);
      return `<div class="drv-chat-row" onclick="openDriverChatThread(${c.id}, '${label}', false)">
    <div class="drv-chat-avatar ${driverRoleClass(c.with.type)}">${driverChatInitials(label)}</div>
    <div class="drv-chat-body"><div class="drv-chat-name">${label}</div><div class="drv-chat-preview">${escapeAttr(c.lastMessage || 'No messages yet')}</div></div>
    ${c.unreadCount ? `<div class="drv-chat-badge">${c.unreadCount}</div>` : ''}
  </div>`;
    }
    async function openDriverChatThread(id, title, isGroup) {
      DRIVER_CHAT_THREAD_ID = id;
      document.getElementById('drv-chat-thread-title').textContent = title;
      document.getElementById('drv-chat-thread-msgs').innerHTML = '<div class="drv-empty">Loading…</div>';
      openModal('modal-driver-chat');
      try {
        const data = await driverFetch('/api/driver/chats/' + id + '/messages');
        renderDriverChatMessages(data.messages || []);
        refreshDriverChatBadge(); // this GET marks the thread read server-side
      } catch (e) { document.getElementById('drv-chat-thread-msgs').innerHTML = '<div class="drv-empty">' + escapeAttr(e.message) + '</div>'; }
    }
    function renderDriverChatMessages(msgs) {
      const box = document.getElementById('drv-chat-thread-msgs');
      if (!msgs.length) { box.innerHTML = '<div class="drv-empty">Say hello 👋</div>'; return; }
      box.innerHTML = msgs.map(m => {
        const mine = m.senderType === 'driver';
        const who = !mine ? `<span class="who">${escapeAttr(driverRoleLabel(m.senderType))}${m.senderName ? (' · ' + escapeAttr(m.senderName)) : ''}</span>` : '';
        return `<div class="drv-msg ${mine ? 'mine' : 'theirs'}">${who}${escapeAttr(m.body)}<span class="when">${new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>`;
      }).join('');
      box.scrollTop = box.scrollHeight;
    }
    function closeDriverChatThread() { closeModal('modal-driver-chat'); DRIVER_CHAT_THREAD_ID = null; loadDriverChats(); }
    async function sendDriverChatMessage() {
      const input = document.getElementById('drv-chat-input');
      const text = (input.value || '').trim();
      if (!text || !DRIVER_CHAT_THREAD_ID) return;
      input.value = '';
      try {
        await driverFetch('/api/driver/chats/' + DRIVER_CHAT_THREAD_ID + '/messages', { method: 'POST', body: JSON.stringify({ body: text }) });
        const data = await driverFetch('/api/driver/chats/' + DRIVER_CHAT_THREAD_ID + '/messages');
        renderDriverChatMessages(data.messages || []);
      } catch (e) { toast('Could not send', e.message || '', false); }
    }
    function updateDriverChatBadge(n) {
      const b = document.getElementById('drv-chat-nav-badge');
      if (!b) return;
      b.textContent = n > 9 ? '9+' : String(n);
      b.style.display = n > 0 ? 'flex' : 'none';
    }
    async function refreshDriverChatBadge() {
      try {
        const data = await driverFetch('/api/driver/chats');
        updateDriverChatBadge((data.chats || []).reduce((s, c) => s + (c.unreadCount || 0), 0));
      } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // PAY — transactions (derived from each load's driver-pay fields)
    // ---------------------------------------------------------------------------
    async function loadDriverTransactions() {
      const el = document.getElementById('drv-txn-list');
      el.innerHTML = '<div class="drv-skel" style="height:60px;margin-bottom:9px;"></div><div class="drv-skel" style="height:60px;"></div>';
      try {
        const data = await driverFetch('/api/driver/transactions');
        document.getElementById('drv-txn-total').textContent = money(data.summary.totalEarnings);
        document.getElementById('drv-txn-paid').textContent = money(data.summary.paid);
        document.getElementById('drv-txn-pending').textContent = money(data.summary.pending);
        if (!data.transactions.length) { el.innerHTML = '<div class="drv-empty">No transactions yet.</div>'; return; }
        el.innerHTML = data.transactions.map(t => `
      <div class="drv-txn-card">
        <div>
          <div class="drv-txn-num">Load #${escapeAttr(t.loadNumber || '—')}</div>
          <div class="drv-txn-date">${t.date || '—'}</div>
        </div>
        <div style="text-align:right;">
          <div class="drv-txn-amt">${money(t.amount)}</div>
          <div class="drv-txn-badge ${t.status === 'PAID' ? 'paid' : 'pending'}">${t.status === 'PAID' ? ('Paid' + (t.paidDate ? (' · ' + t.paidDate) : '')) : 'Pending'}</div>
        </div>
      </div>
    `).join('');
      } catch (e) { el.innerHTML = '<div class="drv-empty">Could not load transactions.</div>'; }
    }

    // ---------------------------------------------------------------------------
    // PROFILE — driver details + own documents (license, insurance, medical
    // card, registration, extras). Viewing is always allowed; uploading/
    // replacing requires canEditOwnDocuments (Admin-granted).
    // ---------------------------------------------------------------------------
    const DRIVER_PROFILE_DOC_SLOTS = [
      { key: 'license', label: 'Driver License' },
      { key: 'insurance', label: 'Insurance' },
      { key: 'medicalCard', label: 'Medical Card' },
      { key: 'registration', label: 'Registration' },
    ];
    async function loadDriverProfile() {
      const infoEl = document.getElementById('drv-info-list');
      const docEl = document.getElementById('drv-doc-cards');
      infoEl.innerHTML = '<div class="drv-skel" style="height:120px;"></div>';
      docEl.innerHTML = '';
      try {
        const [meData, docsData] = await Promise.all([
          driverFetch('/api/driver/me'),
          driverFetch('/api/driver/documents'),
        ]);
        renderDriverProfile(meData.driver, docsData);
      } catch (e) {
        infoEl.innerHTML = '<div class="drv-empty">Could not load your profile.</div>';
      }
    }
    function renderDriverProfile(d, docsData) {
      document.getElementById('drv-profile-avatar').textContent = (d.name || 'D').trim().charAt(0).toUpperCase();
      document.getElementById('drv-profile-name').textContent = d.name || 'Driver';
      document.getElementById('drv-profile-sub').textContent = [d.truck ? ('Truck ' + d.truck) : null, d.company].filter(Boolean).join(' · ') || DRIVER_COMPANY;
      const badge = document.getElementById('drv-profile-status');
      badge.textContent = d.status || 'Active';
      badge.classList.toggle('inactive', (d.status || '').toLowerCase() !== 'active');

      document.getElementById('drv-info-list').innerHTML = `
    <div class="drv-info-row"><span class="k">Phone</span><span class="v">${escapeAttr(d.phone || '—')}</span></div>
    <div class="drv-info-row"><span class="k">Email</span><span class="v">${escapeAttr(d.email || '—')}</span></div>
    <div class="drv-info-row"><span class="k">Truck #</span><span class="v">${escapeAttr(d.truck || '—')}</span></div>
    <div class="drv-info-row"><span class="k">Company</span><span class="v">${escapeAttr(d.company || '—')}</span></div>
  `;

      const canEdit = !!docsData.canEdit;
      const docs = docsData.documents || {};
      const cardHtml = (label, doc, uploadKey, index) => {
        let statusHtml, statusClass = 'none';
        if (doc) {
          statusClass = doc.flag === 'EXPIRED' ? 'bad' : (doc.flag === 'EXPIRES_SOON' ? 'warn' : 'ok');
          statusHtml = doc.flag === 'EXPIRED' ? 'Expired' + (doc.expiryDate ? (' · ' + doc.expiryDate) : '') :
            doc.flag === 'EXPIRES_SOON' ? 'Expires soon · ' + doc.expiryDate :
              (doc.uploadedDate ? 'On file · uploaded ' + doc.uploadedDate : 'On file');
        } else {
          statusHtml = 'Not uploaded';
        }
        const viewBtn = doc && doc.hasFile ? `<button class="btn btn-sm btn-ghost" onclick="driverViewProfileDoc('${uploadKey}',${index == null ? 'null' : index})">View</button>` : '';
        const uploadBtn = canEdit ? `<button class="btn btn-sm btn-ghost" onclick="openDriverDocUpload('${uploadKey}','${escapeAttr(label)}')">${doc ? 'Replace' : 'Add'}</button>` : '';
        return `<div class="drv-doc-card">
      <div><div class="lbl">${escapeAttr(label)}</div><div class="status ${statusClass}">${statusHtml}</div></div>
      <div style="display:flex;gap:6px;">${viewBtn}${uploadBtn}</div>
    </div>`;
      };

      let html = DRIVER_PROFILE_DOC_SLOTS.map(s => cardHtml(s.label, docs[s.key], s.key, null)).join('');
      (docs.other || []).forEach(o => { html += cardHtml('Extra Document', o, 'other', o.index); });
      if (canEdit) html += `<button class="btn btn-sm btn-ghost" style="width:100%;margin-top:2px;" onclick="openDriverDocUpload('other','Extra Document')">+ Add Extra Document</button>`;
      if (!canEdit) html += `<div class="hint" style="color:var(--text-faint);font-size:11px;margin-top:6px;">Contact your dispatcher or admin to update these documents.</div>`;
      document.getElementById('drv-doc-cards').innerHTML = html;
    }
    async function driverViewProfileDoc(key, index) {
      try {
        const body = { key };
        if (index != null) body.index = index;
        const data = await driverFetch('/api/driver/documents/file', { method: 'POST', body: JSON.stringify(body) });
        const a = document.createElement('a'); a.href = data.data; a.download = data.name || 'document'; a.click();
      } catch (e) { toast('Could not open file', e.message || '', false); }
    }
    function openDriverDocUpload(key, label) {
      DRIVER_DOC_UPLOAD_CTX = { key };
      document.getElementById('drv-doc-modal-title').textContent = label;
      document.getElementById('drv-doc-file').value = '';
      document.getElementById('drv-doc-expiry').value = '';
      openModal('modal-driver-doc');
    }
    async function submitDriverDocUpload(e) {
      e.preventDefault();
      const input = document.getElementById('drv-doc-file');
      const expiry = document.getElementById('drv-doc-expiry').value || null;
      if (!input.files.length) return false;
      const file = input.files[0];
      if (file.size > 1500000) { toast('File too large', 'Keep uploads under 1.5MB.', false); return false; }
      try {
        const dataUrl = await readFileAsDataURL(file);
        await driverFetch('/api/driver/documents', {
          method: 'POST',
          body: JSON.stringify({ key: DRIVER_DOC_UPLOAD_CTX.key, fileName: file.name, data: dataUrl, expiryDate: expiry })
        });
        toast('Document saved', file.name, true);
        closeModal('modal-driver-doc');
        loadDriverProfile();
      } catch (e) { toast('Upload failed', e.message || '', false); }
      return false;
    }

    // Theme init before login (so login screen matches preference)
    (function () {
      let pref = 'dark';
      try { pref = localStorage.getItem('haulline-theme-pref') || 'dark'; } catch (e) { }
      document.documentElement.setAttribute('data-theme', pref);
      document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('theme-dark-btn').classList.toggle('active', pref === 'dark');
        document.getElementById('theme-light-btn').classList.toggle('active', pref === 'light');
        if (isDriverModeRequested()) {
          initDriverMode();
          return;
        }
        loadState().then(() => { STATE._loaded = true; updateBranding(); return restoreSession(); }).catch(() => { });
      });
    })();

    /* ================================================================
       WHATSAPP-STYLE CHAT ENGINE
       ================================================================ */

    // State
    let waCurrentConvoId = null;
    let waFilter = 'all';
    let waPendingAttachments = [];  // {name, size, type, dataUrl, base64}
    let waLoadTag = null;           // {id, number}
    let waEmojiOpen = false;
    let waAttachMenuOpen = false;
    let waMsgSearchOpen = false;
    let waChatPollTimer = null;

    // Initialise WhatsApp chat pane when chat view is opened
    async function initWaChat() {
      if (STATE.role === 'viewonly') return;
      // Set my avatar initials
      const myName = STATE.currentUser?.name || (STATE.role === 'admin' ? 'Admin' : 'Dispatcher');
      const myAv = document.getElementById('wa-my-avatar');
      if (myAv) myAv.textContent = initials(myName);
      const myNm = document.getElementById('wa-my-name');
      if (myNm) myNm.textContent = myName;

      // Build emoji grid with clickable spans
      const grid = document.getElementById('wa-emoji-grid');
      if (grid && grid.children.length === 0) {
        const emojis = ['😀', '😂', '😍', '🥰', '😎', '😊', '🤔', '😮', '😢', '😡', '👍', '👎', '👏', '🙏', '🤝', '💪', '🔥', '❤️', '✅', '⚠️', '📦', '🚛', '📋', '📞', '💰', '🗂️', '📍', '🗺️', '⏰', '📅', '🔔', '📱', '💬', '📷', '📎', '🗒️', '✏️', '📌', '🎯', '✔️'];
        grid.innerHTML = emojis.map(e => `<span onclick="waInsertEmoji('${e}')">${e}</span>`).join('');
      }

      await Promise.all([fetchChatConvs(), fetchMainChatContacts()]);
      waRenderList();
      updateChatBadge();

      // Start polling
      if (!waChatPollTimer) {
        waChatPollTimer = setInterval(async () => {
          if (document.getElementById('view-chat')?.classList.contains('active')) {
            await fetchChatConvs();
            waRenderList();
            updateChatBadge();
            if (waCurrentConvoId) waLoadMessages();
          }
        }, 4000);
      }
    }

    // --- Avatar color helper ---
    const WA_COLORS = ['wa-av-blue', 'wa-av-purple', 'wa-av-orange', 'wa-av-teal', 'wa-av-red', 'wa-av-green', 'wa-av-gray'];
    function waAvatarColor(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      return WA_COLORS[Math.abs(hash) % WA_COLORS.length];
    }

    // --- Format time for chat list ---
    function waFormatListTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const now = new Date();
      const diffDays = Math.floor((now - d) / 86400000);
      if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
    }

    // --- Format message time ---
    function waFormatMsgTime(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // --- Format date separator ---
    function waFormatDateSep(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const now = new Date();
      const diffDays = Math.floor((now - d) / 86400000);
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    // --- Filter ---
    function waSetFilter(f) {
      waFilter = f;
      document.querySelectorAll('.wa-filter-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === f);
      });
      waRenderList();
    }

    function waFilterList() { waRenderList(); }

    // --- Render left sidebar chat list ---
    function waRenderList() {
      const container = document.getElementById('wa-chat-list');
      if (!container) return;
      const searchQ = (document.getElementById('wa-search-input')?.value || '').toLowerCase().trim();
      const accountId = String(STATE.currentUser?.id || (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));

      // Build items from contacts (new chat) + convos (recent)
      let html = '';

      // ---- CONTACTS (new chat starters) ----
      const filteredContacts = (mainChatContacts || []).filter(c => {
        if (waFilter === 'driver' && c.type !== 'driver') return false;
        if (waFilter === 'dispatcher' && c.type !== 'dispatcher') return false;
        if (waFilter === 'unread') return false; // unread = existing convos only
        if (searchQ && !c.name.toLowerCase().includes(searchQ)) return false;
        return true;
      });

      if (filteredContacts.length > 0) {
        html += `<div class="wa-list-section-label">Contacts</div>`;
        html += filteredContacts.map(c => {
          const color = waAvatarColor(c.name);
          const role = c.type === 'driver' ? '🚛 Driver' : c.type === 'ops' ? '👥 Group' : '👤 Dispatcher';
          return `
        <div class="wa-chat-item" onclick="waStartChat('${c.type}','${c.id}','${escapeChat(c.name)}')">
          <div class="wa-avatar wa-avatar-sm ${color}">${initials(c.name)}</div>
          <div class="wa-chat-item-body">
            <div class="wa-chat-item-top">
              <span class="wa-chat-item-name">${escapeChat(c.name)}</span>
              <span class="wa-chat-item-time" style="font-size:10px;color:#8696a0;">${role}</span>
            </div>
            <div class="wa-chat-item-preview">Tap to start chat</div>
          </div>
        </div>`;
        }).join('');
      }

      // ---- CONVERSATIONS (recent) ----
      let filteredConvos = (chatConvs || []).filter(c => {
        let name = c.groupName;
        if (!name) {
          const other = (c.members || []).find(m => String(m.id) !== accountId);
          name = other ? (other.name || other.id) : 'Chat';
        }
        if (waFilter === 'driver') {
          const other = (c.members || []).find(m => String(m.id) !== accountId);
          if (!other || other.type !== 'driver') return false;
        }
        if (waFilter === 'dispatcher') {
          const other = (c.members || []).find(m => String(m.id) !== accountId);
          if (!other || other.type !== 'dispatcher') return false;
        }
        if (waFilter === 'unread' && !(c.unreadCount > 0)) return false;
        if (searchQ) {
          if (!name.toLowerCase().includes(searchQ) && !(c.lastMessage || '').toLowerCase().includes(searchQ)) return false;
        }
        return true;
      });

      if (filteredConvos.length > 0) {
        html += `<div class="wa-list-section-label">Recent</div>`;
        html += filteredConvos.map(c => {
          let name = c.groupName;
          if (!name) {
            const other = (c.members || []).find(m => String(m.id) !== accountId);
            name = other ? (other.name || other.id) : 'Chat';
          }
          const color = waAvatarColor(name);
          const isActive = String(c.id) === String(waCurrentConvoId);
          const preview = c.lastMessage || 'No messages yet';
          return `
        <div class="wa-chat-item ${isActive ? 'active' : ''}" onclick="waSelectConvo('${c.id}','${escapeChat(name)}',${!!c.isGroup})">
          <div class="wa-avatar wa-avatar-sm ${color}">${initials(name)}</div>
          <div class="wa-chat-item-body">
            <div class="wa-chat-item-top">
              <span class="wa-chat-item-name">${escapeChat(name)}</span>
              <span class="wa-chat-item-time">${waFormatListTime(c.lastMessageAt)}</span>
            </div>
            <div class="wa-chat-item-preview">${escapeChat(preview)}</div>
          </div>
          ${c.unreadCount > 0 ? `<div class="wa-chat-badge">${c.unreadCount > 99 ? '99+' : c.unreadCount}</div>` : ''}
        </div>`;
        }).join('');
      }

      if (!html) {
        html = `<div style="padding:24px 16px;text-align:center;color:#8696a0;font-size:13px;">No conversations found</div>`;
      }

      container.innerHTML = html;
    }

    // --- Start new chat from contact ---
    async function waStartChat(type, id, name) {
      const accountId = STATE.currentUser?.id || (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId);
      try {
        const res = await fetch('/api/chat/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, role: STATE.role, withType: type, withId: id })
        });
        if (res.ok) {
          const d = await res.json();
          await fetchChatConvs();
          waSelectConvo(d.conversationId, name, type === 'ops');
        }
      } catch (e) { toast('Error', 'Failed to start chat'); }
    }

    // --- Select an existing convo ---
    function waSelectConvo(id, name, isGroup) {
      waCurrentConvoId = id;

      // Show active chat pane
      document.getElementById('wa-empty-state').style.display = 'none';
      const ac = document.getElementById('wa-active-chat');
      ac.style.display = 'flex';

      // Update header
      const color = waAvatarColor(name);
      document.getElementById('wa-chat-av').textContent = initials(name);
      document.getElementById('wa-chat-av').className = `wa-avatar wa-avatar-md ${color}`;
      document.getElementById('wa-chat-hdr-name').textContent = name;
      document.getElementById('wa-chat-hdr-sub').textContent = isGroup ? 'Group chat' : 'Dispatcher · Driver';

      waRenderList();
      waLoadMessages();
    }

    // --- Load & render messages ---
    async function waLoadMessages() {
      if (!waCurrentConvoId) return;
      const accountId = String(STATE.currentUser?.id || (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const body = document.getElementById('wa-messages-body');
      const area = document.getElementById('wa-messages-area');
      const wasAtBottom = area ? area.scrollHeight - area.scrollTop <= area.clientHeight + 60 : true;

      try {
        const res = await fetch(`/api/chat/conversations/${waCurrentConvoId}/messages?accountId=${encodeURIComponent(accountId)}&role=${encodeURIComponent(STATE.role)}`);
        if (!res.ok) return;
        const d = await res.json();
        const msgs = d.messages || [];
        if (!body) return;

        if (!msgs.length) {
          body.innerHTML = `<div style="text-align:center;padding:40px 0;color:#8696a0;font-size:13px;">No messages yet.<br>Say hello! 👋</div>`;
          return;
        }

        // Group by date
        let lastDateStr = null;
        let html = '';
        msgs.forEach(m => {
          const isMine = String(m.senderId) === accountId;
          const dir = isMine ? 'out' : 'in';
          const timeStr = waFormatMsgTime(m.createdAt);
          const dateStr = waFormatDateSep(m.createdAt);

          // Date separator
          if (dateStr !== lastDateStr) {
            html += `<div class="wa-date-sep"><span>${dateStr}</span></div>`;
            lastDateStr = dateStr;
          }

          // Build bubble content
          let bubbleContent = '';

          // Sender name (for group chats / incoming)
          if (!isMine && m.senderName) {
            bubbleContent += `<div class="wa-bubble-sender">${escapeChat(m.senderName)}</div>`;
          }

          // Load tag
          if (m.loadNumber) {
            bubbleContent += `<div class="wa-load-tag">📦 Load #${escapeChat(m.loadNumber)}</div>`;
          }

          // Attachment (image, doc, or file)
          if (m.attachment) {
            const att = m.attachment;
            if (att.type && att.type.startsWith('image/')) {
              bubbleContent += `
            <div class="wa-img-bubble" onclick="waOpenImage('${escapeChat(att.dataUrl || '')}')">
              <img src="${escapeChat(att.dataUrl || att.url || '')}" alt="${escapeChat(att.name || 'Image')}" onerror="this.parentElement.style.display='none'">
            </div>`;
              if (att.caption) bubbleContent += `<div class="wa-bubble-text">${escapeChat(att.caption)}</div>`;
            } else {
              const extColor = waDocColor(att.name || att.type || '');
              bubbleContent += `
            <div class="wa-doc-bubble" onclick="waDownloadAttachment('${escapeChat(att.dataUrl || '')}','${escapeChat(att.name || 'file')}')">
              <div class="wa-doc-icon" style="background:${extColor};">
                <svg viewBox="0 0 24 24" fill="white"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
              </div>
              <div class="wa-doc-info">
                <div class="wa-doc-name">${escapeChat(att.name || 'Document')}</div>
                <div class="wa-doc-size">${att.size ? waFormatSize(att.size) : 'Document'}</div>
              </div>
            </div>`;
            }
          }

          // Text body
          if (m.body && m.body.trim()) {
            bubbleContent += `<div class="wa-bubble-text">${escapeChat(m.body)}</div>`;
          }

          // Meta row (time + ticks)
          bubbleContent += `
        <div class="wa-bubble-meta">
          <span class="wa-bubble-time">${timeStr}</span>
          ${isMine ? '<span class="wa-bubble-ticks">✓✓</span>' : ''}
        </div>`;

          html += `
        <div class="wa-msg-wrap ${dir}">
          <div class="wa-bubble">${bubbleContent}</div>
        </div>`;
        });

        body.innerHTML = html;
        if (wasAtBottom && area) area.scrollTop = area.scrollHeight;
      } catch (e) { console.error('waLoadMessages:', e); }
    }

    // --- Document attachment color by extension ---
    function waDocColor(name) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (['pdf'].includes(ext)) return '#dc2626';
      if (['doc', 'docx'].includes(ext)) return '#2563eb';
      if (['xls', 'xlsx', 'csv'].includes(ext)) return '#059669';
      if (['zip', 'rar', '7z'].includes(ext)) return '#d97706';
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '#0891b2';
      return '#7c3aed';
    }

    function waFormatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    // --- Send message ---
    async function waSendMessage() {
      if (!waCurrentConvoId) return;
      const input = document.getElementById('wa-text-input');
      const text = (input?.value || '').trim();
      if (!text && !waPendingAttachments.length) return;

      const accountId = String(STATE.currentUser?.id || (STATE.role === 'admin' ? 'admin' : STATE.currentDispatcherId));
      const senderName = STATE.currentUser?.name || (STATE.role === 'admin' ? 'Admin' : 'Dispatcher');

      // Close popups
      waCloseAllPopups();

      // If there are attachments, send each one as a message
      const attachesToSend = [...waPendingAttachments];
      waClearAttachments();

      if (input) { input.value = ''; waAutoResize(input); }

      const sendOne = async (payload) => {
        try {
          await fetch(`/api/chat/conversations/${waCurrentConvoId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (e) { toast('Error', 'Failed to send'); }
      };

      // Send attachments
      for (const att of attachesToSend) {
        await sendOne({
          accountId, role: STATE.role, name: senderName,
          body: '',
          attachment: { name: att.name, type: att.type, size: att.size, dataUrl: att.dataUrl },
          ...(waLoadTag ? { loadId: waLoadTag.id, loadNumber: waLoadTag.number } : {})
        });
      }

      // Send text (or text alongside attachments if any)
      if (text) {
        await sendOne({
          accountId, role: STATE.role, name: senderName,
          body: text,
          ...(waLoadTag ? { loadId: waLoadTag.id, loadNumber: waLoadTag.number } : {})
        });
      }

      waClearLoadTag();
      await fetchChatConvs();
      waRenderList();
      waLoadMessages();
    }

    // --- File handling ---
    function waHandleFileSelect(event) {
      const files = Array.from(event.target.files);
      if (!files.length) return;
      event.target.value = '';

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          waPendingAttachments.push({
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            dataUrl: e.target.result
          });
          waRenderAttachPreview();
        };
        reader.readAsDataURL(file);
      });
    }

    function waRenderAttachPreview() {
      const bar = document.getElementById('wa-attach-preview');
      const row = document.getElementById('wa-attach-files-row');
      if (!bar || !row) return;

      if (!waPendingAttachments.length) {
        bar.style.display = 'none';
        return;
      }

      bar.style.display = 'block';
      row.innerHTML = waPendingAttachments.map((att, i) => {
        const icon = att.type.startsWith('image/') ? '🖼️' : '📄';
        return `
      <div class="wa-attach-chip">
        <span>${icon}</span>
        <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeChat(att.name)}</span>
        <span style="color:#8696a0;font-size:10px;">${waFormatSize(att.size)}</span>
        <button onclick="waRemoveAttachment(${i})">✕</button>
      </div>`;
      }).join('');
    }

    function waRemoveAttachment(i) {
      waPendingAttachments.splice(i, 1);
      waRenderAttachPreview();
    }

    function waClearAttachments() {
      waPendingAttachments = [];
      waRenderAttachPreview();
    }

    // --- Load tag ---
    function waClearLoadTag() {
      waLoadTag = null;
      const bar = document.getElementById('wa-load-tag-bar');
      if (bar) bar.style.display = 'none';
    }

    function waAttachLoad(id, number) {
      waLoadTag = { id, number };
      const bar = document.getElementById('wa-load-tag-bar');
      const num = document.getElementById('wa-load-tag-num');
      if (bar && num) { num.textContent = number; bar.style.display = 'flex'; }
    }

    function waCopyLoadInfo() {
      // Show a mini load picker dialog
      const loads = (STATE.loads || []).filter(l => l.status !== 'Completed');
      if (!loads.length) { toast('No Loads', 'No active loads to attach'); return; }
      const names = loads.map((l, i) => `${i + 1}. Load #${l.loadNumber} — ${l.pickup || ''} → ${l.dropoff || ''}`).join('\n');
      const choice = prompt(`Select a load to attach:\n\n${names}\n\nEnter number (1-${loads.length}):`);
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < loads.length) {
        waAttachLoad(loads[idx].id, loads[idx].loadNumber);
        toast('Load Attached', `Load #${loads[idx].loadNumber} attached`);
      }
    }

    // --- Emoji ---
    function waToggleEmoji() {
      waEmojiOpen = !waEmojiOpen;
      const picker = document.getElementById('wa-emoji-picker');
      if (picker) picker.style.display = waEmojiOpen ? 'block' : 'none';
      if (waEmojiOpen) waAttachMenuOpen = false;
      const menu = document.getElementById('wa-attach-menu');
      if (menu) menu.style.display = 'none';
    }

    function waInsertEmoji(emoji) {
      const input = document.getElementById('wa-text-input');
      if (!input) return;
      const pos = input.selectionStart || input.value.length;
      input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
      input.focus();
      waAutoResize(input);
    }

    // --- Attach menu ---
    function waToggleAttachMenu() {
      waAttachMenuOpen = !waAttachMenuOpen;
      const menu = document.getElementById('wa-attach-menu');
      if (menu) menu.style.display = waAttachMenuOpen ? 'flex' : 'none';
      if (waAttachMenuOpen) waEmojiOpen = false;
      const picker = document.getElementById('wa-emoji-picker');
      if (picker) picker.style.display = 'none';
    }

    // --- Message search toggle ---
    function waToggleMsgSearch() {
      waMsgSearchOpen = !waMsgSearchOpen;
      const bar = document.getElementById('wa-msg-search-bar');
      if (bar) bar.style.display = waMsgSearchOpen ? 'block' : 'none';
      if (waMsgSearchOpen) document.getElementById('wa-msg-search-input')?.focus();
    }

    function waSearchMessages() {
      const q = (document.getElementById('wa-msg-search-input')?.value || '').toLowerCase();
      document.querySelectorAll('.wa-bubble').forEach(b => {
        const txt = b.textContent.toLowerCase();
        b.closest('.wa-msg-wrap').style.opacity = (!q || txt.includes(q)) ? '1' : '0.2';
      });
    }

    // --- Info panel toggle (placeholder) ---
    function waToggleInfo() {
      toast('Contact Info', 'Profile view coming soon');
    }

    // --- New chat panel ---
    function waShowNewChatPanel() {
      // Simply scroll to contacts in the list
      document.getElementById('wa-search-input')?.focus();
    }

    // --- Auto-resize textarea ---
    function waAutoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    }

    // --- Download attachment ---
    function waDownloadAttachment(dataUrl, name) {
      if (!dataUrl) { toast('Error', 'No file data available'); return; }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // --- Open image full screen ---
    function waOpenImage(src) {
      if (!src) return;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      overlay.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:8px;object-fit:contain;">`;
      overlay.onclick = () => document.body.removeChild(overlay);
      document.body.appendChild(overlay);
    }

    // --- Close all popups ---
    function waCloseAllPopups() {
      waEmojiOpen = false;
      waAttachMenuOpen = false;
      const picker = document.getElementById('wa-emoji-picker');
      const menu = document.getElementById('wa-attach-menu');
      if (picker) picker.style.display = 'none';
      if (menu) menu.style.display = 'none';
    }

    // Close popups on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#wa-emoji-btn') && !e.target.closest('#wa-emoji-picker')) {
        waEmojiOpen = false;
        const picker = document.getElementById('wa-emoji-picker');
        if (picker) picker.style.display = 'none';
      }
      if (!e.target.closest('#wa-attach-btn') && !e.target.closest('#wa-attach-menu')) {
        waAttachMenuOpen = false;
        const menu = document.getElementById('wa-attach-menu');
        if (menu) menu.style.display = 'none';
      }
    });

    // Patch showView to init WA chat when navigating to chat
    const _origShowView = typeof showView === 'function' ? showView : null;
    // Hook into the existing nav system — call initWaChat when chat view becomes active
    const _waNavObs = setInterval(() => {
      const chatView = document.getElementById('view-chat');
      if (chatView && chatView.classList.contains('active') && STATE._loaded) {
        initWaChat();
        clearInterval(_waNavObs);
      }
    }, 800);

    // Also hook into sidebar nav click
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-view="chat"], .nav-item[onclick*="chat"]').forEach(el => {
        el.addEventListener('click', () => setTimeout(initWaChat, 200));
      });
    });

    // ============ ABOUT US POPUP MODAL FUNCTIONS ============
    function openAboutModal() {
      const modal = document.getElementById('modal-about');
      if (!modal) return;
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeAboutModal() {
      const modal = document.getElementById('modal-about');
      if (!modal) return;
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }

    function handleAboutOverlayClick(e) {
      if (e.target && e.target.id === 'modal-about') {
        closeAboutModal();
      }
    }

    function copyAboutEmail() {
      const email = 'haulbox2361@gmail.com';
      const label = document.getElementById('about-copy-label');
      const btn = document.getElementById('about-copy-btn');
      
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(email).then(showCopied).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }

      function showCopied() {
        if (label) label.textContent = 'Copied! ✓';
        if (btn) {
          btn.style.background = 'rgba(16, 185, 129, 0.12)';
          btn.style.borderColor = '#10b981';
          btn.style.color = '#10b981';
        }
        if (typeof toast === 'function') {
          toast('Email Copied', 'haulbox2361@gmail.com copied to clipboard', true);
        }
        setTimeout(() => {
          if (label) label.textContent = 'Copy Email';
          if (btn) {
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
          }
        }, 2200);
      }

      function fallbackCopy() {
        const ta = document.createElement('textarea');
        ta.value = email;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          showCopied();
        } catch (err) {
          if (typeof toast === 'function') toast('Email', email);
        }
        document.body.removeChild(ta);
      }
    }

    // Global ESC key to close About modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        const modal = document.getElementById('modal-about');
        if (modal && modal.classList.contains('active')) {
          closeAboutModal();
        }
      }
    });

    // Auto-restore session on page load (F5 refresh)
    (async function bootApp() {
      try {
        if (!STATE._loaded) { await loadState(); STATE._loaded = true; }
        const restored = await restoreSession();
        if (!restored) {
          const params = new URLSearchParams(window.location.search);
          const shareToken = params.get('share');
          if (shareToken) {
            const share = (STATE.settings.shares || []).find(x => x.token === shareToken);
            if (share && share.active) {
              document.getElementById('login-gate').style.display = 'none';
              STATE.currentUser = { name: share.name, email: 'view-only link', initials: initials(share.name) };
              document.getElementById('app').style.display = 'flex';
              document.getElementById('user-name').textContent = STATE.currentUser.name;
              document.getElementById('user-email').textContent = STATE.currentUser.email;
              document.getElementById('user-avatar').textContent = STATE.currentUser.initials;
              init();
            }
          } else if (params.get('view') === 'readonly') {
            document.getElementById('login-gate').style.display = 'none';
            STATE.currentUser = { name: 'Guest Viewer', email: 'view-only link', initials: 'VW' };
            document.getElementById('app').style.display = 'flex';
            document.getElementById('user-name').textContent = STATE.currentUser.name;
            document.getElementById('user-email').textContent = STATE.currentUser.email;
            document.getElementById('user-avatar').textContent = STATE.currentUser.initials;
            init();
          }
        }
      } catch (e) {
        console.error('bootApp session restore error:', e);
      }
    })();