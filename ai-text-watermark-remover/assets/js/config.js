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
       true  → the site presents verdicts as coming from the official
               detection API, and all marketing copy marked with
               data-copy-live/data-copy-draft flips to the live wording.

     Flip this to true ONLY once `detector.endpoint` is live and returning
     real verdicts. Claiming a verification you are not performing is both
     dishonest and, for anyone relying on it, harmful.
     ---------------------------------------------------------------------- */
  features: {
    officialDetector: false,
    showEngineSelector: true,
    allowDirectKeyInBrowser: false // dev/testing only — see the warning below
  },

  /* ----------------------------------------------------------------------
     DETECTION BACKEND
     ----------------------------------------------------------------------
     mode
       'proxy'  → the browser calls YOUR endpoint, which holds the API key
                  server-side. This is the only safe production setting.
       'direct' → the browser calls the vendor endpoint with a key typed by
                  the user and kept in localStorage. Convenient for testing,
                  never for a public site: the key is visible to anyone with
                  devtools, and most vendors block browser origins by CORS.
     ---------------------------------------------------------------------- */
  detector: {
    mode: 'proxy',
    endpoint: '/api/detect',
    directEndpoint: 'https://api.anthropic.com/v1/detect/watermark',
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
     OPTIMIZER
     ----------------------------------------------------------------------
     The scan → rewrite → re-score → keep-the-best loop.
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
