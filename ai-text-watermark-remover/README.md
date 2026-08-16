# AI Text Watermark Remover

A free, static, browser-based tool that estimates where statistical watermark pressure is concentrated in a
passage of text, highlights the 3–5 load-bearing segments, and rewrites them with meaning-preserving synonyms.

No build step. No framework. No backend. Three files do the work.

---

## How it works

1. **Tokenize & segment** — the text is split into sentence-sized segments with exact character offsets.
2. **Score** — every token is hashed together with its predecessor to decide green-list membership, reproducing the
   green/red partition used in text-watermarking research. Each segment gets a z-score
   `z = (green − γT) / sqrt(Tγ(1−γ))` with `γ = 0.5`.
3. **Select** — segments are ranked by a blend of their detection confidence and their density of replaceable
   content words. 3–5 are chosen by weighted random draw from the top of that ranking, so repeated runs vary.
4. **Rewrite** — inside the selected segments only, content words are replaced with synonyms. Candidates that flip
   the token (and its successor) out of the green list are preferred, because that is what actually moves the
   statistic.

> **On the numbers.** Without the generating model's private key this is a *proxy* detector. The maths is the real
> green-list z-test, but the key is not the one any vendor used, so the score is an estimate of watermark pressure —
> not a verdict from a specific detector. The UI says so too.

### Why substitutions stay grammatical

Naive synonym swapping produces garbage ("artificial intelligence" → "near word"). The pipeline blocks that with
layered guards:

| Guard | What it prevents |
| --- | --- |
| Curated dictionary first (463 vetted entries) | Distant WordNet senses on the most common words |
| Protected multi-word terms | Breaking "machine learning", "as a consequence", "decision makers" |
| `NEVER_REPLACE` set | Swapping domain nouns like *data*, *model*, *research* |
| Ambiguity gate (`CURATED_POS`) | "organizations **approach** their work" → "organizations strategy their work" |
| Part-of-speech match, single-sense only | "evidence" (noun) → "demonstrate" (verb) |
| Register band (0.15×–12× word frequency) | Archaic or over-general swaps (*privacy* → *concealment*) |
| Inflection match | "refining" → "refinement" |
| Sentence-initial + proper-noun skip | Mangling names and openings |
| Article repair | "as a consequence" → "as **an** outcome" |
| Real-word verification on re-inflection | "runned", "maked" |

Anything that fails a guard is simply left alone. Precision is preferred over coverage.

---

## Files

```
index.html          landing page + the tool (SEO, JSON-LD, FAQ)
API.md              detection-API contract and go-live checklist
assets/js/config.js     feature flags, endpoint, budgets — the only file to edit
assets/js/detector.js   detector interface: local estimate + official API
assets/js/optimizer.js  scan -> rewrite -> re-score -> keep the winner
functions/api/detect.js      Cloudflare Pages proxy (holds the key server-side)
netlify/functions/detect.js  Netlify equivalent
privacy.html        privacy policy
terms.html          terms of use
404.html            not-found page
robots.txt          crawl rules + sitemap pointer
sitemap.xml         three URLs
site.webmanifest    PWA manifest
assets/css/style.css
assets/js/app.js    all application logic
assets/img/         favicon.svg, og-cover.png
```

## Detection engines

The tool is written against one detector interface with two implementations:

| Engine | What it is | Cost | Status |
| --- | --- | --- | --- |
| `local` | green-list z-test in the browser | free | default, always available |
| `official` | a real detection API behind your own proxy | per vendor | built and tested, gated by one flag |

The scan → rewrite → re-score → keep-the-winner loop in `optimizer.js` is engine-agnostic, so it runs
identically on both. Turning the official engine on is a config change: see **[API.md](API.md)**.

## Dependencies

One, and it is optional: the free [Datamuse API](https://www.datamuse.com/api/) — no key, no account, generous
limits. Only individual words are ever sent. Turn the switch off in the UI and the tool runs fully offline on its
built-in dictionary.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deployment

See **[DEPLOY.md](DEPLOY.md)** for a step-by-step free hosting guide (Cloudflare Pages / Netlify / GitHub Pages)
plus the domain purchase and DNS steps.

Before going live, replace the placeholder domain `www.aitextwatermarkremover.com` everywhere:

```bash
grep -rl "aitextwatermarkremover.com" . | xargs sed -i "s/www\.aitextwatermarkremover\.com/YOUR-DOMAIN.com/g"
```

## Licence

Site content and source © its author. Datamuse is a third-party service under its own terms.
