/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/whatsnew.js  —  EQ Solves Field
// "What's new" banner shown once per user after a major upgrade.
// Dismissible; remembered via localStorage.
//
// Bump WHATSNEW_KEY when you want to force the banner to show again
// (e.g. next time there's a meaningful set of features to surface).
// ─────────────────────────────────────────────────────────────

const WHATSNEW_KEY     = 'eq.whatsnew.v3.4.22.seen';
const WHATSNEW_VERSION = 'v3.4.22';

// Highlights to surface — keep terse, role-relevant, action-relevant.
// One line per row; 5–7 rows max so the card stays scannable.
const WHATSNEW_HIGHLIGHTS = [
  { icon: '✉', title: 'Friday supervisor digest',
    body: 'Auto-emails subscribed managers a weekly summary at noon Fridays. Opt out in your profile.' },
  { icon: '🎂', title: 'Birthdays & work anniversaries',
    body: 'New dashboard card lists who has a birthday or work milestone in the next 30 days.' },
  { icon: '⏱', title: 'Timesheet progress + reminders',
    body: 'Inline progress bar shows weekly completion. Per-row "Send reminder" button on the pending list.' },
  { icon: '🔓', title: 'Leave approvals show whose creds are unlocked',
    body: 'Lock area now displays the active supervisor name — fixes the wrong-approver attribution bug.' },
  { icon: '📅', title: 'Multi-day leave writes every day',
    body: 'Approving a 3-day leave request now blocks all 3 days on the roster, not just the first.' },
  { icon: '🧭', title: 'Nav reshuffle',
    body: 'Timesheets moved out of Testing. Apprentices flagged BETA. Testing renamed "DO NOT USE".' },
];

function _renderWhatsNew() {
  const el = document.getElementById('whatsnew-banner');
  if (!el) return;

  if (localStorage.getItem(WHATSNEW_KEY)) {
    el.style.display = 'none';
    return;
  }

  const rows = WHATSNEW_HIGHLIGHTS.map(h => `
    <div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid rgba(124,119,185,.15)">
      <div style="font-size:16px;flex-shrink:0;width:20px;text-align:center">${h.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--navy);line-height:1.3">${h.title}</div>
        <div style="font-size:12px;color:var(--ink-2);line-height:1.4;margin-top:2px">${h.body}</div>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div style="background:var(--purple-lt);border-left:4px solid var(--purple);border-radius:6px;padding:12px 16px;margin-bottom:20px">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.5px">What's new — ${WHATSNEW_VERSION}</div>
          <div style="font-size:14px;font-weight:600;color:var(--navy);margin-top:2px">12 releases of updates landed in this version</div>
        </div>
        <button onclick="dismissWhatsNew()" title="Dismiss"
          style="background:none;border:none;font-size:18px;color:var(--ink-3);cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0">✕</button>
      </div>
      <div style="margin-top:8px">${rows}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;padding-top:8px;border-top:1px solid rgba(124,119,185,.15)">
        <button class="btn btn-primary btn-sm" onclick="dismissWhatsNew()" style="font-size:11px">Got it</button>
      </div>
    </div>`;
  el.style.display = 'block';
}

function dismissWhatsNew() {
  try { localStorage.setItem(WHATSNEW_KEY, '1'); } catch (e) {}
  const el = document.getElementById('whatsnew-banner');
  if (el) el.style.display = 'none';
}

// Render once after the DOM is ready. Dashboard renders may run before or
// after this — the banner div is a static HTML element so it doesn't need
// re-rendering on each renderDashboard() call.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _renderWhatsNew);
} else {
  _renderWhatsNew();
}