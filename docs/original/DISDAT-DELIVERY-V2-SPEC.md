# DisDat capture → delivery v2 — executable spec

_Spec'd 2026-06-18 (via /gstack-spec, adapted: spec drives the build, not a GH issue). Decisions locked
with the founder. Source of the gaps: DISDAT-FIDELITY-ROADMAP.md._

## Why
Capture is greedy-cheap to build (AI codes it) but the *consuming* agent pays runtime tokens to ingest a
big blob. v1 stuffs everything into one bundle + a long ground-truth wall on the clipboard. v2: capture
MORE (close the audit's capture gaps), deliver it as a **menu of separately-downloadable artifacts** so
the agent fetches only the depth its task needs, and shrink the paste to **≤20 lines of codespeak + the
full transcript + the menu**. North-star: the paste reads like a brief handed to a 10x engineer who will
go *see the computer-stuff* to rebuild the architecture + feel + outcomes the user reacted to.

## Locked decisions
- **D1 — 5 grouped artifacts** (not 8, not 2): `core` · `dom` · `screenshots` · `assets` · `sources`.
  `core` = codespeak + FULL transcript + elements + network + state + timeline (small, always-grab). The
  heavy/optional layers are their own files. ~5 uploads/capture.
- **D2 — skip cookies + auth-ish keys.** Capture localStorage/sessionStorage only; **skip cookies
  entirely**, and **drop any key matching `/token|auth|session|secret|key|jwt|bearer|password|credential/i`**
  AND any value that looks like a JWT / long high-entropy secret. Nothing secret reaches the public URL.

## What v2 delivers

### Delivery (A1/A2) — the menu
1. At Stop, build 5 artifacts; gzip + upload each **non-empty** one (bg, parallel, the existing 3-host
   retry per file). `core` is mandatory; if `core` upload fails, fall back to the v1 inline ground truth.
2. The clipboard = **≤20 lines**: the codespeak prose + a one-line transcript pointer + the MENU (one row
   per artifact: name · size · one-line "grab-when" · URL) + a per-intent **recommendation** line.
3. Menu row format: `core   18KB  codespeak+transcript+elements+API+state   [always]   <url>`.
   Recommendation (static, by intent): _"clone the look → core + assets + screenshots; rebuild behaviour →
   + sources + dom; wire the data → core (has network+state)."_
4. The FULL transcript lives in `core` (keeps the paste tight); the paste shows only the crunched codespeak
   + `"full transcript + N elements in core"`.

### Capture-more (B*) — each becomes/feeds an artifact
- **B1 state** → `core.state`: localStorage + sessionStorage, D2-redacted.
- **B2 assets** → `assets{}`: re-host image (`<img>` currentSrc + CSS background-image) + font (woff2 from
  `document.fonts`/loaded faces) + external-SVG **bytes** as base64, via bg (host perms, past CORS). Capped
  (per-file 2MB, total 6MB), only first-party + the page's asset CDN, skip analytics. Mirrors `pullSource()`.
- **B3 dom** → `dom`: a bounded, script/style-stripped serialization of `document.documentElement`
  (node-capped, e.g. ≤4000 nodes / ≤600KB), so structure/order/un-engaged regions are present.
- **B4 head-meta** → `core.head`: title, meta (description/viewport/theme-color), OG/Twitter, canonical,
  JSON-LD. Cheap document.head read.
- **B5 soft-nav** → hook history.pushState/replaceState so SPA route changes are recorded (today only hard
  loads re-inject).

Deferred to a v2.1 follow-up (trickier, own pass): rAF/motion sampler (played-timeline), global-store
snapshots (Redux/Zustand/Apollo). Noted so they're not silently dropped.

## Acceptance criteria
1. The clipboard paste is **≤20 lines** for a typical capture (measured), contains the codespeak + the menu
   + a recommendation, and references the full transcript (which is present in `core`).
2. A capture produces ≥2 artifact URLs (core + at least one heavy) when the page has assets/screenshots;
   each URL fetches a valid gzipped JSON of just that layer.
3. `core` JSON contains: prose, transcript (full), elements[], network[], state{}, head{}, timeline.
4. `state{}` never contains a JWT/bearer/api-key/cookie — verified by re-capturing a page with an auth
   token in localStorage and confirming it's absent/redacted in the artifact.
5. `assets{}` carries real image/font BYTES (base64) for first-party assets, capped at 6MB total, with a
   logged count of what was dropped over budget (no silent truncation).
6. `dom` carries the full document structure (not just engaged els), node-capped, truncation noted.
7. If `core` upload fails, the paste falls back to the v1 inline ground truth (never non-functional).
8. Versions stay unified (manifest = bundle-meta = doc).

## Files
| File | Change |
|---|---|
| `ext-pointtalk/content.js` | `captureState()`, `collectAssetUrls()`+`pullAssets()`, `captureDOM()`, `captureHead()`, soft-nav hook; rewrite `packageBundle()` → 5 artifacts + `menuBlock()`; transcript into `core` |
| `ext-pointtalk/background.js` | `fetchAssets()` (binary→base64, capped); `uploadArtifacts()` (parallel multi-upload, reuse per-file 3-host retry); `case 'bundleMulti'` |
| `ext-pointtalk/manifest.json` | version bump |
| `DISDAT-FIDELITY-ROADMAP.md` | tick A1/A2/B1/B2/B3/B4/B5 |

## Out of scope (this pass)
rAF/motion played-timeline, global-store snapshots, IndexedDB, WebGPU, worker-realm capture, video frame
grabs — tracked in the roadmap, not built here.
