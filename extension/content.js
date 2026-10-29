// Dis Dat — point & talk (per-page sensor + UI + crunch). Dead simple to use: hit
// record, talk while you REACT to the page (move, hover, click, type, scroll, even
// navigate to other pages), hit stop, paste. Under the hood: nothing is "selected" —
// every element you look at / touch, every network/chat response, every DOM change is
// a LOOSE, time-stamped hint on one session timeline. The transcript is the index: we
// slice the timeline by what you SAID and only deep-process that. Nano (free,
// on-device) crunches each remark into a classified, grounded note — live as a
// note-taker when ready, else at Stop — then reconciles. Cloud + Deepgram optional.
(() => {
  // A re-injection of content.js while an instance already exists = either the user toggling the panel OR
  // a spurious re-inject (the per-navigation re-inject firing when a modal/soft URL change reports a load).
  // NEVER destroy a LIVE recording on re-inject — that was killing captures the moment a modal changed the
  // URL. Only the idle toggle (panel open, not recording) closes; a live recording is left untouched.
  if (window.__disdat) { if (!window.__disdat.recording) (window.__disdat.show || window.__disdat.toggle)(); return; }
  // A host left in the DOM with NO live window.__disdat is a zombie from a previous extension reload
  // (its controller lived in a now-defunct isolated world, so the guard above can't see it). Remove any
  // before building — otherwise reloading the unpacked extension without refreshing tabs stacks a 2nd panel.
  try { document.querySelectorAll('[data-disdat-host]').forEach(n => n.remove()); } catch (e) {}
  const ORANGE = '#FF5C2A', INK = '#16110D';
  // The real Dis Dat pixel-cursor mark — same 12×16 art the Mac app draws (Sources/UI.swift
  // PixelCursorMark): k/w = ink silhouette, o = the orange click-accent at the tail.
  const ART = ['k...........', 'kk..........', 'kwk.........', 'kwwk........', 'kwwwk.......', 'kwwwwk......', 'kwwwwwk.....', 'kwwwwwwk....', 'kwwwwwwwk...', 'kwwwwwwwwk..', 'kwwwwwwwwwk.', 'kwwwwwooook.', 'kwwwookk....', 'kwwok.kk....', 'kwok...kk...', 'kkk.....k...'];
  function pixelLogo(w) {
    let r = '';
    for (let y = 0; y < ART.length; y++) for (let x = 0; x < ART[y].length; x++) { const ch = ART[y][x]; if (ch === '.') continue; r += '<rect x="' + x + '" y="' + y + '" width="1.05" height="1.05" fill="' + (ch === 'o' ? ORANGE : INK) + '"/>'; }
    return '<svg width="' + w + '" height="' + Math.round(w * 16 / 12) + '" viewBox="0 0 12 16" shape-rendering="crispEdges" style="display:block;flex:none">' + r + '</svg>';
  }
  const CUR = pixelLogo(13);
  // Bundle the brand fonts so the wordmark matches the Mac app and no serif fallback ever leaks.
  function loadFonts() {
    try {
      const F = (n, f, wt) => { try { const ff = new FontFace(n, 'url(' + chrome.runtime.getURL('fonts/' + f) + ") format('woff2')", { weight: wt, display: 'swap' }); ff.load().then(x => { try { document.fonts.add(x); } catch (e) {} }).catch(() => {}); } catch (e) {} };
      F('DDInter', 'inter.woff2', '100 900'); F('DDFraunces', 'fraunces.woff2', '600');
    } catch (e) {}
  }
  loadFonts();
  let pts = [], recording = false, audioStarting = false, audioRecovering = false, micFailure = false, raf = 0;
  let mx = innerWidth / 2, my = innerHeight / 2;
  let recog = null, recogOn = false, liveText = '', remarkStart = 0;
  let nanoState = 'idle', nanoPct = 0, lastText = '', nanoFails = 0;
  let sessionT0 = 0, currentEls = [], reported = new WeakSet();
  let localTL = [], localNet = [], localMut = [], localConsole = [], localRender = [], usage = { in: 0, out: 0, calls: 0 }, DBG = [];
  let shots = [], shotTimer = null, shotDirty = true, lastShotT = 0; // periodic viewport screenshots → a visual timeline of what the user actually saw. shotDirty: only grab when something changed since the last shot, so idle reading never triggers the hide/restore flash
  let needsPaint = true; // the heat-trail canvas only repaints when the cursor moved / page scrolled / mutated — idle = no 60fps repaint (was the main slowdown on heavy pages)
  let srcBytes = {}, srcInfo = null; // the page's OWN first-party JS source (the render harness), re-hosted in the bundle + a summary line for the ground truth
  let stateData = null, headData = null, domStr = '', assetBytes = {}, assetInfo = null, lastHref = ''; // v2 captures: persisted state / <head> meta / full DOM tree / re-hosted asset bytes / soft-nav tracker
  let perfPO = null, clsTotal = 0, sessionCtx = null;
  let hoverEl = null, hoverStart = 0, lastHover = 0, scYsent = -1, scTimer = 0, lastMutT = 0;
  let mo = null, tick = 0;
  const PAGE = location.href;
  const now = () => Math.round((Date.now() - sessionT0) / 100) / 10;
  const send = (m) => new Promise(r => { try { chrome.runtime.sendMessage(m, r); } catch (e) { r({ error: 'no-bg' }); } });
  const shortUrl = (u) => { try { const a = new URL(u); return (a.pathname && a.pathname !== '/' ? a.pathname : a.host); } catch (e) { return u || ''; } };
  // render one observed network exchange (REST req→res, fetch-SSE/WS/EventSource frame) for the handoff
  function fmtNet(n) {
    try {
      const k = n.kind || 'fetch';
      if (k === 'ws') return '  WS ' + (n.dir === 'send' ? '↑ send' : '↓ recv') + ' ' + shortUrl(n.url) + ': ' + (n.body || '').slice(0, 320);
      if (k === 'sse' || k === 'stream') return '  ⟿ stream ' + shortUrl(n.url) + (n.event && n.event !== 'message' ? ' [' + n.event + ']' : '') + (n.lastEventId ? ' (id ' + n.lastEventId + ')' : '') + ': ' + ((n.frame || n.body) || '').slice(0, 320);
      let s = '  ' + (n.method || 'GET') + ' ' + shortUrl(n.url) + ' [' + (n.status != null ? n.status : '?') + ']' + (n.ms ? ' ' + n.ms + 'ms' : '');
      if (n.reqBody) s += '\n     req: ' + String(n.reqBody).slice(0, 320);
      if (n.body) s += '\n     res: ' + String(n.body).slice(0, 600);
      else if (n.shape) s += '\n     res-shape: ' + JSON.stringify(n.shape).slice(0, 320);
      return s;
    } catch (e) { return '  ' + ((n && n.url) || '?'); }
  }
  // ---------- live remote log: forward the content script's OWN console + uncaught errors to the build owner via bg ----------
  const rlog = (level, tag, data) => { try { chrome.runtime.sendMessage({ type: 'rlog', src: 'content', level: level, tag: tag || '', data: data, page: PAGE }, () => { void chrome.runtime.lastError; }); } catch (e) {} };
  try {
    ['log', 'warn', 'error'].forEach(k => { const o = (console[k] || console.log).bind(console); console[k] = function () { try { o.apply(console, arguments); } catch (e) {} try { rlog(k, '', Array.prototype.map.call(arguments, function (a) { try { JSON.stringify(a); return a; } catch (e) { return String(a); } })); } catch (e) {} }; });
    window.addEventListener('error', function (e) { try { rlog('error', 'uncaught', { msg: e && e.message, file: e && e.filename, line: e && e.lineno }); } catch (_) {} });
    window.addEventListener('unhandledrejection', function (e) { try { var r = e && e.reason; rlog('error', 'unhandledrejection', { reason: (r && (r.stack || r.message)) || String(r) }); } catch (_) {} });
  } catch (e) {}

  // ---------- main-world fact bridge ----------
  // Component / props / state / source-pointer / listeners live in the PAGE's JS world —
  // the isolated content script can't see __reactFiber$ / __vue__ / __svelte_meta (that's
  // why `react` was always null). We tag the element with a temp attribute, ask
  // inject-main.js to read it over there, and merge what comes back. Short timeout so it
  // degrades gracefully if the shim isn't ready or the page has no framework.
  let fwSeq = 0; const fwPending = new Map(); const glPending = new Map();
  function setRec(on) { try { window.postMessage({ __disdat_rec: !!on }, '*'); } catch (e) {} }
  function requestMainFacts(el) {
    return new Promise(resolve => {
      if (!el || el.nodeType !== 1) { resolve(null); return; }
      const token = 'dd' + (++fwSeq), attr = 'data-dd-fw-' + token; let done = false;
      const finish = (v) => { if (done) return; done = true; fwPending.delete(token); try { el.removeAttribute(attr); } catch (e) {} resolve(v || null); };
      fwPending.set(token, finish);
      try { el.setAttribute(attr, '1'); window.postMessage({ __disdat_fw_req: token }, '*'); } catch (e) { finish(null); return; }
      setTimeout(() => finish(null), 140);
    });
  }
  // ask the MAIN-world GL hook (inject-hooks.js) for a canvas's shaders/uniforms/frame
  function requestGL(el) {
    return new Promise(resolve => {
      if (!el || el.tagName !== 'CANVAS') { resolve(null); return; }
      const token = 'g' + (++fwSeq), attr = 'data-dd-gl-' + token; let done = false;
      const finish = v => { if (done) return; done = true; glPending.delete(token); try { el.removeAttribute(attr); } catch (e) {} resolve(v || null); };
      glPending.set(token, finish);
      try { el.setAttribute(attr, '1'); window.postMessage({ __disdat_gl_req: token }, '*'); } catch (e) { finish(null); return; }
      setTimeout(() => finish(null), 500); // GL readback can be slower than the fact bridge
    });
  }
  function onMain(e) {
    if (e.source !== window || !e.data) return;
    if (e.data.__disdat_fw_res) { const r = e.data.__disdat_fw_res; const f = fwPending.get(r.token); if (f) f(r.fw); return; }
    if (e.data.__disdat_gl_res) { const r = e.data.__disdat_gl_res; const f = glPending.get(r.token); if (f) f(r.gl); return; }
    if (e.data.__disdat_console && recording) {
      const c = e.data.__disdat_console, ev = { page: PAGE, t: now(), level: c.level, msg: c.msg };
      localConsole.push(ev); if (localConsole.length > 60) localConsole.shift();
      send({ type: 'console', ev });
    }
  }
  // Shake-style baseline context — cheap, expected, answers "broken/feels off → on WHAT?"
  function pageContext() {
    try {
      const c = navigator.connection || {}, dm = matchMedia('(prefers-color-scheme: dark)').matches;
      let fonts = []; try { fonts = [...new Set([...document.fonts].map(f => f.family))].slice(0, 12); } catch (e) {}
      return { viewport: innerWidth + '×' + innerHeight, screen: (screen.width || 0) + '×' + (screen.height || 0), dpr: Math.round((devicePixelRatio || 1) * 100) / 100, colorScheme: dm ? 'dark' : 'light', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, lang: navigator.language || '', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '', platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '', online: navigator.onLine !== false, connection: c.effectiveType || '', fonts };
    } catch (e) { return {}; }
  }
  // On-device crunch = the BUNDLED WebLLM model (runs on the user's own GPU in the
  // offscreen doc; weights auto-download once; no key, no cloud, no Chrome built-in AI,
  // no flags). Chrome's Nano / Prompt API is deliberately NOT used. A cloud Claude key
  // (⚙) stays as an OPTIONAL fallback only.
  const USE_NANO = false;   // never touch Chrome's Prompt API / Nano
  const LOCAL_LLM = false;  // Direct mode uses the selected Deepgram and briefing-provider keys in the private extension runtime.
  const nanoReady = () => nanoState === 'ready';
  // usable = enabled AND downloaded AND not repeatedly stalling. After 2 stalls we
  // bypass Nano for the session so the crunch never hangs — straight to cloud.
  const nanoUsable = () => USE_NANO && nanoState === 'ready' && nanoFails < 2;

  const host = document.createElement('div');
  host.setAttribute('data-disdat-host', '1'); // stable marker so a later injection can find + clear a zombie host left by an extension reload
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(host);
  const sh = host.attachShadow({ mode: 'closed' }); // aggregated capture/briefing stays in the extension's isolated UI
  sh.innerHTML = `
    <style>
      :host{ all:initial; font-family:'DDInter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; color:#16110D }
      :host *{ font-family:'DDInter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; box-sizing:border-box; user-select:none }
      canvas{ position:fixed; inset:0; pointer-events:none; z-index:2147483000 }
      .hb{ position:fixed; pointer-events:none; z-index:2147483050 }
      .bar{ position:fixed; bottom:22px; left:50%; transform:translateX(-50%); display:none; align-items:center; gap:11px; background:#FBF7EE; color:#16110D; border:1px solid rgba(28,18,6,.12); border-radius:16px; box-shadow:0 18px 50px -14px rgba(0,0,0,.45); padding:8px 10px 8px 14px; pointer-events:auto; z-index:2147483200 }
      .brand{ display:flex; align-items:center; gap:8px; font-family:'DDFraunces',Georgia,'Times New Roman',serif; font-weight:600; font-size:15px; letter-spacing:0; color:#16110D; user-select:none; white-space:nowrap }
      .sep{ width:1px; height:22px; background:rgba(28,18,6,.12) }
      .rec{ display:inline-flex; align-items:center; gap:8px; background:${ORANGE}; color:#fff; border:none; border-radius:11px; padding:9px 16px; font-weight:800; font-size:13.5px; cursor:pointer; transition:background .18s }
      .rec:hover{ background:#ff6a3d } .rec.on{ background:#16110D }
      .rec .rd{ width:9px; height:9px; border-radius:50%; background:#fff } .rec.on .rd{ background:${ORANGE}; animation:bl .9s steps(2) infinite }
      @keyframes bl{ 50%{opacity:.25} }
      .lbl{ font-size:12.5px; color:#6b5d44; max-width:32vw; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .ic{ background:transparent; border:none; color:#8a7c63; cursor:pointer; font-size:15px; padding:5px 7px; border-radius:8px; line-height:1 }
      .ic:hover{ color:#16110D; background:rgba(28,18,6,.06) }
      .tmr{ display:none; font:600 13px/1 ui-monospace,monospace; color:#16110D; font-variant-numeric:tabular-nums; letter-spacing:.02em }
      /* recording = a slim pill: hide the brand/divider/gear, leaving ● Stop · timer · live words */
      .bar.rec-on{ display:flex; padding:8px 12px 8px 12px }
      .bar.rec-on .brand, .bar.rec-on .sep, .bar.rec-on .lbl, .bar.rec-on #esc{ display:none }
      .bar.rec-on .tmr{ display:inline-block }
      .bar.mic-pending #esc{ display:inline-block }
      .bar.mic-pending .tmr{ display:none }
      .rec:disabled{ opacity:.65; cursor:wait }
      .dim{ position:fixed; inset:0; background:rgba(20,14,6,.12); backdrop-filter:blur(8px) saturate(1.1); -webkit-backdrop-filter:blur(8px) saturate(1.1); opacity:0; transition:opacity .26s; pointer-events:none; z-index:2147483300 }
      .dim.show{ opacity:1; pointer-events:auto }
      .card{ position:fixed; left:50%; top:50%; transform:translate(-50%,-47%) scale(.98); width:min(500px,92vw); max-height:85vh; overflow:auto; background:#F7F1E4; color:#1c1206; border:1px solid rgba(28,18,6,.12); border-radius:20px; box-shadow:0 36px 90px -22px rgba(0,0,0,.55); opacity:0; transition:opacity .24s, transform .24s; pointer-events:none; z-index:2147483400 }
      .card.show{ opacity:1; transform:translate(-50%,-50%) scale(1); pointer-events:auto }
      .ch{ display:flex; align-items:center; gap:10px; padding:16px 16px 13px 18px; border-bottom:1px solid rgba(28,18,6,.1) }
      .ctitle{ font:600 12px/1.3 ui-monospace,monospace; color:#6b5d44; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .via{ margin-left:auto; font:700 10px/1 ui-monospace,monospace; letter-spacing:.06em; text-transform:uppercase; color:#a08a6a; flex:none }
      .cx{ width:30px; height:30px; border:none; background:transparent; color:#8a7c63; cursor:pointer; font-size:19px; border-radius:50%; flex:none; line-height:1 }
      .cx:hover{ background:rgba(28,18,6,.07); color:#16110D }
      .stages{ padding:16px 18px }
      .stg{ display:flex; align-items:center; gap:11px; padding:7px 0; color:#9a8c72 }
      .stg .dot{ width:18px; height:18px; border-radius:50%; border:2px solid rgba(28,18,6,.18); flex:none; display:flex; align-items:center; justify-content:center; font-size:11px; color:#fff; box-sizing:border-box }
      .stg.run .dot{ border-color:rgba(255,92,42,.3); border-top-color:${ORANGE}; animation:spin .7s linear infinite }
      .stg.done{ color:#1c1206 } .stg.done .dot{ background:${ORANGE}; border-color:${ORANGE} }
      .stg b{ font-weight:600; font-size:13.5px } .stg .lb2{ display:block; font:11px/1.3 ui-monospace,monospace; color:#a08a6a; margin-top:1px }
      @keyframes spin{ to{ transform:rotate(360deg) } }
      .said{ padding:14px 18px 0; font-size:12.5px; color:#8a6b4a; font-style:italic; white-space:pre-wrap }
      .out{ padding:12px 18px; white-space:pre-wrap; font-size:14.5px; line-height:1.6; color:#1c1206 }
      .note{ padding:0 18px 12px; color:#a07a4a; font-size:12px }
      .cf{ position:sticky; bottom:0; display:flex; align-items:center; gap:10px; padding:12px 18px 16px; border-top:1px solid rgba(28,18,6,.1); background:#F7F1E4 }
      .copy{ display:inline-flex; align-items:center; gap:8px; background:${ORANGE}; color:#fff; border:none; border-radius:12px; padding:11px 24px; font-size:14.5px; font-weight:700; cursor:pointer; transition:background .18s } .copy:hover{ background:#16110D }
      .again{ background:transparent; border:none; color:#8a7c63; font-size:13px; cursor:pointer; margin-left:auto } .again:hover{ color:#16110D }
      .set{ position:fixed; left:50%; bottom:80px; transform:translateX(-50%); width:min(420px,92vw); background:#F7F1E4; color:#1c1206; border:1px solid rgba(28,18,6,.12); border-radius:18px; box-shadow:0 30px 70px -18px rgba(0,0,0,.5); pointer-events:auto; display:none; z-index:2147483500; padding:18px }
      .set h4{ margin:0 0 4px; font-size:15px } .set p{ margin:0 0 12px; font-size:12px; color:#6b5d44 }
      .set label{ display:block; font-size:11px; color:#8a7c63; margin:10px 0 4px; text-transform:uppercase; letter-spacing:.06em }
      .set input{ width:100%; box-sizing:border-box; background:#fff; color:#16110D; border:1px solid rgba(28,18,6,.18); border-radius:10px; padding:10px 12px; font-size:13px }
      .btn{ background:#16110D; color:#FBF7EE; border:none; border-radius:10px; padding:10px 16px; font-weight:700; font-size:13px; cursor:pointer } .btn:hover{ background:${ORANGE} }
      .btn.ghost{ background:transparent; color:#8a7c63 } .btn.ghost:hover{ color:#16110D; background:transparent }
      .hsetup{ padding:16px 18px 4px } .hsetup.ready .hspin{ border:2px solid ${ORANGE}; background:${ORANGE}; animation:none }
      .hrow{ display:flex; align-items:center; gap:10px; font-size:14px; color:#1c1206 }
      .hspin{ width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,92,42,.3); border-top-color:${ORANGE}; animation:spin .7s linear infinite; flex:none }
      .hbar{ height:7px; background:rgba(28,18,6,.1); border-radius:6px; overflow:hidden; margin:12px 0 6px } .hbar>i{ display:block; height:100%; width:0; background:${ORANGE}; transition:width .3s }
      .hsub{ font:11px/1.4 ui-monospace,monospace; color:#a08a6a }
      .hbody{ padding:10px 18px 2px; font-size:13.5px; line-height:1.55; color:#6b5d44 }
      .hkbd{ margin-left:auto; font:11px/1 ui-monospace,monospace; color:#a08a6a }
      .copy:disabled{ background:#cdbf9f; cursor:default }
      #home{ position:relative }
      .hacct{ position:absolute; top:-38px; right:52px; z-index:5 }
      .hacctbtn{ background:transparent; border:1px solid rgba(28,18,6,.14); color:#6b5d44; border-radius:999px; padding:5px 12px; font-size:11.5px; font-weight:600; cursor:pointer; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .hacctbtn:hover{ color:#16110D; border-color:rgba(28,18,6,.3) }
      .hmenu{ position:absolute; right:0; top:32px; background:#fff; border:1px solid rgba(28,18,6,.12); border-radius:12px; box-shadow:0 18px 44px -14px rgba(0,0,0,.35); min-width:210px; padding:6px; z-index:6 }
      .hme{ font:600 11px/1.3 ui-monospace,monospace; color:#a08a6a; padding:8px 10px 6px; border-bottom:1px solid rgba(28,18,6,.08); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .hmi{ display:block; width:100%; text-align:left; background:transparent; border:none; color:#16110D; font-size:13px; font-weight:600; padding:8px 10px; border-radius:8px; cursor:pointer }
      .hmi:hover{ background:rgba(28,18,6,.06) } .hmi-mut{ color:#8a7c63; font-weight:500 }
      .hmid{ display:flex; flex-direction:column; align-items:center; gap:9px; padding:6px 18px 14px }
      .bigrec{ display:inline-flex; align-items:center; justify-content:center; gap:10px; background:${ORANGE}; color:#fff; border:none; border-radius:14px; padding:15px 44px; font-size:16.5px; font-weight:800; cursor:pointer; transition:background .18s, transform .12s; box-shadow:0 14px 34px -12px rgba(255,92,42,.55) }
      .bigrec:hover{ background:#ff6a3d; transform:translateY(-1px) } .bigrec:disabled{ background:#cdbf9f; box-shadow:none; cursor:default }
      .bigrec .rd2{ width:10px; height:10px; border-radius:50%; background:#fff; flex:none }
      .microw{ display:flex; align-items:center; gap:7px; color:#8a7c63; font-size:12px }
      .microw select{ background:transparent; border:none; color:#6b5d44; font-size:12px; max-width:230px; cursor:pointer; outline:none }
      .micfix{ background:transparent; border:none; color:${ORANGE}; font-size:12px; font-weight:700; cursor:pointer; text-decoration:underline; text-underline-offset:2px }
      .hkbd2{ font:11px/1.4 ui-monospace,monospace; color:#a08a6a; text-align:center }
      .hgal{ border-top:1px solid rgba(28,18,6,.08); padding:12px 18px 16px }
      .hgal-h{ font:700 10.5px/1 ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; color:#a08a6a; margin-bottom:9px }
      .hgal-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:9px; max-height:172px; overflow:auto }
      .hcap{ border:1px solid rgba(28,18,6,.1); border-radius:10px; overflow:hidden; cursor:pointer; background:#fff; transition:border-color .15s, transform .12s }
      .hcap:hover{ border-color:${ORANGE}; transform:translateY(-1px) }
      .hcap img{ display:block; width:100%; height:64px; object-fit:cover; object-position:top }
      .hcap .hc-m{ font:10px/1.3 ui-monospace,monospace; color:#8a7c63; padding:5px 7px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .hv-top{ display:flex; align-items:center; gap:10px; padding:13px 16px 10px }
      .hv-back{ background:transparent; border:none; color:#8a7c63; font-size:13px; font-weight:600; cursor:pointer } .hv-back:hover{ color:#16110D }
      .hv-meta{ flex:1; font:11px/1.3 ui-monospace,monospace; color:#a08a6a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .hv-copy{ background:${ORANGE}; color:#fff; border:none; border-radius:10px; padding:8px 18px; font-size:13px; font-weight:700; cursor:pointer } .hv-copy:hover{ background:#16110D }
      .hv-shot{ display:block; width:calc(100% - 32px); margin:0 16px; border-radius:10px; border:1px solid rgba(28,18,6,.1); max-height:150px; object-fit:cover; object-position:top }
      .hv-text{ padding:12px 18px 18px; font-size:13.5px; line-height:1.65; color:#1c1206; white-space:pre-wrap; max-height:230px; overflow:auto }
      .hv-text code{ background:#ffe3d6; color:#b8431f; border-radius:5px; padding:1px 5px; font:12px/1 ui-monospace,monospace }
    </style>
    <canvas id="heat"></canvas>
    <div class="bar" id="bar">
      <span class="brand">${CUR} Dis&nbsp;Dat</span>
      <span class="sep"></span>
      <button class="rec" id="rec"><span class="rd"></span><span id="recl">Start</span></button>
      <span class="tmr" id="timer">0:00</span>
      <span class="lbl" id="lbl">talk &amp; react</span>
      <button class="ic" id="esc" title="close">✕</button>
    </div>
    
    </div>
    <div class="dim" id="dim"></div>
    <div class="card" id="card">
      <div class="ch"><span class="brand">${CUR} Dis&nbsp;Dat</span><span class="ctitle" id="ptag"></span><span class="via" id="via"></span><button class="cx" id="cardx">×</button></div>
      <div id="home" hidden>
        <div class="hacct"><button class="hacctbtn" id="acctbtn" hidden>account</button>
          <div class="hmenu" id="hmenu" hidden>
            <div class="hme" id="hme"></div>
            <button class="hmi" id="m-upgrade" hidden>Upgrade to Pro — $7/mo</button>
            <button class="hmi" id="m-billing" hidden>Billing &amp; invoices</button>
            <button class="hmi" id="m-refer">Refer a friend · both get a month</button>
            <button class="hmi" id="m-site">Manage account ↗</button>
            <button class="hmi hmi-mut" id="m-signout">Sign out</button>
          </div>
        </div>
        <div class="hsetup" id="hsetup">
          <div class="hrow"><span class="hspin" id="hspin"></span><b id="hstat">Checking your account…</b></div>
          <div class="hbar"><i id="hbarfill"></i></div>
          <div class="hsub" id="hsub"></div>
        </div>
        <div class="hmid">
          <button class="bigrec" id="hstart" disabled><span class="rd2"></span><span id="hstartl">Setting up…</span></button>
          <div class="microw"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg><select id="micsel"><option value="">Default microphone</option></select><button class="micfix" id="micfix" hidden>enable mic</button></div>
          <span class="hkbd2">talk while you point, hover, scroll — even across pages</span>
        </div>
        <div class="hgal" id="hgal" hidden>
          <div class="hgal-h">Past captures</div>
          <div class="hgal-grid" id="hgrid"></div>
        </div>
      </div>
      <div id="hview" hidden>
        <div class="hv-top"><button class="hv-back" id="hvback">‹ back</button><span class="hv-meta" id="hvmeta"></span><button class="hv-copy" id="hvcopy">Copy</button></div>
        <img class="hv-shot" id="hvshot" alt="">
        <div class="hv-text" id="hvtext"></div>
      </div>
      <div class="stages" id="stages" hidden>
        <div class="stg" id="stg-transcribe"><span class="dot"></span><span><b>Transcribing your narration</b><span class="lb2"></span></span></div>
        <div class="stg" id="stg-read"><span class="dot"></span><span><b>Reading what you looked at</b><span class="lb2"></span></span></div>
        <div class="stg" id="stg-crunch"><span class="dot"></span><span><b>Writing the code-speak</b><span class="lb2"></span></span></div>
      </div>
      <div id="result" hidden>
        <div class="said" id="said"></div>
        <div class="out" id="pout"></div>
        <div class="note" id="pnote" hidden></div>
        <div class="cf"><button class="copy" id="copy">Copy code-speak</button><button class="again" id="again">record again</button></div>
      </div>
    </div>`;
  const $ = (id) => sh.getElementById(id);
  const canvas = $('heat'), ctx = canvas.getContext('2d');
  const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  size(); addEventListener('resize', size, true);

  // ---------- heat trail — ELEMENT-ANCHORED so it rides the structure ----------
  // Each point stores the element it was over + its offset inside that element.
  // Every frame we resolve the point to wherever the element is NOW — so the trail
  // sticks to a scrolling sidebar, a sticky nav, a modal, a dropdown panel, instead
  // of being painted in fixed document space (which drifts off inner-scroll regions).
  function resolvePts() {
    const cache = new Map(), xy = [];
    for (const p of pts) {
      if (!p.el || !p.el.isConnected) { xy.push(null); continue; }
      let r = cache.get(p.el); if (!r) { r = p.el.getBoundingClientRect(); cache.set(p.el, r); }
      xy.push([r.left + p.ox, r.top + p.oy]);
    }
    return xy;
  }
  // Heat is conveyed mainly by COLOUR (cool → hot), not brightness — and it takes real dwell to
  // climb the ramp (thresholds run higher now that we interpolate intermediate points). Count
  // per density cell.
  const HCELL = 26;
  const HEAT = [[35, 200, 165], [120, 215, 90], [250, 205, 70], [255, 140, 45], [255, 60, 48]];
  function heatIdx(c) { return c <= 3 ? 0 : c <= 8 ? 1 : c <= 15 ? 2 : c <= 26 ? 3 : 4; }
  // Draw the trail as a THICK highlighter band riding the resolved points. Heat → COLOUR;
  // brightness/width only nudge up a touch when hot. Consecutive points sharing a heat colour
  // are batched into ONE rounded stroke — cheap, and the joins stay clean (no beading).
  // The trail is drawn to an OFFSCREEN layer at full opacity, then composited ONCE at a uniform
  // alpha — so overlapping/dense passes (a hotspot) never compound the transparency. Heat reads
  // via COLOUR (cool→hot by dwell density); the opacity aggregate stays flat.
  let _hl = null, _hlx = null;
  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length) {
      const xy = resolvePts();
      const grid = new Map();
      for (const p of xy) { if (!p) continue; const k = Math.round(p[0] / HCELL) + '_' + Math.round(p[1] / HCELL); grid.set(k, (grid.get(k) || 0) + 1); }
      const countAt = (p) => grid.get(Math.round(p[0] / HCELL) + '_' + Math.round(p[1] / HCELL)) || 1;
      if (!_hl || _hl.width !== canvas.width || _hl.height !== canvas.height) { _hl = document.createElement('canvas'); _hl.width = canvas.width; _hl.height = canvas.height; _hlx = _hl.getContext('2d'); }
      const h = _hlx;
      h.clearRect(0, 0, _hl.width, _hl.height);
      h.lineCap = 'round'; h.lineJoin = 'round';
      // Draw a run as a SMOOTH curve (midpoint-quadratic) rather than straight segments, so the
      // band curves through the points instead of going faceted/jaggedy on turns.
      const smooth = (p, lw, col) => {
        if (!p.length) return;
        h.strokeStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')'; // full opacity on the layer
        h.lineWidth = lw;
        h.beginPath(); h.moveTo(p[0][0], p[0][1]);
        if (p.length < 3) { for (let k = 1; k < p.length; k++) h.lineTo(p[k][0], p[k][1]); }
        else { for (let k = 1; k < p.length - 1; k++) { const mxp = (p[k][0] + p[k + 1][0]) / 2, myp = (p[k][1] + p[k + 1][1]) / 2; h.quadraticCurveTo(p[k][0], p[k][1], mxp, myp); } h.lineTo(p[p.length - 1][0], p[p.length - 1][1]); }
        h.stroke();
      };
      let i = 0;
      while (i < xy.length) {
        if (!xy[i]) { i++; continue; }
        const idx = heatIdx(countAt(xy[i])); let maxc = countAt(xy[i]);
        const run = [xy[i]];
        let j = i + 1;
        while (j < xy.length && xy[j] && heatIdx(countAt(xy[j])) === idx) { run.push(xy[j]); const c = countAt(xy[j]); if (c > maxc) maxc = c; j++; }
        if (j < xy.length && xy[j]) run.push(xy[j]); // bridge into the next colour run — no gap
        smooth(run, 8 + Math.min(maxc, 12) * 0.45, HEAT[idx]); // thinner base; only a gentle nudge when hot
        i = j;
      }
      ctx.globalAlpha = 0.26; ctx.drawImage(_hl, 0, 0); ctx.globalAlpha = 1; // ONE uniform-alpha composite — lighter now
    }
    if (recording) { // calm highlighter head at the live cursor (not a bright flare)
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 12);
      g.addColorStop(0, 'rgba(255,140,45,.38)'); g.addColorStop(1, 'rgba(255,140,45,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 12, 0, 7); ctx.fill();
    }
  }
  let lastM = 0, lastStaticT = 0;
  function onMove(e) {
    mx = e.clientX; my = e.clientY;
    if (!recording) return;
    needsPaint = true; // cursor moved → trail head repaints. NOT shotDirty: moving the mouse doesn't change the page, and treating it as a change is what made screenshots fire (and flash) every ~1.6s during any movement
    const t = performance.now();
    if (t - lastM >= 6) {
      lastM = t;
      // anchor to the topmost real element under the cursor — getBoundingClientRect() is ground
      // truth, so the point rides whatever scrolls it. Universal: one path, every page.
      const stack = document.elementsFromPoint(mx, my) || [];
      const el = stack.find(n => n && n.nodeType === 1 && !host.contains(n)) || document.documentElement;
      const r = el.getBoundingClientRect();
      // continuity on FAST moves: if we jumped a long way from the last point, drop interpolated
      // points along the gap so the highlighter band stays unbroken instead of going jaggedy.
      const last = pts[pts.length - 1];
      let lsx = null, lsy = null;
      if (last && last.el && last.el.isConnected) { const lr = last.el.getBoundingClientRect(); lsx = lr.left + last.ox; lsy = lr.top + last.oy; }
      const movedDist = (lsx != null) ? Math.hypot(mx - lsx, my - lsy) : 999;
      if (movedDist < 4) {
        // STATIC cursor: don't pile points into one cell (instant hotspot). Drop a faint point only
        // every ~150ms, so a held cursor builds heat slowly — SOME weight, not an instant blob.
        if (t - lastStaticT >= 150) { lastStaticT = t; pts.push({ el, ox: mx - r.left, oy: my - r.top }); }
      } else {
        // moving: interpolate across fast jumps so the band stays continuous (no jaggedness)
        if (lsx != null && movedDist > 12 && movedDist < 500) { const dx = mx - lsx, dy = my - lsy, n = Math.min(12, Math.floor(movedDist / 12)); for (let k = 1; k < n; k++) pts.push({ el, ox: (lsx + dx * k / n) - r.left, oy: (lsy + dy * k / n) - r.top }); }
        pts.push({ el, ox: mx - r.left, oy: my - r.top });
        lastStaticT = t;
      }
      if (pts.length > 1200) pts.splice(0, pts.length - 1200);
    }
    if (t - lastHover >= 90) {
      lastHover = t;
      const el = topAt(mx, my);
      if (el !== hoverEl) {
        if (hoverEl && (t - hoverStart) >= 350) recordEngage(hoverEl, 'look', { dwellMs: Math.round(t - hoverStart) });
        hoverEl = el; hoverStart = t;
      }
    }
  }
  let lastPaint = 0;
  (function loop() { if (needsPaint) { needsPaint = false; paint(); } raf = requestAnimationFrame(loop); })(); // repaint only when dirty (moved/scrolled/mutated/tick) — idle stays at 0 CPU instead of a relentless 60fps redraw

  // ---------- selector + deep extraction (the "all of it" facts) ----------
  function sel(el, short) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id;
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    if (short) return tag + cls;
    const p = el.parentElement;
    const pc = p && p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\s+/)[0] : (p ? p.tagName.toLowerCase() : '');
    return (pc ? pc + ' > ' : '') + tag + cls;
  }
  function selShort(el) { return el && el.nodeType === 1 ? sel(el, true) : ''; }
  const KEEP = ['display','position','top','right','bottom','left','width','height','margin','padding','color','background','background-color','background-image','border','border-radius','box-shadow','font-family','font-size','font-weight','line-height','letter-spacing','text-align','opacity','z-index','isolation','transform','transition','animation','filter','backdrop-filter','flex','justify-content','align-items','gap','grid-template-columns','overflow','cursor','object-fit','mix-blend-mode','inset','aspect-ratio','row-gap','column-gap','grid-template-rows','grid-auto-flow','place-items','place-content','clip-path','mask-image','-webkit-mask-image','text-shadow','text-decoration','text-transform','white-space','word-break','outline','outline-offset','will-change','scroll-snap-type','font-variation-settings','font-feature-settings','-webkit-text-fill-color','-webkit-text-stroke','writing-mode','direction','visibility','pointer-events','user-select'];
  const DROP = new Set(['none','normal','auto','0px','0s','0','rgba(0, 0, 0, 0)','static','visible','stretch','baseline','content-box']);
  function pick(o) { const out = {}; let n = 0; for (const k in o) { if (n++ >= 12) break; if (k.startsWith('_') || k === 'children') continue; const v = o[k]; const ty = typeof v; if (ty === 'function') continue; else if (Array.isArray(v)) out[k] = '[' + v.length + ']'; else if (v && ty === 'object') out[k] = '{…}'; else out[k] = String(v).slice(0, 60); } return Object.keys(out).length ? out : null; }
  function fwProps(el) {
    try {
      for (const k in el) { if (k.indexOf('__reactProps$') === 0) { const r = pick(el[k] || {}); if (r) return r; } }
      for (const k in el) { if (k.indexOf('__reactFiber$') === 0) { const f = el[k]; const r = pick((f && f.memoizedProps) || {}); if (r) return r; } }
      if (el.__vue__) { const r = pick(el.__vue__.$props || el.__vue__._props || {}); if (r) return r; }
    } catch (e) {}
    return null;
  }
  // a11y role + accessible name — the exact handle agents ground on, ~1/10 the tokens of
  // vision, no CDP. Prefer the native computed props if the engine exposes them, else a
  // lightweight implicit-role + name resolution (dependency-free).
  function implicitRole(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'input') return ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', search: 'searchbox', email: 'textbox', tel: 'textbox', url: 'textbox', number: 'spinbutton' })[el.type] || 'textbox';
    return ({ button: 'button', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', img: 'img', select: 'combobox', textarea: 'textbox', ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form', dialog: 'dialog', summary: 'button' })[t] || '';
  }
  function a11y(el) {
    let role = ''; try { if (typeof el.computedRole === 'string') role = el.computedRole; } catch (e) {}
    if (!role) role = el.getAttribute('role') || implicitRole(el) || '';
    let name = ''; try { if (typeof el.computedName === 'string') name = el.computedName; } catch (e) {}
    if (!name) name = (el.getAttribute('aria-label') || '').trim();
    if (!name) { const lb = el.getAttribute('aria-labelledby'); if (lb) name = lb.split(/\s+/).map(id => { const n = document.getElementById(id); return n ? (n.textContent || '').trim() : ''; }).filter(Boolean).join(' '); }
    if (!name && el.tagName === 'IMG') name = el.getAttribute('alt') || '';
    if (!name) name = el.getAttribute('placeholder') || el.getAttribute('title') || '';
    if (!name) { const tc = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (tc && tc.length <= 40) name = tc; }
    name = (name || '').slice(0, 60);
    return (role || name) ? { role: role || undefined, name: name || undefined } : null;
  }
  // assets (for show-by-example / recreating a reference): the real image/icon/bg URLs + dims
  function assetOf(el, cs) {
    try {
      const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } };
      if (el.tagName === 'IMG') return { src: abs(el.currentSrc || el.src || '').slice(0, 400), w: el.naturalWidth || 0, h: el.naturalHeight || 0, alt: (el.alt || '').slice(0, 60) };
      if (el.tagName === 'VIDEO') return { video: abs(el.currentSrc || el.src || '').slice(0, 400) };
      // inline SVG has no URL — serialize the source (the Ferrari-wordmark lesson)
      const svg = el.tagName.toLowerCase() === 'svg' ? el : (el.firstElementChild && el.firstElementChild.tagName.toLowerCase() === 'svg' ? el.firstElementChild : null);
      if (svg) { try { const m = new XMLSerializer().serializeToString(svg); return { svg: m.length > 4000 ? m.slice(0, 4000) + '…' : m }; } catch (e) { return { kind: 'svg' }; } }
      const bg = (cs || getComputedStyle(el)).backgroundImage;
      if (bg && bg !== 'none') {
        const urls = []; let mm; const re = /url\(["']?(.*?)["']?\)/g; while ((mm = re.exec(bg))) if (mm[1]) urls.push(abs(mm[1]).slice(0, 400));
        if (urls.length) return { bg: urls.length === 1 ? urls[0] : urls };
        if (/gradient/.test(bg)) return { gradient: bg.slice(0, 200) };
      }
    } catch (e) {}
    return null;
  }
  function htmlSnippet(el) { try { let h = el.outerHTML || ''; h = h.replace(/\s*data-dd-fw-[^=\s]*="[^"]*"/g, ''); const cap = (el.tagName && el.tagName.toLowerCase() === 'svg') ? 6000 : 1500; return h.length > cap ? h.slice(0, cap) + '…' : h; } catch (e) { return ''; } }
  // Walk the page's stylesheets and pull the AUTHORED rules that target this element — incl
  // :hover/:focus/:active/.is-* state variants and ::before/::after — VERBATIM. This recovers
  // untriggered states + design-token (var()) intent that a flattened computed snapshot loses.
  // Cross-origin sheets (CSS served off a CDN/subdomain — i.e. most of the modern web) throw on
  // .cssRules, which silently emptied ALL authored CSS incl :hover/:active/@media. We recover them:
  // the background (host_permissions <all_urls>) fetches the blocked sheet text, and we rebuild it as a
  // constructable CSSStyleSheet whose .cssRules we can walk exactly like a same-origin sheet.
  let xoSheets = [], xoSeen = new Set(), xoPromise = null;
  function ensureXOSheets() {
    if (xoPromise) return xoPromise;
    xoPromise = (async () => {
      try {
        const urls = [];
        for (const sheet of document.styleSheets) { let ok = false; try { ok = !!sheet.cssRules; } catch (e) {} if (!ok && sheet.href && !xoSeen.has(sheet.href)) { xoSeen.add(sheet.href); urls.push(sheet.href); } }
        if (!urls.length) return;
        const res = await send({ type: 'fetchcss', urls });
        const css = (res && res.css) || {};
        for (const u in css) { try { const cs = new CSSStyleSheet(); await cs.replace(css[u]); xoSheets.push(cs); } catch (e) {} }
        rlog('event', 'xo-css', { fetched: Object.keys(css).length, rules: xoSheets.reduce((n, s) => { try { return n + s.cssRules.length; } catch (e) { return n; } }, 0) });
      } catch (e) { rlog('warn', 'xo-css-fail', { err: String(e) }); }
    })();
    return xoPromise;
  }
  // strip TRAILING pseudo-classes/elements only — the (?<!\\) negative lookbehind keeps the regex from
  // eating the ':hover'/':active' that live INSIDE escaped Tailwind class names (.enabled\:hover\:bg-x),
  // which used to mangle the selector so el.matches() failed and ZERO authored rules were ever captured.
  const PSEUDO_RE = /(?<!\\)::?(hover|focus|focus-within|focus-visible|active|visited|disabled|enabled|checked|target|placeholder-shown|first-child|last-child|nth-child\([^)]*\)|before|after|placeholder|first-line|first-letter|selection|marker)/gi;
  function selBase(selText) { let b = selText.replace(PSEUDO_RE, '').trim(); return b || selText; }
  let cssDiagDone = false;
  function allRuleLists() {
    const lists = []; let blocked = 0;
    for (const sheet of document.styleSheets) { try { if (sheet.cssRules) lists.push(sheet.cssRules); } catch (e) { blocked++; } }
    try { for (const sheet of (document.adoptedStyleSheets || [])) { try { if (sheet.cssRules) lists.push(sheet.cssRules); } catch (e) {} } } catch (e) {} // CSS-in-JS / framework adopted sheets
    for (const sheet of xoSheets) { try { if (sheet.cssRules) lists.push(sheet.cssRules); } catch (e) {} } // recovered cross-origin
    if (!cssDiagDone) { cssDiagDone = true; let n = 0; lists.forEach(l => { n += l.length; }); try { rlog('event', 'css-diag', { ruleLists: lists.length, topRules: n, blocked, adopted: (document.adoptedStyleSheets || []).length, xo: xoSheets.length }); } catch (e) {} }
    return lists;
  }
  function matchedRules(el) {
    const out = []; let count = 0;
    try {
      const scan = (list) => {
        for (const rule of list) {
          if (count >= 50) return;
          // Match this rule's OWN selector FIRST. Critical: in modern Chrome every CSSStyleRule exposes an
          // (often empty) .cssRules for CSS-nesting support — that empty list is TRUTHY, so the old
          // `if (rule.cssRules) { …; continue }` skipped EVERY style rule and captured zero authored CSS.
          if (rule.selectorText) {
            for (const s1 of rule.selectorText.split(',').map(s => s.trim())) {
              if (!s1 || s1 === '*') continue; // the Tailwind preflight `*{…}` reset matches everything — pure noise
              let hit = false; try { hit = el.matches(s1); } catch (e) {}
              if (!hit) { try { const b = selBase(s1); if (b && b !== s1 && el.matches(b)) hit = true; } catch (e) {} }
              if (hit) { const decl = (rule.style && rule.style.cssText || '').slice(0, 400); if (decl) out.push((s1.length > 140 ? s1.slice(0, 140) + '…' : s1) + ' { ' + decl + ' }'); count++; break; }
            }
          }
          if (rule.cssRules && rule.cssRules.length) scan(rule.cssRules); // descend into @media/@supports/@container/@layer AND real nested rules (only when non-empty)
        }
      };
      for (const rules of allRuleLists()) { if (count >= 40) break; scan(rules); }
    } catch (e) {}
    return out.length ? out : null;
  }
  function pseudoStyles(el) {
    const out = {};
    try {
      ['::before', '::after'].forEach(pe => {
        const cs = getComputedStyle(el, pe), content = cs.content;
        if (content && content !== 'none' && content !== 'normal') {
          const o = {};
          ['content', 'background', 'background-image', 'color', 'width', 'height', 'transform', 'position', 'border-radius', 'box-shadow', 'font-size', 'inset'].forEach(p => { const v = cs.getPropertyValue(p).trim(); if (v && !DROP.has(v)) o[p] = v; });
          if (Object.keys(o).length) out[pe] = o;
        }
      });
    } catch (e) {}
    return Object.keys(out).length ? out : null;
  }
  // Properties that are virtually always at their initial value → pure noise. We capture EVERY
  // non-default computed prop (no whitelist), but drop a prop whose value equals its known default.
  // (Without this, modern Chrome leaks ~150 default longhands per element and buries the signal.)
  const NOISE = { 'animation-composition': 'replace', 'animation-iteration-count': '1', 'animation-play-state': 'running', 'animation-timing-function': 'ease', 'animation-name': 'none', 'animation-duration': '0s', 'animation-delay': '0s', 'animation-direction': 'normal', 'animation-fill-mode': 'none', 'animation-range-start': 'normal', 'animation-range-end': 'normal', 'background-attachment': 'scroll', 'background-clip': 'border-box', 'background-origin': 'padding-box', 'background-position': '0% 0%', 'background-repeat': 'repeat', 'background-size': 'auto', 'background-blend-mode': 'normal', 'border-collapse': 'separate', 'border-image-slice': '100%', 'border-image-width': '1', 'border-image-outset': '0', 'border-image-repeat': 'stretch', 'border-image-source': 'none', 'box-decoration-break': 'slice', 'box-sizing': 'border-box', 'caption-side': 'top', 'caret-color': 'rgb(0, 0, 0)', 'clip-rule': 'nonzero', 'color-interpolation': 'srgb', 'color-interpolation-filters': 'linearrgb', 'column-fill': 'balance', 'column-rule-style': 'none', 'column-rule-width': '1.5px', 'column-span': 'none', 'corner-bottom-left-shape': 'round', 'corner-bottom-right-shape': 'round', 'corner-end-end-shape': 'round', 'corner-end-start-shape': 'round', 'corner-start-end-shape': 'round', 'corner-start-start-shape': 'round', 'corner-top-left-shape': 'round', 'corner-top-right-shape': 'round', 'direction': 'ltr', 'dynamic-range-limit': 'no-limit', 'empty-cells': 'show', 'field-sizing': 'fixed', 'fill': 'rgb(0, 0, 0)', 'fill-opacity': '1', 'fill-rule': 'nonzero', 'flood-color': 'rgb(0, 0, 0)', 'flood-opacity': '1', 'grid-auto-flow': 'row', 'hyphens': 'manual', 'image-orientation': 'from-image', 'image-rendering': 'auto', 'interpolate-size': 'numeric-only', 'lighting-color': 'rgb(255, 255, 255)', 'list-style-image': 'none', 'list-style-position': 'outside', 'list-style-type': 'disc', 'mask-clip': 'border-box', 'mask-composite': 'add', 'mask-mode': 'match-source', 'mask-origin': 'border-box', 'mask-position': '0% 0%', 'mask-repeat': 'repeat', 'mask-size': 'auto', 'mask-type': 'luminance', 'object-fit': 'fill', 'object-position': '50% 50%', 'offset-distance': '0px', 'offset-path': 'none', 'offset-rotate': 'auto 0deg', 'orphans': '2', 'outline-color': 'rgb(0, 0, 0)', 'overflow-anchor': 'auto', 'overflow-clip-margin': '0px', 'paint-order': 'normal', 'pointer-events': 'auto', 'position-visibility': 'anchors-visible', 'print-color-adjust': 'economy', 'ruby-align': 'space-around', 'ruby-position': 'over', 'rule-overlap': 'row-over-column', 'scroll-behavior': 'auto', 'scroll-timeline-axis': 'block', 'speak': 'normal', 'stop-color': 'rgb(0, 0, 0)', 'stop-opacity': '1', 'stroke': 'none', 'stroke-dasharray': 'none', 'stroke-dashoffset': '0px', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4', 'stroke-opacity': '1', 'stroke-width': '1px', 'tab-size': '4', 'text-align': 'start', 'text-anchor': 'start', 'text-autospace': 'no-autospace', 'text-decoration-color': 'rgb(0, 0, 0)', 'text-decoration-line': 'none', 'text-decoration-style': 'solid', 'text-decoration-thickness': 'auto', 'text-emphasis-color': 'rgb(0, 0, 0)', 'text-emphasis-position': 'over', 'text-emphasis-style': 'none', 'text-indent': '0px', 'text-orientation': 'mixed', 'text-overflow': 'clip', 'text-rendering': 'auto', 'text-shadow': 'none', 'text-size-adjust': '100%', 'text-transform': 'none', 'text-wrap-mode': 'wrap', 'text-wrap-style': 'auto', 'transform-box': 'view-box', 'transform-style': 'flat', 'unicode-bidi': 'isolate', 'vector-effect': 'none', 'view-timeline-axis': 'block', 'white-space-collapse': 'collapse', 'widows': '2', 'word-break': 'normal', 'word-spacing': '0px', 'writing-mode': 'horizontal-tb', 'zoom': '1', '-webkit-box-orient': 'horizontal', '-webkit-text-fill-color': 'rgb(0, 0, 0)' };
  const NOISE_NAME = { 'perspective-origin': 1, 'transform-origin': 1 }; // value is size-dependent → always noise
  // value-equals-default leaks the de-noise still let through (found on the elevenlabs proof case)
  Object.assign(NOISE, { 'font-stretch': '100%', 'opacity': '1', 'vertical-align': 'baseline', 'appearance': 'auto', 'column-rule-color': 'rgb(0, 0, 0)', 'row-rule-color': 'rgb(0, 0, 0)', 'row-rule-width': '1.5px', 'row-rule-style': 'none' });
  // logical-property aliases duplicate the physical twin we already capture (width/height/padding/margin/
  // inset via top-right-bottom-left/border-radius/overflow-x-y) → pure duplication, drop the logical name.
  const LOGICAL = new Set(['block-size', 'inline-size', 'min-block-size', 'min-inline-size', 'max-block-size', 'max-inline-size', 'inset-block-start', 'inset-block-end', 'inset-inline-start', 'inset-inline-end', 'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end', 'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end', 'border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius', 'overflow-block', 'overflow-inline', 'contain-intrinsic-block-size', 'contain-intrinsic-inline-size', 'border-block-start-color', 'border-block-end-color', 'border-inline-start-color', 'border-inline-end-color', 'border-block-start-style', 'border-block-end-style', 'border-inline-start-style', 'border-inline-end-style', 'border-block-start-width', 'border-block-end-width', 'border-inline-start-width', 'border-inline-end-width']);
  const PFX_OK = { '-webkit-text-fill-color': 1, '-webkit-text-stroke': 1, '-webkit-mask-image': 1, '-webkit-mask': 1, '-webkit-background-clip': 1, '-webkit-line-clamp': 1, '-webkit-box-orient': 1, '-webkit-backdrop-filter': 1 };
  function extract(el) {
    const cs = getComputedStyle(el), computed = {};
    try {
      for (let i = 0; i < cs.length; i++) { const p = cs.item(i); if (NOISE_NAME[p] || LOGICAL.has(p)) continue; if (p.charCodeAt(0) === 45 && !PFX_OK[p]) continue; const v = cs.getPropertyValue(p).trim(); if (!v || DROP.has(v) || NOISE[p] === v) continue; computed[p] = v; }
      // Tailwind/Preflight sets border-style:solid + a default color on everything at 0 width → drop a side's style+color when that side has no width.
      ['top', 'right', 'bottom', 'left'].forEach(s => { if (!computed['border-' + s + '-width']) { delete computed['border-' + s + '-style']; delete computed['border-' + s + '-color']; } });
      // context-dependent defaults the value-map can't catch (need the live computed style to judge):
      const disp = cs.display || '';
      if (!/flex|grid/.test(disp)) { ['flex-direction', 'flex-shrink', 'flex-grow', 'flex-basis', 'flex-wrap'].forEach(p => delete computed[p]); } // flex props are inert off a flex/grid container
      else { if (computed['flex-direction'] === 'row') delete computed['flex-direction']; if (computed['flex-shrink'] === '1') delete computed['flex-shrink']; if (computed['flex-grow'] === '0') delete computed['flex-grow']; if (computed['flex-basis'] === 'auto') delete computed['flex-basis']; if (computed['flex-wrap'] === 'nowrap') delete computed['flex-wrap']; }
      if (!cs.outlineStyle || cs.outlineStyle === 'none') { ['outline-width', 'outline-offset', 'outline-color'].forEach(p => delete computed[p]); } // outline width/offset/colour are inert with no outline-style
      if ((cs.transitionProperty === 'all' || !cs.transitionProperty) && (!cs.transitionDuration || cs.transitionDuration === '0s')) { Object.keys(computed).forEach(p => { if (p.indexOf('transition-') === 0) delete computed[p]; }); } // the no-op default transition
      if (!cs.animationName || cs.animationName === 'none') { Object.keys(computed).forEach(p => { if (p.indexOf('animation-') === 0) delete computed[p]; }); } // animation-* with no animation-name is inert
    } catch (e) { KEEP.forEach(p => { const v = cs.getPropertyValue(p).trim(); if (v && !DROP.has(v)) computed[p] = v; }); }
    const r = el.getBoundingClientRect();
    let anims = [];
    try {
      anims = (el.getAnimations() || []).map(a => {
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
        let kf = []; try { kf = a.effect.getKeyframes().map(k => { const o = {}; for (const key in k) if (!['composite','computedOffset','easing'].includes(key)) o[key] = k[key]; return o; }); } catch (e) {}
        return { name: a.animationName || a.transitionProperty || '(WAAPI)', duration: t.duration, easing: t.easing, delay: t.delay, iterations: t.iterations, keyframes: kf.slice(0, 6) };
      });
    } catch (e) {}
    const pos = cs.position, sticky = pos === 'fixed' || pos === 'sticky';
    const attrs = {}; for (const a of el.attributes || []) if (a.name !== 'style' && a.name !== 'class') attrs[a.name] = a.value;
    const react = fwProps(el);
    return { selector: sel(el), tag: el.tagName.toLowerCase(), sticky, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, computed, cssRules: matchedRules(el), pseudo: pseudoStyles(el), animations: anims, attributes: attrs, react, a11y: a11y(el), asset: assetOf(el, cs), html: htmlSnippet(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) };
  }
  function meaningful(el) {
    if (!el || el.nodeType !== 1 || host.contains(el)) return false;
    if (el.tagName === 'HTML' || el.tagName === 'BODY') return false;
    const r = el.getBoundingClientRect();
    if (r.width > innerWidth * 0.92 && r.height > innerHeight * 0.85) return false;
    return r.width > 4 && r.height > 4;
  }
  function topAt(x, y) { const stack = document.elementsFromPoint(x, y) || []; return stack.find(meaningful) || null; }
  // gaze candidates: cluster the recent trail (resolved to where its elements are NOW)
  function gazeElements() {
    const cache = new Map(), grid = new Map();
    for (const p of pts.slice(-500)) {
      if (!p.el || !p.el.isConnected) continue;
      let r = cache.get(p.el); if (!r) { r = p.el.getBoundingClientRect(); cache.set(p.el, r); }
      const x = r.left + p.ox, y = r.top + p.oy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const k = Math.round(x / 40) + '_' + Math.round(y / 40);
      grid.set(k, (grid.get(k) || 0) + 1);
    }
    const cells = [...grid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const out = [], seen = new Set();
    for (const [k] of cells) { const [gx, gy] = k.split('_').map(Number); const el = topAt(gx * 40, gy * 40); if (el && !seen.has(el)) { seen.add(el); out.push(el); } }
    return out;
  }

  // ---------- stream loose engagements + dynamic facts to the timeline ----------
  async function recordEngage(el, kind, extra) {
    if (!recording || !meaningful(el)) return;
    if (!currentEls.includes(el)) currentEls.push(el);
    const t = now();
    const light = (kind === 'look' || kind === 'gaze') && reported.has(el);
    if (!light) await ensureXOSheets(); // make cross-origin authored CSS available before extract() walks it
    const facts = light ? { selector: sel(el) } : extract(el);
    if (!light) {
      reported.add(el);
      // pull the framework facts from the page world: component · props · state · source · listeners
      const fw = await requestMainFacts(el);
      if (fw) { if (fw.props) facts.react = fw.props; if (fw.component) facts.component = fw.component; if (fw.state) facts.state = fw.state; if (fw.source) facts.source = fw.source; if (fw.listeners) facts.listeners = fw.listeners; }
      if (el.tagName === 'CANVAS') { try { const gl = await requestGL(el); if (gl) facts.gl = gl; } catch (e) {} }
      else if (el.querySelector) { try { const cv = el.querySelector('canvas'); if (cv) { const gl = await requestGL(cv); if (gl) facts.gl = gl; } } catch (e) {} } // grab a canvas the cursor sat ON TOP of (overlay) — the effect, not just the wrapper
    }
    const e = { page: PAGE, kind, t, dwellMs: (extra && extra.dwellMs) || 0, value: extra && extra.value, facts };
    localTL.push(e); if (localTL.length > 320) localTL.shift();
    send(Object.assign({ type: 'engage' }, e));
  }
  function onClick(e) { if (!recording || host.contains(e.target)) return; needsPaint = true; shotDirty = true; recordEngage(e.target, 'click', {}); send({ type: 'event', ev: { k: 'click', t: now(), s: selShort(e.target) } }); setTimeout(() => maybeGrab(true), 280); } // a click changes the view (nav/panel/state) — grab the settled result
  function onInput(e) { const el = e.target; if (!recording || host.contains(el) || !('value' in el)) return; const v = el.type === 'password' ? '•••' : (el.value || '').slice(0, 60); recordEngage(el, 'type', { value: v }); send({ type: 'event', ev: { k: 'type', t: now(), s: selShort(el) } }); }
  function onFocus(e) { if (!recording || host.contains(e.target)) return; recordEngage(e.target, 'focus', {}); }
  function onScroll() { if (!recording) return; needsPaint = true; shotDirty = true; clearTimeout(scTimer); scTimer = setTimeout(() => { const y = Math.round(window.scrollY || 0); if (Math.abs(y - scYsent) > 60) { scYsent = y; send({ type: 'event', ev: { k: 'scroll', t: now(), y } }); maybeGrab(); } }, 500); } // grab on scroll-settle (the reveal the user scrolled to)
  function onNet(e) {
    if (!recording || e.source !== window || !e.data || !e.data.__disdat_net) return;
    const n = e.data.__disdat_net, ev = Object.assign({ page: PAGE, t: now() }, n); // carry the FULL exchange: kind/reqHeaders/reqBody/resHeaders/contentType/frame/dir/event/lastEventId/shape/body
    localNet.push(ev); if (localNet.length > 300) localNet.shift();
    send({ type: 'net', ev });
  }
  function startMO() {
    try {
      mo = new MutationObserver(muts => {
        if (!recording) return;
        const tn = performance.now(); if (tn - lastMutT < 200) return; lastMutT = tn;
        let summ = '';
        for (const m of muts) {
          const tgt = m.target, s = tgt && tgt.nodeType === 1 ? sel(tgt, true) : (tgt && tgt.parentElement ? sel(tgt.parentElement, true) : '');
          if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) { summ = (m.addedNodes.length ? '+' + m.addedNodes.length : '') + (m.removedNodes.length ? ' -' + m.removedNodes.length : '') + ' nodes @ ' + s; break; }
          if (m.type === 'attributes') { summ = m.attributeName + ' changed @ ' + s; break; }
        }
        if (!summ) return;
        needsPaint = true; // page changed → re-anchor the trail (cheap, ≤5fps via the 200ms throttle); deliberately NOT shotDirty, so page self-animation alone never triggers a screenshot flash
        const ev = { page: PAGE, t: now(), summary: summ };
        localMut.push(ev); if (localMut.length > 160) localMut.shift();
        send({ type: 'mut', ev });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'disabled', 'hidden', 'data-state'] });
    } catch (e) {}
  }
  // ---------- render trace: layout-shift (CLS + the nodes that moved) + long-animation-
  // frame (jank, with script attribution) — the cheap "feels slow / it jumps" cause. Each
  // entry's clock is mapped onto the session-second scale so it lines up with the transcript.
  function startPerf() {
    try {
      perfPO = new PerformanceObserver(list => {
        if (!recording) return;
        for (const en of list.getEntries()) {
          const ts = (performance.timeOrigin + en.startTime - sessionT0) / 1000;
          if (ts < -0.2) continue; // skip pre-record (page-load) entries
          let ev = null;
          if (en.entryType === 'layout-shift') {
            if (en.hadRecentInput) continue; clsTotal += en.value;
            const nodes = (en.sources || []).map(s => (s.node && s.node.nodeType === 1) ? sel(s.node, true) : '').filter(Boolean).slice(0, 3);
            ev = { page: PAGE, kind: 'shift', t: +Math.max(0, ts).toFixed(1), value: +en.value.toFixed(3), cls: +clsTotal.toFixed(3), nodes };
          } else if (en.entryType === 'long-animation-frame') {
            if (en.duration < 60) continue;
            const scripts = (en.scripts || []).map(s => ((s.invokerType || '') + ' ' + (s.name || s.invoker || '')).trim()).filter(Boolean).slice(0, 2);
            ev = { page: PAGE, kind: 'loaf', t: +Math.max(0, ts).toFixed(1), dur: Math.round(en.duration), scripts };
          }
          if (ev) { localRender.push(ev); if (localRender.length > 120) localRender.shift(); send({ type: 'render', ev }); }
        }
      });
      try { perfPO.observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
      try { perfPO.observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
    } catch (e) {}
  }
  function stopPerf() { try { perfPO && perfPO.disconnect(); } catch (e) {} perfPO = null; }
  function onTick() {
    if (!recording) return;
    if (location.href !== lastHref) { if (lastHref) { send({ type: 'event', ev: { k: 'nav', t: now(), url: location.href } }); pts.length = 0; try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (e) {} needsPaint = true; shotDirty = true; } lastHref = location.href; } // soft-nav incl. Google-Slides hash flips — reset the trail, the old slide's scribbles don't belong on the new one // soft-nav (SPA pushState) — content can't hook the page's history, so poll the URL each tick
    if (pts.length) pts = pts.filter(p => p.el && p.el.isConnected); // drop points whose element is gone — trail cleanly loses what broke
    if (hoverEl && (performance.now() - hoverStart) >= 700 && !reported.has(hoverEl)) recordEngage(hoverEl, 'look', { dwellMs: Math.round(performance.now() - hoverStart) });
  }
  function attachSensors() {
    addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onFocus, true);
    addEventListener('scroll', onScroll, true);
    startMO(); startPerf(); tick = setInterval(onTick, 400);
  }
  function detachSensors() {
    removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusin', onFocus, true);
    removeEventListener('scroll', onScroll, true);
    try { mo && mo.disconnect(); } catch (e) {} stopPerf(); clearInterval(tick);
  }

  // ---------- the crunch engine (per-remark windowing → note → reconcile) ----------
  const REMARK_SYS = "You are Dis Dat. You get ONE thing the user said while reacting to a live web page, plus loose, time-stamped hints about what was under their cursor / what they did / what changed around that moment, each with real facts. These hints are WEAK — the cursor is not intent, and the element under it is usually NOT what they mean.\n\nTurn the remark into ONE short note for the user's next prompt to a coding agent. Rules in priority order:\n1. FAITHFUL above all. State only what they actually said. NEVER invent a reaction to an element they didn't name — e.g. do NOT claim they liked a 'Travel' or 'Culture' button, or any nav/label, just because it was captured. NEVER pull in page text (article titles, menu names, copy) unless they actually talked about that text. Inventing is the worst failure.\n2. GROUND ONLY WHEN CLEAR. If their words clearly point at a specific thing ('this button', 'the bounce', 'this card'), name its selector + the real values (sizes, colors, animation timing/easing, the data/response). If the remark is general ('this page is cool', 'nice grid', 'the bottom bit feels quick'), KEEP IT GENERAL — do not attach a selector you happened to capture. Under-grounding beats wrong-grounding.\n3. CLASSIFY: tag the kind in brackets — [likes] [dislikes] [wants changed] [inspiration] [observation] [next-step] [question].\n4. DON'T PRESCRIBE a fix or implementation; only clarify what they referred to and what they felt.\nOutput EXACTLY one bullet. No preamble, no prose summary, no markdown headers.";
  const RECONCILE_SYS = "You are Dis Dat. Here are draft notes from a user's spoken reaction to a live page (maybe several pages), each already classified + grounded. Produce the final context the user pastes in front of their next instruction to a coding agent.\n- Keep it as bracketed-kind BULLETS — never a prose paragraph or narrative summary.\n- Preserve every distinct point, its [kind] tag, and their own wording. De-duplicate. Order sensibly.\n- FUSE notes that are really ONE overarching point made across several places (e.g. 'all of these feel cramped' while roving multiple elements) into a single note over the set.\n- NEVER invent, NEVER add reactions to things they didn't mention, NEVER weave in page text they didn't talk about, NEVER prescribe a fix.\nPlain text bullets, no preamble, no headers.";

  function addUsage(u) { if (u) { usage.in += u.in || 0; usage.out += u.out || 0; usage.calls++; } }
  function cf(e) { return { selector: e.selector, role: e.a11y, text: e.text, sticky: e.sticky, computed: e.computed, animations: e.animations, component: e.component, props: e.react, state: e.state, source: e.source, listeners: e.listeners, asset: e.asset }; }
  function windowItems(t0, t1, engs, nets, muts, useCloud) {
    const lo = t0 - 2, hi = t1 + 1;
    const inWin = (engs || []).filter(e => e.t >= lo && e.t <= hi);
    const pool = inWin.length ? inWin : (engs || []);
    const map = new Map();
    for (const e of pool) {
      const s = (e.facts && e.facts.selector) || ''; let m = map.get(s);
      if (!m) { m = Object.assign({ kinds: {}, firstT: e.t, lastT: e.t, dwellMs: 0 }, e.facts); map.set(s, m); }
      m.kinds[e.kind] = (m.kinds[e.kind] || 0) + 1;
      if (e.value) m.lastValue = e.value; if (e.dwellMs) m.dwellMs += e.dwellMs;
      if (e.facts && e.facts.computed && Object.keys(e.facts.computed).length) { const f = e.facts; m.computed = f.computed; m.animations = f.animations; m.react = f.react; m.text = f.text; if (f.component) m.component = f.component; if (f.state) m.state = f.state; if (f.source) m.source = f.source; if (f.a11y) m.a11y = f.a11y; if (f.asset) m.asset = f.asset; if (f.listeners) m.listeners = f.listeners; }
      m.firstT = Math.min(m.firstT, e.t); m.lastT = Math.max(m.lastT, e.t);
    }
    let elements = [...map.values()], trimmed = 0;
    const capN = useCloud ? 12 : 5;
    if (elements.length > capN) { const score = m => (m.dwellMs || 0) + (m.kinds.click ? 800 : 0) + (m.kinds.type ? 1200 : 0) + (m.kinds.focus ? 300 : 0); elements.sort((a, b) => score(b) - score(a)); trimmed = elements.length - capN; elements = elements.slice(0, capN); }
    const net = (nets || []).filter(n => n.t >= lo && n.t <= hi).slice(-(useCloud ? 6 : 3));
    const mut = (muts || []).filter(m => m.t >= lo && m.t <= hi).slice(-(useCloud ? 8 : 4));
    return { elements, net, mut, trimmed };
  }
  function buildRemarkInput(remark, items) {
    let s = 'THE REMARK (said @' + (remark.t0 || 0).toFixed(1) + '–' + (remark.t1 || 0).toFixed(1) + 's): "' + remark.text + '"\n\nLOOSE ATTENTION AROUND THAT MOMENT (hints, NOT commands):\n';
    s += items.elements.map((e, i) => {
      const kinds = Object.keys(e.kinds || {}).join('+') || 'seen';
      const when = '@' + (e.firstT || 0).toFixed(1) + '–' + (e.lastT || 0).toFixed(1) + 's';
      const typed = e.lastValue ? (' typed:"' + e.lastValue + '"') : '';
      return '[' + (i + 1) + '] ' + e.selector + ' (' + kinds + ' ' + when + typed + ')\n' + JSON.stringify(cf(e));
    }).join('\n\n');
    if (items.net.length) s += '\n\nRESPONSES / DATA IN-WINDOW:\n' + items.net.map(n => n.method + ' ' + shortUrl(n.url) + ' [' + n.status + '] ' + (n.body || '').slice(0, 320)).join('\n');
    if (items.mut.length) s += '\n\nDOM CHANGES IN-WINDOW: ' + items.mut.map(m => m.summary).join('; ');
    if (items.trimmed) s += '\n\n(note: ' + items.trimmed + ' less-engaged elements omitted for length — not exhaustive.)';
    return s;
  }
  async function nanoCrunch(sys, input, ms) {
    try {
      const LM = self.LanguageModel || (self.ai && self.ai.languageModel);
      if (!LM) return null;
      if (input.length > 6000) input = input.slice(0, 6000) + '\n…(truncated for the on-device context limit)';
      const opts = { initialPrompts: [{ role: 'system', content: sys }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
      let ses; try { ses = await LM.create(opts); } catch (e) { try { ses = await LM.create({ systemPrompt: sys }); } catch (_) { try { ses = await LM.create(); } catch (__) { return null; } } }
      const ctrl = new AbortController();
      const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms || 10000);
      try {
        const o = await ses.prompt(input, { signal: ctrl.signal });
        clearTimeout(to); try { ses.destroy(); } catch (e) {}
        const out = (o || '').trim();
        if (out) { nanoFails = 0; return out; }
        nanoFails++; return null;
      } catch (e) { clearTimeout(to); nanoFails++; try { ses.destroy(); } catch (_) {} return null; }
    } catch (e) { nanoFails++; return null; }
  }
  // bundled on-device crunch via the offscreen WebLLM engine (no key, no cloud, no Chrome AI)
  async function localCrunch(sys, input, maxTokens) {
    if (!LOCAL_LLM) return null;
    const r = await send({ type: 'localllm', sys, input, maxTokens: maxTokens || 800 });
    if (r && r.text) return r.text;
    if (r && r.error) DBG.push({ kind: 'localllm-error', err: r.error });
    return null;
  }
  async function crunchRemark(remark, src) {
    const items = windowItems(remark.t0, remark.t1, src.engagements, src.net, src.mut, !nanoUsable());
    const input = buildRemarkInput(remark, items);
    let out = null, err = '';
    if (LOCAL_LLM) { const o = await localCrunch(REMARK_SYS, input, 500); if (o) out = { text: o, via: 'on-device · local model', t0: remark.t0, t1: remark.t1 }; }
    if (!out) { const r = await send({ type: 'llm', sys: REMARK_SYS, input, maxTokens: 500 }); if (r && r.text) { addUsage(r.usage); out = { text: r.text, via: r.via || 'cloud', t0: remark.t0, t1: remark.t1 }; } else if (r && r.error) err = r.error + (r.detail ? ': ' + r.detail : ''); }
    if (!out) { const ref = items.elements[0] ? ('re: ' + items.elements[0].selector) : '(no clear referent)'; out = { text: '[observation] "' + remark.text + '" — ' + ref, via: 'facts', t0: remark.t0, t1: remark.t1 }; }
    DBG.push({ kind: 'remark', remark: remark.text, input: input.slice(0, 4500), output: out.text, via: out.via, err: err || undefined });
    return out;
  }
  function segment(words) {
    if (!words || !words.length) return null;
    const rem = []; let cur = [], t0 = words[0].t, prev = words[0].t;
    for (const w of words) { if (w.t - prev > 0.85 && cur.length) { rem.push({ t0, t1: prev, text: cur.join(' ') }); cur = []; t0 = w.t; } cur.push(w.w); prev = w.t; }
    if (cur.length) rem.push({ t0, t1: prev, text: cur.join(' ') });
    return rem;
  }
  function splitPlain(text) { const p = (text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean); return p.length ? p.map(x => ({ t0: 0, t1: 9e9, text: x })) : null; }
  async function reconcile(notes, session) {
    notes = (notes || []).filter(n => n && n.text);
    if (!notes.length) return { text: facts(session), via: 'facts only' };
    if (notes.length === 1) return { text: notes[0].text, via: notes[0].via };
    const input = 'PAGES: ' + (session.pages || []).map(shortUrl).join(' → ') + '\n\nDRAFT NOTES (time order):\n' + notes.map((n, i) => (i + 1) + '. ' + n.text).join('\n');
    let res = null, err = '';
    if (LOCAL_LLM) { const o = await localCrunch(RECONCILE_SYS, input, 900); if (o) res = { text: o, via: 'on-device · local model' }; }
    if (!res) { const r = await send({ type: 'llm', sys: RECONCILE_SYS, input, maxTokens: 900 }); if (r && r.text) { addUsage(r.usage); res = { text: r.text, via: r.via || 'cloud' }; } else if (r && r.error) err = r.error + (r.detail ? ': ' + r.detail : ''); }
    if (!res) res = { text: notes.map(n => '• ' + n.text).join('\n'), via: notes[0].via || 'notes' };
    DBG.push({ kind: 'reconcile', input: input.slice(0, 4500), output: res.text, via: res.via, err: err || undefined });
    return res;
  }
  // live note-taker: a remark just closed → crunch it now on-device (free) and bank
  // it. Nano-only (never fires cloud calls mid-recording); if Nano isn't usable, the
  // at-Stop crunch handles it instead.
  function fireLiveNote(remark) {
    if (!nanoUsable() || !remark.text) return;
    const items = windowItems(remark.t0, remark.t1, localTL, localNet, localMut, false);
    nanoCrunch(REMARK_SYS, buildRemarkInput(remark, items), 9000).then(o => {
      if (o) send({ type: 'note', note: { page: PAGE, text: o, via: 'gemini nano', t0: remark.t0, t1: remark.t1 } });
    });
  }
  // ---------- whole-session crunch → faithful technical PROSE (default, cloud) ----------
  const WHOLE_SYS = "You are Dis Dat. The user talked out loud while reacting to a live web page (sometimes several). You get the FULL transcript of what they said, plus loose hints about what was under their cursor / what they touched / what changed, each with REAL facts (selector, computed styles, animation timing/easing, framework props, data/responses). The cursor hints are WEAK — most captured elements are irrelevant, and the element under the cursor is usually NOT what they mean.\n\nWrite a short, flowing PROSE briefing — in the user's voice — that they'll paste in front of their next instruction to a coding agent. Weave the technical GROUND TRUTH into the prose: when they react to something specific, name it precisely (selector + page) and cite the real values, and where it genuinely helps add a careful 'probably because…' that ties the feeling to a concrete cause you can SEE in the facts (e.g. \"the hero feels flat — probably because the h1 is 88px but a muted rgb(32,34,36) and has no animation\").\n\nWhat the facts may contain, and how to use each: a source pointer (file:line) + component name + props/state → cite them so the agent jumps straight to the right code; a network call (endpoint + response shape + status + timing) and any console errors → cite these for behaviour / data / 'it's broken' feedback; computed styles, fonts, assets and animation timing → cite these for how it looks; the a11y role/name → use to name the thing precisely. Mark what you read directly from the runtime as CERTAIN; mark any cause you're inferring as an explicit 'probably because…'. The ENVIRONMENT line (viewport, color-scheme, device) is there so 'it looks broken' can be tied to the conditions it broke under — use it only when relevant.\n\nHard rules:\n- FAITHFUL. Only what they actually said. NEVER invent reactions to elements they didn't mention (do NOT say they liked a 'Travel' or 'Culture' button just because it was captured). NEVER pull in page text/titles/labels they didn't talk about. If a remark is general ('this page is cool'), keep it general — don't force it onto a captured element. The only speculation allowed is an explicit, fact-grounded 'probably because', never invented intent.\n- Don't prescribe the fix or how to build it — clarify what they referred to and what they felt; their agent decides the how.\n- OPEN with the page URL — state exactly which page/site this is (and which page each point refers to if several) so the agent knows where it is and can check whether it's its own codebase.\n- Plain flowing prose: a few sentences (or a couple of short paragraphs if they covered several things). NO bullet list, NO headers, NO preamble — just the briefing.\n\nIMPORTANT: a verbatim GROUND TRUTH appendix (exact selectors, computed styles, animation keyframes, framework props/state, source pointers, asset URLs, HTML) is attached AFTER your briefing. Do NOT restate those raw values — refer to each thing by its selector and let the agent read the exact bytes below. Close with one line: 'Exact values, markup and assets are in the GROUND TRUTH block below — act on those.'";
  function envLine(ctx) {
    if (!ctx || !Object.keys(ctx).length) return '';
    const bits = [ctx.viewport && ('viewport ' + ctx.viewport), ctx.dpr && ctx.dpr !== 1 ? ('@' + ctx.dpr + 'x') : '', ctx.colorScheme, ctx.reducedMotion ? 'reduced-motion' : '', ctx.connection, ctx.platform, ctx.lang, ctx.tz, (ctx.fonts && ctx.fonts.length ? 'fonts: ' + ctx.fonts.join(', ') : '')].filter(Boolean);
    return bits.length ? 'ENVIRONMENT: ' + bits.join(' · ') + '\n' : '';
  }
  function buildWholeInput(session, els) {
    const pages = (session.pages && session.pages.length) ? session.pages : [PAGE];
    // Always lead with the FULL url(s) — the agent needs to know exactly which page this
    // is (to act, and to check whether it's its own codebase). Full href, not just path.
    let s = (pages.length > 1 ? 'PAGES (in the order visited): ' + pages.join('  →  ') : 'PAGE: ' + pages[0]) + '\n';
    s += envLine(sessionCtx);
    s += '\nWHAT THEY SAID' + (session.transcript ? ':\n"' + session.transcript + '"' : ': (nothing transcribed)');
    s += '\n\nWHAT WAS UNDER THEIR CURSOR / THEY TOUCHED (loose hints, NOT intent — most are irrelevant):\n' +
      els.map((e, i) => '[' + (i + 1) + '] ' + e.selector + ' (' + (Object.keys(e.kinds || {}).join('+') || 'seen') + ')\n' + JSON.stringify({ selector: e.selector, role: e.a11y, text: e.text, component: e.component, props: e.react, state: e.state, source: e.source, listeners: e.listeners, computed: e.computed, animations: e.animations, asset: e.asset })).join('\n\n');
    if (session.net && session.net.length) s += '\n\nNETWORK / API (the exact observed contract — req → res, streaming frames, WS/SSE):\n' + session.net.slice(0, 24).map(fmtNet).join('\n');
    if (session.console && session.console.length) s += '\n\nCONSOLE (errors/warnings during the session — runtime truth the code alone doesn\'t show):\n' + session.console.slice(-8).map(c => '@' + c.t + 's [' + c.level + '] ' + c.msg).join('\n');
    if (session.render && session.render.length) s += '\n\nRENDER / JANK: ' + session.render.slice(-8).map(r => r.kind === 'shift' ? ('layout-shift ' + r.value + ' (CLS ' + r.cls + ') @' + r.t + 's' + (r.nodes && r.nodes.length ? ' on ' + r.nodes.join(',') : '')) : ('long frame ' + r.dur + 'ms @' + r.t + 's' + (r.scripts && r.scripts.length ? ' — ' + r.scripts.join(' / ') : ''))).join('; ');
    if (session.events && session.events.length) s += '\n\nINTERACTIONS: ' + session.events.map(ev => '@' + ev.t + 's ' + ev.k + (ev.s ? ' ' + ev.s : '') + (ev.url ? ' → ' + shortUrl(ev.url) : '')).join('; ');
    if (session.trims) s += '\n\n' + session.trims;
    return s;
  }
  async function crunchWhole(session) {
    if (selectedRuntimeMode === 'local') {
      const request = globalThis.DisdatLocalBriefing.build(session, dedupeAll(session.engagements || []), PAGE);
      if (!request) return {text: facts(session), via: 'facts only'};
      const {sys, input, maxTokens} = request;
      const result = await send({type: 'llm', sys, input, maxTokens});
      DBG.push({kind: 'local-whole', input: request.input, output: result?.text || '', err: result?.error});
      return result?.text ? {text: globalThis.DisdatLocalBriefing.format(request, result.text), via: result.via || 'on-device · local model'}
        : {text: facts(session), via: 'facts only', error: result?.error || 'local-briefing-unavailable'};
    }
    const els = dedupeAll(session.engagements || []).slice(0, 16);
    const input = buildWholeInput(session, els);
    let res = null, err = '';
    if (LOCAL_LLM) { const o = await localCrunch(WHOLE_SYS, input, 1100); if (o) res = { text: o, via: 'on-device · local model' }; }
    if (!res) { const r = await send({ type: 'llm', sys: WHOLE_SYS, input, maxTokens: 1100 }); if (r && r.text) { addUsage(r.usage); res = { text: r.text, via: r.via || 'cloud' }; } else if (r && r.error) err = r.error + (r.detail ? ': ' + r.detail : ''); }
    if (!res) res = { text: facts(session), via: 'facts only' };
    DBG.push({ kind: 'whole', input: input.slice(0, 6000), output: res.text, via: res.via, err: err || undefined });
    return res;
  }
  async function finalizeSession(session) {
    if (selectedRuntimeMode === 'local') return crunchWhole(session);
    const notes = (session.notes || []).slice();
    if (notes.length) return reconcile(notes, session); // live on-device notes (Nano path)
    return crunchWhole(session);                          // default: one cloud pass → prose
  }

  // ---------- display ----------
  function dedupeAll(engs) {
    const m = new Map();
    for (const e of (engs || [])) { const s = (e.facts && e.facts.selector) || ''; let x = m.get(s); if (!x) { x = Object.assign({ kinds: {} }, e.facts); m.set(s, x); } x.kinds[e.kind] = (x.kinds[e.kind] || 0) + 1; if (e.facts && e.facts.computed && Object.keys(e.facts.computed).length) { const f = e.facts; x.computed = f.computed; x.animations = f.animations; if (f.react) x.react = f.react; if (f.component) x.component = f.component; if (f.state) x.state = f.state; if (f.source) x.source = f.source; if (f.a11y) x.a11y = f.a11y; if (f.asset) x.asset = f.asset; if (f.listeners) x.listeners = f.listeners; if (f.html) x.html = f.html; if (f.attributes) x.attributes = f.attributes; if (f.rect) x.rect = f.rect; if (f.text) x.text = f.text; if (f.sticky != null) x.sticky = f.sticky; if (f.cssRules) x.cssRules = f.cssRules; if (f.pseudo) x.pseudo = f.pseudo; if (f.gl) x.gl = f.gl; } }
    // De-dupe identical WebGL captures: nested elements (orb wrapper / inner / card) all resolve to
    // the SAME canvas, so the full 10-program shader set + texture + frame was embedded 2–3× — the main
    // bundle bloat (and a memory/crash driver on heavy pages). Keep the first full capture; slim repeats
    // to a reference so the shaders/textures appear exactly once.
    const arr = [...m.values()], seenGL = new Map();
    for (const el of arr) {
      const g = el.gl; if (!g || !(g.programs && g.programs.length)) continue;
      const p0 = g.programs[0] || {}, dim = g.glState ? (g.glState.drawingBufferW + 'x' + g.glState.drawingBufferH) : (el.rect ? el.rect.w + 'x' + el.rect.h : '');
      const fp = g.programs.length + ':' + ((p0.fragment || '').length) + ':' + dim;
      const first = seenGL.get(fp);
      if (first) el.gl = { sameAs: first, programs: g.programs.length }; else seenGL.set(fp, el.selector);
    }
    return arr;
  }
  // ---------- GROUND TRUTH: the verbatim capture, handed to the agent so it never needs to
  // render the site itself. Everything extract() captured (and used to drop to prose) goes here. ----------
  function gtVal(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return String(v); } }
  function elementGroundTruth(w, i) {
    let s = '[' + (i + 1) + '] ' + (w.selector || '?');
    if (w.a11y) { const a = [w.a11y.role, w.a11y.name && ('"' + w.a11y.name + '"')].filter(Boolean).join(' '); if (a) s += '  ·  ' + a; }
    if (w.component) s += '  ·  <' + w.component + '>';
    if (w.source) s += '  ·  ' + w.source;
    s += '\n';
    if (w.rect) s += '    rect ' + w.rect.w + '×' + w.rect.h + ' @ (' + w.rect.x + ',' + w.rect.y + ')' + (w.sticky ? ' [sticky]' : '') + '\n';
    const ck = Object.keys(w.computed || {});
    if (ck.length) s += '    computed: { ' + ck.map(k => k + ': ' + w.computed[k]).join('; ') + ' }\n';
    if (w.cssRules && w.cssRules.length) s += '    authored CSS (incl :hover/:focus/pseudo states, verbatim — var() intent intact):\n' + w.cssRules.map(r => '      ' + r).join('\n') + '\n';
    if (w.pseudo) s += '    pseudo-elements: ' + gtVal(w.pseudo).slice(0, 500) + '\n';
    (w.animations || []).forEach(a => { s += '    animation: ' + a.name + ' ' + (Math.round(a.duration) || a.duration) + 'ms ' + (a.easing || '') + (a.iterations === Infinity || a.iterations == null ? '' : ' ×' + a.iterations) + (a.keyframes && a.keyframes.length ? '  keyframes: ' + a.keyframes.map(gtVal).join(' → ').slice(0, 320) : '') + '\n'; });
    if (w.react) s += '    props: ' + gtVal(w.react) + '\n';
    if (w.state) s += '    state: ' + gtVal(w.state) + '\n';
    if (w.listeners && w.listeners.length) s += '    listeners: ' + w.listeners.join(', ') + '\n';
    if (w.asset) s += '    asset: ' + gtVal(w.asset).slice(0, 600) + '\n';
    if (w.text) s += '    text: "' + w.text + '"\n';
    if (w.attributes && Object.keys(w.attributes).length) s += '    attrs: ' + gtVal(w.attributes).slice(0, 300) + '\n';
    if (w.html) s += '    html: ' + w.html.replace(/\s+/g, ' ').slice(0, 700) + '\n';
    if (w.gl && w.gl.sameAs) s += '    webgl: same canvas as ' + w.gl.sameAs + ' — ' + (w.gl.programs || '?') + ' programs, shaders+texture+frame shown there\n';
    else if (w.gl && ((w.gl.programs && w.gl.programs.length) || w.gl.frame || w.gl.frameTainted)) {
      const g = w.gl;
      s += '    webgl: ' + (g.type || 'canvas') + (g.programs ? ', ' + g.programs.length + ' program' + (g.programs.length === 1 ? '' : 's') : '') + (g.frame ? ', frame captured' : (g.frameTainted ? ', frame cross-origin-tainted (no pixels)' : '')) + '\n';
      (g.programs || []).slice(0, 3).forEach((p, pi) => {
        if (p.fragment) { const ln = p.fragment.split('\n'); s += '      ── program ' + pi + ' fragment shader' + (ln.length > 140 ? ' (first 140 of ' + ln.length + ' — FULL source in the capture bundle)' : '') + ' ──\n' + ln.slice(0, 140).map(l => '      ' + l).join('\n') + '\n'; }
        if (p.uniforms && p.uniforms.length) s += '      uniforms: ' + p.uniforms.slice(0, 24).map(u => u.name + '=' + gtVal(u.value)).join(', ').slice(0, 500) + '\n';
      });
      if (g.textures && g.textures.length) s += '      textures (sampler sources the look depends on — bytes in bundle' + (g.textures.some(t => t.tainted) ? '; cross-origin ones give URL to re-fetch' : '') + '): ' + g.textures.map(t => (t.kind || 'tex') + ' ' + t.w + '×' + t.h + (t.dataUrl ? ' [bytes]' : (t.url ? ' ' + t.url : ' [tainted]'))).join(', ').slice(0, 500) + '\n';
    }
    return s;
  }
  // the causal trace behind the pointer trail: every action the user took + how the page responded,
  // merged into one time-ordered log so the agent can reconstruct the FEEL, not just the static elements.
  function buildTimeline(session) {
    try {
      const items = [];
      const sec = t => (t == null ? '?' : (Math.round(t * 10) / 10) + 's');
      (session.engagements || session.timeline || []).forEach(e => {
        const s = (e.facts && e.facts.selector) || '';
        const verb = e.kind === 'click' ? 'clicked' : e.kind === 'type' ? 'typed in' : e.kind === 'focus' ? 'focused' : e.kind === 'canvas' ? 'reacted to canvas' : e.kind === 'gaze' ? 'gazed at' : 'looked at';
        items.push({ t: e.t, line: verb + ' ' + s + (e.dwellMs ? ' (' + Math.round(e.dwellMs) + 'ms)' : '') + (e.value ? ' = "' + String(e.value).slice(0, 40) + '"' : '') });
      });
      (session.events || []).forEach(ev => {
        if (ev.k === 'click') items.push({ t: ev.t, line: '▸ clicked ' + (ev.s || '') });
        else if (ev.k === 'type') items.push({ t: ev.t, line: '▸ typed in ' + (ev.s || '') });
        else if (ev.k === 'scroll') items.push({ t: ev.t, line: '▸ scrolled → y=' + ev.y });
        else if (ev.k === 'nav') items.push({ t: ev.t, line: '→ navigated to ' + ev.url });
      });
      (session.net || []).forEach(n => {
        const k = n.kind || 'fetch';
        if (k === 'ws') items.push({ t: n.t, line: 'WS ' + (n.dir === 'send' ? '↑ send' : '↓ recv') + ' ' + shortUrl(n.url) });
        else if (k === 'sse' || k === 'stream') items.push({ t: n.t, line: '⟿ stream frame ' + shortUrl(n.url) });
        else items.push({ t: n.t, line: (n.method || 'GET') + ' ' + shortUrl(n.url) + ' [' + (n.status != null ? n.status : '?') + ']' });
      });
      (session.mut || []).forEach(m => items.push({ t: m.t, line: 'DOM ' + m.summary }));
      (session.console || []).forEach(c => { if (c.level === 'error' || c.level === 'warn') items.push({ t: c.t, line: '[' + c.level + '] ' + String(c.msg).slice(0, 80) }); });
      if (!items.length) return '';
      items.sort((a, b) => (a.t || 0) - (b.t || 0));
      const lines = items.slice(0, 80).map(x => '  @' + sec(x.t) + '  ' + x.line);
      return 'INTERACTION TIMELINE (what you did + how the page responded, in order — the causal trace behind the pointer trail):\n' + lines.join('\n') + '\n';
    } catch (e) { rlog('error', 'timeline-build', { err: String(e) }); return ''; }
  }
  function buildGroundTruth(session, els) {
    try {
      const pages = (session.pages && session.pages.length) ? session.pages : [PAGE];
      let s = '═══ DIS DAT GROUND TRUTH (verbatim capture — act on these exact values, not the prose) ═══\n';
      s += 'PAGE: ' + pages.join('  →  ');
      if (sessionCtx && sessionCtx.viewport) s += '    VIEWPORT: ' + sessionCtx.viewport + (sessionCtx.dpr && sessionCtx.dpr !== 1 ? ' @' + sessionCtx.dpr + 'x' : '') + (sessionCtx.colorScheme ? ' · ' + sessionCtx.colorScheme : '');
      s += '\n\n' + (els || []).slice(0, 12).map((w, i) => elementGroundTruth(w, i)).join('\n');
      if (session.net && session.net.length) s += '\nNETWORK / API CONTRACT (observed, verbatim — req → res, stream frames, WS/SSE):\n' + session.net.slice(0, 20).map(fmtNet).join('\n') + '\n';
      if (session.console && session.console.length) s += 'CONSOLE: ' + session.console.slice(-4).map(c => '@' + c.t + 's [' + c.level + '] ' + c.msg).join(' · ').slice(0, 300) + '\n';
      if (srcInfo && srcInfo.files) s += 'JS SOURCE (the page\'s OWN render code, fetched past CORS for you and re-hosted in the bundle\'s sources{}; ' + (srcInfo.harness ? srcInfo.harness + ' of these contain the captured shader uniforms = the actual WebGL harness — ' : '') + 'grep sources{} with a shader uniform name above e.g. uFluidSimTexture to find the exact GL setup, then self-host/tweak): ' + srcInfo.files + ' file(s), ' + srcInfo.kb + ' KB' + (srcInfo.dropped ? ' (+' + srcInfo.dropped + ' over budget — keys in sources{})' : '') + '\n' + srcInfo.urls.slice(0, 12).map(u => '  ' + u).join('\n') + '\n';
      if (sessionCtx && sessionCtx.fonts && sessionCtx.fonts.length) s += 'FONTS: ' + sessionCtx.fonts.join(', ') + '\n';
      const tl = buildTimeline(session); if (tl) s += tl;
      s += '═══ END GROUND TRUTH ═══';
      return s;
    } catch (e) { rlog('error', 'groundtruth-build', { err: String(e) }); return ''; }
  }
  function facts(session) {
    const els = dedupeAll(session.engagements || []);
    return els.slice(0, 12).map((w, i) => elementGroundTruth(w, i)).join('\n') + '\nYou said: "' + (session.transcript || '') + '"';
  }
  function highlightCurrent() { sh.querySelectorAll('.hb').forEach(n => n.remove()); }
  function setStage(id, state, label) {
    const row = $('stg-' + id); if (!row) return;
    row.className = 'stg' + (state === 'run' ? ' run' : state === 'done' ? ' done' : '');
    const dot = row.querySelector('.dot'); if (dot) dot.textContent = state === 'done' ? '✓' : '';
    if (label != null) { const lb = row.querySelector('.lb2'); if (lb) lb.textContent = label; }
  }
  function showResult(session, fin, els) {
    $('stages').hidden = true; $('result').hidden = false;
    highlightCurrent();
    $('ptag').textContent = ((session.pages && session.pages.length > 1) ? session.pages.length + ' pages · ' : '') + els.length + (els.length === 1 ? ' element' : ' elements');
    $('said').textContent = session.transcript ? '“' + session.transcript + '”' : '(nothing transcribed)';
    $('via').textContent = fin.via || ''; $('pout').textContent = fin.text || '';
    const gt = buildGroundTruth(session, els); // the verbatim ground truth rides ALONG with the prose on the clipboard
    lastText = (fin.text || '') + (gt ? '\n\n' + gt : ''); window.__disdat._last = lastText;
    try { rlog('event', 'crunch-done', { via: fin.via || '', textLen: (fin.text || '').length, usage: usage }); } catch (e) {}
    let note = '';
    if (session.trims) note += 'Captured a lot — ' + session.trims + '. ';
    if (usage.calls) note += 'Sonnet 4.6: ~' + usage.in + ' in / ' + usage.out + ' out tokens (' + usage.calls + ' call' + (usage.calls > 1 ? 's' : '') + ')' + (session.audioSec ? ', ' + Math.round(session.audioSec) + 's audio' : '') + '. ';
    else if (session.audioSec) note += Math.round(session.audioSec) + 's audio transcribed. ';
    if (fin.via === 'facts only') note += 'No crunch model available — handing your agent the raw grounded facts above (they are fully self-sufficient).';
    if (fin.error === 'limit') note += 'You’re out of minutes — the full grounded capture is still below. Upgrade to Pro (500 min/mo, $7) for the written briefing too. ';
    else if (fin.error === 'signin-needed') note += 'Sign in for the written briefing. The grounded capture is below. ';
    else if (fin.error === 'setup-required') note += 'Run the local setup command to configure the briefing provider. The grounded capture is below. ';
    else if (fin.error) note += 'Briefing unavailable (' + fin.error + ') — handing your agent the grounded facts below. ';
    if (note) { $('pnote').hidden = false; $('pnote').textContent = note; } else $('pnote').hidden = true;
  }
  // heatmap diagnostics — so a single scroll-test reveals exactly why the trail
  // does/doesn't ride the page (anchor element types + how the page actually scrolls).
  function heatDiag() {
    try {
      const sample = pts.slice(-60).filter(p => p.el && p.el.isConnected);
      const anchorPos = {}, examples = [];
      for (const p of sample) {
        const pos = (getComputedStyle(p.el).position || 'static');
        anchorPos[pos] = (anchorPos[pos] || 0) + 1;
        if (examples.length < 10) examples.push({ sel: sel(p.el, true), pos, top: Math.round(p.el.getBoundingClientRect().top) });
      }
      const se = document.scrollingElement || document.documentElement;
      return {
        points: pts.length, anchorPos, examples,
        winY: Math.round(window.scrollY || 0),
        scrollingEl: se ? se.tagName.toLowerCase() : '', scrollTop: se ? Math.round(se.scrollTop) : 0,
        bodyRectTop: Math.round(document.body.getBoundingClientRect().top),
        docScrollH: document.documentElement.scrollHeight, innerH: innerHeight
      };
    } catch (e) { return { error: String(e) }; }
  }
  // ship the whole capture to Supabase (disdat_debug) so the build owner can review
  // exactly what was captured + what the model saw + what it produced — no copy-paste.
  function sendDebug(session, fin, els) {
    try {
      const payload = {
        when: new Date().toISOString(), page: PAGE, ua: navigator.userAgent,
        transcript: session.transcript || '', pages: session.pages || [], audioSec: session.audioSec || 0,
        context: sessionCtx || pageContext(),
        elements: (els || []).slice(0, 24).map(e => ({ selector: e.selector, a11y: e.a11y, kinds: e.kinds, text: e.text, computed: e.computed, animations: e.animations, react: e.react, component: e.component, state: e.state, source: e.source, listeners: e.listeners, asset: e.asset })),
        events: session.events || [], netCount: (session.net || []).length, netSample: (session.net || []).slice(0, 8), mutCount: (session.mut || []).length,
        consoleCount: (session.console || localConsole || []).length, consoleSample: (session.console || localConsole || []).slice(-12),
        renderCount: (session.render || localRender || []).length, renderSample: (session.render || localRender || []).slice(-14),
        liveNotes: session.notes || [], steps: DBG,
        final: { text: (fin && fin.text) || '', via: (fin && fin.via) || '' },
        usage, trims: session.trims || '', nanoFails, heat: heatDiag(),
        transcriptVia: session.transcriptVia || '', audio: session.audio || null
      };
      send({ type: 'debug', payload });
    } catch (e) {}
  }

  // ---------- on-device Nano warmup ----------
  async function ensureNano() {
    try {
      const LM = self.LanguageModel || (self.ai && self.ai.languageModel);
      if (!LM) { nanoState = 'absent'; return; }
      let av = ''; try { av = await LM.availability(); } catch (e) { try { av = (await LM.capabilities()).available; } catch (_) {} }
      rlog('event', 'nano-availability', { availability: av });
      if (av === 'available' || av === 'readily') { nanoState = 'ready'; return; }
      if (av === 'unavailable' || av === 'no') { nanoState = 'absent'; return; }
      nanoState = 'downloading';
      const s2 = await LM.create({ monitor(m) { try { m.addEventListener('downloadprogress', e => { nanoPct = Math.round((e.loaded || 0) * 100); if (!recording) $('lbl').textContent = 'Gemini Nano downloading ' + nanoPct + '%…'; }); } catch (_) {} } });
      try { s2.destroy(); } catch (e) {}
      nanoState = 'ready'; if (!recording) $('lbl').textContent = 'Nano ready · Start recording';
    } catch (e) { nanoState = 'absent'; }
  }

  // ---------- speech (live transcript + remark boundaries) ----------
  let selectedRuntimeMode = 'setup';
  function startSpeech() {
    if (selectedRuntimeMode !== 'hosted') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
      recog.onresult = e => {
        let f = '', it = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) f += t; else it += t; }
        if (it && !remarkStart) remarkStart = now();
        if (f) { liveText = (liveText + ' ' + f).trim(); const t1 = now(), t0 = remarkStart || Math.max(0, t1 - 3); remarkStart = 0; fireLiveNote({ t0, t1, text: f.trim() }); }
        $('lbl').textContent = '“' + (liveText + ' ' + it).trim().slice(-60) + '”';
      };
      recog.onerror = e => { recogOn = false; }; // browser speech is blocked in this context — local Whisper transcription is the next build; don't nag the user with an error
      recog.onend = () => { if (recogOn) try { recog.start(); } catch (e) {} };
      recog.start(); recogOn = true;
    } catch (e) {}
  }

  // ---------- lifecycle ----------
  let _tmrInt = 0, _budgetSec = null; // minutes left on the plan when recording started (null = owner build / unknown)
  const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function startTimer(audioOffset = 0) {
    stopTimer(); _budgetSec = null;
    // show the user's remaining plan minutes counting DOWN next to the elapsed clock, so nobody gets
    // surprised by the trial/monthly cap mid-thought. Fetched async; pill shows elapsed-only until it lands.
    send({ type: 'dd-me' }).then((m) => { if (m && m.signedIn && m.minutesLeft != null) _budgetSec = Math.max(0, m.minutesLeft * 60); }).catch(() => {});
    const tick = () => { try {
      const el = Date.now() - sessionT0 - audioOffset * 1000;
      let t = fmtClock(el);
      if (_budgetSec != null) { const rem = _budgetSec - el / 1000; t += rem > 0 ? ' · ' + fmtClock(rem * 1000) + ' left' : ' · out of minutes'; }
      $('timer').textContent = t;
    } catch (e) {} };
    tick(); _tmrInt = setInterval(tick, 1000);
  }
  function stopTimer() { if (_tmrInt) { clearInterval(_tmrInt); _tmrInt = 0; } }
  function showCard() { $('dim').classList.add('show'); $('card').classList.add('show'); }
  function hideCard() { $('dim').classList.remove('show'); $('card').classList.remove('show'); }
  function resetBuffers() { currentEls = []; reported = new WeakSet(); localTL = []; localNet = []; localMut = []; localConsole = []; localRender = []; clsTotal = 0; sessionCtx = null; remarkStart = 0; usage = { in: 0, out: 0, calls: 0 }; pts = []; shots = []; xoSheets = []; xoSeen = new Set(); xoPromise = null; cssDiagDone = false; srcBytes = {}; srcInfo = null; stateData = null; headData = null; domStr = ''; assetBytes = {}; assetInfo = null; lastHref = location.href; }
  // periodic viewport screenshots — bg captures the visible tab every few seconds, so the agent gets
  // a frame-by-frame visual record of what the user saw while they talked (animations, scroll-reveals).
  // hide our own overlay (gaze-trail + recording pill) for the instant of the grab — otherwise it
  // paints over the very thing the user is reacting to, so the screenshot lies about what they saw.
  let _grabbing = false;
  async function grabShot() {
    if (!recording || _grabbing || shots.length >= 24) return;
    _grabbing = true; shotDirty = false; lastShotT = now(); let restore = null;
    try {
      if (host && host.style) { const prev = host.style.opacity; host.style.opacity = '0'; restore = () => { host.style.opacity = prev; }; await new Promise(r => requestAnimationFrame(r)); } // opacity = compositor-only (no reflow), one 60fps frame so the hidden state paints, restored the instant the grab resolves
      const r = await send({ type: 'shot' }); if (r && r.url) shots.push({ t: now(), url: r.url });
    } catch (e) {} finally { if (restore) restore(); _grabbing = false; }
  }
  // grab only when the view actually changed since the last shot AND a min gap has passed — so a still
  // page (reading) never blinks, and meaningful moments (clicks, navs, scroll-settles) always land one.
  function maybeGrab(force) { if (!recording) return; if (!force && !shotDirty) return; if (now() - lastShotT < 1.4) return; grabShot(); }
  function startShots() {
    stopShots();
    grabShot(); // one immediately so we always have the opening frame
    // No periodic timer — frames are captured purely by the things that actually change the view:
    // scroll-settle, click, and nav (wired in onScroll/onClick/resume). So the overlay only blinks out
    // when you DO something, never on a relentless clock or just because the mouse moved.
  }
  function stopShots() { if (shotTimer) { clearInterval(shotTimer); shotTimer = null; } }
  // keep the bg service worker alive during the (possibly long) model download + crunch,
  // so the result actually comes back instead of the worker dying mid-wait.
  let _kaPort = null, _kaTimer = 0;
  function keepAlive(on) {
    try {
      if (on) { if (_kaPort) return; _kaPort = chrome.runtime.connect({ name: 'dd-keepalive' }); _kaPort.onDisconnect.addListener(() => { _kaPort = null; }); _kaTimer = setInterval(() => { try { _kaPort && _kaPort.postMessage({ ping: 1 }); } catch (e) {} }, 20000); }
      else { clearInterval(_kaTimer); _kaTimer = 0; try { _kaPort && _kaPort.disconnect(); } catch (e) {} _kaPort = null; }
    } catch (e) {}
  }
  // live progress for the bundled on-device model (download → load → think), shown in the UI
  function fmtProgress(p) {
    if (!p) return 'starting the local model…';
    const pct = (p.progress != null) ? Math.round(p.progress * 100) : null, t = p.text || '';
    if (/fetch/i.test(t)) return 'Downloading the local model · one-time, ~1 GB' + (pct != null ? ' · ' + pct + '%' : '…');
    if (/loading model/i.test(t)) return 'Loading the model into your GPU' + (pct != null ? ' · ' + pct + '%' : '…');
    if (/shader|webgpu|finish/i.test(t)) return 'Warming up the model…';
    return 'Preparing the local model' + (pct != null ? ' · ' + pct + '%' : '…');
  }
  let _progTimer = 0;
  function progressTick(s) {
    if (!s) return;
    const ready = s.ready && (!s.progress || s.progress.progress >= 1);
    if (recording) { if (!ready && s.progress) $('lbl').textContent = 'recording… · ' + fmtProgress(s.progress); }
    else { setStage('crunch', 'run', ready ? 'writing your briefing on-device…' : fmtProgress(s.progress)); }
  }
  function startProgressPoll() { stopProgressPoll(); _progTimer = setInterval(async () => { try { progressTick(await send({ type: 'localllm-status' })); } catch (e) {} }, 800); }
  function stopProgressPoll() { clearInterval(_progTimer); _progTimer = 0; }
  // ---------- first-run setup modal (centered): download the local model, gate Start until ready ----------
  let _homeTimer = 0;
  function showHome() {
    $('home').hidden = false; $('hview').hidden = true; $('stages').hidden = true; $('result').hidden = true;
    $('ptag').textContent = ''; $('via').textContent = '';
    $('hsetup').classList.add('ready'); // no on-device download anymore — kill the spinner
    showCard();
    renderHome();
  }
  function setStart(label, fn, enabled) { const b = $('hstart'); $('hstartl').textContent = label; b.disabled = !enabled; b.onclick = enabled ? fn : null; }
  // ---------- capture history (local only): thumb + code-speak + the full paste ----------
  const HIST_KEY = 'dd_history';
  const histGet = () => new Promise(r => { try { chrome.storage.local.get(HIST_KEY, s => r((s && s[HIST_KEY]) || [])); } catch (e) { r([]); } });
  const histSet = (v) => new Promise(r => { try { chrome.storage.local.set({ [HIST_KEY]: v }, () => r()); } catch (e) { r(); } });
  const escH = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm ago'; const h = Math.round(m / 60); if (h < 24) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; };
  function makeThumb(dataUrl) { return new Promise((res) => { if (!dataUrl) return res(''); try { const im = new Image(); im.onload = () => { try { const w = 360, h = Math.max(1, Math.round(im.height * w / im.width)); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); res(c.toDataURL('image/jpeg', 0.62)); } catch (e) { res(''); } }; im.onerror = () => res(''); im.src = dataUrl; } catch (e) { res(''); } }); }
  async function saveHistory(fin) {
    try {
      const thumb = await makeThumb(shots[0] && shots[0].url);
      const rec = { id: Date.now(), ts: Date.now(), host: location.hostname, page: location.href.slice(0, 200), thumb, prose: (fin && fin.text || '').slice(0, 4000), paste: (lastText || '').slice(0, 12000) };
      const list = await histGet(); list.unshift(rec); await histSet(list.slice(0, 24));
    } catch (e) {}
  }
  // code-speak viewer: highlight the code-ish tokens (selectors, ids, files, tags, backticks) as chips —
  // so multiple attempts on the same page are tellable apart at a glance, Grammarly-style.
  function hiCode(t) {
    let s = escH(t);
    s = s.replace(/`([^`\n]{1,80})`/g, '<code>$1</code>');
    s = s.replace(/(^|[\s(])(\.[a-zA-Z_][\w-]{1,40})/g, '$1<code>$2</code>');
    s = s.replace(/(^|[\s(])(#[a-zA-Z][\w-]{1,40})\b/g, '$1<code>$2</code>');
    s = s.replace(/\b([\w./-]{1,60}\.(?:tsx|ts|jsx|js|css|scss|html|svg|json|py)(?::\d+)?)\b/g, '<code>$1</code>');
    s = s.replace(/&lt;(\/?[a-z][\w-]{0,24})&gt;/g, '<code>&lt;$1&gt;</code>');
    return s;
  }
  async function renderGallery() {
    const g = $('hgal'), grid = $('hgrid');
    const list = await histGet();
    if (!list.length) { g.hidden = true; return; }
    g.hidden = false; grid.innerHTML = '';
    list.forEach((rec) => {
      const d = document.createElement('div'); d.className = 'hcap';
      d.innerHTML = (rec.thumb ? '<img src="' + rec.thumb + '" alt="">' : '<div style="height:64px;background:#f4efe3"></div>') + '<div class="hc-m">' + escH(rec.host || 'capture') + ' · ' + ago(rec.ts) + '</div>';
      d.onclick = () => openView(rec);
      grid.appendChild(d);
    });
  }
  function openView(rec) {
    $('home').hidden = true; $('hview').hidden = false;
    $('hvmeta').textContent = (rec.host || '') + ' · ' + new Date(rec.ts).toLocaleString();
    const im = $('hvshot'); if (rec.thumb) { im.src = rec.thumb; im.style.display = 'block'; } else im.style.display = 'none';
    $('hvtext').innerHTML = hiCode(rec.prose || rec.paste || '(no code-speak saved)');
    $('hvcopy').textContent = 'Copy';
    $('hvcopy').onclick = () => { doCopy(rec.paste || rec.prose || ''); $('hvcopy').textContent = 'Copied ✓'; setTimeout(showHome, 700); };
    $('hvback').onclick = showHome;
  }
  // ---------- mic picker (labels come from the offscreen doc — the extension origin holds the grant) ----------
  async function initMic() {
    const sel = $('micsel'), fix = $('micfix');
    const saved = await new Promise(r => { try { chrome.storage.local.get('dd_mic', s => r((s && s.dd_mic) || '')); } catch (e) { r(''); } });
    sel.onchange = () => { try { chrome.storage.local.set({ dd_mic: sel.value }); } catch (e) {} };
    const res = await send({ type: 'dd-mics' }).catch(() => null);
    if (res && res.mics && res.mics.length) {
      fix.hidden = true;
      sel.innerHTML = '<option value="">Default microphone</option>' + res.mics.map(mi => '<option value="' + escH(mi.id) + '"' + (mi.id === saved ? ' selected' : '') + '>' + escH(mi.label) + '</option>').join('');
    } else if (res && /no-permission|NotAllowed/i.test(res.error || '')) {
      fix.hidden = false; fix.onclick = () => send({ type: 'dd-micgrant' });
    }
  }
  // The home follows the selected own-key or hosted mode. Hosted account and billing actions
  // stay within the existing hosted path.
  async function renderHome() {
    setStart('…', null, false); $('hstat').textContent = 'Checking your account…'; $('hsub').textContent = '';
    $('hmenu').hidden = true;
    renderGallery(); initMic();
    let m = null; try { m = await send({ type: 'dd-me' }); } catch (e) {}
    selectedRuntimeMode = m?.mode || 'setup';
    const ab = $('acctbtn');
    // Local configuration selects own-key recording independently of saved hosted sessions.
    if (m && m.mode !== 'hosted') {
      ab.hidden = true;
      $('hbarfill').style.width = m.ready ? '100%' : '0%';
      if (m.ready) {
        $('hstat').textContent = m.mode === 'local' ? 'On-device models' : 'Your keys · ' + m.provider;
        $('hsub').textContent = m.mode === 'local' ? 'First recording downloads model weights; captures stay on your device.' : 'Capture files save to your browser download folder.';
        setStart('Start recording', () => startRec(), true);
        if (micFailure) showMicRecovery();
      } else {
        $('hstat').textContent = 'Configure Dis Dat';
        $('hsub').textContent = 'Your agent can prepare the extension with the local setup command.';
        setStart('Open setup instructions', () => send({ type: 'dd-setup' }), true);
      }
      return;
    }
    // public build, not signed in — Google sign-in gate
    if (!m || !m.signedIn) {
      ab.hidden = true;
      $('hstat').textContent = 'Sign in to start'; $('hsub').textContent = '30 free minutes — no card.';
      $('hbarfill').style.width = '0%';
      setStart('Sign in with Google', async () => {
        setStart('Opening Google…', null, false);
        const r = await send({ type: 'dd-signin' }).catch(() => null);
        if (r && r.signedIn) renderHome();
        else { $('hsub').textContent = 'Sign-in didn’t complete — try again.'; setTimeout(renderHome, 600); }
      }, true);
      return;
    }
    // signed in — account chip + menu, ALWAYS present (upgrade path must never disappear)
    ab.hidden = false; ab.textContent = m.email || 'account';
    ab.onclick = (e) => { e.stopPropagation(); $('hmenu').hidden = !$('hmenu').hidden; };
    $('hme').textContent = (m.email || '') + ' · ' + (m.plan === 'pro' ? 'Pro' : 'Free trial');
    $('m-upgrade').hidden = (m.plan === 'pro');
    $('m-upgrade').onclick = () => { $('hmenu').hidden = true; send({ type: 'dd-upgrade', which: 'checkout' }); };
    $('m-billing').hidden = (m.plan !== 'pro');
    $('m-billing').onclick = () => { $('hmenu').hidden = true; send({ type: 'dd-upgrade', which: 'portal' }); };
    $('m-refer').onclick = () => { $('hmenu').hidden = true; send({ type: 'dd-open', url: 'https://disdat.dev/account' }); };
    $('m-site').onclick = () => { $('hmenu').hidden = true; send({ type: 'dd-open', url: 'https://disdat.dev/account' }); };
    $('m-signout').onclick = async () => { $('hmenu').hidden = true; await send({ type: 'dd-signout' }); renderHome(); };
    // plan + minutes; gate the big button on entitlement
    const left = (m.minutesLeft != null) ? Math.round(m.minutesLeft) : null;
    const cap = m.cap || (m.plan === 'pro' ? 500 : 30);
    $('hbarfill').style.width = (left != null ? Math.max(2, Math.min(100, (left / cap) * 100)) : 100) + '%';
    if (m.entitled) {
      $('hstat').textContent = (m.plan === 'pro' ? 'Pro' : 'Free trial') + (left != null ? ' · ' + left + ' min left' : '');
      $('hsub').textContent = (m.plan !== 'pro') ? 'Upgrade any time for 500 min/mo.' : '';
      setStart('Start recording', () => startRec(), true);
      if (micFailure) showMicRecovery();
    } else {
      $('hstat').textContent = (m.plan === 'pro') ? 'Monthly cap reached' : 'Trial used up';
      $('hsub').textContent = 'Pro is 500 minutes a month for $7.'; $('hbarfill').style.width = '100%';
      setStart('Upgrade to Pro', () => send({ type: 'dd-upgrade', which: 'checkout' }), true);
    }
  }
  function homeTick(s) {
    const ready = s && s.ready && (!s.progress || s.progress.progress >= 1);
    const pct = (s && s.progress && s.progress.progress != null) ? Math.round(s.progress.progress * 100) : (ready ? 100 : 0);
    const fill = $('hbarfill'); if (fill) fill.style.width = pct + '%';
    if (ready) {
      $('hstat').textContent = 'Ready'; $('hsub').textContent = 'Your private AI is set up and runs offline. Hit Start and talk.';
      $('hstart').disabled = false; $('hstart').textContent = 'Start recording'; $('hsetup').classList.add('ready');
      stopHomePoll();
    } else {
      $('hstat').textContent = (s && s.progress) ? fmtProgress(s.progress) : 'Setting up your private AI…';
      $('hstart').disabled = true; $('hstart').textContent = 'Setting up…';
    }
  }
  function startHomePoll() { stopHomePoll(); homeTick(null); _homeTimer = setInterval(async () => { try { homeTick(await send({ type: 'localllm-status' })); } catch (e) {} }, 700); }
  function stopHomePoll() { clearInterval(_homeTimer); _homeTimer = 0; }
  function showMicRecovery() {
    $('hstat').textContent = 'Microphone setup';
    $('hsub').textContent = 'Allow access or choose a microphone, then try again.';
    setStart('Try microphone again', () => startRec(), true);
  }
  function showMicPending() {
    hideCard(); $('home').hidden = true; $('hview').hidden = true; stopHomePoll();
    $('rec').disabled = true; $('rec').classList.remove('on');
    $('bar').classList.add('rec-on', 'mic-pending'); $('recl').textContent = 'Starting microphone…';
    $('esc').title = 'Cancel microphone setup'; keepAlive(true);
  }
  async function audioStateChanged(state) {
    if (!host.isConnected || !audioStarting || state.startT !== sessionT0) return;
    if (state.audioState === 'starting') return;
    audioStarting = false; $('rec').disabled = false; $('bar').classList.remove('mic-pending');
    if (state.audioState !== 'recording') {
      recording = false; audioRecovering = true; micFailure = true; keepAlive(false);
      await send({ type: 'abortSession', startT: sessionT0 });
      audioRecovering = false;
      if (host.isConnected) { $('bar').classList.remove('rec-on'); $('recl').textContent = 'Start'; showHome(); }
      return;
    }
    recording = true; $('rec').classList.add('on'); $('recl').textContent = 'Stop'; $('lbl').textContent = 'recording… react freely';
    $('esc').title = 'close'; startTimer(state.audioOffset || 0);
    attachSensors(); send({ type: 'injectShim' }).then(() => { if (recording) setRec(true); });
    send({ type: 'event', ev: { k: 'nav', t: now(), url: PAGE } });
    startShots(); ensureXOSheets(); if (selectedRuntimeMode === 'local') startProgressPoll();
  }
  async function startRec() {
    sessionT0 = Date.now(); recording = false; audioStarting = true; micFailure = false; liveText = ''; resetBuffers();
    showMicPending(); sh.querySelectorAll('.hb').forEach(n => n.remove());
    const requestedStartT = sessionT0;
    const r = await send({ type: 'startSession', startT: requestedStartT });
    audioStateChanged({ startT: requestedStartT, audioState: r?.audio?.ok ? 'recording' : 'failed', audioOffset: r?.audioOffset || 0 });
  }
  async function resume(state) {
    sessionT0 = state.startT; recording = false; audioStarting = true; resetBuffers();
    showMicPending(); audioStateChanged(state);
  }
  async function stopRec() {
    if (!recording || audioStarting) return;
    stopShots();
    // capture the final dwell + the clustered gaze elements WHILE still recording (so the
    // facts + main-world round-trips complete and reach the timeline before we assemble).
    try {
      if (hoverEl && (performance.now() - hoverStart) >= 350) await recordEngage(hoverEl, 'look', { dwellMs: Math.round(performance.now() - hoverStart) });
      await Promise.all(gazeElements().map(el => recordEngage(el, 'gaze', {})));
    } catch (e) {}
    recording = false; recogOn = false; try { recog && recog.stop(); } catch (e) {}
    setRec(false); sessionCtx = pageContext();
    $('rec').classList.remove('on'); $('bar').classList.remove('rec-on'); $('recl').textContent = 'Start'; $('lbl').textContent = 'wrapping up…'; stopTimer();
    detachSensors();
    // staged progress, so it's clear what's happening at each step
    DBG = [];
    ['transcribe', 'read', 'crunch'].forEach(s => setStage(s, 'idle'));
    $('stages').hidden = false; $('result').hidden = true; $('ptag').textContent = 'Working on your reaction…'; $('via').textContent = '';
    sh.querySelectorAll('.hb').forEach(n => n.remove()); showCard();
    setStage('transcribe', 'run');
    const out = await send({ type: 'stopSession', startT: sessionT0, liveText });
    const session = (out && out.session) || { engagements: localTL, net: localNet, mut: localMut, console: localConsole, render: localRender, events: [], notes: [], transcript: liveText, words: [], pages: [PAGE] };
    if (!session.console || !session.console.length) session.console = localConsole;
    if (!session.render || !session.render.length) session.render = localRender;
    setStage('transcribe', 'done', session.transcript ? ('“' + session.transcript.slice(0, 44) + (session.transcript.length > 44 ? '…' : '') + '”') : 'no speech detected');
    // canvas-hunt: grab the prominent WebGL/canvas the cursor likely missed (e.g. a full-bleed shader
    // background — the thing people actually react to) so the effect itself reaches the agent, not just the divs around it.
    try {
      const seen = new Set((session.engagements || []).map(e => e.facts && e.facts.selector));
      const big = [...document.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(x => x.r.width * x.r.height > 40000 && x.r.bottom > 0 && x.r.top < innerHeight).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height).slice(0, 2);
      for (const it of big) { const s = sel(it.c); if (seen.has(s)) continue; const gl = await requestGL(it.c); if (gl && ((gl.programs && gl.programs.length) || gl.frame)) { const r = it.r; (session.engagements = session.engagements || []).push({ page: PAGE, kind: 'canvas', t: now(), facts: { selector: s, tag: 'canvas', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, gl } }); rlog('event', 'canvas-hunt', { selector: s, programs: (gl.programs || []).length, frame: !!gl.frame }); } }
    } catch (e) {}
    const els = dedupeAll(session.engagements || []);
    await pullSource(els); // re-host the page's own JS render source (the harness) before we build text + bundle; els carry the shader tokens that locate it
    stateData = captureState(); headData = captureHead(); domStr = captureDOM(); await pullAssets(); // v2: persisted state + head meta + full DOM tree + re-hosted asset bytes
    setStage('read', 'run');
    setStage('read', 'done', els.length + ' element' + (els.length === 1 ? '' : 's') + ((session.pages && session.pages.length > 1) ? ' · ' + session.pages.length + ' pages' : ''));
    setStage('crunch', 'run', (session.notes && session.notes.length) ? ('reconciling ' + session.notes.length + ' live notes') : (selectedRuntimeMode === 'local' ? 'preparing the local model…' : 'cloud'));
    if (selectedRuntimeMode === 'local') startProgressPoll();
    const fin = await finalizeSession(session);
    stopProgressPoll();
    setStage('crunch', 'done');
    showResult(session, fin, els);
    sendDebug(session, fin, els);
    await packageBundle(session, fin, els);
    keepAlive(false);
  }
  // the full-fidelity payload: prose + verbatim ground truth + interaction timeline + EVERY element's
  // facts (shaders, frames, computed/authored CSS, html) + network bodies + the screenshot timeline —
  // gzipped and re-hosted off a neutral host (no origin 403s). The agent downloads ONE link and sees
  // exactly what the user saw, down to the WebGL. The clipboard text stays light; the depth lives here.
  // First-party JS the page loaded — its own render code (the WebGL harness, the animation loops). We
  // keep only the page's registrable domain + its asset subdomains (e.g. eleven-public-cdn.elevenlabs.io),
  // and drop third-party analytics/CDN noise. The bg fetches the bytes (host perms) so the user's agent
  // gets the REAL source to extract a self-hostable copy — no resi proxy / stealth browser needed.
  function collectSourceUrls() {
    try {
      const host = location.hostname || '', reg = host.split('.').slice(-2).join('.');
      const sameSite = (h) => h === host || h === reg || h.endsWith('.' + reg);
      const DENY = /(segment|datadog|googletag|google-analytics|gtag|doubleclick|linkedin|facebook|connect\.fb|hotjar|vwo|optimizely|cookielaw|onetrust|intercom|sentry|fullstory|amplitude|mixpanel|jsdelivr|unpkg|polyfill|cloudflareinsights|newrelic|nr-data)/i;
      const urls = new Set();
      Array.from(document.scripts).forEach(s => { if (s.src) urls.add(s.src); });
      (localNet || []).forEach(n => { if (n && n.url && /\.m?js(\?|$)/i.test(n.url)) urls.add(n.url); });
      return [...urls].filter(u => { try { return /\.m?js(\?|$)/i.test(u) && sameSite(new URL(u).hostname) && !DENY.test(u); } catch (e) { return false; } }).slice(0, 100);
    } catch (e) { return []; }
  }
  async function pullSource(els) {
    try {
      const su = collectSourceUrls(); if (!su.length) return;
      // distinctive shader-uniform names from the captured WebGL programs — these appear verbatim as
      // string literals in the chunk that wires up the GL, so they let bg find the real render harness.
      const tokens = [], seen = new Set();
      (els || []).forEach(e => { const g = e.gl; if (g && g.programs) g.programs.forEach(p => (p.uniforms || []).forEach(u => { const n = u && u.name || ''; if (n.length >= 8 && !seen.has(n)) { seen.add(n); tokens.push(n); } })); });
      const sr = await send({ type: 'fetchsrc', urls: su, tokens: tokens.slice(0, 16) });
      if (sr && sr.sources) { srcBytes = sr.sources; const files = Object.keys(srcBytes); srcInfo = { files: files.length, kb: Math.round((sr.bytes || 0) / 1024), urls: files, dropped: (sr.dropped || []).length, harness: sr.harnessFiles || 0 }; rlog('event', 'src-pack', { files: files.length, kb: srcInfo.kb, dropped: srcInfo.dropped, harness: srcInfo.harness }); }
    } catch (e) {}
  }
  // PERSISTED STATE the app boots from — localStorage + sessionStorage. We SKIP cookies entirely and redact
  // anything secret (auth keys, JWTs, long high-entropy strings) BEFORE it leaves the page, because the
  // artifact rides a PUBLIC temp URL. (Founder decision: never put a real token on a litterbox link.)
  function captureState() {
    try { return { localStorage: globalThis.DisdatPrivacy.storage(localStorage), sessionStorage: globalThis.DisdatPrivacy.storage(sessionStorage) }; }
    catch (e) { return null; }
  }

  // <head> the user never engages but the agent needs: title, meta, OG/Twitter, canonical, JSON-LD.
  function captureHead() {
    try {
      const h = { title: document.title || '' }, meta = {};
      document.querySelectorAll('head meta[name],head meta[property]').forEach(m => { const k = m.getAttribute('name') || m.getAttribute('property'), v = m.getAttribute('content'); if (k && v) meta[k] = v.slice(0, 300); });
      h.meta = meta;
      const can = document.querySelector('head link[rel=canonical]'); if (can) h.canonical = can.href;
      const ld = []; document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { ld.push(JSON.parse(s.textContent)); } catch (e) {} }); if (ld.length) h.jsonld = ld.slice(0, 5);
      return h;
    } catch (e) { return null; }
  }
  // The FULL document structure (not just the ~24 engaged elements) — script/style bodies stripped (kept as
  // empty tags so structure survives), our own attrs removed, node count + bytes capped.
  function captureDOM() {
    try {
      let h = (document.body && document.body.outerHTML) || document.documentElement.outerHTML || '';
      h = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>').replace(/\s*data-(dd|disdat)[^=\s]*="[^"]*"/g, '');
      return h.length > 700000 ? h.slice(0, 700000) + '\n<!-- …Dis Dat truncated the DOM tree at 700KB -->' : h;
    } catch (e) { return ''; }
  }
  // First-party asset URLs (images the page actually displays + fonts it loaded + inline-referenced SVG) so
  // bg can re-host the BYTES — the biggest reproduction lever (origin URLs 403/expire from a datacenter).
  function collectAssetUrls() {
    try {
      const host = location.hostname || '', reg = host.split('.').slice(-2).join('.');
      const same = (h) => h === host || h === reg || h.endsWith('.' + reg);
      const DENY = /(segment|datadog|googletag|google-analytics|doubleclick|linkedin|facebook|hotjar|vwo|optimizely|cookielaw|onetrust|intercom|sentry|fullstory|amplitude|mixpanel|jsdelivr|unpkg|polyfill|cloudflareinsights|newrelic)/i;
      const urls = new Set();
      document.querySelectorAll('img').forEach(im => { const s = im.currentSrc || im.src; if (s && !s.startsWith('data:')) urls.add(s); }); // currentSrc = the chosen srcset variant
      document.querySelectorAll('link[as=font],link[rel=preload][as=font]').forEach(l => { if (l.href) urls.add(l.href); });
      (localNet || []).forEach(n => { if (n && n.url && /\.(png|jpe?g|webp|avif|gif|svg|woff2?|ttf|otf)(\?|$)/i.test(n.url)) urls.add(n.url); }); // images/fonts the page fetched during the session
      return [...urls].filter(u => { try { return same(new URL(u, location.href).hostname) && !DENY.test(u); } catch (e) { return false; } }).slice(0, 40);
    } catch (e) { return []; }
  }
  async function pullAssets() {
    try {
      const au = collectAssetUrls(); if (!au.length) return;
      const r = await send({ type: 'fetchassets', urls: au });
      if (r && r.assets) { assetBytes = r.assets; const n = Object.keys(assetBytes).length; assetInfo = { files: n, kb: Math.round((r.bytes || 0) / 1024), dropped: (r.dropped || []).length }; rlog('event', 'asset-pack', assetInfo); }
    } catch (e) {}
  }
  // The clipboard tail the user pastes in front of their agent. Kept SHORT + pretty — the heavy verbatim
  // ground truth now lives in the gz, not the paste. Written as plain "instructions for an LLM": fetch +
  // gunzip the bundle, read the keys, reproduce from exact values. (If the upload fails we fall back to
  // pasting the full ground truth inline, so it's never non-functional.)
  function llmInstructions(url, kb, ttl, els, session) {
    const inv = [els.length + ' element' + (els.length === 1 ? '' : 's'), shots.length + ' screenshot' + (shots.length === 1 ? '' : 's')];
    if (srcInfo && srcInfo.files) inv.push(srcInfo.files + ' JS source' + (srcInfo.files === 1 ? '' : 's'));
    if (session.net && session.net.length) inv.push(Math.min(session.net.length, 60) + ' API call' + (session.net.length === 1 ? '' : 's'));
    if (session.pages && session.pages.length > 1) inv.push(session.pages.length + ' pages');
    const glance = (els || []).slice(0, 10).map((e, i) => '  ▸ [' + (i + 1) + '] ' + (e.selector || '?').slice(0, 64)).join('\n');
    return '\n\n━━━ DIS DAT · capture for your coding agent ━━━━━━━━━━━━━━━━━━\n'
      + 'The user reacted out loud to a LIVE web page. The full verbatim record of what\n'
      + 'they saw is in the bundle — FETCH + GUNZIP it, then build from the exact captured\n'
      + 'values (don\'t guess, don\'t re-render the site).\n\n'
      + '① FETCH  (gzipped JSON, not a webpage):\n'
      + '     curl -s "' + url + '" | gunzip        (or fetch + DecompressionStream(\'gzip\'))\n'
      + '② READ these keys:\n'
      + '   • elements[]    verbatim computed + authored CSS (incl :hover/:active/pseudo), html,\n'
      + '                   React props/state, listeners, animations, + (canvas) the real WebGL\n'
      + '                   shaders, uniforms & a rendered frame\n'
      + '   • sources{}     the page\'s OWN first-party JS — the render harness behind the WebGL/\n'
      + '                   animations, fetched past CORS for you. grep a shader uniform (e.g.\n'
      + '                   uFluidSimTexture) to find the GL setup → self-host / tweak the real thing\n'
      + '   • screenshots[] time-ordered base64 jpegs — what the user actually saw\n'
      + '   • network[]     observed API contract (req→res, WS/SSE frames), tokens redacted\n'
      + '   • timeline      causal action→response trace\n'
      + '   • groundTruth   all of the above as one flat text block, if you prefer\n'
      + '③ REPRODUCE from those exact values.\n\n'
      + 'captured: ' + inv.join(' · ') + '\n' + (glance ? glance + '\n' : '')
      + '📦 bundle (' + kb + ' KB gzip · expires ' + ttl + '):  ' + url + '\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  }
  // v2 delivery: the clipboard = codespeak prose + a ≤20-line MENU of the cascade. Each row: artifact ·
  // size · what-it-holds · grab-when · URL. Plus a per-intent recommendation. The agent fetches only the
  // layers its task needs (token-smart); the full transcript + facts live in `core`.
  const ART_DESC = { core: 'codespeak+transcript+elements+API+state', dom: 'full document tree', screenshots: 'jpeg timeline — what they saw', assets: 'image/font BYTES (no 403s)', sources: 'the JS render harness' };
  const ART_GRAB = { core: 'always', dom: 'page structure', screenshots: 'see it', assets: 'pixel clone', sources: 'behaviour' };
  function menuBlock(res, order, els, session) {
    const rows = order.map(k => { const r = res[k]; if (!r || !r.url) return null; const kb = Math.max(1, Math.round((r.bytes || 0) / 1024)); return '  ' + k.padEnd(11) + ('~' + kb + 'KB').padEnd(8) + (ART_DESC[k] || '').padEnd(38) + ' [' + (ART_GRAB[k] || '') + ']  ' + r.url; }).filter(Boolean);
    return '\n\n━━━ DIS DAT · capture for your coding agent ━━━\n'
      + '▸ Use the Dis Dat skill on this capture if you have it. No skill? Act on the menu below directly —\n'
      + '  it’s self-describing (skill = https://api.disdat.dev/skill, optional, just more reliable).\n'
      + 'The user reacted out loud to a LIVE web page. Grab the artifact(s) your task needs (gzip JSON:\n'
      + 'curl -s URL | gunzip), then build from the EXACT captured values — don\'t guess, don\'t re-render.\n'
      + 'If a URL returns HTTP 202 {"status":"uploading"}, the artifact is still landing — wait ~3s and retry.\n'
      + rows.join('\n') + '\n'
      + '▸ recommend: clone the look → core + assets + screenshots · rebuild behaviour → + sources + dom · wire data → core\n'
      + 'core has the full transcript + ' + els.length + ' elements + the API/state. Reproduce from exact values.\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  }
  async function packageBundle(session, fin, els) {
    try {
      const runtime = await send({ type: 'dd-runtime' });
      if (!runtime || !['byok', 'hosted', 'local'].includes(runtime.mode)) throw new Error('Choose a runtime mode with the local setup command.');
      const meta = { tool: 'Dis Dat', version: runtime.version, mode: runtime.mode, page: PAGE, pages: session.pages || [PAGE], viewport: sessionCtx && sessionCtx.viewport, dpr: sessionCtx && sessionCtx.dpr, colorScheme: sessionCtx && sessionCtx.colorScheme, fonts: (sessionCtx && sessionCtx.fonts) || [] };
      // core = the always-grab essentials (small): codespeak + FULL transcript + elements + ground-truth + API + state + head + timeline
      const core = { meta, readme: 'Dis Dat `core` artifact: the codespeak + full transcript + the engaged elements (verbatim computed+authored CSS incl :hover/pseudo, html, React state, animations, WebGL shaders+frame), the observed API/network contract, persisted state (localStorage/sessionStorage, secrets redacted, cookies skipped), <head> meta, and the causal timeline. Heavier layers are separate artifacts (dom, screenshots, assets, sources). Each element has an exact rect; meta.viewport/dpr too, so ratios=rect÷viewport — use the CSS values, the screenshots are a visual reference not a ruler. Reproduce from exact values.', prose: fin.text || '', transcript: session.transcript || '', groundTruth: buildGroundTruth(session, els), elements: els, network: (session.net || []).slice(0, 80), console: (session.console || []).slice(-20), state: stateData, head: headData, timeline: buildTimeline(session) };
      const items = [{ key: 'core', json: JSON.stringify(core) }];
      if (domStr) items.push({ key: 'dom', json: JSON.stringify({ meta, dom: domStr }) });
      if (shots.length) items.push({ key: 'screenshots', json: JSON.stringify({ meta, screenshots: shots }) });
      if (assetBytes && Object.keys(assetBytes).length) items.push({ key: 'assets', json: JSON.stringify({ meta, assets: assetBytes, info: assetInfo }) });
      if (srcBytes && Object.keys(srcBytes).length) items.push({ key: 'sources', json: JSON.stringify({ meta, sources: srcBytes, info: srcInfo }) });
      const order = items.map(i => i.key);
      if (['byok', 'local'].includes(runtime.mode)) {
        const filename = 'disdat-capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        const capture = globalThis.DisdatLocalDelivery.bundle(items, meta);
        const po = $('pout');
        let receipt = null;
        async function saveCapture() {
          let result;
          try { result = await send(receipt ? { type: 'local-capture-retry', receipt } : { type: 'local-capture', capture, filename }); }
          catch (e) { result = { error: 'capture-download-unavailable' }; }
          if (result?.receipt) receipt = result.receipt;
          if (result?.ok) {
            lastText = globalThis.DisdatLocalDelivery.handoff(result.filename, fin.text || '');
            window.__disdat._last = lastText;
            autoCopy(lastText); saveHistory(fin);
          }
          if (po) {
            po.textContent = (fin.text || '') + (result?.ok ? '\n\nCapture download started: ' + filename : '\n\nThe local download needs another try.');
            const retry = document.createElement('button'); retry.type = 'button';
            retry.textContent = result?.ok ? 'Download capture again' : 'Retry download';
            retry.onclick = saveCapture; po.appendChild(retry);
          }
        }
        await saveCapture();
        return;
      }
      // ── INSTANT delivery via the disdat.dev capture proxy ──
      // Mint a capture id NOW, hand the clipboard disdat.dev/c/<id>/<artifact> URLs immediately (paste
      // is instant), then upload each artifact to a free host in the background and POST the mapping to
      // the proxy as each lands. An agent that fetches before an artifact arrives gets HTTP 202
      // "uploading, retry". Bytes live on the free host; disdat.dev only holds the KB mapping + streams.
      const API = 'https://api.disdat.dev';
      const cid = 'dd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
      const base = 'disdat-' + (location.hostname || 'capture');
      const proxied = {}; order.forEach((k, i) => { proxied[k] = { url: API + '/c/' + cid + '/' + k, bytes: (items[i].json.length) }; });
      // register all artifacts as 'uploading' so an early fetch gets a clean 202 (not a 404)
      fetch(API + '/x/cap/' + cid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifacts: order.map(k => ({ name: k, status: 'uploading', gzipped: true })) }) }).catch(() => {});
      // clipboard is ready RIGHT NOW — prose + the menu of disdat.dev URLs
      lastText = (fin.text || '') + menuBlock(proxied, order, els, session); window.__disdat._last = lastText;
      autoCopy(lastText); saveHistory(fin);
      try { const po = $('pout'); if (po) po.textContent = (fin.text || '') + '\n\n✓ ready — capture ' + cid + ' · ' + order.length + ' artifacts uploading in the background (links work as they land).'; } catch (e) {}
      // ── background: upload each artifact, map it to the proxy as soon as it's up ──
      const mapOne = (name, r) => {
        const body = (r && r.url)
          ? { artifacts: [{ name, url: r.url, status: 'ready', gzipped: r.gzipped !== false }] }
          : { artifacts: [{ name, status: 'failed' }] };
        fetch(API + '/x/cap/' + cid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
      };
      Promise.all(items.map(async (it) => {
        let r = null;
        try { r = await send({ type: 'bundle', json: it.json, name: base + '-' + it.key }); } catch (e) { r = { error: String(e).slice(0, 80) }; }
        mapOne(it.key, r); return [it.key, r];
      })).then((results) => {
        const up = results.filter(([, r]) => r && r.url).map(([k]) => k);
        rlog('event', 'bundle-up', { cid, artifacts: up, of: order.length, els: els.length });
        try { const po = $('pout'); if (po) po.textContent = (fin.text || '') + '\n\n✓ capture ' + cid + ' · ' + up.length + '/' + order.length + ' artifacts live'; } catch (e) {}
      });
    } catch (e) { rlog('error', 'bundle', { err: String(e) }); }
  }

  // ---------- provider setup is managed by tools/disdat.py ----------

  // ---------- controls ----------
  function destroy() { const wasRec = recording || audioStarting; recording = false; audioStarting = false; audioRecovering = false; recogOn = false; stopProgressPoll(); stopHomePoll(); stopShots(); keepAlive(false); try { recog && recog.stop(); } catch (e) {} if (wasRec) send({ type: 'abortSession', startT: sessionT0 }); setRec(false); cancelAnimationFrame(raf); detachSensors(); removeEventListener('message', onNet, false); removeEventListener('message', onMain, false); removeEventListener('keydown', onKey, true); host.remove(); window.__disdat = null; }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); if ($('card').classList.contains('show')) hideCard(); else destroy(); } }
  addEventListener('keydown', onKey, true);
  $('rec').onclick = () => recording ? stopRec() : startRec();
  $('esc').onclick = destroy;
  $('cardx').onclick = hideCard;
  $('dim').onclick = hideCard;
  $('card').addEventListener('click', (e) => { try { if (!e.composedPath().some(n => n && n.classList && n.classList.contains('hacct'))) $('hmenu').hidden = true; } catch (err) {} }); // click-away closes the account menu
  function copied() { $('copy').textContent = 'Copied ✓'; setTimeout(() => $('copy').textContent = 'Copy code-speak', 1400); }
  function doCopy(text) {
    text = text || lastText || '';
    // Selection-based copying exposes closed-shadow text through page copy/selection listeners.
    try { navigator.clipboard.writeText(text).then(copied).catch(() => { $('copy').textContent = 'Copy again'; }); }
    catch (e) { $('copy').textContent = 'Copy again'; }
  }
  // best-effort auto-copy when the capture is ready (browsers may block clipboard writes without a fresh
  // gesture — if so the prominent Copy button is right there; we just never make the user hunt for it).
  function autoCopy(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { try { $('copy').textContent = 'Copied ✓ — paste at your agent'; } catch (e) {} }).catch(() => {}); } catch (e) {}
  }
  $('copy').onclick = () => doCopy(lastText);
  $('again').onclick = () => startRec();
  addEventListener('message', onNet, false);
  addEventListener('message', onMain, false);
  // bg pings us before its per-navigation re-inject; if we answer, we're alive (a modal/soft URL change
  // didn't reload the page) so bg skips re-injecting → the live capture is never disturbed.
  try { chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.type === 'dd-ping') { reply({ alive: true, recording: recording || audioStarting }); return false; }
    if (m?.type === 'dd-audio-state' && sender.id === chrome.runtime.id && !sender.tab) audioStateChanged(m);
  }); } catch (e) {}
  window.__disdat = { toggle: destroy, show: showHome, _last: '', get recording() { return recording || audioStarting || audioRecovering; } };

  // warm Nano always (so live notes work on every page), then resume if mid-session
  (async () => {
    const st = await send({ type: 'sessionState' });
    if (st && st.recording) { resume(st); return; }
    if (LOCAL_LLM) send({ type: 'localllmInit' }); // local mode only: kick the one-time model download
    showHome();
  })();
})();
