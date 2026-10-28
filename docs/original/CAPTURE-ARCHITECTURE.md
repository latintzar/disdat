# Dis Dat — Capture Architecture & Honest Fidelity

> This document is written to be true, not to sell. If a claim isn't backed by the
> shipped code, it isn't here. Where we mirror rather than regenerate, we say so.
> Where capture is lossy, we flag it.

## The problem

A coding agent that can fix your UI usually can't *see* what you're reacting to.
It gets a screenshot or a vague sentence ("make this less cramped"), runs no
JavaScript, has no GPU, and often sits on a datacenter IP that gets `403`'d by the
sites it needs to read. So it guesses.

Dis Dat removes the guessing for the **specific thing you pointed and talked at**.

## The model: capture-as-ground-truth, mirror-as-runtime

There are two distinct deliverables. We keep them separate on purpose, because
conflating them is how tools start lying.

### 1. The recipe (grounding for the agent)

When you point/talk at an element, Dis Dat reads it **in your live, post-JS browser**
and emits a compact, structured note for the few elements you actually engaged with
(dwell-scored, not the whole page):

- exact DOM selector + accessibility role/name
- the **resolved computed styles and box model as rendered** (the real numbers the
  browser painted)
- the animations **currently running** on that element (`getAnimations()` timing +
  keyframes)
- framework component + props/state, and a build-time **source pointer** (`file:line`)
  when the page's own JS world exposes one
- network response **shapes** and console errors
- the element's HTML, and the URLs (with dimensions/alt) of its images, background
  images and videos; inline SVG serialized as source

The agent receives this instead of pixels. It jumps to the right code and matches the
look. This is the honest, shippable core — strictly better than a screenshot.

### 2. The mirror (a runtime the agent can actually load)

For full-site capture, Dis Dat closes the page's **asset/reference graph**: it walks
every URL the page fetches and recursively pulls the missing bytes **through your own
browser**, then re-serves the whole thing from one neutral, self-hosted copy.

This is a **high-fidelity mirror**. It is not regeneration. When a microinteraction or
a WebGL effect "just works" in the mirror, it works because the **original bundle is
re-served verbatim** and runs on the *viewer's* JS engine and GPU — not because we
recovered its logic into a recipe.

## How it de-risks the agent's four blind spots

| Blind spot | How Dis Dat removes it | Status |
|---|---|---|
| **JS render** | Capture is taken from the live, hydrated, post-JS browser; the mirror serves an already-rendered runtime. The agent never has to execute the app. | Real |
| **403 / CORS / datacenter IP** | Bytes are fetched **through your browser, on your residential IP, with your cookies/session**, then re-served with permissive CORS. Cookie-/referer-/hotlink-gated and datacenter-blocked assets come back cleanly. | Real |
| **GPU** | In the mirror, GPU output runs because the original WebGL/canvas bundle is re-served and runs on the *viewer's* GPU. | Real **for the mirror**; we do **not** capture shader source into a recipe |
| **Viewport / one-state** | We capture the state you rendered at your viewport, plus states you exercise during the session. | Partial — see fidelity matrix |

## Delivery

- **Recipe**: small structured note, gzipped. Honest caveat: a *scoped* component or
  section is sub-MB; a full complex SPA's computed-style dump can reach a couple MB
  gzipped, so we scope to the subtree you reacted to rather than the whole document.
  This is **not** a "KB seed that decompresses into a site" — it's a scoped state
  capture, and we size it honestly.
- **Bytes + mirror**: re-hosted to a neutral copy that serves cleanly to a datacenter
  agent (verified: direct-download returns `200` from datacenter IPs with no
  throttling). Set a sane expiry (hours, not minutes) so the agent doesn't race the
  copy's death.

## Honest fidelity matrix

**Faithful** = reproduced as-rendered. **Equivalent** = the agent rebuilds clean code
that matches. **Flagged** = captured as a reference with an explicit lossy flag, *not*
reproduced.

| Thing | Recipe (clean rebuild) | Mirror (re-served) |
|---|---|---|
| DOM structure of what you dwelled on | Faithful | Faithful |
| Computed styles / box model at your viewport | Faithful (one state) | Faithful |
| Design tokens / cascade / `var()` intent | **Flagged** (resolved to numbers unless we ship a `cssRules` pass) | Faithful |
| Responsive / breakpoint / container-query states | **Flagged** (only the triggered state) | Faithful |
| `::before` / `::after` decoration | **Flagged** unless queried | Faithful |
| Static raster + background images | Equivalent (URLs; bytes via residential re-host) | Faithful |
| Cookie-/referer-/hotlink-gated assets | Faithful (residential re-host) | Faithful |
| Running animations on the resting element | Faithful (as captured) | Faithful |
| **Microinteractions** (hover/scroll/drag logic) | **Flagged** ⟶ see asterisk | Faithful *only because the original bundle is re-served* |
| WebGL shader source / geometry | **Not captured** | Re-served (original) |
| Cross-origin canvas / tainted-canvas pixels | **Flagged** (unrecoverable by design) | Re-served (original) |
| `blob:` / MSE / HLS / DASH / DRM video | **Flagged** (reference URL only) | Best-effort via stream closure |
| Closed shadow roots | **Flagged** (`shadowClosed`) | Re-served if same-origin |
| Cross-origin iframes | **Flagged** (`crossOriginIframe`) | Re-served if reachable |
| Virtualized lists (react-window/tanstack) | **Flagged** (`virtualized`; only mounted rows) | Only mounted rows |

### The microinteraction asterisk (read this)

The recipe **does not capture behaviour**. There is no event-handler source
(`fn.toString` on a delegated React root returns React's synthetic-event dispatcher,
not your `onClick`), no untriggered `:hover`/`:focus`/`.is-error` CSS unless you walk
the stylesheets, and no scroll/IntersectionObserver/rAF logic. So:

- In a **mirror**, a microinteraction is faithful because the original minified bundle
  is re-served verbatim. That is mirroring — and re-serving someone else's bundle/media
  carries IP and expiry consequences.
- In a **clean rebuild from the recipe**, an untriggered microinteraction is **missing
  or guessed**, because it was never captured. We flag it; we don't fake it.

To partially close this gap without `fn.toString` (which delegation + minification make
unrecoverable), the honest upgrade is: (1) walk `document.styleSheets` and emit the
**matched `cssRules`** for the dwelled selector incl. `:hover`/`:focus`/`.is-*` variants
and pseudo-elements, so untriggered CSS states survive verbatim; and (2) record an
**interaction trace** — computed-style + `getAnimations()` diffs sampled across the
hover/scroll/click *you actually perform* — so behaviour is captured as observed
state-transitions, not handler source. Until those ship, we do not claim
"microinteractions."

## What we explicitly do NOT claim

- ❌ "Reproduction recipe" / "small KB recipe → MB site." It's a scoped state capture
  plus, optionally, a verbatim asset mirror. Not decompression.
- ❌ "WebGL shader source" and "event-handler source via `fn.toString`." Not captured.
- ❌ "Faithful reproduction of the site, down to microinteractions." We reproduce the
  state you rendered and the states you exercised; the rest is flagged.
- ❌ "One-click site cloner." It's a grounding tool for *your* agent rebuilding in
  *your* codebase, plus a mirror to see the original running. Re-serving an origin's
  bundle/media is a mirror, with the legal and expiry strings that implies.

## Summary

The defensible, true product is: **residential-IP capture of what you reacted to —
JS-rendered, GPU- and 403-de-risked — handed to your agent as ground truth, with an
optional neutral mirror so the agent can load the real runtime.** Everything in this
doc that is marked Real is in the shipped pipeline. Everything marked Flagged is
labeled, not faked. That distinction is the product's integrity, and it ships.

---

## The corrected claim (safe for disdat.dev — 100% true)

THE CORRECTED CLAIM (100% true; safe for disdat.dev):

"Dis Dat captures what you actually reacted to — point and talk at any element on any site, and it hands your coding agent the element itself, not a screenshot: the exact DOM selector and a11y role/name, the resolved computed styles and box model AS RENDERED, the running animations on that element, the framework component + props/state and a build-time source pointer (file:line) when the page exposes one, the network response shapes and console errors, the element's HTML, and the URLs (with dimensions/alt) of its images, background images and videos. Because the agent gets ground truth instead of a guess from pixels, it jumps straight to the right code and matches the look.

For full-site capture, Dis Dat fetches the real asset bytes THROUGH your own browser — on your residential IP, with your cookies and session — so cookie-, referer- and hotlink-gated assets, and assets that would 403 a datacenter agent, come back cleanly. It walks the page's reference graph until it's closed, then re-serves everything from one neutral self-hosted copy with permissive CORS. The result runs with JavaScript already executed, on no GPU, behind no 403 — three things a browserless agent can't do for itself.

What it does NOT do, and we won't pretend otherwise: it is not a one-click site cloner. It captures the state you rendered and the states you exercised, not your app's entire state space. Untriggered :hover/:focus/error/loading states, closed shadow roots, cross-origin iframes, virtualized rows you didn't scroll to, tainted-canvas/WebGL pixels, and DRM/streamed video are captured as references, flagged, not reproduced. Where a microinteraction is faithfully reproduced in a full-site capture, that is because the original bundle is re-served verbatim — a high-fidelity mirror — not because we regenerated its event logic from a recipe."

In one line: "High-fidelity, residential-IP capture of what you reacted to — JS-rendered, GPU- and 403-de-risked, handed to your agent as ground truth + a neutral self-hosted mirror. Not a recipe that regenerates microinteractions, and not a whole-app cloner." Drop from the page: "reproduction recipe," "WebGL shader source," "event-handler source / fn.toString," "tmpfiles ~1h," "KB recipe → MB site," and "faithful reproduction down to microinteractions."

---

## Biggest risk (and the fix)

THE BIGGEST REAL RISK (my bet on what quietly sinks it in production):

The mirror is a MIRROR, and that is the whole demo. Every "wow" moment — Ferrari's scroll-pinned hero, the hover spec-reveal, the THRON video player, the working microinteractions — survives ONLY because engine.mjs re-serves the original minified React/webpack bundle and the original CSS chunks byte-for-byte (confirmed: the manifest's framework.*.js is the verbatim 120KB React chunk with window.webpackJsonp; regen.py/build-mirror.py rewrite URLs and stub trackers but never regenerate a single line). The moment you put that artifact in front of an agent and ask it to PRODUCE CLEAN, OWNED CODE — the actual job ("rebuild this hero in our codebase") — there is no behaviour to work from: no handler source, no untriggered CSS states, no scroll/animation logic in the recipe. The agent either (a) re-ships the stolen opaque bundle (a legal/IP landmine — you're redistributing Ferrari's minified, copyrighted, possibly-licensed JS/media/fonts, and tmpfiles/origin copies expire or rot, so the "reproduction" silently dies in ~1h–24h), or (b) regenerates from the lossy computed-style snapshot and produces a one-viewport static shell with the microinteractions missing — the exact opposite of the headline. So the demo (mirror) and the product (agent regenerates clean code) are two different graphs, and the gap between them is invisible until a real user tries the second thing and gets the first. That gap, dressed up as "reproduction," is what burns the credibility — especially with a founder who has been burned and asked for no hype.

THE FIX (two moves, both honest and both cheap):
1) Re-scope the headline from "reproduction" to "grounding + mirror," and split the two cleanly on the page: (a) "ground your agent in what you reacted to" (the evidence/recipe — real, shippable, better than a screenshot) and (b) "see it running, JS+GPU+403 de-risked, via a neutral residential-IP mirror" (real) — and never let the halo of (b) imply the agent regenerated (a). Add explicit lossy flags to every capture (shadowClosed, crossOriginIframe, virtualized, canvasTainted, stateNotTriggered) so the agent — and the user — see the holes instead of a confident fake.
2) The ONE high-leverage capture upgrade that actually narrows the gap: stop dumping flattened computed longhands and instead walk document.styleSheets and emit the MATCHED cssRules for the dwelled selector, including :hover/:focus/:disabled/.is-* variants and ::before/::after. That recovers untriggered states and design-token/cascade intent verbatim — the difference between "static shell at one width" and "a real starting point for a clean rebuild" — without ever needing fn.toString (which event delegation + minification make unrecoverable anyway). Pair it with an interaction-trace (computed-style + getAnimations diffs sampled across hover/scroll/click the user performs) so behaviour is captured as observed state-transitions, not handler source. Until that ships, do not say "microinteractions."

---

## Adversarial scorecard (what holds / partial / bullshit)

SCORECARD — each axis rated against the actual artifacts on this box (ferrari manifest, the 556KB disdat.js bundle, build-mirror.py/regen.py/engine.mjs, both READMEs) plus the five skeptic line-cites.

- JS-render de-risk — HOLDS. Real and the strongest pillar. engine.mjs connects to the user's actual browser (puppeteer.connect localhost:9222) and captures the POST-JS rendered output + the asset closure; the agent never has to run JS. The mirror serves a fully hydrated page. This part is genuinely de-risked.

- GPU de-risk — PARTIAL (mirror) / BULLSHIT (recipe). On the ferrari mirror, GPU-dependent output works only because the ORIGINAL WebGL/canvas bundle is re-served verbatim and runs on the viewer's GPU — that's mirroring, not de-risking for a GPU-less agent. As a "recipe," there is NO getShaderSource anywhere in any artifact (grep=0 in the 556KB bundle and all capture scripts); shader source is not captured, and cross-origin canvas pixels are unrecoverable (tainted canvas → toDataURL throws). Claim of "WebGL shader source in the recipe" is vaporware.

- datacentre-403 de-risk — HOLDS. The single most defensible claim. engine.mjs comment lines 8-9 + the fetch at line 57 fetch every asset THROUGH the user's browser ("so cookies/tokens apply"), i.e. on the residential IP with the user's session, then re-serve locally with access-control-allow-origin:* (engine.mjs:118). Independently verified by skeptic #5: tmpfiles /dl/ returns 200 from a datacenter IP, 20/20, no throttle. Residential capture → neutral re-host genuinely dodges CORS/403/datacenter blocks. (Caveat: the actual re-host on disk is a same-origin /h/ manifest, NOT tmpfiles — see operational.)

- media/assets — PARTIAL. The bytes ARE captured for the ferrari mirror (3989 entries in manifest.json, each {f,ct} pointing at real re-hosted bytes under /h/; HLS hero video closed via hero-hls.json). So "we have the bytes, fetched on the residential IP" is TRUE for the puppeteer mirror pipeline. BUT in the shipped extension bundle there is NO byte capture at all (toDataURL/toBlob/createImageBitmap/arrayBuffer/drawImage all grep=0) — the extension ships origin URL strings. And blob:/MSE/DRM video and tainted canvas are unrecoverable by design. So: bytes-for-static-and-gated = real (mirror path); "all the bytes, always, in the extension" = false.

- CSS/structure/layout — PARTIAL. The mirror serves the original CSS chunks verbatim, so layout is faithful there. As a "recipe" (skeptic #2): only ~80 whitelisted computed longhands at ONE viewport, with none/auto/0px/normal DROPped — cascade flattened, var() tokens resolved away, no matched cssRules walk, no breakpoint/container-query/:has rules, pseudo-elements (::before/::after) never queried, outerHTML truncated. Looks right at one width; breaks responsively; design-token intent lost. Faithful as a MIRROR, lossy as a RECIPE.

- animations — PARTIAL → leaning BULLSHIT for the claim. getAnimations() IS real in the dissected content.js (skeptic #3 confirms content.js:369) — but it is grep=0 in the 556KB bundle actually on this box, so it may not be in the shipped web build. Even where present, getAnimations() only returns animations RUNNING on the resting element at the dwell instant; :hover/scroll-driven/state-transition animations that aren't currently playing are not captured. Resting CSS transitions and keyframes that fire on interaction are missed.

- WebGL — BULLSHIT. getShaderSource grep=0 across every artifact and all six versions per skeptic #2. Shader source is not captured; geometry is not readable; cross-origin canvas is tainted. The "WebGL shader source" pillar does not ship. Mirror re-serves the original WebGL bundle, which is a different thing.

- MICROINTERACTIONS — BULLSHIT (the headline lie). This is where the claim collapses. The recipe stores ZERO behaviour: no fn.toString handler source (grep=0; listenersFor returns only event-TYPE strings like "click"), no untriggered :hover/:focus/:active/.is-error CSS (computed styles read the resting element only; document.styleSheets/cssRules is never walked), no scroll-timeline/IntersectionObserver/rAF logic. On real React/Next targets, fn.toString on the delegated root returns React's synthetic-event dispatcher, never the app's onClick. Microinteractions "work" in the ferrari demo ONLY because the original minified bundle is re-served verbatim — mirroring, not "an agent regenerating microinteractions from a KB recipe." Concrete kill: ask the agent to rebuild Ferrari's scroll-pinned hero from the recipe WITHOUT the original bundle — it has nothing and must guess.

- capture-completeness — PARTIAL. Honest scope = "what you dwelled on + states you actually exercised." Structural blind spots, all code-confirmed by skeptic #4: closed shadow roots serialize as empty hosts; cross-origin iframes are opaque to elementsFromPoint/outerHTML; virtualized lists yield only the ~10 mounted rows; capture is a dwell-scored top-12, not the page. "Faithful reproduction of the site" overreaches; "the few elements you pointed at, plus states you triggered" is true.

- operational/temp-host — PARTIAL. Re-host works and serves cleanly to datacenter agents (verified). BUT (a) tmpfiles grep=0 across the whole tree — the actual artifact uses a same-origin /h/ manifest, not tmpfiles, so the "tmpfiles ~1h expiry neutral copy" specifics are not what ships; and (b) "small gzipped KB recipe → MB site" is false at page scale: full getComputedStyle is ~5.6MB→622KB gzip for 600 nodes, ~23.5MB→2.3MB for a 2500-node SPA (~6M tokens) — the agent drowns in a DOM-state dump, the literal inverse of "decompress a seed." The pipeline is shippable; the "tiny recipe" framing is not true.

---

_Source: 6-agent adversarial teardown, 2026-06-17. This doc CORRECTS the earlier aspirational plans (GROUND-TRUTH-CAPTURE-PLAN.md, WEBGL-REPRODUCIBILITY-VERDICT.md) — where those describe a 'recipe' that regenerates microinteractions or captures shader source in the shipped extension, this doc is the authority: that is not what ships._


---

# Function-heavy apps: the get/not-get boundary

_(adversarial pass, 2026-06-17 — grounded against claude.ai + a dating app)_

**The boundary, one sentence:** Dis Dat sees everything on the *client side of the glass* — the exact pixels, the component prop/state contract, and a shadow-map of the API contract for the surfaces you actually clicked — and *nothing* on the server side of it: it captures the backend's **shapes (keys + types), never its code and never its data**, so the closer your target gets to its server brain, the more "copy claude.ai / copy Hinge" quietly turns into "build your own that happens to match its shapes."

**The honest framing to set before anyone builds:** you clone the **feel** and the **API surface**; you **rebuild the brain yourself, guided by observed behaviour, not copied from it.** A capture is a photograph of the front end plus a partial fingerprint of the contract — from which a competent agent can stand up a fully working app, but every line of server logic, the entire retrieval/ranking/memory engine, and the real dataset are *invented by your agent to satisfy the captured shapes*, not recovered. You cannot reverse a brain from its mouth. Dis Dat is a **specification instrument, not a code exfiltrator**: it tells the agent precisely *what to build* where that's hard to guess (look, contract, component identity), and the agent already knows *how to build* the convergent rest.

## THE MATRIX — Dis Dat v0.9.1, 10 layers, one blunt line each

| # | Layer | Rating | The blunt line |
|---|-------|--------|----------------|
| 1 | Visual look (resting pixel) | **GET** | Real computed styles + authored CSS rule-text + screenshot + WebGL shaders — exact numbers, not eyeballed; the tool's strongest layer and the one an agent can't guess. |
| 2 | Micro-interactions / feel | **PARTIAL+** | Hover/focus/anim rule-text + keyframes/timing on resting elements — but untriggered states and gesture-coupled physics (drag springs, fling damping) are invisible; agent rebuilds category-correct feel, not the exact bounce. |
| 3 | Component structure | **GET (dev) / PARTIAL (prod)** | React/Vue fiber hands you the component's prop+state contract — the single most valuable cloning artifact; minified prod gives mangled names + shapes, not the clean tree. |
| 4 | Client state shape | **PARTIAL** | One-instant snapshot of one component's local state shape — never the store topology, selectors, reducers, or the state *machine*; shape transfers, transition logic doesn't. |
| 5 | API / network contract | **GET (exercised calls only)** | fetch/XHR hooked → method + URL + request shape + response SHAPE (keys+types) + status + timing = a near-complete typed API spec; residual is exercised-only coverage and bodies-not-shapes. |
| 6 | Real-time (WS / SSE) | **NOT-GET ⚠️** | WebSocket/SSE message frames are not hooked in v0.9.1 — for any live app the actual product behaviour lives in the frames and the channel is dark; agent invents a protocol, can't match the real one. |
| 7 | Auth / session | **NOT-GET (shape rides along)** | You see "requests carry a Bearer token / session cookie," never how it's minted, refreshed, or validated — but auth is the most convergent subsystem, so competence closes it fully from a one-liner. |
| 8 | Business / backend logic | **NOT-GET (by design)** | Server code and handler source are out of scope; two endpoints with identical shapes can hide totally different logic — commodity CRUD closes by competence, the differentiated algorithm (the moat) is unrecoverable. |
| 9 | Actual data | **NOT-GET (schema, not corpus)** | Response shapes + one visible row leak through; never the dataset, distribution, or volume — schema rebuilds faithfully, data realism must come from you (correct privacy posture). |
| 10 | Bundled JS behaviour | **PARTIAL (shape) / NOT-GET (source)** | You get the behaviour's observable contract (events in → state change + network calls + animation out) but never the algorithm between — generic behaviour reconstructs, bespoke client logic is silhouette only. |

## FEEL vs FUNCTION — the two examples, spelled out

### Copy how Claude works (chat + streaming + session memory)
- **FEEL — essentially fully recoverable (~95%).** Chat UI is the agent's home turf, and here it isn't guessing: it has real color tokens, real rule-text, the message-bubble treatment, the type ramp, and the live "thinking" / cursor / fade-in animations via getAnimations. The streaming *visual* (append tokens, blink cursor, re-parse markdown each flush) reconstructs trivially. Caveat: long-tail states you never triggered — error toast, rate-limit banner, share modal, artifact panel — come back *correct-shaped* from the agent's general competence, not *claude.ai-identical*.
- **FUNCTION — API-shape YES, server-algo NO.**
  - **API surface:** GET (for surfaces you exercised). The fetch/XHR hook logs `/chat_conversations`, `/completion`, `/chat_messages` etc. with request + response shapes — a real skeleton your backend fits to. Conversation store, list/create/append/branch all reconstruct on the captured shapes.
  - **Streaming protocol:** reinvented, not recovered. You get an equivalent `text/event-stream` SSE layer that works great; you do NOT get Anthropic's exact event taxonomy (`message_start` / `content_block_delta` / `message_stop` / `ping`) byte-for-byte — that's frame-grammar, only partial even when hooked.
  - **Session MEMORY — the ceiling, 0% recoverable as a copy.** Dis Dat captures at most the *skin* of memory (a "memory updated" chip, a settings toggle, a memory-read endpoint's shape). It captures NONE of the brain: the retrieval pipeline, embeddings/vector store, recency-salience ranking, summarization-into-memory, consolidation, prompt assembly, token budgeting, the model + sampling params, and the stored memories themselves. (Same class of machinery as agentmemory's BM25 + local-embeddings recall + consolidation flags — invisible from a browser.) Your agent can build *a* real, working memory system (summarize → embed → retrieve top-k → inject), but it won't be Claude's algorithm and won't share a byte of its data. **Rebuildable as an equivalent, impossible as a copy.**

### Copy how a dating app works and feels (Hinge/Tinder/Bumble)
- **FEEL — very close (~90%).** Static card is near-pixel: exact dimensions, radii, shadows, the photo gradient overlay, entry easing — all captured. The swipe *gesture feel* lands ~90%: the capture gives listener types (`pointerdown/move/up`) + resting easing, and the agent fills the physics (velocity → rotation → spring → threshold → fling) from competence; expect "95% there, the last 5% of bounce is re-derived." Profile-card component is the strongest layer — fiber hands over `<ProfileCard name age photos prompts distance verified />`, the data contract itself. Someone using your clone says "this feels like Hinge."
- **FUNCTION — surface only.**
  - **API surface:** MEDIUM-HIGH for the *contract*, ZERO for the *data*. You get `GET /recs`, `POST /like|/pass → {matched: boolean, matchId?}`, `GET /matches` as typed shapes — a believable but empty API: correct menu, no food.
  - **Real-time match/chat:** LOW-fidelity copy. WS frames are unhooked, so you can't replicate their wire protocol (`new_match` / `typing` / `message` / `read_receipt`, ordering, heartbeat); the agent invents a sensible one. Functionally fine for a clone, useless for interop with their backend.
  - **Matching / ranking engine — total black box, 0%.** Who you're shown and in what order (Tinder's desirability ranking, Hinge's compatibility recommender, the reciprocity model, feature inputs, model weights) lives entirely server-side with no front-end vantage. The only inferable bit is the mutual-like→match *rule*, and you read that off the `matched: boolean`, not off any algorithm. The agent builds *a* recommender — a different brain wearing the same face.

**The shared verdict:** in both cases the FEEL is the win (90–95%), the API SURFACE is a real shadow-map for the parts you clicked, and the part that *is* the product — Claude's memory brain, Hinge's matching engine — is exactly the part that does not come through the wire. You ship something that looks and behaves like the original and is hollow precisely where the moat is.

## What Dis Dat gets vs doesn't on function-heavy apps

Dis Dat captures what's on the **client side of the glass** and nothing on the server side of it. The blunt version: it hands your coding agent a faithful reproduction of the **front end** and a partial **map of the API contract** — endpoint paths plus payload shapes, for the surfaces you actually clicked — from which the agent can stand up a fully working app. But every line of **server logic, and every byte of real data, is invented by your agent to satisfy the captured shapes, not copied.** Dis Dat is a *specification instrument, not a code exfiltrator*: it tells the agent precisely what to build where that's hard to guess, and the agent already knows how to build the convergent rest.

### The layer-by-layer boundary

| Layer | What you GET | What you DON'T |
|---|---|---|
| **Visual look** | Exact computed styles + authored CSS rule-text + screenshot + WebGL shaders. The strongest layer — real numbers, not a guess. | One resting frame, not every breakpoint; cross-origin sheet *rule-text* (computed look still survives). |
| **Micro-interactions** | Hover/focus/`.is-*` rule-text, keyframes + timing on resting elements, listener *types*. | States you never triggered, and gesture-coupled physics (drag springs, fling curves) — agent fills category-correct feel, not the exact bounce. |
| **Component structure** | React/Vue **prop + state contract** — the most valuable cloning artifact. | The full tree (minified prod gives mangled names + shapes only); component methods. |
| **Client state** | A snapshot of one component's local state *shape*. | Store topology, selectors, reducers — the state *machine*. Shape transfers; transition logic doesn't. |
| **API contract** | Method + URL + request shape + **response shape (keys+types)** + status + timing, for **exercised calls**. | Endpoints you never hit; full bodies; enums/ranges/nullability nuance. |
| **Real-time (WS/SSE)** | Currently almost nothing — frames aren't hooked. | The message protocol: event types, envelope, sequencing, incremental-update grammar. Agent invents one. |
| **Auth / session** | That requests carry a token/cookie (transport shape). | How it's minted, refreshed, validated — fully closed by the agent's competence anyway. |
| **Backend logic** | Nothing direct — the observable silhouette (events → outcomes). | Validation, pricing/ranking/matching algorithms, business invariants. **The moat.** |
| **Actual data** | Response shapes + one visible row's values. | The dataset, distribution, volume — by design. Schema transfers; realism comes from you. |
| **Bundled JS behaviour** | The behavioural contract (events in → state + network + animation out). | Handler source — the algorithm between input and effect. |

### Where this lands in practice

- **Front end → near-faithful.** Look, layout, components, transitions, and the core interaction reconstruct to ~90–95%, because the capture nails static styles, authored CSS, animation timing, and component props — the un-guessable specification an agent would otherwise hallucinate.
- **API surface → a real shadow-map.** For the flows you exercised, you get a typed contract precise enough to fit a backend to. Operational rule: **exercise every state and fire every flow you want recovered — untriggered = uncaptured**, for both UI states and endpoints.
- **The brain → rebuilt, not copied.** The part that *is* the product — a memory/retrieval pipeline, a matching/ranking engine, a pricing model, the proprietary domain logic — lives behind an opaque HTTP boundary that emits only shapes. Your agent can build a real, working equivalent from its general competence, guided by the observed behaviour. It will not share a line of the original's logic or a byte of its data. **Rebuildable as an equivalent; impossible as a copy.**

### Two worked examples

- **Copy how Claude works:** front end and streaming *feel* clone faithfully; the API surface (conversations, completion, messages) comes back as fittable shapes; the SSE protocol is reinvented as an equivalent; and **session memory is the ceiling** — the retrieval/embedding/consolidation brain is invisible from a browser, so your agent builds its own memory system, not Claude's.
- **Copy a dating app:** the card, swipe feel, and profile component clone to ~90%; the swipe/match/chat API comes back as believable-but-empty shapes; the real-time chat protocol is invented (WS frames aren't captured); and **the matching engine is a total black box** — the only recoverable bit is the mutual-like→match *rule*, read off a `matched: boolean`, never the ranking algorithm.

### The honest line

The closer your target gets to its differentiated server brain, the more "copy it" quietly becomes "build your own that matches its shapes." Dis Dat is strongest exactly where an agent is weakest — the surface and the contract — and it's silent exactly where the product's real value lives. That's the boundary; build with it in view.

*Roadmap note: hooking WebSocket/SSE frame capture (emitting frame shapes, same keys-not-bodies discipline as the fetch/XHR hook) is the highest-value addition — it's the only common behaviour layer general competence can't substitute for, and it converts real-time from NOT-GET to roughly the API contract's GET.*

---

## Highest-value capture upgrade (roadmap)

## THE ONE HIGH-VALUE CAPTURE ADD

**Hook WebSocket/SSE message frames — mirror the existing fetch/XHR hook onto `WebSocket.prototype.send` / `onmessage` and `EventSource`, emitting frame SHAPES (keys + types) on the same shape-not-body, privacy-preserving basis as network responses.** Pair it with a lightweight **interaction trace** (an ordered log of the gestures/states the user exercised) so the agent knows which states were actually frozen versus inferred.

**Why this is the single highest-ROI addition, concretely:**
1. **It's the only NOT-GET layer that is both common AND fixable.** Behaviour-heavy apps are disproportionately real-time (live chat, collaborative editing, presence, token streaming, multiplayer, live notifications) — Layer 6 is not an edge case, it's the spine of exactly the apps this question is about.
2. **It's the only behaviour gap general competence provably CANNOT close.** Auth, CRUD, and generic streaming the agent rebuilds correctly from a one-line intent, so those NOT-GETs don't hurt. But a real-time *protocol is arbitrary and unobservable from the DOM* — the agent can only invent one, which is right for a greenfield clone and wrong the moment you need to match or interoperate with the real backend. This is where the gap between "looks right" and "is right" is widest and least visible.
3. **It's mechanically a near-clone of a hook that already exists and already proved out.** Same instrumentation pattern, same keys-not-bodies discipline, same privacy posture as the fetch/XHR hook. Low build cost, high coverage gain — it converts Layer 6 from NOT-GET to roughly Layer 5's GET.

**What it unlocks:** the real-time event taxonomy and envelope shapes — `new_match` / `typing` / `message` / `read_receipt` for the dating app; `message_start` / `content_block_delta` / `message_stop` / `ping` for Claude's stream. The agent goes from inventing a plausible protocol to reconstructing the *observed* one, so streaming chat, presence, and live updates rebuild against the actual wire contract instead of a guess.

**What it explicitly does NOT unlock (keep expectations honest):** it still gives *shapes, not logic and not data*. It will not surface the matching algorithm, the memory retrieval pipeline, server flush cadence/backpressure, reconnection-resume semantics, or any stored corpus — those stay on the far side of the glass by design, and the proprietary ones (the ranking model, the memory brain) are the moat that should never be captured. The add widens the *contract* boundary one full layer; it does not move the *brain* boundary, because nothing client-side ever can.

*(The cheap operational complement, no code needed: tell users to exercise every state and fire every flow they want recovered before capturing — untriggered = uncaptured, on both states and endpoints.)*
