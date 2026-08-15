/* =========================================================================
   HaulBoX DOM & Formatting Utilities
   ========================================================================= */

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function escapeChat(str) {
  return escapeHtml(str);
}

function toast(title, msg, isSuccess) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast' + (isSuccess ? ' success' : '');
  t.innerHTML = '<b>' + escapeHtml(title) + '</b>' + (msg ? '<br>' + escapeHtml(msg) : '');
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

function initials(name) {
  if (!name) return 'HB';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function showLoginStatus(msg, isError) {
  const el = document.getElementById('login-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--text-faint)';
}

function toggleNotifPanel() {
  const notifPanel = document.getElementById('notif-panel');
  if (notifPanel) {
    notifPanel.style.display = notifPanel.style.display === 'none' ? 'block' : 'none';
  } else {
    toast('Notifications', 'All activity and status alerts are up to date.', true);
  }
}

