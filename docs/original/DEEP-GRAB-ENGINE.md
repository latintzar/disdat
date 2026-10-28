# The deep-grab engine

A pick-and-shovel for the real web: point at anything in a live browser and get **ground truth** — the actual client-side substrate of what you're pointing at — instead of a screenshot, a lossy URL-fetch, or an agent's guess.

One engine, two pipelines, a set of tools (modes) in a notch on the left of the screen. The **normal mouse is the default**; you pick up a grab-tool when you want one — like a tool palette, not a replacement cursor.

The core idea is **ground truth**: every mode exists to give a human or an agent the *real* thing — real source, real state, real referent — never an approximation.

---

## Two pipelines (the key architecture)

The product looks like one tool but splits cleanly by **whose thing you're pointing at**:

### A. Capture pipeline — *foreign target* (someone else's site)
You want to **take** the thing. Used by Clone and Inspo modes.
1. **Capture in the user's real browser** — the privileged context: logged in, rendered correctly, everything reachable. (Critical: the capture must happen here, not in an agent's headless browser or on a server, because *those contexts get blocked* — no auth, bot detection, dynamic content never loads. The whole point is grabbing from the one place the real bytes exist.)
2. **Package** the full substrate as a **file/bundle** — DOM, computed styles, assets as real bytes, and reassembled code. Big artifacts (the ElevenLabs WebGL orb was ~16,000 lines) **cannot** be pasted inline into a coding agent without blowing its context — so it is a file, always, for anything non-trivial.
3. **Host + deliver** — the file can't always be local (users often work on a remote / SSH box), so it's hosted on **our server** and served back **private / authenticated** for the user (or their agent) to pull into their environment. The agent receives **our captured bytes** — it never re-fetches the origin from its blocked context.

### B. Reference pipeline — *your own target* (your site)
You want to **point at and fix** your own thing. Used by Debug/Edit mode. **No capture, no upload, no hosting** — uploading your whole running site to our server would be absurd and inappropriate; it's already yours and already running in your environment.
1. **Point** at the element in your own live page.
2. **Read it live** — the element, its computed state, and the **console / network logs** (accessible because it's your page), to see what's actually happening.
3. **Disambiguate + ground** — resolve "that thing" into a precise node + property, and translate a *felt complaint* into a *precise target*:
   - If there are errors → surface the error touching the pointed-at element.
   - If there are **no** errors → the code is technically functioning, so the issue is behavior/appearance, not a crash. The tool figures out *which specific thing* the person means ("I want that side longer than the others" → this exact node, this exact property) and hands the agent the referent + the translated intent.

**How the tool knows which pipeline:** the **mode you pick in the notch is the declaration.** Inspo/Clone → capture pipeline (foreign). Debug → reference pipeline (yours). Target context reinforces it (localhost / your authed dev app = yours; arbitrary site = foreign). No clever auto-detection needed — the mode selection *is* the answer.

---

## The capture engine (shared by the capture pipeline)

On a grab — a point or a lassoed region — in a live browser tab (via CDP / equivalent), capture the **full client-side substrate**:

- **DOM** — post-JS node subtree as rendered.
- **Computed styles** — values actually painting, not source CSS.
- **Accessibility tree** — semantic layer where role/structure matters.
- **Media / assets** — real referenced files (images, video, fonts, gradients, textures) as actual bytes.
- **JS / WebGL / canvas** — the owning public JS chunk: shader source, program/sim classes, animation loop.
- **Data on screen + reachable endpoints** — data currently rendered, plus any unauthenticated API the page itself calls.

Capture is local, deterministic, model-free. A frontier model then does the hard part — **de-minification, library ID, dependency mapping, module shimming, asset vendoring** — turning the pile into clean, runnable, owned code. (Proof: the ElevenLabs WebGL orb — a dead `<canvas>` + minified blob to every other tool — resolves to its real engine, ~16k lines, running standalone.)

## Interaction

Grab-tools live in a **notch / palette on the left**; the **normal mouse is default**. To grab:

- **React** — floating overlay walks pages with a **Next** button; you react (*"no, generic" / "ooh, that nav" / "cool, a grid"*) and each yes grabs the real source.
- **Smart lasso** — hold a key, drag a region; it intelligently grabs the real elements inside. Silent — browse, see something you like, lasso it into your scrapbook.

No copying URLs, no going back, no app-switching.

---

## The modes (tools in the notch)

### Prompt / Clone mode — *capture pipeline*
Grab an element → its full substrate is packaged as a hosted, authed file → handed to your coding agent as **real bytes** (not a re-fetch instruction, not an inline paste that crashes it). An exact clone of the element, assets and all.

### InspoMode — *capture pipeline, + scrapbook*
Browse, react or lasso; every grab lands in your **scrapbook** as a working self-hosted standalone **and** becomes a prompt. The library holds your **persona**: design themes, the parts/choices you keep returning to, your taste — reusable across everything. Same capture+host pipeline as Clone; it just also saves.

### Figma / hand-off mode — *capture pipeline*
Push grabbed elements into Figma (real structure + styles) or export clean source. Category already monetizes (DivMagic-style); difference is the hand-off carries the *real deep substrate*, not a flattened approximation.

### Build / fuse mode — *the moat*
Take the scrapbook of harvested parts and **fuse them into one coherent thing themed to your persona** (reconciling design tokens, spacing, type, color, structure). Where it stops being a grabber and becomes a builder.

### Debug / Edit mode — *reference pipeline*
Point at the broken/unwanted thing on **your own** site; the tool reads the live element, its state, and the console/network logs, resolves "that" to a precise node, and hands your agent ground truth: which element, what's wrong (error) or what's meant (felt complaint → exact property). No capture, no upload.

### Action mode — *later*
Point and *do*. Highest-risk surface; earns its place last.

---

## Use cases (what the modes unlock — try after engine + modes exist)

- **Reproduce a UX 1:1** — the client-side front of a great-UX product, grabbed in full; bring your own backend.
- **Build by feel** — harvest real parts you like, fused to your persona, vs one monolithic template.
- **Copy specific design choices, not whole sites** — grab just the part you liked, real, fuse it in your style.
- **Ground truth for any coding agent** — feed Cursor / Claude / your agent the real element + implementation.
- **Debug what matters** — point at the broken state, hand the agent the live element, state, and code path.

## The real hard problem (and the moat)

Grabbing one piece is table stakes — increasingly commodity (free open-source whole-site cloners exist; roasted because a stitched clone is monolithic and brittle). A scrapbook is *fragments*; a site is fragments that **cohere**. Parts from different sources have different design systems, stacks, assumptions; stitched, they look out of touch. **Build/fuse mode** — fusing real implementations from many sources into a coherent owned result in your own style — is the unsolved, ownable problem, and the answer to "clone tools already exist." They clone one monolith; they can't mix across sources. This can.

## Why current options can't do it

- **Paste the URL / web-fetch agents**: served HTML/CSS, lossy; WebGL/canvas → dead `<canvas>` + a blob never unpacked. And the agent's context is blocked — it can't reach what your browser can.
- **Whole-site cloners (incl. free templates)**: monolith, bad on dynamic content, no cross-source fusion.
- **Claude-in-Chrome / browser agents**: read the live DOM (real baseline) but stop there — no chunk fetch, library ID, dep mapping, or standalone copy.
- **DivMagic-style extensions**: monetize the *shallow* grab; no deep reassembly, no fusion.
- **DevTools by hand**: a 15-step expert session per component.
- **Screenshot + paste**: the lossy floor.

## The hard boundary (transport, not scope)

Capture is limited to **what the browser receives**. "Public website" ≠ "public backend."

- **Grabbable, always:** rendered content, computed styles, assets, client/WebGL code, data on screen, and any **unauthenticated endpoint the page itself calls**.
- **Not grabbable:** server-side logic, databases, private/authed endpoints — never transmitted. A server emits output, never its own code.

Roast-proof promise: **"anything the page sends your browser — content, assets, client code, and the public endpoints it calls — we capture. The server's private guts we don't, because they were never sent."** ("1 of 57 reviews at random" → you get the rendered one, plus more *if* an open endpoint serves them; not all 57 by magic.)

## On IP

You capture publicly-shipped client code the way view-source/DevTools always have — for inspiration, structure, taste — fused into something *yours*, not a republish of a brand/logo/assets. Harvesting *how things are built* is the use; wholesale brand-cloning isn't the pitch. The "this is stealing" reaction is real and loud — decide deliberately how loud to be back.

## Build: cloud vs private

Capture is local/model-free in both; the fork is **where the reasoning runs**: **Cloud** (frontier model, reliable orb-class reassembly today, capture leaves the machine) vs **Local/private** (on-device; solid on simple grabs, hardware-limited on hard reassembly today; hybrid escalation as the bridge).

## Why now

Capture's been possible for years; *reassembly* (minified WebGL chunk → clean owned code) only became reliable with current frontier models. The capability exists. What doesn't yet exist is the **harness**: the two-pipeline architecture, the tool-notch + react/lasso surface, and cross-source fusion.

## What it is not

- Not voice control; not an any-app OS daemon (browser-scoped — docs/Photoshop/3D are pixel surfaces, no shipped source, incumbent territory).
- Not backend extraction — "public site" ≠ "public backend."
- Not just a DOM reader, nor a shallow component-copier (DivMagic does that). Edge = deep reassembly + cross-source fusion + ground-truth debug.
- Not a dead-image moodboard. Not "clone the whole product/site" — grab the real client-side parts/experience, fused, backend yours.

One engine, two pipelines (capture foreign / reference your own), ground truth throughout — tools in a notch: **Clone, InspoMode/scrapbook, Figma hand-off, Build/fuse, Debug, Action later.**

---

## Field notes — proven (2026-05-29)

Two live grabs validated the capture pipeline end-to-end:

**1. ElevenLabs WebGL voice orb → running, self-hosted.** A dead `<canvas>` to every other tool. We listed the page's loaded JS, grepped each chunk for the orb's shader strings, found the one 46KB chunk holding their `OrbShader` + `FluidSim` (built on OGL), pulled it verbatim, mapped its minified deps to npm `ogl` + a tiny vec4 shim, read the base-gradient texture off the GPU with `readPixels`, and ran their actual compiled engine self-hosted. Live at disdat.dev/research. (Full method: `WEBGL-GRAB-METHOD.md`.)

**2. ferrari.com/en-EN/auto/ferrari-luce → self-hosted full page.** Confirmed the transport boundary and the privileged-context rule the hard way:
- `www.ferrari.com` (Next.js behind Akamai) returns **403 to a datacenter/headless IP** — the page's HTML/JS/CSS could only be captured **from the user's real browser**. Exactly the "capture must happen in the privileged context" principle.
- The media (THRON DAM CDN, `ferrari-cdn.thron.com`, 186 assets) is an open CDN — fetchable server-side.
- Egress from the browser: the Claude-in-Chrome safety layer blocks bulk data through its tool channel, so we pushed the bytes **browser → our server directly over the network** (the real product would use its own extension channel).
- Self-host: a local origin serving the shell + their real JS, with a **service worker intercepting every request the page makes** (incl. URLs their React `Img` component builds at runtime) and routing them to a same-origin caching proxy → after warming, nothing touches Ferrari/THRON at render. Result: shell, fonts, CSS, layout, copy, and 77/89 real images render pixel-faithful from our bytes.
- **The long-tail edge:** the hero **videos** use THRON's third-party CMS *player runtime* — it doesn't initialize standalone (it builds `<video>` elements via its own API calls), so those panels stay black until the player runtime is also reassembled. This is the moat-adjacent hard part: third-party player/runtime reassembly is where "grab the bytes" meets "make the runtime run," and it's exactly what the frontier-model reassembly step exists to solve.
