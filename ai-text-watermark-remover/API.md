# Detection API integration

The site ships with the full integration already built, wired and tested against a mock endpoint.
Nothing is stubbed out with `TODO`. When a real watermark-detection API is available, going live is a
configuration change, not a development project.

---

## The switch

`assets/js/config.js`:

```js
features: {
  officialDetector: false   // ← set to true when the endpoint is live
}
```

While it is `false`:

- the engine selector shows **Official detection API — not yet available** and is disabled,
- every score on the site comes from the built-in statistical estimate, and says so,
- all copy marked `data-copy-draft` / `data-copy-live` shows the *draft* wording.

The moment it is `true` **and** the endpoint answers, the same page presents the API's verdicts and the
copy flips to the live wording automatically.

> Do not set this to `true` before the endpoint really works. The live copy tells visitors their text was
> checked against the official detector. If that is not happening, the page is lying to people who may be
> relying on it.

---

## Architecture

```
  app.js            tokenizing, segmenting, synonym engine, UI
     │
     ├── detector.js    one interface, two engines
     │      ├── local      green-list z-test, in-browser, free
     │      └── official   your endpoint → the vendor API
     │
     └── optimizer.js  scan → rewrite → re-score → keep the winner
```

Everything above the detector is engine-agnostic. It calls:

```js
detector.score([text, ...]) -> Promise<[{ score, watermarked, source }]>
```

`score` is always a probability in `[0, 1]`. Swapping engines changes nothing else in the codebase.

### The optimization loop

1. **Baseline** — score the whole document, then every segment (batched, 8 per request).
2. **Target** — take the segments the user was shown as high-impact.
3. **Rewrite** — generate up to 3 genuinely different rewrites per segment: strongest synonyms for the
   strongest words; a different set of words; the same words with second-choice synonyms.
4. **Evaluate** — score every candidate of every segment in one batched pass.
5. **Keep** — adopt a rewrite only if it lowers that segment's score by at least `minImprovement`.
6. **Escalate** — segments still above `targetScore` get another round with more words in play (2 → 3 → 4).
7. **Verify** — reassemble the document and score the finished text.

Every number shown to the user is measured, never asserted: the before/after figures are two real
detector calls on the real strings.

---

## Endpoint contract

The browser never holds the key. It calls **your** endpoint, which calls the vendor.

**Request** — `POST /api/detect`

```json
{ "texts": ["first segment…", "second segment…"], "model": "claude-watermark-detector" }
```

**Response** — `200`

```json
{ "results": [ { "score": 0.93, "watermarked": true },
               { "score": 0.11, "watermarked": false } ] }
```

`results` must have exactly one entry per input text, in the same order.

**Errors** — any non-2xx with `{ "error": { "message": "…" } }`. The front end reports the message and
falls back to the built-in estimate rather than inventing a verdict.

### Response shapes it already tolerates

`normalizeResult()` in `detector.js` (and `normalise()` in the serverless functions) accepts the field
names a detection API plausibly uses, so a shape mismatch probably needs no code change at all:

| Meaning | Accepted keys |
| --- | --- |
| probability | `score`, `probability`, `confidence`, `watermark_score`, `watermark_probability`, `p_watermarked` |
| verdict | `watermarked`, `is_watermarked`, `detected`, `has_watermark` |
| envelope | `results`, `data`, `detections`, `scores`, `outputs`, `items`, or a bare array |

Scales of `0–100` are detected and divided down. A bare number is treated as the probability.

If the real API differs, **edit only that one function**. Nothing else in the codebase reads the raw
response.

---

## Deploying the proxy

Two implementations are included; use the one that matches your host.

### Cloudflare Pages — `functions/api/detect.js`

Already at the right path. Pages picks it up automatically and serves it at `/api/detect`.

Set in **Settings → Environment variables**:

| Variable | Required | Purpose |
| --- | --- | --- |
| `WATERMARK_API_KEY` | yes | your secret key — never reaches the browser |
| `WATERMARK_API_URL` | yes | the vendor's detection endpoint |
| `WATERMARK_MODEL` | no | detector/model identifier |
| `ALLOWED_ORIGIN` | no | your site origin, e.g. `https://www.example.com` |

### Netlify — `netlify/functions/detect.js`

Add to `netlify.toml` so the front end can keep calling `/api/detect`:

```toml
[[redirects]]
  from = "/api/detect"
  to   = "/.netlify/functions/detect"
  status = 200
```

Then set the same environment variables under **Site settings → Environment variables**.

Both functions cap the request at 16 texts and 20,000 characters, refuse cross-origin calls when
`ALLOWED_ORIGIN` is set, and return `503 not_configured` until the key and URL exist.

---

## Cost control

Every limit lives in `config.js` under `detector`:

| Setting | Default | What it does |
| --- | --- | --- |
| `maxCallsPerRun` | 40 | hard ceiling per user run; exceeding it aborts rather than spends |
| `batchSize` | 8 | texts per request |
| `concurrency` | 3 | requests in flight |
| `timeoutMs` | 20000 | per request |
| `retries` | 1 | retried only on 429/5xx/network |
| `threshold` | 0.5 | score at or above this counts as watermarked |

Identical text is scored once and cached for the rest of the session, so the re-scoring step and the
final verification usually cost nothing. A typical run on a 3-paragraph document is **4 requests**.

---

## Testing before the API exists

`scratchpad/test-official.js` in the development notes drives the whole flow against a mock endpoint that
scores text by marker words, so rewrites genuinely move the number. To try it by hand, intercept
`/api/detect` in devtools, or point `WATERMARK_API_URL` at any endpoint honouring the contract above.

Verified run against the mock:

```
Detection API: watermark detected (63%) · 3 segments targeted · 2 calls
Round 1: 3 candidates per segment scored, best kept
Document score 63% → 44% · 4 words replaced · 4 requests, 18 texts scored
```

---

## Human verification

Cloudflare Turnstile guards the endpoint so bots cannot drain the API budget.

- A Turnstile token is **single-use**, but one document run makes several detection calls. So the token is
  exchanged once at `/api/verify` for a short-lived session signed with `SESSION_SECRET` (HMAC-SHA256 over
  its own expiry — no personal data, unforgeable without the secret).
- That session travels in the `x-atwr-session` header on every `/api/detect` call.
- `/api/detect` enforces it **only when `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` are both set**, so a
  deployment works before you configure Turnstile — but once configured, an unverified request gets a
  `401`, never a quiet pass.
- On `401` the client clears the session and re-challenges on the next run.
- By default (`turnstile.protect: 'api'`) only API-backed runs are challenged; local runs cost nothing and
  are never interrupted. Set `'all'` to challenge everything.

Setup: create a Turnstile widget, put the **site key** in `config.js` (it is public by design) and the
**secret key** in the `TURNSTILE_SECRET_KEY` environment variable.

## There is no API key field in the UI

Deliberately. Anything the browser holds — a variable, a form field, `localStorage` — is readable by anyone
who opens devtools. A key belongs in the hosting platform's environment variables, where the serverless
function reads it and the browser never sees it. The engine toggle switches between the built-in estimate
and *your server's* key; it never asks a visitor for one.

---

## Go-live checklist

1. Deploy the proxy and set `WATERMARK_API_KEY` + `WATERMARK_API_URL`.
2. `curl -X POST https://your-domain/api/detect -H 'Content-Type: application/json' -d '{"texts":["hello world"]}'`
   and confirm a `results` array comes back.
3. If the shape differs, adjust `normalise()` in the function and `normalizeResult()` in `detector.js`.
4. Set `features.officialDetector: true` in `config.js`.
5. Reload the site, pick **Official detection API**, and run a document end to end.
6. Re-read the live copy on the page and confirm every claim it now makes is actually true.
