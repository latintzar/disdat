// Dis Dat — main-world shim. Injected into the PAGE's own JS world (not the isolated
// content-script world) so it can read what the isolated world CAN'T: the page's
// fetch/XHR responses, its console errors, its bound listeners, and — the big one —
// the framework internals (`__reactFiber$` / `__vue__` / `__svelte_meta`) that carry
// component identity, props, state, and the build-time source pointer (file:line).
// The isolated content script can't see those page expandos at all, which is exactly
// why every captured `react` fact used to come back null. No CDP, no debugger banner.
// It only forwards compact facts via postMessage; the content script decides what to
// keep (only while recording). All hooks install ONCE and gate on a recOn flag the
// content side toggles, so re-recording on the same page keeps working.
(() => {
  if (window.__disdatShim) return; window.__disdatShim = true;
  let recOn = false;
  const MAX = 1200, MAXV = 60;
  const snip = (s) => { s = typeof s === 'string' ? s : ''; return s.length > MAX ? s.slice(0, MAX) + '…[+' + (s.length - MAX) + ' chars]' : s; };
  const post = (o) => { try { window.postMessage(o, '*'); } catch (e) {} };

  // ---------- response-shape inference (top-level keys + value TYPES, not raw data) ----------
  function shapeOf(v, d) {
    d = d || 0;
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? '[' + shapeOf(v[0], d + 1) + (v.length > 1 ? ' ×' + v.length : '') + ']' : '[]';
    const t = typeof v;
    if (t === 'object') { if (d > 2) return '{…}'; const o = {}; let n = 0; for (const k in v) { if (n++ >= 12) { o['…'] = ''; break; } o[k] = shapeOf(v[k], d + 1); } return o; }
    return t; // 'string' | 'number' | 'boolean'
  }
  function shapeOfBody(b) { try { return shapeOf(JSON.parse(b)); } catch (e) { return null; } }

  // ---------- network: the FULL exchange (req+res headers/body) + streaming (fetch-SSE / WS / EventSource) ----------
  // Captures the exact observed protocol so an agent can rebuild the real contract — not just shapes.
  // Tokens/cookies redacted; bodies capped; stream frames capped per connection.
  const NETMAX = 8000;
  const privacy = globalThis.DisdatPrivacy;
  function redact(s) {
    try {
      if (!privacy) return '⟦redaction-unavailable⟧';
      return privacy.clean(String(s));
    } catch (e) { return '⟦redacted-body⟧'; }
  }
  function netBody(s) { s = redact(typeof s === 'string' ? s : ''); return s.length > NETMAX ? s.slice(0, NETMAX) + '…[+' + (s.length - NETMAX) + ' chars]' : s; }
  function hdrsOf(h) { const o = {}; try { if (h && h.forEach) h.forEach((v, k) => { o[k] = /authorization|cookie|api-key|token|secret/i.test(k) ? '«redacted»' : String(v).slice(0, 200); }); } catch (e) {} return Object.keys(o).length ? o : null; }
  function reqBodyOf(init) { try { const b = init && init.body; if (!b) return null; if (typeof b === 'string') return netBody(b); if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return netBody(b.toString()); if (typeof FormData !== 'undefined' && b instanceof FormData) return netBody([...b.entries()].map(e => e[0] + '=' + e[1]).join('&')); return '(' + (b.constructor && b.constructor.name || 'body') + ')'; } catch (e) { return null; } }
  function spyStream(rs, meta) {
    try {
      const reader = rs.getReader(), dec = new TextDecoder(); let n = 0, buf = '';
      const pump = () => reader.read().then(({ done, value }) => {
        if (done || n >= 50) { try { reader.cancel(); } catch (e) {} return; }
        try { buf += dec.decode(value, { stream: true }); let idx; while ((idx = buf.indexOf('\n\n')) >= 0 && n < 50) { const frame = buf.slice(0, idx); buf = buf.slice(idx + 2); if (frame.trim()) { n++; post({ __disdat_net: Object.assign({ kind: 'stream', frame: netBody(frame) }, meta) }); } } } catch (e) {}
        return pump();
      }).catch(() => {});
      pump();
    } catch (e) {}
  }
  const of = window.fetch;
  if (of) window.fetch = function (...a) {
    const url = (a[0] && a[0].url) || a[0] || '';
    const init = a[1] || (a[0] && typeof a[0] === 'object' && a[0].method ? a[0] : {}) || {};
    const method = (init && init.method) || (a[0] && a[0].method) || 'GET';
    let reqHeaders = null, reqBody = null; try { reqHeaders = hdrsOf(init.headers && init.headers.forEach ? init.headers : (init.headers ? new Headers(init.headers) : null)); reqBody = reqBodyOf(init); } catch (e) {}
    const t0 = performance.now();
    return of.apply(this, a).then(res => {
      if (!recOn) return res;
      const ct = (() => { try { return res.headers.get('content-type') || ''; } catch (e) { return ''; } })();
      const meta = { kind: 'fetch', method, url: String(url), status: res.status, reqHeaders, reqBody, resHeaders: hdrsOf(res.headers), contentType: ct, ms: Math.round(performance.now() - t0) };
      try {
        if (res.body && /event-stream|ndjson|text\/plain|application\/stream/.test(ct)) { spyStream(res.clone().body, meta); return res; } // streaming → read a CLONE (page untouched)
      } catch (e) {}
      try { res.clone().text().then(b => post({ __disdat_net: Object.assign({ shape: shapeOfBody(b), body: netBody(b) }, meta) })).catch(() => {}); } catch (e) {}
      return res;
    }, err => { if (recOn) post({ __disdat_net: { kind: 'fetch', method, url: String(url), status: 0, reqBody, body: '(fetch error: ' + (err && err.message || '') + ')' } }); throw err; });
  };
  const OX = window.XMLHttpRequest;
  if (OX && OX.prototype) {
    const open = OX.prototype.open, send = OX.prototype.send, setH = OX.prototype.setRequestHeader;
    OX.prototype.open = function (m, u) { this.__dd = { m, u, h: {} }; return open.apply(this, arguments); };
    OX.prototype.setRequestHeader = function (k, v) { try { if (this.__dd) this.__dd.h[k] = /authorization|cookie|api-key|token|secret/i.test(k) ? '«redacted»' : v; } catch (e) {} return setH.apply(this, arguments); };
    OX.prototype.send = function (body) {
      const x = this, reqBody = (typeof body === 'string') ? netBody(body) : (body ? '(' + (body.constructor && body.constructor.name) + ')' : null);
      x.addEventListener('load', () => { if (!recOn) return; try { const rb = (x.responseType === '' || x.responseType === 'text') ? x.responseText : ('(' + x.responseType + ')'); post({ __disdat_net: { kind: 'xhr', method: (x.__dd && x.__dd.m) || 'GET', url: String((x.__dd && x.__dd.u) || ''), status: x.status, reqHeaders: (x.__dd && Object.keys(x.__dd.h).length ? x.__dd.h : null), reqBody, shape: shapeOfBody(rb), body: netBody(rb) } }); } catch (e) {} });
      return send.apply(this, arguments);
    };
  }
  // WebSocket — the live frame protocol (send + recv), capped per socket
  const OWS = window.WebSocket;
  if (OWS) {
    const WS = function (url, protocols) {
      const ws = protocols !== undefined ? new OWS(url, protocols) : new OWS(url);
      let n = 0; const CAP = 40;
      const cap = (dir, data) => { if (!recOn) return; if (n >= CAP) { if (n === CAP) { n++; post({ __disdat_net: { kind: 'ws', url: String(url), dir, body: '(…further frames omitted)' } }); } return; } n++; let d = ''; try { d = typeof data === 'string' ? data : '(' + (data && data.constructor && data.constructor.name || 'binary') + ')'; } catch (e) {} post({ __disdat_net: { kind: 'ws', url: String(url), dir, shape: shapeOfBody(d), body: netBody(d) } }); };
      try { const os = ws.send; ws.send = function (d) { try { cap('send', d); } catch (e) {} return os.apply(this, arguments); }; } catch (e) {}
      try { ws.addEventListener('message', e => { try { cap('recv', e.data); } catch (err) {} }); } catch (e) {}
      return ws;
    };
    try { WS.prototype = OWS.prototype; ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED'].forEach(k => WS[k] = OWS[k]); window.WebSocket = WS; } catch (e) {}
  }
  // EventSource (SSE) — the streamed event taxonomy, capped
  const OES = window.EventSource;
  if (OES) {
    const ES = function (url, cfg) {
      const es = cfg !== undefined ? new OES(url, cfg) : new OES(url);
      let n = 0; const CAP = 50;
      try { es.addEventListener('message', e => { if (!recOn || n >= CAP) return; n++; try { post({ __disdat_net: { kind: 'sse', url: String(url), event: e.type, lastEventId: e.lastEventId || '', shape: shapeOfBody(e.data), body: netBody(e.data) } }); } catch (err) {} }); } catch (e) {}
      return es;
    };
    try { ES.prototype = OES.prototype; ['CONNECTING', 'OPEN', 'CLOSED'].forEach(k => ES[k] = OES[k]); window.EventSource = ES; } catch (e) {}
  }

  // ---------- console errors / warnings + uncaught errors (the "it's broken" signal) ----------
  function pushC(level, args) {
    if (!recOn) return;
    try {
      const msg = Array.prototype.map.call(args, a => { try { return typeof a === 'string' ? a : (a && a.stack) ? String(a.stack).split('\n').slice(0, 3).join(' ⏎ ') : (a && a.message) ? a.message : JSON.stringify(a); } catch (e) { return String(a); } }).join(' ').slice(0, 320);
      if (msg) post({ __disdat_console: { level, msg } });
    } catch (e) {}
  }
  ['error', 'warn'].forEach(lvl => { const o = console[lvl]; if (typeof o === 'function') console[lvl] = function () { try { pushC(lvl, arguments); } catch (e) {} return o.apply(this, arguments); }; });
  window.addEventListener('error', e => pushC('error', [(e && e.message) || 'error', e && e.filename ? ('@' + e.filename + ':' + e.lineno) : '']));
  window.addEventListener('unhandledrejection', e => { const r = e && e.reason; pushC('error', ['unhandledrejection:', (r && (r.stack || r.message)) || String(r)]); });

  // ---------- bound-listener registry (best-effort: only listeners added after the
  // shim installs are seen; we never assert ABSENCE, only report what we caught) ----------
  const LREG = new WeakMap();
  const OAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try { if (this && this.nodeType === 1) { let s = LREG.get(this); if (!s) { s = new Set(); LREG.set(this, s); } if (s.size < 16) s.add(String(type)); } } catch (e) {}
    return OAdd.apply(this, arguments);
  };
  function listenersFor(el) {
    try {
      const set = new Set(); let n = el, hops = 0;
      while (n && n.nodeType === 1 && hops++ < 3) { const s = LREG.get(n); if (s) for (const t of s) set.add(t); n = n.parentElement; }
      const keep = [...set].filter(t => /^(click|mousedown|mouseup|dblclick|keydown|keyup|keypress|input|change|submit|focus|blur|pointerdown|pointerup|touchstart|drag|wheel|scroll)/.test(t));
      return keep.length ? keep.slice(0, 8) : null;
    } catch (e) { return null; }
  }

  // ---------- framework internals: component · props · state · source-pointer ----------
  function pickObj(o) {
    const out = {}; let n = 0;
    for (const k in o) {
      if (n++ >= 12) break;
      if (k[0] === '_' || k === 'children') continue;
      let v; try { v = o[k]; } catch (e) { continue; }
      const ty = typeof v;
      if (ty === 'function') out[k] = 'ƒ';
      else if (Array.isArray(v)) out[k] = '[' + v.length + ']';
      else if (v && ty === 'object') out[k] = '{…}';
      else out[k] = String(v).slice(0, MAXV);
    }
    return Object.keys(out).length ? out : null;
  }
  // best-effort React hook state: memoizedState is a linked list of hook cells; collect
  // the primitive/plain useState values, skipping refs (current) and effects (deps).
  function hookState(fiber) {
    try {
      let h = fiber.memoizedState, out = [], n = 0;
      while (h && n++ < 10) {
        const m = h.memoizedState, ty = typeof m;
        if (m !== null && (ty === 'string' || ty === 'number' || ty === 'boolean')) out.push(m);
        else if (m && ty === 'object' && !('current' in m) && !m.deps && !m.tag) { const p = pickObj(m); if (p) out.push(p); }
        h = h.next;
      }
      return out.length ? out.slice(0, 6) : null;
    } catch (e) { return null; }
  }
  function reactInfo(el) {
    let props = null, fiber = null;
    for (const k in el) {
      if (!props && k.indexOf('__reactProps$') === 0) props = pickObj(el[k] || {});
      if (!fiber && k.indexOf('__reactFiber$') === 0) fiber = el[k];
      if (props && fiber) break;
    }
    let component = null, state = null, source = null, f = fiber, hops = 0;
    while (f && hops++ < 14) {
      const t = f.type;
      if (typeof t === 'function') component = t.displayName || t.name || component;
      else if (t && typeof t === 'object') component = t.displayName || (t.render && (t.render.displayName || t.render.name)) || component;
      if (!props && f.memoizedProps) props = pickObj(f.memoizedProps);
      if (!source && f._debugSource) { const d = f._debugSource; source = (d.fileName || '') + ':' + (d.lineNumber || '') + (d.columnNumber ? ':' + d.columnNumber : ''); } // React ≤19.1 only
      if (component) { state = hookState(f); break; }
      f = f.return;
    }
    return { component, props, state, source };
  }
  function vueInfo(el) {
    try {
      if (el.__vueParentComponent) { const c = el.__vueParentComponent, t = c.type || {}; return { component: t.__name || t.name || 'VueComponent', props: pickObj(c.props || {}), state: pickObj(c.setupState || {}) }; }
      if (el.__vue__) { const v = el.__vue__; return { component: (v.$options && (v.$options.name || v.$options._componentTag)) || 'VueComponent', props: pickObj(v.$props || {}) }; }
    } catch (e) {}
    return null;
  }
  // Source pointer — NOT _debugSource (removed in React 19.2). Framework-agnostic SOTA is
  // build-time data attributes; Svelte ships __svelte_meta.loc free. file:line:col.
  function sourcePointer(el) {
    try {
      const a = el.closest('[data-insp-path],[data-inspector-relative-path],[data-v-inspector],[data-v-inspector-file]');
      if (a) {
        const insp = a.getAttribute('data-insp-path'); if (insp) return insp;                 // code-inspector-plugin → "path/file:line:col"
        const vi = a.getAttribute('data-v-inspector'); if (vi) return vi;                       // vite-plugin-vue-inspector → "file:line:col"
        const rel = a.getAttribute('data-inspector-relative-path');                             // react-dev-inspector
        if (rel) return rel + ':' + (a.getAttribute('data-inspector-line') || '') + ':' + (a.getAttribute('data-inspector-column') || '');
      }
      if (el.__svelte_meta && el.__svelte_meta.loc) { const l = el.__svelte_meta.loc; return (l.file || '') + ':' + (l.line || '') + (l.column != null ? ':' + l.column : ''); }
    } catch (e) {}
    return null;
  }

  // ---------- request/response: content tags an element (data-dd-fw=token), we read it
  // HERE in the page world (the only place the framework internals are visible) ----------
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data) return;
    const d = e.data;
    if (d.__disdat_rec !== undefined) { recOn = !!d.__disdat_rec; return; }
    const tok = d.__disdat_fw_req;
    if (tok) {
      let fw = null;
      try {
        const el = document.querySelector('[data-dd-fw-' + tok + ']');
        if (el) {
          const r = reactInfo(el), v = (!r.component && !r.props) ? vueInfo(el) : null;
          fw = {
            component: r.component || (v && v.component) || null,
            props: r.props || (v && v.props) || null,
            state: r.state || (v && v.state) || null,
            source: r.source || sourcePointer(el) || null,
            listeners: listenersFor(el)
          };
          if (!fw.component && !fw.props && !fw.state && !fw.source && !fw.listeners) fw = null;
        }
      } catch (err) {}
      post({ __disdat_fw_res: { token: tok, fw } });
    }
  });
})();
