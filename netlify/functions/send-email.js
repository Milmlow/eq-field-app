// ─────────────────────────────────────────────────────────────
// netlify/functions/send-email.js
// Sends emails via Resend API. Authenticated — requires a valid
// x-eq-token header (same HMAC session token from verify-pin).
// Env vars required:
//   RESEND_API_KEY   — your Resend API key (re_...)
//   EQ_SECRET_SALT   — HMAC signing key (must match verify-pin)
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

// ── Config from env vars (no fallbacks) ──────────────────────
const SECRET_SALT = process.env.EQ_SECRET_SALT;

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

// ── Token verification ───────────────────────────────────────
function verifyToken(token) {
  try {
    const [payloadB64, sig] = (token || '').split('.');
    if (!payloadB64 || !sig) return null;
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expectedSig = crypto.createHmac('sha256', SECRET_SALT).update(payload).digest('hex');
    if (sig !== expectedSig) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}

// ── Input validation helpers ─────────────────────────────────
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TO      = 10;
const MAX_CC      = 10;
const MAX_SUBJECT = 200;
const MAX_HTML    = 50000;  // 50 KB

function validateEmails(arr, fieldName, max) {
  if (!Array.isArray(arr)) return `${fieldName} must be an array`;
  if (arr.length > max) return `${fieldName} exceeds maximum of ${max} recipients`;
  for (const e of arr) {
    if (typeof e !== 'string' || !EMAIL_RE.test(e)) return `Invalid email in ${fieldName}: ${String(e).slice(0, 50)}`;
  }
  return null;
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
    // ── Auth: require valid session token ─────────────────────
    const token = event.headers['x-eq-token'] || event.headers['X-Eq-Token'];
    const user = verifyToken(token);
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated — please log in again.' }) };
    }

    const body = JSON.parse(event.body);
    const { to, cc, subject, html } = body;

    // ── Input validation ──────────────────────────────────────
    if (!to || !subject || !html) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, html' }) };
    }

    const toArr = Array.isArray(to) ? to : [to];
    const toErr = validateEmails(toArr, 'to', MAX_TO);
    if (toErr) return { statusCode: 400, headers, body: JSON.stringify({ error: toErr }) };

    if (cc && cc.length) {
      const ccArr = Array.isArray(cc) ? cc : [cc];
      const ccErr = validateEmails(ccArr, 'cc', MAX_CC);
      if (ccErr) return { statusCode: 400, headers, body: JSON.stringify({ error: ccErr }) };
    }

    if (typeof subject !== 'string' || subject.length > MAX_SUBJECT) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Subject must be a string under ${MAX_SUBJECT} characters` }) };
    }

    if (typeof html !== 'string' || html.length > MAX_HTML) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `HTML body exceeds maximum size of ${MAX_HTML} characters` }) };
    }

    // ── Send via Resend ───────────────────────────────────────
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server missing RESEND_API_KEY' }) };
    }

    const payload = {
      from: process.env.EMAIL_FROM || 'Leave Request <noreply@eq.solutions>',
      to: toArr,
      subject,
      html
    };
    if (cc && cc.length) payload.cc = Array.isArray(cc) ? cc : [cc];

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({ error: data.message || 'Email service error' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: data.id })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal error' })
    };
  }
};
