const crypto = require('crypto');

// ── Secrets from environment variables ──────────────────────
// Set these in Netlify Dashboard > Site settings > Environment variables:
//   SECRET_SALT, STAFF_HASH, MANAGER_HASH, SUPABASE_URL, SUPABASE_ANON_KEY
const SECRET_SALT = process.env.SECRET_SALT || 'sks-nsw-labour-2026-hvK9mP2xQ7';
function hashCode(code) {
  return crypto.createHmac('sha256', SECRET_SALT).update(code).digest('hex');
}

const STAFF_HASH = process.env.STAFF_HASH || '1b2e74d160a514b52a35ad24f86a99416ba8e69367be5a99e86b801540ab9762';
const MANAGER_HASH = process.env.MANAGER_HASH || '787b9ed62dcb4b8edc875be85725fffe063fe1716eca1933768b64d96eb45220';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SB_URL = process.env.SUPABASE_URL || 'https://nspbmirochztcjijmcrx.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcGJtaXJvY2h6dGNqaWptY3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODg2MjQsImV4cCI6MjA5MDI2NDYyNH0.cpwHUqWr7MKaJFP0K7RMt43CytJ_dnPAH3LJ3xEdEdg';

// ── Supabase helpers ────────────────────────────────────────
const sbHeaders = {
  'Content-Type': 'application/json',
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Prefer': 'return=minimal'
};

async function logAttempt(name, success, ip, detail) {
  try {
    await fetch(`${SB_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        action: success ? 'Login success' : 'Login failed',
        category: 'Auth',
        detail: `Name: ${name || 'unknown'}, IP: ${ip || 'unknown'}${detail ? ', ' + detail : ''}`,
        who: name || 'unknown'
      })
    });
  } catch (e) { /* non-blocking */ }
}

// ── Persistent rate limiting via Supabase ───────────────────
// Table: rate_limits (ip TEXT PRIMARY KEY, count INT, locked_until BIGINT)
// Falls back to in-memory if Supabase is unreachable.
const memoryAttempts = {};

async function getAttemptRecord(ip) {
  try {
    const resp = await fetch(
      `${SB_URL}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&select=count,locked_until`,
      { headers: sbHeaders }
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (rows.length > 0) {
        return { count: rows[0].count || 0, lockedUntil: rows[0].locked_until || 0, persistent: true };
      }
      return { count: 0, lockedUntil: 0, persistent: true };
    }
  } catch (e) { /* fall through to memory */ }
  // Fallback: in-memory (still works, just resets on cold start)
  if (!memoryAttempts[ip]) memoryAttempts[ip] = { count: 0, lockedUntil: 0 };
  return { ...memoryAttempts[ip], persistent: false };
}

async function setAttemptRecord(ip, count, lockedUntil, wasPersistent) {
  // Always update memory fallback
  memoryAttempts[ip] = { count, lockedUntil };
  if (!wasPersistent) return;
  try {
    // Upsert into Supabase
    await fetch(`${SB_URL}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: {
        ...sbHeaders,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ ip, count, locked_until: lockedUntil })
    });
  } catch (e) { /* non-blocking */ }
}

// ── Token signing / verification ────────────────────────────
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

// ── Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': event.headers?.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const ip = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown').split(',')[0].trim();

    // ── Token verification ──
    if (body.action === 'verify-token') {
      const data = verifyToken(body.token);
      if (data) {
        return { statusCode: 200, headers, body: JSON.stringify({ valid: true, name: data.name, role: data.role }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
    }

    // ── PIN verification ──
    const { code, name, remember } = body;
    const now = Date.now();

    const record = await getAttemptRecord(ip);

    if (record.lockedUntil > now) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      await logAttempt(name, false, ip, 'LOCKED');
      return {
        statusCode: 429, headers,
        body: JSON.stringify({ valid: false, role: null, locked: true, message: `Too many attempts. Try again in ${Math.ceil(remainingSec / 60)} minutes.` })
      };
    }

    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ valid: false, role: null }) };

    const codeHash = hashCode(code);
    let role = null;
    if (codeHash === STAFF_HASH) role = 'staff';
    else if (codeHash === MANAGER_HASH) role = 'supervisor';

    if (role) {
      await setAttemptRecord(ip, 0, 0, record.persistent);
      await logAttempt(name, true, ip);
      let token = null;
      if (remember) {
        token = signToken(name, role, now + 86400000);
      }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: true, role, token })
      };
    } else {
      const newCount = record.count + 1;
      if (newCount >= MAX_ATTEMPTS) {
        const lockUntil = now + LOCKOUT_MS;
        await setAttemptRecord(ip, 0, lockUntil, record.persistent);
        await logAttempt(name, false, ip, 'LOCKOUT TRIGGERED');
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ valid: false, role: null, locked: true, message: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in 15 minutes.` })
        };
      }
      await setAttemptRecord(ip, newCount, 0, record.persistent);
      await logAttempt(name, false, ip);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: false, role: null, attemptsRemaining: MAX_ATTEMPTS - newCount })
      };
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
