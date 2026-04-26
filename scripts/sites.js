/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/sites.js  —  EQ Solves Field
// Sites CRUD: add, edit, delete, sites grid render.
// Depends on: app-state.js, utils.js, supabase.js, roster.js
// ─────────────────────────────────────────────────────────────

function populateSiteLeadDropdown() {
  const sel     = document.getElementById('site-lead');
  const allPpl  = [...(STATE.people || []), ...(STATE.managers || [])];
  const names   = [...new Set(allPpl.map(p => p.name))].sort();
  sel.innerHTML = '<option value="">— None assigned —</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');
}

function openAddSite() {
  if (!isManager) { showToast('Supervision access required'); return; }
  ['site-edit-id', 'site-name', 'site-abbr', 'site-address'].forEach(id =>
    document.getElementById(id).value = ''
  );
  populateSiteLeadDropdown();
  document.getElementById('site-lead').value = '';
  document.querySelector('#modal-site h3').textContent = 'Add Site';
  openModal('modal-site');
}

function openEditSite(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  // v3.4.22: coerce both sides to string so uuid (eq) AND bigint (sks) match
  const site = STATE.sites.find(s => String(s.id) === String(id));
  if (!site) return;
  document.getElementById('site-edit-id').value  = id;
  document.getElementById('site-name').value     = site.name;
  document.getElementById('site-abbr').value     = site.abbr;
  document.getElementById('site-address').value  = site.address || '';
  populateSiteLeadDropdown();
  document.getElementById('site-lead').value     = site.site_lead || '';
  document.querySelector('#modal-site h3').textContent = 'Edit Site';
  openModal('modal-site');
}

function saveSite() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const editId   = document.getElementById('site-edit-id').value;
  const name     = document.getElementById('site-name').value.trim();
  const abbr     = document.getElementById('site-abbr').value.trim().toUpperCase();
  const address  = document.getElementById('site-address').value.trim();
  const siteLead = document.getElementById('site-lead').value;

  // Look up phone for selected lead
  const leadPerson    = [...(STATE.people || []), ...(STATE.managers || [])].find(p => p.name === siteLead);
  const siteLeadPhone = leadPerson ? (leadPerson.phone || '') : '';

  if (!name || !abbr) { showToast('Name and abbreviation required'); return; }

  // SUP-004: Enforce unique abbreviation per org
  // v3.4.22: editId is uuid (eq) or bigint-as-string (sks); coerce both sides
  const existingSite = STATE.sites.find(s =>
    s.abbr.toUpperCase() === abbr && (!editId || String(s.id) !== String(editId))
  );
  if (existingSite) { showToast(`⚠ Abbreviation "${abbr}" already used by ${existingSite.name}`); return; }

  let site;
  if (editId) {
    // v3.4.22: editId is uuid (eq) or bigint-as-string (sks); coerce both sides
    site = STATE.sites.find(s => String(s.id) === String(editId));
    if (site) {
      site.name            = name;
      site.abbr            = abbr;
      site.address         = address;
      site.site_lead       = siteLead || null;
      site.site_lead_phone = siteLeadPhone || null;
    }
    showToast(`${name} updated`);
  } else {
    site = { id: 'temp_' + Date.now(), name, abbr, address, site_lead: siteLead || null, site_lead_phone: siteLeadPhone || null };
    STATE.sites.push(site);
    showToast(`${name} added`);
  }

  closeModal('modal-site');
  document.querySelector('#modal-site h3').textContent = 'Add Site';
  document.getElementById('site-edit-id').value = '';
  renderSites();
  saveSiteToSB(site).catch(() => showToast('Save failed — check connection'));
}

function confirmDeleteSite(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  document.getElementById('confirm-title').textContent = 'Delete Site';
  document.getElementById('confirm-msg').textContent =
    `Delete "${name}" from the sites list? This won't affect existing schedule entries.`;
  document.getElementById('confirm-action').textContent = 'Delete';
  document.getElementById('confirm-action').onclick = () => deleteSite(id, name);
  openModal('modal-confirm');
}

function deleteSite(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  STATE.sites = STATE.sites.filter(s => s.id !== id);
  closeModal('modal-confirm');
  renderSites();
  showToast(`${name} deleted`);
  deleteSiteFromSB(id).catch(() => showToast('Delete failed — check connection'));
}

// ── Sites grid render ─────────────────────────────────────────

function renderSites() {
  const week  = STATE.currentWeek;
  const sched = getWeekSchedule(week);
  const days  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // Headcount per site abbreviation this week
  const siteCount = {};
  sched.forEach(r => days.forEach(d => {
    const s = r[d];
    if (s && !isLeave(s) && s.trim()) siteCount[s] = (siteCount[s] || 0) + 1;
  }));

  const colorBandMap = {
    blue: 'blue', green: 'green', amber: 'amber',
    red: 'red',   grey: 'grey',  purple: 'purple', empty: 'grey'
  };

  const html = STATE.sites.map(site => {
    const band  = colorBandMap[siteColor(site.abbr)] || 'grey';
    const count = Object.entries(siteCount)
      .filter(([k]) => k === site.abbr)
      .reduce((s, [, v]) => s + v, 0);

    return `<div class="site-card-v2">
      <div class="site-card-band ${band}"></div>
      <div class="site-card-v2-body">
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px">
          <div style="flex:1">
            <div class="site-abbr">${site.abbr}</div>
            <div class="site-name-lg">${esc(site.name)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px">
            <button class="btn-icon btn-sm" title="Edit site" onclick="openEditSite('${site.id}')">✎</button>
            <button class="btn-icon btn-sm" style="color:var(--red)" title="Delete site"
              data-sid="${site.id}" data-sname="${esc(site.name)}"
              onclick="confirmDeleteSite(this.dataset.sid, this.dataset.sname)">✕</button>
          </div>
        </div>
        ${site.address ? `<div class="site-detail"><span>📍</span>${esc(site.address)}</div>` : ''}
        ${site.site_lead ? `<div class="site-detail"><span>👤</span><strong>${esc(site.site_lead)}</strong>${site.site_lead_phone ? ` — <a href="tel:${site.site_lead_phone}" style="color:var(--blue);text-decoration:none">${site.site_lead_phone}</a>` : ''}</div>` : ''}
        <div class="site-headcount">
          <span class="site-headcount-label">Active this week</span>
          <span class="site-headcount-value" style="color:${count ? 'var(--green)' : 'var(--ink-4)'}">${count ? 'Yes' : '—'}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('sites-content').innerHTML =
    html || '<div class="empty"><div class="empty-icon">🏗️</div><p>No sites added yet</p></div>';
}