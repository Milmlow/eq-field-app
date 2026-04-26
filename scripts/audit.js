/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/audit.js  —  EQ Solves Field
// Audit log: write, open modal, render, export CSV.
// Depends on: app-state.js, utils.js, supabase.js
// ─────────────────────────────────────────────────────────────

let auditCache = [];

// ── Write ─────────────────────────────────────────────────────

function auditLog(action, category, detail, week) {
  if (!currentManagerName) return;
  const entry = {
    manager_name: currentManagerName,
    action,
    category,
    detail: detail || null,
    week:   week   || STATE.currentWeek || null
  };
  // Fire-and-forget — never block UI on audit writes
  sbFetch('audit_log', 'POST', entry, 'return=minimal').catch(() => {});
}

// ── Open modal ────────────────────────────────────────────────

async function openAuditLog() {
  if (!isManager) { showToast('Supervision access required'); return; }
  openModal('modal-audit');
  document.getElementById('audit-log-content').innerHTML =
    '<div class="empty"><div class="empty-icon">⏳</div><p>Loading…</p></div>';

  try {
    const rows   = await sbFetch('audit_log?select=*&order=created_at.desc&limit=500');
    auditCache   = rows;

    const managers = [...new Set(rows.map(r => r.manager_name))].sort();
    const mSel     = document.getElementById('audit-filter-manager');
    mSel.innerHTML = '<option value="">All Supervision</option>' +
      managers.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');

    renderAuditLog();
  } catch (e) {
    document.getElementById('audit-log-content').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠️</div><p>Failed to load audit log</p></div>';
  }
}

// ── Render ────────────────────────────────────────────────────

function renderAuditLog() {
  const filterMgr = document.getElementById('audit-filter-manager').value;
  const filterCat = document.getElementById('audit-filter-category').value;

  let rows = auditCache;
  if (filterMgr) rows = rows.filter(r => r.manager_name === filterMgr);
  if (filterCat) rows = rows.filter(r => r.category      === filterCat);

  document.getElementById('audit-count').textContent = rows.length + ' entries';

  if (!rows.length) {
    document.getElementById('audit-log-content').innerHTML =
      '<div class="empty"><div class="empty-icon">📋</div><p>No entries found</p></div>';
    return;
  }

  const catColors = {
    Roster:     '#2563EB', Timesheet: '#7C77B9', People: '#16A34A',
    Sites:      '#D97706', Access:    '#34486C', Import: '#566686', Leave: '#059669'
  };
  const catBg = {
    Roster:     '#EFF6FF', Timesheet: '#EEF2FF', People: '#F0FDF4',
    Sites:      '#FFFBEB', Access:    '#F1F5F9', Import: '#F8FAFC', Leave: '#ECFDF5'
  };

  // Group by date
  const grouped = {};
  rows.forEach(r => {
    const d       = new Date(r.created_at);
    const dateKey = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(r);
  });

  let html = '';
  Object.entries(grouped).forEach(([date, entries]) => {
    html += `<div style="padding:6px 18px 2px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-2);border-bottom:1px solid var(--border)">${date}</div>`;
    entries.forEach(r => {
      const d    = new Date(r.created_at);
      const time = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      const col  = catColors[r.category] || '#566686';
      const bg   = catBg[r.category]     || '#F8FAFC';
      html += `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 18px;border-bottom:1px solid var(--border)">
        <span style="font-size:10px;color:var(--ink-3);white-space:nowrap;padding-top:2px;min-width:42px">${time}</span>
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:${bg};color:${col};white-space:nowrap;min-width:72px;text-align:center">${r.category}</span>
        <div style="flex:1;min-width:0">
          <span style="font-weight:600;font-size:12px;color:var(--navy)">${esc(r.manager_name || '')}</span>
          <span style="font-size:12px;color:var(--ink-2)"> — ${esc(r.action || '')}</span>
          ${r.detail ? `<div style="font-size:11px;color:var(--ink-3);margin-top:2px">${esc(r.detail)}</div>` : ''}
          ${r.week   ? `<div style="font-size:10px;color:var(--ink-3)">Week ${r.week}</div>` : ''}
        </div>
      </div>`;
    });
  });

  document.getElementById('audit-log-content').innerHTML = html;
}

// ── Export ────────────────────────────────────────────────────

function exportAuditCSV() {
  if (!auditCache.length) { showToast('No entries to export'); return; }
  const header = 'Date/Time,Manager,Category,Action,Detail,Week';
  const lines  = auditCache.map(r => {
    const d = new Date(r.created_at).toLocaleString('en-AU');
    return [d, r.manager_name, r.category, r.action, r.detail || '', r.week || '']
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',');
  });
  downloadCSV(header + '\n' + lines.join('\n'), 'EQ_Audit_Log.csv');
  showToast('Audit log exported');
}