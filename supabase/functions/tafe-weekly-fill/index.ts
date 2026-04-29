/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// Supabase Edge Function: tafe-weekly-fill
// EQ Solves — Field  v3.4.41
// ─────────────────────────────────────────────────────────────
//
// Auto-fills "TAFE" into the upcoming week's roster for every
// apprentice with a nominated TAFE day. Same semantics as the
// manual "🎓 Apply TAFE Day" button in scripts/tafe.js but fires
// every Sunday whether or not a manager opens the app.
//
// Skips:
//   • apprentices with no nominated tafe_day
//   • days that fall inside any range in app_config.tafe_holidays
//   • cells that are already non-empty (compare-and-swap on is.null)
//
// Invocation:
//   • pg_cron — Sunday 06:00 UTC (= 16:00 AEST / 17:00 AEDT)
//     See migrations/2026-04-29_tafe_weekly_cron.sql
//   • Manual — POST { dryRun?: bool, weekKey?: 'DD.MM.YY', orgId?: uuid }
//     dryRun returns planned writes without executing.
//     weekKey overrides the auto-computed "next Monday".
//     orgId restricts to one org (default = all orgs in this project).
//
// Service-role access via SUPABASE_SERVICE_ROLE_KEY so we don't
// need a user JWT to read across tenancy.
// ─────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
import { createClient } from "@supabase/supabase-js";

type Holiday = { start: string; end: string; label?: string };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;
type DayKey = (typeof DAY_KEYS)[number];

// ── Date helpers (mirror scripts/tafe.js + supervisor-digest) ─

function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }

function mondayOfDate(d: Date): Date {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay();      // 0=Sun..6=Sat
  const delta = (dow + 6) % 7;      // days back to Monday
  utc.setUTCDate(utc.getUTCDate() - delta);
  return utc;
}

function nextMondayKey(now: Date): string {
  const m = mondayOfDate(now);
  m.setUTCDate(m.getUTCDate() + 7);
  return `${pad2(m.getUTCDate())}.${pad2(m.getUTCMonth() + 1)}.${String(m.getUTCFullYear()).slice(-2)}`;
}

function mondayDateFromKey(key: string): Date | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  const [dd, mm, yy] = parts.map((s) => parseInt(s, 10));
  if (!dd || !mm || isNaN(yy)) return null;
  return new Date(Date.UTC(2000 + yy, mm - 1, dd));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function dayInHoliday(monday: Date, dayIdx: number, holidays: Holiday[]): boolean {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + dayIdx);
  const iso = isoDate(d);
  return holidays.some((h) => iso >= h.start && iso <= h.end);
}

// ── Per-org processing ───────────────────────────────────────

async function processOrg(
  supabase: any,
  orgId: string,
  weekKey: string,
  dryRun: boolean,
) {
  const monday = mondayDateFromKey(weekKey);
  if (!monday) {
    return { org_id: orgId, error: `bad weekKey: ${weekKey}` };
  }

  // 1. Apprentices with a TAFE day
  const { data: apprentices, error: peopleErr } = await supabase
    .from("people")
    .select("id, org_id, name, group, tafe_day, deleted_at")
    .eq("org_id", orgId)
    .eq("group", "Apprentice")
    .is("deleted_at", null)
    .not("tafe_day", "is", null);
  if (peopleErr) {
    return { org_id: orgId, error: `people query: ${peopleErr.message}` };
  }
  const list = (apprentices || []) as Array<{
    id: string; name: string; tafe_day: string | null;
  }>;
  if (!list.length) {
    return {
      org_id: orgId, week: weekKey, apprentices: 0,
      filled: 0, skipped_holiday: 0, skipped_occupied: 0, errors: 0,
    };
  }

  // 2. Holiday config — strict per-org. (Comment correction v3.4.51 — earlier
  // text wrongly claimed a project-wide fallback; there isn't one in the
  // code.) Different states have different school-holiday calendars (NSW vs
  // VIC vs QLD), so cross-org fallback would risk pollinating the wrong
  // dates. If a tenant has no tafe_holidays row, holidays = [] and no days
  // are skipped — apprentices get filled even during school breaks. Tenants
  // must seed their own app_config row; see migrations/
  // 2026-04-16_tafe_day_and_holidays.sql for the NSW 2026 seed pattern.
  const { data: cfg } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "tafe_holidays")
    .eq("org_id", orgId)
    .maybeSingle();
  let holidays: Holiday[] = [];
  try {
    if (cfg && (cfg as any).value) holidays = JSON.parse((cfg as any).value) || [];
  } catch (_) { holidays = []; }

  let filled = 0;
  let skippedHoliday = 0;
  let skippedOccupied = 0;
  let errors = 0;
  const planned: Array<{ name: string; day: string; date: string }> = [];

  for (const p of list) {
    const dayKey = p.tafe_day as DayKey;
    const dayIdx = DAY_KEYS.indexOf(dayKey);
    if (dayIdx < 0) continue;

    if (dayInHoliday(monday, dayIdx, holidays)) {
      skippedHoliday++;
      continue;
    }

    if (dryRun) {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + dayIdx);
      planned.push({ name: p.name, day: dayKey, date: isoDate(d) });
      continue;
    }

    // 3. Find existing schedule row
    const { data: existing } = await supabase
      .from("schedule")
      .select("*")
      .eq("org_id", orgId)
      .eq("name", p.name)
      .eq("week", weekKey)
      .maybeSingle();

    if (existing) {
      const cur = (existing as any)[dayKey];
      if (cur && String(cur).trim()) {
        skippedOccupied++;
        continue;
      }
      // Compare-and-swap: only update if cell is still null
      const patch: any = {}; patch[dayKey] = "TAFE";
      const { data: updated, error: upErr } = await supabase
        .from("schedule")
        .update(patch)
        .eq("id", (existing as any).id)
        .is(dayKey, null)
        .select();
      if (upErr) { errors++; continue; }
      if (!updated || !updated.length) {
        // Lost the CAS — someone wrote between SELECT and UPDATE
        skippedOccupied++;
        continue;
      }
      filled++;
    } else {
      // No row yet — INSERT a new one with the TAFE cell filled
      const row: any = {
        org_id: orgId, name: p.name, week: weekKey,
        mon: null, tue: null, wed: null, thu: null,
        fri: null, sat: null, sun: null,
      };
      row[dayKey] = "TAFE";
      const { error: insErr } = await supabase.from("schedule").insert(row);
      if (insErr) {
        // Race: another writer beat us. Re-fetch and try the update path once.
        const { data: latest } = await supabase
          .from("schedule").select("*")
          .eq("org_id", orgId).eq("name", p.name).eq("week", weekKey)
          .maybeSingle();
        if (latest && !((latest as any)[dayKey])) {
          const patch: any = {}; patch[dayKey] = "TAFE";
          const { data: u2 } = await supabase
            .from("schedule").update(patch)
            .eq("id", (latest as any).id).is(dayKey, null).select();
          if (u2 && u2.length) { filled++; continue; }
        }
        errors++; continue;
      }
      filled++;
    }
  }

  // 4. Audit log entry (only when something actually happened)
  if (!dryRun && (filled || skippedHoliday || skippedOccupied || errors)) {
    const detail =
      `${filled} filled, ${skippedHoliday} skipped (holiday), ` +
      `${skippedOccupied} skipped (occupied), ${errors} errors`;
    await supabase.from("audit_log").insert({
      org_id: orgId,
      manager_name: "TAFE Auto-Fill",
      action: `Auto-filled TAFE for week ${weekKey} — ${detail}`,
      category: "TAFE",
      detail: null,
      week: weekKey,
    });
  }

  return {
    org_id: orgId,
    week: weekKey,
    apprentices: list.length,
    filled,
    skipped_holiday: skippedHoliday,
    skipped_occupied: skippedOccupied,
    errors,
    ...(dryRun ? { planned } : {}),
  };
}

// ── HTTP entry ───────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const dryRun = body.dryRun === true;
  const overrideWeek: string | null = typeof body.weekKey === "string" ? body.weekKey : null;
  const overrideOrg: string | null = typeof body.orgId === "string" ? body.orgId : null;

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SB_URL || !SVC_KEY) {
    return new Response(
      JSON.stringify({ error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const supabase = createClient(SB_URL, SVC_KEY);

  const weekKey = overrideWeek || nextMondayKey(new Date());

  // Resolve target orgs (one per Supabase project usually, but loop in case of multi-tenant projects)
  let orgIds: string[];
  if (overrideOrg) {
    orgIds = [overrideOrg];
  } else {
    const { data: orgs, error: orgErr } = await supabase
      .from("organisations")
      .select("id");
    if (orgErr) {
      return new Response(
        JSON.stringify({ error: `organisations query: ${orgErr.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    orgIds = ((orgs as Array<{ id: string }>) || []).map((o) => o.id);
  }

  const results: any[] = [];
  for (const orgId of orgIds) {
    try {
      results.push(await processOrg(supabase, orgId, weekKey, dryRun));
    } catch (e: any) {
      results.push({ org_id: orgId, error: String(e?.message || e) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, week: weekKey, dryRun, results }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
