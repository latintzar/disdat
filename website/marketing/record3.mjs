import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { promises as fs } from 'fs';
const DIR = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad/vid3';
await fs.mkdir(DIR, { recursive: true });
// DSF 3 for true-HD crispness; the element renders at 3x native pixels
const scenes = [ { name: 'hero', sel: '.herodemo' }, { name: 'layers', sel: '.devstage' } ];
const VW = 1440, VH = 1080, S = 3;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', `--force-device-scale-factor=${S}`] });
const rects = {};
for (const s of scenes) {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: S, recordVideo: { dir: DIR, size: { width: VW * S, height: VH * S } } });
  const p = await ctx.newPage();
  await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
  await p.addStyleTag({ content: '.ddnav,#ddnav{display:none!important}' });
  const rect = await p.evaluate((sel) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const el = document.querySelector(sel); const r0 = el.getBoundingClientRect();
    window.scrollTo(0, r0.top + scrollY - 24);
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, s.sel);
  rects[s.name] = rect;
  await p.waitForTimeout(13500);
  const vp = await p.video().path();
  await p.close(); await ctx.close();
  await fs.rename(vp, `${DIR}/${s.name}.webm`);
  console.log(`${s.name}: ${JSON.stringify(rect)}`);
}
await fs.writeFile(`${DIR}/rects.json`, JSON.stringify({ rects, SCALE: S }, null, 2));
await b.close();
