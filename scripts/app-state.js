// ─────────────────────────────────────────────────────────────
// APP STATE  —  all top-level state declarations
// Extracted from index.html as part of Stage 1 refactor.
// Do not add logic here; this file is declarations only.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────
const SEED = {"people":[{"id":1,"name":"Alex Mitchell","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 001","email":"alex.mitchell@demo.com.au"},{"id":2,"name":"Jordan Lee","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 002","email":"jordan.lee@demo.com.au"},{"id":3,"name":"Sam Taylor","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 003","email":"sam.taylor@demo.com.au"},{"id":4,"name":"Casey Williams","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 004","email":"casey.williams@demo.com.au"},{"id":5,"name":"Morgan Davis","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 005","email":"morgan.davis@demo.com.au"},{"id":6,"name":"Riley Thompson","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 006","email":"riley.thompson@demo.com.au"},{"id":7,"name":"Avery Johnson","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 007","email":"avery.johnson@demo.com.au"},{"id":8,"name":"Blake Anderson","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 008","email":"blake.anderson@demo.com.au"},{"id":9,"name":"Drew Wilson","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 009","email":"drew.wilson@demo.com.au"},{"id":10,"name":"Elliot Brown","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 010","email":"elliot.brown@demo.com.au"},{"id":11,"name":"Finn Clarke","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 011","email":"finn.clarke@demo.com.au"},{"id":12,"name":"Harper Moore","group":"Direct","licence":"Licensed","agency":"","phone":"0411 001 012","email":"harper.moore@demo.com.au"},{"id":13,"name":"Indigo White","group":"Apprentice","licence":"3rd Year","agency":"","phone":"0422 002 001","email":"indigo.white@demo.com.au"},{"id":14,"name":"Jamie Harris","group":"Apprentice","licence":"2nd Year","agency":"","phone":"0422 002 002","email":"jamie.harris@demo.com.au"},{"id":15,"name":"Kai Martin","group":"Apprentice","licence":"1st Year","agency":"","phone":"0422 002 003","email":"kai.martin@demo.com.au"},{"id":16,"name":"Lane Robinson","group":"Labour Hire","licence":"Licensed","agency":"Alpha Labour","phone":"0433 003 001","email":"lane.robinson@alphalabour.com.au"},{"id":17,"name":"Maxine Scott","group":"Labour Hire","licence":"Licensed","agency":"Alpha Labour","phone":"0433 003 002","email":"maxine.scott@alphalabour.com.au"},{"id":18,"name":"Noah King","group":"Labour Hire","licence":"Provisional","agency":"Beta Workforce","phone":"0433 003 003","email":"noah.king@betaworkforce.com.au"}],"schedule":[{"name":"Alex Mitchell","week":"06.04.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-B","thu":"SITE-A","fri":"SITE-A"},{"name":"Jordan Lee","week":"06.04.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-C","thu":"SITE-B","fri":"SITE-B"},{"name":"Sam Taylor","week":"06.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-A","thu":"SITE-C","fri":"SITE-C"},{"name":"Casey Williams","week":"06.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-A","thu":"SITE-D","fri":"SITE-D"},{"name":"Morgan Davis","week":"06.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-D","thu":"SITE-E","fri":"SITE-E"},{"name":"Riley Thompson","week":"06.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-E","thu":"SITE-F","fri":"SITE-F"},{"name":"Avery Johnson","week":"06.04.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-F","thu":"SITE-A","fri":"SITE-A"},{"name":"Blake Anderson","week":"06.04.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-D","thu":"SITE-B","fri":"SITE-B"},{"name":"Drew Wilson","week":"06.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-E","thu":"SITE-C","fri":"SITE-C"},{"name":"Elliot Brown","week":"06.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-F","thu":"SITE-D","fri":"SITE-D"},{"name":"Finn Clarke","week":"06.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-A","thu":"SITE-E","fri":"SITE-E"},{"name":"Harper Moore","week":"06.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-B","thu":"SITE-F","fri":"SITE-F"},{"name":"Indigo White","week":"06.04.26","mon":"SITE-A","tue":"SITE-A","wed":"TAFE","thu":"SITE-A","fri":"SITE-A"},{"name":"Jamie Harris","week":"06.04.26","mon":"SITE-B","tue":"SITE-B","wed":"TAFE","thu":"TAFE","fri":"SITE-B"},{"name":"Kai Martin","week":"06.04.26","mon":"SITE-C","tue":"TAFE","wed":"TAFE","thu":"SITE-C","fri":"SITE-C"},{"name":"Lane Robinson","week":"06.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-E","thu":"SITE-D","fri":"SITE-D"},{"name":"Maxine Scott","week":"06.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-F","thu":"SITE-E","fri":"SITE-E"},{"name":"Noah King","week":"06.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-A","thu":"SITE-F","fri":"SITE-F"},{"name":"Alex Mitchell","week":"13.04.26","mon":"RDO","tue":"SITE-A","wed":"SITE-B","thu":"SITE-A","fri":"SITE-A"},{"name":"Jordan Lee","week":"13.04.26","mon":"SITE-B","tue":"SITE-B","wed":"A/L","thu":"SITE-B","fri":"SITE-B"},{"name":"Sam Taylor","week":"13.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-A","thu":"SITE-C","fri":"SITE-C"},{"name":"Casey Williams","week":"13.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-A","thu":"SITE-D","fri":"SITE-D"},{"name":"Morgan Davis","week":"13.04.26","mon":"RDO","tue":"SITE-E","wed":"SITE-D","thu":"SITE-E","fri":"SITE-E"},{"name":"Riley Thompson","week":"13.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-E","thu":"SITE-F","fri":"SITE-F"},{"name":"Avery Johnson","week":"13.04.26","mon":"SITE-A","tue":"A/L","wed":"SITE-F","thu":"SITE-A","fri":"SITE-A"},{"name":"Blake Anderson","week":"13.04.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-D","thu":"SITE-B","fri":"SITE-B"},{"name":"Drew Wilson","week":"13.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-E","thu":"SITE-C","fri":"SITE-C"},{"name":"Elliot Brown","week":"13.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-F","thu":"SITE-D","fri":"SITE-D"},{"name":"Finn Clarke","week":"13.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-A","thu":"SITE-E","fri":"SITE-E"},{"name":"Harper Moore","week":"13.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-B","thu":"SITE-F","fri":"SITE-F"},{"name":"Indigo White","week":"13.04.26","mon":"SITE-A","tue":"SITE-A","wed":"TAFE","thu":"SITE-A","fri":"SITE-A"},{"name":"Jamie Harris","week":"13.04.26","mon":"SITE-B","tue":"SITE-B","wed":"TAFE","thu":"TAFE","fri":"SITE-B"},{"name":"Kai Martin","week":"13.04.26","mon":"SITE-C","tue":"TAFE","wed":"TAFE","thu":"SITE-C","fri":"SITE-C"},{"name":"Lane Robinson","week":"13.04.26","mon":"RDO","tue":"SITE-D","wed":"SITE-E","thu":"SITE-D","fri":"SITE-D"},{"name":"Maxine Scott","week":"13.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-F","thu":"SITE-E","fri":"SITE-E"},{"name":"Noah King","week":"13.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-A","thu":"SITE-F","fri":"SITE-F"},{"name":"Alex Mitchell","week":"20.04.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-B","thu":"SITE-A","fri":"SITE-A"},{"name":"Jordan Lee","week":"20.04.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-C","thu":"SITE-B","fri":"SITE-B"},{"name":"Sam Taylor","week":"20.04.26","mon":"SITE-C","tue":"SITE-C","wed":"A/L","thu":"SITE-C","fri":"SITE-C"},{"name":"Casey Williams","week":"20.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-A","thu":"SITE-D","fri":"SITE-D"},{"name":"Morgan Davis","week":"20.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-D","thu":"SITE-E","fri":"SITE-E"},{"name":"Riley Thompson","week":"20.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-E","thu":"SITE-F","fri":"SITE-F"},{"name":"Avery Johnson","week":"20.04.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-F","thu":"SITE-A","fri":"SITE-A"},{"name":"Blake Anderson","week":"20.04.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-D","thu":"SITE-B","fri":"SITE-B"},{"name":"Drew Wilson","week":"20.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-E","thu":"SITE-C","fri":"SITE-C"},{"name":"Elliot Brown","week":"20.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-F","thu":"SITE-D","fri":"SITE-D"},{"name":"Finn Clarke","week":"20.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-A","thu":"SITE-E","fri":"SITE-E"},{"name":"Harper Moore","week":"20.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-B","thu":"SITE-F","fri":"A/L"},{"name":"Indigo White","week":"20.04.26","mon":"SITE-A","tue":"SITE-A","wed":"TAFE","thu":"SITE-A","fri":"SITE-A"},{"name":"Jamie Harris","week":"20.04.26","mon":"SITE-B","tue":"SITE-B","wed":"TAFE","thu":"TAFE","fri":"SITE-B"},{"name":"Kai Martin","week":"20.04.26","mon":"SITE-C","tue":"TAFE","wed":"TAFE","thu":"SITE-C","fri":"SITE-C"},{"name":"Lane Robinson","week":"20.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-E","thu":"A/L","fri":"SITE-D"},{"name":"Maxine Scott","week":"20.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-F","thu":"SITE-E","fri":"A/L"},{"name":"Noah King","week":"20.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-A","thu":"SITE-F","fri":"SITE-F"},{"name":"Alex Mitchell","week":"27.04.26","mon":"RDO","tue":"SITE-A","wed":"SITE-B","thu":"SITE-A","fri":"SITE-A"},{"name":"Jordan Lee","week":"27.04.26","mon":"A/L","tue":"SITE-B","wed":"SITE-C","thu":"SITE-B","fri":"SITE-B"},{"name":"Sam Taylor","week":"27.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-A","thu":"SITE-C","fri":"SITE-C"},{"name":"Casey Williams","week":"27.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-A","thu":"SITE-D","fri":"SITE-D"},{"name":"Morgan Davis","week":"27.04.26","mon":"RDO","tue":"SITE-E","wed":"SITE-D","thu":"SITE-E","fri":"SITE-E"},{"name":"Riley Thompson","week":"27.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-E","thu":"SITE-F","fri":"SITE-F"},{"name":"Avery Johnson","week":"27.04.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-F","thu":"SITE-A","fri":"SITE-A"},{"name":"Blake Anderson","week":"27.04.26","mon":"SITE-B","tue":"A/L","wed":"SITE-D","thu":"SITE-B","fri":"SITE-B"},{"name":"Drew Wilson","week":"27.04.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-E","thu":"SITE-C","fri":"SITE-C"},{"name":"Elliot Brown","week":"27.04.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-F","thu":"SITE-D","fri":"SITE-D"},{"name":"Finn Clarke","week":"27.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-A","thu":"SITE-E","fri":"SITE-E"},{"name":"Harper Moore","week":"27.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-B","thu":"SITE-F","fri":"SITE-F"},{"name":"Indigo White","week":"27.04.26","mon":"SITE-A","tue":"SITE-A","wed":"TAFE","thu":"SITE-A","fri":"SITE-A"},{"name":"Jamie Harris","week":"27.04.26","mon":"SITE-B","tue":"SITE-B","wed":"TAFE","thu":"TAFE","fri":"SITE-B"},{"name":"Kai Martin","week":"27.04.26","mon":"SITE-C","tue":"TAFE","wed":"TAFE","thu":"SITE-C","fri":"SITE-C"},{"name":"Lane Robinson","week":"27.04.26","mon":"RDO","tue":"SITE-D","wed":"SITE-E","thu":"SITE-D","fri":"SITE-D"},{"name":"Maxine Scott","week":"27.04.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-F","thu":"SITE-E","fri":"SITE-E"},{"name":"Noah King","week":"27.04.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-A","thu":"SITE-F","fri":"SITE-F"},{"name":"Alex Mitchell","week":"04.05.26","mon":"SITE-A","tue":"A/L","wed":"SITE-B","thu":"SITE-A","fri":"SITE-A"},{"name":"Jordan Lee","week":"04.05.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-C","thu":"SITE-B","fri":"SITE-B"},{"name":"Sam Taylor","week":"04.05.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-A","thu":"SITE-C","fri":"SITE-C"},{"name":"Casey Williams","week":"04.05.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-A","thu":"SITE-D","fri":"SITE-D"},{"name":"Morgan Davis","week":"04.05.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-D","thu":"SITE-E","fri":"SITE-E"},{"name":"Riley Thompson","week":"04.05.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-E","thu":"SITE-F","fri":"SITE-F"},{"name":"Avery Johnson","week":"04.05.26","mon":"SITE-A","tue":"SITE-A","wed":"SITE-F","thu":"SITE-A","fri":"SITE-A"},{"name":"Blake Anderson","week":"04.05.26","mon":"SITE-B","tue":"SITE-B","wed":"SITE-D","thu":"SITE-B","fri":"SITE-B"},{"name":"Drew Wilson","week":"04.05.26","mon":"SITE-C","tue":"SITE-C","wed":"SITE-E","thu":"SITE-C","fri":"SITE-C"},{"name":"Elliot Brown","week":"04.05.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-F","thu":"SITE-D","fri":"SITE-D"},{"name":"Finn Clarke","week":"04.05.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-A","thu":"SITE-E","fri":"SITE-E"},{"name":"Harper Moore","week":"04.05.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-B","thu":"SITE-F","fri":"SITE-F"},{"name":"Indigo White","week":"04.05.26","mon":"SITE-A","tue":"SITE-A","wed":"TAFE","thu":"SITE-A","fri":"SITE-A"},{"name":"Jamie Harris","week":"04.05.26","mon":"SITE-B","tue":"SITE-B","wed":"TAFE","thu":"TAFE","fri":"SITE-B"},{"name":"Kai Martin","week":"04.05.26","mon":"SITE-C","tue":"TAFE","wed":"TAFE","thu":"SITE-C","fri":"SITE-C"},{"name":"Lane Robinson","week":"04.05.26","mon":"SITE-D","tue":"SITE-D","wed":"SITE-E","thu":"SITE-D","fri":"SITE-D"},{"name":"Maxine Scott","week":"04.05.26","mon":"SITE-E","tue":"SITE-E","wed":"SITE-F","thu":"SITE-E","fri":"SITE-E"},{"name":"Noah King","week":"04.05.26","mon":"SITE-F","tue":"SITE-F","wed":"SITE-A","thu":"SITE-F","fri":"SITE-F"}],"sites":[{"id":1,"name":"Alpha Data Centre","abbr":"SITE-A","address":"1 Alpha Way, Industrial Area"},{"id":2,"name":"Beta Commercial Tower","abbr":"SITE-B","address":"2 Beta Street, CBD"},{"id":3,"name":"City Hospital","abbr":"SITE-C","address":"3 City Road, Metro"},{"id":4,"name":"Delta Industrial Park","abbr":"SITE-D","address":"4 Delta Drive, West"},{"id":5,"name":"East Medical Centre","abbr":"SITE-E","address":"5 Eastern Ave, East"},{"id":6,"name":"Foxtrot Substation","abbr":"SITE-F","address":"6 Foxtrot Close, North"},{"id":7,"name":"Main Depot","abbr":"DEPOT","address":"7 Depot Road, Home Base"}],"managers":[{"id":1,"name":"Demo Supervisor","role":"Operations Manager","category":"Operations","phone":"0400 000 001","email":"supervisor@demo.com.au"},{"id":2,"name":"Demo Project Manager","role":"Project Manager","category":"Project Management","phone":"0400 000 002","email":"pm@demo.com.au"}]};

// ─── Cache busting ───────────────────────────────────────────
const APP_VERSION = '3.0.0';
(function bustCache() {
  const stored = localStorage.getItem('app_version');
  if (stored !== APP_VERSION) {
    const keep = ['eq_currentWeek'];
    const saved = {};
    keep.forEach(k => { saved[k] = localStorage.getItem(k); });
    localStorage.clear();
    sessionStorage.clear();
    keep.forEach(k => { if (saved[k]) localStorage.setItem(k, saved[k]); });
    localStorage.setItem('app_version', APP_VERSION);
    if (stored !== null) window.location.reload(true);
  }
})();

// ─── Tenant detection — resolved from URL, no hardcoding ─────
// Hostname → org slug mapping. Add new clients here OR use ?tenant=slug param.
const HOSTNAME_MAP = {
  'eq-solves-field.netlify.app': 'eq',
  'eq-solves-field': 'eq',           // local / preview
  'demo.eq.solutions': 'demo',
  'demo': 'demo',
  'localhost': 'eq',                // dev fallback
};

function _detectTenantSlug() {
  // 1. URL param override: ?tenant=eq
  const param = new URLSearchParams(window.location.search).get('tenant');
  if (param) return param;
  // 2. Hostname match
  const host = window.location.hostname;
  if (HOSTNAME_MAP[host]) return HOSTNAME_MAP[host];
  // 3. First segment of hostname e.g. "eq-solves-field" from "eq-solves-field.netlify.app"
  const segment = host.split('.')[0];
  if (HOSTNAME_MAP[segment]) return HOSTNAME_MAP[segment];
  // 4. Fallback
  return 'eq';
}

// TENANT is populated async after DB lookup — start with slug only
let TENANT = { ORG_SLUG: _detectTenantSlug(), ORG_UUID: null };

async function loadTenantConfig() {
  const slug = TENANT.ORG_SLUG;
  // Demo mode — skip Supabase entirely, apply static branding
  if (slug === 'eq' || slug === 'demo') {
    document.title = 'EQ Solves — Field';
    const gateTitle = document.getElementById('gate-org-name');
    if (gateTitle) gateTitle.textContent = 'EQ Solves — Field';
    return;
  }
  try {
    const res = await fetch(
      SB_URL + '/rest/v1/organisations?slug=eq.' + slug + '&select=*&limit=1',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    const rows = await res.json();
    if (!rows || !rows.length) throw new Error('Tenant not found: ' + slug);
    const org = rows[0];
    TENANT = { ORG_SLUG: org.slug, ORG_UUID: org.id, ...org };
    applyTenantBranding(org);
  } catch(e) {
    console.error('Tenant load failed:', e);
    document.title = 'EQ Field App';
  }
}

function applyTenantBranding(org) {
  // Page title
  document.title = org.name + ' — Labour Forecast';
  // Gate screen heading
  const gateTitle = document.getElementById('gate-org-name');
  if (gateTitle) gateTitle.textContent = org.name;
  // Sidebar region label — show short name
  const sidebarName = document.getElementById('sidebar-org-name');
  if (sidebarName) sidebarName.textContent = org.name.split(' ')[0].toUpperCase();
  // Gate sub-heading
  const gateSub = document.getElementById('gate-org-name-sub');
  if (gateSub) gateSub.textContent = org.name + ' — Staff Access';
  // CSS colour variables
  if (org.primary_colour) {
    document.documentElement.style.setProperty('--navy', org.primary_colour);
    document.documentElement.style.setProperty('--navy-2', org.primary_colour + 'cc');
  }
  if (org.accent_colour) {
    document.documentElement.style.setProperty('--purple', org.accent_colour);
    document.documentElement.style.setProperty('--purple-lt', org.accent_colour + '22');
  }
}

const SB_URL = 'https://nspbmirochztcjijmcrx.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcGJtaXJvY2h6dGNqaWptY3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODg2MjQsImV4cCI6MjA5MDI2NDYyNH0.cpwHUqWr7MKaJFP0K7RMt43CytJ_dnPAH3LJ3xEdEdg';
const MANAGER_PASSWORD = null; // validated server-side
let isManager = false; // unlocked by password
let agencyMode = false;

// Tables that require org_id filtering / stamping
const ORG_TABLES = ['people','sites','schedule','managers','timesheets',
                    'audit_log','job_numbers','leave_requests'];

function _isOrgTable(table) {
  return ORG_TABLES.some(t => table === t || table.startsWith(t + '?'));
}

// Extract base table name from a path like "people?select=*"
function _baseTable(path) {
  return path.split('?')[0];
}

// sbFetch and all Supabase CRUD helpers remain in index.html inline script

// ── Site colour map ───────────────────────────────────────────
const SITE_COLOR_MAP = {
  'EQX':'blue','EC6':'blue','SY1':'blue','SY2':'blue','SY3':'blue','SY5':'blue','SY6':'blue','SY7':'blue','SY9':'blue','EQUINIX':'blue','SY':'blue',
  'SLDC':'amber','HMK':'amber','SCHN':'amber','TELSTRA':'amber','WSA':'amber',
  'STG':'green','STV':'green','WMPH':'green','KAR':'green','PORT':'green','W/MILLE':'green',
  'AMZ':'red','DGC':'red','MSFT':'red','AMAZON':'red',
};
const LEAVE_TERMS = ['LVE','A/L','U/L','RDO','PH','JURY','OFF','LEAVE','PENDING','DAY OFF','TAFE'];

let STATE = {
  people:      [],
  schedule:    [],
  sites:       [],
  managers:    [],
  currentWeek: localStorage.getItem('eq_currentWeek') || '06.04.26'
};

function saveCurrentWeek() {
  localStorage.setItem('eq_currentWeek', STATE.currentWeek);
}

// Compatibility shim — sync ops that used to write localStorage
function saveState() {
  saveCurrentWeek();
  // Individual saves are done per-operation (savePeople, saveSites etc)
}
function loadState() { return null; } // unused — data comes from Supabase


// ── Navigation ────────────────────────────────────────────────
let currentPage = 'roster';
let rosterSort  = {col:'name', dir:'asc'};
let editorSort  = 'asc';

// ── Mobile roster day slider ──────────────────────────────────
let rosterActiveDay    = 'mon';
let rosterHasInteracted = false;
const ALL_DAYS   = ['mon','tue','wed','thu','fri','sat','sun'];
const ALL_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ── Contacts sort ─────────────────────────────────────────────
let contactsSort = {col:'name', dir:'asc'};

// ── Calendar ─────────────────────────────────────────────────
let calSelectedDate = null;

// ── Timesheets ────────────────────────────────────────────────
let tsTab = 'app'; // 'app' | 'lh'

// ── Leave ─────────────────────────────────────────────────────
let leaveRequests = [];

// isManager, agencyMode → declared above with SB config
