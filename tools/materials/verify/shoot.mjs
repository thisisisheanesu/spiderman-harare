// Headless screenshot of the verification page (Chromium + SwiftShader, playwright-core from the repo).
//   node tools/materials/verify/shoot.mjs out.png "scene=board&cols=8" [w] [h]
// scenes: board (material swatches; filter=, cols=, sunpos=), props / tall (lineups; part=1|2, lod=1, only=a,b),
//         hdri (IBL spheres), street (view=street|close|swing|oblique, night=1)
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'package.json'));
const { chromium } = require('playwright-core');
const [out, query = 'scene=board', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${process.env.PORT || 8791}/?${query}&w=${w}&h=${h}`);
try {
  await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
} catch (e) {
  logs.push('timeout waiting for __done');
}
await page.waitForTimeout(500);
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({ info: window.__info, errors: window.__errors, stats: window.__stats }));
console.log(JSON.stringify(info));
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
