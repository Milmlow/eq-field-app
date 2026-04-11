// ─────────────────────────────────────────────────────────────
// netlify/functions/eq-agent.js
// Proxies chat requests to Anthropic so the API key never
// touches the browser. Auth is piggy-backed on the existing
// verify-pin HMAC token — only logged-in SKS users can call it.
// Env vars required:
//   ANTHROPIC_API_KEY   — your sk-ant-… key
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Must match SECRET_SALT in verify-pin.js so tokens are valid here too.
const SECRET_SALT = 'sks-nsw-labour-2026-hvK9mP2xQ7';

// Default model — easy to swap later without a code change
// by setting EQ_AGENT_MODEL env var in Netlify.
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS    = 512;

// Per-IP rate limit (cold-start memory only, best-effort)
const rateBuckets = {};
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX       = 20;   // 20 calls / minute / IP

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

function rateLimited(ip) {
  const now = Date.now();
  const rec = rateBuckets[ip] || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + RATE_WINDOW_MS; }
  rec.count++;
  rateBuckets[ip] = rec;
  return rec.count > RATE_MAX;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-eq-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    // ── Auth: signed session token from verify-pin ────────────
    const token = event.headers['x-eq-token'] || event.headers['X-Eq-Token'];
    const user  = verifyToken(token);
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated — please log in again.' }) };
    }

    // ── Rate limit ────────────────────────────────────────────
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    if (rateLimited(ip)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests — slow down a little.' }) };
    }

    // ── Parse body ────────────────────────────────────────────
    const body = JSON.parse(event.body || '{}');
    const system   = typeof body.system === 'string' ? body.system : '';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No messages supplied' }) };
    }

    // Defensive: clip to last 20 messages so we can't be forced
    // to send an unbounded context from a tampered client.
    const trimmed = messages.slice(-20);

    // ── Forward to Anthropic ──────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server missing ANTHROPIC_API_KEY' }) };
    }
    const model = process.env.EQ_AGENT_MODEL || DEFAULT_MODEL;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: trimmed
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('Anthropic API error ' + resp.status);
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    const reply = (data.content && data.content[0] && data.content[0].text) || '(no response)';
    return {
      statusCode: 200,
      headers:    { ...headers, 'Content-Type': 'application/json' },
      body:       JSON.stringify({ reply, model, who: user.name })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Unknown error' }) };
  }
};
