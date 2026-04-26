/*! Copyright (c) 2026 CDC Solutions Pty Ltd ATF Hexican Holdings Trust. All rights reserved. Proprietary & confidential — see LICENSE.md. Unauthorised copying, distribution, or use is prohibited. */
// ─────────────────────────────────────────────────────────────
// Supabase Edge Function: ts-reminder
// EQ Solves — Field  v3.4.18
// ─────────────────────────────────────────────────────────────
//
// Sends a one-off "please complete your timesheet" email to a single
// person for a specific week. Invoked from the Timesheets page when
// a supervisor clicks the per-row "Send reminder" button.
//
// Request (POST):
//   {
//     orgSlug:     string,          // required — tenant slug
//     personName:  string,          // required — exact match on people.name
//     week:        string,          // required — 'dd.MM.yy' Monday key
//     sentBy?:     string,          // supervisor display name (audit)
//     dryRun?:     boolean,         // true → render HTML, don't send
//     appOrigin?:  string,          // override — defaults to env APP_ORIGIN
//   }
//
// Rate limit:
//   One reminder per (org, personName, week) per REMIND_COOLDOWN_HOURS
//   (default 12). Enforced by reading ts_reminders_sent before sending.
//   Returns { ok: true, rateLimited: true, lastSentAt } without sending
//   if a recent reminder exists.
//
// Transport: same options as supervisor-digest
//   DIGEST_TRANSPORT = "resend"  → RESEND_API_KEY + DIGEST_FROM_EMAIL
//   DIGEST_TRANSPORT = "netlify" → NETLIFY_SEND_EMAIL_URL + EQ_DIGEST_SECRET
//
// Auth: verify_jwt = true. The app front-end sends the supabase anon
// JWT; service-role access inside the function uses the env key.
// ─────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const DEFAULT_COOLDOWN_HOURS = 12;

// ── Types ────────────────────────────────────────────────────
type Org = { id: string; slug: string; name: string | null };
type Person = { id: string; org_id: string; name: string; email: string | null; "group": string | null };
type TimesheetRow = {
  org_id: string; name: string; week: string;
  mon_job: string | null; tue_job: string | null; wed_job: string | null;
  thu_job: string | null; fri_job: string | null;
  mon_hrs: number | null; tue_hrs: number | null; wed_hrs: number | null;
  thu_hrs: number | null; fri_hrs: number | null;
};

// ── Helpers ──────────────────────────────────────────────────
function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }
function mondayDate(key: string): Date {
  const [dd, mm, yy] = key.split(".").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(2000 + yy, mm - 1, dd));
}
function fmtPrettyWeek(weekKey: string): string {
  try {
    const mon = mondayDate(weekKey);
    const sun = new Date(mon); sun.setUTCDate(sun.getUTCDate() + 6);
    const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${mon.getUTCDate()} ${mons[mon.getUTCMonth()]} → ${sun.getUTCDate()} ${mons[sun.getUTCMonth()]}`;
  } catch { return weekKey; }
}
function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Completeness summary for the reminder email body ─────────
function summariseMissing(ts: TimesheetRow | null): { missingDays: string[]; partialDays: string[] } {
  const days = [
    ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"],
    ["thu", "Thursday"], ["fri", "Friday"],
  ] as const;
  const missingDays: string[] = [];
  const partialDays: string[] = [];
  for (const [d, label] of days) {
    const job = ts ? (ts as any)[d + "_job"] : null;
    const hrs = ts ? (ts as any)[d + "_hrs"] : null;
    if (!job) missingDays.push(label);
    else if (!hrs || hrs <= 0) partialDays.push(label);
  }
  return { missingDays, partialDays };
}

// ── Email body ───────────────────────────────────────────────
function buildReminderHtml(params: {
  orgName: string;
  personName: string;
  weekKey: string;
  missingDays: string[];
  partialDays: string[];
  appOrigin: string;
  sentBy?: string;
}): string {
  const { orgName, personName, weekKey, missingDays, partialDays, appOrigin, sentBy } = params;
  const pretty = fmtPrettyWeek(weekKey);

  const missingHtml = missingDays.length
    ? `<li style="padding:3px 0"><strong>${missingDays.join(", ")}</strong> — no entry yet</li>`
    : "";
  const partialHtml = partialDays.length
    ? `<li style="padding:3px 0"><strong>${partialDays.join(", ")}</strong> — job entered but hours missing</li>`
    : "";
  const nothing = !missingDays.length && !partialDays.length;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#F9FAFB">
    <div style="background:#1F335C;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="color:white;font-weight:700;font-size:18px">Timesheet reminder</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:2px">${escHtml(orgName)}</div>
    </div>
    <div style="background:white;padding:22px 24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
      <p style="margin:0 0 10px;font-size:14px;color:#1F2937">Hi ${escHtml(personName.split(" ")[0] || personName)},</p>
      <p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.5">
        Quick nudge — your timesheet for the week of <strong>${escHtml(pretty)}</strong> isn't complete yet.
      </p>
      ${nothing ? "" : `
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 14px;margin:14px 0">
        <div style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Still needed</div>
        <ul style="margin:0;padding-left:18px;color:#78350F;font-size:13px">
          ${missingHtml}${partialHtml}
        </ul>
      </div>`}
      <div style="margin:16px 0 4px">
        <a href="${escHtml(appOrigin)}" style="display:inline-block;background:#1F335C;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">Complete timesheet →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#6B7280;line-height:1.5">
        Thanks — this helps payroll run on time.${sentBy ? ` Sent by ${escHtml(sentBy)}.` : ""}
      </p>
    </div>
    <div style="padding:10px 4px 4px;font-size:11px;color:#9CA3AF;text-align:center">
      EQ Solves · <a href="${escHtml(appOrigin)}" style="color:#6B7280">${escHtml(appOrigin)}</a>
    </div>
  </div>`;
}

// ── Email transport (mirrors supervisor-digest) ──────────────
async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; detail: string; transport: string }> {
  const transport = (Deno.env.get("DIGEST_TRANSPORT") || "resend").toLowerCase();

  if (transport === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DIGEST_FROM_EMAIL") || "EQ Field <noreply@eq.solutions>";
    if (!key) return { ok: false, detail: "RESEND_API_KEY not set", transport };
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    const body = await resp.text();
    return { ok: resp.ok, detail: body.slice(0, 500), transport };
  }

  if (transport === "netlify") {
    const url = Deno.env.get("NETLIFY_SEND_EMAIL_URL");
    const secret = Deno.env.get("EQ_DIGEST_SECRET");
    if (!url || !secret) return { ok: false, detail: "NETLIFY_SEND_EMAIL_URL or EQ_DIGEST_SECRET not set", transport };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-eq-digest-secret": secret },
      body: JSON.stringify({ to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    const body = await resp.text();
    return { ok: resp.ok, detail: body.slice(0, 500), transport };
  }
  return { ok: false, detail: `unknown DIGEST_TRANSPORT: ${transport}`, transport };
}

// ── Handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "missing supabase env" }), { status: 500, headers: cors });
    }
    const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let payload: any = {};
    try { payload = await req.json(); } catch { /* noop */ }

    const orgSlug    = String(payload.orgSlug || "").trim();
    const personName = String(payload.personName || "").trim();
    const week       = String(payload.week || "").trim();
    const sentBy     = payload.sentBy ? String(payload.sentBy).trim() : null;
    const dryRun     = !!payload.dryRun;
    const appOrigin  = String(payload.appOrigin || Deno.env.get("APP_ORIGIN") || "https://eq-solves-field.netlify.app");

    if (!orgSlug || !personName || !week) {
      return new Response(JSON.stringify({ ok: false, error: "orgSlug, personName and week are required" }), { status: 400, headers: cors });
    }
    if (!sentBy) {
      return new Response(JSON.stringify({ ok: false, error: "sentBy is required — only managers may send reminders" }), { status: 400, headers: cors });
    }

    // Resolve org
    const orgRes = await sb.from("organisations").select("id,slug,name").eq("slug", orgSlug).maybeSingle();
    if (orgRes.error || !orgRes.data) {
      return new Response(JSON.stringify({ ok: false, error: `org not found: ${orgSlug}` }), { status: 404, headers: cors });
    }
    const org = orgRes.data as Org;

    // Authorise caller — must be a named manager of the target org.
    // (Apps use a shared anon JWT, so the DB has no per-user identity.
    //  The sentBy name is the app's trust anchor. We reject unknown names.)
    const mgrRes = await sb.from("managers").select("id,name")
      .eq("org_id", org.id).eq("name", sentBy).limit(1);
    if (mgrRes.error) {
      return new Response(JSON.stringify({ ok: false, error: mgrRes.error.message }), { status: 500, headers: cors });
    }
    if (!mgrRes.data || !mgrRes.data.length) {
      return new Response(JSON.stringify({ ok: false, error: `caller '${sentBy}' is not a manager of ${orgSlug}` }), { status: 403, headers: cors });
    }

    // Resolve person + email
    const personRes = await sb.from("people").select("id,org_id,name,email,group")
      .eq("org_id", org.id).eq("name", personName).is("deleted_at", null).maybeSingle();
    if (personRes.error) {
      return new Response(JSON.stringify({ ok: false, error: personRes.error.message }), { status: 500, headers: cors });
    }
    const person = personRes.data as Person | null;
    if (!person) {
      return new Response(JSON.stringify({ ok: false, error: `person not found: ${personName}` }), { status: 404, headers: cors });
    }
    if (!person.email) {
      return new Response(JSON.stringify({ ok: false, error: `no email on file for ${personName}` }), { status: 422, headers: cors });
    }

    // Pull current timesheet row for the email body summary. We do this
    // before the claim so that a dry-run can short-circuit without
    // reserving a slot, but a real send still lands the claim atomically.
    const tsRes = await sb.from("timesheets")
      .select("org_id,name,week,mon_job,tue_job,wed_job,thu_job,fri_job,mon_hrs,tue_hrs,wed_hrs,thu_hrs,fri_hrs")
      .eq("org_id", org.id).eq("name", personName).eq("week", week).maybeSingle();
    const ts = (tsRes.data || null) as TimesheetRow | null;
    const { missingDays, partialDays } = summariseMissing(ts);

    const html = buildReminderHtml({
      orgName: org.name || org.slug,
      personName, weekKey: week,
      missingDays, partialDays,
      appOrigin, sentBy: sentBy || undefined,
    });
    const subject = `Timesheet reminder · week of ${fmtPrettyWeek(week)}`;

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, preview: { subject, html, missingDays, partialDays } }, null, 2),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Atomic claim (TOCTOU-safe): ts_reminder_claim acquires a
    // pg_advisory_xact_lock on hash(org|person|week), checks both the
    // cooldown window and any in-flight "pending" row, and if clear,
    // INSERTs a pending row and returns its id. Concurrent callers
    // block on the lock and then observe the committed pending row,
    // so only one sender proceeds per cooldown window.
    const cooldownHours = parseFloat(Deno.env.get("REMIND_COOLDOWN_HOURS") || "") || DEFAULT_COOLDOWN_HOURS;
    const claimRes = await sb.rpc("ts_reminder_claim", {
      _org_id: org.id,
      _person_name: personName,
      _person_email: person.email,
      _week: week,
      _sent_by: sentBy,
      _cooldown_hours: cooldownHours,
    });
    if (claimRes.error) {
      return new Response(JSON.stringify({ ok: false, error: claimRes.error.message }), { status: 500, headers: cors });
    }
    const claim = Array.isArray(claimRes.data) ? claimRes.data[0] : claimRes.data;
    if (!claim) {
      return new Response(JSON.stringify({ ok: false, error: "claim rpc returned no rows" }), { status: 500, headers: cors });
    }
    if (claim.rate_limited) {
      return new Response(JSON.stringify({
        ok: true, rateLimited: true, lastSentAt: claim.last_sent_at, cooldownHours,
      }), { status: 200, headers: cors });
    }
    const claimId: string = claim.claim_id;

    // Send. Keep going on failure — we still need to update the pending row.
    const send = await sendEmail({ to: person.email, subject, html });

    // Flip the pending row to its final state. The cooldown filter checks
    // ok=true, so a failed send leaves the row as ok=false/transport=resend
    // (not 'pending') and another attempt is allowed immediately.
    const updRes = await sb.from("ts_reminders_sent").update({
      transport: send.transport,
      ok: send.ok,
      detail: send.detail.slice(0, 500),
    }).eq("id", claimId);
    if (updRes.error) {
      // Log-only; don't mask the send result to the caller.
      console.error("ts-reminder: failed to update claim row", claimId, updRes.error.message);
    }

    if (!send.ok) {
      return new Response(JSON.stringify({ ok: false, error: "send failed", detail: send.detail, transport: send.transport }),
        { status: 502, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true, to: person.email, transport: send.transport }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = (e instanceof Error) ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: cors });
  }
});