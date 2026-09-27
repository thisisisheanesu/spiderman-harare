// Headless three.js check of the real-vehicle GLBs (GLTFLoader + MeshoptDecoder, RoomEnvironment + sun).
//
//   node tools/vehicles_real/verify/verify.mjs <outDir> <shots.json> [--models DIR] [--old DIR] [--raw DIR]
//
// Mounts: /models/ = the new set (default public/models/vehicles_real), /old/ = the generated set
// (default public/models/vehicles), /raw/ = raw downloads (optional). In shots, a model name may be
// prefixed with old: or raw: (see index.html for all query options). Writes <outDir>/<shot>.png and stats.json.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [outDir, shotsFile] = argv;
if (!outDir || !shotsFile) {
  console.error('usage: node verify.mjs <outDir> <shots.json> [--models DIR] [--old DIR] [--raw DIR]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm' };
const mounts = [
  ['/three/', path.join(REPO, 'node_modules/three/')],
  ['/models/', path.resolve(opt('--models', path.join(REPO, 'public/models/vehicles_real'))) + '/'],
  ['/old/', path.resolve(opt('--old', path.join(REPO, 'public/models/vehicles'))) + '/'],
  ['/raw/', path.resolve(opt('--raw', '/nonexistent')) + '/'],
  ['/', HERE + '/'],
];
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
const shots = JSON.parse(fs.readFileSync(shotsFile, 'utf8'));
const only = opt('--only', '');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const allStats = {};
for (const s of shots) {
  if (only && !only.split(',').includes(s.name)) continue;
  const page = await browser.newPage({ viewport: { width: s.width || 1600, height: s.height || 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const params = new URLSearchParams({ models: s.models.join(','), view: s.view || 'front34', lod: String(s.lod || 0) });
  for (const k of ['night', 'cols', 'paint', 'toggles', 'gap', 'zoom', 'fov', 'cam', 'labels', 'wire', 'backface', 'rawlen', 'rawopaque', 'views', 'gcols', 'shadow']) {
    if (s[k] !== undefined) params.set(k, String(s[k]));
  }
  await page.goto(`http://localhost:${port}/index.html?${params}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 600000 });
  const st = await page.evaluate(() => window.__stats);
  for (const [k, v] of Object.entries(st)) allStats[`${k}${s.lod ? '_lod1' : ''}`] = v;
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`), timeout: 600000 });
  if (errors.length) console.log(s.name, 'errors:', errors.slice(0, 5));
  console.log('shot', s.name);
  await page.close();
}
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(allStats, null, 1));
await browser.close();
server.close();
