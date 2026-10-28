# Dis Dat — Design Tokens (the Pro product) · spec v0

_Peter's call, 2026-07-06: "the knobs are actually going to be tokens." First post-launch build._

## The idea
Every capture feeds a **persistent, per-app token library** — the user's taste, structured. Not
ephemeral knob-chat (that's the free/OSS tier): saved, visible in the UI, toggleable, eventually
team-shared. This is what Pro *is*.

## Why it wins
- Solves the broken-tweak problem: ranges are **grounded in observed values** from real captures
  (+ source-derived bounds), so "make the WebGL feel faster" turns a token inside a known-safe range
  instead of freestyle-editing a uniform until it breaks.
- Compounding value → retention: the library gets more valuable with every capture (opposite of a meter).
- Clean OSS/paid split: skill = in-the-moment study (agent-only, evaporates); Pro = persistence + UI + team.

## Token model (v0)
```
token {
  id, user_id, app (hostname or user-named project),
  category: see Taxonomy v1 §1 — color·type·space·shape·layer·border·icon·texture · motion·media·video·webgl · net·auth·storage·consent·prefs·flags,
  name ("card-entrance.ease"), value (current pick),
  observed: [{value, source_url, captured_at}],   // evidence
  range: {min,max} | options[],                    // grounded, never invented
  liked: bool (from the user's spoken reaction / choices)
}
```
Extraction: from data we ALREADY capture — animations (easing/duration/stagger), computed styles
(palette, radius, shadows, type scale), shader uniforms + their observed values. The crunch step tags
which ones the user reacted to ("liked" tokens).

## Surfaces
1. **Extension**: after a capture, "N tokens extracted → view"; a token panel (toggle liked, rename,
   pick app). The knobs conversation stays, but choices WRITE tokens.
2. **Website /account → /tokens**: the library per app; copy-as (CSS vars / Tailwind config / JSON).
3. **Agent**: `GET /x/tokens?app=` — the skill/extension paste can say "apply my saved tokens" and the
   agent pulls the library. This is the lock-in loop: their agent builds with THEIR tokens every time.
4. **Team (later)**: shared libraries = the seats/enterprise tier.

## Server
- `tokens` table (SQLite, per the model above); CRUD under /x/tokens (Supabase-JWT auth as usual).
- Pro-gated: free users see tokens extracted from the CURRENT capture only (ephemeral preview);
  saving/library requires Pro. (Exact gate TBD — maybe free saves 1 app.)

## Open questions for Peter
- Free tier: preview-only vs. 1 saved app?
- Trial stays 30 min at launch (TRIAL_MIN env — revisit with activation data).
- Token naming UX: auto-names with rename, or ask-on-save?


---

# Addendum 2026-07-06 — full-stack tokens + Orb Lab

Peter's directive (verbatim intent): "amateur design tokens only contain basic CSS. We need our
design tokens for EVERYTHING, every possible element" — animations used, media on the page and how
it enters (scroll vs automatic), how videos play, how the API is set up, how the backend is called,
how cookies are stored. Plus SLOTS: named queries so the agent building a specific element pulls
exactly the tokens that fit.

**Live proof: https://disdat.dev/orb-lab.html** — ElevenLabs' actual compiled orb engine (the same
`orb-engine.js` chunk the /research page mounts, not a reproduction), with 25 uniforms harvested off
the RUNNING program at page load; 19 live knobs (sphere/noise/fbm/grade + uRotationSpeed), shipped
values at the tick, grounded ranges; shape frames (circle/squircle/rounded/square/triangle/hex/pill —
the circle is a wrapper clip exactly like the research page's rounded-full, uCornerRadius stays the
shader's bulge knob); energy/wind/jiggle synthetic drive + mic through their own setAudioData();
texture swaps (their gradient vs generated alternates). This page IS the "learn its ranges, keep all
its layers, let us play" thesis, running on the domain.

# DisDat Token Taxonomy v1

## 0. The grounding rule

Every token value is an **observation**, every range is **derived from observations**: enums enumerate only witnessed values; numeric bounds are observed min–max, histogram percentiles, fitted-parameter spans (with residuals), or shader-math tolerance analyzed on captured source. Discrete design decisions (radii, shadow recipes, focus rings) are **option sets or verbatim recipes, never sliders** — a slider between 8px and 16px invents 11px, which the app never shipped. Derived tokens (base unit, scale ratio, style classification) carry the raw census + a conformance %. Every token holds `evidence: [{value, source_url, captured_at}]`. A bound exists only if evidence touched it. No exceptions.

**Privacy corollary:** network/storage evidence stores **shapes, never secrets** — JWTs decoded for alg/claims-keys/lifetime then redacted; bodies reduced to casing histograms + truncated excerpts; cookie/ID values reduced to format + length. Flag **variant values** are the one deliberate exception (they are the design decision).

## 1. Category enum

Extends the spec's current `motion | color | type | space | shape | webgl | layer`:

```
color · type · space · shape · layer · border · icon · texture ·
motion · media · video · webgl ·
net · auth · storage · consent · prefs · flags
```

`layer` absorbs elevation/z/glass. `net` = API + fetch + cache + realtime + vendor stack. `storage` = cookies + web storage + IDB/SW. `flags` = feature flags + experiments + analytics identity.

**Today column:** ✅ falls out of existing capture (DOM outline, authored+computed CSS, WAAPI, media elements, GL hook, screenshots) · ◐ partial (CSS/DOM side captured, behavioral side new) · 🔴 needs new machinery (§4).

## 2. Tokens

### color

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| color.surface.layers | L0 #0A0A0B → L1 #131316 → L2 #1C1C21 | observed ladder; L bounds 0.08–0.16 | computed CSS + role census | ✅ |
| color.text.hierarchy | primary .95 / secondary .62 / tertiary .40 alpha | exact observed alpha steps | computed CSS | ✅ |
| color.accent | #5B8CFF; hover +6% L, active −5% L | shipped value + authored state deltas | computed + authored `:hover/:active` | ✅ |
| color.semantic.status | success #2EB67D, warn #ECB22E, danger #E5484D | observed triple only | computed CSS | ✅ |
| color.overlay.scrim | rgba(0,0,0,.55) dialog backdrop | alpha bounds .45–.60 observed | computed CSS | ✅ |
| color.scheme.pairs | --bg #FFF ↔ #0A0A0B under dark | authored light/dark pairs per property | authored `prefers-color-scheme` | ✅ |
| color.vars.map | --gray-1…12 Radix-style ramp on :root | authored ramp verbatim | authored CSS | ✅ |

### type

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| type.family.roles | display 'Söhne', text 'Inter', mono 'Berkeley Mono' | observed role→family bindings | computed stacks + @font-face | ✅ |
| type.scale.steps | {12,13,14,16,20,24,32,48,72}px | observed set; ratio annotated iff ≥90% fit | computed size census | ✅ |
| type.weight.by-role | body 400, labels 500, headings 600 | observed set keyed to role buckets | computed CSS | ✅ |
| type.leading.rhythm | body 1.6, headings 1.1, controls 1.0 | observed ratio set | computed CSS | ✅ |
| type.tracking.by-size | −0.022em ≥48px; +0.08em on 12px caps | piecewise enum per observed size bucket — never interpolated | computed CSS | ✅ |
| type.case.labels | uppercase + 0.08em on eyebrow/nav | pattern + exact observed pairing | computed CSS | ✅ |
| type.measure.prose | max-width 65ch on article bodies | observed bounds 60–72ch | computed CSS | ✅ |

### space

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| space.scale | base 4px (GCD, 93% conf.); steps {4,8,12,16,24,32,48,64,96} | derived base + conformance % + raw step set | computed box props | ✅ |
| space.inset.by-role | button 10×18; card 24 uniform | observed inset pairs per role cluster | computed CSS + role census | ✅ |
| space.gap.stack | flex gaps {8,12,16,24} by depth | observed gap set keyed to depth | computed CSS | ✅ |
| space.section.rhythm | 128px between sections | observed rect-delta bounds 96–160px | DOM geometry | ✅ |
| space.container.widths | {640 prose, 1120 grid, 1440 shell} | observed max-width enum | computed CSS | ✅ |

### shape

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| shape.radius.options | {6,8,12,16,24,9999}px | option set = observed vocabulary, never a slider | computed CSS | ✅ |
| shape.radius.by-role | input 8, button 10, card 16, pill 9999 | enum keyed to role clusters | computed + census | ✅ |
| shape.radius.concentric | inner 8 = outer 16 − pad 8 | rule asserted only from ≥2 conforming pairs | computed + geometry | ✅ |
| shape.squircle.technique | clip-path superellipse on icon tiles | enum {plain, clip-path, corner-shape, svg-mask} observed | computed + DOM SVG | ✅ |
| shape.aspect.by-role | 16/9 video, 1/1 avatar, 4/5 card | observed ratio enum per media role | computed + rendered boxes | ✅ |
| shape.corner.asymmetry | 16 16 0 0 on bottom sheets | observed asymmetric patterns + where | computed CSS | ✅ |

### layer

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| layer.shadow.levels | e1 `0 1px 2px .06` / e2 `0 4px 12px .10` / e3 `0 16px 48px .18` | observed recipes verbatim, clustered; layer-count enum {1,3} | computed box-shadow census | ✅ |
| layer.shadow.tint | rgba(20,30,60,α), never pure black | observed color set; hue bounds 210–230° | computed CSS | ✅ |
| layer.z.tiers | {10 sticky, 40 dropdown, 50 modal, 60 toast} | sorted observed set with role labels | computed z-index | ✅ |
| layer.glass | backdrop blur(12px) saturate(1.4) on header | blur 8–16px, saturate 1.2–1.5 observed | computed CSS | ✅ |
| layer.strategy | hairline-first; heavy shadows overlays-only | enum {hairline-first, shadow-first, mixed} from census ratio | census + screenshot | ✅ |

### border

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| border.width.options | {1px, 0.5px retina hairline} | observed set | computed CSS | ✅ |
| border.color.formula | alpha-on-fg: white .08 dark / black .10 light | alpha .06–.12 observed; formula classified | computed across schemes | ✅ |
| border.divider.technique | 1px bg-color `<div>` (12/14 dividers) | enum {border, bg-div, gradient} + counts | DOM + computed | ✅ |
| border.focus.ring | `outline: 2px solid #5B8CFF; offset 2px` | **verbatim authored recipe — no range** | authored `:focus-visible` | ✅ |
| border.input.states | neutral → accent + 3px .25 ring on focus | enum of authored per-state declarations | authored CSS | ✅ |

### icon

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| icon.grid | {16,20,24}px, stroke 1.5 @24 viewBox, round cap/join | observed size + stroke + cap sets | inline-SVG census | ✅ |
| icon.style.family | outline — 92% of 63 SVGs | enum {outline, filled, duotone} + census count | SVG census + screenshot | ✅ |
| icon.color.mode | `stroke="currentColor"` everywhere | enum {currentColor, fixed, css-var} + counts | SVG census | ✅ |
| icon.tile.container | 20px icon in 36px tile, surface-2, r10 | conforming observed geometry (≥3 instances) | DOM geometry | ✅ |

### texture

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| texture.grain | feTurbulence bf 0.8, opacity .06, overlay | technique enum + params verbatim | DOM + computed | ✅ |
| texture.gradient.grammar | radial mesh, 2–3 stops, hue 210–260°, ΔL<0.15 | bounds parsed from every observed gradient string | computed CSS | ✅ |
| texture.imagery.grade | warm low-sat: hue 20–45°, S<0.35; grayscale logo wall | histogram percentiles + observed filter recipes | screenshot px + computed | ✅ |
| texture.asset.density | 2× assets: natural÷rendered ≈ 2.0 (18/19) | observed ratio bounds 1.9–2.1 | media elements + geometry | ✅ |

### motion

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| motion.easing.set | {ease-out, cb(.4,0,.2,1), cb(.16,1,.3,1)} | deduped observed curves | computed + WAAPI + @keyframes | ✅ |
| motion.easing.entrance-exit | in cb(.16,1,.3,1) / out cb(.7,0,.84,0) | decel/accel curves per observed direction | WAAPI keyframes | ✅ |
| motion.easing.spring | stiffness 170, damping 26, via linear() 60-pt ramp | **fitted** from captured tracks; range = fitted span | WAAPI dense keyframes / linear() | ✅ |
| motion.easing.pairing | transform→ease-out, opacity→linear | observed property→curve map | computed transitions | ✅ |
| motion.duration.scale | {100,150,200,300,500,800}ms | raw deduped set — the quantization fingerprint | computed + WAAPI | ✅ |
| motion.duration.bands | micro 100–150 / std 200–300 / entrance 450–800 / exit 150–300ms; exit≈0.65× enter | band-clustered observed min–max; ratio from paired enter/exit only | WAAPI timing | ✅ |
| motion.stagger | 60ms/item, cap 400ms, dom-order | slope of delay-vs-index regression; order classified vs geometry | WAAPI delays + DOM index | ✅ |
| motion.choreo.parent-child | container-first, children +120ms; opacity∥transform | enum from parent/child startTimes | WAAPI | ✅ |
| motion.entrance.pattern | fade + translateY 24px, from scale .96 / blur 6px | pattern enum + magnitude min–max from from-states | WAAPI getKeyframes() | ✅ |
| motion.exit.pattern | fade + scale→.98, no translate | enum from observed exit keyframes | WAAPI | ✅ |
| motion.page.view-transition | @view-transition auto; 300ms; `hero-image` shared | enabled/duration/named elements as observed | authored CSS + pseudo WAAPI | ✅ |
| motion.reveal.trigger | IO threshold .25, rootMargin −15%, once, `.in-view` | enum {io, scroll-listener, css-view-timeline, on-load} + literal hooked params | **IO hook**; CSS view-timeline subset ✅ | ◐ |
| motion.scroll.linked | parallax bg 0.2 / mid 0.5 / fg 1.0; 180vh pin | fitted slope ± residual per layer; nothing beyond swept range | **scroll sweep**; scroll-timeline subset ✅ | ◐ |
| motion.hover.recipe | −2px lift + scale 1.02, 150ms in / 300ms out, shadow e1→e2 | authored deltas per component class; asymmetry classified | authored `:hover` diffed vs base | ✅ |
| motion.press.recipe | scale .97, 80ms | observed .94–.98, 50–120ms | authored `:active` | ✅ |
| motion.reduced.strategy | disable-all; coverage 0.8 | enum {disable-all, shorten, opacity-only, selective, none}; coverage = ratio over animated selectors | authored reduce blocks; behavioral pass 🔴 | ◐ |

### media

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| media.kinds | {photo, inline-svg, mp4, webgl-canvas} | observed kinds only; ratios by count + area | DOM census + screenshot classify | ✅ |
| media.hero | looping bg mp4 behind scrim; Lottie for feature spots | hero-medium + motion-medium enums, observed | DOM + computed | ✅ |
| media.img.fit | cover, object-position 50% 30% | observed fit/position values | computed CSS | ✅ |
| media.img.scrim | linear-gradient transparent→rgba(0,0,0,.6) on heroes | observed overlay gradients | computed / pseudo-elements | ✅ |
| media.delivery.formats | avif→webp→jpg via `<picture>` | observed from `<source type>` + currentSrc | DOM attributes | ✅ |
| media.delivery.srcset | {384,640,1080,1920}w; sizes `(min-width:1040px) 50vw` | literal observed ladder + sizes strings | DOM attributes | ✅ |
| media.delivery.pipeline | next/image, q=75 | URL fingerprint enum + observed quality values | src URL analysis | ✅ |
| media.loading.policy | lazy below fold; hero eager + fetchpriority=high + preload | observed attr combos keyed by fold position | DOM attrs + `<link rel=preload>` | ✅ |
| media.loading.placeholder | LQIP blur-up, blur(20px); shimmer 1.4s linear | enum {none, lqip, dominant-color, skeleton, spinner} + captured keyframe params | DOM markup + @keyframes | ✅ |
| media.lifecycle | swap @~380ms w/ 200ms fade; hero = LCP @1.2s; images 1.1MB | observed timing/weight distributions, min–max | **load-window observers** | 🔴 |
| media.trigger.entrance | images on-scroll @25% visible; hero video automatic | {on-scroll, automatic, on-load, on-interaction} per media type + hooked IO params | **IO hook** + event log | 🔴 |

### video

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| video.attrs | autoplay muted loop playsinline, no controls (hero); native controls in modal | observed combos keyed by role; controls enum {native, custom, none} | element attrs | ✅ |
| video.role.background | absolute inset:0, object-fit:cover, z −1 behind scrim | observed placement pattern | computed CSS | ✅ |
| video.loop-length | 8s seamless hero loop | duration property; observed 6–12s | element props | ✅ |
| video.source | blob:+hls.js ⇒ HLS/MSE; marketing loops static mp4 | enum {mp4, webm, hls-mse, youtube, vimeo, mux} — src scheme + player-script fingerprint | src forensics + DOM | ✅ |
| video.autoplay-gate | play() at ≥50% visible, pause() on exit | observed IO threshold driving play/pause events | **IO hook** + media event log | 🔴 |
| video.scrub | currentTime = scrollProgress × duration | fitted scrub mapping from sampled correlation | **scroll sweep** | 🔴 |
| video.interaction | hover: muted preview, reset on leave; click: lightbox | enums {play-on-hover…}, {inline-swap, lightbox, navigate} — observed firings only | listener enum + event log | 🔴 |

### webgl

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| webgl.program.identity | 3 programs; orb frag sha256:9f2a…, 214 lines, highp, GLSL ES 3.00 | exact hashes/counts — identity tokens have no range | GL hook shaderSource | ✅ |
| webgl.program.uniforms | 21 declared: uTime, uSphereScale, uAvgVolume, uColor1… | exact interface parsed from source; schema for all uniform tokens | GL hook source parse | ✅ |
| webgl.program.math | Ashima simplex + 5-octave fbm; sdRoundedBox squircle | enum from source-signature match {simplex, fbm-of-*, voronoi…} × SDF set | GL hook source parse | ✅ |
| webgl.uniform.shape.* | uSphereScale .9, uSpherePower 1.1, cornerRadius .24 | shipped anchor; bounds from shader-math tolerance (.6–1.2 before SDF clip) — Orb Lab method | GL hook getUniform | ✅ |
| webgl.uniform.noise.* | uNoiseSpeed .25, uFbmScale 3.25, uFbmAmplitude .65 | anchors + tolerance bounds (0–.4 before surface tear) | GL hook getUniform | ✅ |
| webgl.uniform.color.* | uColor1 [0.42,0.62,0.98], uExposure .15 | vec3s verbatim; exposure .05–.5 before blowout | GL hook getUniform | ✅ |
| webgl.pass.chain | sim → orb → bloom → composite; bloom additive SRC_ALPHA,ONE; velocity ping-pongs FBO2↔3 | exact call-sequence order, targets, blend pairs; toggleable iff FBO dependency graph survives | **GL frame trace** | 🔴 |
| webgl.texture.inputs | unit 0 gradient LUT (256×1 data-array), unit 1 blue-noise REPEAT | enum {image, video, canvas2d, data-array, framebuffer} + filtering/wrap as set | **GL trace** texImage2D | 🔴 |
| webgl.texture.lut | ramp #0a1a3f → #3b6fe0 → #cfe4ff | color stops from **pixel readback** — GL palette no CSS tool can see | **GL trace** + readPixels | 🔴 |
| webgl.drive.pointer | uMouse lerp 0.08/frame; +0.05 noise within 120px | lerp factor fitted from uniform-vs-pointer time-series | **rAF uniform timeline** + events | 🔴 |
| webgl.drive.audio | uAvgVolume ← AnalyserNode RMS (fft 1024), smoothing 0.8 | band→uniform map from correlated analyser reads — the orb voice channel | **WebAudio hook** + timeline | 🔴 |
| webgl.drive.presets | speaking: uNoiseSpeed .25→.6; idle reverts ~400ms | named uniform clusters per app state, transition time from timeline | **rAF uniform timeline** | 🔴 |
| webgl.frame | rAF continuous, 58.2fps avg, pauses offscreen; {alpha:true, antialias:false}; DPR min(dpr,2) | measured fps histogram; getContext attrs exact; DPR computed from attrs÷CSS size | **rAF wrap + getContext hook**; canvas attrs ✅ | ◐ |
| webgl.canvas.placement | inline-widget 320px, or fixed full-bleed z −1, blend screen, pointer-events none; poster fallback beneath | role enum derived from position+size+stacking; fallback from DOM siblings | DOM + computed + screenshot | ✅ |
| webgl.canvas.entrance | opacity 0→1, 600ms cb(.22,1,.36,1) after 1 warm-up frame | WAAPI capture on canvas + frames-before-visible | WAAPI ✅ / warm-up 🔴 | ◐ |
| webgl.scene | raw WebGL2 no framework; drawArraysInstanced 12,000; camera fov 35° z 5.2 | library via globals+source signatures; counts from real draw args; camera decomposed from captured matrices | **GL trace** + uniform dump | 🔴 |

### net

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| net.api.style | GraphQL (POST /graphql {query,variables}); REST for auth | fingerprint enum {REST, GraphQL, tRPC, JSON-RPC, gRPC-web} — observed only, multi-valued | **CDP net tap** | 🔴 |
| net.api.base | same-origin /api/* + wss://realtime.* | enum from observed request origins | CDP tap | 🔴 |
| net.api.grammar | plural-noun REST, kebab-case, /v1/ path, max 1 nesting level | case/versioning/grammar computed over observed path corpus | CDP tap | 🔴 |
| net.payload.casing | responses camelCase (96% of keys, n=41); requests snake_case | majority-vote histogram + corpus size | CDP response bodies (shape-only) | 🔴 |
| net.payload.envelope | {data, meta:{requestId}} on lists | enum {bare, {data}, JSON:API, graphql} | CDP bodies | 🔴 |
| net.payload.ids | usr_2Nf8 prefixed ids; ISO-8601 UTC ms timestamps | regex classification of observed fields | CDP bodies | 🔴 |
| net.error.shape | {error:{code,message,requestId}} + semantic 4xx | from observed non-2xx only; **empty if never witnessed, never guessed** | CDP bodies + status | 🔴 |
| net.fetch.pagination | cursor ?after=…&first=50; infinite-scroll fires ~300px before end | style enum + observed sizes {20,50} + trigger from scroll→fetch causality | CDP + interaction log | 🔴 |
| net.fetch.strategy | hover-prefetch ~180ms pre-click; 6-call parallel burst on mount; deduped (React Query tell) | enums from timeline overlap + coalescing analysis | CDP + resource timing | 🔴 |
| net.fetch.optimistic | DOM mutates 12ms after click, POST resolves 340ms later | optimistic \| pessimistic — DOM-mutation timestamp vs response timestamp (cross-refs existing DOM capture) | CDP × MutationObserver | 🔴 |
| net.retry | 1.0→2.1→4.2s after 503, max 3 | measured delay sequence; shape classified from measured deltas only | CDP timeline | 🔴 |
| net.cache.policy | API no-store; assets max-age=31536000 immutable; Vercel edge HIT | literal header values per origin class; CDN header fingerprint; HITs need two-pass | CDP headers, **two-pass** | 🔴 |
| net.cache.client-swr | 4 queries refire <100ms after tab refocus | asserted only when refetch-on-focus sequence observed | CDP + visibility events | 🔴 |
| net.realtime | wss Phoenix Channels; JSON frames; heartbeat 30s ±0.2; topics `doc:8f2e` | provider = hostname + frame-signature two-factor; heartbeat = measured cadence; topics literal | CDP webSocket frames + SSE hook | 🔴 |
| net.services.stack | Stripe + Supabase + Clerk + PostHog + Sentry + LaunchDarkly; Next.js RSC (?_rsc=) | fingerprint-table matches with triggering URL/global as evidence — never folklore | CDP hostnames + globals; script tags ✅ | ◐ |

### auth

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| auth.scheme | bearer-jwt on api.*, cookie session same-origin | enum per observed origin | **CDP extra-info headers** | 🔴 |
| auth.session.residence | HttpOnly `__Host-session` (in chrome.cookies, absent from document.cookie) | {httponly-cookie, js-cookie, localStorage-jwt, indexeddb} — HttpOnly provable only via cookies permission | **cookies API** + storage probe | 🔴 |
| auth.token | JWT RS256, exp−iat 3600s, claims {sub,email,role} (values redacted) | format classified; TTL = decoded arithmetic min–max | CDP + local decode, redacted | 🔴 |
| auth.refresh.flow | 401 → POST /refresh → replay | asserted only when the sequence was literally observed | CDP timeline | 🔴 |
| auth.csrf | x-csrf-token header mirrors csrftoken cookie | {header, hidden-field, double-submit, none}; meta side ✅ in DOM | CDP + DOM meta | ◐ |
| auth.vendor | Supabase (sb-*-auth-token) / Clerk / Auth0 / next-auth | fingerprint match on observed cookie/storage names only | storage probe | 🔴 |

### storage

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| storage.cookies.census | 23 cookies, 61% first-party; vendors _ga, __stripe_mid, __cf_bm; app residue `sidebar_collapsed` | jar enumerated; vendor attribution via prefix fingerprint table; unmatched = app-custom | **cookies API** + cookieStore | 🔴 |
| storage.cookies.naming | vendor `_snake`, infra `__double`, app camelCase | convention clustered from observed names | cookies API | 🔴 |
| storage.cookies.attrs | 100% Secure; Lax 70/None 25/Strict 5; `__Host-` in use; session vs 30d vs 400d buckets | distributions + expiry buckets over observed jar only | cookies API | 🔴 |
| storage.local.grammar | `sb-abcxyz-auth-token`, `ld:$flags`, bare `theme`; JSON 60%/string 30%/base64 10% | namespace pattern clustered from key splits; encoding distribution | **storage probe** | 🔴 |
| storage.local.owners | app 7 keys, LaunchDarkly 3, Supabase 2, Intercom 4; 42 KB total | SDK key fingerprints; footprint min–max across captures | storage probe | 🔴 |
| storage.idb | firebaseLocalStorageDb; app-cache v12 → entities(keyPath id), mutations-queue; 1,204 records | DB/store/keyPath enumeration + count() per store | storage probe (Chromium indexedDB.databases) | 🔴 |
| storage.sw | SW /sw.js activated; workbox-precache-* buckets ⇒ Workbox offline strategy | registration + caches.keys() + name-fingerprint attribution | storage probe | 🔴 |

### consent

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| consent.cmp | OneTrust (#onetrust-banner-sdk + OptanonConsent); TCF 2.2 | DOM/global fingerprint + live __tcfapi ping | DOM ✅ + **probe** | ◐ |
| consent.banner.pattern | bottom sheet, non-blocking, first-layer Reject All | {bottom-bar, blocking-modal, corner-toast} + reject parity | rendered DOM + screenshot | ✅ |
| consent.state.encoding | OptanonConsent groups=C0001:1,C0002:0 | decoded from the observed artifact's own format — never a guessed category list | cookie decode | 🔴 |
| consent.gating | pre-consent 4 cookies; post-accept +11 analytics | the two-phase jar **diff IS the token** | **two-pass capture** | 🔴 |

### prefs

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| prefs.theme.mechanism | html.dark + localStorage 'theme'; 'system' follows OS until override | {media-query-only, class+localStorage, class+cookie, data-attr+storage} — cross-checked which artifact carries state | DOM/CSS ✅ + storage probe | ◐ |
| prefs.theme.flash-guard | inline `<head>` script reads theme pre-paint | {inline-head-script, ssr-cookie, none/flash-risk} | captured DOM | ✅ |
| prefs.locale | NEXT_LOCALE cookie 1y; 'es' active, alternates en/ca | persistence channel + observed set from hreflang/html[lang] | DOM ✅ + probe | ◐ |
| prefs.custom-keys | sidebar_collapsed=true, editor.fontSize=14 | pref-lexicon matches + observed value types | storage probe | 🔴 |

### flags

| Token | Example | Range / options | Evidence | Today |
|---|---|---|---|---|
| flags.vendor | LaunchDarkly (ld:* keys) / PostHog / Statsig | fingerprint on observed keys only | storage probe | 🔴 |
| flags.cache.shape | ld:$flags → {key:{value,version,variation}}, 34 flags | schema + variant values kept (the design decision); user IDs dropped | storage probe | 🔴 |
| flags.bootstrap | inline window.__FLAGS__ pre-hydration + localStorage cache | {inline-dom, localStorage, fetch-only, both} — DOM side ✅ | DOM ✅ + probe | ◐ |
| flags.identity | ajs_anonymous_id uuid-v4, dual cookie+localStorage; optimizelyEndUserId 10y | ID format regex-classified then redacted; bucketing artifacts + expiries observed | storage probe + cookies API | 🔴 |

## 3. SLOTS

A slot is a named query: "I'm building THIS element — give me exactly the tokens that fit." Slots are **cross-category joins over token prefixes**, not category aliases. When the agent requests a slot, the library returns every matching token with its evidence, most-conformant first.

| Slot | Pulls |
|---|---|
| `button-primary` | color.accent · space.inset.by-role[button] · shape.radius.by-role · type.weight · border.focus.ring · motion.hover.recipe · motion.press.recipe |
| `card-surface` | color.surface.layers · space.inset[card] · shape.radius · layer.shadow.* · border.color.formula · motion.hover.recipe |
| `form-input` | border.input.states · border.focus.ring · shape.radius.by-role · type.* · motion.duration.bands[micro] |
| `modal-entrance` | motion.entrance.pattern · motion.duration.bands · motion.easing.entrance-exit · color.overlay.scrim · layer.z.tiers |
| `hero-reveal` | motion.reveal.trigger · motion.entrance.* · motion.stagger · media.hero · texture.grain |
| `list-stagger` | motion.stagger · motion.entrance.pattern · motion.choreo.parent-child |
| `video-entrance` | media.trigger.entrance · motion.reveal.trigger · motion.entrance.* · motion.duration.bands[entrance] — the WHEN and the HOW as separate evidenced tokens |
| `video-playback` | video.* · media.loading.policy · media.loading.placeholder |
| `image-card` | media.img.* · media.delivery.* · shape.aspect.by-role · shape.radius · texture.imagery.grade |
| `page-transition` | motion.page.view-transition · motion.duration.bands · motion.easing.set |
| `scroll-parallax` | motion.scroll.linked · motion.reveal.trigger · webgl.drive.pointer (if GL décor) |
| `api-shape` | net.api.* · net.payload.* · net.error.shape · auth.scheme — everything needed to generate a call that parses first try |
| `paginated-fetch` | net.fetch.pagination · net.fetch.strategy · net.cache.client-swr · net.error.shape |
| `optimistic-mutation` | net.fetch.optimistic · net.retry · net.error.shape · motion.duration.bands[micro] |
| `auth-session` | auth.* · storage.cookies.attrs · net.services.stack |
| `cookie-consent` | consent.* · storage.cookies.census · storage.cookies.attrs |
| `persist-preference` | prefs.* · storage.local.grammar · storage.cookies.naming — namespace it the way this app already does |
| `theme-toggle` | prefs.theme.* · color.scheme.pairs · motion.duration.bands[micro] |
| `feature-flag-gate` | flags.* — gate the way this app already gates |
| `voice-orb` | webgl.uniform.* · webgl.drive.audio · webgl.drive.presets · webgl.canvas.placement |
| `gl-entrance` | webgl.canvas.entrance · webgl.frame · motion.entrance.pattern |
| `shader-rebuild` | webgl.program.* · webgl.uniform.* · webgl.texture.* · webgl.pass.* — the full 1:1 recreation chain |

## 4. Capture gaps — build order

Everything ✅ above falls out of capture DisDat already does. The 🔴 tokens need exactly seven pieces of machinery, six of which mirror the proven GL-hook pattern (pre-inject before page scripts, harvest live values). Ranked by value ÷ effort:

| # | Machinery | Unlocks | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **IntersectionObserver + scroll/media-event hook** — wrap the IO constructor + addEventListener; record thresholds, rootMargins, targets, firings, play/pause events | motion.reveal.trigger · media.trigger.entrance · video.autoplay-gate · video.interaction | **XS** — direct GL-hook clone | The founder's literal question ("on scroll vs automatically") and nothing in a static snapshot can answer it. Highest value, smallest diff. |
| 2 | **Client-storage probe + `cookies` manifest permission** — one main-world shot: cookieStore.getAll + chrome.cookies (HttpOnly!) + localStorage/sessionStorage + indexedDB.databases() + caches.keys() + SW registrations + storage.estimate() | ALL of storage · most of auth/consent/prefs/flags (~25 tokens, 5 categories) | **S** — enumeration, no interception | One cheap permission = five categories. HttpOnly proof (in chrome.cookies, absent from document.cookie) is impossible any other way. |
| 3 | **CDP network tap** (chrome.debugger, Network domain) — headers incl. Cookie/Authorization, bodies, websocket frames. Fallback: page-context fetch/XHR patch (GL-hook philosophy) when the debugger banner is declined | ALL of net + rest of auth (~20 tokens) | **M** — permission-banner UX + redaction pipeline | Biggest single unlock ("how their API is set up, how their backend is called"). Redaction rules from §0 are load-bearing here. |
| 4 | **GL frame trace** — extend the existing hook: 1–2s call trace (useProgram/bindFramebuffer/blendFunc/draw*/texImage2D) + uniform dump every rAF + small-texture readPixels + WebAudio AnalyserNode hook | webgl.pass.* · texture.* (incl. the LUT crown jewel) · drive.* · frame · scene — the behavior moat no screenshot competitor can see | **M** — extension of shipped code | Turns the flagship from "rebuild the orb's frame" into "rebuild the orb's behavior". |
| 5 | **Scroll-sweep sampler** — programmatic scrollTo at N offsets, diff computed transform/opacity/currentTime per candidate | motion.scroll.linked · video.scrub · JS parallax | **S** | Fitted slopes ± residuals; never extrapolated beyond the swept range. |
| 6 | **Load-window observers** — PerformanceObserver (resource, LCP) + MutationObserver on media subtrees + requestVideoFrameCallback | media.lifecycle · net.fetch.optimistic cross-ref | **S** | Behavior in time; also the timestamp source that proves optimistic UI. |
| 7 | **Two-pass capture modes** — (a) revisit for 304s/CDN HITs, (b) pre/post-consent jar diff, (c) emulated prefers-reduced-motion | net.cache.policy · consent.gating · motion.reduced (behavioral) | **S** — orchestration, no new hooks | The diff IS the token. |

Plus one non-capture prerequisite: a **post-capture analysis pass** (color clustering, GCD, histograms, SVG census, spring/parallax least-squares fits) over artifacts already collected — every "derived" token in §2 depends on it, and it ships independently of all seven taps.


---

# Addendum 2026-07-06 (2) — Specimens: how tokens get shown

Peter's direction: the orb is ONE ROW. The product surface is a **library of live specimens** —
the design-system equivalent of lorem ipsum: one isolated, playable example per token composite,
composite controls left, the living thing center, ⛶ opens the full view. Industry names for the
pattern: Storybook "stories" with the controls/knobs addon; Figma "components + variants";
type-foundry "specimens" (the word we use). Ours differ in one way: every knob is grounded in
captured evidence, and "as shipped" is always the first preset.

**Live v0: https://disdat.dev/tokens-lab.html** — 7 specimens (webgl orb → full lab link · springs ·
modal-over-content · navbar-on-scroll w/ animated|live toggle + visible scrollbar · inline text
highlight · surfaces & radius option-set · mesh-texture studio), all wired to real Sancho tokens
(springs ζ.85/k500 etc., PhysicalEase, radius set {6,8,12,20,999}+bubble7.5, paper/cloud/elevated,
saffron/crimson highlights). Every specimen has **save-current-as-preset** (localStorage v0 → Pro
persists server-side per app).

**Texture engine (the reduction fix):** the orb's real gradient is ~10 irregular blobs with true
luminance range and diagonal drift. `mkMesh(palette, seed, complexity)` rebuilds that structure —
tiny n×n mosaic of palette cells with strong light/dark jitter (incl. near-black + near-white
anchors), bilinear-upscaled through two rotated layers, ~30 lines of canvas. This is the answer to
"agents can't generate images": they can generate canvases. Palette in, mesh out — simple flat
gradients are exactly the reduction the tool exists to prevent.

**Specimen backlog (from the Sancho app + taxonomy slots):** page transitions, list stagger,
skeleton/LQIP loading, toast/notification entrances, pull-to-refresh physics, image treatment/
duotone, video playback behavior, scroll-linked parallax, form focus states, empty states.
The skill's job at capture time: pick WHICH specimen archetype best demonstrates each extracted
token composite — that choice is part of the taste.


---

# Addendum 2026-07-07 — chat, export, MCP, wider coverage

Peter pushed past "a few elements": the lab now spans 10 specimens (webgl orb · springs · modal ·
navbar-on-scroll · text highlight · surface/radius · texture · **type/scale/family · button ·
chat bubble+typing**) and, more importantly, gained the three things that make it a product not a
demo:

1. **Chat with your library (⌘ Chat).** A right-docked panel. You type plain English ("make the
   springs snappier and the highlight crimson"); it hits a new **Groq**-backed `/x/labchat` endpoint
   ("Groq always"), which returns tool CALLS ({applyPreset|setToken|export}); the page applies each
   live and renders it as a tool card (✓/—). This is the "edit with words" interface — the archetype
   registry (`SPECIMENS[]`, each row registers `{presets, tokens, apply}`) is what lets words map to
   grounded token mutations.
2. **Export (↗ Export).** Every registered row's `exportTokens()` collected into one library, in
   three shapes: **W3C Design-Tokens JSON**, **CSS custom properties**, and **Figma** (same W3C JSON
   → Tokens Studio import). Copy or download.
3. **@ref per specimen** (from the prior pass) — cite a row's current grounded values in an agent
   prompt.

**MCP server** (`apps/disdat/product/mcp/server.py`, zero-dep stdio): exposes the library to Claude
Code / Cursor — `list_tokens`, `get_token`, `export_css`, `export_figma`, and `push_to_figma`
(Figma Variables REST API when `FIGMA_TOKEN` is set). Reads an exported `tokens.json` (or a hosted
URL). This is the "an MCP server people can access + send to Figma" ask, v0 (stdio + file/URL
source); the hosted per-app library (Pro) is the next step so `DISDAT_TOKENS_URL` points at a live
library the lab, extension and agent all share.

**Positioning locked (Peter's words):** it's a **taste library** — a personal, editable Cosmos /
Savee / Mobbin, where the clipping isn't a dead screenshot but the live, tokenized, editable thing
with grounded ranges, an @ref, chat editing, and Figma export. "It's a face library people can build
on, but it's personal."


---

# Addendum 2026-07-07 (2) — hosted MCP lock + Figma plugin

Both built and verified this session.

**Hosted, authenticated MCP (the lock).** Peter: "We only enable the MCP if they sign up to our
hosted thing — that's where we win; their agent sees all their stuff natively." Implemented:
- `users.dd_api_key` + `users.tokens_json` columns (reusing the existing SQLite users table).
- `POST /x/keys` (Supabase auth) mints/returns a `dd_live_*` key (`?rotate=true` to roll).
- `PUT /x/tokens` (Supabase auth) saves the user's DTCG library.
- `GET /x/tokens` (Bearer `dd_live_*` key) returns it — 401 without a valid key.
- MCP `_load_library` now prefers `DISDAT_API_KEY` → live hosted library (falls back to file/URL/sample).
Verified end-to-end against prod: valid key → tokens, bad/no key → 401, MCP lists the hosted tokens.
REMAINING WIRING (next): account page shows/mints the key; lab/extension calls `PUT /x/tokens` so the
saved library IS the hosted one.

**Figma plugin** (`apps/disdat/product/figma-plugin/`, real installable plugin — the any-plan path
since REST write is Enterprise-only). manifest.json + code.js + ui.html. Two modes: paste DTCG JSON
(from the lab's Export→Figma tab) or "From my library" (fetch via the dd_live key). Creates a
"DisDat" variable collection and a typed Figma Variable per token (color→COLOR, number/dimension/
duration→FLOAT, else STRING; dotted names → Figma "/" groups). Pure `buildPlan()` unit-tested in Node
(all type conversions pass). Install: Figma → Plugins → Development → Import manifest.

vs stock, confirmed by research: the token library / chat / export / MCP / widget are all commodity;
the ONLY moat is capturing a real logged-in page's rendered ground truth in the user's tab
(extension), which server-side agents structurally cannot do.


---

# Addendum 2026-07-07 (3) — interaction primitives, projects, the pipeline

**18 specimens live.** Added the interaction primitives Peter called out (all looping while visible,
press-things demonstrated by a GHOST CURSOR that glides in and clicks): input composer (mic↔send
morph), voice note (recording pill → live waveform → playback bubble), emoji reactions (long-press →
spring picker → badge bounce), reply-to-message (swipe → crimson quote chip), transcript sheet
(slide-up + timestamped lines + ✕), editable order table (focus ring → edit → saffron flash on the
total), min/max dual-thumb range (drag demo, value bubbles), incoming call screen (pulsing rings →
answer → timer → end). All registered (chat-drivable, exportable, @ref-citable).

**Projects — the collage book.** Left sidebar: create projects, cluster specimens into them via a 📁
popover per row (a specimen can live in many), selecting a project filters the sheet. Mix & match.
localStorage v0 → Pro persists server-side with the library.

**THE PIPELINE (Peter's "what's the point"):** the product loop is
1. CAPTURE — you point & talk on a real page ("I love this orb / this table feel");
2. IDENTIFY — the crunch step figures out WHICH element/behavior you meant (already does);
3. STUDY — grab the full-fidelity thing (shaders+uniforms, animation timings, computed styles —
   already captured) and tokenize it: grounded values + ranges + which specimen ARCHETYPE renders it;
4. LIBRARY — it lands as a live specimen in YOUR library (project-clusterable, loop-playing,
   editable, @ref-citable, exportable, MCP-readable).
The lab today is step 4 hand-seeded with Sancho + the orb; the archetype registry is the contract
step 3 emits into. Free = steps 1-3 ephemeral (the capture works, knobs evaporate); Pro/hosted =
step 4 persists: the taste library + hosted MCP + Figma plugin "From my library". Those are the three
Pro benefits, verbatim Peter's framing.

**Figma distribution:** for Peter now — Figma desktop → Plugins → Development → "Import plugin from
manifest…" → figma-plugin/manifest.json (private, instant). For users — publish to Figma Community
(free; in-app "Publish" flow, ~days review); after approval anyone runs it from Plugins in any file.

**MCP install/auth UX (next build):** the standard remote-MCP OAuth flow — user pastes
https://api.disdat.dev/mcp into Claude/Codex custom connectors → client discovers OAuth metadata →
"Authenticate" opens our site → login (Supabase Google) → CONSENT screen listing permissions ("read
your token library", "save specimens") → redirect back; client holds tokens. Requires: streamable-
HTTP MCP endpoint + OAuth 2.1 AS (authorize/token, PKCE, dynamic client registration) + RFC 9728
resource metadata. The stdio+dd_live-key server works TODAY for local configs; the OAuth remote is
what makes "add custom MCP → authenticate" feel native.


---

# Addendum 2026-07-07 (4) — Library rename, icon system, remote OAuth MCP SHIPPED

Peter's corrections applied, all live:
- **Renamed**: the page is the LIBRARY (disdat.dev/library.html, "Dis Dat / Library · demo");
  tokens-lab.html 301-redirects. Intro cut to two lines. Filler footnotes trimmed.
- **No emojis**: a single-stroke SVG icon system (ic() — mic/send/play/phone/phoneOff/micOff/x/
  expand/chat/export/folder/refresh/copy/pen/plus) replaced every emoji in the chrome. Emoji remain
  ONLY as content inside the reactions specimen (the pattern itself). Call screen uses real phone
  icons; composer morphs mic→send as SVG.
- **Ghost cursor = the actual DisDat pixel-arrow mark** (icon-1024.png, pixelated).
- **Per-element Figma copy**: every specimen header has a copy button → that row's tokens as nested
  DTCG JSON (paste into the DisDat Figma plugin or Tokens Studio). "Export library" = the whole set.
- **Remote OAuth MCP — LIVE and verified end-to-end on prod**: paste https://api.disdat.dev/mcp into
  Claude/Codex → discovery (/.well-known/oauth-authorization-server + oauth-protected-resource) →
  401 w/ WWW-Authenticate → dynamic client registration → branded consent page (lists permissions:
  read:library, export) → "Continue with your Dis Dat account" → disdat.dev/account?mcp_auth=<sid>
  approves with the Supabase session (POST /x/mcp-approve) → /oauth/continue 302s code+state →
  /oauth/token verifies PKCE S256 → access_token = the user's dd_live key → POST /mcp (streamable
  HTTP, stateless JSON-RPC: initialize/tools/list/tools/call) serves list_tokens/get_token/
  export_css/export_dtcg from THEIR hosted library. Tested: full flow incl. PKCE + tool calls.
- **Account page**: "Your library, everywhere" card — copy MCP address + copy library key (mints
  dd_live via /x/keys); handles the mcp_auth OAuth hop.


---

# Addendum 2026-07-07 (5) — the fidelity audit, executed

9-agent source audit (real Kotlin vs the Library) found and killed the approximations:
- INVENTED, removed/replaced: range slider (Sancho is explicitly anti-slider) — dropped; navbar
  scroll-condense/blur — replaced with the real static 56px paper header; typing indicator —
  replaced with the real "Transcribing…" cue; call ringing/answer phase — replaced with the real
  listen-in → join → active machine; message entrance animation (messages snap in); reply arrow
  glyph; reaction badge bounce + hover-grow; highlight box mode; table header row; stagger token.
- CORRECTED to source: chat bubbles = radius.card 12 + radius.sm 6 TOP notch (7.5 is a legacy WA
  token — kept only as an honesty preset), chatIn #F5F0E8 / chatOut #FBE2E5 + inline timestamps and
  ticks; call = callBgTop→Bottom dark green, saffronDim avatar w/ Red-700 initials, Alerta-yellow
  End, 3-bar EQ 420/510/600ms PhysicalEase, Plex Mono tabular timer; modal = scrim darkened never
  blurred, sheet springs in (expressive) from y33%/s.92 origin 12%/100%, scrim decoupled at 130ms;
  transcript = full-screen paper, back-arrow left, asymmetric 380/110ms; table = row-edit
  borderStrong + steppers (never free text), Plex Mono tnum numerics, wavy-Alerta low-confidence
  mark, Save→Undo 4s, NO flash; type = the ramp as named styles only (IBM Plex Mono is the data
  face); button = two-phase squish (.95/55ms in, ~350ms spring release), heights {32,40,48}, radius
  {6,8,12,999}; highlight = entity / provenance / low-confidence + the §18 gold locate pulse;
  springs = springEnterAlpha (spring drives ALPHA, ty=(1−a)×16px).
- Extractor now also emits the springs, PhysicalEase, and the full SanchoType ramp (133 tokens).
- Verified: 17 rows, 0 errors, phase assertions + export collection green.
