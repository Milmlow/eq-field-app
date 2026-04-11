// ─────────────────────────────────────────────────────────────
// scripts/trial-dashboard.js  —  SKS Labour
// Trial Dashboard: modern, executive SKS-branded view.
// Deep navy canvas with electric-cyan accents and crisp white
// cards — matches the SKS brand (#0D1B2A → #1F335C gradient).
// Depends on: app-state.js, utils.js, roster.js
// ─────────────────────────────────────────────────────────────

// Inject scoped CSS once
(function injectTrialCSS() {
  if (document.getElementById('trial-dash-css')) return;
  const css = `
  .trial-wrap{
    /* SKS brand palette */
    --t-bg:#0A1220;          /* deepest navy */
    --t-bg-2:#0D1B2A;        /* SKS navy */
    --t-canvas:#F4F7FC;      /* cool cloud */
    --t-card:#FFFFFF;
    --t-card-dk:#132238;
    --t-border:rgba(15,35,70,.10);
    --t-border-dk:rgba(120,180,255,.14);
    --t-ink:#0D1B2A;         /* SKS navy text */
    --t-ink-2:#31445F;       /* muted steel */
    --t-ink-3:#6B7D95;       /* soft slate */
    --t-ink-inv:#F4F7FC;

    /* SKS accents — electric on navy */
    --t-accent:#00B4E4;      /* SKS cyan */
    --t-accent-dk:#0086B3;   /* deeper cyan */
    --t-navy:#1F335C;        /* core SKS navy */
    --t-navy-dk:#0D1B2A;     /* brand deep navy */
    --t-blue:#3D7BFF;        /* tech blue */
    --t-lime:#7FE7C4;        /* mint accent */
    --t-gold:#FFC857;        /* warm highlight */
    --t-red:#FF5267;         /* alerts */

    color:var(--t-ink);
    font-family:'Inter','Helvetica Neue',system-ui,-apple-system,sans-serif;
    position:relative; padding:0; margin:-20px -20px 0;
    min-height:calc(100vh - 60px);
    background:
      radial-gradient(1400px 800px at 85% -10%,rgba(0,180,228,.18),transparent 60%),
      radial-gradient(1100px 600px at -5% 110%,rgba(61,123,255,.14),transparent 60%),
      linear-gradient(180deg,#0D1B2A 0%,#132238 40%,#0A1220 100%);
    overflow:hidden;
  }
  /* Subtle grid overlay — tech pattern */
  .trial-wrap::before{
    content:''; position:absolute; inset:0; pointer-events:none; opacity:.35;
    background-image:
      linear-gradient(rgba(120,180,255,.045) 1px,transparent 1px),
      linear-gradient(90deg,rgba(120,180,255,.045) 1px,transparent 1px);
    background-size:56px 56px,56px 56px;
    mask-image:radial-gradient(ellipse 90% 70% at 50% 40%,#000 40%,transparent 100%);
  }
  /* Accent glow ribbon along the top */
  .trial-wrap::after{
    content:''; position:absolute; top:0; left:0; right:0; height:2px; pointer-events:none;
    background:linear-gradient(90deg,transparent,var(--t-accent) 30%,var(--t-blue) 70%,transparent);
    box-shadow:0 0 24px rgba(0,180,228,.6);
  }

  .trial-inner{position:relative; z-index:2; padding:28px 32px 0; max-width:1600px; margin:0 auto;}

  /* ── Header ──────────────────────────────── */
  .trial-hdr{
    display:flex;align-items:center;gap:20px;margin-bottom:10px;flex-wrap:wrap;
    padding-bottom:22px;border-bottom:1px solid var(--t-border-dk);
  }
  .trial-brand{display:flex;align-items:center;gap:16px}
  .trial-logo{
    width:54px;height:54px;border-radius:14px;
    background:linear-gradient(135deg,#00B4E4 0%,#3D7BFF 55%,#1F335C 100%);
    display:flex;align-items:center;justify-content:center;
    color:#FFFFFF;font-weight:800;font-size:16px;letter-spacing:.5px;
    box-shadow:0 10px 30px rgba(0,180,228,.35),0 0 0 1px rgba(255,255,255,.08) inset;
    position:relative;
  }
  .trial-logo::after{
    content:'';position:absolute;inset:4px;border:1px solid rgba(255,255,255,.22);border-radius:10px;
  }
  .trial-title{font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.1;letter-spacing:-.015em}
  .trial-sub{font-size:10.5px;color:var(--t-accent);margin-top:5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}

  .trial-status{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
  .trial-pill{
    display:inline-flex;align-items:center;gap:9px;
    padding:9px 15px;border-radius:999px;font-size:11px;font-weight:600;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(10px);
    color:#E5EEF9;
  }
  .trial-pill .pdot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .trial-pill.ochre .pdot{background:var(--t-accent);box-shadow:0 0 0 3px rgba(0,180,228,.18),0 0 12px rgba(0,180,228,.6)}
  .trial-pill.gold  .pdot{background:var(--t-gold);  box-shadow:0 0 0 3px rgba(255,200,87,.18)}
  .trial-pill.olive .pdot{background:var(--t-lime);  box-shadow:0 0 0 3px rgba(127,231,196,.18)}
  .trial-pill strong{font-weight:800;color:#FFFFFF;font-size:13px}
  .trial-pill .lbl{color:rgba(229,238,249,.6);font-weight:500}

  .trial-meta{
    display:flex;gap:18px;align-items:center;
    font-size:11px;color:rgba(229,238,249,.55);margin:16px 0 26px;
    padding-bottom:2px;letter-spacing:.03em;
  }
  .trial-meta .sep{width:3px;height:3px;border-radius:50%;background:rgba(229,238,249,.4)}
  .trial-meta .live{color:var(--t-accent);font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:10px}
  .trial-meta .live::before{
    content:'';display:inline-block;width:7px;height:7px;border-radius:50%;
    background:var(--t-accent);margin-right:7px;vertical-align:middle;
    box-shadow:0 0 0 3px rgba(0,180,228,.2),0 0 14px rgba(0,180,228,.8);
    animation:trialPulse 1.6s ease-in-out infinite;
  }
  @keyframes trialPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}

  /* ── Cards ──────────────────────────────── */
  .trial-card{
    position:relative;background:var(--t-card);
    border:1px solid var(--t-border);border-radius:18px;
    padding:24px 26px;
    box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 14px 40px rgba(8,18,36,.32),0 2px 6px rgba(8,18,36,.18);
    transition:transform .24s cubic-bezier(.2,.8,.2,1),box-shadow .24s;
  }
  .trial-card:hover{transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 22px 54px rgba(0,180,228,.18),0 4px 14px rgba(8,18,36,.3)}
  .trial-card::before{
    content:'';position:absolute;top:0;left:24px;right:24px;height:2px;border-radius:0 0 2px 2px;
    background:linear-gradient(90deg,var(--t-accent),var(--t-blue) 60%,transparent);
    opacity:.9;
  }

  .trial-card h3{
    font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;
    color:var(--t-ink-3);margin:0 0 18px;display:flex;align-items:center;gap:12px;
  }
  .trial-card h3::before{
    content:'';width:18px;height:2px;background:linear-gradient(90deg,var(--t-accent),var(--t-blue));border-radius:2px;
  }

  /* ── KPI row ──────────────────────────────── */
  .trial-grid-top{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:24px}
  @media(max-width:900px){.trial-grid-top{grid-template-columns:repeat(2,1fr)}}

  .kpi-label{
    font-size:10px;letter-spacing:.16em;color:var(--t-ink-3);
    text-transform:uppercase;margin-bottom:14px;font-weight:700;
  }
  .kpi-num{
    font-size:50px;font-weight:800;letter-spacing:-.03em;line-height:1;
    color:var(--t-ink);font-variant-numeric:tabular-nums;
    background:linear-gradient(140deg,#0D1B2A 20%,#1F335C 60%,#3D7BFF 100%);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  }
  .kpi-sub{font-size:12px;color:var(--t-ink-2);margin-top:10px;font-weight:500}
  .kpi-delta{
    margin-top:16px;padding-top:14px;border-top:1px solid var(--t-border);
    font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;letter-spacing:.02em;
  }
  .kpi-delta.up{color:#10B981}
  .kpi-delta.dn{color:var(--t-red)}
  .kpi-delta.eq{color:var(--t-ink-3);font-weight:500}

  /* ── Main grid ──────────────────────────────── */
  .trial-grid-main{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;align-items:stretch}
  @media(max-width:1100px){.trial-grid-main{grid-template-columns:1fr}}
  .trial-grid-main > .trial-card.site-card{
    display:flex;flex-direction:column;min-height:0;
  }
  .trial-grid-main > .trial-card.site-card .sites-scan{flex:1 1 auto;min-height:0}
  .trial-grid-main > .right-col{display:flex;flex-direction:column;gap:20px;min-height:0}

  /* ── Site list ──────────────────────────────── */
  .sites-scan{overflow-y:auto;padding:2px 8px 6px 0;margin:0 -8px 0 -6px}
  .sites-scan::-webkit-scrollbar{width:6px}
  .sites-scan::-webkit-scrollbar-thumb{background:rgba(0,180,228,.3);border-radius:3px}
  .site-row{
    display:grid;grid-template-columns:1.4fr 1fr 72px;
    gap:18px;align-items:center;padding:14px 16px;margin:0 6px 4px;
    border-radius:12px;border:1px solid transparent;
    transition:all .2s;
  }
  .site-row:hover{background:#F4F9FF;border-color:var(--t-border)}
  .site-name{display:flex;align-items:center;gap:12px;min-width:0}
  .site-name .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 3px rgba(0,180,228,.08)}
  .site-name .lbl{font-weight:700;color:var(--t-ink);font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .site-name .code{font-size:10px;color:var(--t-ink-3);letter-spacing:.12em;text-transform:uppercase;margin-top:2px;font-weight:600}
  .site-bar{height:8px;background:rgba(13,27,42,.06);border-radius:6px;overflow:hidden}
  .site-bar>span{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--t-accent),var(--t-blue));transition:width .8s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 12px rgba(0,180,228,.4)}
  .site-count{font-size:24px;font-weight:800;color:var(--t-navy);text-align:right;font-variant-numeric:tabular-nums;line-height:1}
  .site-count small{font-size:9px;color:var(--t-ink-3);font-weight:700;display:block;letter-spacing:.14em;text-transform:uppercase;margin-top:4px}

  /* ── Charts ──────────────────────────────── */
  .sparkline{width:100%;height:140px;display:block}
  .donut-wrap{display:flex;align-items:center;gap:24px}
  .donut-legend{flex:1;font-size:12px;display:flex;flex-direction:column;gap:12px}
  .donut-legend .li{display:flex;align-items:center;gap:10px}
  .donut-legend .sw{width:12px;height:12px;border-radius:4px;flex-shrink:0}
  .donut-legend .nm{color:var(--t-ink);font-weight:600}
  .donut-legend .v{margin-left:auto;font-weight:800;color:var(--t-ink);font-variant-numeric:tabular-nums}
  .donut-legend .pct{color:var(--t-ink-3);font-size:10px;margin-left:8px;font-weight:600}

  /* ── Heatmap ──────────────────────────────── */
  .heatmap{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:6px}
  .heat-hdr{font-size:9px;color:var(--t-ink-3);text-align:center;letter-spacing:.14em;text-transform:uppercase;padding-bottom:4px;font-weight:700}
  .heat-cell{
    aspect-ratio:1;border-radius:8px;background:rgba(13,27,42,.05);
    display:flex;align-items:center;justify-content:center;
    font-size:11px;color:var(--t-ink-3);font-weight:700;
    transition:all .2s;
  }
  .heat-cell.l1{background:rgba(127,231,196,.32);color:var(--t-ink)}
  .heat-cell.l2{background:rgba(0,180,228,.42);color:#fff}
  .heat-cell.l3{background:rgba(61,123,255,.75);color:#fff}
  .heat-cell.l4{background:linear-gradient(135deg,var(--t-accent),var(--t-blue));color:#fff;box-shadow:0 6px 18px rgba(0,180,228,.4)}

  .diag{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px;padding-top:18px;border-top:1px solid var(--t-border)}
  .diag .d{text-align:center}
  .diag .d .n{font-size:24px;font-weight:800;color:var(--t-navy);font-variant-numeric:tabular-nums;line-height:1}
  .diag .d .l{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--t-ink-3);margin-top:6px;font-weight:700}

  /* ── Activity feed ──────────────────────────────── */
  .feed{max-height:240px;overflow-y:auto;font-size:12px}
  .feed.feed-wide{max-height:300px;display:grid;grid-template-columns:repeat(2,1fr);gap:0 28px}
  @media(max-width:900px){.feed.feed-wide{grid-template-columns:1fr}}
  .feed .line{
    padding:11px 0;border-bottom:1px solid var(--t-border);
    display:flex;gap:12px;color:var(--t-ink-2);
  }
  .feed .line:last-child{border-bottom:0}
  .feed .line .t{color:var(--t-accent-dk);flex-shrink:0;font-variant-numeric:tabular-nums;font-size:11px;font-weight:700;min-width:60px}

  /* ── Footer ──────────────────────────────── */
  .trial-footer{
    margin:40px -32px 0;
    padding:26px 32px 30px;
    background:linear-gradient(180deg,transparent,rgba(0,180,228,.06));
    border-top:1px solid var(--t-border-dk);
    position:relative;
    text-align:center;
  }
  .trial-footer::before{
    content:'';position:absolute;top:-1px;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,var(--t-accent) 50%,transparent);
  }
  .trial-footer .brand-line{
    font-size:11px;font-weight:800;letter-spacing:.22em;
    color:var(--t-accent);text-transform:uppercase;
  }
  .trial-footer .brand-sub{
    margin-top:8px;font-size:10.5px;color:rgba(229,238,249,.45);
    letter-spacing:.08em;
  }

  /* ── Slicer states ──────────────────────────────── */
  .trial-card.slicer{cursor:pointer;user-select:none}
  .trial-card.slicer:hover{transform:translateY(-3px);box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 22px 54px rgba(0,180,228,.25),0 4px 14px rgba(8,18,36,.35)}
  .trial-card.slicer.active{
    border-color:var(--t-accent);
    box-shadow:0 0 0 2px rgba(0,180,228,.30),0 22px 54px rgba(0,180,228,.28);
    background:linear-gradient(180deg,#FFFFFF 0%,#EAF7FE 100%);
  }
  .trial-card.slicer.active::before{opacity:1;height:3px}
  .trial-card.slicer.dim{opacity:.48}
  .trial-card.slicer.dim:hover{opacity:.85}

  .site-row{cursor:pointer}
  .site-row.active{
    background:linear-gradient(90deg,rgba(0,180,228,.14),rgba(61,123,255,.04));
    border-color:var(--t-accent) !important;
    box-shadow:inset 3px 0 0 var(--t-accent);
  }
  .site-row.dim{opacity:.42}
  .site-row.dim:hover{opacity:.8}

  .heat-cell.clickable{cursor:pointer;transition:transform .18s,outline-offset .18s}
  .heat-cell.clickable:hover{transform:scale(1.06)}
  .heat-cell.active{
    outline:2px solid var(--t-accent);outline-offset:3px;
    transform:scale(1.08);
    box-shadow:0 8px 22px rgba(0,180,228,.4);
  }
  .heat-cell.dim{opacity:.35}

  .donut-wrap svg circle.seg{cursor:pointer;transition:opacity .2s,stroke-width .2s}
  .donut-wrap svg circle.seg.dim{opacity:.28}
  .donut-wrap svg circle.seg.active{stroke-width:20}
  .donut-legend .li{cursor:pointer;padding:5px 8px;border-radius:8px;transition:background .15s}
  .donut-legend .li:hover{background:rgba(0,180,228,.08)}
  .donut-legend .li.active{background:linear-gradient(90deg,rgba(0,180,228,.14),transparent);box-shadow:inset 3px 0 0 var(--t-accent)}
  .donut-legend .li.dim{opacity:.42}

  /* ── Filter bar ──────────────────────────────── */
  .filter-bar{
    display:flex;gap:10px;align-items:center;flex-wrap:wrap;
    margin:-10px 0 22px;padding:13px 16px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(120,180,255,.18);border-radius:14px;
    backdrop-filter:blur(14px);
    box-shadow:0 8px 28px rgba(8,18,36,.3);
    animation:filterBarIn .35s ease;
  }
  @keyframes filterBarIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .filter-bar .fb-label{
    font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;
    color:var(--t-accent);display:flex;align-items:center;gap:8px;
  }
  .filter-bar .fb-label::before{
    content:'';width:14px;height:2px;background:var(--t-accent);display:inline-block;border-radius:2px;
  }
  .filter-chip{
    display:inline-flex;align-items:center;gap:8px;
    padding:7px 6px 7px 14px;border-radius:22px;border:0;
    background:linear-gradient(135deg,var(--t-accent) 0%,var(--t-blue) 100%);
    color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:.02em;
    box-shadow:0 6px 18px rgba(0,180,228,.38),inset 0 1px 0 rgba(255,255,255,.25);
    cursor:pointer;font-family:inherit;
    transition:transform .15s,box-shadow .15s;
  }
  .filter-chip:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,180,228,.5),inset 0 1px 0 rgba(255,255,255,.3)}
  .filter-chip .ft{opacity:.75;font-size:9px;text-transform:uppercase;letter-spacing:.1em;margin-right:-2px}
  .filter-chip .x{
    width:18px;height:18px;border-radius:50%;
    background:rgba(0,0,0,.22);display:inline-flex;
    align-items:center;justify-content:center;font-size:11px;font-weight:800;
    line-height:1;
  }
  .filter-bar .clear-all{
    margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.12em;
    text-transform:uppercase;color:var(--t-accent);cursor:pointer;
    padding:8px 14px;border:1px solid rgba(0,180,228,.45);border-radius:8px;
    background:transparent;font-family:inherit;
    transition:all .15s;
  }
  .filter-bar .clear-all:hover{background:var(--t-accent);color:#0D1B2A;border-color:var(--t-accent)}
  `;
  const style = document.createElement('style');
  style.id = 'trial-dash-css';
  style.textContent = css;
  document.head.appendChild(style);
})();

// ── Slicer state ──────────────────────────────────────────────
let trialFilters = { group: null, site: null, day: null };

function trialToggleGroup(g) {
  trialFilters.group = (trialFilters.group === g) ? null : g;
  renderTrialDashboard();
}
function trialToggleSite(s) {
  trialFilters.site = (trialFilters.site === s) ? null : s;
  renderTrialDashboard();
}
function trialToggleDay(d) {
  trialFilters.day = (trialFilters.day === d) ? null : d;
  renderTrialDashboard();
}
function trialClearFilters() {
  trialFilters = { group: null, site: null, day: null };
  renderTrialDashboard();
}

// ── Render ────────────────────────────────────────────────────
function renderTrialDashboard() {
  const root = document.getElementById('trial-root');
  if (!root) return;

  const week      = STATE.currentWeek;
  const sched     = (typeof getWeekSchedule === 'function') ? getWeekSchedule(week) : [];
  const days      = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const wd        = days.slice(0, 5);

  // Person → group map
  const pGroup = {};
  (STATE.people || []).forEach(p => { pGroup[p.name] = p.group; });

  // Filter helpers
  const F = trialFilters;
  const matchGroupDay = (r, d) => {
    if (F.group && pGroup[r.name] !== F.group) return false;
    if (F.day && d !== F.day) return false;
    return true;
  };
  const matchAll = (r, d, cell) => {
    if (!matchGroupDay(r, d)) return false;
    if (F.site && cell !== F.site) return false;
    return true;
  };

  // Site data — honours group/day filter (not site filter, so rows stay visible)
  const siteData = {};
  sched.forEach(r => wd.forEach(d => {
    const s = r[d];
    if (s && !isLeave(s) && String(s).trim() && matchGroupDay(r, d)) {
      if (!siteData[s]) siteData[s] = { days: {}, total: 0, people: new Set() };
      if (!siteData[s].days[d]) siteData[s].days[d] = 0;
      siteData[s].days[d]++;
      siteData[s].total++;
      siteData[s].people.add(r.name);
    }
  }));
  const sitesSorted = Object.entries(siteData).sort((a,b) => b[1].total - a[1].total);
  const activeSites = F.site ? (siteData[F.site] ? 1 : 0) : sitesSorted.length;
  const maxSiteTotal = sitesSorted.length ? sitesSorted[0][1].total : 1;

  // Active set (people appearing in filtered allocations, honours all filters)
  const activeSet = new Set();
  sched.forEach(r => wd.forEach(d => {
    const s = r[d];
    if (s && !isLeave(s) && String(s).trim() && matchAll(r, d, s)) activeSet.add(r.name);
  }));

  // Composition from activeSet
  const comp = { Direct:0, Apprentice:0, 'Labour Hire':0 };
  activeSet.forEach(nm => { if (comp[pGroup[nm]] != null) comp[pGroup[nm]]++; });
  const totalHead = comp.Direct + comp.Apprentice + comp['Labour Hire'];

  // On leave this week — exclude Public Holidays (site-wide closure, not an absence)
  const onLeaveSet = new Set();
  sched.forEach(r => wd.forEach(d => {
    if (isAbsence(r[d]) && (!F.group || pGroup[r.name] === F.group)) onLeaveSet.add(r.name);
  }));
  const onLeave = onLeaveSet.size;

  // Daily utilisation — honours group/site filter but ignores day filter (heatmap shows all days)
  const dayTotals = wd.map(d => sched.reduce((s,r) => {
    const cell = r[d];
    if (!cell || isLeave(cell) || !String(cell).trim()) return s;
    if (F.group && pGroup[r.name] !== F.group) return s;
    if (F.site && cell !== F.site) return s;
    return s + 1;
  }, 0));

  // 6-week headcount trend
  const allWeeks = (typeof SEED !== 'undefined' && SEED.weeks) ? SEED.weeks : [week];
  const curIdx = Math.max(0, allWeeks.indexOf(week));
  const trendWeeks = [];
  for (let i = Math.max(0, curIdx - 5); i <= curIdx; i++) trendWeeks.push(allWeeks[i] || week);
  const trendData = trendWeeks.map(w => {
    const ws = (typeof getWeekSchedule === 'function') ? getWeekSchedule(w) : [];
    const names = new Set();
    ws.forEach(r => days.slice(0,5).forEach(d => {
      if (r[d] && !isLeave(r[d]) && String(r[d]).trim()) names.add(r.name);
    }));
    return { w: w, v: names.size || totalHead };
  });

  // Previous-week delta
  const prevW = allWeeks[curIdx - 1];
  let prevTotal = 0;
  if (prevW) {
    const ws = getWeekSchedule(prevW);
    const names = new Set();
    ws.forEach(r => days.slice(0,5).forEach(d => {
      if (r[d] && !isLeave(r[d]) && String(r[d]).trim()) names.add(r.name);
    }));
    prevTotal = names.size;
  }
  const curActive = totalHead - onLeave;
  const deltaHead = curActive - (prevTotal || curActive);

  // Hours logged this week
  const tsThisWeek = (STATE.timesheets || []).filter(t => t.week === week);
  const tsHrs = tsThisWeek.reduce((s,t) => {
    return s + days.reduce((a,d) => {
      const v = t[d+'_hrs'];
      if (v != null && String(v).includes('|')) {
        return a + String(v).split('|').reduce((x,y)=>x+(parseFloat(y)||0),0);
      }
      return a + (parseFloat(v)||0);
    }, 0);
  }, 0);

  // ── HTML ──────────────────────────────────────────────────
  const now = new Date();
  const tsStr = now.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) +
                ' · ' + now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false});

  const deltaCls = deltaHead === 0 ? 'eq' : (deltaHead > 0 ? 'up' : 'dn');
  const deltaStr = deltaHead === 0
    ? '— no change'
    : (deltaHead > 0 ? `▲ +${deltaHead} vs last week` : `▼ ${deltaHead} vs last week`);

  const kpis = [
    { lbl:'Direct Employees', val:comp.Direct,         sub:'Permanent workforce',  showDelta:true,  group:'Direct' },
    { lbl:'Apprentices',      val:comp.Apprentice,     sub:'In training',          showDelta:false, group:'Apprentice' },
    { lbl:'Labour Hire',      val:comp['Labour Hire'], sub:'Contracted',           showDelta:false, group:'Labour Hire' },
    { lbl:'Active Sites',     val:activeSites,         sub:'This week',            showDelta:false, group:null }
  ];
  const kpiHtml = kpis.map(k => {
    const isSlicer = !!k.group;
    const isActive = isSlicer && F.group === k.group;
    const isDim    = isSlicer && F.group && F.group !== k.group;
    const cls = [
      'trial-card',
      isSlicer ? 'slicer' : '',
      isActive ? 'active' : '',
      isDim ? 'dim' : ''
    ].filter(Boolean).join(' ');
    const click = isSlicer ? `onclick="trialToggleGroup('${k.group}')"` : '';
    return `
    <div class="${cls}" ${click}>
      <div class="kpi-label">${k.lbl}</div>
      <div class="kpi-num" data-count="${k.val}">0</div>
      <div class="kpi-sub">${k.sub}</div>
      <div class="kpi-delta ${k.showDelta ? deltaCls : 'eq'}">${k.showDelta ? deltaStr : '\u00A0'}</div>
    </div>`;
  }).join('');

  // Site rows — SKS accent palette
  const colMap = {
    blue:'#3D7BFF', green:'#10B981', amber:'#FFC857', red:'#FF5267',
    purple:'#8B5CF6', grey:'#6B7D95'
  };
  const siteRows = sitesSorted.map(([abbr, d]) => {
    const full = (typeof getSiteName === 'function') ? getSiteName(abbr) : abbr;
    const col  = (typeof siteColor === 'function') ? siteColor(abbr) : 'amber';
    const pct  = Math.round((d.total / maxSiteTotal) * 100);
    const isActive = F.site === abbr;
    const isDim    = F.site && F.site !== abbr;
    const cls = ['site-row', isActive ? 'active' : '', isDim ? 'dim' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" onclick="trialToggleSite('${esc(abbr).replace(/'/g, "\\'")}')">
      <div class="site-name">
        <span class="dot" style="background:${colMap[col] || '#D98B2B'}"></span>
        <div style="min-width:0;flex:1">
          <div class="lbl">${esc(full !== abbr ? full : abbr)}</div>
          <div class="code">${esc(abbr)}</div>
        </div>
      </div>
      <div class="site-bar"><span style="width:${pct}%"></span></div>
      <div class="site-count">${d.people.size}<small>People</small></div>
    </div>`;
  }).join('') || `<div style="text-align:center;padding:40px;color:var(--t-ink-3);font-size:12px">No site allocations for this week</div>`;

  // Sparkline
  const vals = trendData.map(d => d.v);
  const vmax = Math.max(...vals, 1);
  const W = 440, H = 130, PAD = 14;
  const sx = i => PAD + (i * (W - 2*PAD) / Math.max(1, vals.length - 1));
  const sy = v => H - PAD - ((v) / (vmax || 1)) * (H - 2*PAD - 12);
  const pts = vals.map((v,i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const areaD = `M ${sx(0)},${H-PAD} L ${pts.split(' ').join(' L ')} L ${sx(vals.length-1)},${H-PAD} Z`;
  const lineD = `M ${pts.split(' ').join(' L ')}`;
  const sparkSVG = `
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sksArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#00B4E4" stop-opacity=".32"/>
          <stop offset="1" stop-color="#00B4E4" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="sksLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#00B4E4"/>
          <stop offset=".6" stop-color="#3D7BFF"/>
          <stop offset="1" stop-color="#7FE7C4"/>
        </linearGradient>
      </defs>
      ${[0,.25,.5,.75,1].map(f => `<line x1="${PAD}" x2="${W-PAD}" y1="${PAD + f*(H-2*PAD)}" y2="${PAD + f*(H-2*PAD)}" stroke="rgba(13,27,42,.07)"/>`).join('')}
      <path d="${areaD}" fill="url(#sksArea)"/>
      <path d="${lineD}" fill="none" stroke="url(#sksLine)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${vals.map((v,i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="4.5" fill="#FFFFFF" stroke="#00B4E4" stroke-width="2.5"/>`).join('')}
      ${vals.map((v,i) => `<text x="${sx(i).toFixed(1)}" y="${(sy(v)-10).toFixed(1)}" fill="#1F335C" font-size="11" font-weight="800" text-anchor="middle" font-family="Inter,sans-serif">${v}</text>`).join('')}
    </svg>`;

  // Donut
  const donutTotal = comp.Direct + comp.Apprentice + comp['Labour Hire'] || 1;
  const segs = [
    { k:'Direct',      gk:'Direct',      v:comp.Direct,         c:'#00B4E4' },
    { k:'Apprentices', gk:'Apprentice',  v:comp.Apprentice,     c:'#3D7BFF' },
    { k:'Labour Hire', gk:'Labour Hire', v:comp['Labour Hire'], c:'#7FE7C4' }
  ];
  const R = 54, CX = 72, CY = 72, CIRC = 2 * Math.PI * R;
  let acc = 0;
  const donutSegs = segs.map(s => {
    const len = (s.v / donutTotal) * CIRC;
    const isActive = F.group === s.gk;
    const isDim    = F.group && F.group !== s.gk;
    const segCls = ['seg', isActive ? 'active' : '', isDim ? 'dim' : ''].filter(Boolean).join(' ');
    const el = `<circle class="${segCls}" cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${s.c}" stroke-width="16" stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt" onclick="trialToggleGroup('${s.gk}')"/>`;
    acc += len;
    return el;
  }).join('');
  const donutSVG = `
    <svg width="144" height="144" viewBox="0 0 144 144">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="rgba(13,27,42,.08)" stroke-width="16"/>
      ${donutSegs}
      <text x="${CX}" y="${CY-2}" text-anchor="middle" fill="#0D1B2A" font-size="32" font-weight="800" font-family="Inter,sans-serif" pointer-events="none">${donutTotal}</text>
      <text x="${CX}" y="${CY+16}" text-anchor="middle" fill="#6B7D95" font-size="9" letter-spacing="1.8" font-family="Inter,sans-serif" font-weight="700" pointer-events="none">TOTAL</text>
    </svg>`;
  const donutLegend = segs.map(s => {
    const isActive = F.group === s.gk;
    const isDim    = F.group && F.group !== s.gk;
    const liCls = ['li', isActive ? 'active' : '', isDim ? 'dim' : ''].filter(Boolean).join(' ');
    return `
    <div class="${liCls}" onclick="trialToggleGroup('${s.gk}')">
      <span class="sw" style="background:${s.c}"></span>
      <span class="nm">${s.k}</span>
      <span class="v">${s.v}</span>
      <span class="pct">${Math.round((s.v/donutTotal)*100)}%</span>
    </div>`;
  }).join('');

  // Heatmap
  const maxDay = Math.max(...dayTotals, 1);
  const heatCells = dayTotals.map((v,i) => {
    const ratio = v / maxDay;
    const lvl = v === 0 ? '' : ratio > .85 ? 'l4' : ratio > .6 ? 'l3' : ratio > .35 ? 'l2' : 'l1';
    const dk = wd[i];
    const isActive = F.day === dk;
    const isDim    = F.day && F.day !== dk;
    const cls = ['heat-cell', 'clickable', lvl, isActive ? 'active' : '', isDim ? 'dim' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" title="${dayLabels[i]}: ${v}" onclick="trialToggleDay('${dk}')">${v || '·'}</div>`;
  }).join('') + '<div class="heat-cell"></div><div class="heat-cell"></div>';
  const heatHdr = dayLabels.map(l => `<div class="heat-hdr">${l[0]}</div>`).join('');

  // Activity feed
  const auditRows = (typeof auditTrail !== 'undefined' ? auditTrail : []).slice(-6).reverse();
  const feedHtml = auditRows.length
    ? auditRows.map(a => {
        const t = a.ts ? new Date(a.ts).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false}) : '--:--';
        return `<div class="line"><span class="t">${t}</span><span>${esc(String(a.what||'').slice(0,60))}</span></div>`;
      }).join('')
    : `<div class="line"><span class="t">${now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false})}</span><span>System ready — awaiting activity</span></div>`;

  // Diagnostics
  const diag = `
    <div class="diag">
      <div class="d"><div class="n">${totalHead}</div><div class="l">Total Head</div></div>
      <div class="d"><div class="n">${activeSites}</div><div class="l">Active Sites</div></div>
      <div class="d"><div class="n">${Math.round(tsHrs)}</div><div class="l">Hours Logged</div></div>
    </div>`;

  const orgLabel = (typeof TENANT !== 'undefined' && TENANT.ORG_NAME) ? TENANT.ORG_NAME : 'Workforce';

  // Filter chip bar
  const chips = [];
  if (F.group) chips.push({ type:'Group', val:F.group,                           clear:`trialToggleGroup('${F.group}')` });
  if (F.site)  chips.push({ type:'Site',  val:F.site,                            clear:`trialToggleSite('${String(F.site).replace(/'/g,"\\'")}')` });
  if (F.day)   chips.push({ type:'Day',   val:dayLabels[wd.indexOf(F.day)] || F.day, clear:`trialToggleDay('${F.day}')` });
  const filterBarHtml = chips.length ? `
    <div class="filter-bar">
      <span class="fb-label">Active Filters</span>
      ${chips.map(c => `
        <button class="filter-chip" onclick="${c.clear}">
          <span class="ft">${c.type}</span>
          <span>${esc(String(c.val))}</span>
          <span class="x">×</span>
        </button>`).join('')}
      <button class="clear-all" onclick="trialClearFilters()">Clear All</button>
    </div>` : '';

  root.innerHTML = `
    <div class="trial-inner">

      <div class="trial-hdr">
        <div class="trial-brand">
          <div class="trial-logo">${(typeof TENANT !== 'undefined' && TENANT.ORG_SLUG === 'sks') ? 'SKS' : 'EQ'}</div>
          <div>
            <div class="trial-title">${(typeof TENANT !== 'undefined' && TENANT.ORG_SLUG === 'sks') ? 'SKS Technologies' : 'Workforce Intelligence'}</div>
            <div class="trial-sub">${esc(orgLabel)} · Labour Forecast</div>
          </div>
        </div>
        <div class="trial-status">
          <span class="trial-pill ochre"><span class="pdot"></span><strong>${curActive}</strong> <span class="lbl">Active</span></span>
          <span class="trial-pill gold"><span class="pdot"></span><strong>${onLeave}</strong> <span class="lbl">On Leave</span></span>
          <span class="trial-pill olive"><span class="pdot"></span><strong>${totalHead}</strong> <span class="lbl">Total</span></span>
        </div>
      </div>

      <div class="trial-meta">
        <span>${tsStr}</span>
        <span class="sep"></span>
        <span>Week of ${esc(week || '—')}</span>
        <span class="sep"></span>
        <span class="live">Live</span>
      </div>

      ${filterBarHtml}

      <div class="trial-grid-top">${kpiHtml}</div>

      <div class="trial-grid-main">
        <div class="trial-card site-card">
          <h3>Site Allocation · This Week</h3>
          <div class="sites-scan">${siteRows}</div>
        </div>

        <div class="right-col">
          <div class="trial-card">
            <h3>Headcount Trend · 6 Weeks</h3>
            ${sparkSVG}
          </div>

          <div class="trial-card">
            <h3>Workforce Composition</h3>
            <div class="donut-wrap">
              ${donutSVG}
              <div class="donut-legend">${donutLegend}</div>
            </div>
          </div>

          <div class="trial-card">
            <h3>Daily Utilisation</h3>
            <div class="heatmap">${heatHdr}</div>
            <div class="heatmap">${heatCells}</div>
            ${diag}
          </div>
        </div>
      </div>

      <div class="trial-card" style="margin-top:20px">
        <h3>Recent Activity</h3>
        <div class="feed feed-wide">${feedHtml}</div>
      </div>

      <div class="trial-footer">
        <div class="brand-line">SKS Technologies · Labour Intelligence</div>
        <div class="brand-sub">Live workforce view · updated in real time</div>
      </div>

    </div>
  `;

  // Count-up animation on KPIs
  root.querySelectorAll('.kpi-num').forEach(el => {
    const target = +el.dataset.count || 0;
    const dur = 900;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}
