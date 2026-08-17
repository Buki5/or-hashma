/**
 * Netlify Function — POST /.netlify/functions/detect
 * ---------------------------------------------------------------------------
 * Same contract as the Cloudflare version in functions/api/detect.js. Use
 * whichever matches your host; you do not need both.
 *
 * Environment variables (Site settings → Environment variables):
 *   WATERMARK_API_KEY, WATERMARK_API_URL, WATERMARK_MODEL, ALLOWED_ORIGIN
 *
 * Add this redirect to netlify.toml so the front end can keep calling
 * /api/detect without knowing where the function lives:
 *
 *   [[redirects]]
 *     from = "/api/detect"
 *     to   = "/.netlify/functions/detect"
 *     status = 200
 */

const { sessionValid } = require('./verify.js');

const MAX_TEXTS = 16;
const MAX_CHARS = 20000;

exports.handler = async function (event) {
  const allowed = process.env.ALLOWED_ORIGIN || '';
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': allowed || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-atwr-session'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') return reply({ error: { message: 'Use POST' } }, 405, allowed);
  if (allowed && origin && origin !== allowed) return reply({ error: { message: 'Origin not allowed' } }, 403, allowed);

  /* Human check — enforced only once Turnstile is configured. */
  if (process.env.TURNSTILE_SECRET_KEY && process.env.SESSION_SECRET) {
    const session = event.headers['x-atwr-session'] || event.headers['X-ATWR-Session'];
    if (!sessionValid(session, process.env.SESSION_SECRET)) {
      return reply({ error: { message: 'Human verification required or expired.', code: 'verification_required' } }, 401, allowed);
    }
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply({ error: { message: 'Body must be JSON' } }, 400, allowed); }

  const texts = Array.isArray(body.texts) ? body.texts : null;
  if (!texts || !texts.length) return reply({ error: { message: '"texts" must be a non-empty array' } }, 400, allowed);
  if (texts.length > MAX_TEXTS) return reply({ error: { message: 'Too many texts (max ' + MAX_TEXTS + ')' } }, 413, allowed);
  if (texts.reduce((n, t) => n + String(t || '').length, 0) > MAX_CHARS) {
    return reply({ error: { message: 'Payload too large' } }, 413, allowed);
  }

  if (!process.env.WATERMARK_API_KEY || !process.env.WATERMARK_API_URL) {
    return reply({ error: { message: 'Detection API is not configured on this deployment yet.', code: 'not_configured' } }, 503, allowed);
  }

  let upstream, payload;
  try {
    upstream = await fetch(process.env.WATERMARK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.WATERMARK_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.WATERMARK_MODEL || body.model || 'claude-watermark-detector',
        inputs: texts.map((t) => ({ text: String(t) }))
      })
    });
    payload = await upstream.json().catch(() => null);
  } catch (err) {
    return reply({ error: { message: 'Detection API unreachable' } }, 502, allowed);
  }

  if (!upstream.ok) {
    const message = (payload && payload.error && (payload.error.message || payload.error)) ||
      ('Detection API returned HTTP ' + upstream.status);
    return reply({ error: { message: String(message) } }, upstream.status, allowed);
  }

  const results = normalise(payload, texts.length);
  if (!results) return reply({ error: { message: 'Unexpected response shape from the detection API' } }, 502, allowed);
  return reply({ results: results }, 200, allowed);
};

function normalise(payload, expected) {
  const list = pickList(payload);
  if (!list || list.length !== expected) return null;
  return list.map((raw) => {
    if (typeof raw === 'number') return { score: clamp01(raw), watermarked: clamp01(raw) >= 0.5 };
    const score = firstNumber([raw.score, raw.probability, raw.confidence,
      raw.watermark_score, raw.watermark_probability, raw.p_watermarked]);
    const flag = firstBoolean([raw.watermarked, raw.is_watermarked, raw.detected, raw.has_watermark]);
    if (score === null && flag === null) return null;
    const s = score === null ? (flag ? 0.95 : 0.05) : clamp01(score);
    return { score: s, watermarked: flag === null ? s >= 0.5 : flag };
  });
}

function pickList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  for (const k of ['results', 'data', 'detections', 'scores', 'outputs', 'items']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return null;
}
function firstNumber(list) { for (const v of list) if (typeof v === 'number' && isFinite(v)) return v; return null; }
function firstBoolean(list) { for (const v of list) if (typeof v === 'boolean') return v; return null; }
function clamp01(n) { if (n > 1 && n <= 100) n = n / 100; return Math.min(1, Math.max(0, n)); }

function reply(obj, statusCode, allowed) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (allowed) { headers['Access-Control-Allow-Origin'] = allowed; headers['Vary'] = 'Origin'; }
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(obj) };
}
