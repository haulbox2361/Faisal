/* =========================================================================
   HaulBoX Authentication & Role Management Service
   ========================================================================= */

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
}
