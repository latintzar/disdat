#!/usr/bin/env node
/**
 * Dis Dat — headless capture. Point it at any URL; it produces the same artifact shapes the
 * Dis Dat skill teaches agents to consume: real elements (computed + authored CSS incl. pseudo
 * rules), DOM outline, <head> meta, screenshots, first-party sources, WebGL shaders/uniforms.
 *
 * Runs entirely on YOUR machine — no account, no service, no upload. This is the agent's
 * autonomous eyes. For HUMAN reactions (voice + pointing + cross-page sessions + a hosted
 * pipeline), that's the Dis Dat extension: https://disdat.dev
 *
 * Usage:
 *   node capture.mjs <url> [--select "css,selectors"] [--out dir] [--full] [--sources]
 * Needs playwright:  npm i playwright && npx playwright install chromium
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find(a => /^https?:\/\//.test(a));
if (!url) { console.error('usage: node capture.mjs <url> [--select "css"] [--out dir] [--full] [--sources]'); process.exit(1); }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SELECT = opt('--select');
const OUT = opt('--out') || `./disdat-capture-${new URL(url).hostname}-${Date.now()}`;
const FULL = args.includes('--full');
const WANT_SOURCES = args.includes('--sources');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { try { ({ chromium } = await import('playwright-core')); } catch { console.error('playwright missing: npm i playwright && npx playwright install chromium'); process.exit(1); } }

// WebGL hook — installed before any page script runs, so shader sources + uniforms are caught at link time.
const GL_HOOK = `(() => {
  const progs = [];
  const wrap = (proto) => {
    if (!proto || proto.__dd) return; proto.__dd = 1;
    const srcs = new WeakMap();
    const oSS = proto.shaderSource; proto.shaderSource = function (sh, src) { srcs.set(sh, src); return oSS.call(this, sh, src); };
    const oLP = proto.linkProgram; proto.linkProgram = function (p) {
      const r = oLP.call(this, p);
      try {
        const gl = this, shs = gl.getAttachedShaders(p) || [];
        const rec = { vertex: '', fragment: '', uniforms: [] };
        for (const sh of shs) { const t = gl.getShaderParameter(sh, gl.SHADER_TYPE); const s = srcs.get(sh) || ''; if (t === gl.VERTEX_SHADER) rec.vertex = s; else rec.fragment = s; }
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
        for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); if (u) rec.uniforms.push({ name: u.name, type: u.type, size: u.size }); }
        progs.push(rec);
      } catch (e) {}
      return r;
    };
  };
  try { wrap(WebGLRenderingContext && WebGLRenderingContext.prototype); } catch (e) {}
  try { wrap(WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch (e) {}
  window.__ddGL = () => progs;
})();`;

const b = await chromium.launch({ executablePath: process.env.DISDAT_CHROME || undefined });
const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(GL_HOOK);
console.error(`[disdat] loading ${url} …`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => console.error('[disdat] networkidle timeout — capturing anyway'));
await page.waitForTimeout(2500);
await fs.mkdir(OUT, { recursive: true });

// ── screenshots ──
await page.screenshot({ path: path.join(OUT, 'screenshot-viewport.png') });
if (FULL) await page.screenshot({ path: path.join(OUT, 'screenshot-full.png'), fullPage: true });

// ── the in-page read: elements (computed + AUTHORED css), DOM outline, head, animations, GL ──
const data = await page.evaluate(({ SELECT }) => {
  const KEY_PROPS = ['display','position','width','height','margin','padding','color','background','background-image','font-family','font-size','font-weight','line-height','letter-spacing','border','border-radius','box-shadow','opacity','transform','transition','animation','filter','backdrop-filter','z-index','overflow','gap','grid-template-columns','flex','align-items','justify-content','text-align','inset','object-fit','mix-blend-mode'];
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    let s = el.tagName.toLowerCase();
    const cls = [...(el.classList || [])].slice(0, 3).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  // authored CSS: walk every reachable rule, keep those matching the element (incl. pseudo variants)
  const authoredFor = (el) => {
    const out = [];
    const scan = (rules) => {
      for (const rule of rules || []) {
        try {
          if (rule.selectorText) {
            const base = rule.selectorText.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
            let hit = false;
            try { hit = base && el.matches(base); } catch (e) {}
            if (!hit) { try { hit = el.matches(rule.selectorText); } catch (e) {} }
            if (hit) out.push(rule.cssText.length > 1200 ? rule.cssText.slice(0, 1200) + '…}' : rule.cssText);
          }
          if (rule.cssRules && rule.cssRules.length) scan(rule.cssRules);
        } catch (e) {}
      }
    };
    for (const sheet of document.styleSheets) { try { scan(sheet.cssRules); } catch (e) { /* cross-origin */ } }
    return out.slice(0, 60);
  };
  const factsOf = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const computed = {};
    for (const p of KEY_PROPS) { const v = cs.getPropertyValue(p); if (v && v !== 'none' && v !== 'normal' && v !== 'auto') computed[p] = v; }
    const anims = (el.getAnimations ? el.getAnimations() : []).map(a => ({ name: (a.animationName || (a.effect && a.effect.getKeyframes && 'waapi') || ''), duration: a.effect && a.effect.getTiming && a.effect.getTiming().duration, easing: a.effect && a.effect.getTiming && a.effect.getTiming().easing })).slice(0, 6);
    let gl = null;
    if (el.tagName === 'CANVAS' && window.__ddGL) { const progs = window.__ddGL(); if (progs.length) gl = { programs: progs.slice(0, 6) }; }
    return { selector: sel(el), tag: el.tagName.toLowerCase(), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, text: (el.innerText || '').slice(0, 200), computed, authored: authoredFor(el), animations: anims, html: el.outerHTML.length > 4000 ? el.outerHTML.slice(0, 4000) + '…' : el.outerHTML, gl };
  };
  // targets: explicit selectors, or the page's visually significant elements
  let targets = [];
  if (SELECT) {
    for (const s of SELECT.split(',')) { try { targets.push(...document.querySelectorAll(s.trim())); } catch (e) {} }
  } else {
    const all = [...document.querySelectorAll('body *')];
    targets = all.filter(el => { const r = el.getBoundingClientRect(); return r.width * r.height > 8000 && r.top < innerHeight * 3; })
      .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })
      .slice(0, 40);
  }
  // DOM outline (bounded)
  const outline = [];
  const walk = (el, d) => {
    if (d > 7 || outline.length > 800) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 && r.height < 4) return;
    outline.push('  '.repeat(d) + sel(el) + (el.className && typeof el.className === 'string' ? '' : '') + ` [${Math.round(r.width)}x${Math.round(r.height)}]`);
    for (const c of el.children) walk(c, d + 1);
  };
  walk(document.body, 0);
  const head = { title: document.title, meta: [...document.querySelectorAll('head meta[name],head meta[property]')].slice(0, 30).map(m => ({ k: m.getAttribute('name') || m.getAttribute('property'), v: (m.getAttribute('content') || '').slice(0, 200) })) };
  const fonts = [...new Set([...document.querySelectorAll('body *')].slice(0, 400).map(e => getComputedStyle(e).fontFamily))].slice(0, 8);
  const sources = [...document.scripts].map(s => s.src).filter(Boolean).slice(0, 60);
  const allGL = window.__ddGL ? window.__ddGL().slice(0, 8) : [];
  return { page: location.href, viewport: { w: innerWidth, h: innerHeight }, elements: targets.map(factsOf), outline: outline.join('\n'), head, fonts, sources, webgl: allGL };
}, { SELECT });

// ── first-party sources (optional) ──
if (WANT_SOURCES && data.sources.length) {
  const host = new URL(url).hostname, reg = host.split('.').slice(-2).join('.');
  const dir = path.join(OUT, 'sources'); await fs.mkdir(dir, { recursive: true });
  let bytes = 0;
  for (const s of data.sources) {
    try {
      const u = new URL(s);
      if (!(u.hostname === host || u.hostname.endsWith('.' + reg))) continue;
      const res = await fetch(s); if (!res.ok) continue;
      const t = await res.text(); if (bytes + t.length > 4_000_000) break; bytes += t.length;
      await fs.writeFile(path.join(dir, u.pathname.split('/').pop().slice(0, 80) || 'index.js'), t);
    } catch (e) {}
  }
  console.error(`[disdat] sources: ${Math.round(bytes / 1024)}KB`);
}

await fs.writeFile(path.join(OUT, 'core.json'), JSON.stringify({
  meta: { tool: 'disdat-skill headless', page: data.page, viewport: data.viewport, fonts: data.fonts },
  readme: 'Dis Dat headless capture: elements[] carry exact rects + computed AND authored CSS (incl. pseudo rules) + animations + (canvas) WebGL shaders/uniforms. Build from these EXACT values — do not guess. This capture has no human reaction attached; for voice + pointing captures use the Dis Dat extension (disdat.dev).',
  elements: data.elements, head: data.head, webgl: data.webgl,
}, null, 1));
await fs.writeFile(path.join(OUT, 'dom.txt'), data.outline);
await b.close();
console.error(`[disdat] ✓ capture → ${OUT}  (core.json · dom.txt · screenshots${WANT_SOURCES ? ' · sources/' : ''})`);
console.log(OUT);
