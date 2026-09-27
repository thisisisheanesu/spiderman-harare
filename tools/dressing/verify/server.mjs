// Static server for the dressing verification pages.
//   node tools/dressing/verify/server.mjs [port]
//   /          -> tools/dressing/verify/          /repo/ -> the repo (public/, node_modules/three, src/)
//   /work/     -> $DRESSING_WORK (Blender intermediates)   /photos/ -> $DRESSING_PHOTOS (reference photos)
//   /cfg/      -> $DRESSING_CFG_DIR (scene json written by shot.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..', '..', '..');
const WORK = process.env.DRESSING_WORK || '/tmp/dressing-work';
const PHOTOS = process.env.DRESSING_PHOTOS || '/tmp/photos';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const port = Number(process.argv[2] || 8795);
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (p.startsWith('/repo/')) file = path.join(REPO, p.slice(6));
  else if (p.startsWith('/work/')) file = path.join(WORK, p.slice(6));
  else if (p.startsWith('/photos/')) file = path.join(PHOTOS, p.slice(8));
  else if (p.startsWith('/cfg/')) file = path.join(process.env.DRESSING_CFG_DIR || '/tmp', p.slice(5));
  else file = path.join(HERE, p === '/' ? 'viewer.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 ' + p); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('serving on', port));
