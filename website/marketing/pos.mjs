import pkg from '/root/.claude/skills/gstack/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const DIR = '/tmp/claude-1003/-home-peter/bf044b96-1bf9-4fe2-8a5c-d834d3345988/scratchpad';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await p.goto('https://disdat.dev/research-vision.html', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);
const info = await p.evaluate(() => {
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; };
  return {
    total: document.body.scrollHeight,
    herodemo: g('.herodemo'), hstage: g('.hstagewrap'),
    who: g('#who'), dev: g('#dev'), devdemo: g('#dev .hstagewrap') || g('#dev .demo1') || g('#dev .herodemo'),
    heroh1: g('.hero3 h1'),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
