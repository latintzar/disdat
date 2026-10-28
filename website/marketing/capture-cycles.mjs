import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { promises as fs } from 'fs';
const SP = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad';
const srcVt = await fs.readFile(`${SP}/capture-vt.mjs`, 'utf8');
const CLOCK_PATCH = srcVt.slice(srcVt.indexOf('`(() => {') + 1, srcVt.indexOf('})();`') + 5); // reuse the proven patch body
const CLEAN_CSS = `
  .ddnav,#ddnav{display:none!important}
  .hstagewrap{aspect-ratio:1102/620 !important; border-radius:0 !important; box-shadow:none !important; max-width:1040px !important}
  .hstage{width:1102px !important; transform:scale(calc(100cqw * (1 / 1102px))) !important}
  .devstage .hstagewrap{max-width:1040px !important}
  /* kill EVERY tween that mid-frames a blur/double-exposure at 24fps: the dim's backdrop AND the
     winchrome's 0.5s filter/transform tween (the surviving 'mirror' Peter kept seeing) */
  .vnote-dim{transition:none !important}
  .vhero .winchrome{transition:none !important}
  .vhero .cview,.vhero .page{transition:none !important}
  /* the subtitle pill must vanish when it has no text (was lingering as an empty dark blob) */
  .herodemo .vcaption:has(.vcap-tx:empty){opacity:0 !important}
  /* the narration caption becomes a SUBTITLE bar over the stage bottom (it lives below the stage on the site) */
  .herodemo{position:relative}
  .herodemo .vcaption{position:absolute; bottom:22px; left:50%; transform:translateX(-50%); z-index:80; margin:0 !important; height:auto !important; min-height:0 !important; max-width:78%; background:rgba(22,17,13,.85) !important; border:none !important; border-radius:12px !important; padding:10px 20px !important}
  .herodemo .vcap-tx{color:#FBF7EE !important; font-size:16.5px !important}
  .herodemo .vcap-wave i{background:#FF5C2A !important}`;
// inject the CSS the instant <html> exists — BEFORE any page script measures anything
const STYLE_INJECT = `(() => { const css = ${JSON.stringify(CLEAN_CSS)};
  const put = () => { const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st); };
  if (document.documentElement) put();
  else new MutationObserver((m, o) => { if (document.documentElement) { put(); o.disconnect(); } }).observe(document, { childList: true });
})();`;

const FPS = 24, STEP = 1000 / FPS;
const scenes = [ // hero-only re-run

  // hero: cycle = browsing → code-speak card → codex; ends when reset() flips codex→poster
  { name: 'hero', sel: '.hero3 .hstagewrap', stageSel: '.vhero', endFrom: 'codex', endTo: 'poster', maxMs: 22000 },
  // layers: poster → decomp (x-ray hovering) → shot (heatmap); run() restarts at 14.8s → shot→poster
];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
for (const s of scenes) {
  const dir = `${SP}/cyc/${s.name}`; await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(CLOCK_PATCH);
  await ctx.addInitScript(STYLE_INJECT);
  const p = await ctx.newPage();
  await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
  const el = await p.$(s.sel);
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400); // real: let the IntersectionObserver arm the scene
  // find the cycle START: advance until the end-transition fires once (so we begin exactly at a fresh cycle)
  let prev = await p.evaluate((ss) => document.querySelector(ss)?.getAttribute('data-phase'), s.stageSel);
  let hunted = 0;
  while (hunted < s.maxMs + 8000) {
    const ph = await p.evaluate(([ss]) => { window.__vtAdvance(100); window.__syncAnims(); return document.querySelector(ss)?.getAttribute('data-phase'); }, [s.stageSel]);
    if (prev === s.endFrom && ph === s.endTo) break; // a reset just happened → cycle start
    prev = ph; hunted += 100;
  }
  console.log(`${s.name}: cycle start found after ${hunted}ms hunt`);
  // capture one FULL cycle: frames until the end-transition fires again
  let f = 0; prev = s.endTo;
  while (f * STEP < s.maxMs) {
    const ph = await p.evaluate(([ss, dt]) => { window.__vtAdvance(dt); window.__syncAnims(); return document.querySelector(ss)?.getAttribute('data-phase'); }, [s.stageSel, STEP]);
    await el.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
    f++;
    if (prev === s.endFrom && ph === s.endTo) break; // loop closed
    prev = ph;
    if (f % 72 === 0) console.log(`${s.name} ${f} frames…`);
  }
  console.log(`DONE ${s.name}: ${f} frames = ${(f / FPS).toFixed(1)}s`);
  await ctx.close();
}
await b.close();
console.log('ALL DONE');
