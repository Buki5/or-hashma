/* ==========================================================================
   AI Text Watermark Remover — human verification (Cloudflare Turnstile)
   --------------------------------------------------------------------------
   Flow:

     1. The user starts a run.
     2. If this run needs verification and we have no valid session, the
        widget is shown. Turnstile is usually invisible and resolves itself.
     3. The resulting token is exchanged, once, at /api/verify for a short
        lived signed session.
     4. That session accompanies every /api/detect call in the run, so one
        check covers the whole document instead of one per request.

   The Turnstile token is single-use by design; the session is what makes a
   multi-request run practical without challenging the user four times.
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.ATWR_CONFIG;
  const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const STORAGE = 'atwr-session';

  let scriptPromise = null;
  let widgetId = null;
  let session = null;

  /* ---------------------------------------------------------------- session */
  function loadStoredSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.expires > Date.now() + 5000 ? parsed : null;
    } catch (e) { return null; }
  }

  function storeSession(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(STORAGE, JSON.stringify(value));
      else sessionStorage.removeItem(STORAGE);
    } catch (e) { /* private mode */ }
  }

  function validSession() {
    if (!session) session = loadStoredSession();
    return session && session.expires > Date.now() + 5000 ? session : null;
  }

  /* ----------------------------------------------------------------- script */
  function loadScript() {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      if (window.turnstile) return resolve(window.turnstile);
      const tag = document.createElement('script');
      tag.src = SCRIPT;
      tag.async = true;
      tag.defer = true;
      tag.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to initialise'));
      tag.onerror = () => reject(new Error('Could not load the verification widget'));
      document.head.appendChild(tag);
    });
    return scriptPromise;
  }

  /* ------------------------------------------------------------------ token */
  function requestToken(container) {
    return loadScript().then((turnstile) => new Promise((resolve, reject) => {
      container.hidden = false;

      const done = (fn) => (arg) => {
        try { fn(arg); } catch (e) { /* ignore */ }
      };

      if (widgetId !== null) {
        /* Re-use the widget; a token can only be spent once. */
        turnstile.reset(widgetId);
      } else {
        widgetId = turnstile.render(container.querySelector('.turnstile-widget'), {
          sitekey: CFG.turnstile.siteKey,
          action: 'detect',
          theme: 'auto',
          callback: done(resolve),
          'error-callback': done(() => reject(new Error('Verification failed. Please try again.'))),
          'timeout-callback': done(() => reject(new Error('Verification timed out. Please try again.'))),
          'expired-callback': done(() => reject(new Error('Verification expired. Please try again.')))
        });
        return;
      }
      /* reset() re-runs the challenge and fires the same callback. */
      turnstile.execute && turnstile.execute(widgetId);
    }));
  }

  /* ---------------------------------------------------------------- exchange */
  function exchange(token) {
    return fetch(CFG.detector.verifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then((res) => res.json().catch(() => null).then((body) => {
      if (!res.ok || !body || !body.session) {
        const message = (body && body.error && (body.error.message || body.error)) ||
          ('Verification rejected (HTTP ' + res.status + ')');
        throw new Error(String(message));
      }
      storeSession({ value: body.session, expires: Date.now() + (CFG.turnstile.sessionMinutes * 60000) });
      return session;
    }));
  }

  window.ATWR_Turnstile = {

    /* Does this run need a check at all? */
    required: function (usesApi) {
      if (!CFG.turnstile.enabled || !CFG.turnstile.siteKey) return false;
      return CFG.turnstile.protect === 'all' ? true : !!usesApi;
    },

    /* The header the detector attaches to protected requests. */
    sessionHeader: function () {
      const current = validSession();
      return current ? current.value : null;
    },

    clear: function () { storeSession(null); },

    /* Resolves once the user is verified, or immediately if already are. */
    ensure: function (usesApi, container, onStatus) {
      if (!this.required(usesApi)) return Promise.resolve(null);
      if (validSession()) return Promise.resolve(session);
      if (!container) return Promise.reject(new Error('Verification container missing'));

      if (onStatus) onStatus('Checking that you are human…');
      return requestToken(container)
        .then((token) => exchange(token))
        .then((result) => {
          container.hidden = true;
          return result;
        })
        .catch((err) => {
          container.hidden = false;
          throw err;
        });
    }
  };
})();
