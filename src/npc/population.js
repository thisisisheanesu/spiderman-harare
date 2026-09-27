import * as THREE from 'three';
import * as STREETLIFE from '../data/streetlife.js';
import { makeRng, hashString } from '../core/rng.js';
import { pointInPoly, polyCentroid, polyArea } from '../core/geo.js';
import { CROSS, WALK, PATH } from './walkways.js';
import { Agent, headingOf } from './crowd.js';
import { makeLook, pickArchetype, vendorLook, archetypeById } from './appearance.js';
import { rankSites } from './ranks.js';

// Who is out, and where: keeps a population of walkers, chatting groups, people standing about,
// rank crowds with their touts, and stall vendors in a radius around the player, scaled by the
// quality preset, the time of day and how busy each street is. Spawns happen out of sight.

const PER_METRE = 0.2; // people per metre of pavement at density 1
const HOURLY = STREETLIFE.TRAFFIC?.densityByHour || { 0: 0.05, 6: 0.5, 7: 0.9, 12: 0.7, 17: 1, 19: 0.5, 21: 0.2 };
const HOURS = Object.keys(HOURLY).map(Number).sort((a, b) => a - b);
const SELLING = STREETLIFE.VENDOR_RAID?.sellingHours || [6, 18];
const VENDOR_LABEL = {
  fruit_veg: 'fruit & veg seller',
  airtime_phone: 'airtime vendor',
  sweets_snacks: 'snack seller',
  newspaper: 'newspaper vendor',
  shoe_mender: 'shoe mender',
  flowers: 'flower seller',
  secondhand_clothes: 'clothes seller',
  roast_maize: 'maize seller',
  megaphone_herbalist: 'herbalist',
  money_changer: 'money changer',
  umbrella_accessories: 'hawker',
};
const ROLE_LABEL = { office_man: 'office worker', office_woman: 'office worker', school_kid: 'pupil', security_guard: 'security guard', police: 'police officer', street_preacher: 'preacher', market_woman: 'market trader', elder: 'elder', youth: 'youngster', apostolic: 'mupostori' };

// Pedestrians per hour of day relative to the busiest hour (never fully empty: guards, late commuters).
function hourFactor(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < HOURS.length - 1 && HOURS[i + 1] <= h) i++;
  const h0 = HOURS[i];
  const h1 = HOURS[(i + 1) % HOURS.length] + (i === HOURS.length - 1 ? 24 : 0);
  const f = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const v = HOURLY[h0] + (HOURLY[HOURS[(i + 1) % HOURS.length]] - HOURLY[h0]) * f;
  return Math.max(0.18, Math.min(1, v));
}

export class Population {
  constructor(game, walkways, vendors, crowd, voices) {
    this.game = game;
    this.walk = walkways;
    this.vendors = vendors;
    this.crowd = crowd;
    this.voices = voices;
    const q = game.quality;
    this.max = Math.max(60, Math.round(300 * (q.crowd ?? 1)));
    this.radius = q.level === 'low' ? 115 : q.level === 'medium' ? 140 : 165;
    this.pool = Array.from({ length: this.max }, () => new Agent());
    this.free = this.pool.slice().reverse();
    this.list = [];
    this.nextId = 1;
    this.groups = [];
    this.rng = makeRng(hashString('harare-crowd'));
    this.cands = [];
    this.cum = new Float64Array(0);
    this.candFocus = { x: 1e9, z: 1e9 };
    this.candT = 0;
    this.targetWalkers = 0;
    this.mixT = 0;
    this.focus = new THREE.Vector3(1e9, 0, 1e9);
    this.frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._p = { x: 0, z: 0 };
    this._tmp = [];
    this.ranks = this._prepRanks();
    this.parks = this._prepParks();
  }

  // --- Pool ------------------------------------------------------------------------------------

  _alloc(look, kind) {
    const a = this.free.pop();
    if (!a) return null;
    a.reset(this.nextId++, look, kind);
    const label = ROLE_LABEL[look.archetype];
    a.role = label ? `${look.name}, ${label}` : look.name;
    a.listIndex = this.list.length;
    this.list.push(a);
    return a;
  }

  release(a) {
    this.voices.release(a);
    if (a.group) {
      const m = a.group.members;
      m.splice(m.indexOf(a), 1);
      a.group = null;
    }
    if (a.stall) a.stall.agent = null;
    if (a.rank) a.rank.agents.splice(a.rank.agents.indexOf(a), 1);
    a.stall = null;
    a.rank = null;
    a.id = -1;
    const i = a.listIndex;
    const last = this.list.pop();
    if (last !== a) {
      this.list[i] = last;
      last.listIndex = i;
    }
    this.free.push(a);
  }

  // --- Frame update ----------------------------------------------------------------------------

  update(dt, ctx) {
    const game = this.game;
    const t = game.time;
    const cam = game.camera;
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pm);
    const jumped = this.focus.distanceToSquared(ctx.focus) > 90 * 90;
    this.focus.copy(ctx.focus);
    const R = this.radius;
    const hour = game.sky?.timeOfDay ?? 12;
    this.hour = hour;
    const tf = hourFactor(hour);
    if (jumped) {
      // Teleport or first frame: clear what is far away and fill the new area straight away.
      for (let i = this.list.length - 1; i >= 0; i--) {
        const a = this.list[i];
        if (a.position.distanceToSquared(ctx.focus) > R * R) this.release(a);
      }
      for (const g of this.groups.slice()) if (!g.members.length) this.groups.splice(this.groups.indexOf(g), 1);
    }
    if (jumped || (this.candT -= dt) <= 0 || Math.hypot(this.candFocus.x - ctx.focus.x, this.candFocus.z - ctx.focus.z) > 15) {
      this._refreshCandidates(ctx.focus, tf);
      this.candT = 2;
    }
    this._updateVendors(ctx, hour, jumped);
    this._updateRanks(ctx, tf, jumped);
    this._updateParks(ctx, hour, tf, jumped);
    this._updateGroups(t, ctx.focus);

    // Walkers: despawn far ones, top up toward the target out of sight.
    let walkers = 0;
    let groupsN = 0;
    let idlers = 0;
    const far2 = (R * 1.1) ** 2;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      if (a.kind === 'vendor' || a.kind === 'rank' || a.kind === 'hwindi') continue;
      const d2 = a.position.distanceToSquared(ctx.focus);
      if (d2 > far2 && a.kind !== 'group') {
        this.release(a);
        continue;
      }
      if (a.kind === 'walker') walkers++;
      else if (a.kind === 'idle') {
        idlers++;
        if (t > a.timer) this._startWalking(a);
      }
    }
    let chatN = 0; // members of street groups (rank knots and park loungers are kept elsewhere)
    for (const g of this.groups) {
      groupsN += g.members.length;
      if (g.edge >= 0) chatN += g.members.length;
    }
    const target = this.targetWalkers;
    // Chatting groups and loiterers drift off into the walking crowd over time: when they run short,
    // swap a few far, unseen walkers for a new group or loiterer now and then, so a long stay keeps its mix.
    if (!jumped && (this.mixT -= dt) <= 0) {
      this.mixT = 1.5;
      const group = chatN < target * 0.07;
      if (group || idlers < target * 0.03) {
        let k = group ? 4 : 1;
        for (let i = this.list.length - 1; i >= 0 && k > 0; i--) {
          const a = this.list[i];
          if (a.kind !== 'walker' || this._inView(a.position.x, a.position.z)) continue;
          if (a.position.distanceToSquared(ctx.focus) < (R * 0.6) ** 2) continue;
          this.release(a);
          walkers--;
          k--;
        }
        if (!k) {
          if (group) groupsN += this._spawnGroup(ctx, false);
          else idlers += this._spawnIdler(ctx, false) ? 1 : 0;
        }
      }
    }
    const room = this.free.length;
    let budget = jumped ? room : Math.min(room, 3);
    const anywhere = jumped;
    while (budget > 0 && walkers + groupsN + idlers < target) {
      const r = this.rng();
      let n = 0;
      if (r < 0.08 && groupsN < target * 0.14) n = this._spawnGroup(ctx, anywhere);
      else if (r < 0.13 && idlers < target * 0.06) n = this._spawnIdler(ctx, anywhere) ? 1 : 0;
      else n = this._spawnWalker(ctx, anywhere);
      if (r < 0.08) groupsN += n;
      else if (r < 0.13) idlers += n;
      else walkers += n;
      budget -= Math.max(1, n);
      if (!n && !anywhere) break;
    }
    // Too many (time of day changed, or quality): let far, unseen walkers go.
    if (walkers + groupsN + idlers > target * 1.15 + 5) {
      for (let i = this.list.length - 1; i >= 0 && walkers > target; i--) {
        const a = this.list[i];
        if (a.kind !== 'walker' || this._inView(a.position.x, a.position.z)) continue;
        if (a.position.distanceToSquared(ctx.focus) < (R * 0.6) ** 2) continue;
        this.release(a);
        walkers--;
      }
    }
  }

  // Edges near the focus weighted by length x busyness x distance falloff (denser close to the player).
  _refreshCandidates(focus, tf) {
    const W = this.walk;
    const R = this.radius;
    const cands = this.cands;
    cands.length = 0;
    const weights = [];
    let expected = 0;
    W.forEdgesNear(focus.x, focus.z, R, (e, i) => {
      if (e.kind === CROSS || e.density <= 0) return;
      const a = W.nodes[e.a];
      const b = W.nodes[e.b];
      const d = Math.hypot((a.x + b.x) / 2 - focus.x, (a.z + b.z) / 2 - focus.z);
      if (d > R) return;
      const fall = d < 45 ? 1 : 1 - 0.7 * ((d - 45) / (R - 45));
      const w = e.len * e.density * fall;
      cands.push(i);
      weights.push(w);
      expected += w;
    });
    this.cum = new Float64Array(weights.length);
    let acc = 0;
    for (let i = 0; i < weights.length; i++) this.cum[i] = acc += weights[i];
    this.candFocus.x = focus.x;
    this.candFocus.z = focus.z;
    const vendors = this.list.reduce((n, a) => n + (a.kind === 'vendor' || a.kind === 'rank' || a.kind === 'hwindi' ? 1 : 0), 0);
    this.targetWalkers = Math.min(this.max - vendors - 4, Math.round(expected * PER_METRE * tf));
  }

  _sampleEdge(filter) {
    const cum = this.cum;
    const n = cum.length;
    if (!n) return -1;
    for (let tries = 0; tries < 6; tries++) {
      const r = this.rng() * cum[n - 1];
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      const ei = this.cands[lo];
      if (!filter || filter(this.walk.edges[ei])) return ei;
    }
    return -1;
  }

  _inView(x, z) {
    const cam = this.game.camera.position;
    const dx = x - cam.x;
    const dz = z - cam.z;
    if (dx * dx + dz * dz > 75 * 75) return false;
    return this.frustum.containsPoint(this._v.set(x, 1 + this.walk.hill(x, z, true), z));
  }

  _spawnWalker(ctx, anywhere) {
    const W = this.walk;
    const rng = this.rng;
    for (let tries = 0; tries < 6; tries++) {
      const ei = this._sampleEdge();
      if (ei < 0) return null;
      const e = W.edges[ei];
      const s = rng() * e.len;
      const p = W.pointOn(e, s, 0, this._p);
      if (!anywhere && this._inView(p.x, p.z)) continue;
      if (this.crowd.near(p.x, p.z, 1.2, this._tmp).length) continue;
      const nearRank = this.ranks.some((r) => Math.abs(r.x - p.x) < 90 && Math.abs(r.z - p.z) < 90);
      const arch = pickArchetype(rng, { hour: this.hour, nearRank, walking: true });
      const fwd = rng() < 0.5;
      if (arch.id === 'school_kid' && rng() < 0.75 && this.free.length > 4) return this._spawnPupils(arch, ei, fwd, fwd ? s : e.len - s);
      const look = makeLook(rng, arch);
      const a = this._alloc(look, 'walker');
      if (!a) return 0;
      this.crowd.putOnEdge(a, ei, fwd, fwd ? s : e.len - s);
      return 1;
    }
    return 0;
  }

  // Pupils walk to and from school in twos, threes and fours from the same school, keeping together.
  _spawnPupils(arch, ei, fwd, s) {
    const rng = this.rng;
    const e = this.walk.edges[ei];
    const school = rng() < 0.55 ? 'primary' : 'high';
    const n = rng.int(2, 4);
    const kids = [];
    for (let k = 0; k < n; k++) {
      const a = this._alloc(makeLook(rng, arch, { school }), 'walker');
      if (!a) break;
      kids.push(a);
    }
    if (!kids.length) return 0;
    const pace = Math.min(...kids.map((a) => a.prefSpeed));
    const lead = kids[0];
    kids.forEach((a, k) => {
      a.prefSpeed = pace * (k ? 1 : 0.97);
      // Two abreast, rows 0.9 m apart, the lead in front.
      const row = Math.floor((k + 1) / 2);
      const side = k === 0 ? 0 : k % 2 ? 1 : -1;
      this.crowd.putOnEdge(a, ei, fwd, Math.max(0, s - row * 0.9));
      a.lat = Math.max(-e.spread, Math.min(e.spread, lead.lat + side * 0.55));
      a.latGoal = a.lat;
      this.crowd._place(a);
      if (k) {
        a.follow = lead;
        a.followId = lead.id;
      }
    });
    return kids.length;
  }

  // Someone standing at the building line: a guard, someone on the phone, waiting for a friend.
  _spawnIdler(ctx, anywhere) {
    const W = this.walk;
    const rng = this.rng;
    const ei = this._sampleEdge((e) => e.kind === WALK && e.spread >= 0.45);
    if (ei < 0) return null;
    const e = W.edges[ei];
    const s = rng.range(0.5, e.len - 0.5);
    const p = W.pointOn(e, s, e.side * e.spread, this._p);
    if ((!anywhere && this._inView(p.x, p.z)) || this.crowd.near(p.x, p.z, 1.2, this._tmp).length || !W.free(p.x, p.z) || this.crowd.obstacleAt(p.x, p.z, 0.35)) return null;
    const look = makeLook(rng, pickArchetype(rng, { hour: this.hour }));
    const a = this._alloc(look, 'idle');
    if (!a) return null;
    a.position.set(p.x, W.nodes[e.a].y + W.hill(p.x, p.z, true), p.z);
    a.heading = Math.atan2(e.side * e.uz, -e.side * e.ux);
    a.home = { x: p.x, z: p.z, heading: a.heading, edge: ei };
    a.timer = this.game.time + (look.stationary ? rng.range(60, 180) : rng.range(15, 60));
    return a;
  }

  _startWalking(a) {
    const W = this.walk;
    const ei = a.home?.edge ?? a.group?.edge;
    if (ei === undefined || ei < 0) return;
    const e = W.edges[ei];
    const A = W.nodes[e.a];
    const fwd = this.rng() < 0.5;
    const s = Math.max(0, Math.min(e.len, (a.position.x - A.x) * e.ux + (a.position.z - A.z) * e.uz));
    const lat = Math.max(-e.spread, Math.min(e.spread, (a.position.x - A.x) * e.uz - (a.position.z - A.z) * e.ux));
    a.kind = 'walker';
    a.state = 'walk';
    a.home = null;
    a.group = null;
    this.crowd.putOnEdge(a, ei, fwd, fwd ? s : e.len - s, fwd ? lat : -lat);
  }

  // --- Chatting groups -------------------------------------------------------------------------

  _spawnGroup(ctx, anywhere) {
    const W = this.walk;
    const rng = this.rng;
    const ei = this._sampleEdge((e) => (e.kind === WALK && e.spread >= 0.75) || (e.kind === PATH && e.spread >= 1.1));
    if (ei < 0) return 0;
    const e = W.edges[ei];
    const out = e.kind === WALK ? e.side : rng() < 0.5 ? 1 : -1;
    const s = rng.range(1, e.len - 1);
    const c = W.pointOn(e, s, out * Math.max(0, e.spread - 0.4), this._p);
    const cx = c.x;
    const cz = c.z;
    if ((!anywhere && this._inView(cx, cz)) || this.crowd.near(cx, cz, 2, this._tmp).length) return 0;
    const n = rng.int(2, 4);
    const y = W.nodes[e.a].y;
    const spots = [];
    const base = rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const ang = base + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = rng.range(0.52, 0.68);
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      if (W.free(x, z) && W.free(x + 0.25, z) && W.free(x - 0.25, z) && W.free(x, z + 0.25) && W.free(x, z - 0.25) && !this.crowd.obstacleAt(x, z, 0.3)) spots.push([x, z]);
    }
    if (spots.length < 2) return 0;
    const group = { x: cx, z: cz, members: [], speaker: 0, switchAt: 0, until: this.game.time + rng.range(25, 90), edge: ei };
    // Friends tend to share an archetype mix (colleagues, school friends, market women).
    const theme = pickArchetype(rng, { hour: this.hour, group: true });
    for (const [x, z] of spots) {
      const arch = rng() < 0.6 ? theme : pickArchetype(rng, { hour: this.hour });
      const a = this._alloc(makeLook(rng, arch), 'group');
      if (!a) break;
      a.position.set(x, y + W.hill(x, z, true), z);
      a.heading = headingOf(cx - x, cz - z);
      a.home = { x, z, heading: a.heading };
      a.group = group;
      group.members.push(a);
    }
    this.groups.push(group);
    return group.members.length;
  }

  _updateGroups(t, focus) {
    const far2 = (this.radius * 1.1) ** 2;
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      if (g.edge >= 0 && (g.x - focus.x) ** 2 + (g.z - focus.z) ** 2 > far2) {
        for (const a of g.members.slice()) this.release(a);
      }
      if (!g.members.length) {
        this.groups.splice(i, 1);
        continue;
      }
      if (t > g.until && g.edge >= 0) {
        for (const a of g.members.slice()) {
          if (a.state === 'react') continue;
          this._startWalking(a);
          g.members.splice(g.members.indexOf(a), 1);
        }
        continue;
      }
      if (t > g.switchAt) {
        const preacher = g.preacher && g.preacher.id === g.preacherId ? g.members.indexOf(g.preacher) : -1;
        g.speaker = preacher >= 0 && this.rng() < 0.85 ? preacher : Math.floor(this.rng() * g.members.length);
        g.switchAt = t + this.rng.range(2.5, 6);
      }
    }
  }

  // --- Kombi ranks -----------------------------------------------------------------------------

  _prepRanks() {
    const data = this.game.data;
    const rng = makeRng(hashString('harare-ranks'));
    const W = this.walk;
    const out = [];
    for (const rk of rankSites(data)) {
      const poly = (data.areas || []).find((a) => {
        if (a.kind !== 'rank') return false;
        const c = polyCentroid(a.pts);
        return pointInPoly(rk.x, rk.z, a.pts) || Math.hypot(c.x - rk.x, c.z - rk.z) < 60;
      });
      // People gather in knots and in queues for the kombis, thickest at the heart of the rank.
      const spots = [];
      const ok = (x, z) => W.free(x, z) && W.free(x + 0.35, z) && W.free(x - 0.35, z) && W.free(x, z + 0.35) && W.free(x, z - 0.35) && !spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 0.75 * 0.75);
      for (let c = 0, tries = 0; c < 12 && tries < 200; tries++) {
        const r = 4 + rng() * (rk.kind === 'bus_stop' ? 10 : 26);
        const ang = rng() * Math.PI * 2;
        const cx = rk.x + Math.cos(ang) * r;
        const cz = rk.z + Math.sin(ang) * r;
        if (poly && !pointInPoly(cx, cz, poly.pts) && rng() < 0.6) continue;
        if (!ok(cx, cz)) continue;
        c++;
        if (rng() < 0.4) {
          // A queue: a line of people facing the same way.
          const dir = rng() * Math.PI * 2;
          const dx = Math.sin(dir);
          const dz = Math.cos(dir);
          for (let k = 0; k < 7; k++) {
            const x = cx + dx * k * 0.85 + rng.range(-0.12, 0.12);
            const z = cz + dz * k * 0.85 + rng.range(-0.12, 0.12);
            if (!ok(x, z)) break;
            spots.push({ x, y: W.groundY(x, z), z, heading: headingOf(-dx, -dz), knot: null });
          }
        } else {
          const knot = { x: cx, z: cz };
          for (let k = 0; k < 14 && spots.length < 90; k++) {
            const a2 = rng() * Math.PI * 2;
            const r2 = 0.6 + rng() * 2.4;
            const x = cx + Math.cos(a2) * r2;
            const z = cz + Math.sin(a2) * r2;
            if (ok(x, z)) spots.push({ x, y: W.groundY(x, z), z, heading: rng.range(-Math.PI, Math.PI), knot });
          }
        }
      }
      out.push({ ...rk, spots, agents: [] });
    }
    return out;
  }

  _updateRanks(ctx, tf, jumped) {
    const R = this.radius;
    const rng = this.rng;
    for (const rk of this.ranks) {
      const d = Math.hypot(rk.x - ctx.focus.x, rk.z - ctx.focus.z);
      if (d > R + 40) {
        if (rk.agents.length) {
          for (const a of rk.agents.slice()) this.release(a);
          for (const s of rk.spots) s.used = null;
        }
        continue;
      }
      const want = Math.min(rk.spots.length, Math.round((rk.kind === 'bus_stop' ? 10 : 55) * (this.game.quality.crowd ?? 1) * Math.max(0.35, tf)));
      let budget = jumped ? want : 2;
      for (const s of rk.spots) {
        if (rk.agents.length >= want || budget <= 0 || !this.free.length) break;
        if (s.used && s.used.id === s.usedId) continue;
        if (!jumped && this._inView(s.x, s.z)) continue;
        if (this.game.traffic?.vehiclesNear?.(s.x, s.z, 2.5)?.length) continue;
        const hwindi = rk.agents.filter((a) => a.kind === 'hwindi').length < (rk.kind === 'bus_stop' ? 1 : 3) && rng() < 0.3;
        const look = hwindi ? makeLook(rng, { id: 'hwindi', walkSpeed: [1.3, 2.2] }, { gender: 'male' }) : makeLook(rng, pickArchetype(rng, { hour: this.hour, nearRank: true }));
        const a = this._alloc(look, hwindi ? 'hwindi' : 'rank');
        if (!a) break;
        a.position.set(s.x, s.y, s.z);
        // In a knot people turn toward each other; in a queue they face the front.
        const face = s.knot && rng() < 0.7 ? headingOf(s.knot.x - s.x, s.knot.z - s.z) : s.heading;
        a.heading = face;
        a.home = { x: s.x, z: s.z, heading: face };
        a.rank = rk;
        if (s.knot && !hwindi && rng() < 0.7) {
          // Knots of people at the rank chat among themselves.
          const g = s.knot.group || (s.knot.group = { x: s.knot.x, z: s.knot.z, members: [], speaker: 0, switchAt: 0, until: Infinity, edge: -1 });
          if (!g.members.length && !this.groups.includes(g)) this.groups.push(g);
          g.members.push(a);
          a.group = g;
          a.state = 'chat';
        }
        if (hwindi) a.role = `${look.name}, hwindi`;
        s.used = a;
        s.usedId = a.id;
        rk.agents.push(a);
        budget--;
      }
      // A kombi pulling into someone's spot: they step aside (out of sight) or flinch.
      if (this.game.time > (rk.checkAt || 0)) {
        rk.checkAt = this.game.time + 0.7;
        for (const a of rk.agents.slice()) {
          if (!this.game.traffic?.vehiclesNear?.(a.position.x, a.position.z, 1.8)?.length) continue;
          if (this._inView(a.position.x, a.position.z)) this.crowd.startReaction(a, 'cover', 1.5, 0);
          else this.release(a);
        }
      }
    }
  }

  // --- Parks: friends sitting on the grass --------------------------------------------------------

  _prepParks() {
    const W = this.walk;
    const rng = makeRng(hashString('harare-parks'));
    const out = [];
    for (const area of this.game.data.areas || []) {
      if (area.kind !== 'park') continue;
      const pts = area.pts;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]);
        maxX = Math.max(maxX, pts[i]);
        minZ = Math.min(minZ, pts[i + 1]);
        maxZ = Math.max(maxZ, pts[i + 1]);
      }
      const want = Math.min(16, Math.round(polyArea(pts) / 1500));
      const spots = [];
      for (let i = 0; i < want * 30 && spots.length < want; i++) {
        const x = rng.range(minX, maxX);
        const z = rng.range(minZ, maxZ);
        if (!pointInPoly(x, z, pts) || !W.free(x, z) || W.nearestEdge(x, z, 3)) continue;
        if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 64)) continue;
        spots.push({ x, z, group: null });
      }
      if (spots.length) out.push({ name: area.name || 'park', cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2, spots });
    }
    return out;
  }

  _updateParks(ctx, hour, tf, jumped) {
    const R = this.radius;
    const rng = this.rng;
    const open = hour >= 7 && hour < 18.5;
    for (const park of this.parks) {
      const near = Math.hypot(park.cx - ctx.focus.x, park.cz - ctx.focus.z) < R + park.r;
      for (const s of park.spots) {
        // Loungers can also be despawned by a teleport: an emptied group frees the spot.
        if (s.group && !s.group.members.length) s.group = null;
        const g = s.group;
        const d2 = (s.x - ctx.focus.x) ** 2 + (s.z - ctx.focus.z) ** 2;
        if (g && (!open || !near || d2 > (R * 1.1) ** 2)) {
          for (const a of g.members.slice()) this.release(a);
          s.group = null;
          continue;
        }
        if (g || !open || !near || d2 > R * R || this.free.length < 6) continue;
        if (!jumped && (this._inView(s.x, s.z) || rng() > 0.02 * tf)) continue;
        s.group = this._spawnLoungers(s.x, s.z);
      }
    }
  }

  _spawnLoungers(cx, cz) {
    const W = this.walk;
    const rng = this.rng;
    // Vapostori gather in the parks in their white robes: a circle on the grass round a standing preacher.
    if (this.hour > 8 && this.hour < 17 && rng() < 0.3) return this._spawnCongregation(cx, cz);
    const n = rng.int(2, 4);
    const group = { x: cx, z: cz, members: [], speaker: 0, switchAt: 0, until: Infinity, edge: -1 };
    const base = rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const ang = base + (k / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const x = cx + Math.cos(ang) * 0.85;
      const z = cz + Math.sin(ang) * 0.85;
      if (!W.free(x, z)) continue;
      const look = makeLook(rng, pickArchetype(rng, { hour: this.hour }), { load: false });
      const a = this._alloc(look, 'group');
      if (!a) break;
      a.position.set(x, W.groundY(x, z), z);
      a.heading = headingOf(cx - x, cz - z);
      a.home = { x, z, heading: a.heading };
      a.group = group;
      a.lounge = true;
      group.members.push(a);
    }
    if (group.members.length) this.groups.push(group);
    return group;
  }

  _spawnCongregation(cx, cz) {
    const W = this.walk;
    const rng = this.rng;
    const arch = archetypeById('apostolic');
    const n = rng.int(5, 8);
    const group = { x: cx, z: cz, members: [], speaker: 0, switchAt: 0, until: Infinity, edge: -1, preacher: null, preacherId: -1 };
    const base = rng() * Math.PI * 2;
    for (let k = 0; k <= n; k++) {
      // k = 0: the preacher stands at the edge of the circle, facing in.
      const ang = base + (k / (n + 1)) * Math.PI * 2 + rng.range(-0.12, 0.12);
      const r = k === 0 ? 1.7 : rng.range(1.25, 1.45);
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      if (!W.free(x, z)) continue;
      const look = makeLook(rng, arch, { gender: k === 0 ? 'male' : rng() < 0.7 ? 'female' : 'male' });
      const a = this._alloc(look, 'group');
      if (!a) break;
      a.position.set(x, W.groundY(x, z), z);
      a.heading = headingOf(cx - x, cz - z);
      a.home = { x, z, heading: a.heading };
      a.group = group;
      a.lounge = k > 0;
      if (k === 0) {
        group.preacher = a;
        group.preacherId = a.id;
        a.role = `${look.name}, mupostori (preaching)`;
      }
      group.members.push(a);
    }
    if (group.members.length) this.groups.push(group);
    return group;
  }

  // --- Vendors ---------------------------------------------------------------------------------

  _updateVendors(ctx, hour, jumped) {
    const R = this.radius + 10;
    const open = hour >= SELLING[0] && hour < SELLING[1] + 0.5;
    if (this.vendors.group) this.vendors.group.visible = open;
    this.crowd.obstaclesOn = open;
    let budget = jumped ? 100 : 2;
    for (const st of this.vendors.stalls) {
      const d2 = (st.x - ctx.focus.x) ** 2 + (st.z - ctx.focus.z) ** 2;
      const want = open && d2 < R * R;
      if (!want) {
        if (st.agent && st.agent.id === st.agentId) this.release(st.agent);
        st.agent = null;
        continue;
      }
      if ((st.agent && st.agent.id === st.agentId) || budget <= 0 || !this.free.length) continue;
      const rng = makeRng(st.seed);
      const look = vendorLook(rng, st.def);
      const a = this._alloc(look, 'vendor');
      if (!a) break;
      const v = st.vendorSpot;
      // Seated vendors sit on their crate: the chair clip's seat is 0.45 m (x stride) above the feet.
      const seat = st.sit ? (st.seatH ?? 0.4) - 0.45 * (look.variant?.stride ?? 0.9) * look.scale : 0;
      a.position.set(v.x, v.y + seat, v.z);
      a.heading = v.heading;
      a.home = { x: v.x, z: v.z, heading: v.heading };
      a.stall = st;
      a.role = `${look.name}, ${VENDOR_LABEL[st.type] || 'vendor'}`;
      st.agent = a;
      st.agentId = a.id;
      budget--;
    }
  }
}
