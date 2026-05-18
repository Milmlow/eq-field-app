/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/utils.js  —  EQ Solves Field
// XSS sanitisation, toast, modal, CSV helpers, format helpers.
// Depends on: app-state.js
// ─────────────────────────────────────────────────────────────

// ── AbortController polyfill for iOS Safari < 16.4 ───────────
// AbortSignal.timeout() is unsupported on iOS Safari < 16.4 and
// throws TypeError when called. This helper returns an AbortSignal
// that fires after `ms` milliseconds, using native timeout() when
// available and a manual AbortController fallback otherwise.
// Added v3.4.4 (T1).
function _abortAfter(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (e) { /* fall through to manual path */ }
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// ── XSS prevention ────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escHtml(str) {
  // Alias used in email templates (scripts/leave.js)
  return esc(str);
}

// ── Avatar initials ───────────────────────────────────────────
function avatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name[0].toUpperCase();
}

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Modal ─────────────────────────────────────────────────────
//
// v3.5.8 (U2 Phase 3 — manual accessibility pass): openModal/closeModal
// now manage focus per WCAG keyboard-nav expectations.
//   1. On open: stash the element that had focus (trigger), then
//      move focus INTO the modal (data-initial-focus → first focusable).
//   2. On close: restore focus to the stashed trigger so keyboard
//      users don't get dumped back at <body>.
//   3. Tab cycles within the top-most open modal — focus doesn't
//      leak out to the background page while a dialog is up.
// Nested modals (e.g. Confirm on top of Edit) use a stack so each
// close pops back to the previous trigger.
//
// Also stamps role="dialog" + aria-modal="true" on every .modal-overlay
// on first openModal call so screen readers announce them as dialogs.

const _modalTriggerStack = [];

function _ensureModalAriaAttrs(el) {
  if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
  if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
}

function _focusableEls(modal) {
  return Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(e => e.offsetParent !== null);
}

function _focusInitial(modal) {
  // Honour data-initial-focus if present, else first focusable, else the modal itself.
  const explicit = modal.querySelector('[data-initial-focus]');
  if (explicit && explicit.offsetParent !== null) { try { explicit.focus(); } catch (_) {} return; }
  const candidates = _focusableEls(modal);
  if (candidates.length) { try { candidates[0].focus(); } catch (_) {} return; }
  if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
  try { modal.focus(); } catch (_) {}
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  _ensureModalAriaAttrs(el);
  _modalTriggerStack.push(document.activeElement);
  el.classList.add('open');
  // requestAnimationFrame so the .open class is applied (visibility flips) before focus.
  // Safari and iOS especially are picky about focus() on display:none ancestors.
  requestAnimationFrame(() => _focusInitial(el));
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  // Restore focus to whoever opened this modal (or the most-recent stack entry).
  const trigger = _modalTriggerStack.pop();
  if (trigger && document.body.contains(trigger) && typeof trigger.focus === 'function') {
    try { trigger.focus(); } catch (_) {}
  }
}

// Close modal on backdrop click — preserve focus restore by routing through closeModal.
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay') && e.target.id) {
    closeModal(e.target.id);
  }
});

// v3.4.74: ESC-to-close on the top-most open modal. v3.5.8 routes through
// closeModal() so focus restores correctly (was just removing the class).
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const open = document.querySelectorAll('.modal-overlay.open');
  if (!open.length) return;
  // Close the LAST opened modal (DOM order ≈ open order in practice).
  const topMost = open[open.length - 1];
  if (topMost.id) closeModal(topMost.id);
  else topMost.classList.remove('open');
});

// v3.5.8 — Tab focus trap inside the top-most open modal. Without this,
// keyboard users can Tab "past" the dialog into the background page —
// WCAG 2.4.3 (focus order) + 2.1.1 (keyboard) require focus stay inside.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Tab') return;
  const open = document.querySelectorAll('.modal-overlay.open');
  if (!open.length) return;
  const modal = open[open.length - 1];
  const focusables = _focusableEls(modal);
  if (!focusables.length) { e.preventDefault(); return; }
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  const active = document.activeElement;
  // Cycle: Shift+Tab from first → last; Tab from last → first; otherwise let the browser handle it.
  if (e.shiftKey && (active === first || !modal.contains(active))) {
    e.preventDefault();
    try { last.focus(); } catch (_) {}
  } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
    e.preventDefault();
    try { first.focus(); } catch (_) {}
  }
});

// ── CSV helpers ───────────────────────────────────────────────
function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvPhone(phone) {
  if (!phone) return '';
  // Wrap in quotes to preserve leading zero in Excel
  return '"' + String(phone).replace(/"/g, '""') + '"';
}

function cleanPhone(val) {
  if (!val) return '';
  return String(val).replace(/[^\d+]/g, '').replace(/^0*(\d)/, '0$1');
}

function toCSV(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }).join(',')).join('\n');
}

// ── Week formatting ───────────────────────────────────────────
function formatWeekLabel(week) {
  if (!week) return '—';
  const [dd, mm, yy] = week.split('.');
  if (!dd) return week;
  const date  = new Date(`20${yy}-${mm}-${dd}`);
  const day   = date.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd' : 'th';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `Week Starting ${day}${suffix} ${months[date.getMonth()]} 20${yy}`;
}

function getWeekDates(week) {
  if (!week) return ['','','','','','',''];
  const [dd, mm, yy] = week.split('.');
  const mon = new Date(`20${yy}-${mm}-${dd}`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  });
}