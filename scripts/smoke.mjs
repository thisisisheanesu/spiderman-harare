#!/usr/bin/env node
// Headless playtest harness. Launches Chromium (SwiftShader WebGL), opens the game with ?autostart=1,
// runs a scripted input sequence, saves screenshots and prints errors + telemetry as JSON.
//
//   node scripts/smoke.mjs [--url http://localhost:5173/] [--out shots/] [--query "spawn=0,80,0&time=17"]
//                          [--steps steps.json] [--width 1280 --height 720]
//
// steps.json: array of {wait: ms} | {down: 'KeyW'} | {up: 'KeyW'} | {press: 'Space'}
//             | {mouseDown: 0} | {mouseUp: 0} | {look: [dx, dy]} | {shot: 'name'} | {eval: 'js expr'}
// Default steps: look around, run, jump, swing, screenshots.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
    return acc;
  }, []),
);
const url = args.url || 'http://localhost:5173/';
const out = args.out || 'shots';
const width = Number(args.width || 1280);
const height = Number(args.height || 720);
fs.mkdirSync(out, { recursive: true });

const defaultSteps = [
  { wait: 1500 },
  { shot: '00-spawn' },
  { look: [300, 0] },
  { wait: 400 },
  { shot: '01-look' },
  { down: 'KeyW' },
  { wait: 800 },
  { press: 'Space' },
  { wait: 600 },
  { down: 'ShiftLeft' },
  { wait: 1500 },
  { shot: '02-swing' },
  { up: 'ShiftLeft' },
  { wait: 1200 },
  { shot: '03-after' },
  { up: 'KeyW' },
  { wait: 2500 },
  { shot: '04-land' },
];
const steps = args.steps ? JSON.parse(fs.readFileSync(args.steps, 'utf8')) : defaultSteps;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = `[${m.type()}] ${m.text()}`;
  if (m.type() === 'error') errors.push(t);
  else if (logs.length < 200) logs.push(t);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const q = ['autostart=1', 'mute=1', args.query].filter(Boolean).join('&');
const full = url + (url.includes('?') ? '&' : '?') + q;
const t0 = Date.now();
await page.goto(full, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 }).catch((e) => errors.push(`[timeout] ${e.message}`));
const loadMs = Date.now() - t0;

const telemetry = async () =>
  page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    const p = g.player;
    return {
      fps: Math.round(g.fps),
      state: p?.state,
      pos: p ? [p.position.x, p.position.y, p.position.z].map((v) => Math.round(v * 10) / 10) : null,
      speed: p ? Math.round(p.velocity.length() * 10) / 10 : null,
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      vehicles: g.traffic?.vehicles?.length,
      npcs: g.npcs?.list?.length,
    };
  });

const trace = [];
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.down) await page.keyboard.down(s.down);
  if (s.up) await page.keyboard.up(s.up);
  if (s.press) await page.keyboard.press(s.press);
  if (s.mouseDown !== undefined) await page.evaluate((b) => window.__game.input.mouseButtons.add(b), s.mouseDown);
  if (s.mouseUp !== undefined) await page.evaluate((b) => window.__game.input.mouseButtons.delete(b), s.mouseUp);
  if (s.look) await page.evaluate(([dx, dy]) => window.__game.input.addLook(dx, dy), s.look);
  if (s.eval) {
    try {
      const r = await page.evaluate(s.eval);
      trace.push({ eval: s.eval, result: r });
    } catch (e) {
      errors.push(`[eval] ${s.eval}: ${e.message}`);
    }
  }
  if (s.shot) {
    const file = path.join(out, `${s.shot}.png`);
    await page.screenshot({ path: file });
    trace.push({ shot: file, t: await telemetry() });
  }
}

console.log(JSON.stringify({ url: full, loadMs, telemetry: await telemetry(), trace, errors, logs: logs.slice(0, 40) }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
