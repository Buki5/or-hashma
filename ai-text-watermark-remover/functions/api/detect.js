/**
 * Cloudflare Pages Function — POST /api/detect
 * ---------------------------------------------------------------------------
 * The browser never sees the API key. This function holds it, forwards the
 * request to the detection API, and returns a normalised response.
 *
 * Set these in the Pages dashboard (Settings → Environment variables):
 *   WATERMARK_API_KEY   required — your secret key
 *   WATERMARK_API_URL   required — the vendor's detection endpoint
 *   WATERMARK_MODEL     optional — model/detector identifier
 *   ALLOWED_ORIGIN      optional — your site origin; defaults to same-origin only
 *
 * Request  { "texts": ["…", "…"], "model": "…" }
 * Response { "results": [{ "score": 0.93, "watermarked": true }, …] }
 *
 * Until the real endpoint exists this returns 503 with a clear message, which
 * the front end reports honestly instead of inventing a verdict.
 */

const MAX_TEXTS = 16;
const MAX_CHARS = 20000;

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';

  if (allowed && origin && origin !== allowed) {
    return json({ error: { message: 'Origin not allowed' } }, 403, origin, allowed);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Body must be JSON' } }, 400, origin, allowed);
  }

  const texts = Array.isArray(body && body.texts) ? body.texts : null;
  if (!texts || !texts.length) {
    return json({ error: { message: '"texts" must be a non-empty array' } }, 400, origin, allowed);
  }
  if (texts.length > MAX_TEXTS) {
    return json({ error: { message: 'Too many texts in one request (max ' + MAX_TEXTS + ')' } }, 413, origin, allowed);
  }
  const total = texts.reduce((n, t) => n + String(t || '').length, 0);
  if (total > MAX_CHARS) {
    return json({ error: { message: 'Payload too large (max ' + MAX_CHARS + ' characters)' } }, 413, origin, allowed);
  }

  if (!env.WATERMARK_API_KEY || !env.WATERMARK_API_URL) {
    return json({
      error: {
        message: 'Detection API is not configured on this deployment yet.',
        code: 'not_configured'
      }
    }, 503, origin, allowed);
  }

  /* ------------------------------------------------------------------
     Vendor call. When the real API ships, this is the block to adjust:
     the request shape below, and the mapping in `normalise` underneath.
     ------------------------------------------------------------------ */
  let upstream;
  try {
    upstream = await fetch(env.WATERMARK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.WATERMARK_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: env.WATERMARK_MODEL || body.model || 'claude-watermark-detector',
        inputs: texts.map((t) => ({ text: String(t) }))
      })
    });
  } catch (err) {
    return json({ error: { message: 'Detection API unreachable' } }, 502, origin, allowed);
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const message = (payload && payload.error && (payload.error.message || payload.error)) ||
      ('Detection API returned HTTP ' + upstream.status);
    return json({ error: { message: String(message) } }, upstream.status, origin, allowed);
  }

  const results = normalise(payload, texts.length);
  if (!results) {
    return json({ error: { message: 'Unexpected response shape from the detection API' } }, 502, origin, allowed);
  }

  return json({ results: results }, 200, origin, allowed);
}

/* Map the vendor payload onto [{ score, watermarked }] — one per input. */
function normalise(payload, expected) {
  const list = pickList(payload);
  if (!list || list.length !== expected) return null;

  return list.map((raw) => {
    if (typeof raw === 'number') return { score: clamp01(raw), watermarked: clamp01(raw) >= 0.5 };
    const score = firstNumber([
      raw.score, raw.probability, raw.confidence,
      raw.watermark_score, raw.watermark_probability, raw.p_watermarked
    ]);
    const flag = firstBoolean([raw.watermarked, raw.is_watermarked, raw.detected, raw.has_watermark]);
    if (score === null && flag === null) return null;
    const s = score === null ? (flag ? 0.95 : 0.05) : clamp01(score);
    return { score: s, watermarked: flag === null ? s >= 0.5 : flag };
  });
}

function pickList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const keys = ['results', 'data', 'detections', 'scores', 'outputs', 'items'];
  for (const k of keys) if (Array.isArray(payload[k])) return payload[k];
  return null;
}

function firstNumber(list) {
  for (const v of list) if (typeof v === 'number' && isFinite(v)) return v;
  return null;
}
function firstBoolean(list) {
  for (const v of list) if (typeof v === 'boolean') return v;
  return null;
}
function clamp01(n) {
  if (n > 1 && n <= 100) n = n / 100;
  return Math.min(1, Math.max(0, n));
}

function json(obj, status, origin, allowed) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = allowed;
    headers['Vary'] = 'Origin';
  }
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
