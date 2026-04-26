/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/digest-settings.js  —  EQ Solves Field  v3.4.26
// Per-supervisor opt-in toggle for the weekly digest email.
// Renders a compact strip above #managers-content on the Supervision
// page. Reads/writes managers.digest_opt_in via the existing sbFetch()
// helper (so the same RLS / org scoping applies as everywhere else).
// Standalone — does not modify managers.js.
// ─────────────────────────────────────────────────────────────

(function () {
  // Guard: only wire up once.
  if (window.__EQ_DIGEST_SETTINGS_INSTALLED__) return;
  window.__EQ_DIGEST_SETTINGS_INSTALLED__ = true;

  // Ensure STATE.managers rows carry a digest_opt_in property even if the
  // existing sbFetch mapping didn't pick it up. We lazy-load once per
  // page visit from Supabase.
  async function hydrateDigestOptIns() {
    if (!window.sbFetch || !window.STATE || !Array.isArray(STATE.managers)) return;
    try {
      const rows = await sbFetch('managers?select=id,digest_opt_in');
      const byId = {};
      // v3.4.26: stringify keys so bigint vs string ids don't miss.
      (rows || []).forEach(r => { byId[String(r.id)] = r.digest_opt_in; });
      STATE.managers.forEach(m => {
        const k = String(m.id);
        if (byId[k] !== undefined) m.digest_opt_in = byId[k];
        // Default opt-in true if the column isn't there yet (migration not applied).
        if (m.digest_opt_in === undefined) m.digest_opt_in = true;
      });
    } catch (e) {
      // Migration not applied yet → column doesn't exist → silently treat
      // everyone as opted in. This lets the drop install cleanly even if
      // the SQL is applied after the zip.
      STATE.managers.forEach(m => { if (m.digest_opt_in === undefined) m.digest_opt_in = true; });
    }
  }

  async function toggleDigest(managerId, nextVal) {
    // v3.4.26: coerce both sides to String. SKS managers.id is bigint
    // (number) but onchange passes the id as a quoted string template,
    // so strict === would always fail and the handler would silently no-op.
    const idStr = String(managerId);
    const mgr = (STATE.managers || []).find(m => String(m.id) === idStr);
    if (!mgr) {
      console.warn('toggleDigest: manager not found for id', managerId, '— STATE has', (STATE.managers || []).length, 'managers');
      return;
    }
    const prev = mgr.digest_opt_in;
    mgr.digest_opt_in = nextVal;          // optimistic
    renderDigestPanel();                  // reflect immediately
    try {
      await sbFetch(`managers?id=eq.${encodeURIComponent(idStr)}`, 'PATCH', { digest_opt_in: nextVal });
      if (typeof showToast === 'function') {
        showToast(nextVal ? `📧 Digest on for ${mgr.name}` : `✋ Digest off for ${mgr.name}`);
      }
    } catch (e) {
      console.error('toggleDigest failed:', e);
      mgr.digest_opt_in = prev;
      renderDigestPanel();
      if (typeof showToast === 'function') {
        showToast('Digest toggle failed — check that the digest migration has been applied.');
      }
    }
  }
  window.toggleDigest = toggleDigest;

  function renderDigestPanel() {
    const host = document.getElementById('managers-content');
    if (!host) return;
    let panel = document.getElementById('digest-settings-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'digest-settings-panel';
      panel.style.cssText = 'background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:14px';
      host.parentNode.insertBefore(panel, host);
    }
    const mgrs = (STATE.managers || []).filter(m => m.email);
    if (!mgrs.length) {
      panel.innerHTML = '<div style="font-size:12px;color:#6B7280">No supervisors with emails — nobody to receive the weekly digest.</div>';
      return;
    }
    const rows = mgrs.map(m => {
      const on = m.digest_opt_in !== false;
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;color:#374151">
          <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleDigest('${m.id}', this.checked)"
                 style="width:16px;height:16px;accent-color:#1F335C">
          <span style="font-weight:600">${escHtmlLocal(m.name)}</span>
          <span style="color:#6B7280;font-size:12px">${escHtmlLocal(m.email)}</span>
        </label>`;
    }).join('');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div>
          <div style="font-weight:700;color:#1F335C;font-size:14px">📧 Weekly supervisor digest</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px">Fridays 12:00 AEST · leave next week, pending approvals, unrostered staff, timesheet completion</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:4px">${rows}</div>`;
  }
  window.renderDigestPanel = renderDigestPanel;

  function escHtmlLocal(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Wrap renderManagers so the panel appears any time the Supervision page
  // renders. We defer the wrap until after DOM load so managers.js is defined.
  function installWrap() {
    if (typeof window.renderManagers !== 'function') return false;
    if (window.__EQ_RENDER_MANAGERS_WRAPPED__) return true;
    const orig = window.renderManagers;
    window.renderManagers = function () {
      const r = orig.apply(this, arguments);
      renderDigestPanel();
      return r;
    };
    window.__EQ_RENDER_MANAGERS_WRAPPED__ = true;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Try to wrap; if managers.js loads later, retry shortly.
    if (!installWrap()) {
      let tries = 0;
      const t = setInterval(() => {
        tries += 1;
        if (installWrap() || tries > 20) clearInterval(t);
      }, 250);
    }
    // First hydration + render once the app has loaded STATE.managers.
    // Kick off a short polling loop for up to 10s waiting for managers to populate.
    let hydrated = false;
    let tries = 0;
    const h = setInterval(async () => {
      tries += 1;
      if (!hydrated && STATE && Array.isArray(STATE.managers) && STATE.managers.length) {
        hydrated = true;
        await hydrateDigestOptIns();
        if (document.getElementById('page-managers') && !document.getElementById('page-managers').classList.contains('hidden')) {
          renderDigestPanel();
        }
      }
      if (hydrated || tries > 40) clearInterval(h);
    }, 250);
  });
})();