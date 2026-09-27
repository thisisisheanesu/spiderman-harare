// usage: node shot.mjs <url> <out.png> [timeoutMs]
import { chromium } from '/home/user/spiderman-harare/node_modules/playwright-core/index.mjs';
const [url, out, tmo] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.on('console', m => console.log('[page]', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__done === true, null, { timeout: +(tmo || 240000) });
const el = await page.$('canvas');
if (el) await el.screenshot({ path: out }); else await page.screenshot({ path: out });
await browser.close();
