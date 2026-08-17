/* ==========================================================================
   AI Text Watermark Remover — configuration
   --------------------------------------------------------------------------
   This is the only file you edit to switch the site from "statistical
   estimate" mode to "official detector" mode. See API.md for the full
   contract and the go-live checklist.
   ========================================================================== */

window.ATWR_CONFIG = {

  /* ----------------------------------------------------------------------
     FEATURE FLAGS
     ----------------------------------------------------------------------
     officialDetector
       false → the site presents its own statistical estimate, and the
               official-detector option is shown as "not yet available".
       true  → detection runs through your API key on the server, and all
               copy marked data-copy-live/data-copy-draft flips to the live
               wording.

     Flip this to true ONLY once /api/detect is live and returning real
     verdicts. Claiming a verification you are not performing is both
     dishonest and, for anyone relying on it, harmful.
     ---------------------------------------------------------------------- */
  features: {
    officialDetector: false,
    showEngineSelector: true
  },

  /* ----------------------------------------------------------------------
     DETECTION BACKEND
     ----------------------------------------------------------------------
     The browser only ever talks to your own endpoint. The API key lives in
     the hosting platform's environment variables and is never sent to, or
     visible from, the browser. There is deliberately no way to enter a key
     in the UI — a key typed into a web page is a key anyone can read.
     ---------------------------------------------------------------------- */
  detector: {
    endpoint: '/api/detect',
    verifyEndpoint: '/api/verify',
    model: 'claude-watermark-detector',

    /* Cost control — every one of these caps API spend per run. */
    maxCallsPerRun: 40,
    batchSize: 8,
    concurrency: 3,
    timeoutMs: 20000,
    retries: 1,

    /* A segment at or above this score counts as carrying a watermark. */
    threshold: 0.5
  },

  /* ----------------------------------------------------------------------
     HUMAN VERIFICATION (Cloudflare Turnstile)
     ----------------------------------------------------------------------
     Free, privacy-preserving, and usually invisible. It exists to stop bots
     burning your API budget, so by default it guards only runs that spend
     money ('api'). Set protect: 'all' to challenge local runs too.

     enabled  turn on after you have created a Turnstile widget
     siteKey  the PUBLIC key from the Turnstile dashboard (safe to publish)
              the SECRET key goes in the TURNSTILE_SECRET_KEY env var
     ---------------------------------------------------------------------- */
  turnstile: {
    enabled: false,
    siteKey: '',
    protect: 'api',        // 'api' = only API-backed runs · 'all' = every run
    sessionMinutes: 30     // how long one successful check stays valid
  },

  /* ----------------------------------------------------------------------
     OPTIMIZER — the scan → rewrite → re-score → keep-the-best loop.
     ---------------------------------------------------------------------- */
  optimizer: {
    maxSegments: 5,        // how many segments to work on (3-5)
    minSegments: 3,
    rounds: 3,             // escalating passes over the stubborn segments
    variantsPerSegment: 3, // rewrites generated and compared per round
    targetScore: 0.35,     // stop working a segment once it drops below this
    minImprovement: 0.02   // ignore changes that do not actually help
  }
};
