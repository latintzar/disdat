# Dis Dat — WebGL reproducibility: the honest ceiling + capture spec

Adversarial design pass (7 agents, 4 skeptic lenses), 2026-06-17. The question: can a no-GPU/no-browser/possibly-IP-blocked agent REPRODUCE a live WebGL animation from what the extension captures in-page? This is the verified foundation for Stage 2 (WebGL deep-capture).

I have everything I need. The teardown, the capability map, and the four adversarial refutations all triangulate on the same answer. Let me synthesize the honest verdict and build spec — no hype.

---

# THE HONEST VERDICT: what comes back to life from a WebGL capture, and what doesn't

Peter — you've tried this and it broke. Here is *why* it broke and *exactly* where the ceiling is. The short version: **you can faithfully clone one specific class of effect (fullscreen fragment-shader fields — orbs, gradients, aurora, noise-flow) and that class happens to be ~70% of what people actually point at and say "I like this." Everything stateful, 3D, worker-rendered, or WebGPU is partial-to-dead.** The capture you've been attempting fails on stateful effects not because of a missing input wire, but because the *motion lives in GPU feedback textures that no getter can read*.

---

## 1. FIDELITY CEILING

"% of 'I like this'" = my estimate of how often each class is the thing a person reacts to on a modern fancy site. Rough, defensible, not science.

| Effect class | Verdict | % of "I like this" | Why — blunt |
|---|---|---|---|
| **Fullscreen fragment-shader fields** — orbs, gradient meshes, aurora, plasma, noise-flow, Shadertoy-style, animated-mesh-gradient hero backgrounds | **FAITHFUL** | **~45%** | One quad, one frag shader, driven by `uTime` (+ maybe pointer). GLSL comes back verbatim via `getShaderSource`; the palette is a texture you re-host; the driver is a linear clock you recover by regression. **There is no geometry to lose.** This is the whole game and you win it cleanly. |
| **Pointer/scroll-reactive fragment shaders** — the same, but `uMouse`/`uScroll` warps it | **FAITHFUL** | **~12%** | Same as above + you correlate the uniform against pointer/scroll events you log alongside. The *law* (`lerp` toward mouse) is recoverable. Reproduces well. |
| **Scroll-scrubbed video / sticky sequences** (the Luce pattern — Ferrari, Apple-product pages) | **FAITHFUL (trivially)** | **~10%** | Zero shaders. It's `<video>` + scroll. You don't even need WebGL capture — re-host the video blobs and the scroll-scrub logic is a 20-line IntersectionObserver. People react to this constantly and it's the *easiest* thing on the list. |
| **Stateful single-canvas sims** — ping-pong fluid (the Dis Dat / ElevenLabs orb), reaction-diffusion, particle-trail feedback, GPGPU smoke | **PARTIAL → LOST without deep capture** | **~15%** | **This is the one that's burned you.** The look is a *feedback loop*: each frame's velocity/dye field is the integral of every frame before it, held in float render-targets you cannot read back cleanly. An 8-frame uniform snapshot sees the *final composite shader only* — not the 6 sibling sim programs (advect/curl/vorticity/divergence/pressure/gradient-subtract) that ran into offscreen FBOs and got swapped away. **Default capture gives you a layered-noise impostor, not the Navier-Stokes motion.** Recoverable ONLY with the deep bundle (full multi-program GLSL + FBO graph) — and even then you get a *behaviourally-equivalent re-simulation from a cold start*, not the exact momentum state. For a chaotic fluid that means it diverges frame-for-frame, but *looks* right. That's usually fine. |
| **Real 3D scenes** — camera-flythrough product models (glTF/GLB), instanced particle fields, three.js/Babylon worlds | **PARTIAL (WebGL2) / LOST (WebGL1)** | **~12%** | WebGL1 has *no buffer readback at all* — your capture literally flags `geometry-not-readable` and substitutes a wrong-topology guess. WebGL2 `getBufferSubData` gets raw bytes but you must reconstruct stride/offset/divisor/VAO to de-interleave — and the **authored camera path and per-instance placement is JS render-loop logic that no GL hook can capture.** You get the meshes and materials; you do *not* get the choreography. Reproduces as "the right objects, wrong motion." |
| **Worker / OffscreenCanvas-rendered** (increasingly common: three.js offscreen, Figma-class apps) | **LOST** | **~4%** | The GL context lives in a worker realm. Your MAIN-world page hooks never run there; your rAF hook never fires. Total blackout unless you also rewrite the Worker constructor — brittle, out of scope. |
| **WebGPU** (`navigator.gpu`, WGSL shaders) — where the bleeding-edge sites are migrating | **LOST** | **~2% now, rising** | Completely different API. None of `gl.*` interception applies. Your WebGL trap sees *nothing*. Flag it and move on. |
| **Compressed / depth textures** | **LOST (as readback)** | n/a (component) | `COMPRESSED_*` and depth aren't color-renderable — no FBO readback. Only fix is snapshotting compressed source bytes at upload + offline decode. |

**The one-line ceiling:** *Anything whose motion is a pure function of `(uTime, pointer, scroll)` reproduces faithfully. Anything whose motion is a function of its own previous frame (feedback/physics) or of authored JS per-frame logic (camera paths, instance transforms) does not — you reconstruct an equivalent, never the original.* The Dis Dat orb is the boundary case: faithful *still* + faithful *grade* + faithful *driver model*, but the fluid is reconstructable only by lifting the sibling programs, not by sampling.

---

## 2. CAPTURE-FOR-REPRODUCTION SPEC (the light+deep bundle)

Inject MAIN-world, `run_at: document_start` (non-negotiable — patch `getContext` before page JS touches WebGL, or you miss everything). Then capture in two tiers. **The skeptics' verdict: ship the light tier always; trigger deep only when the light tier detects feedback/multi-pass.**

### LIGHT TIER (always on — cheap, no GPU stalls, covers the faithful ~70%)

1. **GLSL, per linked program, verbatim.** Hook `shaderSource`+`attachShader`+`linkProgram`; keep `WeakMap<program,{vs,fs}>`. Belt-and-suspenders: also walk every program with `getAttachedShaders`→`getShaderSource` (catches programs compiled before you hooked). *This is the single most reliable thing you get.*
2. **Active uniforms — names, types, values — sampled across 50–100 frames, not 8.** *(Skeptic correction: 8 frames cannot deconfound a sine-of-an-integral from a linear ramp. Dense sampling is still light.)* Hook `useProgram` to know the current program; snapshot via `getActiveUniform`→`getUniform` right before each draw. Then fit each uniform against a tiny driver library: `constant | linear-ramp(rate) | sinusoid | pointer-correlated | scroll-correlated | audio-correlated | stateful(unfittable)`.
3. **Input streams logged alongside, timestamped.** `pointermove`, `scroll`, and — if an `AnalyserNode` exists — the 3 audio bands. *(This is what lets you label a uniform "tracks mouse" vs "tracks time" instead of guessing.)* Light, decisive.
4. **GL state per draw:** blend func, depthTest, cullFace, viewport, draw count, primitive type.
5. **Texture inventory + the palette.** Intercept `createTexture`/`texImage2D`/`activeTexture`; record dimensions/format and **which texture unit each sampler uniform points at**. Re-host original texture URLs where the source was a URL (the `orb-gradient.png` case — re-host it, don't readback). FBO color textures: readback only in deep tier.
6. **2–3 rendered frames** via forced `preserveDrawingBuffer:true` (merge into the `getContext` attrs) → `readPixels` (more robust than `toDataURL`, which *throws* on CORS taint; `readPixels` just returns black, which is at least diagnosable) → re-host as PNG.
7. **Viewport size + DPR + element `getBoundingClientRect()`** + the `captureVisibleTab` screenshot of the real composited page.

### DEEP TIER (triggered when light detects ≥2 FBOs or ping-pong — covers the stateful/3D ~25%)

The light tier's job is to *detect* that it's out of its depth and escalate. Add:

8. **Upload-time geometry + texture interception.** *(Skeptic's highest-value light add, folded here.)* Hook `bufferData`/`bufferSubData`/`texImage2D`/`compressedTexImage2D` and keep your own copy of every uploaded buffer/texture. **This single move closes three gaps at once:** WebGL1's no-readback gap (you record the mesh as it goes in), the compressed-texture gap (snapshot compressed bytes, decode offline), and byte-de-interleaving (you have the source data, not a guessed reconstruction).
9. **Per-attribute layout snapshot at each draw:** `getVertexAttrib(loc, …)` for size/type/stride/offset/normalized/**divisor** + buffer binding + the bound VAO. Without this you cannot de-interleave instanced/interleaved buffers.
10. **The FBO render-pass graph.** Hook `bindFramebuffer`/`framebufferTexture2D`/`drawBuffers`/`blitFramebuffer` + draws. Record the per-frame pass sequence: which FBO bound, which texture sampled as input on the next pass → the **producer→consumer ping-pong graph**, the swap topology, and the **Jacobi iteration count** (visible as the repeat-count of the pressure pass).
11. **ALL linked programs' GLSL + per-pass uniforms** — not just the composite draw's. *(This is the fix for the orb. The advect/curl/vorticity/divergence/pressure/gradient-subtract programs each need their source and their scalar config: `dt`, `dissipation`, `curl`, `radius`, `iterations`.)*
12. **Intermediate render-target formats** (RGBA16F/RG16F/R16F, HALF_FLOAT, NEAREST vs LINEAR) — the sim's momentum/diffusion behaviour depends on these. Get them from the `texImage2D`/`renderbufferStorage` intercept, not from a frame readback (which can't recover internalFormat).

**Honest cost note:** the deep tier is *not* light. Per-pass float-target readback forces GPU sync stalls and is format-gated (RG16F may not `readPixels` cleanly). It needs a live instrumented browser, not a passive end-of-frame poll. It buys you "structurally-correct solver skeleton," not the live momentum state.

### What NO tier captures (state this to whoever asks, every time)
- **The JS render-loop logic** — the authored camera path, the per-frame instance transforms, the fixed-timestep accumulator, the splat-injection control law. GL hooks see the *calls the loop emits*, never the loop. Best you get: a replayable call-trace + `new Error().stack` attribution + the minified bundle via ordinary script exfiltration.
- **Worker/OffscreenCanvas and WebGPU** — wrong realm / wrong API.
- **Live feedback state** — for a chaotic sim you regenerate equivalent motion from cold start; it diverges frame-for-frame (but looks right).

---

## 3. THE HANDOFF — how a blind, GPU-less, IP-blocked agent rebuilds it

The bundle is **all text + re-hosted URLs**, designed so the receiving agent never needs a GPU, a browser, or network access to the origin. It is a self-contained reproduction kit:

```
{
  "programs": [ { "name":"composite", "vs":"<glsl>", "fs":"<glsl>" }, ... ],
  "uniforms": [ { "name":"uTime","type":"float","driver":"linear-ramp","rate":0.6 },
                { "name":"uMouse","type":"vec2","driver":"pointer-lerp","k":0.25 }, ... ],
  "passGraph": [ "velocity→advect→velocity'", "...Jacobi×30...", "→composite→screen" ],
  "textures":  [ { "unit":0,"role":"uTexture","url":"https://rehost/orb-gradient.png","w":512,"h":512 } ],
  "glState":   { "blend":"...","depthTest":false,"viewport":[w,h] },
  "frames":    [ "https://rehost/frame0.png", ... ],
  "screenshot":"https://rehost/viewport.png",
  "viewport":  { "w":1280,"h":800,"dpr":2,"rect":{...} }
}
```

How that beats each of your four problems, explicitly:

| Your problem | How the bundle kills it |
|---|---|
| **JS-render** (agent can't run the page's render loop / SPA) | We don't ship the render loop — we ship its **distilled product**: the GLSL (the actual look), the uniform-driver model (the actual motion law), and the pass graph (the actual structure). The agent rebuilds an *equivalent* loop from these primitives. It never needs to execute the origin's JS, because we already watched the JS run and recorded what it *did to the GPU*. |
| **GPU-less agent** | Everything in the bundle is **text or a flat PNG**. GLSL is a string. Uniform drivers are numbers + a label. Frames/textures/screenshot are pre-rendered raster the agent *reads visually*, no GPU. The agent writes new GLSL+JS; the GPU work happens later, in Peter's browser, when *he* runs the reproduction — not in the agent. |
| **Datacenter 403 / IP-blocked agent** | The agent never fetches the origin. The capture happened **in a real browser session** (yours, residential, logged-in if needed). All assets are **re-hosted on a domain the agent can reach** (your own bucket). The origin's Cloudflare/anti-bot never sees the agent. This is the whole reason for re-hosting vs. passing origin URLs — it sidesteps the block entirely. |
| **Exact-viewport** (effect looks different at different sizes; agent renders blind) | We ship **viewport w/h + DPR + element rect + the captureVisibleTab screenshot of the real composited page**. The agent has the ground-truth target image at the exact resolution the effect was authored for, plus the 2–3 `readPixels` frames showing the effect in isolation. It tunes its reproduction *against pixels*, not against imagination. |

The net: a blind GPU-less blocked agent receives a *visual target* (screenshot + frames) + the *recipe* (GLSL + drivers + graph + textures) + the *exact stage dimensions* — and emits new source that, run in Peter's browser, matches. For the faithful ~70% it matches closely. For the stateful ~15% it matches *in look* (re-simulated). For 3D/worker/WebGPU it falls back to "right assets, approximate or no motion" — and the bundle says so honestly via the `geometry-not-readable` / `worker-detected` / `webgpu-detected` flags rather than silently shipping garbage.

---

## 4. THE ONE HIGHEST-LEVERAGE THING

**Verbatim GLSL of every linked program (`getShaderSource` over `getAttachedShaders`, not just the bound one), paired with a dense 50–100-frame uniform-driver trace + the input streams.**

Why this and nothing else, if you could keep only one:

- The shader source **IS the look** — it's the single file that defines the visual, it comes back *verbatim* with the highest reliability on the entire list (plain JS string, no taint, no async, no format gate), and it's free (no GPU stall).
- Capturing **all** programs (not just the composite) is the exact fix for the failure that's burned you: it's the difference between "I got the orb's grade shader and faked the fluid with noise" (the impostor) and "I got the advect/curl/pressure/gradient-subtract programs too" (the real solver skeleton).
- The dense uniform trace + logged input streams turns the static shader into a *moving* one with the *right driver* — and at 50–100 frames it can actually tell a linear clock from a sine-of-an-integral, which 8 frames provably cannot.

Everything else in the bundle (textures, frames, FBO formats, geometry) raises fidelity at the margins or rescues a specific class. **The all-programs GLSL + dense driver trace is the thing that, for the least weight, moves you from "noise-warped lookalike" to "the actual effect" across the entire faithful-and-partial range.** Geometry upload-interception is the close second — it's the one cheap add that rescues WebGL1 meshes and compressed textures — but if it's one thing, it's the shaders.

---

**Bottom line, no hype:** Build the light tier and you reliably clone orbs, gradient fields, aurora, noise-flow, pointer/scroll-reactive shaders, and scroll-video — call it ~70% of what people react to, and the Dis Dat orb's *surface* is in there. Add the deep tier (all-program GLSL + FBO graph + upload interception) and you rescue the fluid sim and static 3D meshes — but as *re-simulations* and *un-choreographed assets*, not pixel-exact. Worker-rendered, WebGPU, and authored-camera 3D motion stay out of reach, and the bundle's job is to **flag** those honestly rather than ship a confident fake. The thing that has broken your past attempts is precisely the stateful-feedback class — and it broke for a real, unfixable-by-sampling reason: the motion is in GPU textures the API won't read back. The only cure is capturing the whole multi-program pipeline, not sampling the final frame.
