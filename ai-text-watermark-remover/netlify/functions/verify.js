/**
 * Netlify Function — POST /.netlify/functions/verify
 * ---------------------------------------------------------------------------
 * Same contract as functions/api/verify.js (Cloudflare). Use whichever matches
 * your host; you do not need both.
 *
 * Env: TURNSTILE_SECRET_KEY, SESSION_SECRET, SESSION_MINUTES, ALLOWED_ORIGIN
 *
 * netlify.toml:
 *   [[redirects]]
 *     from = "/api/verify"
 *     to   = "/.netlify/functions/verify"
 *     status = 200
 */

const crypto = require('crypto');
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

exports.handler = async function (event) {
  const allowed = process.env.ALLOWED_ORIGIN || '';
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(allowed), body: '' };
  }
  if (event.httpMethod !== 'POST') return reply({ error: { message: 'Use POST' } }, 405, allowed);
  if (allowed && origin && origin !== allowed) return reply({ error: { message: 'Origin not allowed' } }, 403, allowed);

  if (!process.env.TURNSTILE_SECRET_KEY || !process.env.SESSION_SECRET) {
    return reply({ error: { message: 'Human verification is not configured on this deployment.', code: 'not_configured' } }, 503, allowed);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply({ error: { message: 'Body must be JSON' } }, 400, allowed); }

  if (!body.token || typeof body.token !== 'string') {
    return reply({ error: { message: 'Missing verification token' } }, 400, allowed);
  }

  const params = new URLSearchParams();
  params.append('secret', process.env.TURNSTILE_SECRET_KEY);
  params.append('response', body.token);
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
  if (ip) params.append('remoteip', ip);

  let outcome;
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    outcome = await res.json();
  } catch (err) {
    return reply({ error: { message: 'Verification service unreachable' } }, 502, allowed);
  }

  if (!outcome || !outcome.success) {
    const codes = (outcome && outcome['error-codes']) || [];
    return reply({ error: { message: 'Verification failed' + (codes.length ? ' (' + codes.join(', ') + ')' : '') } }, 403, allowed);
  }

  const minutes = parseInt(process.env.SESSION_MINUTES || '30', 10) || 30;
  return reply({ session: issueSession(process.env.SESSION_SECRET, minutes), expiresInMinutes: minutes }, 200, allowed);
};

function issueSession(secret, minutes) {
  const expires = Date.now() + minutes * 60000;
  return expires + '.' + sign(String(expires), secret);
}

function sessionValid(session, secret) {
  if (!session || typeof session !== 'string') return false;
  const dot = session.indexOf('.');
  if (dot < 1) return false;
  const expires = parseInt(session.slice(0, dot), 10);
  if (!isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(sign(String(expires), secret));
  const given = Buffer.from(session.slice(dot + 1));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function cors(allowed) {
  return {
    'Access-Control-Allow-Origin': allowed || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-atwr-session'
  };
}

function reply(obj, statusCode, allowed) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (allowed) { headers['Access-Control-Allow-Origin'] = allowed; headers['Vary'] = 'Origin'; }
  return { statusCode, headers, body: JSON.stringify(obj) };
}

exports.issueSession = issueSession;
exports.sessionValid = sessionValid;
