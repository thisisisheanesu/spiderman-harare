// Headless Chromium driver for review_viewer.html.
//   node review_shot.mjs "<query>" out.(png|jpg|json)
// Serve a directory containing review_viewer.html, `three` -> node_modules/three and `pub` -> public/models,
// e.g. python3 -m http.server 5471, or set REVIEW_URL to the viewer's URL. A .json output saves window.__stats (mode=stats).
import { chromium } from '/home/user/spiderman-harare/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [q, out] = process.argv.slice(2);
const base = process.env.REVIEW_URL || 'http://127.0.0.1:5471/review_viewer.html';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('console', m => { const t = m.text(); if (!t.startsWith('THREE.WebGLRenderer')) console.log('[page]', t.slice(0, 400)); });
await page.goto(base + '?' + q);
await page.waitForFunction(() => window.__done === true, null, { timeout: 600000 });
if (out.endsWith('.json')) fs.writeFileSync(out, JSON.stringify(await page.evaluate(() => window.__stats)));
else { const el = await page.$('canvas'); await el.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', ...(out.endsWith('.jpg') ? { quality: 88 } : {}) }); }
await browser.close();
