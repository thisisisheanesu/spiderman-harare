// Headless three.js check of the vehicle GLBs (GLTFLoader + MeshoptDecoder, RoomEnvironment lighting).
//
//   node tools/vehicles/verify/verify.mjs <modelsDir> <outDir> [shots.json]
//
// Serves this folder, the repo's node_modules/three and <modelsDir>; takes screenshots with the repo's
// playwright-core + Chromium (CHROME_PATH, default /opt/pw-browsers/chromium) and writes stats.json
// (node names, material names, triangle counts, bounding boxes, wheel pivots) for every model.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const [modelsDir, outDir, shotsFile] = process.argv.slice(2);
if (!modelsDir || !outDir) {
  console.error('usage: node verify.mjs <modelsDir> <outDir> [shots.json]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm' };
const mounts = [['/three/', path.join(REPO, 'node_modules/three/')], ['/models/', path.resolve(modelsDir) + '/'], ['/', HERE + '/']];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  for (const [prefix, dir] of mounts) {
    if (url.startsWith(prefix)) {
      const p = path.join(dir, url.slice(prefix.length) || 'index.html');
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
        fs.createReadStream(p).pipe(res);
        return;
      }
    }
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const allModels = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.glb') && !f.endsWith('_lod1.glb')).map((f) => f.slice(0, -4));
const shots = shotsFile ? JSON.parse(fs.readFileSync(shotsFile, 'utf8')) : [
  { name: 'all_front34', models: allModels, view: 'front34' },
  { name: 'all_rear34', models: allModels, view: 'rear34' },
  { name: 'all_lod1_front34', models: allModels, view: 'front34', lod: 1 },
  { name: 'all_night', models: allModels, view: 'front34', night: 1 },
];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const allStats = {};
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width || 1600, height: s.height || 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const params = new URLSearchParams({ models: s.models.join(','), view: s.view || 'front34', lod: String(s.lod || 0) });
  for (const k of ['night', 'cols', 'paint', 'toggles', 'gap', 'zoom', 'fov']) if (s[k] !== undefined) params.set(k, String(s[k]));
  await page.goto(`http://localhost:${port}/index.html?${params}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
  const st = await page.evaluate(() => window.__stats);
  for (const [k, v] of Object.entries(st)) allStats[`${k}${s.lod ? '_lod1' : ''}`] = v;
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
  if (errors.length) console.log(s.name, 'errors:', errors.slice(0, 5));
  console.log('shot', s.name);
  await page.close();
}
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(allStats, null, 1));
await browser.close();
server.close();
