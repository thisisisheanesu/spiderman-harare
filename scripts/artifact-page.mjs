#!/usr/bin/env node
// Turn a Vite build's index.html into a hosted-page body: the artifact host supplies the
// <!doctype>/<head>/<body> skeleton, so we keep the title, stylesheet, markup and module script only.
//   node scripts/artifact-page.mjs <distDir>   -> writes <distDir>/page.html
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] || 'dist';
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const script = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)[1];
const styles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();

const page = [
  title,
  ...styles.map((href) => `<link rel="stylesheet" href="${href}">`),
  body,
  `<script type="module" src="${script}"></script>`,
  '',
].join('\n');
fs.writeFileSync(path.join(dist, 'page.html'), page);
console.log(`wrote ${path.join(dist, 'page.html')} (${page.length} bytes); script ${script}; styles ${styles.join(', ')}`);
