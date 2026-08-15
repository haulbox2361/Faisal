/* =========================================================================
   HaulBoX Authentication, Role Management & Session Persistence Service
   ========================================================================= */

const SESSION_KEY = 'haulline-session-email';
const SESSION_USER_KEY = 'haulbox_session_user';
const SESSION_UI_KEY = 'haulbox_ui_state';
const SESSION_DRAFTS_KEY = 'haulbox_form_drafts';

let IS_SETTINGS_PIN_UNLOCKED = false;
let PENDING_SETTINGS_SWITCH = false;

// 1. PIN VERIFICATION FOR ADMIN SETTINGS
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
}

// 2. PERSISTENT SESSION RESTORATION MANAGER
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
