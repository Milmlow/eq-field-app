/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/managers.js  —  EQ Solves Field
// Supervision contacts: CRUD, render, import/export.
// Depends on: app-state.js, utils.js, supabase.js
// ─────────────────────────────────────────────────────────────

// v3.4.46: shared cell helpers used by BOTH the mobile-card and the
// desktop-table renderers below. Adding an action button (or changing
// the no-phone fallback styling, or anything that's logically the same
// between the two viewports) now updates one place instead of two,
// killing the "added it on desktop, forgot mobile" drift class.
function _managerActions(m) {
  return `<button class="btn-icon" title="Edit" onclick="openEditManager('${m.id}')">✎</button>
    <button class="btn-icon" style="color:var(--red)" title="Remove"
      data-mid="${m.id}" data-mname="${esc(m.name)}"
      onclick="confirmRemoveManager(this.dataset.mid, this.dataset.mname)">✕</button>`;
}
function _managerPhone(m, size) {
  // size: 'mobile' (14px purple link in card) | 'desktop' (default link in table cell)
  if (!m.phone) {
    return size === 'mobile'
      ? '<span style="color:#EF4444;font-size:12px">No phone</span>'
      : '<span style="color:#EF4444;font-size:11px">No phone</span>';
  }
  return size === 'mobile'
    ? `<a href="tel:${m.phone}" style="color:var(--purple);font-weight:600;text-decoration:none;font-size:14px">${m.phone}</a>`
    : `<a href="tel:${m.phone}">${m.phone}</a>`;
}
function _managerEmail(m, size) {
  if (!m.email) return size === 'mobile' ? '' : '—';
  return size === 'mobile'
    ? `<a href="mailto:${esc(m.email)}" style="color:var(--purple);font-size:11px;text-decoration:none">${esc(m.email)}</a>`
    : `<a href="mailto:${esc(m.email)}" style="color:var(--purple)">${esc(m.email)}</a>`;
}

function renderManagers() {
  const search   = (document.getElementById('managers-search').value || '').toLowerCase();
  const category = document.getElementById('managers-category').value;

  let mgrs = STATE.managers || [];
  if (search)   mgrs = mgrs.filter(m =>
    m.name.toLowerCase().includes(search) ||
    (m.role && m.role.toLowerCase().includes(search)) ||
    (m.category && m.category.toLowerCase().includes(search))
  );
  if (category) mgrs = mgrs.filter(m => m.category === category);
  mgrs = [...mgrs].sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('badge-managers').textContent = (STATE.managers || []).length;

  if (!mgrs.length) {
    document.getElementById('managers-content').innerHTML =
      '<div class="empty"><div class="empty-icon">☎</div><p>No contacts found</p></div>';
    return;
  }

  const catOrder  = ['Executive', 'Operations', 'Project Management', 'Construction', 'Supervisor', 'Internal', 'Other'];
  const catColors = {
    'Executive':           '#1A1A2E',
    'Operations':          '#1F335C',
    'Project Management':  '#7C77B9',
    'Construction':        '#34486C',
    'Supervisor':          '#16A34A',
    'Internal':            '#566686',
    'Other':               '#8494A7'
  };

  const grouped = {};
  mgrs.forEach(m => {
    const cat = m.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  });

  // v3.4.43: render known categories in catOrder, then append any unknown
  // categories at the end. Previous code dropped anyone whose category
  // wasn't in catOrder (e.g. 'Executive' before v3.4.42 reached SKS, or
  // any typo) — they appeared in the digest panel's fresh fetch but not
  // in the main supervisors table.
  const knownCats   = catOrder.filter(cat => grouped[cat]);
  const unknownCats = Object.keys(grouped).filter(cat => !catOrder.includes(cat)).sort();
  const cats        = [...knownCats, ...unknownCats];
  const isMobile = window.innerWidth <= 768;
  let html = '';

  if (isMobile) {
    cats.forEach(cat => {
      const col = catColors[cat] || '#8494A7';
      html += `<div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${col};padding:10px 4px 6px">${cat}</div>`;
      grouped[cat].forEach(m => {
        const emailHtml = _managerEmail(m, 'mobile');
        html += `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--navy);margin-bottom:3px">${esc(m.name)}</div>
            <div style="font-size:12px;color:var(--ink-2);margin-bottom:5px">${m.role || ''}</div>
            <div style="display:flex;flex-direction:column;gap:3px">
              ${_managerPhone(m, 'mobile')}
              ${emailHtml}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${_managerActions(m)}
          </div>
        </div>`;
      });
    });
  } else {
    html = '<div class="roster-card"><div class="table-scroll"><table style="width:100%">'
      + '<thead><tr>'
      + '<th class="name-col">Name</th><th>Role</th><th>Category</th>'
      + '<th>Mobile</th><th>Email</th>'
      + '<th class="center" style="width:80px">Actions</th>'
      + '</tr></thead><tbody>';
    cats.forEach(cat => {
      const col = catColors[cat] || '#8494A7';
      html += `<tr><td colspan="6" style="padding:6px 14px 4px;background:#F7F9FB;font-size:9.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${col};border-bottom:1px solid var(--border)">${cat}</td></tr>`;
      grouped[cat].forEach(m => {
        html += `<tr>
          <td class="name-col" style="font-weight:600">${esc(m.name)}</td>
          <td class="meta-col">${m.role || '—'}</td>
          <td class="meta-col">${m.category || '—'}</td>
          <td class="phone-col">${_managerPhone(m, 'desktop')}</td>
          <td class="meta-col">${_managerEmail(m, 'desktop')}</td>
          <td class="center" style="white-space:nowrap">${_managerActions(m)}</td>
        </tr>`;
      });
    });
    html += '</tbody></table></div></div>';
  }

  html += '<div id="import-managers-preview" style="display:none;margin-top:8px"></div>';
  document.getElementById('managers-content').innerHTML = html;
}

function openAddManager() {
  if (!isManager) { showToast('Supervision access required'); return; }
  document.getElementById('modal-manager-title').textContent = 'Add Contact';
  ['manager-edit-id', 'manager-name', 'manager-role', 'manager-phone', 'manager-email']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('manager-category').value = 'Internal';
  openModal('modal-manager');
}

function openEditManager(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  // v3.4.22: coerce both sides to string so uuid (eq) AND bigint (sks) match
  const m = (STATE.managers || []).find(x => String(x.id) === String(id));
  if (!m) return;
  document.getElementById('modal-manager-title').textContent = 'Edit Contact';
  document.getElementById('manager-edit-id').value   = id;
  document.getElementById('manager-name').value      = m.name;
  document.getElementById('manager-role').value      = m.role     || '';
  document.getElementById('manager-category').value  = m.category || 'Internal';
  document.getElementById('manager-phone').value     = m.phone    || '';
  document.getElementById('manager-email').value     = m.email    || '';
  openModal('modal-manager');
}

function saveManager() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const editId   = document.getElementById('manager-edit-id').value;
  const name     = document.getElementById('manager-name').value.trim();
  const role     = document.getElementById('manager-role').value.trim();
  const category = document.getElementById('manager-category').value;
  const phone    = cleanPhone(document.getElementById('manager-phone').value);
  const email    = document.getElementById('manager-email').value.trim().toLowerCase();

  if (!name) { showToast('Name is required'); return; }

  // BUG-001 FIX: use editId not id; check managers not people
  // v3.4.22: editId is uuid (eq) or bigint-as-string (sks); coerce both sides
  const existingMgr = (STATE.managers || []).find(x =>
    x.name.toLowerCase() === name.toLowerCase() && (!editId || String(x.id) !== String(editId))
  );
  if (existingMgr) { showToast(`⚠ ${name} already exists in supervision contacts`); return; }

  if (!STATE.managers) STATE.managers = [];
  let mgr;
  if (editId) {
    // v3.4.22: editId is uuid (eq) or bigint-as-string (sks); coerce both sides
    mgr = STATE.managers.find(x => String(x.id) === String(editId));
    if (mgr) { mgr.name = name; mgr.role = role; mgr.category = category; mgr.phone = phone; mgr.email = email; }
    showToast(`${name} updated`);
  } else {
    const newId = Math.max(0, ...STATE.managers.map(x => x.id)) + 1;
    mgr = { id: newId, name, role, category, phone, email };
    STATE.managers.push(mgr);
    showToast(`${name} added`);
  }

  closeModal('modal-manager');
  document.getElementById('badge-managers').textContent = STATE.managers.length;
  renderManagers();
  saveManagerToSB(mgr).catch(() => showToast('Save failed — check connection'));
  // v3.4.35: track new supervisor adds (skip edits).
  if (!editId && window.EQ_ANALYTICS && EQ_ANALYTICS.events) {
    EQ_ANALYTICS.events.supervisorAdded({ category: category, has_email: !!email });
  }
}

function confirmRemoveManager(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  document.getElementById('confirm-title').textContent = 'Remove Contact';

  const schedCount = STATE.schedule.filter(r => r.name === name).length;
  const tsCount    = (STATE.timesheets || []).filter(r => r.name === name).length;
  const leaveCount = (typeof leaveRequests !== 'undefined' ? leaveRequests : []).filter(r => r.requester_name === name).length;
  const orphanParts = [
    schedCount ? schedCount + ' schedule entries' : '',
    tsCount    ? tsCount + ' timesheet entries'   : '',
    leaveCount ? leaveCount + ' leave requests'   : ''
  ].filter(Boolean);
  const orphanMsg = orphanParts.length
    ? ' This person has ' + orphanParts.join(', ') + ' that will become orphaned.'
    : '';
  document.getElementById('confirm-msg').textContent = `Remove ${name} from contacts?${orphanMsg}`;
  document.getElementById('confirm-action').textContent = 'Remove';
  document.getElementById('confirm-action').onclick = () => removeManager(id, name);
  openModal('modal-confirm');
}

function removeManager(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  STATE.managers = (STATE.managers || []).filter(m => m.id !== id);
  closeModal('modal-confirm');
  deleteManagerFromSB(id).catch(() => showToast('Delete failed — check connection'));
  document.getElementById('badge-managers').textContent = STATE.managers.length;
  renderManagers();
  showToast(`${name} removed`);
  auditLog(`Removed: ${name}`, 'People', null, null);
}

function exportManagersCSV() {
  if (!STATE.managers || !STATE.managers.length) { showToast('No contacts to export'); return; }
  const header = 'Name,Role,Category,Phone,Email';
  const rows = STATE.managers.map(m =>
    [csvEscape(m.name), csvEscape(m.role), csvEscape(m.category), csvPhone(m.phone), csvEscape(m.email)].join(',')
  );
  downloadCSV(header + '\n' + rows.join('\n'), 'EQ_Supervision.csv');
  showToast('Exported — ' + STATE.managers.length + ' contacts');
}

function importManagersCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows   = parseCSV(e.target.result);
      if (!rows.length) { showToast('Empty file'); return; }
      const header = rows[0].map(h => h.toLowerCase().trim());
      const iName  = header.indexOf('name');
      const iRole  = header.indexOf('role');
      const iCat   = header.indexOf('category');
      const iPhone = header.indexOf('phone');
      const iEmail = header.indexOf('email');
      if (iName < 0) { showPreviewError('import-managers-preview', 'Missing required column: Name'); return; }
      const managers = [];
      rows.slice(1).forEach((r, i) => {
        const name = (r[iName] || '').trim();
        if (!name) return;
        managers.push({
          id:       i + 1,
          name,
          role:     iRole  >= 0 ? (r[iRole]  || '').trim() : '',
          category: iCat   >= 0 ? (r[iCat]   || '').trim() || 'Internal' : 'Internal',
          phone:    iPhone >= 0 ? cleanPhone(r[iPhone]) : '',
          email:    iEmail >= 0 ? (r[iEmail]  || '').trim().toLowerCase() : ''
        });
      });
      const previewId = document.getElementById('import-managers-preview2')
        ? 'import-managers-preview2' : 'import-managers-preview';
      showImportConfirm(previewId, managers.length + ' contacts', () => {
        STATE.managers = managers;
        document.getElementById('badge-managers').textContent = managers.length;
        showToast('Importing ' + managers.length + ' contacts…');
        importManagersToSB(managers)
          .then(() => { hidePreview(previewId); input.value = ''; showToast(managers.length + ' contacts imported'); loadFromSupabase().then(() => renderCurrentPage()); })
          .catch(e => showToast('Import failed: ' + e.message));
      }, () => { hidePreview(previewId); input.value = ''; });
    } catch (err) {
      showPreviewError('import-managers-preview', 'Parse error: ' + err.message);
      input.value = '';
    }
  };
  reader.readAsText(file);
}