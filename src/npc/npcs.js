import * as THREE from 'three';
import { Walkways } from './walkways.js';
import { Vendors } from './vendors.js';
import { Crowd, Agent } from './crowd.js';
import { Population } from './population.js';
import { CrowdRenderer } from './bodies.js';
import { Humans } from './humans.js';
import { useHumans } from './appearance.js';
import { VoiceDirector } from './voices.js';
import { Bubbles } from './bubbles.js';
import { Social } from './social.js';
import { Flashes } from './flashes.js';
import { streetVoices } from './streetVoices.js';

// Pedestrians of Harare CBD: pavements, crossings, First Street Mall, the parks and the kombi ranks,
// with vendors at their stalls and people who speak with real Zimbabwean (Shona) voices.
//
// Public API (game.npcs):
//   list                 active people [{position: Vector3, heading, gender: 'female'|'male', state, name, role}]
//                        state: 'walk' | 'wait' (at a kerb) | 'cross' | 'idle' | 'chat' | 'vendor' | 'react' | 'flee'
//   npcsNear(x, z, r)    people within r metres (new array)
//   crossers             people out on a carriageway this frame (crossing, or fleeing across it), each
//                        with crossRoad = index of the road being crossed (traffic brakes for them)
//   walkways             the pedestrian network (walkways.js)
// Emits 'npc:speak' {npc, clip, text}; drives audio.playVoice / playExtra (real recorded greetings and
// calls, streetVoices.js) / setAmbience('crowd') and hud.showSubtitle.

// Draw distances (m): LOD0 (full mesh, real shadows) out to lod0 for at most cap0 people, LOD1 out to lod1,
// nobody beyond (humans README: desktop 22 / 90 m, phones 12 / 55 m). atlas = LOD0 texture array size.
const LOD = {
  low: { lod0: 12, lod1: 58, cap0: 10, atlas: 512 },
  medium: { lod0: 18, lod1: 75, cap0: 16, atlas: 512 },
  high: { lod0: 22, lod1: 90, cap0: 24, atlas: 1024 },
};

export class Npcs {
  constructor() {
    this.list = [];
    this.crossers = [];
  }

  async init(game) {
    this.game = game;
    this.lod = LOD[game.quality.level] || LOD.high;
    // The people themselves load while the pedestrian network is built.
    this.humans = new Humans(game);
    const humansReady = this.humans.load({ lod0Size: this.lod.atlas, lod1Size: 256 });
    // Ground height from the city (the Kopje hill), looked up live in case the city swaps it.
    this.walkways = new Walkways(game.world, game.data, (x, z) => game.city?.heightAt?.(x, z) ?? 0);
    await this.walkways.build(() => new Promise((r) => setTimeout(r, 0)));
    await humansReady;
    useHumans(this.humans);
    Agent.humans = this.humans;
    this.vendors = new Vendors(game, this.walkways);
    this.vendors.build();
    this.crowd = new Crowd(game, this.walkways, this.vendors.obstacles);
    this.crowd.humans = this.humans;
    this.crossers = this.crowd.crossers;
    this._cityObstacles = 0;
    this._takeCityObstacles();
    this.street = streetVoices(game);
    this.voices = new VoiceDirector(game);
    this.bubbles = new Bubbles(game);
    this.population = new Population(game, this.walkways, this.vendors, this.crowd, this.voices);
    this.list = this.population.list;
    this.social = new Social(game, this.crowd, this.population, this.voices, this.bubbles);
    this.renderer = new CrowdRenderer(game, this.humans, this.population.max, { shadows: !!game.quality.shadows });
    this.flashes = new Flashes(game.scene);
    this.objects = [...this.renderer.objects, this.flashes.points, this.vendors.group].filter(Boolean);
    this._lod0 = [];
    this.ctx = {
      focus: new THREE.Vector3(),
      px: 0,
      py: 0,
      pz: 0,
      r2: 0,
      playerOnFoot: false,
      nearGround: false,
      traffic: null,
    };
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    this._near = [];
    this.ambience = 0;
    this._ambT = 0;
  }

  // The city's street furniture ({x, z, r}: poles, trees, benches) for walkers to steer around; picked
  // up whenever the list grows (the city may fill it after we start).
  _takeCityObstacles() {
    const obs = this.game.city?.obstacles;
    if (!Array.isArray(obs) || obs.length <= this._cityObstacles) return;
    this.crowd.addObstacles(this._cityObstacles ? obs.slice(this._cityObstacles) : obs);
    this._cityObstacles = obs.length;
  }

  npcsNear(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const a of this.list) {
      const dx = a.position.x - x;
      const dz = a.position.z - z;
      if (dx * dx + dz * dz <= r2) out.push(a);
    }
    return out;
  }

  update(dt, game) {
    const ctx = this.ctx;
    const player = game.player;
    const p = player?.position || game.camera.position;
    ctx.focus.copy(p);
    ctx.px = p.x;
    ctx.py = p.y;
    ctx.pz = p.z;
    ctx.r2 = this.population.radius ** 2;
    const ground = this.walkways.groundY(p.x, p.z);
    ctx.playerOnFoot = player?.state === 'ground' && p.y - ground < 1;
    ctx.nearGround = p.y - ground < 6;
    ctx.traffic = game.traffic;

    game.camera.updateMatrixWorld();
    if ((game.frame & 31) === 0) this._takeCityObstacles();
    this.street.update();
    this.population.update(dt, ctx);
    this.crowd.rebuildHash(this.list);
    this.crowd.update(dt, ctx);
    this.social.update(dt, ctx);
    this.voices.update(dt, ctx, this.crowd.near(p.x, p.z, 15, this._near));
    this._ambience(dt, ctx);
    this._render(dt);
    this.bubbles.update(dt);
  }

  pausedUpdate(dt) {
    this.bubbles.update(dt);
  }

  // Crowd density around the listener drives the real Shona chatter bed.
  _ambience(dt, ctx) {
    if ((this._ambT -= dt) > 0) return;
    this._ambT = 0.25;
    const cam = this.game.camera.position;
    let sum = 0;
    for (const a of this.list) {
      const d = Math.hypot(a.position.x - cam.x, a.position.y - cam.y, a.position.z - cam.z);
      if (d < 30) sum += 1 - d / 30;
    }
    const height = Math.max(0, ctx.py - this.walkways.groundY(ctx.px, ctx.pz));
    const target = Math.min(1, sum / 14) * Math.max(0.15, 1 - height / 70);
    this.ambience += (target - this.ambience) * 0.35;
    this.game.audio?.setAmbience?.('crowd', Math.round(this.ambience * 100) / 100);
  }

  _render(dt) {
    const r = this.renderer;
    const t = this.game.time;
    const cam = this.game.camera.position;
    const frustum = this.population.frustum;
    const { lod0, lod1, cap0 } = this.lod;
    const sphere = this._sphere;
    const near = this._lod0;
    near.length = 0;
    r.begin();
    for (const a of this.list) {
      const dx = a.position.x - cam.x;
      const dy = a.position.y - cam.y;
      const dz = a.position.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > lod1 * lod1 || !a.anim.clip) continue;
      sphere.center.set(a.position.x, a.position.y + 0.9, a.position.z);
      if (!frustum.intersectsSphere(sphere)) continue;
      if (d2 < lod0 * lod0) {
        a._d2 = d2;
        near.push(a);
      } else r.push(a, 1, true);
      // People filming Spider-Man: the odd phone flash.
      if (a.state === 'react' && a.react.type === 'photo' && t > a.react.start && Math.random() < dt * 0.7) this.flashes.fire(a);
    }
    // The nearest few get the full mesh; a crowd pressing round Spider-Man spills over into LOD1.
    if (near.length > cap0) near.sort((p, q) => p._d2 - q._d2);
    for (let i = 0; i < near.length; i++) r.push(near[i], i < cap0 ? 0 : 1, true);
    r.end();
    this.flashes.update(dt);
    r.setShadowStrength(this.game.sky?.isNight ? 0.55 : 1);
  }
}
