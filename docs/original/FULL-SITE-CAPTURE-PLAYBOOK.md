# Full-site capture playbook

How to make a **byte-exact, fully self-hosted copy** of a live modern website —
the real compiled code, the real media, the real fonts — running offline from your
own origin with the page's own code untouched. Written from doing it for real on
`ferrari.com/en-EN/auto/ferrari-luce` (a Next.js SPA behind Akamai, with a THRON
streaming video player) and the ElevenLabs WebGL orb before it.

This document has two halves:

- **Part A — the procedure that works.** Follow it top to bottom.
- **Part B — the graveyard.** Every approach we tried that does *not* work, and
  *why*. Read it so you never burn a day re-discovering a dead end. Each entry is
  empirical — observed on real sites, not theorized.

The single sentence that contains the whole thing:
> **A webpage is a session of byte-streams, not a folder of files. Capture every
> byte the browser receives at the moment it receives it; close the reference+data
> graph so everything it *could* request is present; then let its untouched code
> replay against that store.**

---

# Part A — The procedure that works

## A0. Mental model (read first)
Three non-negotiables, each the inverse of a dead end in Part B:
1. **Read bytes as received** at the network layer — never re-`fetch()` by URL.
2. **Code is sacred** — never mutate, rewrite, or force their JS/CSS/DOM.
3. **Atemporal completeness** — close the graph; never reproduce *when/how* the
   page asks (scroll/hover/click/timers).

And the deploy reality: **the replay shim, the manifest, and the domain alias are
all cached artifacts with their own staleness** — version and verify each.

## A1. Capture in a real, logged-in browser (the only privileged context)
Modern sites (Akamai/Cloudflare) hand a flat **403** to datacenters and headless
browsers. The real HTML/JS/CSS only exists in a **real, logged-in, foreground
browser**. So we drive the user's actual Chrome over the Chrome DevTools Protocol.

Setup we used (agent on a Linux box, browser on Peter's Mac, over Tailscale):
- Mac Chrome launched with `--remote-debugging-port=9222`.
- SSH tunnel so the agent reaches CDP: `localhost:9222 → mac:9222`.
- Drive with puppeteer-core `puppeteer.connect({ browserURL: 'http://localhost:9222' })`.

## A2. Arm the recorder BEFORE the load, record real response bytes
This is the heart of it. Attach to the tab and turn on the Network domain, then
**reload** so capture starts from the first byte.

```js
const client = await page.createCDPSession()
await client.send('Network.enable', {
  maxResourceBufferSize: 600*1024*1024,
  maxTotalBufferSize:    600*1024*1024,   // big — sites are heavy
})
const store = new Map(), meta = new Map()
client.on('Network.responseReceived', e =>
  meta.set(e.requestId, { url: e.response.url, mime: e.response.mimeType, status: e.response.status }))
client.on('Network.loadingFinished', async e => {
  const m = meta.get(e.requestId); if (!m) return; meta.delete(e.requestId)
  const r = await client.send('Network.getResponseBody', { requestId: e.requestId })  // REAL bytes
  const buf = r.base64Encoded ? Buffer.from(r.body,'base64') : Buffer.from(r.body,'utf8')
  if (!store.has(m.url)) store.set(m.url, { buf, mime:(m.mime||'').split(';')[0], status:m.status })
})

// reload with domcontentloaded + a fixed settle — NOT networkidle (see B10)
await page.reload({ waitUntil:'domcontentloaded', timeout:45000 }).catch(()=>{})
await new Promise(r => setTimeout(r, 12000))   // let lazy/video/player assets stream in
const ssr = await page.content()               // post-JS DOM snapshot (inline SVG lives here)
```

`getResponseBody` returns exactly what the browser received — **decoded, with the
auth/token it used**, including inline-after-decode and tokened/cached assets that
a re-`fetch` can never get (B2). It must be armed *before* the load because Chrome
discards bodies once used (B3).

Also keep the post-JS DOM (`page.content()`): the prancing-horse logo and the
"Ferrari LUCE" wordmark are **inline SVG** — vector paths in the HTML, *no URL to
fetch* (B2). They come from the DOM snapshot, not the network.

## A3. Close the reference + data graph (atemporal)
A single load only catches what fired that time. Walk outward until nothing new
appears, fetching missing members **through the same privileged page** (so tokens
and cookies apply), never from a server.

Extraction rules — the part that bit us hardest is **relative URLs** (B17):

```js
const extractUrls = (text, base) => {
  const out = new Set()
  const abs = u => { try { const x = new URL(u.replace(/\\\//g,'/'), base).href; return JUNK.test(x)?null:x } catch { return null } }
  // 1) absolute URLs
  for (const m of text.matchAll(/https?:\/\/[^\s"'\\)<>(]+/g)) { const a=abs(m[0].replace(/[.,;:)]+$/,'')); if(a)out.add(a) }
  // 2) known root-relative API/media path shapes (site-specific seasoning)
  for (const m of text.matchAll(/\/(?:delivery\/public|static\/thumbs|ios|auto\/_next)\/[\w/.\-]+/g)) { const a=abs('https://<cdn-host>'+m[0]); if(a)out.add(a) }
  // 3) **EVERY url(...) in CSS, resolved against THIS stylesheet's own base** ← the fonts
  for (const m of text.matchAll(/url\(\s*(['"]?)([^)'"]+?)\1\s*\)/gi)) {
    let raw = m[2].replace(/#iefix$/,''); if (/^data:/i.test(raw)) continue
    const a = abs(raw); if (a) out.add(a)   // /x → css origin, ../x → css dir, absolute as-is
  }
  return [...out]
}
```

Walk loop (parallel workers, hard per-fetch timeout — B24):

```js
const KEEP = /(\.target\.com|\.their-cdn\.com|unpkg\.com|fonts\.g(static|oogleapis)\.com)/i
const TRK  = /(googletagmanager|google-analytics|doubleclick|onetrust|tiktok|facebook|…)/i
const seen = new Set(store.keys()); let queue = []
const seeds = [ssr, ...[...store.values()].filter(r=>/json|javascript|css|html|svg|mpegurl/i.test(r.mime)).map(r=>r.buf.toString('utf8'))]
for (const t of seeds) for (const u of extractUrls(t, page.url())) if(!seen.has(u)) queue.push(u)
queue = [...new Set(queue)].filter(u => KEEP.test(u) && !TRK.test(u))

async function pageFetch(u){                 // fetch INSIDE the page → tokens/cookies apply
  return Promise.race([
    page.evaluate(async url => { try {
      const c = new AbortController(); const t = setTimeout(()=>c.abort(), 12000)
      const r = await fetch(url, {cache:'force-cache', signal:c.signal}); clearTimeout(t)
      if(!r.ok) return {ok:false,s:r.status}
      const a = new Uint8Array(await r.arrayBuffer()); let bin=''; const CH=8192
      for(let i=0;i<a.length;i+=CH) bin += String.fromCharCode.apply(null, a.subarray(i,i+CH))
      return {ok:true, b64: btoa(bin), mime:(r.headers.get('content-type')||'').split(';')[0]}
    } catch(e){ return {ok:false, err:String(e).slice(0,40)} } }, u),
    new Promise(res => setTimeout(()=>res({ok:false,err:'host-timeout'}), 15000))   // worker can't hang the loop
  ])
}
const CONC = 10
async function worker(){ while(queue.length){
  const u = queue.shift(); if(!u||seen.has(u)) continue; seen.add(u)
  const res = await pageFetch(u); if(!res.ok) continue
  const buf = Buffer.from(res.b64,'base64'); store.set(u,{buf,mime:res.mime||'',status:200})
  if (/json|javascript|css|mpegurl|svg/i.test(res.mime||'') || /\.m3u8|getContentDetail/.test(u))
    for (const nu of extractUrls(buf.toString('utf8'), u)) if(!seen.has(nu)&&KEEP.test(nu)&&!TRK.test(nu)) queue.push(nu)
}}
await Promise.all(Array.from({length:CONC}, worker))
```

Expand by type as you walk:
- **HLS (`.m3u8`)** → master playlist → variant playlists → every `.ts` segment, and
  **both desktop and mobile transcodes** (`_Desktop_`/`_D_` *and* `_Mobile_`/`_M_` — B16).
- **JSON / `__NEXT_DATA__`** → content IDs → API URLs (`getContentDetail?xcontentId=…`) →
  media URLs → recurse; pull **every image size / variant**.
- **CSS** → every `url(...)` incl. relative (fonts, bg images, masks, cursors — B17).

Result: everything the page *could* request is present before it asks. Triggers
(scroll/hover/click/timers) never matter (B7, B8).

> **Targeted re-capture.** If verification later shows a class still missing (we
> hit this with fonts and with the desktop HLS hero), don't re-run the whole walk
> — write a small script that resolves just that class against the captured CSS/JSON
> and pulls it through the page. (`capture-fonts.mjs` did exactly this: read each
> CSS in the bundle, resolve its `url(...)` font refs against that CSS's base,
> fetch through the Mac browser, patch the manifest. +30 fonts, 0 failures.)

## A4. Bundle: content-addressed store + manifest + shell + replay shim
```js
const manifest = {}
for (const [u, rec] of store) { if (TRK.test(u)) continue
  const h = 'f' + md5(u).slice(0,18)
  write(`/h/${h}`, rec.buf); manifest[u] = { f:`/h/${h}`, ct: rec.mime || 'application/octet-stream' }
}
write('/app.shell', ssr)                 // SSR HTML under a NON-.html name (B14)
write('/manifest.json', JSON.stringify(manifest))
write('/index.html', bootstrapThatRegistersSWThenReloads)
write('/vercel.json', headersForSwAndShell)   // correct MIME (B13)
write('/sw.js', replayShim)
```

## A5. The replay shim — exact rules (every rule = a scar from Part B)
```js
const SW_VERSION = 'v3';                                  // B19: bump on any change → forces reinstall
let M=null; let ready = fetch('/manifest.json',{cache:'no-store'}).then(r=>r.json()).then(j=>M=j)
function refresh(){ return fetch('/manifest.json',{cache:'no-store'}).then(r=>r.json()).then(j=>{M=j}).catch(()=>{}) }
const HOSTS = ['https://www.target.com','https://cdn.target.com','https://their-cdn.com', …]
self.addEventListener('install',  e => { self.skipWaiting(); e.waitUntil(ready) })
self.addEventListener('activate', e => e.waitUntil((async()=>{ await refresh(); await self.clients.claim() })()))
// candidate keys: exact, no-hash, no-query, and same-origin remapped onto each real HOST
function keys(u){ const x=new URL(u); const o=[u,u.split('#')[0],u.split('?')[0]]
  if(x.origin===location.origin) HOSTS.forEach(h=>{ o.push(h+x.pathname+x.search); o.push(h+x.pathname) }); return o }
self.addEventListener('fetch', e => { const u=e.request.url, x=new URL(u)
  // B11: serve our OWN infra files directly — never remap them, or the SW starves itself
  if (x.origin===location.origin && (x.pathname.startsWith('/h/')||x.pathname==='/manifest.json'||x.pathname==='/app.shell'||x.pathname==='/sw.js'||x.pathname==='/index.html')) return
  if (e.request.mode==='navigate') { e.respondWith((async()=>{ await ready; refresh(); return new Response(await (await fetch('/app.shell')).text(), {headers:{'content-type':'text/html'}}) })()); return }
  if (TRK.test(u)) { e.respondWith(new Response('', {status:204})); return }   // trackers → no-op
  e.respondWith((async()=>{ await ready
    for (const k of keys(u)) { const m = M && M[k]; if (m) return new Response(await (await fetch(m.f)).arrayBuffer(), {headers:{'content-type':m.ct,'access-control-allow-origin':'*'}}) }
    // fuzzy match param-varied API URLs (e.g. same xcontentId, different templateId)
    if (/getContentDetail/.test(u)) { const id=x.searchParams.get('xcontentId'); if(id) for(const mk in M) if(mk.includes('getContentDetail')&&mk.includes('xcontentId='+id)) return new Response(await (await fetch(M[mk].f)).arrayBuffer(), {headers:{'content-type':M[mk].ct,'access-control-allow-origin':'*'}}) }
    return new Response('', {status:404})            // B12: NO fallback to origin — a miss must FAIL so it's provable
  })()) })
```
Rules, distilled: **serve own infra directly · no origin fallback · correct
`sw.js` MIME · shell under a non-`.html` name · fuzzy-match param-varied APIs ·
version the worker · refresh the manifest on navigation.**

## A6. Deploy (Vercel specifics that cost real time)
- `vercel.json` must set `/sw.js` → `Content-Type: text/javascript` +
  `Service-Worker-Allowed: /` (B13), and `/app.shell` → `text/html` (B14).
- New projects get **SSO Deployment Protection** → 401 (B15). Disable:
  `PATCH /v9/projects/{pid}` `{ssoProtection:null}`.
- Deploy prebuilt static: `vercel deploy --prod --token <PETER_TOKEN>` from the
  bundle dir. **Use Peter's token** at `~/.local/share/com.vercel.cli/auth.json` —
  the root token is invalid (B23).
- **Re-alias the exact new deployment** every push (B20):
  `vercel alias set <deploy-url> sub.yourdomain.dev --scope <team>` — or attach the
  domain to the project so it tracks prod. Don't assume `--prod` moves a pinned
  subdomain.

## A7. Verify like you don't trust yourself (because you shouldn't)
We fooled ourselves repeatedly. Verification is part of the procedure, not an
afterthought.
- **Foreground only.** Hidden/background tabs throttle rAF, IntersectionObserver,
  and media (B9). Bring the tab to front (`page.bringToFront()`) or trust a human's
  eyes — never a backgrounded automated check for render/video.
- **Fonts: assert `loaded`, not "rendered."** A missing font *silently downgrades*
  to serif (B18). Check `document.fonts`: every declared web font must reach
  `status:"loaded"`; assert no element falls back to serif/Times.
  (`'unloaded'` = declared-but-unused, which is fine; `'error'` is the failure.)
- **Video: check `readyState`.** Hero reaching `readyState 4` (HAVE_ENOUGH_DATA)
  with `0` media errors = the HLS closure is complete; `playing:0` in a driven tab
  is just autoplay-gesture/throttle, confirm on a foreground human tab.
- **Offline proof.** Load with all non-own-origin network **hard-blocked**. Full
  render + **0 external requests** = genuinely self-hosted (not a proxy with a net).
- **Diff the thing that changed.** Don't conclude "deployed" from an incidentally
  unchanged file's ETag (B20) — check the manifest / the asset that actually moved.

---

# Part B — The graveyard (do NOT retry these)

Every one of these we actually tried. They fail for structural reasons, not for
lack of effort.

### B1. Reconstructing an effect by hand
We rebuilt the orb's shader/fluid-sim from scratch twice. Both rejected on sight —
wrong colors, wrong fluid motion. You cannot eyeball-match a tuned realtime effect.
**Fix:** run their *actual compiled bytes* (we pulled the exact webpack chunk and
ran it on npm `ogl` via a require-shim). "Clone this" means the actual thing.

### B2. Re-`fetch(url)` to "grab" assets
`fetch` is a **brand-new request**, not "read the bytes the browser already has."
It 404s / comes back opaque for a huge class of visible assets:
- **Inline SVG** (wordmark, logo) — vector paths in the HTML; *no URL exists*.
- **Tokened / single-use / signed URLs** (DAM/CDN) — valid once; later bare fetch 404s.
- **Cache-only / cross-origin** assets — blocked without CORS, or simply a miss.
**Fix:** CDP `getResponseBody` — read bytes as received (A2).

### B3. Attaching the recorder at "grab" time (retroactive capture)
Chrome **discards response bodies** once used unless something holds them (DevTools
open, or a debugger with Network enabled). A recorder attached on click has already
missed the whole load. Proven: the network reader only ever saw requests fired
*after* it attached (late analytics pings), never the main HTML/JS/media.
**Fix:** arm before the load; reload to capture from byte 0 (A2).

### B4. Enumerate-then-serve a fixed asset list
"Record the list one visit requested, serve that list." A page has no fixed list —
it requests over time and conditionally (logo at +3s, video after player init, more
on scroll/hover, different on mobile). One pass catches a subset; the clone is
always missing whatever didn't fire. Whack-a-mole that never terminates.
**Fix:** atemporal closure (A3).

### B5. Mutating their code to "make it show"
Rewriting URLs inside minified JS **corrupted the bundle** (broke `blob:` video).
Injecting a lazy-load promoter, forcing `opacity:1`, stripping `<script>`s — each
replaced *their* behavior with *our guess* and dropped fidelity. **Rule:** their
code is sacred and runs untouched; our only job is to have every byte it asks for.

### B6. Forcing reveals / faking interaction state
Setting elements visible to defeat scroll-reveal animations gives you the wrong
frame and kills the animation. Don't.

### B7. Reproducing *when/how* the page asks (replaying behavior)
Trying to script scroll → hover → click → timers to trigger each asset is fragile
and endless. **Fix:** atemporal closure means triggers are irrelevant — have it all
present up front.

### B8. Programmatic scroll to trigger lazy-loaders
`window.scrollTo()` jumps don't emit the real scroll/Intersection events lazy
loaders key off; content stayed at `opacity:0` (black) in automation though it
reveals fine for a human. (Another reason to go atemporal, B7.)

### B9. Verifying in a headless / background tab
Browsers throttle hidden tabs: rAF, IntersectionObserver, and media players don't
run when `visibilityState==='hidden'`. Our checks reported `vids=0` / low
`readyState` while the real foreground page played fine. **We debugged phantom
problems for hours.** **Fix:** foreground-only verification, or human eyes (A7).

### B10. `page.reload({waitUntil:'networkidle2'})` on a live site
Live sites hold persistent connections (analytics sockets, player heartbeats) so
"network idle" never arrives — the reload hangs ~90s then times out.
**Fix:** `domcontentloaded` + a fixed settle (we used 12s) (A2).

### B11. Service worker that remaps its own origin → starves itself
An SW that maps "same-origin path → origin host" will try to fetch its *own*
`/manifest.json` / `/app.shell` from the target site, 404, and never boot.
**Fix:** bypass own infra paths (`/h/`, `/manifest.json`, `/app.shell`, `/sw.js`,
`/index.html`) before any remap (A5).

### B12. SW fallback to the live origin on a miss
A "miss → fetch from origin" fallback **silently hot-links the source**: the page
*looks* self-hosted while it isn't, hiding an incomplete capture. **Fix:** miss →
**404**, then prove offline (A7). The pain of a visible miss is the point.

### B13. Static host serves `sw.js` as `text/html`
Browser refuses to register a non-JS-MIME service worker → blank page. **Fix:**
force `Content-Type: text/javascript` + `Service-Worker-Allowed: /` in `vercel.json`.

### B14. Static host transforms `.html` files
Vercel rewrote/served `.html` differently (stripped/altered the SSR shell). **Fix:**
store the shell under a non-`.html` name (`/app.shell`) and serve it from the SW on
navigations.

### B15. New Vercel project → SSO Deployment Protection → 401
The deployment is gated behind team SSO by default. **Fix:** `PATCH
/v9/projects/{pid}` `{ssoProtection:null}` with a valid user token.

### B16. Capturing only one device's media variants
We captured `_Mobile_` HLS; the desktop page requested `_Desktop_` variants → 404
→ black hero. **Fix:** the closure must include **every device variant** (desktop +
mobile transcodes), not one device's slice (A3).

### B17. Scraping only absolute URLs → drops every relative asset
The closure originally matched only `https://…`. But `@font-face` (and bg images,
masks, cursors) use **relative** `url()`: root-relative `/auto/.../Font.woff2` and
dir-relative `../fonts/x.woff`. Neither is an `https://` token → never queued →
**zero fonts in a 678-asset bundle** → the whole page fell back to Times New Roman
(and wrong font metrics threw spacing off). **Fix:** parse every `url(...)` in every
stylesheet and resolve against *that stylesheet's own base* (A3).

### B18. Assuming a missing asset will be obvious
A missing **content** asset screams (broken image, black video). A missing **style**
asset (font, icon font) does the opposite — the browser cascades to a fallback and
renders *happily*, no console error. The symptom presented as "spacing is off," not
"font missing," sending us to debug the wrong thing. **Fix:** verification must
assert web fonts reach `document.fonts` `status:"loaded"` (A7).

### B19. Expecting a redeploy to reach existing visitors
After capturing fonts and redeploying, the page **still** showed Times New Roman.
Two staleness traps: (a) the SW reads `/manifest.json` once at `activate` and holds
it in memory; (b) a **byte-identical `sw.js` never reinstalls** (Chrome byte-compares
the worker), so returning visitors keep the old worker + old asset map forever.
**Fix:** version the worker (forces reinstall → `activate` → fresh manifest) **and**
re-pull the manifest on navigation so future grabs self-heal (A5).

### B20. Assuming `--prod` moves a custom subdomain
`luce.disdat.dev` was aliased to one *specific old deployment*; `vercel deploy
--prod` published bytes the domain never pointed at. Worse, the `app.shell` ETag
matched the new prod (SSR unchanged) so it *looked* deployed — while the manifest
differed (678 vs 723 assets). **Fix:** re-alias the exact new deployment each push
(or attach the domain to the project so it tracks prod), and verify by the file that
actually changed, not an incidental match (A6, A7).

### B21. Uploading captured bytes *from the clone tab*
Browser POSTs out of the self-hosted clone get intercepted/eaten by its own SW.
**Fix:** egress from the real-target tab (no SW) or any non-SW context.

### B22. Detached `nohup` background helpers
Our HTTPS receiver kept dying — a detached `nohup` process got reaped between turns.
**Fix:** run long-lived helpers as a tracked background process that survives turns.

### B23. Using the root Vercel token
The root account's token was invalid for the team's projects. **Fix:** use Peter's
token at `~/.local/share/com.vercel.cli/auth.json`.

### B24. `pageFetch` with no timeout
One hung fetch froze the entire serial closure loop. **Fix:** per-fetch
`AbortController` (12s) + an outer `Promise.race` timeout (15s) + parallel workers,
so one bad host can't stall the walk (A3).

---

# Part C — Honest scope (what a "perfect copy" includes, and doesn't)
> Whatever the page sends your browser — content, computed styles, assets, client
> code, fonts, and the public endpoints it calls — we reproduce, offline, from the
> real bytes, with their code untouched. The server's private backend we don't,
> because it was never sent. *"Public website" ≠ "public backend."* Interactions
> the user never performs (a video never clicked) are captured only if exercised —
> which an always-armed rolling buffer makes seamless.

**Scorecard from Ferrari Luce (honest):** ✅ shell, layout, real fonts
(`document.fonts`-confirmed `loaded`), images, and the **HLS hero video playing**
from our own segments, all self-hosted with code untouched, served with all Ferrari
network blocked. The deliverable of that work wasn't the clone — it was this
playbook.
