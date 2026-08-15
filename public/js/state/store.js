/* =========================================================================
   HaulBoX Centralized Reactive State & Persistence Store
   ========================================================================= */

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

let STATE = {
  loads: [],
  drivers: [],
  brokers: [],
  dispatchers: [],
  settings: {},
  chat: {},
  emailLogs: [],
  driveFiles: [],
  notifications: [],
  currentUser: null,
  role: 'admin',
  currentDispatcherId: null,
  viewAs: null,
  loadFilter: 'all'
};

let CHARTS = {};
let pendingSelectTarget = null;

function computeStatus(l) {
  if (l.docs && l.docs.POD) return 'Drop-off';
  if (l.docs && l.docs.BOL) return 'Loaded';
  if (l.docs && l.docs.RC) return 'Booked';
  return 'Pending RC';
}

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

function companyMarginOf(l) {
  return Math.round((Number((l && l.brokerRate) || 0) - driverPayOf(l)) * 100) / 100;
}

function settlementDateOf(l) { return (l && (l.deliveryDate || l.systemDate)) || ''; }

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

function visibleDrivers() {
  if (STATE.role === 'dispatcher') return STATE.drivers.filter(d => d.dispatcherId === STATE.currentDispatcherId);
  if (STATE.viewAs) return STATE.drivers.filter(d => d.dispatcherId === STATE.viewAs);
  return STATE.drivers;
}
