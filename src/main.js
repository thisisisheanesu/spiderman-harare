import './style.css';
import { Game } from './core/game.js';
import { Assets } from './core/assets.js';
import { CollisionWorld } from './world/collision.js';
import { Sky } from './world/sky.js';
import { City } from './world/city.js';
import { Player } from './player/player.js';
import { CameraRig } from './player/camera.js';
import { Traffic } from './traffic/traffic.js';
import { Npcs } from './npc/npcs.js';
import { AudioManager } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { storedQuality } from './ui/settings.js';
import { LoadingProgress } from './ui/loading.js';

// URL flags (handy for testing):
//   ?autostart=1        skip the start screen (headless tests)
//   ?quality=low|medium|high
//   ?spawn=x,y,z        start position in world metres
//   ?time=17.5          time of day in hours
//   ?mute=1
const params = new URLSearchParams(location.search);

function pickQuality() {
  const forced = params.get('quality');
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const level = forced || storedQuality() || (coarse || small ? 'low' : 'high');
  const presets = {
    low: { level: 'low', antialias: false, shadows: false, shadowMapSize: 1024, maxPixelRatio: 1.25, drawDistance: 1400, crowd: 0.5, traffic: 0.6 },
    medium: { level: 'medium', antialias: true, shadows: true, shadowMapSize: 1024, maxPixelRatio: 1.5, drawDistance: 2200, crowd: 0.8, traffic: 0.8 },
    high: { level: 'high', antialias: true, shadows: true, shadowMapSize: 2048, maxPixelRatio: 2, drawDistance: 3000, crowd: 1, traffic: 1 },
  };
  return presets[level] || presets.high;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Resolves after the browser has had a chance to paint (the loading bar), or after 120 ms in a
// background tab where animation frames don't run.
function nextPaint() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      clearTimeout(t);
      setTimeout(resolve, 0);
    });
  });
}

async function boot() {
  const container = document.getElementById('app');
  const load = new LoadingProgress(); // the title card's bar and status line
  load.set(0.05, 'Loading map of Harare CBD…');
  const [data, voices] = await Promise.all([
    fetchJSON('data/harare.json'),
    fetchJSON('audio/voices.json').catch(() => null),
  ]);
  load.set(0.2, 'Building the city…');

  const quality = pickQuality();
  const game = new Game({ container, data, voices, quality });
  window.__game = game;

  game.assets = new Assets(game.renderer);
  game.world = new CollisionWorld(data);
  const labels = {
    sky: 'Lighting the highveld sky…',
    city: 'Raising buildings…',
    player: 'Suiting up…',
    cameraRig: 'Setting up the camera…',
    traffic: 'Starting kombis and cars…',
    npcs: 'Filling the streets…',
    audio: 'Tuning voices…',
    hud: 'Drawing the map…',
  };
  game.add('sky', new Sky());
  game.add('city', new City());
  game.add('player', new Player());
  game.add('cameraRig', new CameraRig());
  game.add('traffic', new Traffic());
  game.add('npcs', new Npcs());
  game.add('audio', new AudioManager());
  game.add('hud', new Hud());

  // One stretch of the bar per system; within it the bar follows the models / textures the system
  // downloads while it initialises (src/ui/loading.js).
  const names = Object.keys(game.systems);
  const at = (k) => 0.2 + (k / names.length) * 0.66;
  let i = 0;
  load.stage(at(0), at(1), labels[names[0]]);
  const offAssets = game.assets.onProgress((done, total) => load.assets(done, total));
  await game.init(() => {
    i++;
    if (i < names.length) load.stage(at(i), at(i + 1), labels[names[i]] || 'Almost there…');
  });
  // Files requested without waiting for them (textures fill in when they land, models streamed
  // after init): let them arrive before the shader warm-up, so their materials are compiled too and
  // the first frame isn't bare. Capped, so a very slow connection still gets to play.
  if (game.assets.pending) {
    load.stage(at(names.length), 0.94, 'Downloading people, cars and textures…');
    await Promise.race([game.assets.whenIdle(), new Promise((resolve) => setTimeout(resolve, 25000))]);
  }
  offAssets();

  const spawn = params.get('spawn');
  if (spawn) {
    const [x, y, z] = spawn.split(',').map(Number);
    game.player.teleport(x, y, z);
  }
  const time = params.get('time');
  if (time) game.sky.setTimeOfDay?.(Number(time));
  if (params.get('mute')) game.audio.setMasterVolume?.(0);

  // Shader warm-up: with KHR_parallel_shader_compile the page keeps painting while the GPU compiles.
  load.set(0.96, 'Warming up…');
  await nextPaint();
  try {
    const r = game.renderer;
    const parallel = r.compileAsync && r.extensions?.has?.('KHR_parallel_shader_compile');
    const warm = parallel ? r.compileAsync(game.scene, game.camera) : r.compile(game.scene, game.camera);
    await Promise.race([warm, new Promise((resolve) => setTimeout(resolve, 12000))]);
  } catch (err) {
    console.warn('[boot] shader warm-up failed', err);
  }
  load.finish('Ready');
  game.start();
  window.__ready = true;

  // Start / pause flow. The world waits (paused) behind the title card; after that the HUD owns
  // pausing (pause menu, map, help, lost pointer lock, hidden tab).
  const start = document.getElementById('start');
  const loading = document.getElementById('loading');
  game.setPaused(true);
  // Enter / Space also start (input.js swallows Space's default button activation).
  const onKey = (e) => {
    if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    e.stopPropagation(); // don't let the same press make Spider-Man jump
    begin();
  };
  const begin = () => {
    window.removeEventListener('keydown', onKey, true);
    if (!game.paused) return;
    loading.classList.add('hidden');
    game.setPaused(false);
    game.audio.unlock?.();
    game.hud.requestLock?.();
    game.events.emit('game:start', {});
  };
  if (params.get('autostart')) {
    begin();
  } else {
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    start.disabled = false;
    start.textContent = touch ? 'Tap to swing in' : 'Click to swing in';
    start.addEventListener('click', begin, { once: true });
    if (!touch) start.focus({ preventScroll: true });
    window.addEventListener('keydown', onKey, true);
  }
  // Clicking the game re-captures the mouse (after Esc, or when the browser refused the lock; the
  // HUD stops asking when the page may never capture it and shows drag-to-look hints instead).
  game.renderer.domElement.addEventListener('click', () => {
    if (!game.paused) game.hud.requestLock?.();
  });
}

boot().catch((err) => {
  console.error(err);
  const txt = document.getElementById('load-text');
  if (txt) txt.textContent = `Failed to start: ${err.message}`;
});
