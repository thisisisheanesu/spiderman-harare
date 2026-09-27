import * as THREE from 'three';
import { Walkways } from './walkways.js';
import { Vendors } from './vendors.js';
import { Crowd } from './crowd.js';
import { Population } from './population.js';
import { CrowdRenderer } from './bodies.js';
import { VoiceDirector } from './voices.js';
import { Bubbles } from './bubbles.js';
import { Social } from './social.js';
import { Flashes } from './flashes.js';

// Pedestrians of Harare CBD: pavements, crossings, First Street Mall, the parks and the kombi ranks,
// with vendors at their stalls and people who speak with real Zimbabwean (Shona) voices.
//
// Public API (game.npcs):
//   list                 active people [{position: Vector3, heading, gender: 'female'|'male', state, name, role}]
//                        state: 'walk' | 'wait' (at a kerb) | 'cross' | 'idle' | 'chat' | 'vendor' | 'react' | 'flee'
//   npcsNear(x, z, r)    people within r metres (new array)
//   walkways             the pedestrian network (walkways.js)
// Emits 'npc:speak' {npc, clip, text}; drives audio.playVoice / setAmbience('crowd') and hud.showSubtitle.

const LOD = {
  low: { near: 26, far: 115, blob: 40 },
  medium: { near: 36, far: 150, blob: 55 },
  high: { near: 46, far: 185, blob: 70 },
};

export class Npcs {
  constructor() {
    this.list = [];
  }

  async init(game) {
    this.game = game;
    this.walkways = new Walkways(game.world, game.data);
    await this.walkways.build(() => new Promise((r) => setTimeout(r, 0)));
    this.vendors = new Vendors(game, this.walkways);
    this.vendors.build();
    this.crowd = new Crowd(game, this.walkways, this.vendors.obstacles);
    this.voices = new VoiceDirector(game);
    this.bubbles = new Bubbles(game);
    this.population = new Population(game, this.walkways, this.vendors, this.crowd, this.voices);
    this.list = this.population.list;
    this.social = new Social(game, this.crowd, this.population, this.voices, this.bubbles);
    this.lod = LOD[game.quality.level] || LOD.high;
    this.renderer = new CrowdRenderer(game.scene, this.population.max, { shadows: !!game.quality.shadows });
    this.flashes = new Flashes(game.scene);
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
    const { near, far, blob } = this.lod;
    const sphere = this._sphere;
    r.begin();
    for (const a of this.list) {
      const dx = a.position.x - cam.x;
      const dy = a.position.y - cam.y;
      const dz = a.position.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > far * far) continue;
      sphere.center.set(a.position.x, a.position.y + 0.9, a.position.z);
      if (!frustum.intersectsSphere(sphere)) continue;
      r.push(a, d2 < near * near ? 0 : 1, d2 < blob * blob);
      // People filming Spider-Man: the odd phone flash.
      if (a.state === 'react' && a.react.type === 'photo' && t > a.react.start && Math.random() < dt * 0.7) this.flashes.fire(a);
    }
    r.end();
    this.flashes.update(dt);
    r.setShadowStrength(this.game.sky?.isNight ? 0.55 : 1);
  }
}
