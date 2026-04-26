/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// Supabase Edge Function: supervisor-digest
// EQ Solves — Field  v3.4.9
// ─────────────────────────────────────────────────────────────
//
// Sends a Friday 12:00 AEST digest email to each opted-in supervisor
// in managers. Per supervisor the digest contains:
//
//   1. Approved leave overlapping NEXT week (Mon → Sun)
//   2. Pending leave requests where approver_name matches this supervisor
//   3. People with no roster entry for NEXT week (unrostered)
//   4. Timesheet completion rate for THIS week
//      (numerator = rostered-day timesheet submissions with hrs > 0,
//       denominator = rostered days in schedule, non-leave codes)
//
// Invocation:
//   - pg_cron: every Friday 02:00 UTC (= 12:00 AEST / 13:00 AEDT summer)
//     See migrations/2026-04-19_digest_cron_schedule.sql
//   - Manual: POST { dryRun?: boolean, orgSlug?: string } — dryRun returns
//     the rendered HTML without sending; orgSlug restricts to one org.
//
// Email delivery:
//   Two transport options, picked via env:
//     A) DIGEST_TRANSPORT = "resend"   → requires RESEND_API_KEY
//                                        + DIGEST_FROM_EMAIL
//     B) DIGEST_TRANSPORT = "netlify"  → requires NETLIFY_SEND_EMAIL_URL
//                                        + EQ_DIGEST_SECRET  (shared secret
//                                        the Netlify send-email function
//                                        must accept on x-eq-digest-secret)
//
// Service-role access: uses SUPABASE_SERVICE_ROLE_KEY so the function
// can read across org_id tenancy without needing a user JWT.
// ─────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ── Types (lightweight, not exhaustive) ──────────────────────
type Manager = {
  id: string; org_id: string; name: string; email: string | null;
  digest_opt_in: boolean; deleted_at: string | null;
};
type Person = {
  id: string; org_id: string; name: string; email: string | null;
  group: string | null; deleted_at: string | null;
};
type LeaveReq = {
  id: string; org_id: string; requester_name: string; approver_name: string;
  leave_type: string | null; date_start: string | null; date_end: string | null;
  status: string | null; note: string | null; archived: boolean | null;
  created_at: string | null;
};
type ScheduleRow = {
  org_id: string; name: string; week: string;
  mon: string | null; tue: string | null; wed: string | null;
  thu: string | null; fri: string | null; sat: string | null; sun: string | null;
};
type TimesheetRow = {
  org_id: string; name: string; week: string;
  mon: number | null; tue: number | null; wed: number | null;
  thu: number | null; fri: number | null; sat: number | null; sun: number | null;
};

// ── Date helpers ──────────────────────────────────────────────
// The schedule/timesheets tables store week as text 'dd.MM.yy' (Monday).
function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }
function mondayKey(d: Date): string {
  // Clone to UTC midnight so DST doesn't shift us a day.
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay(); // 0=Sun..6=Sat
  const delta = (dow + 6) % 7; // days back to Monday
  utc.setUTCDate(utc.getUTCDate() - delta);
  return `${pad2(utc.getUTCDate())}.${pad2(utc.getUTCMonth() + 1)}.${String(utc.getUTCFullYear()).slice(-2)}`;
}
function mondayKeyPlusWeeks(d: Date, weeks: number): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() + 7 * weeks);
  return mondayKey(u);
}
function mondayDate(key: string): Date {
  // '20.04.26' → Date for 2026-04-20 UTC midnight
  const [dd, mm, yy] = key.split(".").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(2000 + yy, mm - 1, dd));
}
function fmtISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function fmtPrettyDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${mons[d.getUTCMonth()]}`;
}

// ── Leave classification ─────────────────────────────────────
const LEAVE_TERMS = new Set([
  "A/L", "AL", "LVE", "LEAVE", "U/L", "UL", "RDO", "PH",
  "SICK", "JURY", "OFF", "DAY OFF", "PENDING",
]);
function isLeaveCode(v: string | null | undefined): boolean {
  if (!v) return false;
  return LEAVE_TERMS.has(String(v).trim().toUpperCase());
}
function isRosteredCell(v: string | null | undefined): boolean {
  // Rostered = non-empty, not leave, not education (TAFE/TRAINING).
  if (!v) return false;
  const u = String(v).trim().toUpperCase();
  if (!u) return false;
  if (LEAVE_TERMS.has(u)) return false;
  if (u === "TAFE" || u === "TRAINING") return false;
  return true;
}

// ── HTML helpers ──────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((res) => setTimeout(res, ms)); }
function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Email transport ──────────────────────────────────────────
async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; detail: string }> {
  const transport = (Deno.env.get("DIGEST_TRANSPORT") || "resend").toLowerCase();

  if (transport === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DIGEST_FROM_EMAIL") || "EQ Field <noreply@eq.solutions>";
    if (!key) return { ok: false, detail: "RESEND_API_KEY not set" };
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    const body = await resp.text();
    return { ok: resp.ok, detail: body.slice(0, 500) };
  }

  if (transport === "netlify") {
    const url = Deno.env.get("NETLIFY_SEND_EMAIL_URL");
    const secret = Deno.env.get("EQ_DIGEST_SECRET");
    if (!url || !secret) return { ok: false, detail: "NETLIFY_SEND_EMAIL_URL or EQ_DIGEST_SECRET not set" };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-eq-digest-secret": secret,
      },
      body: JSON.stringify({ to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    const body = await resp.text();
    return { ok: resp.ok, detail: body.slice(0, 500) };
  }

  return { ok: false, detail: `unknown DIGEST_TRANSPORT: ${transport}` };
}

// ── Digest composition ───────────────────────────────────────
function buildDigestHtml(params: {
  orgName: string;
  supervisorName: string;
  weekKeyNext: string;       // 'dd.MM.yy' Monday of next week
  weekKeyThis: string;       // 'dd.MM.yy' Monday of current week
  leaveThisWeek: LeaveReq[]; // approved + overlapping next week
  pendingForMe: LeaveReq[];  // pending where approver_name matches me
  unrostered: string[];      // names
  // v3.4.17: missing list gained per-name day counts so the digest
  // row can render "Alex Mitchell — 3 days". Legacy `missing: string[]`
  // is still accepted and is treated as day-count unknown.
  tsCompletion: { submitted: number; expected: number; missing: Array<string | { name: string; days: number }> };
  appOrigin: string;
}): string {
  const { orgName, supervisorName, weekKeyNext, leaveThisWeek, pendingForMe, unrostered, tsCompletion, appOrigin } = params;

  const nextMondayISO = fmtISODate(mondayDate(weekKeyNext));
  const nextSundayDate = new Date(mondayDate(weekKeyNext));
  nextSundayDate.setUTCDate(nextSundayDate.getUTCDate() + 6);
  const nextSundayISO = fmtISODate(nextSundayDate);

  const leaveTableRows = leaveThisWeek.length
    ? leaveThisWeek.map((r) => `
        <tr>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${escHtml(r.requester_name)}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${escHtml(r.leave_type || "—")}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${fmtPrettyDate(r.date_start)} → ${fmtPrettyDate(r.date_end)}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB;color:#6B7280">${escHtml(r.approver_name || "—")}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px 10px;color:#6B7280;border-top:1px solid #E5E7EB;font-style:italic">Nobody approved off next week. 🎉</td></tr>`;

  const pendingRows = pendingForMe.length
    ? pendingForMe.map((r) => `
        <tr>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${escHtml(r.requester_name)}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${escHtml(r.leave_type || "—")}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB">${fmtPrettyDate(r.date_start)} → ${fmtPrettyDate(r.date_end)}</td>
          <td style="padding:8px 10px;border-top:1px solid #E5E7EB;color:#6B7280">${escHtml((r.note || "").slice(0, 80))}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px 10px;color:#6B7280;border-top:1px solid #E5E7EB;font-style:italic">No pending requests waiting on you.</td></tr>`;

  const unrosteredHtml = unrostered.length
    ? `<ul style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:13px">${unrostered.map((n) => `<li style="padding:2px 0">${escHtml(n)}</li>`).join("")}</ul>`
    : `<p style="margin:8px 0 0;color:#6B7280;font-size:13px;font-style:italic">Everyone is on the roster for next week.</p>`;

  const completionPct = tsCompletion.expected > 0
    ? Math.round((tsCompletion.submitted / tsCompletion.expected) * 100)
    : null;
  const completionBar = completionPct === null ? "" : `
    <div style="margin-top:8px;background:#E5E7EB;border-radius:4px;height:8px;overflow:hidden">
      <div style="width:${completionPct}%;background:${completionPct >= 90 ? "#10B981" : completionPct >= 70 ? "#F59E0B" : "#EF4444"};height:8px"></div>
    </div>`;
  // v3.4.17: richer row — "Name · 3 days missing" when count is available.
  const missingListHtml = tsCompletion.missing.length
    ? `<p style="margin:10px 0 0;font-size:12px;color:#6B7280">Still to submit:</p>
       <ul style="margin:4px 0 0;padding-left:20px;color:#374151;font-size:13px">${tsCompletion.missing.map((m) => {
         const name = typeof m === "string" ? m : m.name;
         const days = typeof m === "string" ? null : m.days;
         const suffix = days ? ` <span style="color:#B45309;font-weight:600">· ${days} day${days !== 1 ? "s" : ""} missing</span>` : "";
         return `<li style="padding:2px 0">${escHtml(name)}${suffix}</li>`;
       }).join("")}</ul>`
    : "";

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F9FAFB">
    <div style="background:#1F335C;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="color:white;font-weight:700;font-size:18px">Weekly Supervisor Digest</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:2px">${escHtml(orgName)} · for ${escHtml(supervisorName)}</div>
      <div style="color:rgba(255,255,255,.55);font-size:12px;margin-top:6px">Week of ${fmtPrettyDate(nextMondayISO)} → ${fmtPrettyDate(nextSundayISO)}</div>
    </div>

    <div style="background:white;padding:20px 24px;border:1px solid #E5E7EB;border-top:none">
      <h3 style="margin:0 0 6px;font-size:15px;color:#1F335C">1. On leave next week</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
        <thead>
          <tr style="text-align:left;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
            <th style="padding:6px 10px">Who</th><th style="padding:6px 10px">Type</th><th style="padding:6px 10px">Dates</th><th style="padding:6px 10px">Approver</th>
          </tr>
        </thead>
        <tbody>${leaveTableRows}</tbody>
      </table>
    </div>

    <div style="background:white;padding:20px 24px;border:1px solid #E5E7EB;border-top:none">
      <h3 style="margin:0 0 6px;font-size:15px;color:#1F335C">2. Pending your approval <span style="color:#D97706">${pendingForMe.length ? `(${pendingForMe.length})` : ""}</span></h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
        <thead>
          <tr style="text-align:left;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
            <th style="padding:6px 10px">Who</th><th style="padding:6px 10px">Type</th><th style="padding:6px 10px">Dates</th><th style="padding:6px 10px">Note</th>
          </tr>
        </thead>
        <tbody>${pendingRows}</tbody>
      </table>
      ${pendingForMe.length ? `<div style="margin-top:14px"><a href="${escHtml(appOrigin)}" style="display:inline-block;background:#1F335C;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Review in App →</a></div>` : ""}
    </div>

    <div style="background:white;padding:20px 24px;border:1px solid #E5E7EB;border-top:none">
      <h3 style="margin:0 0 6px;font-size:15px;color:#1F335C">3. Unrostered next week <span style="color:${unrostered.length ? "#D97706" : "#10B981"}">${unrostered.length ? `(${unrostered.length})` : ""}</span></h3>
      ${unrosteredHtml}
    </div>

    <div style="background:white;padding:20px 24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
      <h3 style="margin:0 0 6px;font-size:15px;color:#1F335C">4. Timesheet completion this week</h3>
      ${completionPct === null
        ? `<p style="margin:8px 0 0;color:#6B7280;font-size:13px;font-style:italic">No rostered days this week — nothing to measure.</p>`
        : `<div style="font-size:13px;color:#374151">
             <strong>${completionPct}%</strong> submitted
             <span style="color:#6B7280">(${tsCompletion.submitted} of ${tsCompletion.expected} rostered days)</span>
           </div>${completionBar}${missingListHtml}`}
    </div>

    <div style="padding:14px 4px 4px;font-size:11px;color:#9CA3AF;text-align:center">
      Sent every Friday at 12:00 AEST · <a href="${escHtml(appOrigin)}" style="color:#6B7280">${escHtml(appOrigin)}</a><br>
      Don't want this? Toggle off on the Supervision page or ask your ops team to update your <code>digest_opt_in</code> flag.
    </div>
  </div>`;
}

// ── Main per-org run ─────────────────────────────────────────
async function runForOrg(sb: SupabaseClient, orgId: string, orgName: string, opts: { dryRun: boolean; appOrigin: string }) {
  const now = new Date();
  const weekKeyThis = mondayKey(now);
  const weekKeyNext = mondayKeyPlusWeeks(now, 1);
  const nextMondayISO = fmtISODate(mondayDate(weekKeyNext));
  const nextSundayDate = new Date(mondayDate(weekKeyNext));
  nextSundayDate.setUTCDate(nextSundayDate.getUTCDate() + 6);
  const nextSundayISO = fmtISODate(nextSundayDate);

  // Fetch reference data.
  const [mgrsRes, peopleRes, leaveOverlapRes, pendingRes, schedThisRes, schedNextRes, tsThisRes] = await Promise.all([
    sb.from("managers").select("id,org_id,name,email,digest_opt_in,deleted_at")
      .eq("org_id", orgId).eq("digest_opt_in", true).is("deleted_at", null).not("email", "is", null),
    sb.from("people").select("id,org_id,name,email,group,deleted_at")
      .eq("org_id", orgId).is("deleted_at", null),
    // Approved leave that overlaps next week (start <= nextSunday AND end >= nextMonday)
    sb.from("leave_requests").select("id,org_id,requester_name,approver_name,leave_type,date_start,date_end,status,note,archived,created_at")
      .eq("org_id", orgId).eq("status", "Approved").or("archived.is.null,archived.eq.false")
      .lte("date_start", nextSundayISO).gte("date_end", nextMondayISO),
    // Pending leave requests — retrieved once, filtered per approver later.
    sb.from("leave_requests").select("id,org_id,requester_name,approver_name,leave_type,date_start,date_end,status,note,archived,created_at")
      .eq("org_id", orgId).eq("status", "Pending").or("archived.is.null,archived.eq.false"),
    sb.from("schedule").select("org_id,name,week,mon,tue,wed,thu,fri,sat,sun")
      .eq("org_id", orgId).eq("week", weekKeyThis),
    sb.from("schedule").select("org_id,name,week,mon,tue,wed,thu,fri,sat,sun")
      .eq("org_id", orgId).eq("week", weekKeyNext),
    sb.from("timesheets").select("org_id,name,week,mon,tue,wed,thu,fri,sat,sun")
      .eq("org_id", orgId).eq("week", weekKeyThis),
  ]);

  const errs = [mgrsRes, peopleRes, leaveOverlapRes, pendingRes, schedThisRes, schedNextRes, tsThisRes]
    .filter((r) => r.error).map((r) => r.error!.message);
  if (errs.length) return { orgId, sent: 0, errors: errs };

  const managers = (mgrsRes.data || []) as Manager[];
  const people = (peopleRes.data || []) as Person[];
  const leaveOverlap = (leaveOverlapRes.data || []) as LeaveReq[];
  const pendingAll = (pendingRes.data || []) as LeaveReq[];
  const schedThis = (schedThisRes.data || []) as ScheduleRow[];
  const schedNext = (schedNextRes.data || []) as ScheduleRow[];
  const tsThis = (tsThisRes.data || []) as TimesheetRow[];

  // Unrostered = active people whose name has no schedule row for next week,
  // OR has a row but every weekday cell is blank/leave (= not actually rostered).
  const rosteredNames = new Set<string>();
  for (const r of schedNext) {
    if (isRosteredCell(r.mon) || isRosteredCell(r.tue) || isRosteredCell(r.wed) ||
        isRosteredCell(r.thu) || isRosteredCell(r.fri) || isRosteredCell(r.sat) || isRosteredCell(r.sun)) {
      rosteredNames.add(r.name);
    }
  }
  const unrostered = people.map((p) => p.name).filter((n) => !rosteredNames.has(n)).sort();

  // Timesheet completion THIS week.
  const dayKeys: Array<keyof ScheduleRow> = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const tsByName: Record<string, TimesheetRow> = {};
  for (const t of tsThis) tsByName[t.name] = t;
  let expected = 0;
  let submitted = 0;
  const missingByName = new Map<string, number>();
  for (const r of schedThis) {
    for (const dk of dayKeys) {
      if (isRosteredCell(r[dk] as string | null)) {
        expected += 1;
        const ts = tsByName[r.name];
        const hrs = ts ? (ts[dk as "mon"] as number | null) : null;
        if (hrs && hrs > 0) submitted += 1;
        else missingByName.set(r.name, (missingByName.get(r.name) || 0) + 1);
      }
    }
  }
  // v3.4.17: preserve per-name missing-day counts so the digest email
  // can render "Alex Mitchell · 3 days missing" instead of just the name.
  const missing = Array.from(missingByName.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, days]) => ({ name, days }));

  // Per-supervisor dispatch.
  let sent = 0;
  const errors: string[] = [];
  // v3.4.9.4: stay under Resend's 2/sec free-tier limit. Configurable.
  const sendIntervalMs = Math.max(0, parseInt(Deno.env.get("DIGEST_SEND_INTERVAL_MS") || "600", 10));
  let firstLiveSend = true;
  for (const mgr of managers) {
    if (!mgr.email) continue;
    const pendingForMe = pendingAll.filter((r) => r.approver_name === mgr.name)
      .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || ""));

    const html = buildDigestHtml({
      orgName,
      supervisorName: mgr.name,
      weekKeyNext,
      weekKeyThis,
      leaveThisWeek: leaveOverlap.slice().sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "")),
      pendingForMe,
      unrostered,
      tsCompletion: { submitted, expected, missing },
      appOrigin: opts.appOrigin,
    });

    const subject = pendingForMe.length
      ? `Weekly digest · ${pendingForMe.length} pending for you · ${fmtPrettyDate(nextMondayISO)}`
      : `Weekly digest · week of ${fmtPrettyDate(nextMondayISO)}`;

    if (opts.dryRun) {
      sent += 1;
      continue;
    }
    // v3.4.9.4: throttle to stay under Resend's 2/sec free-tier limit.
    if (!firstLiveSend && sendIntervalMs > 0) await sleep(sendIntervalMs);
    firstLiveSend = false;
    const res = await sendEmail({ to: mgr.email, subject, html });
    if (res.ok) sent += 1;
    else errors.push(`${mgr.name} <${mgr.email}>: ${res.detail}`);
  }

  return { orgId, sent, eligibleManagers: managers.length, errors, dryRun: opts.dryRun };
}

// ── HTTP entry point ─────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "missing supabase env" }), { status: 500 });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Parse options — allow GET (cron) and POST (manual).
    let dryRun = false;
    let orgSlug: string | null = null;
    let appOrigin = Deno.env.get("APP_ORIGIN") || "https://eq-solves-field.netlify.app";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body === "object") {
          dryRun = !!body.dryRun;
          if (typeof body.orgSlug === "string") orgSlug = body.orgSlug;
          if (typeof body.appOrigin === "string") appOrigin = body.appOrigin;
        }
      } catch { /* no body is fine for cron */ }
    }

    // Resolve orgs. Each org runs independently so a bad row in one
    // doesn't block the others.
    const orgsQ = sb.from("organisations").select("id,slug,name").eq("active", true);
    if (orgSlug) orgsQ.eq("slug", orgSlug);
    const { data: orgs, error: orgsErr } = await orgsQ;
    if (orgsErr) {
      return new Response(JSON.stringify({ ok: false, error: orgsErr.message }), { status: 500 });
    }

    const results = [];
    for (const org of orgs || []) {
      try {
        const r = await runForOrg(sb, org.id, org.name || org.slug, { dryRun, appOrigin });
        results.push({ slug: org.slug, ...r });
      } catch (e) {
        const msg = (e instanceof Error) ? e.message : String(e);
        results.push({ slug: org.slug, error: msg });
      }
    }

    return new Response(JSON.stringify({ ok: true, dryRun, results }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e instanceof Error) ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
});