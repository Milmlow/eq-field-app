// ─────────────────────────────────────────────────────────────
// netlify/functions/send-email.js
// Sends emails via Resend API. Authenticated — requires a valid
// x-eq-token header (same HMAC session token from verify-pin).
// Env vars required:
//   RESEND_API_KEY  — your Resend API key (re_...)
//   SECRET_SALT     — must match verify-pin.js
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

const SECRET_SALT = process.env.EQ_SECRET_SALT || 'sks-nsw-labour-2026-hvK9mP2xQ7';

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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-eq-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    // ── Auth: require valid session token ─────────────────────
    const token = event.headers['x-eq-token'] || event.headers['X-Eq-Token'];
    const user = verifyToken(token);
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated — please log in again.' }) };
    }

    const { to, cc, subject, html } = JSON.parse(event.body);

    if (!to || !subject || !html) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, html' }) };
    }

    const apiKey = process.env.RESEND_API_KEY || 're_aCpuyQJe_JvxwMQGfpf2mxMLnyA69Ektu';

    const payload = {
      from: 'Leave Request <noreply@eq.solutions>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    };
    if (cc && cc.length) payload.cc = cc;

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
        body: JSON.stringify({ error: data.message || 'Resend API error', detail: data })
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
      body: JSON.stringify({ error: e.message })
    };
  }
};
