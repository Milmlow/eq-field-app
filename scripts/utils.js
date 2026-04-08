// ─────────────────────────────────────────────────────────────
// UTILS  —  pure helpers with no STATE side-effects
// Extracted from index.html as part of Stage 1 refactor.
// ─────────────────────────────────────────────────────────────

// ── XSS sanitisation ─────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitise a complete HTML string by stripping dangerous tags/attributes
function sanitizeHTML(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:[^,]*base64/gi, '');
}

// A03-02 + A08-01: duplicate used in leave module
function escHtml(str) {
  if(!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── CSV helpers ───────────────────────────────────────────────
function csvEscape(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; }

// Wrap phone numbers so Excel preserves the leading zero
function csvPhone(v){
  const s = String(v||'').trim();
  if(!s) return '""';
  return '"=\"'+s+'\""';
}

// Clean phone on import: strip =", leading/trailing quotes; re-add 0 if 9 digits
function cleanPhone(v){
  let s = String(v||'').trim();
  s = s.replace(/^=?"?=?"?|"$/g,'').replace(/^=\?"?|"$/g,'').trim();
  s = s.replace(/^[="]+|[="]+$/g,'').trim();
  const hasPlus = s.startsWith('+');
  s = s.replace(/\D/g,'');
  if(hasPlus) return '+'+s;
  if(s.length===9) s='0'+s;
  return s;
}

// ── Avatar initials ───────────────────────────────────────────
function avatarInitials(name){
  return name.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
}

// ── Week formatting ───────────────────────────────────────────
function formatWeekLabel(w){
  const parts = w.split('.');
  if(parts.length!==3) return 'w/c '+w;
  const day   = parseInt(parts[0],10);
  const month = parseInt(parts[1],10)-1;
  const year  = 2000+parseInt(parts[2],10);
  const months= ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  const suffix= day===1||day===21||day===31?'st':day===2||day===22?'nd':day===3||day===23?'rd':'th';
  return `Week Starting ${day}${suffix} ${months[month]} ${year}`;
}

function getWeekDates(w){
  // Returns array of 7 date strings ["30/03","31/03","01/04",...] for Mon-Sun
  const parts = w.split('.');
  if(parts.length!==3) return ['','','','','','',''];
  const d = parseInt(parts[0],10);
  const m = parseInt(parts[1],10)-1;
  const y = 2000+parseInt(parts[2],10);
  const mon = new Date(y,m,d);
  return Array.from({length:7},(_,i)=>{
    const dt = new Date(mon); dt.setDate(mon.getDate()+i);
    return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0');
  });
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}

// ── Modal click-outside-to-close ─────────────────────────────
// (was inline in index.html; moved here so it runs after DOM ready)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.modal-overlay').forEach(o=>{
    o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('open'); });
  });
});
