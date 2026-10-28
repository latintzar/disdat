# Dis Dat — Full-Fidelity Ground-Truth Capture & Handoff (build plan)

Source: multi-agent design pass (2026-06-17). Stage 1 (verbatim ground-truth handoff + capture completeness) shipped in ext v0.8.0. Stage 2 = WebGL deep-capture (below), pending device verification + a pixel-hosting blob store.

I now have full, line-accurate grounding. There is no existing asset-fetch capability in background.js and no `captureVisibleTab` — both are net-new. The key architectural constraint is confirmed: **inject-main.js is injected at record-start, NOT `document_start`**, which is fatal for WebGL `getContext` hooking. This is the #1 thing the spec must fix.

Here is the build plan.

---

# Dis Dat ext-pointtalk — Full-Fidelity Capture & Handoff Build Plan

The whole gap reduces to two failures: (A) the WebGL/canvas/video/asset substrate is **never captured**, and the hooks that would capture it run **far too late**; (B) the rich facts that *are* captured are **funneled through a "few sentences of prose" LLM bottleneck** and never handed over verbatim. Fix A by moving the main-world shim to `document_start` and adding GL/canvas/media interception. Fix B by appending a structured, token-aware **GROUND TRUTH** block to the clipboard after the prose, and rewriting the crunch prompt to *reference* it.

---

## 0. THE ONE BLOCKING ARCHITECTURE FIX (do this first — everything in §1/§5 depends on it)

**Problem:** `inject-main.js` is injected via `injectShim` at `startRec()` (background.js:248-253, `world:'MAIN'`). By then the page's app code has long since called `canvas.getContext('webgl2', {preserveDrawingBuffer:false})`. Our `getContext` override never runs before the page's, so we can neither force `preserveDrawingBuffer` nor wrap the GL context. WebGL capture is **structurally impossible** in the current injection model.

**Fix:** register the main-world shim as a **declarative `document_start` content script in the MAIN world**, so the `getContext`/`texImage2D`/`shaderSource` hooks install before any page script. Split the shim into two halves:

- `inject-hooks.js` — NEW. The deterministic instrumentation only (getContext/GL-method/texImage2D/shaderSource/rAF wraps + a passive ring of captured GL state). Pure hooks, no recording logic, **gated behind a `__ddArmed` flag that defaults to installed-but-dormant** (hooks are present from page load but only *retain* data when armed; idle cost ≈ a thin wrapper + a bounded buffer). Registered in `manifest.json` `content_scripts` with `world:"MAIN"`, `run_at:"document_start"`, `all_frames:true`, `matches:["<all_urls>"]`.
- `inject-main.js` — KEEP. The existing fetch/console/listener/framework bridge. This one can stay lazy (injected at record-start) because none of its hooks need to beat the page — but **move it to the same declarative `document_start` MAIN-world registration too** while you're there, so network/console capture also starts from byte 0 (today it misses everything before record-start). Gate its retention on the existing `recOn` flag (already does this).

**manifest.json change** (add a `content_scripts` block; keep `inject-main.js` in `web_accessible_resources` for the `injectShim` fallback path):

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["inject-hooks.js", "inject-main.js"],
    "run_at": "document_start",
    "world": "MAIN",
    "all_frames": true
  }
]
```

Keep `injectShim` in background.js as a **defensive re-inject** for tabs that were already open when the extension loaded (declarative scripts only apply to navigations after install). Make it idempotent — both shims already guard on `window.__disdatShim` / a new `window.__ddHooks`.

> ⚠️ **VERIFY ON DEVICE (highest risk):** MV3 `world:"MAIN"` + `document_start` declarative content scripts are Chrome 111+. Confirm the `getContext` override actually beats three.js/OGL on a real site (test: load disdat.dev/research orb and `ferrari.com/.../ferrari-luce` and check `canvas.__ddForced === true`). If a strict-CSP site blocks the world-MAIN script, fall back to the `injectShim` path and accept that `preserveDrawingBuffer` can't be forced there (degrade to Tier-2 `captureVisibleTab`, §5).

---

## 1. CAPTURE UPGRADES

### 1a. WebGL — new file `inject-hooks.js` (MAIN world, document_start)

Self-contained IIFE, `if (window.__ddHooks) return; window.__ddHooks = true;`. Installs at module top:

**`getContext` override** — for `webgl`/`webgl2`/`experimental-webgl`, force `attrs = {...attrs, preserveDrawingBuffer:true}`, call the real getContext, tag `canvas.__ddCtx = ctx; canvas.__ddType = type; canvas.__ddForced = true;`, register the canvas in a module-level `Set ddCanvases` (use a `WeakRef` set + periodic prune, or a plain `Set` cleared on session reset). Then call `instrumentGL(ctx)`. Also tag `'2d'` and `'bitmaprenderer'` contexts (no preserve needed) so canvas enumeration is complete.

**`instrumentGL(gl)`** — wrap, keyed on the context (store the log on `gl.__ddGL = {programs:new Map(), textures:[], drawCount:0, lastShaderSrc:[]}`):
- `shaderSource(shader, src)` → store `src` on `shader.__ddSrc` (lossless GLSL — the highest-value artifact).
- `attachShader(prog, shader)` / `linkProgram(prog)` → on link, resolve `gl.getAttachedShaders(prog)` → `gl.getShaderSource(sh)` for vertex+fragment, store `{vertex, fragment}` in `programs.get(prog)`. (Belt-and-suspenders: `getShaderSource` works even if we missed `shaderSource`.)
- `texImage2D`/`texSubImage2D`/`compressedTexImage2D` → capture the *source* at upload: if arg is `<img>`/`ImageBitmap`/`<canvas>`/`<video>` record `{kind, w, h, srcUrl?}`; if a typed array, record `{kind:'buffer', byteLength, format, w, h}`. Do **not** try to snapshot pixels here (too hot) — record provenance only.
- the `draw*` calls (`drawArrays`, `drawElements`, `drawArraysInstanced`, `drawElementsInstanced`) → `gl.__ddGL.drawCount++`; on the **first draw of a frame** (track an rAF-scoped flag), capture the active program (`gl.getParameter(gl.CURRENT_PROGRAM)`) + its uniforms (`ACTIVE_UNIFORMS` → `getActiveUniform` → `getUniform`, capped ~40, values truncated) + GL state snapshot (`blend`, `blendFunc`, `depthTest`, `cullFace`, `viewport`, `scissor`) once per capture.

**`requestAnimationFrame` wrap** (the readback-timing safety net for the no-preserve fallback): `window.requestAnimationFrame = cb => realRAF(t => { cb(t); /* still inside the page's frame task → buffer valid */ if (window.__ddCaptureNow) { for (const c of ddCanvases) snapshotCanvas(c); window.__ddCaptureNow=false; } })`. Normally dormant; content side sets `__ddCaptureNow=true` to request a flush.

**`snapshotCanvas(canvas)`** — the actual pixel grab, called on demand from content side (`window.postMessage({__disdat_glcap:{selectorToken}})`, handled in `inject-hooks.js`):
1. Try `canvas.toDataURL('image/png')` (works because we forced preserve, or for 2D canvases natively). 
2. On `SecurityError` (tainted cross-origin) → set a `tainted:true` flag and return null pixels (content side falls back to `captureVisibleTab`, §5/§1f).
3. Resize guard: if `canvas.width*canvas.height > ~4MP`, downscale to a 1600px-max thumbnail via an offscreen 2D canvas before `toDataURL` (keeps payload bounded; record `internalSize` separately so the agent knows true resolution).
Post back `{__disdat_glres:{token, dataUrl, w, h, internalSize, contextType, tainted, scene:{drawCount, programs:[{vertex,fragment,uniforms:[…]}], textures:[…], glState}}}`.

> ⚠️ **VERIFY ON DEVICE:** `readPixels` is bottom-up/row-flipped; `toDataURL` is the safer path (compositor handles orientation). Confirm orb capture is upright and non-black. Confirm OffscreenCanvas-in-Worker WebGL (some map-GL libs) — those won't be hooked from the page world; record `offscreenWorker:true` and rely on `captureVisibleTab`. Flag both as known-lossy in the manifest.

### 1b. `<canvas>` 2D & `<video>` snapshots — `inject-hooks.js` + `content.js extract()`

- **2D canvas**: `toDataURL('image/png')` (no preserve issue), with the same 4MP downscale guard.
- **`<video>`**: in `content.js assetOf()` (line 348), upgrade from URL-only to: draw current frame to an offscreen 2D canvas at `videoWidth×videoHeight` → `toDataURL` (downscaled), plus capture `{currentSrc, currentTime, duration, videoWidth, videoHeight, paused, readyState}`. On `SecurityError` (cross-origin/DRM) set `tainted:true` / `drm:true` and skip pixels. (HLS `blob:`/MSE video tainting is common — expect the screenshot fallback to carry these.)

### 1c. Complete computed styles — `content.js` line 312 (`KEEP`) + `extract()`

The 45-prop `KEEP` list silently drops anything not enumerated (e.g. `gap` row/col split, `inset`, `aspect-ratio`, `gradient` color-stops live, `text-shadow`, `font-variation-settings`, `clip-path`, `mask`, `-webkit-text-fill-color`, scroll-snap, `will-change`, `outline`, `text-decoration`, `white-space`, `text-transform`, `writing-mode`, logical props). Two changes:
1. **Extend `KEEP`** with the missing high-value paint/layout props (add ~25: `inset, aspect-ratio, gap, row-gap, column-gap, grid-template-rows, grid-auto-flow, place-items, place-content, clip-path, mask, mask-image, -webkit-mask-image, text-shadow, text-decoration, text-transform, white-space, word-break, outline, outline-offset, will-change, scroll-snap-type, font-variation-settings, font-feature-settings, -webkit-text-fill-color, -webkit-text-stroke, writing-mode, direction, visibility, pointer-events, user-select, content`).
2. **Capture pseudo-elements** when present: `getComputedStyle(el,'::before')` / `'::after'` — if `content` is not `none`/`normal`, capture a small subset (`content, background, background-image, color, transform, width, height, position`). Pseudo backgrounds are where a lot of "this glow / this underline" lives.

Keep the `DROP` default-filter so this stays token-cheap — only non-default values survive.

### 1d. Every asset URL — `content.js assetOf()` (line 345) → broaden to a per-element asset list

Currently returns a single asset. Replace with an array collecting ALL of:
- `<img>`: `currentSrc`, `srcset` (parse to the displayed candidate), `naturalW/H`, `alt`.
- `<video>`/`<source>`/`<audio>`: each `src`/`currentSrc`.
- computed `background-image` (handle **multiple** comma-separated layers, not just the first `url()`), `mask-image`, `-webkit-mask-image`, `border-image`, `list-style-image`.
- **Inline SVG**: replace the `{kind:'svg'}` flag with `new XMLSerializer().serializeToString(svgEl)` (capped, see §1g) — this is *source*, the Ferrari wordmark lesson (inline SVG has no URL).
- gradients: keep the verbatim string (reproducible CSS, no fetch needed).
- **Resolve every relative URL against `document.baseURI`** (and for CSS `url()` in a `<link>`ed sheet, against that sheet's `href` — the fonts lesson). Use `new URL(raw, base).href`.

Each asset: `{role:'img'|'bg'|'mask'|'video'|'svg-inline'|'gradient', url?, markup?, w?, h?, alt?}`.

### 1e. Fonts — `content.js pageContext()` (line 81) → richer font manifest

Today: just family names (≤12). Upgrade to a **session-level font manifest** built once at stop: walk `document.fonts` (FontFaceSet) → for each `FontFace` record `{family, weight, style, status}`; and walk `document.styleSheets` `@font-face` rules → extract `src url(...)` (resolved against the sheet's base) keyed by family/weight. Also record per-reacted-element the **actually-applied** `font-family` (already in computed). Result: the agent gets `{family, weight, style, src:URL, status:'loaded'}` — enough to re-host the real face, and the `status` field is the "don't ship Times New Roman" guard.

### 1f. `captureVisibleTab` ground-truth screenshot — NEW, background.js + content.js

The unconditional safety net (composited pixels regardless of preserve/taint/DRM/WebGPU). New background handler `case 'shot'` → `chrome.tabs.captureVisibleTab(null, {format:'png'})` → return dataUrl. Content side calls it **once at stop** (and once per reacted-to canvas/video region if you want crops — v1: one full-viewport shot). Store as a session-level `fallbacks.tabScreenshot`. **Always include it**, even when per-canvas capture succeeded — it's the agent's "this is what it actually looked like" and it correlates to every element's `rect`.

> ⚠️ **VERIFY ON DEVICE:** `captureVisibleTab` needs `activeTab` (have it) but only fires on a user-gesture-active tab and returns the **visible viewport only** (DPR-scaled). Confirm it doesn't throw on the target and that DPR scaling lines up with element `rect`s. Background tabs throttle/forbid it — capture must happen with the tab foregrounded (it is, at stop).

### 1g. Bounded outerHTML — `content.js htmlSnippet()` (line 355)

Raise the cap from 500 → **2000 chars** for the *reacted-to* element, and for SVG capture the full serialized markup up to ~6000 chars (SVG is source, worth more). Strip the temporary `data-dd-fw-*` attribute before serializing. Add `htmlTruncated:true` flag when cut. This markup is currently captured then dropped from every output — §2 fixes the delivery.

---

## 2. HANDOFF FORMAT — clipboard carries prose + a structured GROUND TRUTH appendix

**Principle:** the prose briefing stays (it's the human-readable "what I meant"), but the clipboard must also carry the **verbatim ground truth** so a blind agent can act faithfully. Concatenate, never replace.

### 2a. New assembler `buildGroundTruth(session, els, fin)` in `content.js`

Produces a compact, **pasteable, token-budgeted** block appended after the prose, fenced so the agent parses it deterministically. Layout:

```
<the LLM prose briefing — unchanged>

═══ DIS DAT GROUND TRUTH (verbatim capture — act on this, not the prose) ═══
PAGE: https://…    VIEWPORT: 1440×900 @2x    CAPTURED: 2026-06-17T…

[1] button.cta.primary  ·  role=button "Get Luce"  ·  Button.tsx:42:3
    rect 320×56 @ (120,640)
    computed: { background:"#FF5C2A", border-radius:"11px", font:"800 13.5px DDInter",
                box-shadow:"0 18px 50px -14px rgba(0,0,0,.45)", transition:"background .18s" }
    animation: pulse 1200ms cubic-bezier(.4,0,.2,1) ∞  [3 keyframes]
    props: { variant:"primary", size:"lg" }   state:[ false ]
    listeners: click, pointerdown
    html: <button class="cta primary">…</button>   (truncated)
    assets: bg gradient(...) ; ::before url(https://…/sheen.png)

[2] canvas#orb  ·  webgl2  ·  rect 480×480
    FRAME → https://store.disdat.dev/grab/ab12.png  (sha256 ab12…)  internal 960×960
    draws/frame: 412   programs: 1
    ── fragment shader (program 0) ──
    precision highp float; uniform sampler2D uFluidSimTexture; … (full GLSL inline)
    uniforms: uTime=12.4, uFbmAmplitude=0.6, uCumulativeAudio=0.0 …
    textures: t0 1024×1024 RGBA8 ← https://store.disdat.dev/grab/t0.png

NETWORK (unauthenticated, page-initiated):
  GET /api/getContentDetail?xcontentId=… [200] → {items:[{id,title,media}×6]} 124ms
CONSOLE: @4.1s [error] Hydration mismatch …
FONTS: DDInter 100-900 loaded ← https://…/inter.woff2 ; LF-Maranello 600 loaded ← …
SCREENSHOT (composited ground truth): https://store.disdat.dev/grab/tab.png
LOSSY FLAGS: canvas#orb geometryCaptured=false singleFrame=true ; video.hero drm=true
═══ END GROUND TRUTH ═══
```

Rules baked in:
- **Shaders/SVG always inlined as text** (tiny, most useful, lossless).
- **Computed/props/state/animations/source/listeners always verbatim** — these are the fields the LLM used to drop. No paraphrase.
- **HTML** included verbatim (bounded per §1g).
- **Large pixels (canvas frame, video frame, tab screenshot, big textures) → uploaded URL + sha256, never base64.** Base64 in clipboard bloats ~33% and blows agent context. Small assets (<~8KB, e.g. an inline SVG, a tiny icon data-URI already in the DOM) may stay inline.

### 2b. Asset upload path — NEW background handler + store

Add `case 'grab'` in background.js: receives `{dataUrl|bytes, mime}`, POSTs to a Dis Dat blob store (reuse the Supabase project — a `storage` bucket `grabs`, or a tiny edge function returning `{url, sha256}`), returns the hosted URL. Content side uploads canvas/video frames + tab screenshot + GPU textures here and puts the URLs in the ground-truth block. **For assets that already have a stable public URL (img/bg), record the original URL** and let the agent re-fetch — higher fidelity, no re-encode, no taint. Only *generated/tainted* pixels (canvas, video frame, readback textures, tab shot) go through upload.

> Per Peter's spec §3.4 "big artifacts go as a hosted authed file, never inline-pasted" — this is exactly that. The orb was ~16k lines; the same rule covers a 2MB PNG.

### 2c. Token-aware truncation order ("what to drop last")

When the ground-truth block exceeds a budget (target ≤ ~12k tokens of text; pixels are URLs so they're free), drop in this order (least to most load-bearing), annotating each drop:
1. Drop low-engagement elements first (keep clicked/typed/long-dwell — reuse the existing `windowItems` score).
2. Drop verbose `html` snippets on secondary elements (keep on the top 3).
3. Truncate uniform lists / texture lists to top-N.
4. Truncate network bodies (keep shape + status + URL).
5. **Never drop:** shaders, source pointers (file:line), the screenshot URL, the per-element `selector + computed + asset URLs` of the top-engaged elements, the FONTS manifest. Shaders and source pointers are the irreplaceable bits.

Emit a final `(N elements / M bytes omitted for length — ask Dis Dat to re-grab a specific element for full detail)` line so the agent knows it's bounded, not complete.

### 2d. Wire into the clipboard — `content.js`

- In `showResult` (line 660-673): compute `const gt = buildGroundTruth(session, els, fin)` and set `lastText = fin.text + '\n\n' + gt`. Show the prose in `$('pout')` as today, but make `doCopy` copy `lastText` (already does, line 879) — so the paste carries both. Optionally add a second "Copy ground truth only" affordance.
- This makes the **facts-only fallback obsolete as a downgrade** — even when the LLM fails (`fin.via==='facts only'`), the structured ground truth is the real payload; the prose is a bonus.

---

## 3. CRUNCH PROMPT — rewrite `WHOLE_SYS` so output is an actionable spec that references the appendix

Replace the "few sentences of flowing prose" framing. The prose's new job is a **short, imperative change-spec that points at the GROUND TRUTH block**, not a self-contained essay (the ground truth carries the values now, so the prose must stop trying to). Rewrite `WHOLE_SYS` (content.js:600) to instruct:

- **You are writing the lead-in to a coding agent that will ALSO receive a verbatim GROUND TRUTH appendix** (selectors, computed styles, shaders, source pointers, asset URLs, a screenshot). **Do not restate values the appendix already carries** — reference them by selector/number (`[2] canvas#orb`) and let the agent read the exact bytes.
- **Output = an actionable brief, not a compliment list.** For each thing the user reacted to: name it (selector + page + source pointer if present), say what they felt, and — only where a cause is visible in the facts — an explicit "probably because…". No "looks great", no summary of the page.
- **Lead with the page URL.** Keep the FAITHFUL rule verbatim (never invent reactions / never pull in page text they didn't mention). Keep "don't prescribe the fix."
- **Tell the agent the appendix is authoritative:** end the prose with one line like *"Exact values, markup, shaders, and assets are in the GROUND TRUTH block below — act on those."*
- A couple of short paragraphs max; the heavy lifting moved to the appendix.

Also update `REMARK_SYS`/`RECONCILE_SYS` lightly (they feed live notes) to the same "reference, don't restate" stance, and update `facts()` (line 644) to emit the same structured block as a degraded-but-faithful fallback (it currently drops keyframes, assets, source, html — make it call a shared `elementGroundTruth(el)` serializer used by both `facts()` and `buildGroundTruth`).

---

## 4. EXACT FILE CHANGES (ordered, function-by-function)

**Phase 1 — Injection timing (blocking, §0):**
1. `manifest.json`: add the `content_scripts` MAIN/document_start block (`inject-hooks.js`, `inject-main.js`); keep `inject-main.js` in `web_accessible_resources`; add `inject-hooks.js` to web_accessible_resources too (for the defensive re-inject path). Bump `version` to `0.8.0`.
2. `background.js` `injectShim` (line 248): inject **both** `inject-hooks.js` and `inject-main.js` in the fallback path; make idempotent.

**Phase 2 — WebGL/canvas/media capture (§1a-b, §5):**
3. NEW `inject-hooks.js`: getContext override + instrumentGL + texImage2D/shaderSource/draw wraps + rAF wrap + `snapshotCanvas` + message handler for `__disdat_glcap` → `__disdat_glres`. ⚠️ riskiest file — verify on device.
4. `content.js extract()` (341): after computing facts, if `el.tagName==='CANVAS'` request a GL/2D capture via a new `requestGLCapture(el)` (postMessage round-trip mirroring `requestMainFacts`, ~250ms timeout); merge `facts.gl = {...}`. If `el.tagName==='VIDEO'` capture frame+state per §1b.
5. `content.js`: add `requestGLCapture(el)` next to `requestMainFacts` (line 58); add a `__disdat_glres` branch in `onMain` (line 68).

**Phase 3 — styles/assets/fonts/html (§1c-e,g):**
6. `content.js` `KEEP` (312): extend prop list; `extract()`: add pseudo-element capture.
7. `content.js` `assetOf()` (345): return array, multi-layer bg, inline-SVG serialization, relative-URL resolution.
8. `content.js` `htmlSnippet()` (355): 2000-char cap + SVG 6000 + strip dd attrs + truncation flag.
9. `content.js` `pageContext()` (81) + new `buildFontManifest()`: rich font manifest at stop.

**Phase 4 — screenshot + upload (§1f, §2b):**
10. `background.js` onMessage (227): add `case 'shot'` (captureVisibleTab) and `case 'grab'` (upload to blob store → `{url, sha256}`).
11. `content.js` `stopRec()` (825): after `dedupeAll`, take the tab screenshot, upload canvas/video/texture pixels, collect returned URLs into `session.fallbacks` / per-element asset URLs. Do this **before** `finalizeSession` so the ground-truth block can reference them.

**Phase 5 — handoff + prompt (§2, §3):**
12. `content.js`: NEW `elementGroundTruth(el)` (shared serializer) + `buildGroundTruth(session, els, fin)` (§2a-c).
13. `content.js` `showResult()` (660): `lastText = fin.text + '\n\n' + buildGroundTruth(...)`.
14. `content.js` `facts()` (644): rebuild on `elementGroundTruth`.
15. `content.js` `WHOLE_SYS`/`REMARK_SYS`/`RECONCILE_SYS` (495-496, 600): rewrite per §3.
16. `content.js` `cf()` (499) + `buildWholeInput()` (606): **add `html`, `attributes`, `rect`, `gl`, full `asset` array** to what the LLM sees (today `cf` and the whole-input JSON omit html/attributes/rect — so the LLM can't even reference them). Keep token-aware (the model input still trims via `windowItems`).

**Phase 6 — debug parity (§ keep the owner view honest):**
17. `background.js`/`content.js` `sendDebug()` (697): include `gl`, `fallbacks`, font manifest, uploaded URLs so the build owner sees the new substrate too.

**Riskiest / verify-on-device (in priority order):**
- ⚠️ §0 — MAIN-world `document_start` actually beating page GL init (the whole WebGL feature hinges on it).
- ⚠️ §1a — `toDataURL` after forced preserve returns a real, upright, non-black frame on the orb; cross-origin taint detection works.
- ⚠️ §1f — `captureVisibleTab` succeeds + DPR aligns with rects.
- ⚠️ §2b — blob upload round-trip latency at `stopRec` doesn't stall the spinner (run uploads in parallel with a 15s outer timeout; degrade to "screenshot only" on miss).
- ⚠️ Strict-CSP sites silently dropping the world-MAIN script → confirm the `injectShim` fallback still yields framework facts (it will) and that WebGL just degrades to the screenshot.

---

## 5. WEBGL SPECIFICALLY — the single most reliable in-extension method

**The one move:** hook `HTMLCanvasElement.prototype.getContext` at `document_start` in the MAIN world and **force `preserveDrawingBuffer:true`** for every `webgl`/`webgl2` context. Once preserved, the drawing buffer survives past the page's rAF, so you can call `canvas.toDataURL('image/png')` at any later moment (at grab time) and get the exact rendered frame — no timing coupling, no black frame. This is the highest-leverage line in the whole plan and the reason §0's injection-timing fix is non-negotiable.

**Deliver to a blind agent, three layers, each a fallback for the one above:**
1. **Pixels (what 95% of agents need):** the forced-preserve `toDataURL` frame → uploaded URL in the ground-truth block. If the canvas is cross-origin-tainted (`SecurityError`) or WebGPU or OffscreenCanvas-in-Worker, fall back to **`chrome.tabs.captureVisibleTab`** (composited, taint-proof, viewport-only) and annotate `tainted:true`. The tab screenshot is ALWAYS included regardless, as the unconditional ground truth.
2. **Scene-as-data (lets the agent re-render, not just see):** the **GLSL shader source** (`getShaderSource`, lossless, inlined as text) per program — this is the single most valuable WebGL artifact for a coding agent and the most reliable to capture; plus one-frame uniforms + GL state + texture provenance from the instrumented context.
3. **Honest lossy flags:** `geometryCaptured:false` (VBOs aren't readable back), `singleFrame:true` (no animation timeline), `drm:true`, `offscreenWorker:true`, `tainted:true` — so the agent knows exactly what it does and doesn't have.

For the canonical orb case this yields: the upright rendered frame (URL), the full `OrbShader` fragment GLSL inline, its uniforms (`uTime`/`uFbmAmplitude`/`uCumulativeAudio`), the GPU-read base-gradient texture (URL), and a `geometryCaptured:false`/`singleFrame:true` honesty flag — i.e. everything a no-browser agent needs to reproduce or reason about the effect, captured entirely in-extension with zero CDP and no debugger banner.

---

**Key files:** all changes live in `/root/leo/apps/disdat/product/ext-pointtalk/` — `manifest.json` (content_scripts registration), NEW `inject-hooks.js` (WebGL/canvas hooks), `inject-main.js` (move to document_start), `content.js` (`extract`/`assetOf`/`KEEP`/`htmlSnippet`/`pageContext`/`buildGroundTruth`+`elementGroundTruth` NEW/`showResult`/`facts`/`cf`/`buildWholeInput`/`WHOLE_SYS`+`REMARK_SYS`+`RECONCILE_SYS`/`stopRec`/`requestGLCapture` NEW), `background.js` (`injectShim` dual-inject + NEW `shot`/`grab` handlers).

**The single biggest unlock:** moving the main-world shim from on-demand `injectShim` to declarative `document_start` MAIN-world registration. Without it, `preserveDrawingBuffer` can never be forced and WebGL stays a permanent blind spot; with it, the orb-grade capture becomes possible in-extension. Everything else is additive serialization work on top of the substrate you already capture.
