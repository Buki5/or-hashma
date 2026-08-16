/* ==========================================================================
   AI Text Watermark Remover — optimization loop
   --------------------------------------------------------------------------
   The strategy, in one paragraph:

     Score every segment through the detector. Take the few that carry the
     signal. For each, generate several candidate rewrites, score them all,
     and keep the one that drops the score the most — but only if it drops it
     at all. Repeat on whatever is still above target, escalating how much of
     the segment is allowed to change. Stitch the winners back into the
     original text and score the finished document.

   Everything here is engine-agnostic: it talks to `detector.score(texts)` and
   to an injected `generateVariants` function, so the same loop runs on the
   built-in estimate and on a real detection API.
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.ATWR_CONFIG;

  function applyReplacements(text, ranges) {
    /* ranges: [{ start, end, text }] against the ORIGINAL string. */
    const sorted = ranges.slice().sort((a, b) => b.start - a.start);
    let out = text;
    sorted.forEach((r) => { out = out.slice(0, r.start) + r.text + out.slice(r.end); });
    return out;
  }

  window.ATWR_Optimizer = {

    applyReplacements: applyReplacements,

    /**
     * @param {object}   opts
     * @param {string}   opts.text            the full original document
     * @param {Array}    opts.segments        [{ start, end, text }] covering the document
     * @param {object}   opts.detector        the hub from ATWR_Detector.create()
     * @param {function} opts.generateVariants (segment, round) -> Promise<[{ text, changes }]>
     * @param {function} [opts.onProgress]    ({ phase, message, done, total, calls })
     */
    run: function (opts) {
      const text = opts.text;
      const segments = opts.segments;
      const detector = opts.detector;
      const report = opts.onProgress || function () {};
      const O = CFG.optimizer;

      const state = {
        rounds: [],
        calls: 0,
        engine: detector.active.id,
        degraded: null
      };

      function progress(phase, message, extra) {
        report(Object.assign({ phase: phase, message: message, calls: detector.stats.calls }, extra || {}));
      }

      /* ---------- 1. baseline: whole document + every segment ---------- */
      progress('scan', 'Scoring the document and every segment…');

      return detector.score([text])
        .then((docBaseline) => {
          state.documentBefore = docBaseline[0];
          if (docBaseline[0] && docBaseline[0].degraded) state.degraded = docBaseline[0].degraded;

          return detector.score(segments.map((s) => s.text), (p) =>
            progress('scan', 'Scoring segments…', p));
        })
        .then((scores) => {
          const scored = segments.map((seg, i) => ({
            index: i,
            start: seg.start,
            end: seg.end,
            original: seg.text,
            current: seg.text,
            baseline: scores[i] ? scores[i].score : 0,
            score: scores[i] ? scores[i].score : 0,
            watermarked: scores[i] ? scores[i].watermarked : false,
            changes: [],
            history: []
          }));

          /* ---------- 2. choose the load-bearing segments ---------- */
          const ranked = scored
            .filter((s) => s.original.trim().split(/\s+/).length >= 5)
            .sort((a, b) => b.score - a.score);

          const above = ranked.filter((s) => s.score >= CFG.detector.threshold);
          const wanted = Math.min(
            O.maxSegments,
            Math.max(O.minSegments, above.length || O.minSegments)
          );
          let targets;
          if (opts.targetIndexes && opts.targetIndexes.length) {
            /* The segments the user was shown are the segments we rewrite. */
            targets = opts.targetIndexes.map((i) => scored[i]).filter(Boolean);
          } else {
            targets = (above.length >= O.minSegments ? above : ranked).slice(0, wanted);
          }

          state.allSegments = scored;
          state.targets = targets;

          if (!targets.length) {
            return { state: state, scored: scored, targets: [] };
          }

          /* ---------- 3. escalating rewrite rounds ---------- */
          function runRound(round) {
            if (round > O.rounds) return Promise.resolve();

            const stubborn = round === 1 ? targets.slice() : targets.filter((t) => t.score > O.targetScore);
            if (!stubborn.length) return Promise.resolve();

            progress('rewrite', 'Round ' + round + ' — generating rewrites for ' +
              stubborn.length + ' segment' + (stubborn.length === 1 ? '' : 's') + '…',
              { round: round, total: O.rounds });

            /* Build the candidate rewrites for every stubborn segment. */
            return Promise.all(stubborn.map((seg) =>
              Promise.resolve(opts.generateVariants(seg, round))
                .then((variants) => ({ seg: seg, variants: (variants || []).filter((v) => v && v.text && v.text !== seg.current) }))
                .catch(() => ({ seg: seg, variants: [] }))
            )).then((jobs) => {
              const active = jobs.filter((j) => j.variants.length);
              if (!active.length) return;

              /* Score every variant of every segment in one batched pass. */
              const flat = [];
              active.forEach((j) => j.variants.forEach((v) => flat.push(v.text)));

              progress('evaluate', 'Round ' + round + ' — scoring ' + flat.length +
                ' candidate rewrite' + (flat.length === 1 ? '' : 's') + '…',
                { round: round, total: O.rounds });

              return detector.score(flat, (p) => progress('evaluate', 'Scoring rewrites…', p))
                .then((results) => {
                  let cursor = 0;
                  active.forEach((job) => {
                    let best = null;
                    job.variants.forEach((variant) => {
                      const r = results[cursor++];
                      const score = r ? r.score : 1;
                      if (!best || score < best.score) best = { variant: variant, score: score };
                    });
                    if (!best) return;

                    const improvement = job.seg.score - best.score;
                    job.seg.history.push({
                      round: round,
                      tried: job.variants.length,
                      from: job.seg.score,
                      to: best.score,
                      kept: improvement >= O.minImprovement
                    });

                    /* Only keep a rewrite that actually moves the number. */
                    if (improvement >= O.minImprovement) {
                      job.seg.current = best.variant.text;
                      job.seg.changes = best.variant.changes || [];
                      job.seg.score = best.score;
                    }
                  });
                });
            }).then(() => runRound(round + 1));
          }

          return runRound(1).then(() => ({ state: state, scored: scored, targets: targets }));
        })
        .then((ctx) => {
          /* ---------- 4. reassemble and score the finished document ---------- */
          const edited = ctx.targets.filter((t) => t.current !== t.original);
          const finalText = applyReplacements(
            text,
            edited.map((t) => ({ start: t.start, end: t.end, text: t.current }))
          );

          if (finalText === text) {
            state.documentAfter = state.documentBefore;
            return finish(ctx, finalText);
          }

          progress('verify', 'Scoring the rewritten document…');
          return detector.score([finalText]).then((after) => {
            state.documentAfter = after[0];
            return finish(ctx, finalText);
          });
        });

      function finish(ctx, finalText) {
        const changes = [];
        ctx.targets.forEach((t) => (t.changes || []).forEach((c) => changes.push(
          Object.assign({}, c, { segment: t })
        )));

        state.calls = detector.stats.calls;
        state.cached = detector.stats.cached;
        state.engine = detector.active.id;

        progress('done', 'Finished.');

        return {
          text: finalText,
          changed: finalText !== text,
          segments: ctx.scored,
          targets: ctx.targets,
          changes: changes,
          documentBefore: state.documentBefore,
          documentAfter: state.documentAfter,
          engine: state.engine,
          degraded: state.degraded,
          calls: state.calls,
          cached: state.cached
        };
      }
    }
  };
})();
