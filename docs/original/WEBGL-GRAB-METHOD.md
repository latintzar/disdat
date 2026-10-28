# Grabbing a live WebGL effect's *actual compiled code* and self-hosting it

This is the method DD Pointer generalizes. The goal is **not** to reimplement or
approximate an effect, and **never** to screenshot it. It's to take the real
shipped code + assets off a live page and run *that* on your own page. Proven on
the ElevenLabs voice orb (now live, self-hosted, at disdat.dev/research).

The core insight: a WebGL effect on a page is just **(1) a JS module + (2) GPU
assets (textures/models/shaders) + (3) a per-frame driver**. All three are
public — they were shipped to the browser. So you can take all three.

---

## Part A — What we did for the ElevenLabs orb (the worked example)

1. **Got the real page.** Loaded `elevenlabs.io/agents/ai-outbound-calling` in a
   headless Chrome (SwiftShader WebGL2). Their cookie banner gates the canvas, so
   we clicked *Reject All* then scrolled to trigger the lazy mount.

2. **Found the source module, not the pixels.** Listed every `.js` the page
   loaded (`performance.getEntriesByType('resource')` + the network log), then
   `fetch()`-ed each chunk and `grep`-ed for tokens that only the effect would
   contain — here the shader uniform names `uFluidSimTexture`, `uFbmAmplitude`,
   `uCumulativeAudio`. Exactly **one** 46 KB chunk matched: it held their
   `OrbShader`, an `Orb` engine class, and a `FluidSim` class.

3. **Identified the runtime library.** Read the chunk's constructor calls:
   `new u.A({dpr,…})` (renderer), `new c.B(gl,{vertex,fragment,uniforms})`
   (program), `new g.V(gl,{position,uv})` (geometry with the tell-tale
   `[-1,-1, 3,-1, -1,3]` fullscreen triangle), `new f.O(...)` (render target),
   `program.uniforms.x.value`, `renderer.render({scene,target})`. That signature
   is **OGL** (a public MIT WebGL lib). So the chunk's dependencies *are* OGL,
   just compiled into their bundle.

4. **Grabbed the real assets.** Their base gradient (`uTexture`) is a loaded
   image, not generated — so we read its real pixels straight off the GPU
   (`framebufferTexture2D` → `readPixels`) into a PNG. Pixel-for-pixel what
   shipped.

5. **Re-hosted the actual bytes.** Vendored their chunk verbatim (one edit:
   exposed the internal `Orb` class in the module's exports). Wrote a ~40-line
   loader that runs their webpack module factory with a `require` shim mapping
   each dependency module-id/key to the matching **npm `ogl`** export, plus a
   6-function gl-matrix-vec4 shim for their audio-math module. React-only deps
   (jsx runtime, logger, error boundary) are Proxy-stubbed — the engine never
   touches them. `new Orb(div,{animated:true}).loadTexture(png).play()`.

6. **Drove the inputs.** It self-animates (their fluid sim ticks on an internal
   timer, independent of audio). The mic is wired into their own
   `setAudioData()`, the same entry point their TTS uses.

Result: their real compiled engine, running on our page, with their real texture.
Not a clone of the look — the actual thing.

Files: `landing/public/orb-engine.js` (their chunk, verbatim+1 line),
`landing/src/orbEngine.ts` (loader/shim), `landing/src/OrbCanvas.tsx` (mount).
Provenance + capture scripts in `product/scratch/orb-*`.

---

## Part B — The general method (any WebGL effect, any page)

### Phase 0 — Get the real page
- A real effect needs the page to actually run. Datacenter IPs + headless
  fingerprints get bot-walled (Akamai/Cloudflare → 403). Use a **real browser on
  a residential IP** (a logged-in Chrome via an extension/CDP), or route a
  headless browser through a residential exit node. Dismiss cookie/consent
  banners (privacy-preserving option) and scroll, since effects are often lazy
  -mounted or gated behind consent.

### Phase 1 — Locate the effect
- Hook `HTMLCanvasElement.prototype.getContext` (install **before** page scripts
  run if you control navigation) to catch every `webgl`/`webgl2` context and the
  canvas it belongs to. This also lets you wrap the context's methods.

### Phase 2 — Find the source module (not the pixels)
- Enumerate every script the page loaded.
- `fetch()` each and search for tokens unique to the effect: shader keywords
  (`gl_Position`, `uniform sampler2D`, distinctive uniform names), or library
  identifiers. The chunk that contains the shader **strings** is the effect's
  module. (Effects almost always inline their GLSL as strings.)

### Phase 3 — Identify the runtime library (or decide there isn't one)
- Match the chunk's API shape against known fingerprints:
  - **three.js**: `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `BufferGeometry`,
    `ShaderMaterial`, `.uniforms`, GLB/GLTF/Draco/KTX2 loaders.
  - **OGL**: `Renderer`, `Program`, `Mesh`, `Geometry`, `RenderTarget`, `Triangle`,
    `program.uniforms.x.value`, `renderer.render({scene})`.
  - **Babylon**: `Engine`, `Scene`, `ShaderMaterial`, `.setFloat/.setVector`.
  - **regl / raw GL**: direct `gl.*` calls, no class wrapper.
- The library matters only for how you satisfy dependencies in Phase 5.

### Phase 4 — Grab the assets
- **Textures**: hook `texImage2D` to capture the source (`<img>.src`, an
  `ImageBitmap`, or a typed array). For GPU-generated/edited textures, read them
  back: attach to a framebuffer → `readPixels` → PNG (8-bit) or float buffer.
- **Models / env maps / Draco / KTX2 / wasm**: capture their URLs from the
  network log and download them. (These are the heavy, sometimes-gated parts.)
- **Shaders**: `getAttachedShaders(program)` → `getShaderSource()` reads every
  shader's source straight back off the live GL context.

### Phase 5 — Re-host the actual bytes (two routes)
- **Route 1 — Vendor their chunks + a webpack runtime (most literal).** Load the
  effect's chunk **and its dependency chunks** (the lib, compiled by their
  bundler) plus a minimal webpack runtime; then inject an entry module that
  `require()`s the effect module and returns it. Zero library identification, zero
  porting — their exact compiled bytes for everything. Cost: you carry more files
  and they're tied to that build until you re-grab.
- **Route 2 — Vendor only the effect chunk + npm the library (what we did).** Run
  the effect chunk's factory with a `require` shim that maps its dependency
  module-ids to the matching **npm** library exports (+ tiny shims for trivial
  utils, stubs for unused deps like React/logging). Cleaner and maintainable; the
  only work is mapping the bundler's minified export keys (`v.e` → `Mesh`, …) to
  the lib's API, which you read off the chunk's usage.
- Either way: the **only** edit to their code is exposing the entry class/factory
  if it isn't already exported.

### Phase 6 — Drive the inputs
- Most effects expose an update entry (`uTime`, an audio/`setAudioData` hook, a
  pointer position). Advance time from `performance.now()`; wire pointer/mic as
  needed. Many self-animate on an internal timer (the orb does) so "idle" already
  looks right.

### When it's genuinely not grabbable
- A raw, asset-light canvas effect with **no recoverable source** (e.g. a
  one-off inlined shader with no module and no readable assets) — rare.
- Server-gated/DRM'd assets you can't download.
- Even then: you skip it. You never fall back to a screenshot.

---

## Part C — How to do this **without an AI model** (the deterministic tool)

Almost every step above is mechanical. Here is the same pipeline as a
deterministic program — no model in the loop:

1. **Render farm with residential egress.** Headless Chrome behind a residential
   proxy pool. Deterministic: navigate, auto-click consent by matching a
   maintained list of CMP button selectors/texts, auto-scroll.

2. **Instrument by injection (CDP `Page.addScriptToEvaluateOnNewDocument`).** A
   fixed instrumentation script wraps `getContext`, `shaderSource`,
   `attachShader`, `linkProgram`, `useProgram`, `bindFramebuffer`,
   `framebufferTexture2D`, `texImage2D`, `bindTexture`, `activeTexture`, the
   `draw*` calls, and `uniform*`. This is static code; no model needed. It yields:
   every program's GLSL, the per-frame draw order, FBO sizes, sampler→texture
   bindings, and texture upload sources.

3. **Module location = string search.** Collect all loaded scripts (CDP
   `Network`/`Debugger.scriptParsed`), and for each captured shader source,
   substring-search the scripts for a unique slice of that GLSL. The script that
   contains it is the effect module. Pure text matching.

4. **Library identification = fingerprint table.** Maintain a fingerprint DB:
   for each known lib (three, OGL, babylon, regl, pixi…) a set of structural
   signatures (characteristic method names, the fullscreen-triangle vertex array,
   the `program.uniforms.x.value` access shape, loader file extensions). Match the
   chunk's AST/usage against the table → a library id + version guess.
   **Or skip identification entirely** by taking Route 1 below.

5. **Dependency resolution — fully deterministic via the webpack graph.** This is
   the step that *looks* like it needs intelligence (mapping minified `v.e` →
   `Mesh`) but doesn't:
   - **Route 1 (no mapping at all):** webpack records, in the runtime/build
     manifest, which chunk file defines each module id. Parse the manifest,
     download the transitive closure of chunks for the effect module, load them
     into a stock webpack runtime, and `__webpack_require__(effectModuleId)`. The
     effect runs on *its own* compiled dependencies. No library identification, no
     key mapping — a graph walk. This is the most robust automated path.
   - **Route 2 (mapping, still deterministic):** to map minified export keys to a
     known lib, instantiate each dependency module in isolation and probe it:
     construct each exported member and check structural shape (constructor arity,
     instance property names, prototype methods) against the fingerprinted lib's
     classes. `the export that, when `new`-ed with a gl context, produces an object
     with `.uniforms` and `.attributeLocations`` ⇒ `Program`. This is a property
     -matching routine, not a judgment call.

6. **Asset extraction = recorded I/O.** Texture upload sources and model/env/wasm
   URLs come straight from the hooks + network log; GPU-resident textures are
   `readPixels`-dumped. Save with content-hash filenames. Deterministic.

7. **Emit a self-contained bundle.** A generator template:
   `index.js` (webpack-runtime + vendored chunks, Route 1; or effect chunk +
   shim, Route 2), the asset files, and a `mount(el, opts)` that constructs the
   entry and starts the loop. Wire `uTime`/pointer/audio to standard inputs.

8. **Verify deterministically.** Mount the output headless, confirm: a WebGL
   context is created, ≥1 program links, the framebuffer is non-empty
   (`readPixels` coverage > threshold), and pixels change across frames
   (motion > threshold) — exactly the checks used to verify the orb. No human/AI
   judgment; thresholds decide pass/fail.

**Net:** the one step people assume needs an AI — "understand the minified code
and wire it up" — is replaced by **the webpack module graph** (Route 1: load the
real dependency chunks, require by id) or **structural property-probing** (Route
2). Everything else is hooks, string search, network capture, and templated code
generation. A model is a convenience for one-offs and weird edge cases; it is not
required for the pipeline.

---

## Appendix — the verification thresholds we actually used
- `coverage` = fraction of the canvas with alpha > 8 after warmup (orb ≈ 1.0).
- `motionPerChannel` = mean |Δ| of a center-row pixel signature between two
  frames ~1.3 s apart; > 1.0 means it's truly animating (orb ≈ 130–180).
- `console/pageerror` count must be 0.
