// Verification page server: / -> this folder, /repo/ -> the game repo (public/, node_modules/three, tools/).
// node tools/materials/verify/server.mjs 8791   then   node tools/materials/verify/shoot.mjs out.png "scene=board"
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..', '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
  '.wasm': 'application/wasm' };
const port = Number(process.argv[2] || 8791);
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file = p.startsWith('/repo/') ? path.join(REPO, p.slice(6)) : path.join(HERE, p === '/' ? 'index.html' : p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 ' + p); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('serving on', port));
