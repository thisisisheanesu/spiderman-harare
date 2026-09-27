// Headless screenshot of the facade-kit verification page (Chromium + SwiftShader, playwright-core from the repo).
//   node tools/facades/verify/shoot.mjs out.png "scene=building&id=2200&view=street" [w] [h]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'package.json'));
const { chromium } = require('playwright-core');
const [out, query = 'scene=lineup', w = '960', h = '540'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url()); });
await page.goto(`http://localhost:${process.env.PORT || 8793}/?${query}&w=${w}&h=${h}`);
try {
  await page.waitForFunction(() => window.__done === true, null, { timeout: Number(process.env.SHOOT_TIMEOUT || 600000) });
} catch (e) {
  logs.push('timeout waiting for __done');
}
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({ info: window.__info, errors: window.__errors }));
console.log(JSON.stringify(info));
console.log(logs.filter((l) => !l.includes('GPU stall') && !l.includes('WebGL')).slice(0, 30).join('\n'));
await browser.close();
