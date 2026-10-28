import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const DIR = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad/vid';
import { promises as fs } from 'fs';
await fs.mkdir(DIR, { recursive: true });

const scenes = [
  { name: 'hero', y: 457 },
  { name: 'layers', y: 2675 },
];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const s of scenes) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: DIR, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
  await p.evaluate((y) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, y); }, s.y);
  await p.waitForTimeout(13000); // settle + one 11s animation loop + buffer
  const vp = await p.video().path();
  await p.close(); await ctx.close();
  const dest = `${DIR}/${s.name}.webm`;
  await fs.rename(vp, dest);
  console.log(`recorded ${s.name} -> ${dest}`);
}
await b.close();
