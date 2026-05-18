// ─────────────────────────────────────────────────────────────
// netlify/functions/verify-pin.js
// PIN verification, session token generation, remember-me tokens.
// Env vars required:
//   EQ_SECRET_SALT   — HMAC signing key
//   AUDIT_SB_URL     — Supabase REST URL for audit logging
//   AUDIT_SB_KEY     — Supabase publishable key for audit logging
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

// ── Config from env vars (no fallbacks — fail explicitly) ────
const SECRET_SALT = process.env.EQ_SECRET_SALT;
const SB_URL      = process.env.AUDIT_SB_URL;
const SB_KEY      = process.env.AUDIT_SB_KEY;

if (!SECRET_SALT) console.error('FATAL: EQ_SECRET_SALT env var not set');

// ── Allowed origins for CORS ─────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://sks-nsw-labour.netlify.app',
  'https://eq-solves-field.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000',
];

function corsHeaders(event) {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith('--sks-nsw-labour.netlify.app') || origin.endsWith('--eq-solves-field.netlify.app'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type, x-eq-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ── PIN codes (plaintext, from env vars per tenant) ──────────
// Each Netlify project sets STAFF_CODE / MANAGER_CODE for its tenant.
// SECRET_SALT above is still used for session-token signing (see signToken).
const STAFF_CODE   = process.env.STAFF_CODE;
const MANAGER_CODE = process.env.MANAGER_CODE;

// ── Rate limiting ────────────────────────────────────────────
// In-memory (best-effort) path. Active by default. Survives only within
// a single Netlify Function instance — cold starts reset.
const attempts = {};
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;

// SEC2 Phase D — distributed rate limit via Supabase RPC.
// Toggled ON per-tenant by setting Netlify env var RATE_LIMIT_V2=on.
// When ON, failed PIN attempts call public.bump_rate_limit() on the
// audit-log Supabase (the project the rate_limit_buckets migration
// landed on). RPC returning FALSE → return 429 immediately; returning
// TRUE or failing → fall through to the in-memory path.
//
// Rollback: unset RATE_LIMIT_V2 in the Netlify dashboard → next cold
// start serves only the in-memory path. No code change required.
const RATE_LIMIT_V2 = (process.env.RATE_LIMIT_V2 || '').toLowerCase() === 'on';
const RATE_LIMIT_WINDOW_SEC = 15 * 60;  // matches LOCKOUT_MS

function tenantFromOrigin(event) {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  if (origin.includes('sks-nsw-labour'))  return 'sks';
  if (origin.includes('eq-solves-field')) return 'eq';
  return 'unknown';
}

// Returns: true (allowed) | false (rate-limited) | null (RPC failed — caller falls back)
async function bumpRateLimitRPC(bucketKey, max, windowSec) {
  if (!SB_URL || !SB_KEY) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/bump_rate_limit`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Accept':        'application/json'
      },
      body: JSON.stringify({
        p_key:            bucketKey,
        p_max:            max,
        p_window_seconds: windowSec
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data === true || data === false) ? data : null;
  } catch (e) {
    return null;
  }
}

// ── Audit logging ────────────────────────────────────────────
async function logAttempt(name, success, ip, detail) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        action: success ? 'Login success' : 'Login failed',
        category: 'Auth',
        detail: `Name: ${name || 'unknown'}, IP: ${ip || 'unknown'}${detail ? ', ' + detail : ''}`,
        who: name || 'unknown'
      })
    });
  } catch (e) { /* non-blocking */ }
}

// ── Token signing & verification ─────────────────────────────
function signToken(name, role, expiresAt) {
  const payload = JSON.stringify({ name, role, exp: expiresAt });
  const sig = crypto.createHmac('sha256', SECRET_SALT).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

function verifyToken(token) {
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expectedSig = crypto.createHmac('sha256', SECRET_SALT).update(payload).digest('hex');
    if (sig !== expectedSig) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}

// v3.5.9 (Phase 1.C) — EQ Shell iframe handoff token.
// Shell mints a short-lived (60s recommended) token via the same
// EQ_SECRET_SALT and passes it in the iframe URL hash. Field reads
// the hash, calls verify-pin with action='verify-shell-token', skips
// the PIN gate on success, and gets back a 7d session token for the
// rest of the app to use as if PIN-verified.
//
// Token-type confusion guard: requires payload.kind === 'shell-token'
// so a session token (no kind) or leave-action token (kind='leave-
// action') can't be passed here.
function verifyShellToken(token) {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expectedSig = crypto.createHmac('sha256', SECRET_SALT).update(payload).digest('hex');
    if (sig !== expectedSig) return null;
    const data = JSON.parse(payload);
    if (data.kind !== 'shell-token') return null;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!data.name || !data.role) return null;
    return data;
  } catch (e) { return null; }
}

// ── Handler ──────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  if (!SECRET_SALT) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured — missing EQ_SECRET_SALT' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

    // ── Token verification action ────────────────────────────
    if (body.action === 'verify-token') {
      const data = verifyToken(body.token);
      if (data) {
        const sessionToken = signToken(data.name, data.role, Date.now() + (7 * 24 * 60 * 60 * 1000));
        return { statusCode: 200, headers, body: JSON.stringify({ valid: true, name: data.name, role: data.role, sessionToken }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
    }

    // ── EQ Shell iframe handoff (Phase 1.C) ───────────────────
    // Shell mints a short-lived token + passes via URL hash; Field
    // calls this action to swap the shell token for a 7d session
    // token, skipping the PIN gate.
    if (body.action === 'verify-shell-token') {
      const data = verifyShellToken(body.token);
      if (data) {
        await logAttempt(data.name, true, ip, 'shell-token');
        const sessionToken = signToken(data.name, data.role, Date.now() + (7 * 24 * 60 * 60 * 1000));
        return { statusCode: 200, headers, body: JSON.stringify({ valid: true, name: data.name, role: data.role, sessionToken }) };
      }
      // Don't disclose why it failed (expired vs bad sig vs wrong kind).
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
    }

    // ── PIN verification ─────────────────────────────────────
    const { code, name, remember } = body;
    const now = Date.now();

    if (!attempts[ip]) attempts[ip] = { count: 0, lockedUntil: 0 };
    const record = attempts[ip];

    if (record.lockedUntil > now) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      await logAttempt(name, false, ip, 'LOCKED');
      return {
        statusCode: 429, headers,
        body: JSON.stringify({ valid: false, role: null, locked: true, message: `Too many attempts. Try again in ${Math.ceil(remainingSec / 60)} minutes.` })
      };
    }

    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ valid: false, role: null }) };

    if (!STAFF_CODE || !MANAGER_CODE) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured — missing STAFF_CODE or MANAGER_CODE' }) };
    }

    let role = null;
    if (code === STAFF_CODE) role = 'staff';
    else if (code === MANAGER_CODE) role = 'supervisor';

    if (role) {
      record.count = 0;
      record.lockedUntil = 0;
      await logAttempt(name, true, ip);

      let token = null;
      if (remember) {
        token = signToken(name, role, now + (7 * 24 * 60 * 60 * 1000));
      }

      const sessionToken = signToken(name, role, now + (7 * 24 * 60 * 60 * 1000));

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: true, role, token, sessionToken })
      };
    } else {
      // ── Failed PIN attempt — rate-limit check ───────────────
      // SEC2 Phase D: when RATE_LIMIT_V2=on, the distributed RPC bucket
      // is the authoritative lockout check (survives cold starts).
      // Returning null = RPC failed → fall through to in-memory path
      // so a Supabase blip doesn't kill the gate.
      if (RATE_LIMIT_V2) {
        const tenant    = tenantFromOrigin(event);
        const bucketKey = `${tenant}:gate-pin:${ip}`;
        const allowed   = await bumpRateLimitRPC(bucketKey, MAX_ATTEMPTS, RATE_LIMIT_WINDOW_SEC);
        if (allowed === false) {
          await logAttempt(name, false, ip, 'LOCKOUT TRIGGERED (rpc)');
          return {
            statusCode: 429, headers,
            body: JSON.stringify({ valid: false, role: null, locked: true, message: `Too many attempts. Try again in up to 15 minutes.` })
          };
        }
        // allowed === true (under the limit) OR allowed === null (RPC blip):
        // continue to the in-memory path below as a belt-and-braces fallback.
      }

      record.count++;
      if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_MS;
        record.count = 0;
        await logAttempt(name, false, ip, 'LOCKOUT TRIGGERED');
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ valid: false, role: null, locked: true, message: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in 15 minutes.` })
        };
      }
      await logAttempt(name, false, ip);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: false, role: null, attemptsRemaining: MAX_ATTEMPTS - record.count })
      };
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
