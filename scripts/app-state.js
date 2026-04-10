// ─────────────────────────────────────────────────────────────
// scripts/app-state.js  —  EQ Solves Field
// Global state, tenant detection, SEED data, config loading.
// Must be the FIRST script loaded.
// ─────────────────────────────────────────────────────────────

// ── Version ───────────────────────────────────────────────────
const APP_VERSION = '3.3.2';

// ── Hostname → tenant slug map ────────────────────────────────
const HOSTNAME_MAP = {
  'sks-nsw-labour.netlify.app': 'sks',
  'eq-solves-field.netlify.app': 'eq',
  'localhost': 'eq',
  '127.0.0.1': 'eq',
};

// Per-tenant Supabase credentials (public anon keys — safe to embed)
const TENANT_SUPABASE = {
  sks: {
    url: 'https://nspbmirochztcjijmcrx.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcGJtaXJvY2h6dGNqaWptY3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODg2MjQsImV4cCI6MjA5MDI2NDYyNH0.cpwHUqWr7MKaJFP0K7RMt43CytJ_dnPAH3LJ3xEdEdg'
  }
};

function _detectTenantSlug() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tenant')) return params.get('tenant');
  const h = window.location.hostname;
  // Exact match first
  if (HOSTNAME_MAP[h]) return HOSTNAME_MAP[h];
  // Substring match for Netlify deploy previews and branch deploys
  // e.g. deploy-preview-1--sks-nsw-labour.netlify.app, v3-3-2-test--sks-nsw-labour.netlify.app
  if (h.indexOf('sks-nsw-labour') !== -1) return 'sks';
  if (h.indexOf('eq-solves-field') !== -1) return 'eq';
  return 'eq';
}

// ── Tenant config (populated by loadTenantConfig) ─────────────
let TENANT = {
  ORG_SLUG: 'eq',
  ORG_UUID: null,
  ORG_NAME: 'EQ Solves — Field',
};

let SB_URL         = '';
let SB_KEY         = '';
let MANAGER_PASSWORD = '';

// Tables that get auto org_id filtering/stamping
// (used by scripts/supabase.js — _isOrgTable lives there)
const ORG_TABLES = [
  'people', 'sites', 'schedule', 'managers', 'timesheets',
  'leave_requests', 'audit_log', 'job_numbers'
];

async function loadTenantConfig() {
  TENANT.ORG_SLUG = _detectTenantSlug();

  // Demo / EQ tenant — no Supabase needed
  if (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo') {
    TENANT.ORG_NAME = 'EQ Solves — Field';
    TENANT.ORG_UUID = '00000000-0000-0000-0000-000000000001';
    SB_URL          = '';
    SB_KEY          = '';
    MANAGER_PASSWORD = 'demo1234';
    applyTenantBranding();
    return;
  }

  // Live tenant — resolve Supabase credentials from TENANT_SUPABASE map
  // (falls back to window.__SB_URL__ / window.__SB_KEY__ for override/testing)
  const tConfig = TENANT_SUPABASE[TENANT.ORG_SLUG] || {};
  SB_URL = window.__SB_URL__ || tConfig.url || '';
  SB_KEY = window.__SB_KEY__ || tConfig.key || '';

  if (!SB_URL || !SB_KEY) {
    console.error('Missing Supabase config for tenant:', TENANT.ORG_SLUG);
    return;
  }

  try {
    const slug = TENANT.ORG_SLUG;
    const resp = await fetch(`${SB_URL}/rest/v1/organisations?slug=eq.${slug}&select=*`, {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    if (resp.ok) {
      const rows = await resp.json();
      if (rows && rows[0]) {
        TENANT.ORG_UUID = rows[0].id;
        TENANT.ORG_NAME = rows[0].name || TENANT.ORG_NAME;
      }
    }
    // Load app config (manager password etc)
    const cfgResp = await fetch(`${SB_URL}/rest/v1/app_config?org_id=eq.${TENANT.ORG_UUID}&select=key,value`, {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    if (cfgResp.ok) {
      const cfg = await cfgResp.json();
      cfg.forEach(row => {
        if (row.key === 'manager_password') MANAGER_PASSWORD = row.value;
      });
    }
  } catch (e) {
    console.error('loadTenantConfig error:', e);
  }
  applyTenantBranding();
}

function applyTenantBranding() {
  const orgNameEl = document.getElementById('gate-org-name');
  const sidebarEl = document.getElementById('sidebar-org-name');
  if (orgNameEl) orgNameEl.textContent = TENANT.ORG_NAME;
  if (sidebarEl) sidebarEl.textContent = TENANT.ORG_SLUG.toUpperCase();
}

// ── App state ─────────────────────────────────────────────────
const STATE = {
  people:       [],
  sites:        [],
  schedule:     [],
  managers:     [],
  timesheets:   [],
  currentWeek:  '',
  scheduleIndex: {}
};

function saveCurrentWeek() {
  try { localStorage.setItem('eq_current_week', STATE.currentWeek); } catch (e) {}
}

// Restore saved week on load
try {
  const saved = localStorage.getItem('eq_current_week');
  if (saved) STATE.currentWeek = saved;
} catch (e) {}

// ── Sort state ────────────────────────────────────────────────
let rosterSort   = { col: 'name', dir: 'asc' };
let editorSort   = 'asc';
let contactsSort = { col: 'name', dir: 'asc' };
let tsTab        = 'app';
let rosterActiveDay     = 0;
let rosterHasInteracted = false;

// ── Site colour map ───────────────────────────────────────────
const SITE_COLOR_MAP = {
  'SITE-A': 'blue',
  'SITE-B': 'green',
  'SITE-C': 'amber',
  'SITE-D': 'red',
  'SITE-E': 'purple',
  'SITE-F': 'blue',
};

// ── Leave / status codes ──────────────────────────────────────
const LEAVE_TERMS = [
  'A/L', 'AL', 'LVE', 'LEAVE', 'U/L', 'UL', 'RDO', 'PH',
  'SICK', 'JURY', 'OFF', 'DAY OFF', 'TAFE', 'TRAINING', 'PENDING'
];

// ── Day arrays ────────────────────────────────────────────────
const ALL_DAYS   = ['mon','tue','wed','thu','fri','sat','sun'];
const ALL_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ── Agency mode ───────────────────────────────────────────────
// (declared here so auth.js can reference — initialised to false)
// Note: agencyMode and agencyName are declared in auth.js

// ── Manager state ─────────────────────────────────────────────
let isManager = false;

// ── SEED DATA — Demo tenant ───────────────────────────────────
const SEED = {
  weeks: ['06.04.26','13.04.26','20.04.26','27.04.26','04.05.26'],

  managers: [
    { id:1, name:'Demo Supervisor',     role:'Operations Manager',  category:'Operations',          phone:'0400000001', email:'supervisor@eq.solutions' },
    { id:2, name:'Demo Project Manager',role:'Project Manager',     category:'Project Management',  phone:'0400000002', email:'pm@eq.solutions' },
  ],

  people: [
    { id:1,  name:'Alex Mitchell',   group:'Direct',      phone:'0411000001', licence:'Licensed',  agency:'', email:'alex@example.com' },
    { id:2,  name:'Jordan Lee',      group:'Direct',      phone:'0411000002', licence:'Licensed',  agency:'', email:'jordan@example.com' },
    { id:3,  name:'Sam Taylor',      group:'Direct',      phone:'0411000003', licence:'Licensed',  agency:'', email:'sam@example.com' },
    { id:4,  name:'Casey Williams',  group:'Direct',      phone:'0411000004', licence:'Licensed',  agency:'', email:'casey@example.com' },
    { id:5,  name:'Morgan Davis',    group:'Direct',      phone:'0411000005', licence:'Licensed',  agency:'', email:'morgan@example.com' },
    { id:6,  name:'Riley Thompson',  group:'Direct',      phone:'0411000006', licence:'Licensed',  agency:'', email:'riley@example.com' },
    { id:7,  name:'Avery Johnson',   group:'Direct',      phone:'0411000007', licence:'Licensed',  agency:'', email:'avery@example.com' },
    { id:8,  name:'Blake Anderson',  group:'Direct',      phone:'0411000008', licence:'Licensed',  agency:'', email:'blake@example.com' },
    { id:9,  name:'Drew Wilson',     group:'Direct',      phone:'0411000009', licence:'Licensed',  agency:'', email:'drew@example.com' },
    { id:10, name:'Elliot Brown',    group:'Direct',      phone:'0411000010', licence:'Licensed',  agency:'', email:'elliot@example.com' },
    { id:11, name:'Finn Clarke',     group:'Direct',      phone:'0411000011', licence:'Licensed',  agency:'', email:'finn@example.com' },
    { id:12, name:'Harper Moore',    group:'Direct',      phone:'0411000012', licence:'Licensed',  agency:'', email:'harper@example.com' },
    { id:13, name:'Indigo White',    group:'Apprentice',  phone:'0411000013', licence:'1st Year',  agency:'', email:'indigo@example.com' },
    { id:14, name:'Jamie Harris',    group:'Apprentice',  phone:'0411000014', licence:'2nd Year',  agency:'', email:'jamie@example.com' },
    { id:15, name:'Kai Martin',      group:'Apprentice',  phone:'0411000015', licence:'3rd Year',  agency:'', email:'kai@example.com' },
    { id:16, name:'Lane Robinson',   group:'Labour Hire', phone:'0411000016', licence:'Licensed',  agency:'Core Labour', email:'lane@example.com' },
    { id:17, name:'Maxine Scott',    group:'Labour Hire', phone:'0411000017', licence:'Licensed',  agency:'Core Labour', email:'maxine@example.com' },
    { id:18, name:'Noah King',       group:'Labour Hire', phone:'0411000018', licence:'Licensed',  agency:'Atom Staff',  email:'noah@example.com' },
  ],

  sites: [
    { id:1, name:'Alpha Data Centre',   abbr:'SITE-A', address:'1 Alpha Way, Industrial Area' },
    { id:2, name:'Beta Commercial Tower',abbr:'SITE-B', address:'2 Beta Street, CBD' },
    { id:3, name:'City Hospital',        abbr:'SITE-C', address:'3 City Road, Metro' },
    { id:4, name:'Delta Industrial Park',abbr:'SITE-D', address:'4 Delta Drive, West' },
    { id:5, name:'East Medical Centre',  abbr:'SITE-E', address:'5 Eastern Ave, East' },
    { id:6, name:'Foxtrot Substation',   abbr:'SITE-F', address:'6 Foxtrot Close, North' },
    { id:7, name:'Staging Area',         abbr:'STG',    address:'7 Staging Road, Depot' },
  ],

  schedule: [
    // Week 06.04.26
    { id:101, name:'Alex Mitchell',   week:'06.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-B', thu:'SITE-A', fri:'SITE-A' },
    { id:102, name:'Jordan Lee',      week:'06.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-A', thu:'SITE-B', fri:'SITE-B' },
    { id:103, name:'Sam Taylor',      week:'06.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-A', thu:'SITE-C', fri:'SITE-C' },
    { id:104, name:'Casey Williams',  week:'06.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-A', thu:'SITE-D', fri:'SITE-D' },
    { id:105, name:'Morgan Davis',    week:'06.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-D', thu:'SITE-E', fri:'SITE-E' },
    { id:106, name:'Riley Thompson',  week:'06.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-E', thu:'SITE-F', fri:'SITE-F' },
    { id:107, name:'Avery Johnson',   week:'06.04.26', mon:'SITE-A', tue:'SITE-B', wed:'SITE-F', thu:'SITE-A', fri:'SITE-A' },
    { id:108, name:'Blake Anderson',  week:'06.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-D', thu:'SITE-B', fri:'SITE-B' },
    { id:109, name:'Drew Wilson',     week:'06.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:110, name:'Elliot Brown',    week:'06.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-D', thu:'SITE-D', fri:'SITE-D' },
    { id:111, name:'Finn Clarke',     week:'06.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-A', thu:'SITE-E', fri:'SITE-E' },
    { id:112, name:'Harper Moore',    week:'06.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-B', thu:'SITE-F', fri:'SITE-F' },
    { id:113, name:'Indigo White',    week:'06.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:114, name:'Jamie Harris',    week:'06.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:115, name:'Kai Martin',      week:'06.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:116, name:'Lane Robinson',   week:'06.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-E', thu:'SITE-D', fri:'SITE-D' },
    { id:117, name:'Maxine Scott',    week:'06.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-F', thu:'SITE-E', fri:'SITE-E' },
    { id:118, name:'Noah King',       week:'06.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-F', thu:'SITE-F', fri:'SITE-F' },
    // Week 13.04.26
    { id:201, name:'Alex Mitchell',   week:'13.04.26', mon:'SITE-B', tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:202, name:'Jordan Lee',      week:'13.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:203, name:'Sam Taylor',      week:'13.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-A', thu:'SITE-C', fri:'SITE-C' },
    { id:204, name:'Casey Williams',  week:'13.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-A', thu:'SITE-D', fri:'SITE-D' },
    { id:205, name:'Morgan Davis',    week:'13.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-D', thu:'SITE-E', fri:'SITE-E' },
    { id:206, name:'Riley Thompson',  week:'13.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-E', thu:'SITE-F', fri:'SITE-F' },
    { id:207, name:'Avery Johnson',   week:'13.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-F', thu:'SITE-A', fri:'SITE-A' },
    { id:208, name:'Blake Anderson',  week:'13.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-D', thu:'SITE-B', fri:'SITE-B' },
    { id:209, name:'Drew Wilson',     week:'13.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:210, name:'Elliot Brown',    week:'13.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-D', thu:'SITE-D', fri:'A/L'    },
    { id:211, name:'Finn Clarke',     week:'13.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-A', thu:'SITE-E', fri:'SITE-E' },
    { id:212, name:'Harper Moore',    week:'13.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-B', thu:'SITE-F', fri:'SITE-F' },
    { id:213, name:'Indigo White',    week:'13.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:214, name:'Jamie Harris',    week:'13.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:215, name:'Kai Martin',      week:'13.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:216, name:'Lane Robinson',   week:'13.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-E', thu:'SITE-D', fri:'SITE-D' },
    { id:217, name:'Maxine Scott',    week:'13.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-F', thu:'SITE-E', fri:'SITE-E' },
    { id:218, name:'Noah King',       week:'13.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-F', thu:'SITE-F', fri:'SITE-F' },
    // Week 20.04.26
    { id:301, name:'Alex Mitchell',   week:'20.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:302, name:'Jordan Lee',      week:'20.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:303, name:'Sam Taylor',      week:'20.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:304, name:'Casey Williams',  week:'20.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-D', thu:'SITE-D', fri:'SITE-D' },
    { id:305, name:'Morgan Davis',    week:'20.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-E', thu:'SITE-E', fri:'SITE-E' },
    { id:306, name:'Riley Thompson',  week:'20.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-F', thu:'SITE-F', fri:'SITE-F' },
    { id:307, name:'Avery Johnson',   week:'20.04.26', mon:'RDO',    tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:308, name:'Blake Anderson',  week:'20.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:309, name:'Drew Wilson',     week:'20.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:310, name:'Elliot Brown',    week:'20.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-D', thu:'SITE-D', fri:'SITE-D' },
    { id:311, name:'Finn Clarke',     week:'20.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-E', thu:'SITE-E', fri:'SITE-E' },
    { id:312, name:'Harper Moore',    week:'20.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-F', thu:'SITE-F', fri:'SITE-F' },
    { id:313, name:'Indigo White',    week:'20.04.26', mon:'SITE-A', tue:'SITE-A', wed:'SITE-A', thu:'SITE-A', fri:'SITE-A' },
    { id:314, name:'Jamie Harris',    week:'20.04.26', mon:'SITE-B', tue:'SITE-B', wed:'SITE-B', thu:'SITE-B', fri:'SITE-B' },
    { id:315, name:'Kai Martin',      week:'20.04.26', mon:'SITE-C', tue:'SITE-C', wed:'SITE-C', thu:'SITE-C', fri:'SITE-C' },
    { id:316, name:'Lane Robinson',   week:'20.04.26', mon:'SITE-D', tue:'SITE-D', wed:'SITE-D', thu:'SITE-D', fri:'SITE-D' },
    { id:317, name:'Maxine Scott',    week:'20.04.26', mon:'SITE-E', tue:'SITE-E', wed:'SITE-E', thu:'SITE-E', fri:'SITE-E' },
    { id:318, name:'Noah King',       week:'20.04.26', mon:'SITE-F', tue:'SITE-F', wed:'SITE-F', thu:'SITE-F', fri:'SITE-F' },
  ]
};
