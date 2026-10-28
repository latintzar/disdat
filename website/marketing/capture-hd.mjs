import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { promises as fs } from 'fs';
const ROOT = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad/hd';
const CLEAN_CSS = `
  .ddnav,#ddnav{display:none!important}
  .hstagewrap{aspect-ratio:1102/620 !important; border-radius:0 !important; box-shadow:none !important; max-width:1040px !important}
  .hstage{width:1102px !important; transform:scale(calc(100cqw * (1 / 1102px))) !important}
  .devstage .hstagewrap{max-width:1040px !important}`;
const scenes = [
  { name: 'hero', sel: '.hero3 .hstagewrap' },
  { name: 'layers', sel: '#dev .hstagewrap' },
];
const DUR = 11000, FPS = 24, N = Math.round(DUR / 1000 * FPS); // 264 frames = one exact loop
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
for (const s of scenes) {
  const dir = `${ROOT}/${s.name}`; await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
  await p.addStyleTag({ content: CLEAN_CSS });
  await p.waitForTimeout(4200); // demos self-setup
  const el = await p.$(s.sel);
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getAnimations().forEach(a => a.pause()));
  for (let f = 0; f < N; f++) {
    await p.evaluate((t) => document.getAnimations().forEach(a => { try { a.currentTime = t; } catch (e) {} }), f * (DUR / N));
    await p.waitForTimeout(55); // let rAF-driven bits settle to the seeked clock
    await el.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
    if (f % 48 === 0) console.log(`${s.name} ${f}/${N}`);
  }
  await p.close();
  console.log(`DONE ${s.name}: ${N} frames`);
}
await b.close();
console.log('ALL DONE');
