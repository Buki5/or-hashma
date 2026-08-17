/**
 * Cloudflare Pages Function — POST /api/verify
 * ---------------------------------------------------------------------------
 * Exchanges a Cloudflare Turnstile token for a short-lived signed session.
 *
 * A Turnstile token is single-use, but one document run makes several
 * detection calls. So the human is checked once here, and the session issued
 * below is what accompanies the rest of the run.
 *
 * The session is an HMAC over its own expiry — it carries no personal data
 * and cannot be forged without SESSION_SECRET.
 *
 * Environment variables:
 *   TURNSTILE_SECRET_KEY  required to enforce verification (from the
 *                         Turnstile dashboard — the SECRET half, not the
 *                         site key that is published in config.js)
 *   SESSION_SECRET        required — any long random string
 *   SESSION_MINUTES       optional, default 30
 *   ALLOWED_ORIGIN        optional
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function onRequestPost(context) {
  const { request, env } = context;
  const allowed = env.ALLOWED_ORIGIN || '';
  const origin = request.headers.get('Origin') || '';

  if (allowed && origin && origin !== allowed) {
    return json({ error: { message: 'Origin not allowed' } }, 403, allowed);
  }

  if (!env.TURNSTILE_SECRET_KEY || !env.SESSION_SECRET) {
    return json({
      error: { message: 'Human verification is not configured on this deployment.', code: 'not_configured' }
    }, 503, allowed);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: { message: 'Body must be JSON' } }, 400, allowed); }

  const token = body && body.token;
  if (!token || typeof token !== 'string') {
    return json({ error: { message: 'Missing verification token' } }, 400, allowed);
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);

  let outcome;
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    outcome = await res.json();
  } catch (err) {
    return json({ error: { message: 'Verification service unreachable' } }, 502, allowed);
  }

  if (!outcome || !outcome.success) {
    const codes = (outcome && outcome['error-codes']) || [];
    return json({
      error: { message: 'Verification failed' + (codes.length ? ' (' + codes.join(', ') + ')' : '') }
    }, 403, allowed);
  }

  const minutes = parseInt(env.SESSION_MINUTES || '30', 10) || 30;
  const session = await issueSession(env.SESSION_SECRET, minutes);
  return json({ session: session, expiresInMinutes: minutes }, 200, allowed);
}

/* ------------------------------------------------------------------ session */

export async function issueSession(secret, minutes) {
  const expires = Date.now() + minutes * 60000;
  const signature = await sign(String(expires), secret);
  return String(expires) + '.' + signature;
}

/** Exported so /api/detect validates with exactly the same rules. */
export async function sessionValid(session, secret) {
  if (!session || typeof session !== 'string') return false;
  const dot = session.indexOf('.');
  if (dot < 1) return false;

  const expires = parseInt(session.slice(0, dot), 10);
  const signature = session.slice(dot + 1);
  if (!isFinite(expires) || expires < Date.now()) return false;

  const expected = await sign(String(expires), secret);
  return timingSafeEqual(signature, expected);
}

async function sign(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64url(new Uint8Array(mac));
}

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status, allowed) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (allowed) { headers['Access-Control-Allow-Origin'] = allowed; headers['Vary'] = 'Origin'; }
  return new Response(JSON.stringify(obj), { status: status, headers: headers });
}

export function onRequestOptions(context) {
  const allowed = context.env.ALLOWED_ORIGIN || '';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
