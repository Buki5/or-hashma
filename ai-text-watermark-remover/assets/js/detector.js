/* ==========================================================================
   AI Text Watermark Remover — detection layer
   --------------------------------------------------------------------------
   One interface, two implementations:

     local     the built-in green-list z-test. Free, instant, offline, and an
               estimate — it does not hold any generator's private key.
     official  a real detection API reached through your own endpoint. Scores
               come from the vendor, not from us.

   Everything above this layer (the optimizer, the UI) is written against the
   interface, so switching engines changes nothing else:

     detector.score(texts) -> Promise<[{ score, watermarked, source }]>

   `score` is always a probability in [0, 1] that the text is watermarked.
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.ATWR_CONFIG;

  /* ---------------------------------------------------------------- utils */
  function hashKey(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function pool(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;
    function next() {
      const i = index++;
      if (i >= items.length) return Promise.resolve();
      return Promise.resolve(worker(items[i], i)).then((r) => { results[i] = r; return next(); });
    }
    const runners = [];
    for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
    return Promise.all(runners).then(() => results);
  }

  /* =======================================================================
     RESPONSE MAPPING
     -----------------------------------------------------------------------
     The single place to edit when the real API ships. Accepts the shapes a
     detection endpoint plausibly returns and normalises them to
     { score, watermarked }. If the vendor's shape differs, change ONLY this
     function — nothing else in the codebase reads the raw response.
     ======================================================================= */
  function normalizeResult(raw, threshold) {
    if (raw === null || raw === undefined) return null;

    if (typeof raw === 'number') {
      return { score: clamp01(raw), watermarked: clamp01(raw) >= threshold };
    }

    /* Common field names for the probability. */
    const score = firstNumber([
      raw.score, raw.probability, raw.confidence, raw.watermark_score,
      raw.watermark_probability, raw.p_watermarked,
      raw.result && raw.result.score, raw.detection && raw.detection.score
    ]);

    /* Common field names for the boolean verdict. */
    const flag = firstBoolean([
      raw.watermarked, raw.is_watermarked, raw.detected, raw.has_watermark,
      raw.result && raw.result.watermarked
    ]);

    if (score === null && flag === null) return null;
    const s = score === null ? (flag ? 0.95 : 0.05) : clamp01(score);
    return { score: s, watermarked: flag === null ? s >= threshold : flag };
  }

  function firstNumber(list) {
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] === 'number' && isFinite(list[i])) return list[i];
    }
    return null;
  }
  function firstBoolean(list) {
    for (let i = 0; i < list.length; i++) if (typeof list[i] === 'boolean') return list[i];
    return null;
  }
  function clamp01(n) {
    if (n > 1 && n <= 100) n = n / 100; // tolerate 0-100 scales
    return Math.min(1, Math.max(0, n));
  }

  /* Pull the per-text array out of whatever envelope the endpoint uses. */
  function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    const candidates = [payload.results, payload.data, payload.detections, payload.scores, payload.items];
    for (let i = 0; i < candidates.length; i++) if (Array.isArray(candidates[i])) return candidates[i];
    return null;
  }

  /* =======================================================================
     OFFICIAL DETECTOR
     ======================================================================= */
  function createOfficialDetector(runtime) {
    const cache = new Map();
    let unavailableReason = '';

    function configured() {
      return !!CFG.detector.endpoint;
    }

    function postBatch(texts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CFG.detector.timeoutMs);
      const headers = { 'Content-Type': 'application/json' };

      /* Proof that a human started this run, issued by /api/verify. */
      const session = window.ATWR_Turnstile && window.ATWR_Turnstile.sessionHeader();
      if (session) headers['x-atwr-session'] = session;

      return fetch(CFG.detector.endpoint, {
        method: 'POST',
        headers: headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: CFG.detector.model,
          texts: texts,
          purpose: 'watermark-detection'
        })
      })
        .then((res) => res.json().catch(() => null).then((body) => {
          if (!res.ok) {
            const msg = (body && (body.error && (body.error.message || body.error))) || ('HTTP ' + res.status);
            const err = new Error(String(msg));
            err.status = res.status;
            throw err;
          }
          return body;
        }))
        .finally(() => clearTimeout(timer));
    }

    function scoreBatch(texts, attempt) {
      return postBatch(texts).then((payload) => {
        const list = extractList(payload);
        if (!list || list.length !== texts.length) {
          throw new Error('Unexpected response shape from the detection endpoint');
        }
        return list.map((raw) => normalizeResult(raw, CFG.detector.threshold));
      }).catch((err) => {
        if (err.status === 401 && window.ATWR_Turnstile) window.ATWR_Turnstile.clear();
        const retriable = !err.status || err.status === 429 || err.status >= 500;
        if (retriable && attempt < CFG.detector.retries) {
          return new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
            .then(() => scoreBatch(texts, attempt + 1));
        }
        throw err;
      });
    }

    return {
      id: 'official',
      get label() {
        return CFG.features.officialDetector ? 'Detection API' : 'Detection API (not yet available)';
      },
      configured: configured,
      get unavailableReason() { return unavailableReason; },

      available() {
        if (!CFG.features.officialDetector) {
          unavailableReason = 'The official detection API is not live yet.';
          return Promise.resolve(false);
        }
        if (!configured()) {
          unavailableReason = 'No detection endpoint configured.';
          return Promise.resolve(false);
        }
        return Promise.resolve(true);
      },

      score: function (texts, onProgress) {
        const pending = [];
        const out = new Array(texts.length);

        texts.forEach((t, i) => {
          const k = hashKey(t);
          if (cache.has(k)) {
            out[i] = Object.assign({}, cache.get(k), { source: 'official-cached' });
            runtime.cached++;
          } else {
            pending.push({ text: t, index: i, key: k });
          }
        });

        if (!pending.length) return Promise.resolve(out);

        const batches = chunk(pending, CFG.detector.batchSize);
        const allowed = Math.max(0, CFG.detector.maxCallsPerRun - runtime.calls);
        if (batches.length > allowed) {
          throw new Error('Call budget exhausted (' + CFG.detector.maxCallsPerRun + ' requests per run).');
        }

        return pool(batches, CFG.detector.concurrency, (batch) => {
          runtime.calls++;
          return scoreBatch(batch.map((b) => b.text), 0).then((results) => {
            results.forEach((r, j) => {
              const slot = batch[j];
              if (!r) { out[slot.index] = null; return; }
              cache.set(slot.key, r);
              out[slot.index] = Object.assign({}, r, { source: 'official' });
            });
            if (onProgress) onProgress({ calls: runtime.calls });
          });
        }).then(() => out);
      }
    };
  }

  /* =======================================================================
     LOCAL DETECTOR
     -----------------------------------------------------------------------
     Wraps the in-browser statistical estimate that app.js provides, so it
     satisfies exactly the same interface as the remote one.
     ======================================================================= */
  function createLocalDetector(scorer) {
    return {
      id: 'local',
      label: 'Built-in statistical estimate',
      configured: function () { return true; },
      unavailableReason: '',
      available: function () { return Promise.resolve(true); },
      score: function (texts) {
        return Promise.resolve(texts.map((t) => {
          const s = clamp01(scorer(t));
          return { score: s, watermarked: s >= CFG.detector.threshold, source: 'local' };
        }));
      }
    };
  }

  /* =======================================================================
     HUB — selects the engine and tracks spend
     ======================================================================= */
  window.ATWR_Detector = {
    normalizeResult: normalizeResult, // exported for tests

    create: function (localScorer) {
      const runtime = { calls: 0, cached: 0 };
      const local = createLocalDetector(localScorer);
      const official = createOfficialDetector(runtime);
      let active = local;

      return {
        local: local,
        official: official,
        get active() { return active; },
        get stats() { return { calls: runtime.calls, cached: runtime.cached, engine: active.id }; },

        resetRun: function () { runtime.calls = 0; runtime.cached = 0; },

        /* Falls back to the local engine rather than failing the run. */
        use: function (id) {
          if (id !== 'official') { active = local; return Promise.resolve(local); }
          return official.available().then((ok) => {
            active = ok ? official : local;
            return active;
          });
        },

        score: function (texts, onProgress) {
          if (!texts.length) return Promise.resolve([]);
          return Promise.resolve()
            .then(() => active.score(texts, onProgress))
            .then((results) => {
              /* A null slot means the endpoint answered but said nothing
                 usable for that text; fall back to the local estimate. */
              const missing = [];
              results.forEach((r, i) => { if (!r) missing.push(i); });
              if (!missing.length) return results;
              return local.score(missing.map((i) => texts[i])).then((fill) => {
                missing.forEach((slot, j) => { results[slot] = fill[j]; });
                return results;
              });
            })
            .catch((err) => {
              if (active === local) throw err;
              active = local;
              return local.score(texts).then((results) => {
                results.forEach((r) => { r.degraded = String(err.message || err); });
                return results;
              });
            });
        }
      };
    }
  };
})();
