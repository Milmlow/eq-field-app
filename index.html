// ─────────────────────────────────────────────────────────────
// scripts/people.js  —  EQ Solves Field
// People CRUD: add, edit, remove, contacts list render.
// Depends on: app-state.js, utils.js, supabase.js
// ─────────────────────────────────────────────────────────────

// ── Licence / Year field swap (v3.4.6) ────────────────────────
// When group=Apprentice we show a year dropdown. Other groups get
// a free-text input. Field id stays 'person-licence' in both cases
// so save/read code is unchanged.
function refreshPersonLicenceField(group, value) {
  const slot = document.getElementById('person-licence-slot');
  const label = document.getElementById('person-licence-label');
  if (!slot) return;

  if (group === 'Apprentice') {
    if (label) label.textContent = 'Year';
    const years = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
    // If incoming value doesn't match a known year, default to 1st Year.
    const sel = years.includes(value) ? value : '1st Year';
    let html = '<select class="form-select" id="person-licence">';
    years.forEach(y => {
      html += '<option value="' + y + '"' + (y === sel ? ' selected' : '') + '>' + y + '</option>';
    });
    html += '</select>';
    slot.innerHTML = html;
  } else {
    if (label) label.textContent = 'Licence';
    slot.innerHTML = '<input class="form-input" id="person-licence" placeholder="e.g. Licensed" value="' + (value ? String(value).replace(/"/g, '&quot;') : '') + '">';
  }
}

function openAddPerson() {
  if (!isManager) { showToast('Supervision access required'); return; }
  document.getElementById('modal-person-title').textContent = 'Add Person';
  document.getElementById('person-edit-id').value = '';
  document.getElementById('person-name').value    = '';
  document.getElementById('person-phone').value   = '';
  document.getElementById('person-group').value   = 'Direct';
  refreshPersonLicenceField('Direct', '');
  document.getElementById('person-agency').value  = '';
  document.getElementById('person-email').value   = '';
  const tafeEl = document.getElementById('person-tafe-day');
  if (tafeEl) tafeEl.value = '';
  const pinEl = document.getElementById('person-pin');
  if (pinEl) pinEl.value = '';
  openModal('modal-person');
}

function editPerson(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const p = STATE.people.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-person-title').textContent = 'Edit Person';
  document.getElementById('person-edit-id').value = id;
  document.getElementById('person-name').value    = p.name;
  document.getElementById('person-phone').value   = p.phone   || '';
  document.getElementById('person-group').value   = p.group;
  refreshPersonLicenceField(p.group, p.licence || '');
  document.getElementById('person-agency').value  = p.agency  || '';
  document.getElementById('person-email').value   = p.email   || '';
  const tafeEl = document.getElementById('person-tafe-day');
  if (tafeEl) tafeEl.value = p.tafe_day || '';
  const pinEl = document.getElementById('person-pin');
  if (pinEl) pinEl.value = ''; // never pre-fill PIN
  openModal('modal-person');
}

// Called when group select changes while the modal is open.
function onPersonGroupChange() {
  const group = document.getElementById('person-group').value;
  // Carry over current value so typed text isn't lost when toggling back.
  const current = (document.getElementById('person-licence') || {}).value || '';
  refreshPersonLicenceField(group, current);
}

function savePerson() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const id      = document.getElementById('person-edit-id').value;
  const name    = document.getElementById('person-name').value.trim();
  const phone   = document.getElementById('person-phone').value.trim();
  const group   = document.getElementById('person-group').value;
  const licence = document.getElementById('person-licence').value.trim();
  const agency  = document.getElementById('person-agency').value.trim();
  const email   = document.getElementById('person-email').value.trim().toLowerCase();
  const tafeEl  = document.getElementById('person-tafe-day');
  const tafeDay = tafeEl ? (tafeEl.value || null) : null;
  const pinRaw  = (document.getElementById('person-pin') || { value: '' }).value.trim();
  const newPin  = (isManager && /^\d{4}$/.test(pinRaw)) ? pinRaw : null;

  if (!name) { showToast('Name is required'); return; }

  let person;
  if (id) {
    person = STATE.people.find(x => x.id === parseInt(id));
    if (person) {
      person.name     = name;
      person.phone    = phone;
      person.group    = group;
      person.licence  = licence;
      person.agency   = agency;
      person.email    = email;
      person.tafe_day = tafeDay;
      if (newPin) person.pin = newPin;
    }
    showToast(`${name} updated`);
  } else {
    const newId = Math.max(0, ...STATE.people.map(p => p.id)) + 1;
    person = { id: newId, name, phone, group, licence, agency, email, tafe_day: tafeDay, pin: newPin || null };
    STATE.people.push(person);
    showToast(`${name} added`);
  }

  closeModal('modal-person');
  refreshPersonSelects();
  document.getElementById('badge-contacts').textContent = STATE.people.length;
  updateTopStats();
  renderCurrentPage();
  auditLog(id ? `Updated: ${name}` : `Added: ${name}`, 'People', `Group: ${group}`, null);
  savePersonToSB(person).catch(() => showToast('Save failed — check connection'));
}

function confirmRemove(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  document.getElementById('confirm-title').textContent = 'Remove Person';
  document.getElementById('confirm-msg').textContent =
    `Remove ${name} from the roster? Their schedule entries will also be cleared.`;
  document.getElementById('confirm-action').textContent = 'Remove';
  document.getElementById('confirm-action').onclick = () => removePerson(id, name);
  openModal('modal-confirm');
}

function removePerson(id, name) {
  if (!isManager) { showToast('Supervision access required'); return; }
  STATE.people   = STATE.people.filter(p => p.id !== id);
  STATE.schedule = STATE.schedule.filter(s => s.name !== name);

  // BUG-003 FIX: Clear schedule index for this person
  if (STATE.scheduleIndex) {
    Object.keys(STATE.scheduleIndex)
      .filter(k => k.startsWith(name + '||'))
      .forEach(k => delete STATE.scheduleIndex[k]);
  }

  closeModal('modal-confirm');
  refreshPersonSelects();
  document.getElementById('badge-contacts').textContent = STATE.people.length;
  updateTopStats();
  renderCurrentPage();
  showToast(`${name} removed`);
  auditLog(`Removed: ${name}`, 'People', null, null);

  // BUG-003 FIX: These were missing — person reappeared on next sync without them
  deletePersonFromSB(id).catch(() => showToast('Removed locally — server delete failed'));
  sbFetch('schedule?name=eq.' + encodeURIComponent(name), 'DELETE').catch(() => {});
}

// ── Contacts render ───────────────────────────────────────────

function setContactsSort(col) {
  if (contactsSort.col === col) {
    contactsSort.dir = contactsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    contactsSort.col = col;
    contactsSort.dir = 'asc';
  }
  renderContacts();
}

function renderContacts() {
  const search = document.getElementById('contacts-search').value.toLowerCase();
  const group  = document.getElementById('contacts-group').value;
  let people   = STATE.people;

  if (search) people = people.filter(p =>
    p.name.toLowerCase().includes(search) ||
    (p.phone && p.phone.includes(search)) ||
    (p.email && p.email.toLowerCase().includes(search))
  );
  if (group) people = people.filter(p => p.group === group);

  const { col, dir } = contactsSort;
  const mult = dir === 'asc' ? 1 : -1;
  people = [...people].sort((a, b) => {
    const av = (a[col] || 'zzz').toLowerCase();
    const bv = (b[col] || 'zzz').toLowerCase();
    return av < bv ? -mult : av > bv ? mult : 0;
  });

  if (!people.length) {
    document.getElementById('contacts-content').innerHTML =
      '<div class="empty"><div class="empty-icon">🔍</div><p>No contacts found</p></div>';
    return;
  }

  const groupBadge = {
    'Direct':      '<span style="background:var(--navy);color:white;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">Direct</span>',
    'Apprentice':  '<span style="background:var(--purple);color:white;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">App</span>',
    'Labour Hire': '<span style="background:var(--navy-3);color:white;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">LH</span>'
  };

  const tafeDayLabel = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri' };
  const tafeBadge = (p) => p.tafe_day && tafeDayLabel[p.tafe_day]
    ? `<span title="TAFE day" style="background:#EEEDF8;color:#7C77B9;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:4px">🎓 ${tafeDayLabel[p.tafe_day]}</span>`
    : '';

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    const groups   = ['Direct', 'Apprentice', 'Labour Hire'];
    const gColors  = { 'Direct': 'var(--navy)', 'Apprentice': 'var(--purple)', 'Labour Hire': 'var(--navy-3)' };
    let html = '';
    groups.forEach(g => {
      const gp = people.filter(p => p.group === g);
      if (!gp.length) return;
      html += `<div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${gColors[g]};padding:10px 4px 6px">${g} (${gp.length})</div>`;
      gp.forEach(p => {
        const phoneHtml = p.phone
          ? `<a href="tel:${esc(p.phone)}" style="color:var(--purple);font-weight:600;text-decoration:none;font-size:14px">${esc(p.phone)}</a>`
          : '<span style="color:#EF4444;font-size:12px">No phone</span>';
        html += `<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--navy);margin-bottom:4px">${esc(p.name)}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${phoneHtml}
              ${p.email ? `<a href="mailto:${esc(p.email)}" style="color:var(--purple);font-size:11px;text-decoration:none">${esc(p.email)}</a>` : ''}
              ${p.agency ? `<span style="color:var(--ink-3);font-size:11px">· ${esc(p.agency)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn-icon" title="Edit" onclick="editPerson(${p.id})">✎</button>
            <button class="btn-icon" style="color:var(--red)" title="Remove"
              data-pid="${p.id}" data-pname="${esc(p.name)}"
              onclick="confirmRemove(parseInt(this.dataset.pid), this.dataset.pname)">✕</button>
          </div>
        </div>`;
      });
    });
    document.getElementById('contacts-content').innerHTML = html;
    return;
  }

  // Desktop table
  const cSort = contactsSort;
  const th = (c, label) => `<th class="sortable${cSort.col === c ? ' sort-' + cSort.dir : ''}" onclick="setContactsSort('${c}')" style="cursor:pointer;user-select:none">${label}</th>`;
  const html = `<div class="roster-card"><div class="table-scroll"><table style="width:100%">
    <thead><tr>
      ${th('name', 'Name')}${th('group', 'Group')}${th('phone', 'Phone')}${th('email', 'Email')}${th('agency', 'Agency')}
      <th class="center" style="width:90px">Actions</th>
    </tr></thead>
    <tbody>${people.map(p => `
      <tr>
        <td class="name-col">${esc(p.name)}</td>
        <td style="white-space:nowrap">${groupBadge[p.group] || p.group}${tafeBadge(p)}</td>
        <td class="phone-col">${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '<span style="color:#EF4444;font-size:11px">No phone</span>'}</td>
        <td class="meta-col">${p.email ? `<a href="mailto:${esc(p.email)}" style="color:var(--purple);text-decoration:none">${esc(p.email)}</a>` : '—'}</td>
        <td class="meta-col">${p.agency || '—'}</td>
        <td class="center" style="white-space:nowrap">
          <button class="btn-icon" title="Edit" onclick="editPerson(${p.id})">✎</button>
          <button class="btn-icon" style="color:var(--red)" title="Remove"
            data-pid="${p.id}" data-pname="${esc(p.name)}"
            onclick="confirmRemove(parseInt(this.dataset.pid), this.dataset.pname)">✕</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div></div>`;
  document.getElementById('contacts-content').innerHTML = html;
}

// ── PIN Management ────────────────────────────────────────────

function openPinManagement() {
  if (!isManager) { showToast('Supervision access required'); return; }
  renderPinList();
  openModal('modal-pin-mgmt');
}

function renderPinList() {
  const search = (document.getElementById('pin-search').value || '').toLowerCase();
  const el     = document.getElementById('pin-list');
  if (!el) return;

  let people = STATE.people
    .filter(p => p.group === 'Apprentice' || p.group === 'Labour Hire')
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  if (search) people = people.filter(p => p.name.toLowerCase().includes(search));

  if (!people.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ink-3);font-size:12px">No staff found</div>';
    return;
  }

  const groupColors = { Apprentice: 'var(--purple)', 'Labour Hire': 'var(--navy-3)' };
  const groupBadge  = { Apprentice: 'App', 'Labour Hire': 'LH' };

  let html = '';
  let lastGroup = '';
  people.forEach(p => {
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      html += `<div style="padding:6px 12px;background:${groupColors[p.group]};color:white;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">${p.group}</div>`;
    }
    const hasPin    = p.pin ? true : false;
    const pinStatus = hasPin
      ? `<span style="color:var(--green);font-size:10px;font-weight:700">✓ PIN set</span>`
      : `<span style="color:var(--ink-4);font-size:10px">No PIN</span>`;

    html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border)">
      <input type="checkbox" class="pin-cb" data-id="${p.id}" data-name="${esc(p.name)}" style="width:15px;height:15px;accent-color:var(--navy);flex-shrink:0" onchange="updatePinCount()">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--navy)">${esc(p.name)}</div>
        <div style="font-size:11px;margin-top:2px">${pinStatus}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" placeholder="PIN" min="1000" max="9999"
          style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);font-family:inherit;font-size:13px;text-align:center;letter-spacing:2px"
          onchange="saveIndividualPin(${p.id}, this.value, '${esc(p.name)}')">
      </div>
    </div>`;
  });

  el.innerHTML = html;
}

function updatePinCount() {
  const count  = document.querySelectorAll('.pin-cb:checked').length;
  const btn    = document.querySelector('[onclick="applyBulkPin()"]');
  if (btn) btn.textContent = `Apply to ${count} Selected`;
}

function pinSelectAll() {
  document.querySelectorAll('.pin-cb').forEach(cb => cb.checked = true);
  updatePinCount();
}

function pinClearAll() {
  document.querySelectorAll('.pin-cb').forEach(cb => cb.checked = false);
  updatePinCount();
}

async function saveIndividualPin(id, pinVal, name) {
  if (!isManager) return;
  const pin = parseInt(pinVal);
  if (!pin || pin < 1000 || pin > 9999) { showToast('PIN must be 4 digits'); return; }

  try {
    await sbFetch(`people?id=eq.${id}`, 'PATCH', { pin: String(pin) });
    const p = STATE.people.find(x => x.id === id);
    if (p) p.pin = String(pin);
    showToast(`✓ PIN set for ${name}`);
    auditLog(`PIN set for ${name}`, 'People', null, null);
    renderPinList();
  } catch (e) {
    showToast('Failed to save PIN');
  }
}

async function applyBulkPin() {
  if (!isManager) return;
  const pinVal = parseInt(document.getElementById('pin-bulk-value').value);
  if (!pinVal || pinVal < 1000 || pinVal > 9999) { showToast('Enter a valid 4-digit PIN'); return; }

  const selected = [...document.querySelectorAll('.pin-cb:checked')].map(cb => ({
    id:   parseInt(cb.dataset.id),
    name: cb.dataset.name
  }));
  if (!selected.length) { showToast('No staff selected'); return; }

  let count = 0;
  for (const person of selected) {
    try {
      await sbFetch(`people?id=eq.${person.id}`, 'PATCH', { pin: String(pinVal) });
      const p = STATE.people.find(x => x.id === person.id);
      if (p) p.pin = String(pinVal);
      count++;
    } catch (e) { console.error('PIN save failed for', person.name, e); }
  }

  showToast(`✓ PIN set for ${count} staff member${count !== 1 ? 's' : ''}`);
  auditLog(`Bulk PIN set for ${count} staff`, 'People', null, null);
  document.getElementById('pin-bulk-value').value = '';
  renderPinList();
  pinClearAll();
}

async function clearBulkPin() {
  if (!isManager) return;
  const selected = [...document.querySelectorAll('.pin-cb:checked')].map(cb => ({
    id:   parseInt(cb.dataset.id),
    name: cb.dataset.name
  }));
  if (!selected.length) { showToast('No staff selected'); return; }

  for (const person of selected) {
    try {
      await sbFetch(`people?id=eq.${person.id}`, 'PATCH', { pin: null });
      const p = STATE.people.find(x => x.id === person.id);
      if (p) p.pin = null;
    } catch (e) {}
  }

  showToast(`PINs cleared for ${selected.length} staff`);
  auditLog(`PINs cleared for ${selected.length} staff`, 'People', null, null);
  renderPinList();
  pinClearAll();
}
