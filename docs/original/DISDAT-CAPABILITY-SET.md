# Dis Dat — THE Capability Set (locked)

> The definitive, exhaustive, honest statement of what Dis Dat captures and what it cannot —
> for every modern-web experience. No hype. Graded against the **actually shipped extension**
> at `/root/leo/apps/disdat/product/ext-pointtalk` (`manifest.json` v0.10.0; `content.js`,
> `inject-main.js`, `inject-hooks.js`, `background.js`, `offscreen.js`), not against an aspirational
> spec. Where a capability is genuinely not in the shipped build, this document says so in the open
> and marks it **ROADMAP**.

---

## 1. THE PRINCIPLE (locked)

**Anything client-side that the user EXPERIENCES, Dis Dat captures.** What they see (visual),
how it moves and feels (motion, micro-interaction), what they are given (data and content
rendered to them), how they interact (gestures, forms, input), and persistence across states
(exit a view, return, it resumes as if never closed).

**The capture boundary is exact:**

| Side | What it is |
|---|---|
| ✅ **CAPTURE** — CLIENT-OBSERVABLE EXPERIENCE | Everything the user sees, feels, receives, or interacts with. All of it is on the CAN side — fully, partially, or as a recipe the agent re-derives. |
| ❌ **CANNOT** — SERVER BRAIN | The server's hidden algorithm (private business logic) and its stored private datasets. No client tool can ever reach these — by definition they never enter the browser. |

The only other things on the CAN'T side are a **handful of platform security walls** (closed
shadow roots, cross-origin iframe internals, cross-origin stylesheet rule-text, DRM-decoded media,
worker/GPU readback, HttpOnly cookies). These are browser-enforced boundaries, not Dis Dat limits —
and crucially, **none of them is something the user actually experiences as content**; they are the
protected plumbing underneath it.

**One-line boundary:** *If the user can see it, feel it, or was handed it, it is on the CAN side.
Only the server's hidden brain and a few security walls are on the CAN'T side.*

---

## 2. THE ARCHITECTURE (how the captured experience reaches the agent)

Two parts, by design:

**(1) A light in-extension LLM crunch that GROUNDS the reaction.**
The user talks while reacting. Each remark is sliced to its time-window and turned into one
classified, grounded note, then a whole-session prose briefing in the user's voice. This crunch
is *referential* — it knows the app-design nuances and ties "this feels flat / slow / janky" to
the concrete fact it can see — but it does **not** carry the heavy payload.
Shipped engine order (`background.js`): **Groq `llama-3.3-70b-versatile`** (free, fast, primary)
→ **Anthropic Claude (Sonnet)** fallback if a key is set → **bundled on-device WebLLM** in the
offscreen document as the keyless local path. Transcript via **Deepgram Nova-3** (else Web Speech).
The crunch is deliberately faithful: it states only what the user said, never invents a reaction
to an element they didn't name, and marks inference as an explicit "probably because…".

**(2) The FULL captured payload, handed to the agent verbatim.**
A `═══ DIS DAT GROUND TRUTH ═══` appendix rides *alongside* the prose on the clipboard — exact
selectors, the full non-default computed-style set, **the authored CSS rules that matched the
element (incl. untriggered `:hover`/`:focus`/`:active`/state variants + `::before`/`::after`,
recursing through `@media`/`@supports`/`@container`, with `var()` tokens intact) for same-origin
sheets**, `getAnimations()` timing/easing/keyframes, **WebGL shader source + uniforms + the
rendered frame for canvas reactions**, framework component·props·state·source-pointer, a11y
role/name, attributes, bounded `outerHTML`, asset URLs + inline SVG, **the full network exchange
(request + response headers and bodies, token-redacted, plus fetch-SSE / WebSocket / EventSource
stream frames)**, console errors, the render/jank trace, and the environment baseline. The briefing
tells the agent: *"act on the exact bytes below."* So the agent gets everything **as if it had been
sitting in the user's browser** across the page(s) they experienced before and while narrating.

**The intended end-state (ROADMAP, not in v0.10.0):** the heaviest payload — font/image/media
**bytes** — uploaded to a **temp file** (tmpfiles-style, auto-expiry, datacenter-reachable) that
the agent downloads, with **bytes captured on the user's residential IP** (no 403) and **re-hosted
neutral**. This is the "self-hosted the entire page(s)" promise. **Today the asset delivery is
URLs + inline SVG verbatim — not a re-hosted byte bundle.** Where a row below says "byte re-host",
read it as the roadmap target; the shipped delivery is the URL pointer (text bodies themselves are
captured inline, redacted, capped at 8000 chars per exchange).

> **Honest framing of the build (graded against shipped v0.10.0).** The shipped build is far
> richer than an earlier grading (done against a stale v0.8.0 copy) credited it for. The shipped
> extension **does** harvest matched authored CSS (`matchedRules()`, with untriggered state +
> pseudo recovery and `var()` intact), **does** run a dedicated `::before`/`::after` pass
> (`pseudoStyles()`), **does** capture WebGL shaders + uniforms + the rendered frame
> (`inject-hooks.js`, MAIN world, `document_start`), and **does** capture the full network
> exchange including fetch-based streaming, WebSocket frames, and EventSource events
> (`inject-main.js`). The `KEEP` style whitelist was removed in v0.9.1 — `extract()` now keeps
> **every** non-default computed longhand. The genuinely missing pieces are narrow and named below
> as ROADMAP: a viewport **screenshot** (no `tabs` permission), a **tmp-file byte re-host** of
> asset bytes, and an **interaction-trace** (causal action→call→state-diff over time / motion as a
> recorded timeline / multi-width re-query of other breakpoints). Every one of those is
> client-observable and buildable — not a server wall — which is why they stay on the CAN side
> *in principle* even while marked 🟡/❌ *today*.

Legend: ✅ CAN · 🟡 PARTIAL (with the named residual) · ❌ CAN'T (server-brain or platform wall) ·
🟡→ROADMAP / ❌→ROADMAP (client-observable, buildable, not yet shipped).

---

## 3. THE COMPLETE SET

### 3.1 Layout & CSS visual system

| Feature | | What we get / how delivered |
|---|---|---|
| Normal flow (block/inline) | ✅ | Every non-default computed longhand (display, position, w/h, margin, padding, line-height, white-space, …) + exact `getBoundingClientRect` + the matched authored rules. Inline recipe. |
| Flexbox | ✅ | flex shorthand + longhands, justify/align, gap — all in the full computed set; measured item rects + authored rules. Inline recipe. |
| CSS Grid | ✅ | `grid-template-columns/-rows` (resolved px tracks), `grid-auto-flow`, `place-items/-content`, gaps — all in the full computed set; item rects; **the authored `repeat()`/`minmax()`/`fr` formula recovered from `matchedRules()` for same-origin sheets**. **Residual:** authored formula only when the sheet is same-origin (cross-origin sheet rule-text is a platform wall). |
| Subgrid | ✅ | `grid-template-*: subgrid` in computed; parent grabbed separately yields donor tracks; authored rules captured. **Residual:** a single child grab shows `subgrid` without donor tracks unless the parent is also captured. |
| Multi-column | ✅ | column-count/-width/-gap/-rule all captured (every non-default computed longhand is kept now; the KEEP whitelist was removed in v0.9.1) + authored rules. Inline recipe. |
| Tables (`display:table`, border-collapse) | ✅ | display, border-collapse, table-layout, border-spacing, caption-side — all captured (full computed set) + authored rules. Inline recipe. |
| Absolute / relative / fixed positioning | ✅ | position, inset, z-index, isolation, resolved rect; `sticky` flag set for fixed/sticky; page-wide sticky/fixed inventory scan records example selectors + top offsets. Inline recipe. |
| Sticky positioning | 🟡 | position:sticky + inset + sticky flag + the sticky inventory scan + authored rules. **Residual:** the dynamic stick/unstick scroll moment is not a frame trace (ROADMAP: interaction-trace). |
| CSS Anchor Positioning (`anchor()`, `@position-try`) | ✅ | Resolved insets in computed; anchor + anchored element both grabbable; **authored `anchor()` + the `@position-try`/`position-area` fallback chain recovered via `matchedRules()`** (same-origin). **Residual:** cross-origin sheet rule-text is a platform wall. |
| Responsive — media queries | 🟡 | The page **as rendered at the user's actual viewport** (every computed value is the matching breakpoint) + **the authored `@media` rules that matched, recovered from `matchedRules()` recursing into `@media`** (same-origin); ENVIRONMENT line records viewport+dpr+colorScheme. **Residual:** OTHER breakpoints' resolved values need a re-query at multiple widths (ROADMAP: interaction-trace multi-width). |
| Responsive — container queries | 🟡 | Resolved values at the current container size; `cqw/cqh` resolve to concrete px; **authored `@container` rules recovered (`matchedRules()` recurses `@container`)** for same-origin. **Residual:** other container sizes need a re-query (ROADMAP). |
| `clamp()` / `min()` / `max()` / fluid sizing | ✅ | The resolved concrete value in computed **plus the authored `clamp()`/`min()`/`max()` formula recovered from `matchedRules()`** (same-origin). **Residual:** cross-origin sheet rule-text is a platform wall (then formula survives only as the resolved value). |
| Viewport units (vw/vh/svh/lvh/dvh) | ✅ | Resolved px at the captured viewport + the authored unit recovered from `matchedRules()` (same-origin); `sessionCtx.viewport` tells the agent where it resolved. **Residual:** dvh URL-bar behavior over time is an interaction-trace ROADMAP item. |
| The cascade (specificity / source order) | ✅ | **The WINNER is captured perfectly** (computed = the value that won) **and the matched authored rules + their selectors are serialized** via `matchedRules()` (same-origin). **Residual:** cross-origin stylesheet rule-text is a platform wall (its EFFECT still lands in computed). |
| `@layer` cascade layers | 🟡 | Computed reflects layer ordering correctly; authored rules inside layers are recovered (the walk descends grouping rules). **Residual:** explicit `@layer` name/order declaration recovery is partial (the layer statement itself isn't reconstructed as a named order); effect + rules are captured. |
| `@scope` | ✅ | Scoped result correct in computed; the walk recurses grouping rules so `@scope`-nested rules are recovered (same-origin). **Residual:** the `@scope` root/limit expression itself is partial (bleeding-edge). |
| `!important` | ✅ | Resolved winner always reflects it; **the authored `!important` declaration text is captured in the matched rule's `cssText`** (same-origin). **Residual:** cross-origin sheet rule-text is a platform wall (effect still in computed). |
| Custom properties (`--vars`) & `var()` | ✅ | The **resolved** value everywhere `var()` is consumed is in computed, **AND the authored `var()` tokens are preserved verbatim in the matched rules** (`matchedRules()` keeps declaration text intact, so `color: var(--brand)` survives) for same-origin sheets. **Residual:** the `--token` registry on `:root` is captured only via whatever rule matched it; cross-origin sheet rule-text is a platform wall. |
| `@property` (typed custom props) | 🟡→ROADMAP | The resolved value where used + any matching authored rule. **Residual:** the standalone `@property` at-rule descriptor (syntax/inherits/initial) isn't reconstructed as such. Client-buildable, not a server wall. |
| `:hover` / `:focus` / `:focus-visible` / `:active` (untriggered) | ✅ | **The untriggered authored hover/focus/active rule is recovered** — `matchedRules()` strips the state pseudo from a selector and matches the base, so the "states you can't see" arrive verbatim (same-origin); if the state is also active at the grab instant, computed reflects it too. **Residual:** cross-origin stylesheet rule-text is a platform wall. |
| `:checked`/`:disabled`/`:enabled`/`:visited`/`:target` | ✅ | The current truthy state is in computed (`disabled`/`hidden`/`aria-*` also in attributes + mutation filter) **and the authored state rules are recovered** via the state-pseudo base match (same-origin). **Residual:** `:visited` colour is a **hard platform wall** (browsers lie to `getComputedStyle` for anti-fingerprinting); cross-origin rule-text is a wall. |
| Structural pseudos `:nth-child`/`:first`/`:last` | ✅ | Effect in computed + **authored structural rules recovered** (the PSEUDO_RE base-match handles `nth-child(...)`) for same-origin. **Residual:** cross-origin rule-text is a wall. |
| `:has()` / `:is()` / `:where()` / `:not()` | ✅ | Their **effect always wins in computed**, and the authored rule is recovered when the element matches (same-origin). **Residual:** cross-origin rule-text is a wall. |
| `::before` / `::after` generated content | ✅ | **A dedicated `getComputedStyle(el,'::before'/'::after')` pass (`pseudoStyles()`) captures content + background/color/size/transform/box-shadow when content is present**, AND the authored `::before`/`::after` rules are recovered via `matchedRules()` (same-origin). Inline recipe. |
| `::marker` / `::selection` / `::placeholder` / `::backdrop` / `::first-line` / `::first-letter` | 🟡→ROADMAP | Authored rules for these are recovered by `matchedRules()` when they match (same-origin), but the dedicated computed pass covers only `::before`/`::after` today. `::placeholder` TEXT is captured via the `placeholder` attribute + a11y name. Client-buildable to add the extra computed passes. |
| Backgrounds (color, image stack, position/size/repeat) | ✅ | Full computed set; `assetOf` extracts every `url()` as an absolute URL (single or array) + authored rules. Inline recipe + asset URL. **Residual:** bytes are URL-only today (ROADMAP: byte re-host). |
| Gradients (linear/radial/conic, stops) | ✅ | Full gradient function verbatim in `background-image`; `assetOf` returns `{gradient}` capped 200 chars; authored rule preserves the verbatim gradient. **Residual:** very long multi-stop gradients truncated at 200 in the asset field (the authored rule carries it up to its 400-char cap). |
| Filters (blur/brightness/drop-shadow) | ✅ | `filter` verbatim in computed + authored rule. Inline recipe. (No screenshot witness in v0.10.0 — recipe only.) |
| `backdrop-filter` | ✅ | `backdrop-filter` + `-webkit-backdrop-filter` captured (the prefixed one is in the explicit PFX_OK keep). Inline recipe. |
| `mix-blend-mode` / `background-blend-mode` | ✅ | Both `mix-blend-mode` and `background-blend-mode` captured (every non-default computed longhand is kept) + authored rules. Inline recipe. |
| Masks (`mask-image`, `-webkit-mask-image`) | ✅ | both captured; `assetOf` collects mask `url()`. Inline recipe + URL. (Byte re-host ROADMAP.) |
| `clip-path` (polygon/path/circle) | ✅ | `clip-path` verbatim with coordinates + authored rule. Inline recipe. |
| Shadows — `box-shadow` / `text-shadow` | ✅ | both verbatim (all layers, inset, spread) + authored rules. Inline recipe. |
| Borders / border-radius | ✅ | border + border-radius + border-image longhands all captured (full computed set) + authored rules. Inline recipe. |
| Outline / outline-offset (focus rings) | ✅ | both captured; focusin triggers an extract so the focused ring is captured live; **the untriggered authored `:focus` rule is recovered** via `matchedRules()` (same-origin). |
| `accent-color` / `caret-color` | ✅ | Both captured (every non-default computed longhand is kept) + authored rules. Inline recipe. |
| Color systems — oklch/oklab/lab/lch, `color-mix()`, relative color, P3, `light-dark()` | ✅ | The **resolved** color in computed (✅ for fidelity) **plus the authored wide-gamut / `color-mix()` / `light-dark()` function intent preserved verbatim in the matched rules** (same-origin). **Residual:** no color-managed pixel readout; cross-origin rule-text is a wall. |
| Typography (family/size/weight/style/line-height/spacing) | ✅ | all font longhands captured; `sessionCtx.fonts` lists up to 12 actually-loaded `document.fonts` families on the ENVIRONMENT line + authored rules. Inline recipe + FONTS line. **Residual:** font FILE bytes are URL-only (ROADMAP). |
| Variable fonts (`font-variation-settings`) | ✅ | captured verbatim (exact axes) + authored rule. Inline recipe. |
| `font-feature-settings` / `font-variant` | ✅ | both captured (full computed set) + authored rules. Inline recipe. |
| `text-wrap: balance/pretty`, hyphens, word-break | ✅ | `white-space`, `word-break`, `text-wrap`, `hyphens`, `overflow-wrap` all captured (full computed set) + authored rules. Inline recipe. |
| `text-decoration` / `text-transform` / `text-align` | ✅ | all captured + authored rules. Inline recipe. |
| Gradient text (`-webkit-text-fill-color`/`-webkit-text-stroke`/`background-clip:text`) | ✅ | `-webkit-text-fill-color` + `-webkit-text-stroke` + `-webkit-background-clip` + `-webkit-line-clamp` all captured (explicit PFX_OK keep) + authored rules. Inline recipe. |
| `writing-mode` / `direction` (vertical & RTL) | ✅ | both captured; `dir` in attributes; `sessionCtx.lang` records locale. Inline recipe + ENV. |
| Logical properties | ✅ | resolved into computed (physical equivalents present) + authored logical rules recovered. Inline recipe. |
| `field-sizing`, `text-box-trim`, `line-clamp`, `reading-flow` | ✅ | All captured (every non-default computed longhand is kept now) + authored rules. Inline recipe. (`-webkit-line-clamp` explicitly in PFX_OK.) |
| Scroll snap | ✅ | `scroll-snap-type` + align/stop/padding/margin all captured (full computed set) + authored rules. **Residual:** the snap-in-motion feel is a runtime behavior (ROADMAP interaction-trace). |
| Custom scrollbars / `scrollbar-gutter` | ✅ | `scrollbar-gutter` + scrollbar-color/-width captured (full computed set); **`::-webkit-scrollbar` authored rules recovered via `matchedRules()`** (same-origin). **Residual:** cross-origin rule-text is a wall. |
| `overflow` / `overscroll-behavior` | ✅ | overflow + overflow-x/-y + overscroll-behavior + contain all captured (full computed set) + authored rules. Inline recipe. |
| View Transitions API (same-document) | 🟡 | `view-transition-name` now captured (full computed set) + authored rules; a mid-flight transition *may* surface via `getAnimations`. **Residual:** the brief cross-state choreography over time is an interaction-trace ROADMAP item (snapshot may catch only steady state). |
| CSS animations (`@keyframes`, live) | ✅ | For animations **running at the grab instant**: `getAnimations()` → name, duration, easing, delay, iterations + up to 6 real keyframes; the authored animation shorthand recovered from matched rules. Inline recipe (animation lines). **Residual:** only live animations; finished/untriggered ones are missed; full `@keyframes` beyond 6 frames not harvested. ROADMAP: harvest `CSSKeyframesRule` + time-window record. |
| CSS transitions | ✅ | `transition` shorthand always in computed; a mid-flight transition surfaces via `getAnimations`; **the target state of an untriggered transition (the `:hover` value it animates TO) is recovered via `matchedRules()`** (same-origin). **Residual:** cross-origin rule-text is a wall; the played tween over time is an interaction-trace ROADMAP item. |
| Scroll-driven animations (`animation-timeline`/`scroll()`/`view()`) | 🟡 | If active at grab, `getAnimations` reflects the WAAPI/ScrollTimeline animation; scroll events time-stamped; the authored `animation-timeline` recovered from matched rules. **Residual:** the scroll-progress→keyframe binding is not a serialized map (ROADMAP interaction-trace). |
| `transform` / `perspective` / 3D | ✅ | `transform` (resolved matrix), transform-origin, perspective all captured; **the human-readable `rotate(45deg)` authored intent recovered from `matchedRules()`** (same-origin). **Residual:** cross-origin rule-text is a wall (matrix is mathematically equivalent). |
| `will-change` / `contain` / `content-visibility` | ✅ | will-change + contain + content-visibility all captured (full computed set) + authored rules. Inline recipe. |
| `aspect-ratio` / `object-fit` / `object-position` | ✅ | aspect-ratio + object-fit + object-position all captured; for `<img>` natural w/h captured (intrinsic ratio). Inline recipe. |
| opacity / visibility / pointer-events / user-select / cursor | ✅ | all captured + authored rules. Inline recipe. |
| z-index / stacking / isolation | ✅ | z-index, isolation, position, opacity, transform all captured — all stacking triggers — + authored rules. **Residual:** no single z-order tree dump (reconstructable by grabbing the elements). ROADMAP for legibility. |
| Dark mode (`prefers-color-scheme`) & `color-scheme` | ✅ | The page as rendered in the user's **actual** scheme; `sessionCtx.colorScheme` = dark/light, on the ENV line; the `@media (prefers-color-scheme)` authored rule that matched is recovered. **Residual:** the other scheme's values need a re-grab (ROADMAP toggle). |
| `forced-colors` / `prefers-contrast` | 🟡 | If active, computed reflects system colors + any matched `@media` authored rule. **Residual:** not read into `sessionCtx` (only colorScheme + reducedMotion are) → the agent isn't told the active mode. ROADMAP: add the matchMedia probes. |
| `prefers-reduced-motion` | ✅ | `sessionCtx.reducedMotion` via matchMedia, on the ENV line. Explains "why no animation". |
| Other media features (`pointer: coarse`, `hover: none`, `prefers-reduced-data`, `update`) | 🟡 | Not probed into context today (only colorScheme + reducedMotion); their matched `@media` authored rules ARE recovered. ROADMAP: add the matchMedia probes — `pointer:coarse`/`hover:none` drive touch-vs-mouse forks. |
| Print styles (`@media print`, `@page`) | 🟡 | The matched `@media print` authored rules are recovered (the walk recurses `@media`), even though the user is on screen so computed is screen. **Residual:** `@page` has no selector to match against; the print-rendered output is out of scope for any client tool. ROADMAP: harvest `CSSPageRule` directly. |
| `@font-face` & font loading | 🟡 | Which faces loaded via `document.fonts` (FONTS line). **Residual:** the `@font-face` at-rule (src/unicode-range/font-display) has no selector to match, so `matchedRules()` doesn't surface it, and the woff2 bytes are URL-only. ROADMAP: harvest `CSSFontFaceRule` + byte re-host. |
| Counters / `@counter-style` | ✅ | counter-reset/-increment captured (full computed set); resolved counter text surfaces via the `::before`/`::after` pseudo pass when used as generated content; authored rules recovered. **Residual:** the standalone `@counter-style` at-rule descriptor isn't reconstructed (no selector to match). |
| Houdini Paint/Layout worklets (`paint()`) | 🟡→ROADMAP | A `paint()` value shows in computed `background-image` + the authored rule. **Residual:** the worklet source (registered JS) is not captured. Client-buildable. |
| Resolved layout geometry (the rendered box) | ✅ | exact `getBoundingClientRect` per grabbed element + body rect + sticky offsets. **The single most reliable client-only fact** — no server can dispute the user's measured pixels. |
| Viewport screenshot (composited result) | ❌→ROADMAP | **NOT in v0.10.0** — no `tabs` permission, no `captureVisibleTab`. The only `getContext` instrumentation is the WebGL frame readback (per-canvas) + the extension's own heat overlay. ROADMAP, low-cost (would need the `tabs` permission added): a screenshot is the one witness that captures everything visible regardless of how it was drawn. |
| Cross-origin stylesheet rules (CDN/3rd-party CSS) | 🟡 | **Their EFFECT is fully in computed** (`getComputedStyle` is origin-agnostic) → visual fidelity preserved. **Residual — platform wall:** authored source is unrecoverable — same-origin policy throws on a cross-origin sheet's `.cssRules`, so `matchedRules()` skips it (honest blind spot, not faked). Mitigation is byte re-host of the `.css` off the residential IP (ROADMAP). Same-origin authored CSS IS now harvested. |
| Inline SVG (as a graphic) | ✅ | full inline SVG serialized via `XMLSerializer` (cap 4000 in `assetOf`, 6000 in `htmlSnippet`) — paths, gradients, filters in `<defs>` verbatim. **Residual:** very large SVGs truncated at the cap (ROADMAP: uncapped byte bundle). |

### 3.2 Motion, animation & micro-interaction / feel

> **Structural truth of the motion domain in v0.10.0:** played motion is captured as a
> **single-frame snapshot at the instant of reaction** (`getAnimations()` point-read + computed
> shorthands + the matched authored animation/transition rules, incl. the untriggered target
> state) plus a coarse time-stamped trail (mutations, perf entries, cursor, events). It is **not**
> a frame-by-frame recording of the played motion. The universal fix — a `requestAnimationFrame`
> sampler / interaction-trace — is the highest-value remaining ROADMAP item for "feel over time".

| Feature | | What we get / residual |
|---|---|---|
| CSS `@keyframes` (running at reaction) | ✅ | name/duration/easing/delay/iterations + ≤6 resolved keyframes via `getAnimations()` + the authored animation rule. **Residual:** only live ones; >6 frames truncated. |
| CSS transitions | ✅ | resting `transition` shorthand always (computed); in-flight ones via `getAnimations`; **the TARGET (`:hover`) state recovered from `matchedRules()`** (same-origin). **Residual:** cross-origin rule-text is a wall; the played tween over time is interaction-trace ROADMAP. |
| WAAPI (`element.animate()`) | ✅ | timing + keyframes via `getAnimations()` (union of CSS + WAAPI). **Residual:** snapshot only; finished/gesture-created ones missed. |
| transform/filter/backdrop-filter/opacity/will-change | ✅ | resting computed (full set). **Residual:** a transform mid-tween reads as the current frame (ROADMAP rAF sampler). |
| Scroll-driven animations | 🟡 | live `getAnimations` + scroll events + authored `animation-timeline` rule. **Residual:** scroll→progress binding not serialized. ROADMAP. |
| View Transitions API | 🟡 | the DOM swap caught as a mutation; live transition pseudo *may* surface; authored `view-transition-name`/rules recovered. **Residual:** the `::view-transition-*` tree + morph over time not captured. ROADMAP interaction-trace. |
| FLIP layout morphs | 🟡 | resulting transforms in computed + layout-shift perf entry (moved nodes) + mutations; live invert-tween via `getAnimations`. **Residual:** the measure→invert→play technique is re-derived. ROADMAP interaction-trace. |
| Spring/physics (Framer Motion, GSAP, react-spring, Motion One) | 🟡 | (1) component identity + props/state via React fiber / Vue (spring config if a prop); (2) WAAPI-backed libs (Motion One) surface via `getAnimations`. **Residual:** rAF-driven springs (GSAP, react-spring) show only a momentary frame; the settle curve is re-derived. ROADMAP rAF sampler. |
| Gesture motion (drag/swipe/pinch/fling/momentum/rubber-band) | 🟡 | gesture intent: cursor/pointer trail, click/scroll events, bound listeners (`pointerdown`/`touchstart`/`drag`/`wheel`) via the listener registry, config props. **Residual:** kinematics (velocity, fling decay, pinch scale, overshoot) not recorded as a curve. ROADMAP interaction-trace. |
| Hover feedback | ✅ | hovered computed if hovering at the instant; `transition` shorthand always; **the untriggered authored `:hover` rule recovered via `matchedRules()`** (same-origin). **Residual:** cross-origin rule-text is a wall; the played tween over time is interaction-trace ROADMAP. |
| Focus / active / press | ✅ | focusin triggers a full extract of the focused element (focused computed + outline/box-shadow); **the untriggered authored `:focus`/`:active` rules recovered** via the state-pseudo base match (same-origin). **Residual:** cross-origin rule-text is a wall. |
| Ripple effects | 🟡 | click event + ripple node-insert mutation; live expansion if `getAnimations` catches it; authored ripple keyframes recoverable. **Residual:** snapshot rarely lands mid-ripple. ROADMAP rAF sampler. |
| Parallax | 🟡 | scroll events + layer transforms at the scroll position; WAAPI-driven via `getAnimations`. **Residual:** the scroll→translate rate per layer not captured as a curve. ROADMAP. |
| Sticky / pinned reveals | ✅ | `position:sticky\|fixed` flagged; inset captured; scroll events show pin/unpin; sticky inventory scan. **Residual:** exact pinned scroll range inferred. |
| Marquee / infinite ticker | ✅ | CSS/WAAPI loops captured via `getAnimations` (`iterations:Infinity`) + authored keyframes. **Residual:** JS/rAF marquees show only the current transform. |
| Lottie / Rive / Bodymovin | 🟡 | container + box; inline-SVG Lottie serialized; the `.json`/`.riv` fetch caught (URL + shape + body) if loaded while recording; props if React-wrapped; **a Rive/canvas-WebGL Lottie now yields shaders+frame via the WebGL hook if it draws via WebGL**. **Residual:** canvas-2D-rendered Lottie frames need the 2D-canvas hook (ROADMAP); the JSON is URL/shape not re-hosted bytes (ROADMAP). |
| Cursor effects (custom cursors, follow blobs, magnetic) | 🟡 | full cursor trail (drives the heatmap + gaze clustering); `cursor` prop; follower transform at the instant; mousemove listeners. **Residual:** the follow lag / magnetic curve (rAF) not recorded. ROADMAP. |
| Hover-intent / dwell reveals (mega-menus) | ✅ | dwell is first-class — a 700 ms hover fires a `look` engagement with `dwellMs`; the reveal caught by `MutationObserver`; revealed element extracted (incl. its authored untriggered styling). **Residual:** exact intent timeout inferred. |
| Loading / skeleton shimmer & spinners | ✅ | shimmer is a live infinite animation → captured via `getAnimations` + authored keyframes; the awaited network call captured (endpoint, status, ms, body); mutation on content swap. Ties "felt slow" to real latency. **Residual:** canvas-2D loaders (ROADMAP 2D hook). |
| Optimistic-UI motion | 🟡 | the click/input, the React state/prop change (fiber), the optimistic DOM mutation, AND the in-flight call with status/timing/body — the full client loop. **Residual:** mutations are 200 ms-throttled one-line summaries; the cache-store mechanism isn't read; the server's accept/reject is server-brain. |
| Page / route transitions (SPA) | 🟡 | multi-page sessions first-class (`pages[]`, nav events); route swap as mutation + the new-route fetch; jank via long-animation-frame; authored transition rules recovered. **Residual:** the brief cross-route enter/exit choreography rarely lands in the snapshot. ROADMAP interaction-trace. |
| Confetti / canvas particle FX | 🟡→ROADMAP | the trigger click + a "canvas appeared" mutation + the canvas box; **if drawn via WebGL the shader+uniforms+rendered frame are captured by the WebGL hook**. **Residual:** a Canvas-**2D** particle system has no pixel/draw-call capture and there's no screenshot in v0.10.0 (ROADMAP 2D hook or screenshot). Client-buildable. |
| WebGL / shader motion (Three.js/R3F, fluid sims) | ✅ | **The MAIN-world `getContext` hook (`inject-hooks.js`, document_start) forces `preserveDrawingBuffer`, registers every linked program, and on a canvas reaction returns each program's GLSL vertex+fragment source + uniform snapshot + the rendered frame (`toDataURL`) + GL state.** GLSL is the look. **Residual:** a cross-origin-tainted frame can't be read back (frameTainted flag); stateful fluid sims are reconstructed-equivalent (shader + uniforms + frame), not a recorded play (ROADMAP interaction-trace); WebGPU + OffscreenCanvas-in-worker are separate walls. |
| Canvas 2D animation (games, custom UI, charts) | 🟡→ROADMAP | container box + events + feeding data fetch; **a plain 2D canvas yields a `toDataURL` frame via the hook when not tainted**. **Residual:** no `CanvasRenderingContext2D` draw-call hook (only the still frame), no screenshot. Cross-origin-tainted canvas is a platform wall on the bytes. Client-buildable. |
| Staggered / orchestrated enter | 🟡 | per-item `delay` for items live at the instant; orchestrating props (staggerChildren) via fiber; mount mutations; authored animation rules. **Residual:** only items animating at the instant; full cascade needs mid-cascade capture. ROADMAP rAF sampler. |
| Enter/exit (AnimatePresence, Vue `<Transition>`, `@starting-style`/`allow-discrete`) | 🟡 | mount/unmount mutations; config props; live tween via `getAnimations`; **`@starting-style`/transition authored rules recovered via `matchedRules()`** (same-origin). **Residual:** EXIT is hardest (node is gone before extract); the played tween over time is interaction-trace ROADMAP. |
| Scroll-triggered reveals (IntersectionObserver) | 🟡 | scroll events + the reveal class/style flip (mutation filter includes class/style/data-state) + end-state computed + authored rules. **Residual:** the IO threshold/rootMargin not captured; from-state only if caught pre-reveal. ROADMAP. |
| Number roll-ups / odometer / animated text | 🟡 | changing text via mutation (childList/characterData target) + final value + the true number from the network response body. **Residual:** per-frame count-up interpolation (rAF) not recorded. ROADMAP rAF sampler. |
| Drag-and-drop reordering (dnd-kit, sortable) | 🟡 | drag/pointer listeners + reorder mutation + dragged-item transform + config props (dnd-kit) + the persist call. **Residual:** lift/shift/drop FEEL (spring) not a curve. ROADMAP interaction-trace. |
| Jank / dropped-frame FEEL | ✅ | `long-animation-frame` entries ≥60 ms with duration + the **blocking script** (invokerType + name), time-aligned to the transcript. Best-in-class for "it stutters". **Residual:** no per-frame fps graph; script names can be minified. |
| Layout shift / "it jumps" FEEL (CLS) | ✅ | each `layout-shift` (excluding recent-input) with value, running CLS, and the **selectors of moved nodes**, time-stamped. **Residual:** doesn't capture WHY no space was reserved (that's in CSS, separately captured). |
| State-driven triggers (class/data-state/aria-expanded flips) | ✅ | the exact attribute flips that drive animations, via `MutationObserver` attributeFilter `[class, style, aria-expanded, aria-hidden, disabled, hidden, data-state]`. **Residual:** throttled to one summary / 200 ms → very rapid flips sampled. |
| `requestAnimationFrame` loops (the motion substrate) | ❌→ROADMAP | **No rAF instrumentation in v0.10.0.** This is the universal fix for nearly every "feel over time" residual above — wrap `requestAnimationFrame`, sample transforms per frame. Highest-value remaining motion ROADMAP item. Client-buildable. |
| The played motion AS A TIMELINE | ❌→ROADMAP | a single-instant snapshot (+ the matched authored rules, incl. the untriggered target state) + coarse trail, not a recording. FEEL over time (spring settle, fling decay, overshoot, cadence) is **re-derived** by the agent. The core structural motion limit of the build — fixable client-side (rAF sampler / interaction-trace / screenshot-or-clip), NOT a server wall. |
| Motion driven by hidden server logic | ❌ SERVER-BRAIN | we capture the client result (the animation that played, the values that arrived, their timing); the server's reasoning/algorithm for choreography is never on the client. The one genuinely uncapturable class, by definition. |

### 3.3 Graphics, media & audio

| Feature | | What we get / residual |
|---|---|---|
| Canvas 2D | 🟡→ROADMAP | element styles/box/attrs/HTML; **a plain 2D canvas yields a `toDataURL` still frame via the GL hook's fallback path when not cross-origin-tainted**. **Residual:** no 2D draw-call hook (still frame only) and no screenshot. Cross-origin-tainted canvas is a platform wall on the bytes. Client-buildable. |
| WebGL / WebGL2 (shaders, uniforms, frame) | ✅ | **SHIPPED: the MAIN-world `getContext` override (`inject-hooks.js`) forces `preserveDrawingBuffer`, hooks `shaderSource`+`linkProgram` to register every program, and on a canvas reaction returns each program's GLSL vertex+fragment source, a uniform snapshot (≤64 active uniforms), the rendered frame PNG (`toDataURL`), and GL state (viewport/blend/depth/drawing-buffer).** GLSL is the look — the #1 reproducibility lever. **Residual:** a cross-origin-tainted frame can't be read back (frame `frameTainted`, source still captured). Not a server wall. |
| WebGPU / WGSL | ❌→ROADMAP | nothing WebGPU-specific. WGSL is client-side shader source exactly like GLSL — same hook technique, simply unbuilt; the swapchain framebuffer readback without configured copy usage is a worker/GPU wall. High-priority parity as WebGPU adoption rises (three.js WebGPURenderer). |
| SVG — static (inline) | ✅ | complete inline SVG via `XMLSerializer` verbatim. **Residual:** cap 4000/6000 chars truncates huge vectors (ROADMAP byte bundle). |
| SVG — SMIL animation | 🟡 | the `<animate>`/`<animateTransform>` elements arrive inside the serialized SVG (declarative source = reproducible). **Residual:** no runtime progress sample (`getAnimations` doesn't enumerate SMIL). |
| SVG — JS/data-driven (D3) | 🟡 | current serialized state + mutation summaries + the data fetch body + CSS/WAAPI animations via `getAnimations`. **Residual:** the imperative D3 enter/update/exit code isn't captured as source (it's the page bundle); mutations are coarse. |
| `<img>` raster (PNG/JPEG/GIF) | ✅ | `currentSrc\|\|src` absolute + naturalWidth/Height + alt + styling. **Residual:** URL not bytes — the agent's datacenter fetch can 403/expire. ROADMAP: residential-IP byte re-host. |
| `<img>` responsive (srcset/sizes) | ✅ | the **actually-chosen** `currentSrc` + the raw `srcset`/`sizes` in attributes + viewport/dpr context. **Residual:** the chosen source is the structured field; full candidate set lives in attributes. |
| `<img>` AVIF/WebP + lazy loading | ✅ | `currentSrc` = the actual codec URL; `loading` in attributes. **Residual:** a not-yet-loaded lazy image reports empty (faithful). |
| `<picture>`/`<source>` | 🟡 | the inner `<img>` `currentSrc` = chosen source; `<source>` list recoverable from `htmlSnippet`. **Residual:** no dedicated `<picture>` branch in `assetOf` → structured field may be empty; parse `<source>` from HTML. ROADMAP. |
| CSS background images / gradients | ✅ | all `url()` → absolute (cap 400 each, single or array); gradient verbatim (cap 200) + the authored rule. Inline recipe + URLs. (Byte re-host ROADMAP.) |
| CSS & SVG filters | ✅ | `filter`/`backdrop-filter`/`mix-blend-mode` all captured (full computed set) + authored rules. **Residual:** a `filter:url(#x)` referenced `<filter>` def is only included if that SVG is on the grabbed element (not chased by id). ROADMAP: resolve `url(#id)`. |
| Web fonts (woff2, variable) | ✅ | active font stack in computed + the loaded family list (FONTS line) + authored font rules. **Residual:** `@font-face` src URLs + woff2 bytes not captured (family names only; the at-rule has no selector to match). ROADMAP. |
| Icon fonts (FontAwesome, Material) | ✅ | font-family + icon class (in HTML) + family in FONTS list; **the codepoint now arrives via the `::before` pseudo pass (`pseudoStyles` captures `content`)**. **Residual:** the icon class is usually enough regardless. |
| `<video>` direct file (MP4/WebM) | 🟡 | resolved `currentSrc\|\|src` (cap 400) + object-fit/dims + attrs (controls/autoplay/loop/poster). **Residual:** no poster/current-FRAME image, no playback STATE (currentTime/paused/duration/volume), bytes heavy/ROADMAP. ROADMAP: poster-frame grab + media-state object. |
| `<video>` adaptive (HLS/DASH/MSE/blob:) | 🟡 | manifest + segment requests show on the network hook (URLs/status/timing/body); the element src is a non-portable `blob:`. **Residual:** the played media is reachable only via the captured manifest/segment URLs (a request log, not assembled); no `MediaSource.appendBuffer` hook. ROADMAP-ish. |
| `<video>` DRM / EME (Widevine/PlayReady) | ❌ PLATFORM WALL | only the element shell + any license-endpoint traffic. Decoded frames + the EME key exchange are in the CDM black box; `toDataURL` on a DRM video throws. A content-protection wall (the browser's protected pipeline), distinct from server-brain — no client tool can ever read it. |
| `<audio>` direct file | 🟡 | element styles/attrs/HTML; src in attributes (no `<audio>` branch in `assetOf`); the file fetch on the network hook. **Residual:** src not structured; no playback state. ROADMAP: add an AUDIO branch + media-state. |
| Web Audio API (AudioContext, AnalyserNode, graph) | ❌→ROADMAP | nothing of the audio graph. Node graph + analyser data are client-observable via the same proxy technique as the WebGL hook — simply unbuilt. Sub-wall: a private-DSP AudioWorklet's bundled source is a logic wall, but the graph topology + worklet URL are capturable. |
| `<video>`/`<audio>` TextTracks: captions/subtitles (WebVTT), `<track>`, MediaSession | 🟡 | the `<track>` element + `src` arrive in HTML/attributes; the WebVTT fetch on the network hook. **Residual:** rendered cues + `MediaSession` metadata not captured. ROADMAP (client-observable). |
| Picture-in-Picture / Fullscreen API | 🟡 | the trigger + resulting DOM/state; `:fullscreen` state if active; authored `::backdrop`/`:fullscreen` rules recovered. **Residual:** the PiP window pixels are out-of-DOM browser chrome. ROADMAP. |
| OffscreenCanvas + worker rendering | ❌→ROADMAP / PLATFORM | on-screen element styles only. The `getContext` hook is on `HTMLCanvasElement`, not `OffscreenCanvas`, and content scripts don't run in worker realms. A genuine realm-reach gap for Figma-class apps — a worker-realm boundary, not a server wall. |
| WebXR (immersive VR/AR) | 🟡→ROADMAP | **backing WebGL shaders ARE captured by the WebGL hook** + wrapper props. **Residual:** session config/layers are client-observable but not yet read; live headset pose + the stereo immersive framebuffer are a hardware/worker-stream wall. Niche; not server-brain. |
| Embedded `data:` / `blob:` images | 🟡 | `<img>` `data:` URI capped 400 (small ones partial, large truncated); `blob:` kept as a non-portable handle; inline SVG fully serialized. **Residual:** ROADMAP byte bundle carries full `data:`/decoded-`blob:` bytes (resolve `blob:` via `fetch(blobUrl).arrayBuffer()` on the page). |
| PDF embeds (`<embed>`/`<object>`/`<iframe>`) | 🟡 | element styles/box + the PDF URL in attributes/HTML + the file fetch if same-origin/observed. **Residual:** the rendered pages (native plugin / PDF.js canvas) aren't read (cross-origin/plugin boundary, not a host-server wall). |
| Cross-origin iframe content | 🟡 | the iframe element box/styles/src from the parent; the child gets its **own** content-script sensor (manifest `all_frames` + `<all_urls>` host permission), reporting independently. **Residual:** the parent fundamentally cannot read a cross-origin child's pixels/DOM (**SOP platform wall**); coordinating the child's independent capture into the one session timeline is the residual engineering gap; `postMessage` between frames is not hooked (ROADMAP). |
| `<iframe srcdoc>` / sandbox / allow | 🟡 | `srcdoc` inline content is same-origin → fully capturable; sandbox/allow in attributes. ROADMAP: structured `srcdoc` handling. |
| Camera / mic page streams (`getUserMedia`) | ❌→ROADMAP | nothing of the page's stream (`blob:`/`srcObject`, no URL). At best a single still frame via canvas `drawImage` (privacy-sensitive, unbuilt). NB: Dis Dat's own offscreen mic = the **user's narration**, entirely separate from any page camera. Ephemeral hardware feed, not server-brain. |
| Screen capture (`getDisplayMedia`) | ❌→ROADMAP | same ephemeral-stream reality as camera; only the `<video>` shell. Niche for "react to a web page". |

### 3.4 Data, networking & API

| Feature | | What we get / residual |
|---|---|---|
| REST (fetch) | ✅ | method, full URL, **request headers + request body** (redacted), status, **response headers**, **inferred response shape** (top-level keys → value types, depth 2 / 12 keys), and the **full response body** (token-redacted, capped **8000 chars** per exchange — NOT 1200), latency ms. Inline recipe + crunch. **Residual:** body cap 8000/exchange; only ~6–8 calls reach the final GROUND TRUTH; the server logic that produced the body is server-brain. |
| REST (XHR) | ✅ | method, URL, **request headers + request body** (redacted), status, `responseText` + shape for text responses; non-text typed as `(blob)`/`(arraybuffer)` etc. **Residual:** binary/parsed XHR bodies aren't deserialized (type tag only). |
| GraphQL queries / mutations | ✅ | captured as the POST body (query/variables/operationName) + the data/errors envelope + shape, via the generic fetch/XHR hook (request body + response body both captured). **Residual:** no GraphQL-aware structuring; APQ hash-only requests resolve server-side (server-brain). |
| GraphQL subscriptions | ✅ | rides graphql-ws (**WebSocket frames hooked**, send+recv, capped 40/socket) or SSE (**EventSource hooked**, capped 50). **Residual:** binary WS payloads tagged not decoded; the server push logic is server-brain. |
| tRPC / RPC | ✅ | HTTP under the hood → captured as normal requests (batched input in the URL/body + superjson response body). **Residual:** no batch-envelope decoding; resolver is server-brain. |
| fetch streaming (ReadableStream / SSE-over-fetch / NDJSON) | ✅ | **SHIPPED: `spyStream` tees a CLONE of the response body (page untouched) and reads it frame-by-frame, splitting on `\n\n` and posting each frame (capped 50)** for `event-stream`/`ndjson`/`text/plain`/`application/stream` responses. A long LLM-style token stream is captured as it arrives. **Residual:** frame-split is `\n\n`-based (single-`\n` SSE / `multipart/mixed` / gRPC-Web framing variants are partial); 50-frame cap per stream. |
| WebSocket | ✅ | **SHIPPED: the constructor is wrapped, `.send` and `message` are hooked** → both directions captured (send ↑ / recv ↓), shape-inferred + redacted body, capped 40 frames/socket. **Residual:** binary frames are tagged by constructor name not decoded; the server push logic is server-brain. |
| EventSource (SSE) | ✅ | **SHIPPED: the constructor is wrapped, `message` hooked** → event type + `lastEventId` + shape + redacted body, capped 50. **Residual:** custom named events beyond `message` need the corresponding `addEventListener` to have fired; server push logic is server-brain. |
| Long-polling | ✅ | each poll is an ordinary fetch/XHR → captured with body + cadence/timing. **Residual:** the 300-frame net buffer can be flooded; only ~6–8 reach the briefing. |
| WebTransport (HTTP/3) | ❌→ROADMAP | not captured. Hookable like WebSocket; client-buildable. |
| Request vs response SHAPE inference | ✅ | recursive descriptor (keys → types, depth 2, 12 keys/object). **Residual:** deep/wide objects elide to `{…}`/`…`; JSON only. |
| Full bodies vs shapes | ✅ | both the body (cap **8000**, token-redacted) and the shape, for fetch + XHR + WS + SSE + stream frames. **Residual:** over-8000 bodies truncate (the tmp-file byte bundle for very large payloads is ROADMAP); binary bodies are type-tagged. |
| Pagination / infinite-scroll | ✅ | each page-fetch captured (cursor/offset in URL/body + the returned slice body) + scroll events + mutation `+N nodes`. **Residual:** the net buffer can drop the earliest pages on very long scroll; the server's ranking is server-brain. |
| Optimistic updates + rollback | 🟡 | the mutation call (req+res body) + the optimistic DOM mutation + the confirm/rollback mutation + console errors. **Residual:** we capture the SYMPTOMS (DOM flips forward then back), not the cache-store mechanism (React-Query/Apollo/RTK); mutations are 200 ms-throttled. |
| Client state stores (Redux/Zustand/Jotai/MobX) | ❌→ROADMAP | per-element React/Vue props + a best-effort React hook snapshot (≤6 cells) + Vue setupState. The **global store tree / action log / atom graph is not read.** Per-library, brittle, client-buildable; component-local state we DO get is shallow. |
| Normalized caches (Apollo/RTK-Query/React-Query/urql) | 🟡 | every network read/write that feeds the cache + the rendered result. **Residual:** a served-from-cache render with NO network call leaves no trace; the cache object isn't introspected. Per-library client-buildable. |
| IndexedDB | ❌→ROADMAP | not captured (no IDB enumeration/hook). Client-observable (the user's own browser holds it), large → needs the byte bundle; the largest blind spot for offline-first apps. NOT a server wall. |
| localStorage / sessionStorage | ❌→ROADMAP | **not read in v0.10.0.** Trivially client-observable and synchronous — `Object.entries(localStorage)` + redact. The easiest storage gap to close. Often explains "why the UI resumed where it did". |
| Cache API (Service-Worker caches) | ❌→ROADMAP | not enumerated; SW-served responses still reach the page-world fetch hook (so live SW-cached responses ARE captured), but **precached entries never re-requested are invisible**. Client-buildable. |
| Cookies | ❌ SECURITY WALL (by design) | `document.cookie` not snapshotted; Cookie/Set-Cookie are **actively redacted** in request/response headers + bodies (`redact()` strips them). HttpOnly cookies are a **hard browser wall** (JS can't read them, ever). The agent learns auth happened, never the secret. |
| Auth tokens (Bearer/JWT/API keys) | ✅ (by design) | the PRESENCE and SHAPE of auth + which endpoints require it. **Token values ARE redacted** — `redact()` masks `bearer …`, `authorization`/`cookie`/`x-api-key`/`api-key`/`access/refresh/id-token`/`password`/`secret` and any `eyJ…` JWT in headers + bodies. A security-by-design boundary, correct since bytes are captured on the user's residential IP. |
| Timing & waterfall | 🟡 | per-fetch latency (ms) + capture-time ordering + the render trace (CLS, long-animation-frame). **Residual:** XHR/WS/SSE carry no duration; no full Resource Timing / Server-Timing / Core Web Vitals (LCP/FCP/INP/TTFB) — ROADMAP via `performance.getEntriesByType('resource')` + the relevant observers. Server processing time is server-brain except via `Server-Timing`. |
| Interaction → call → state-diff causal trace | 🟡 | the raw ingredients — time-stamped clicks/input/focus/scroll + net (req+res bodies) + mutation events, sliced per-remark by time window. **Residual:** it's a time-CORRELATED bundle, not an explicit causal graph; the explicit action→call→diff log is ROADMAP (interaction-trace). |
| Binary payloads (protobuf/MessagePack/arraybuffer/Blob) | ❌→ROADMAP | a type tag only, never decoded (WS binary frames tagged by constructor name). Bytes could ride the tmp-file bundle (base64); semantic protobuf decode needs the `.proto` schema (usually server-side → a logic wall even with bytes). |
| Asset bytes re-host | 🟡→ROADMAP | today we deliver **URLs + dims** (and inline SVG verbatim, and text response bodies inline), not re-hosted asset bytes. The residential-IP byte capture → neutral re-host (so the agent's datacenter fetch can't 403) is the intended design and is **not in v0.10.0**. The known residual. |
| Analytics / telemetry beacons | 🟡 | fetch/XHR analytics POSTs captured (event names, exposure payloads, body). **Residual:** `navigator.sendBeacon`, image-pixel beacons (`new Image().src`), `<a ping>`, `fetch(keepalive)` on unload are NOT hooked. ROADMAP: hook `sendBeacon`. |
| `AbortController` / request cancellation | 🟡 | a cancelled fetch rejects → the error path posts a net entry. **Residual:** not classified as "cancelled". ROADMAP. |
| Server business logic / private algorithm | ❌ SERVER-BRAIN | only its OUTPUTS on the wire (response bodies, ranked lists, computed prices). Never the code or model. The permanent, by-definition wall. |
| Server-side private datasets / database | ❌ SERVER-BRAIN | only the slices the client fetched and rendered. The unfetched remainder of the dataset is unreachable from any client tool. Correct, principled CAN'T. |
| Rate limiting / quota / 429, CDN edge logic, geo-routing | ❌ SERVER-BRAIN | observable only as the response that arrived (429, the variant served). The decision logic never reaches the client. |

### 3.5 Persistence, real-time, offline & sessions

| Feature | | What we get / residual |
|---|---|---|
| **Session resume** (exit → return, scroll/draft/stream restored — THE headline) | ✅ | the client restore loop: the restore-read fetch/XHR on re-entry (req+res body), the restored DOM (computed + box + matched authored rules), the restored scroll offset, the restored draft VALUE (input, cap 60 chars), the framework props/state the component remounts with, the repopulation mutations, **AND a stream-replayed feed over SSE/WS now captured (those hooks shipped)**. Capture **spans exit→return** because `background.js` mirrors the session to `chrome.storage.session` and re-injects `content.js` on every navigation. **Residual:** the SERVER's choice of WHICH state to return is server-brain; a draft held only in the JS heap (never rendered/sent) is seen only once it lands in DOM/a call. The client restore loop is CAN; the stored-server-state side is server-brain. |
| Draft autosave (debounced PUT/PATCH) | ✅ | the typed value (cap 60, passwords masked) + the autosave request (full, req+res body) + the debounce timing (keystroke→net delta on the session clock) + the response + field props. **Residual:** element-side draft cap 60; if autosave is to localStorage only (no network) we catch it via the restore-read or a mutation, not the write (storage hook ROADMAP); server persistence/versioning is server-brain. |
| Undo / redo history | 🟡 | the keydown listener presence + the resulting DOM/state diff + any sync call + restored state. **Residual:** the undo STACK itself (in-heap command ring) is never serialized — we see each step's RESULT, not the stack/depth. In-heap blind spot (not server-brain). |
| Service-worker presence & lifecycle | 🟡 | cached responses come through the fetch hook; the registration call if it fires while recording. **Residual:** no `navigator.serviceWorker` introspection (controller/scope/routing/source). The SW is a separate thread the MAIN hook can't reach. ROADMAP. |
| Offline mode / Cache Storage | 🟡 | `navigator.onLine` once per page (in context) + cache-served responses on the fetch hook. **Residual:** no `caches.*` enumeration, no online/offline event listeners (one-shot snapshot) → a mid-session flip isn't logged. ROADMAP. |
| Background Sync API | ❌→ROADMAP | at best the replayed requests IF they fire during recording. The sync registration + queue + replay live in the SW (outside MAIN reach, usually firing after the tab's gone). Client-side plumbing, not server-brain; needs SW-context instrumentation. |
| Push notifications (Web Push) | ❌→ROADMAP | subscription is SW + PushManager; notifications render in OS chrome. Outside a page-world content script; not server-brain. |
| PWA install / manifest / display-mode | 🟡 | manifest URL in the DOM; manifest JSON if fetched. **Residual:** no proactive manifest read, no `beforeinstallprompt`, no `matchMedia('(display-mode: standalone)')` — all page-world observable, unbuilt. ROADMAP. |
| Real-time presence (who's online) | ✅ | the presence UI (avatars, "N online") with styles/props + the appear/disappear mutations ARE captured; **the presence transport (WS/SSE) IS now hooked** → the protocol frames are captured (capped). **Residual:** the server roster (full online set beyond what's pushed) is server-brain. |
| Typing indicators / read receipts | ✅ | the indicator UI (animated dots via `getAnimations`, "Seen" styling) + mutations + **the WS/SSE typing/seen frames (transport hooked)**. **Residual:** the server relay logic is server-brain. |
| Collaborative editing — CRDT/OT (Yjs, Liveblocks, Automerge) | 🟡 | the editor DOM + props/state + the incoming-edit mutations + **the sync transport frames (WS/SSE hooked)**. **Residual:** CRDT binary WS frames are tagged not decoded (need lib-aware decoders); the merge math is library/server logic. |
| Live cursors / remote carets | ✅ | the rendered remote-cursor element (color, label, glide transition via `getAnimations`) + transform updates + **the position frames (WS/SSE hooked)**. **Residual:** binary position frames are tagged not decoded; server fan-out is server-brain. |
| Multiplayer shared state (rooms, game/board) | 🟡 | the rendered state in DOM + props/state + the change mutations + **the state-sync protocol frames (WS/SSE hooked, capped)**. **Residual:** a fast game loop overflows the per-socket frame cap (40); binary frames tagged not decoded; authoritative server sim is server-brain. |
| WebRTC — video/voice calls | ❌→ROADMAP / PLATFORM | the call UI + signaling IF it rides fetch/XHR/WS (SDP/ICE as captured frames); the `<video>` shell. **Residual:** `RTCPeerConnection`, media tracks, SRTP media flow are on no hooked API — media never touches fetch/XHR/WS. A future PC hook could grab SDP/stats; live media bytes are structurally out of a DOM-capture's scope. |
| WebRTC data channels | ❌→ROADMAP | signaling only if on a hooked transport; channel payloads invisible. Add an `RTCDataChannel` hook (client-buildable). |
| Tab-sync (BroadcastChannel, storage events) | 🟡 | the EFFECT in the recorded tab (mutation / refetch). **Residual:** the cross-tab MESSAGE itself isn't captured (no `BroadcastChannel`/`storage`-event hook); the other tab is structurally outside one tab's capture. ROADMAP. |
| Reconnection / backoff / resume-cursor | ✅ | **the EventSource/WebSocket hooks (now shipped) see reconnects + `Last-Event-ID` (captured on SSE frames) + the resumed frames**; console errors on a drop ARE captured. **Residual:** the backoff cadence is inferred from frame timing not an explicit policy; the server resume-from-cursor logic is server-brain. |
| Conflict resolution (merge dialogs, version vectors) | 🟡 | the conflict SIGNAL (409/412 response body, version field) + the conflict UI (merge dialog DOM). **Residual:** the merge ALGORITHM is server/library logic; silent server-side resolution shows only the final state. |
| Background tasks (setInterval poll, rIC, Web Workers) | 🟡 | polling fully visible (each poll = a captured fetch with cadence + body); the jank a heavy task causes (long-animation-frame + script attribution); console output. **Residual:** a dedicated Web Worker runs in its own thread the MAIN hook doesn't enter — its `postMessage` effects on DOM/network are seen, its internal code + its own fetch are not. Worker-context injection ROADMAP. |
| Cross-page session continuity (Dis Dat's OWN session across navigations) | ✅ | the ordered `pages[]` (deduped from timeline + nav events), a single merged timeline on one session clock, nav events per transition — so a reaction roving across a flow is one coherent context. `background.js` mirrors to `chrome.storage.session` + re-injects on every navigation (survives MV3 SW-kill). **Residual:** this is Dis Dat's own plumbing (works); pure SPA pushState soft-navs are caught via the net/mutation stream rather than a discrete nav event (ROADMAP: hook `pushState`). |

### 3.6 App platform & input

| Feature | | What we get / residual |
|---|---|---|
| SPA routing — History API (pushState/popstate) | ✅ | every navigation captured as a distinct page (re-inject on `tabs.onUpdated` complete) → `PAGES A → B → C`, each fact carries its page. **Residual:** a pure pushState soft-nav (same document) isn't a discrete event — the new URL is recorded on the next engagement. ROADMAP: hook `history.pushState`/Navigation API. |
| SPA routing — hash routing | 🟡 | the rendered result is fully captured; `location.href` (incl hash) read on each engagement. **Residual:** `hashchange` isn't a discrete event (ROADMAP: add the listener). |
| SPA routing — nested / parallel routes | ✅ | each mounted segment's DOM + component + props/state + source pointer. **Residual:** the router route-tree config isn't captured as an abstraction (the source pointer points the agent at the code). |
| SPA routing — route transition animations | ✅ | live transition via `getAnimations` + computed + **the authored transition rules recovered via `matchedRules()`** (same-origin). **Residual:** a transition finishing before dwell may capture only steady state; the View-Transitions pseudo tree isn't enumerated (ROADMAP interaction-trace). |
| SPA routing — scroll restoration | 🟡 | scroll position tracked (debounced, >60 px); heat trail is element-anchored; `heatDiag` reports the scroller. **Residual:** restore-vs-reset behavior captured only if the user reacts to it; `history.scrollRestoration` not read. ROADMAP. |
| Cross-document View Transitions (MPA, `@view-transition`) | 🟡 | each page captured in the chain (re-inject on navigation); the matched `@view-transition`/transition authored rules recovered (same-origin). **Residual:** the cross-document transition orchestration over time isn't serialized (the brief animation rarely lands in the snapshot). ROADMAP interaction-trace. |
| Auth — OAuth / magic-link redirect flows | 🟡 | each redirect page in the chain + the provider requests (full, req+res body) + the rendered consent/callback UI. **Residual:** (1) **server-brain** — IdP token-signing/validation; (2) **by design** — bearer/refresh/id tokens + Set-Cookie are actively redacted (`redact()`), so the agent gets the auth SHAPE not a replayable authenticated request; HttpOnly cookies are a browser wall; a redirect completing before `content.js` mounts can drop a hop. |
| Auth — token refresh (silent re-auth) | 🟡 | the refresh call (endpoint/shape/status/timing/cadence). **Residual:** token values are redacted (by design); rotation/expiry policy is server-brain. |
| Auth — RBAC / permission-gated UI | ✅ | exactly what THIS user/role was shown: rendered DOM, which controls exist/disabled/hidden, props/state (e.g. `canEdit:false`), aria-disabled, the `/me`/permissions response body. **Residual:** other roles' UI is never rendered to this client (re-record as that role); the authorization DECISION + full permission matrix are server-brain. |
| Forms — validation (native + custom, sync + async) | ✅ | typed values per field (passwords masked) + field elements + error nodes when they render (mutation + the error element if engaged) + aria-invalid/describedby + the async-validation call + **the untriggered error-state CSS recovered via `matchedRules()`** (same-origin). **Residual:** the validation RULES (regex/schema/business constraints) are app code / server logic. |
| Forms — multi-step / wizard | ✅ | each step's DOM + component + accumulated props/state via fiber + typed values + step-swap mutations + per-step saves; the whole-crunch fuses the flow. **Residual:** the state-machine definition is app code; unvisited branches aren't rendered. |
| Forms — file upload (input/drag-drop, progress) | 🟡 | the dropzone + the upload request (method/URL/status/timing) + **the request body is now captured (`reqBodyOf`: string/URLSearchParams/FormData stringified to field names)** + the response + progress mutations + drag listeners. **Residual:** the file BYTES — a multipart FormData stringifies to field names not file bytes; XHR upload-progress events aren't hooked; server storage is server-brain. ROADMAP: upload-progress + byte bundle. |
| Forms — drag-and-drop reordering | 🟡 | draggable elements + reorder mutations + drag/pointer listeners + config props + the heat path. **Residual:** no dedicated drag-gesture trace (dragover coords, drop target at drop time) — inferred from before/after. ROADMAP interaction-trace. |
| Forms — contenteditable / rich-text (ProseMirror, Slate, TipTap, Lexical, Quill) | 🟡 | editor DOM + `outerHTML` (cap 1500) + editor-root component/props/state + toolbar + content mutations. **Residual:** the editor's document MODEL lives in JS, not the DOM; `onInput` reads `el.value` which contenteditable lacks → typed content is captured as mutations + capped HTML, not a value; selection offset + doc JSON + undo stack not captured. Partly ROADMAP (bigger cap, read editor state via fiber); the model is fundamentally in-JS. |
| Forms — autofill / autocomplete (custom typeahead) | 🟡 | the input + `autocomplete` attr + custom suggestion dropdowns (mutation + the list if engaged) + the suggestion-fetch (query + result list body). **Residual:** browser-native autofill is browser chrome (**platform wall**); the custom-typeahead ranking is server-brain / app code. |
| Forms — native input pickers (`date`/`time`/`color`/`range`/`file`), `<select>`/`<optgroup>`/`<datalist>` | 🟡 | the element + its attributes/value + computed styling (incl. `accent-color`, now captured) + authored rules. **Residual — platform wall:** the native picker popups and the `<select>` dropdown render in **browser chrome, outside the DOM** — invisible to any content script (same class as autofill and the native `title` tooltip). The resulting value/state IS captured. |
| Forms — native `<form>` submit (action/method/enctype, multipart POST) | 🟡 | the `<form>` attributes + a submit-triggered request if it's AJAX (req body captured). **Residual:** a plain non-AJAX submit triggers a full navigation — captured as the next page in the chain, but the in-flight multipart POST body is essentially a CANT-during-navigation; field names only. ROADMAP. |
| i18n — locale strings, plural, date/number format (`Intl`) | ✅ | the fully rendered localized text + `lang` + `navigator.language` + resolved timezone (context) + the locale-load fetch body. **Residual:** only the active locale is rendered/fetched (other locales not observable); the ICU plural logic + that formatting was done client-side via `Intl` vs server-side is inferred. |
| i18n — RTL / bidi (`dir`, logical props) | ✅ | `direction` + `writing-mode` (full computed set) + `dir` in attributes + the mirrored rect. Fully client-observable; no material residual. |
| a11y — ARIA roles, accessible names, states | ✅ | role + accessible name via `computedRole`/`computedName` when the engine exposes them, else an implicit-role map + name resolution (aria-label → labelledby → alt → placeholder/title → short text) + all `aria-*` in attributes + aria-expanded/hidden mutations. **Residual:** the heuristic fallback won't perfectly match the full ARIA accname algorithm (complex labelledby chains). Minor fidelity gap. |
| a11y — focus management & order | ✅ | focusin events as focus engagements (the element + its facts) + `tabindex` + **the untriggered authored `:focus`/`:focus-visible` rule recovered via `matchedRules()`** (same-origin). **Residual:** the focus-management LOGIC (traps, roving tabindex) is realized-sequence only. |
| a11y — live regions (aria-live) | 🟡 | the live-region element (role status/alert, aria-live) + the content-change mutation. **Residual:** the actual AT announcement isn't observed (AT is outside the page — platform); `characterData` isn't in the observer options (childList+attributes), so a pure text-node swap may register only via add/remove. ROADMAP: add characterData. |
| a11y — keyboard navigation | 🟡 | bound keyboard listeners (keydown/keyup/keypress via the registry, 3 ancestors) + the resulting DOM/state changes. **Residual:** keystrokes aren't timeline events (listener PRESENCE only), and only listeners added after the shim are seen; the widget key logic is app code. ROADMAP: a keydown sensor. |
| Shadow DOM — open roots, web components, slots | 🟡 | `elementsFromPoint` pierces **open** roots → interior nodes captured (computed, `outerHTML`, custom-element tag); host + slotted light-DOM normal; `getComputedStyle` crosses the boundary so the **computed look survives**. **Residual:** **closed** shadow roots are a **platform wall** (interior unreachable); shadow-scoped authored CSS (adopted/constructable stylesheets) isn't matched (`matchedRules()` walks `document.styleSheets`, not `shadowRoot.adoptedStyleSheets`) — ROADMAP. |
| Cross-origin iframes + postMessage | 🟡 | content scripts run in **all frames** (`all_frames` + `<all_urls>`), so a cross-origin iframe gets its own sensor streaming independently. **Residual:** the parent can't read into a cross-origin child (**SOP wall** — the extension sidesteps it via per-frame injection); `postMessage` between frames is NOT hooked. ROADMAP: a `postMessage` hook + child-session coordination. |
| Clipboard (copy/cut/paste, Clipboard API) | ❌→ROADMAP | only the VISIBLE result of a paste (a DOM mutation). Copy/cut/paste events aren't sensed (excluded from the listener filter); `navigator.clipboard` isn't hooked. Clipboard content + the interaction are an uncaptured client surface — client-buildable, not a server wall. (Dis Dat itself writes the final handoff to the clipboard — separate.) |
| Keyboard shortcuts / hotkeys | 🟡 | keydown/keyup listener presence + the EFFECT (a palette/modal appearing, state change). **Residual:** the keystroke isn't recorded; document/window-level global handlers bound before the shim may not associate with an element. ROADMAP. |
| Command palettes (cmd-K) | ✅ | on open, the palette subtree fully (container/input/result list DOM + component + props/state) + the typed query + the search/command fetch (query + results body) + filtering mutations + clicks + **the untriggered open-state CSS recovered via `matchedRules()`** (same-origin). **Residual:** the command REGISTRY/ranking is app code or server-backed search. |
| Modals / `<dialog>` / Popover API / top-layer / `::backdrop` | ✅ | the modal/dialog/popover on open: DOM + `outerHTML` + computed + enter/exit animation via `getAnimations` + aria-modal/role + the open/close mutation + props/state (`isOpen`); the dim/backdrop captured as an element; **the `::backdrop` authored styling recovered via `matchedRules()`** (same-origin). **Residual:** the top-layer paint model isn't reconstructed; a modal opening/closing faster than dwell may capture only steady state. |
| Popover / dropdown / tooltip / `<details>` | ✅ | the trigger + the revealed panel (DOM, open-state, reveal animation) + `aria-expanded`/`open` toggle (in the mutation filter) + props/state + async menu items + their fetch body + **the untriggered styling recovered via `matchedRules()`** (same-origin). **Residual:** a tooltip passed over without dwelling (≥350 ms `look`) can be missed. |
| Virtualization (react-window / tanstack-virtual) | 🟡 | the **currently-mounted** rows (DOM, styles, row component + props, bound data) + container styles + scroll events + recycle mutations. **Residual:** off-screen rows aren't rendered → not captured; the full dataset is server-brain / in-JS-store, observable only via the list-fetch responses (which ARE captured with bodies). Visible rows + fetch contract = CAN; the entire backing dataset = server wall. |
| Infinite scroll / pagination / load-more | ✅ | each page-fetch (cursor/offset in URL/body + the slice body) + appended-row mutations + scroll events. **Residual:** the IO sentinel isn't hooked but its EFFECT is captured; the server cursor logic is server-brain. |
| Code-splitting / lazy chunks (dynamic import) | 🟡 | the loading fallback (mutation) + the chunk-parse jank (long-animation-frame + script attribution) + the loaded component. **Residual:** webpack/Vite chunks usually load via injected `<script>` / the module loader, NOT fetch/XHR → those bypass the network hook (only fetch-based chunk loads are caught). ROADMAP: `PerformanceResourceTiming`. |
| Suspense / loading boundaries / skeletons | ✅ | the skeleton + its shimmer animation + the fallback→content mutation + the awaited fetch (body) + the layout-shift if it reflows + the "feels slow / it jumps" narration tied to LoAF/CLS. **Residual:** the Suspense boundary as a React abstraction is named only if the fiber exposes it. |
| Hydration (SSR → interactive) + mismatches | 🟡 | hydration-mismatch **console errors** verbatim (a prime "it's broken" signal) + hydration CLS/jank + the component facts once hydrated. **Residual:** the console hook only catches messages logged AFTER the shim installs and after Record is hit — very early hydration logs during initial load can precede recording; the pre/post-hydration interactivity delta isn't diffed. |
| Streaming SSR / RSC (React Server Components, Flight) | ✅ | progressive DOM insertion via mutations + the final rendered components via fiber; **the streamed response is read frame-by-frame via `spyStream` (tee of a clone, `\n\n`-split, capped 50 frames)** when the content-type matches the stream set. **Residual:** non-`\n\n`-framed RSC chunks are partial (frame-split heuristic); the server-side component render logic is server-brain. |
| Feature flags / experiment gating | 🟡 | exactly the variant THIS user saw (DOM/styles for their bucket) + the flag-eval response body (often LISTS resolved flags) + props carrying flag values + data-experiment attributes. **Residual:** the bucketing/targeting logic + server-evaluated flags never sent to the client are server-brain; other variants aren't rendered. |
| A/B test instrumentation / telemetry | 🟡 | exposure beacons captured as fetch/XHR POSTs (event names, exposure payloads, body). **Residual:** `navigator.sendBeacon` + image-pixel beacons are NOT hooked (ROADMAP); downstream analytics processing is server-side (irrelevant to the experience). |
| Document head — `<title>`, favicon, `theme-color`, OpenGraph, JSON-LD, meta, canonical | 🟡 | reachable via DOM/HTML when those nodes are engaged or fetched. **Residual:** not proactively enumerated. ROADMAP: a head/meta + JSON-LD harvest (trivially client-observable). |
| CSP / Trusted Types / SRI / `nonce` | 🟡 | most appear in attributes/HTML. **Residual:** the browser strips `nonce` from the DOM attribute (`el.nonce` ≠ attribute) — a capture nuance. ROADMAP. |
| Selection API (`getSelection`, Range) | ❌→ROADMAP | what text the user selected (drives copy, highlight-to-share, annotation) isn't captured beyond `::selection` authored styling (recovered via `matchedRules()` when it matches). Client-buildable. |
| WebAssembly (Figma, Photoshop-web, ffmpeg.wasm, SQLite-wasm, Pyodide) | 🟡→ROADMAP | the `.wasm` fetch is caught by the network hook; **a Wasm-driven WebGL canvas now yields shaders+uniforms+frame via the WebGL hook**. **Residual:** Wasm execution + its linear memory + Wasm-driven Canvas-2D rendering are a blind spot. A major surface for "every level of engineering" — client-observable in part (the module bytes, the WebGL frame), the internal compute is effectively opaque like any minified logic. |
| Speech (`SpeechRecognition`, `SpeechSynthesis`/TTS) | ❌→ROADMAP | not hooked. `SpeechSynthesis` (utterances, voices) is client-observable; `SpeechRecognition` is a device/cloud stream. Client-buildable for the synthesis side. |
| Geolocation / Permissions API + permission prompts | 🟡 | the map/UI that renders from geolocation is captured. **Residual:** the `navigator.geolocation`/`navigator.permissions` calls aren't hooked, and the browser permission **prompt is browser chrome (platform wall)**. ROADMAP for the API calls. |
| Device / sensor APIs (DeviceOrientation/Motion, Gamepad, Pointer Lock, Vibration, Battery, Network Info, Idle) | ❌→ROADMAP | `navigator.connection.effectiveType` IS captured in context (✅ for that one). The rest aren't hooked — they drive tilt-parallax / FPS / adaptive-quality behavior on bleeding-edge sites. Client-buildable. |
| Payments — Stripe Elements / Payment Request / Apple/Google Pay / 3DS | ❌ PLATFORM WALL | the PCI-scoped card iframe is **deliberately cross-origin/sandboxed** — you cannot read it (that is the point). A clean security wall, distinct from server-brain. |
| WebAuthn / Passkeys (`navigator.credentials`) | ❌ PLATFORM WALL | the authenticator ceremony is OS/hardware; the challenge/response crosses fetch as shape only. A hardware/platform wall. |
| CAPTCHA / bot-detection (reCAPTCHA, Turnstile) | ❌ PLATFORM WALL + SERVER-BRAIN | renders in a cross-origin iframe (read-blocked) and scores server-side (invisible). Hard wall on both axes. |

---

## 4. THE CAN'T-DO SIDE, ISOLATED

This is the **entire** list of what Dis Dat genuinely cannot capture — and it is exhaustively
short. **Nothing here is anything the user actually experiences as content.** Every item is
either the server's hidden brain or a browser-enforced security boundary protecting credentials,
other origins, or protected hardware.

**A. SERVER BRAIN — private logic + private data (the principled, permanent CAN'T).**
No client tool can ever reach these because, by definition, they never enter the browser:
- The server's hidden **algorithm / business logic** — ranking, recommendation, pricing/surge,
  fraud/risk scoring, content-moderation decisions, server-side choreography. We capture every
  client-observable input and output around it; never the code or model.
- The server's **private datasets / database** — the rows the user never fetched, the full
  table, the schema beyond what responses imply. We reconstruct every record the user saw and
  the data contract; never the unfetched remainder.
- **Bucketing / targeting / edge logic** — which variant a user gets, rollout %, server-evaluated
  flags never sent to the client, CDN/geo-routing, rate-limit/quota decisions. Observable only as
  the variant or response that arrived.
- Per-feature corollaries that are server-brain on one axis: the **merge algorithm** behind
  conflict resolution, the **command-palette ranking** when server-backed, the **server
  persistence/versioning** of drafts/sessions, the **server's accept/reject** of an optimistic
  update. In every case the client-visible result IS captured.

**B. PLATFORM SECURITY WALLS — browser-enforced, not Dis Dat limits.**
A handful, each protecting something the spec deliberately keeps out of reach:
- **HttpOnly cookies** — JS cannot read them, ever. (Non-HttpOnly cookies + tokens are
  deliberately redacted by the shipped `redact()` pipeline — a security-by-design choice, not an inability.)
- **Cross-origin stylesheet rule-text** — `.cssRules` throws on a cross-origin sheet (same-origin
  policy), so the authored CSS harvest (`matchedRules()`) skips it. The EFFECT still lands in
  computed; same-origin authored CSS is fully harvested. Mitigation: byte re-host of the `.css`
  off the residential IP (ROADMAP).
- **Cross-origin iframe internals** (Stripe/3DS card fields, ad frames, reCAPTCHA/Turnstile) —
  the same-origin policy forbids the parent from reading their pixels/DOM. (Mitigated where the
  extension injects its own per-frame sensor; the parent still can't.)
- **Closed shadow roots** — `mode:'closed'` interiors are unreachable by any script.
- **DRM-decoded media (EME/Widevine/PlayReady)** — decoded frames live in the CDM black box;
  `toDataURL` on a DRM video throws. A content-protection wall.
- **Worker / GPU readback edges** — OffscreenCanvas in a worker realm, the WebGPU swapchain
  without configured copy usage, the immersive WebXR stereo framebuffer, a cross-origin-tainted
  WebGL/canvas frame — realm-reach / hardware / taint boundaries. (The WebGL shader SOURCE +
  uniforms are still captured; only the tainted pixel readback is walled.)
- **Browser-chrome UI rendered outside the DOM** — native form pickers (date/color/select/file),
  browser autofill, the native `title` tooltip, OS notifications, permission prompts. The
  resulting value/state is captured; the chrome popup itself is not in the page.
- **`:visited` link color** — browsers deliberately lie to `getComputedStyle` for anti-fingerprinting.
- **Exact server-side timing / internal state** — TTFB-internal processing time and server memory
  are knowable only where the server chooses to expose them (`Server-Timing`).

Everything else — every visual, every motion, every byte of data the user was handed, every
interaction, every persisted/resumed state — is on the **CAN** side: captured outright, captured
partially with the named residual, or delivered as a recipe the agent re-derives. The residuals
on the CAN side are not server walls; they are **client-observable and buildable** (the ROADMAP
items), which is why they remain on the CAN side in principle even when marked 🟡/❌ today.

### Roadmap (not yet shipped)

Verified absent from v0.10.0 — narrow, named, all client-observable and buildable (none is a server wall):

1. **Viewport screenshot** — `captureVisibleTab` via the `tabs` permission (not in the manifest
   today). The one witness that captures everything visible regardless of how it was drawn.
2. **Temp-file byte bundle + residential-IP byte re-host** — font/image/media bytes uploaded to a
   tmpfiles-style temp file and re-hosted neutral so the agent's datacenter fetch can't 403.
   Today assets are delivered as URLs + inline SVG (text response bodies are captured inline,
   redacted, capped 8000 chars/exchange).
3. **Interaction-trace** — a causal action→call→state-diff log over time (the played motion AS A
   TIMELINE: spring settle / fling decay / overshoot / cadence; the stick/unstick scroll moment;
   a multi-width re-query for OTHER breakpoints' resolved values). Gesture/scroll/physics
   feel-over-time is still re-derived from a single-instant snapshot + coarse trail, not recorded.

---

## 5. Completeness statement (the lock)

Anything on a modern web page falls into exactly one of three buckets, and this set accounts for
all three:

1. **Captured (✅)** — the client-observable fact is delivered verbatim or as a faithful recipe.
2. **Partially captured (🟡)** — captured with a single, **named** residual, and the residual is
   stated honestly (a cap, a single-instant snapshot, a not-yet-shipped ROADMAP hook, or a
   platform wall such as cross-origin stylesheet rule-text).
3. **Can't (❌)** — and the can't side is **only** the server's hidden brain (private logic +
   private data) plus the short, fixed list of browser security walls in §4 — never anything the
   user actually sees, feels, or is handed.

The set is complete on its own terms: the boundary is exact, every modern and bleeding-edge
surface (through the 2024–2025 CSS, networking, media, and platform additions) is placed on it,
and the gap between today's shipped v0.10.0 and the full promise is itself fully enumerated as the
three named ROADMAP items above — none of which is a server wall. **If the user can experience it,
it is captured, partially captured with a named residual, or explicitly a server/security wall.
There is no fourth category.**

---

## Proof case: elevenlabs.io audio-reactive fluid orb (v0.13.0)

**Target:** `elevenlabs.io/agents/ai-outbound-calling` — the audio-reactive fluid "voice orb"
(a WebGL2 + GLSL fluid simulation), plus the page's praised hero button and its live API. Picked
as a worst-case for animation + API complexity. Validated by an adversarial multi-agent run: capture
→ rebuild-from-capture-only → 3 skeptical verification lenses.

### Captured verbatim (proven)

- **All 10 WebGL programs, byte-for-byte** — 9 GLSL1 fluid-sim kernels (advection, divergence, curl,
  vorticity confinement, Jacobi pressure, gradient-subtract, clear, splat, blur) + the bespoke
  WebGL2/GLSL3 orb composite (sphere SDF, simplex/fbm warp, ring, colour-correct). The full
  370-line / 11,242-char fragment shader + its vertex shader survive intact in `elements[].gl`;
  all 10 parse cleanly. The handoff text shows the first 140 lines and points to the bundle for the rest.
- **Live uniform snapshot + a real 512×512 rendered PNG frame** — the resting visual is exact.
- **The praised button — pixel-rebuildable from static capture:** `background-color rgb(242,242,242)`,
  WaldenburgFH 14px/700, 0.7px tracking, uppercase, the verbatim 3-layer `box-shadow`,
  `border-radius 9999px`, inline SVG icon asset, `cubic-bezier(0.31,0.325,0,0.92)`/0.3s transition,
  click listener + React `onClick`.
- **Network/API contract** (20 requests, headers/bodies/timing), **causal interaction timeline**
  (gaze + scroll + network + DOM-mutation on one clock), **16–24 screenshots**, **one re-hosted
  gzipped bundle** (no origin 403s).

### The reproduction result — honest

A from-capture rebuild reviewed by 3 adversarial lenses **ran and was correct in mechanism** (12
shaders + the full Navier-Stokes pipeline carried verbatim), but was **not a pixel-perfect clone on
capture alone**. What had to be *inferred*: the JS render harness (FBO graph, ping-pong, Jacobi
iteration count), the audio pipeline (getUserMedia→AnalyserNode→uniforms), the active-state uniform
values (orb was idle/silent at capture), and the gradient colour-ramp texture (not in the capture).
Sharp finding: in the original, the fluid sim contributes almost nothing *visible* — the orb's look
is SDF-sphere + fbm + gradient + ring; the fluid field is only a sub-pixel UV nudge.

### The hard boundary (confirmed)

- **Server brain — permanent.** The calling agent (LLM, voice model, telephony, dialog state) is
  server-side. We capture the API *contract*, never the logic. No client tool can.
- **JS render harness — not captured, but reconstructable *here* only because** the shaders are a
  near-verbatim fingerprint of Pavel Dobryakov's open-source WebGL-Fluid-Simulation (shared 5-tap
  neighbour vertex shader, exact divergence/curl/Jacobi stencils, his uniform names). Identical
  shaders from a **bespoke unknown** sim would leave the harness unrecoverable. Don't over-generalise.
- **Authored assets not rendered to a captured frame** (e.g. the orb's gradient texture) — absent.
- **Active uniform values when the element is idle at capture** — inferred, not captured.

### Fixed in v0.13.0 / v0.15.0 / v0.16.0 as a result

- **Authored CSS capture was returning ZERO rules on every modern site — three layered bugs, found
  in order by re-capturing and reproducing live:**
  1. *(v0.13.0)* `styleSheet.cssRules` throws on CDN/subdomain-served CSS → the main Tailwind sheet
     (served off `eleven-public-cdn`) was unreadable. Fixed by having the background fetch the blocked
     sheet (host perms) and rebuilding it as a constructable `CSSStyleSheet` we can walk.
  2. *(v0.15.0)* the pseudo-stripping regex ate the `:hover`/`:active` *inside* escaped Tailwind class
     names (`.enabled\:hover\:bg-x:hover`), mangling the selector. Fixed with a `(?<!\\)` lookbehind.
  3. *(v0.16.0 — the dominant one)* the rule-walker did `if (rule.cssRules) { recurse; continue }` to
     descend into `@media`/`@layer`. But **modern Chrome exposes an (empty, truthy) `.cssRules` on
     every `CSSStyleRule`** for CSS-nesting support — so the `continue` skipped *every* style rule's own
     selector before it could match. This zeroed authored CSS on same-origin (claude.ai) AND
     cross-origin (elevenlabs) alike. Proven with a headless-Chromium repro of the live page: old
     walker matched **0** rules on the CTA button, fixed walker (check `selectorText` first, recurse
     only when `cssRules.length>0`) matched **31** (`.inline-flex`, `.h-40`, `.items-center`, …).
  Net: this was the root of the "hover/active microinteraction not captured" gap across the modern web.
  Lesson logged — verify capture claims against a real recovered bundle, not the happy path.
- **Deeper de-noise** — logical-property aliases, default flex/outline/transition/animation values
  dropped (measured ~42%+ computed-prop cut, full signal retained).
- **Screenshot pollution fixed (v0.12.1)** — our own gaze-trail + recording pill no longer painted
  into the captured frames.
- **Screenshot window extended** 16→24 frames; shader-truncation note points to the bundle.

### Still open (named residuals, not walls)

- Capturing the bound **texture/asset bytes** an element samples but doesn't render to the captured
  frame (the gradient ramp) — would need `readPixels` of the bound texture or an asset fetch.
- Capturing **active dynamic uniform/state values** when the element is idle at capture time.
- Multi-page capture still collapses toward page 1; `console[]` often empty.
