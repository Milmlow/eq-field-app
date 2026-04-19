// ─────────────────────────────────────────────────────────────
// scripts/journal.js  —  EQ Solves Field  v1.0
// Apprentice reflection journal. Private by default. Per-entry
// share toggle lets an apprentice share the occasional entry
// with their supervisor — managers only see shared entries.
//
// Tone: supportive, curious, optional. Prompts are suggestions
// only; apprentices are always free to write about whatever's on
// their mind. No streaks, no nagging. "Always be building".
//
// Depends on: app-state.js, utils.js, supabase.js, apprentices.js
//   - reads `apprenticeJournal`, `apprenticeProfiles`, `staffTsPerson`,
//     `isManager`, `currentManagerName` from apprentices.js
//   - calls `sbFetch`, `showToast`, `esc`, `openModal`, `closeModal`
// ─────────────────────────────────────────────────────────────

// ── Prompt library ───────────────────────────────────────────
// Four prompt axes matching the goal axes. Each entry gets an
// "axis" key so growth across tech / prof / personal / open stays
// visible over time. All prompts are OPTIONAL — free-text is fine.

const JOURNAL_PROMPTS = {
  tech: [
    'What\'s something technical you figured out this week?',
    'What tool, test or install is clicking for you right now?',
    'Where did you get stuck — and what did you try to work through it?',
    'If you had to teach a first-year one thing you learned recently, what would it be?',
    'What\'s a task you\'d like more reps on before you feel confident?',
  ],
  prof: [
    'How did you handle a curly situation on site this week?',
    'What\'s a conversation you had that changed how you think about something?',
    'When did you step up or take initiative lately?',
    'What\'s a question you wish you\'d asked earlier?',
    'What does "being a good tradesperson" mean to you right now?',
  ],
  personal: [
    'What\'s one thing outside work that\'s giving you energy?',
    'How are you feeling about the pace of things lately?',
    'What\'s something you\'re proud of this quarter?',
    'What\'s one habit you want to build (or drop)?',
    'When did you feel most like yourself this week?',
  ],
  open: [
    'What\'s on your mind?',
    'Anything you want to capture — big or small.',
    'Free space — no prompts.',
    'What do you want to remember about today / this week?',
  ],
};

const JOURNAL_AXIS_LABELS = {
  tech: { icon: '🔧', label: 'Technical', color: '#2563EB' },
  prof: { icon: '💼', label: 'Professional', color: '#16A34A' },
  personal: { icon: '🌱', label: 'Personal', color: '#D97706' },
  open: { icon: '💭', label: 'Open', color: '#6B5BD6' },
};

// Pick a rotating default axis so opening the journal doesn't always
// suggest the same prompt. Rotation = day-of-year mod 4.
function _journalRotatingAxis() {
  const axes = ['tech', 'prof', 'personal', 'open'];
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000;
  const doy = Math.floor(diff / (1000 * 60 * 60 * 24));
  return axes[doy % axes.length];
}

function _randomPromptFor(axis) {
  const pool = JOURNAL_PROMPTS[axis] || JOURNAL_PROMPTS.open;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Render journal tab ───────────────────────────────────────
// Self-view: full journal, can create, can toggle share, can delete own
// Manager-view: only entries with shared=true, read-only.

function renderApprenticeJournalTab(profile, personName) {
  if (!profile) return '';
  const isSelf = (typeof staffTsPerson !== 'undefined' && staffTsPerson
      && String(staffTsPerson.id) === String(profile.person_id));

  if (!isSelf && !isManager) {
    return '<div class="empty" style="padding:40px 16px;text-align:center;color:var(--ink-3)">This journal is private.</div>';
  }

  const entries = (typeof apprenticeJournal !== 'undefined' ? apprenticeJournal : [])
    .filter(j => j.apprentice_id === profile.id && (isSelf || j.shared))
    .sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));

  let html = '<div style="margin-top:20px">';

  // Intro + action
  if (isSelf) {
    html += '<div style="background:#F5F3FF;border-left:4px solid #6B5BD6;padding:14px 18px;border-radius:6px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:4px">📓 Your journal — only you see this</div>';
    html += '<div style="font-size:12px;color:var(--ink-2);line-height:1.5">A quiet space to think out loud about work. Share an entry with your supervisor if you want their take — otherwise it stays with you.</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="openJournalEntryForm(' + profile.id + ',\'' + _journalRotatingAxis() + '\')">+ New Entry</button>';
    Object.keys(JOURNAL_AXIS_LABELS).forEach(axis => {
      const a = JOURNAL_AXIS_LABELS[axis];
      html += '<button class="btn btn-secondary btn-sm" onclick="openJournalEntryForm(' + profile.id + ',\'' + axis + '\')" style="font-size:11px">' + a.icon + ' ' + a.label + '</button>';
    });
    html += '</div>';
  } else {
    // Manager view of someone else's shared entries
    html += '<div style="background:#EEF2FF;border-left:4px solid #6B5BD6;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:12px;color:var(--ink-2);line-height:1.5">';
    html += 'You\'re seeing entries ' + esc(personName) + ' chose to share. The rest of their journal stays private.';
    html += '</div>';
  }

  if (!entries.length) {
    html += '<div class="empty" style="padding:36px 16px;text-align:center;color:var(--ink-3)">';
    html += '<div style="font-size:34px;margin-bottom:8px">📓</div>';
    if (isSelf) {
      html += '<div style="font-weight:700;color:var(--navy);margin-bottom:4px">Nothing here yet</div>';
      html += '<div style="font-size:12px">Tap + New Entry above whenever something\'s worth capturing.</div>';
    } else {
      html += '<div style="font-weight:700;color:var(--navy);margin-bottom:4px">No shared entries yet</div>';
      html += '<div style="font-size:12px">' + esc(personName) + ' hasn\'t shared any journal entries.</div>';
    }
    html += '</div>';
  } else {
    entries.forEach(entry => {
      const axis = JOURNAL_AXIS_LABELS[entry.prompt_key] || JOURNAL_AXIS_LABELS.open;
      const dateStr = new Date(entry.entry_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      html += '<div class="roster-card" style="padding:16px 18px;margin-bottom:12px;border-left:3px solid ' + axis.color + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:18px">' + axis.icon + '</span>';
      html += '<span style="font-size:11px;font-weight:700;color:' + axis.color + ';text-transform:uppercase;letter-spacing:.5px">' + axis.label + '</span>';
      html += '<span style="font-size:11px;color:var(--ink-3)">· ' + dateStr + '</span>';
      html += '</div>';
      if (isSelf) {
        const icon = entry.shared ? '👁' : '🔒';
        const label = entry.shared ? 'Shared' : 'Private';
        const color = entry.shared ? '#16A34A' : '#64748B';
        html += '<span style="font-size:10px;color:' + color + ';font-weight:700">' + icon + ' ' + label + '</span>';
      }
      html += '</div>';
      if (entry.prompt_text) {
        html += '<div style="font-size:12px;color:var(--ink-3);font-style:italic;margin-bottom:8px">💬 ' + esc(entry.prompt_text) + '</div>';
      }
      html += '<div style="font-size:13px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(entry.reflection) + '</div>';
      if (isSelf) {
        html += '<div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">';
        const nextShared = !entry.shared;
        const toggleLabel = entry.shared ? 'Make private' : 'Share with supervisor';
        html += '<button class="btn btn-secondary btn-sm" onclick="toggleJournalShared(\'' + entry.id + '\',' + nextShared + ')" style="font-size:11px">' + toggleLabel + '</button>';
        html += '<button class="btn btn-secondary btn-sm" onclick="deleteJournalEntry(\'' + entry.id + '\',' + profile.id + ')" style="font-size:11px;color:#DC2626">Delete</button>';
        html += '</div>';
      }
      html += '</div>';
    });
  }

  html += '</div>';
  return html;
}

// ── Entry form ───────────────────────────────────────────────

function openJournalEntryForm(profileId, promptKey) {
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const isSelf = (typeof staffTsPerson !== 'undefined' && staffTsPerson
      && String(staffTsPerson.id) === String(profile.person_id));
  if (!isSelf) { showToast('Only you can write in your journal'); return; }

  const modal = document.getElementById('modal-journal-entry');
  if (!modal) { showToast('Journal modal missing — refresh the app'); return; }

  const axis = promptKey && JOURNAL_PROMPTS[promptKey] ? promptKey : _journalRotatingAxis();
  const prompt = _randomPromptFor(axis);
  const meta = JOURNAL_AXIS_LABELS[axis] || JOURNAL_AXIS_LABELS.open;

  document.getElementById('jn-apprentice-id').value = profileId;
  document.getElementById('jn-prompt-key').value = axis;
  document.getElementById('jn-prompt-text').value = prompt;
  document.getElementById('jn-reflection').value = '';
  document.getElementById('jn-shared').checked = false;
  const title = document.getElementById('modal-jn-title');
  if (title) title.textContent = meta.icon + ' ' + meta.label + ' · Journal entry';

  // Prompt display + regenerate/skip buttons
  const promptBox = document.getElementById('jn-prompt-display');
  if (promptBox) {
    promptBox.innerHTML = '<div style="background:#F5F3FF;border-left:4px solid ' + meta.color + ';padding:12px 14px;border-radius:4px">' +
      '<div style="font-size:11px;color:' + meta.color + ';font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Prompt (optional)</div>' +
      '<div style="font-size:13px;color:var(--ink-2);line-height:1.5" id="jn-prompt-shown">' + esc(prompt) + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-secondary btn-sm" style="font-size:10px;padding:4px 10px" onclick="_journalNewPrompt(\'' + axis + '\')">🔄 Another</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" style="font-size:10px;padding:4px 10px" onclick="_journalSkipPrompt()">Skip — write freely</button>' +
      '</div></div>';
  }

  openModal('modal-journal-entry');
  setTimeout(() => {
    const ta = document.getElementById('jn-reflection');
    if (ta) ta.focus();
  }, 120);
}

function _journalNewPrompt(axis) {
  const prompt = _randomPromptFor(axis);
  document.getElementById('jn-prompt-text').value = prompt;
  const shown = document.getElementById('jn-prompt-shown');
  if (shown) shown.textContent = prompt;
}

function _journalSkipPrompt() {
  document.getElementById('jn-prompt-key').value = 'open';
  document.getElementById('jn-prompt-text').value = '';
  const box = document.getElementById('jn-prompt-display');
  if (box) box.innerHTML = '<div style="font-size:12px;color:var(--ink-3);font-style:italic">Free space — write whatever\'s on your mind.</div>';
  const title = document.getElementById('modal-jn-title');
  if (title) title.textContent = '💭 Open · Journal entry';
}

async function submitJournalEntry() {
  const profileId = parseInt(document.getElementById('jn-apprentice-id').value);
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const isSelf = (typeof staffTsPerson !== 'undefined' && staffTsPerson
      && String(staffTsPerson.id) === String(profile.person_id));
  if (!isSelf) { showToast('Only you can write in your journal'); return; }

  const promptKey = document.getElementById('jn-prompt-key').value || 'open';
  const promptText = document.getElementById('jn-prompt-text').value.trim();
  const reflection = document.getElementById('jn-reflection').value.trim();
  const shared = document.getElementById('jn-shared').checked;

  if (!reflection) { showToast('Write something first — even a sentence'); return; }

  const row = {
    org_id: TENANT.ORG_UUID,
    apprentice_id: profileId,
    entry_date: new Date().toISOString().slice(0, 10),
    prompt_key: promptKey,
    prompt_text: promptText || null,
    reflection,
    shared,
  };

  try {
    const created = await sbFetch('apprentice_journal', 'POST', row, 'return=representation');
    const newEntry = Array.isArray(created) ? created[0] : created;
    if (newEntry) apprenticeJournal.unshift(newEntry);
    showToast(shared ? 'Saved ✓ — shared with your supervisor' : 'Saved ✓ — private to you');
    closeModal('modal-journal-entry');
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Save failed — ' + (e.message || 'check connection'));
  }
}

async function toggleJournalShared(entryId, nextShared) {
  try {
    await sbFetch('apprentice_journal?id=eq.' + entryId, 'PATCH', { shared: !!nextShared });
    const idx = apprenticeJournal.findIndex(j => j.id === entryId);
    if (idx >= 0) apprenticeJournal[idx].shared = !!nextShared;
    showToast(nextShared ? 'Shared ✓' : 'Back to private ✓');
    if (activeApprenticeId) renderApprenticeProfile(activeApprenticeId);
  } catch(e) {
    showToast('Could not update — check connection');
  }
}

async function deleteJournalEntry(entryId, profileId) {
  if (!confirm('Delete this journal entry? This cannot be undone.')) return;
  try {
    await sbFetch('apprentice_journal?id=eq.' + entryId, 'DELETE');
    apprenticeJournal = apprenticeJournal.filter(j => j.id !== entryId);
    showToast('Entry deleted');
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Delete failed — ' + (e.message || 'check connection'));
  }
}
