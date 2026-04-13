const crypto = require('crypto');

const SECRET_SALT = process.env.EQ_SECRET_SALT || 'sks-nsw-labour-2026-hvK9mP2xQ7';
function hashCode(code) {
  return crypto.createHmac('sha256', SECRET_SALT).update(code).digest('hex');
}

const STAFF_HASH = '1b2e74d160a514b52a35ad24f86a99416ba8e69367be5a99e86b801540ab9762';
const MANAGER_HASH = '787b9ed62dcb4b8edc875be85725fffe063fe1716eca1933768b64d96eb45220';

const attempts = {};
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SB_URL = process.env.AUDIT_SB_URL || 'https://hignguefjjjtrhofdztu.supabase.co';
const SB_KEY = process.env.AUDIT_SB_KEY || 'sb_publishable_npv-8-iiMPde4Ggk9dD5Pw_QAP2OeWi';

async function logAttempt(name, success, ip, detail) {
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
  } catch (e) {}
}

// 7 day remember-me tokens
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

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const body = JSON.parse(event.body);
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

    if (body.action === 'verify-token') {
      const data = verifyToken(body.token);
      if (data) {
        // Mint a fresh 8h session token so in-app features (EQ Agent)
        // keep working for the user even though we're validating a
        // long-lived remember-me token here.
        const sessionToken = signToken(data.name, data.role, Date.now() + (7 * 24 * 60 * 60 * 1000));
        return { statusCode: 200, headers, body: JSON.stringify({ valid: true, name: data.name, role: data.role, sessionToken }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false }) };
    }

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

    const codeHash = hashCode(code);
    let role = null;
    if (codeHash === STAFF_HASH) role = 'staff';
    else if (codeHash === MANAGER_HASH) role = 'supervisor';

    if (role) {
      record.count = 0;
      record.lockedUntil = 0;
      await logAttempt(name, true, ip);

      // Long-lived "remember me" token (7d) for the PIN gate bypass.
      let token = null;
      if (remember) {
        token = signToken(name, role, now + (7 * 24 * 60 * 60 * 1000));
      }

      // 7-day session token — ALWAYS issued. Used by in-app
      // features like EQ Agent so any logged-in user can call
      // protected Netlify functions without re-auth. 7 days
      // matches the long-lived remember-me window so a user who
      // stays logged in across the week never gets locked out
      // of the agent mid-session.
      const sessionToken = signToken(name, role, now + (7 * 24 * 60 * 60 * 1000));

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: true, role, token, sessionToken })
      };
    } else {
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
