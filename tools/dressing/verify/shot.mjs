// node tools/dressing/verify/shot.mjs <out.png> <scene.json> [port] [w] [h]
// Renders viewer.html?cfg=<scene.json> in headless Chromium (SwiftShader) and saves the canvas.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../node_modules/playwright-core/index.mjs';
const [out, cfgPath, port = '8795', w = '960', h = '540'] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const name = 'cfg_' + path.basename(cfgPath);
fs.copyFileSync(cfgPath, path.join(process.env.DRESSING_CFG_DIR || '/tmp', name));
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).sort().pop();
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/viewer.html?cfg=/cfg/${name}&w=${w}&h=${h}`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 300000 });
const stats = await page.evaluate(() => window.__stats);
if (stats) console.log('stats', JSON.stringify(stats));
await (await page.$('canvas')).screenshot({ path: out });
await browser.close();
