import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { promises as fs } from 'fs';
const ROOT = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad/vt';

// FULL virtual clock: the page's JS time (setTimeout/setInterval/rAF/performance.now/Date.now) only moves
// when we say so — so wall-clock-driven choreography (cursor paths, typing, phase machines) advances in
// EXACT lockstep with the frame counter instead of racing at real time (the 10x bug).
const CLOCK_PATCH = `(() => {
  let vt = 0; const t0 = Date.now();
  const timeouts = []; const rafs = []; let idc = 1;
  performance.now = () => vt;
  Date.now = () => t0 + vt;
  window.setTimeout = (fn, d = 0, ...a) => { const id = idc++; if (typeof fn === 'function') timeouts.push({ id, at: vt + Math.max(0, +d || 0), fn, a }); return id; };
  window.setInterval = (fn, d = 16, ...a) => { const id = idc++; if (typeof fn === 'function') timeouts.push({ id, at: vt + Math.max(1, +d || 16), fn, a, iv: Math.max(1, +d || 16) }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { const i = timeouts.findIndex(t => t.id === id); if (i >= 0) timeouts.splice(i, 1); };
  window.requestAnimationFrame = (fn) => { const id = idc++; rafs.push({ id, fn }); return id; };
  window.cancelAnimationFrame = (id) => { const i = rafs.findIndex(r => r.id === id); if (i >= 0) rafs.splice(i, 1); };
  window.__vtNow = () => vt;
  window.__vtAdvance = (ms, step = 16.667) => {
    const target = vt + ms;
    while (vt < target) {
      vt = Math.min(vt + step, target);
      timeouts.sort((x, y) => x.at - y.at);
      while (timeouts.length && timeouts[0].at <= vt) { const t = timeouts.shift(); try { t.fn(...t.a); } catch (e) {} if (t.iv) { t.at = vt + t.iv; timeouts.push(t); } }
      const batch = rafs.splice(0);
      for (const r of batch) { try { r.fn(vt); } catch (e) {} }
    }
    return vt;
  };
  // WAAPI/CSS animations run on the browser clock, not JS — pause every one, every frame, and place it at
  // its own LOCAL time (virtual now minus when we first saw it), so late-created animations stay correct.
  window.__animSeen = new Map();
  window.__syncAnims = () => { document.getAnimations().forEach(a => { try { a.pause(); if (!window.__animSeen.has(a)) window.__animSeen.set(a, vt); a.currentTime = vt - window.__animSeen.get(a); } catch (e) {} }); };
})();`;

const CLEAN_CSS = `
  .ddnav,#ddnav{display:none!important}
  .hstagewrap{aspect-ratio:1102/620 !important; border-radius:0 !important; box-shadow:none !important; max-width:1040px !important}
  .hstage{width:1102px !important; transform:scale(calc(100cqw * (1 / 1102px))) !important}
  .devstage .hstagewrap{max-width:1040px !important}`;

const scenes = [
  { name: 'hero', sel: '.hero3 .hstagewrap' },
  { name: 'layers', sel: '#dev .hstagewrap' },
];
const DUR = 11000, FPS = 24, N = Math.round(DUR / 1000 * FPS);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
for (const s of scenes) {
  const dir = `${ROOT}/${s.name}`; await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(CLOCK_PATCH);
  const p = await ctx.newPage();
  await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
  await p.addStyleTag({ content: CLEAN_CSS });
  // let the page's own setup (timeout/rAF retry loops) run — in VIRTUAL time
  await p.evaluate(() => { window.__vtAdvance(6000); window.__syncAnims(); });
  const el = await p.$(s.sel);
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250); // real settle for scroll/layout only
  await p.evaluate(() => { window.__vtAdvance(500); window.__syncAnims(); }); // settle choreography post-scroll
  for (let f = 0; f < N; f++) {
    await p.evaluate((dt) => { window.__vtAdvance(dt); window.__syncAnims(); }, DUR / N);
    await el.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
    if (f % 48 === 0) console.log(`${s.name} ${f}/${N}`);
  }
  await ctx.close();
  console.log(`DONE ${s.name}`);
}
await b.close();
console.log('ALL DONE');
