import './style.css';
import { Game } from './core/game.js';
import { CollisionWorld } from './world/collision.js';
import { Sky } from './world/sky.js';
import { City } from './world/city.js';
import { Player } from './player/player.js';
import { CameraRig } from './player/camera.js';
import { Traffic } from './traffic/traffic.js';
import { Npcs } from './npc/npcs.js';
import { AudioManager } from './audio/audio.js';
import { Hud } from './ui/hud.js';

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
  const level = forced || (coarse || small ? 'low' : 'high');
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

function setProgress(frac, label) {
  const bar = document.getElementById('load-bar');
  const txt = document.getElementById('load-text');
  if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
  if (txt && label) txt.textContent = label;
}

async function boot() {
  const container = document.getElementById('app');
  setProgress(0.05, 'Loading map of Harare CBD…');
  const [data, voices] = await Promise.all([
    fetchJSON('data/harare.json'),
    fetchJSON('audio/voices.json').catch(() => null),
  ]);
  setProgress(0.25, 'Building the city…');

  const quality = pickQuality();
  const game = new Game({ container, data, voices, quality });
  window.__game = game;

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

  const names = Object.keys(game.systems);
  let i = 0;
  await game.init((frac) => {
    const next = names[++i];
    setProgress(0.25 + frac * 0.7, labels[next] || 'Almost there…');
  });

  const spawn = params.get('spawn');
  if (spawn) {
    const [x, y, z] = spawn.split(',').map(Number);
    game.player.teleport(x, y, z);
  }
  const time = params.get('time');
  if (time) game.sky.setTimeOfDay?.(Number(time));
  if (params.get('mute')) game.audio.setMasterVolume?.(0);

  setProgress(1, 'Ready');
  game.renderer.compile(game.scene, game.camera);
  game.start();
  window.__ready = true;

  const start = document.getElementById('start');
  const loading = document.getElementById('loading');
  const begin = () => {
    loading.classList.add('hidden');
    game.audio.unlock?.();
    game.input.requestPointerLock();
    game.events.emit('game:start', {});
  };
  if (params.get('autostart')) {
    begin();
  } else {
    start.disabled = false;
    start.textContent = 'Tap to swing in';
    start.addEventListener('click', begin, { once: true });
  }
  // Clicking the canvas re-captures the mouse after Esc.
  game.renderer.domElement.addEventListener('click', () => {
    if (!game.paused) game.input.requestPointerLock();
  });
}

boot().catch((err) => {
  console.error(err);
  const txt = document.getElementById('load-text');
  if (txt) txt.textContent = `Failed to start: ${err.message}`;
});
