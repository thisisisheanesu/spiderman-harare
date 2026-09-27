import * as THREE from 'three';
import { findSwingAnchor } from './anchors.js';

// Web swinging: a real rope pendulum. The physics pivot IS the web's anchor (a roof edge, a corner, a
// facade or, in low-rise streets, a street light / tree), so the web on screen and the arc always
// agree.
//   shot   the web flies out (~0.05-0.1 s) with a little slack; the body keeps its momentum
//   taut   the rope is a stiff, critically damped spring along the web. Its radial "tug" beyond what
//          the arc itself needs (centripetal + gravity) is capped, and eased in over TUG_RAMP, so a
//          catch is a firm pull, never a velocity snap; the web pays out a little under the cap.
//   reel   only when the anchor is low for the arc's clearance: during the down-swing Spider-Man pulls
//          the web in (a visible pull, at most REEL_MAX = 5 m/s) to the planned length, never below
//          MIN_ROPE; that keeps low anchors (16-35 m roofs, lamp heads, tree crowns) swingable
//   swing  gravity SWING_G, light air drag; forward input pumps along the arc (Spider-Man pulling and
//          kicking through the downswing and bottom), sideways input steers across the swing plane;
//          brushing a wall plants a foot and kicks off it (the web stays on), meeting one head-on
//          grabs it (wall crawl)
// Clearance: the feet may come down to CLEAR_LOW (1.3 m) over an empty street, but not within
// CLEAR_HIGH of anyone, nor within VEH_CLEAR of a vehicle's roof, under the low part of the arc
// (traffic.vehiclesNear / npcs.npcsNear, checked when planning and again on the way down).
// Which anchor: findSwingAnchor ranks believable anchors geometrically, then this module simulates the
// pendulum each of the best few would give (same physics, rigid rope) and rates the outcome: arc
// clear of walls, roofs and the street (vetoed otherwise), not hugging a wall, where the release
// would carry you (towards the stick / camera / street direction; roofs ahead to web from next),
// speed kept, little reeling. Corner swings round intersections and the left-right rhythm fall out of
// that. Where nothing is tall enough to swing from without scraping the street, there is no swing:
// you land (roll) and run / sprint / wall-run instead (a physical pivot can't be higher than the
// roofs; the old lifted pivots are gone).
// Holding forward lets go by itself on the forward-upward part of the arc (REL_ELEV), when the
// upswing stalls, before the flight would climb far above the roofs ahead (ceiling), or just before a
// wall; releasing is pure momentum (no fling), and the held button shoots the next web near the top
// of the flight. On the ground the swing button is the parkour sprint (controller); jumping while
// sprinting (or holding swing standing still) is a web launch (webLaunch).

const SWING_G = 15; // m/s² on the web (~1.5 g)
const ROPE_W = 16; // rope spring natural frequency (rad/s): ~0.3 m of stretch at 7 g
const ROPE_K = ROPE_W * ROPE_W;
const ROPE_C = 2 * ROPE_W; // critically damped
const TUG = 30; // m/s² the web may pull beyond what the arc needs, right as it goes taut...
const TUG_MAX = 120; // ...easing up to this over TUG_RAMP (then it is effectively inextensible)
const TUG_RAMP = 0.35;
const SHOT_SPEED = 520; // m/s (web.js animates the same)
const SHOT_SLACK = 0.7; // m of slack in the fresh web (it sags, then pulls taut)
const KEEP_SLACK = 0.12; // once taut, slack beyond this is taken up (the web stays snug)
const REEL_MAX = 5; // m/s: pulling the web in hand over hand
const REEL_ACC = 18; // m/s² (at most 0.6 m/s per frame at 30 fps)
const REEL_GAIN = 2.5; // 1/s: reel speed per metre still to reel
const PUMP = 12; // m/s² along the arc with forward held (downswing, bottom and early upswing): Spider-Man
// pulling and kicking through
const PUMP_VY = 4; // m/s: ...until climbing faster than this
const STEER = 6; // m/s² across the swing plane
const DRAG = 0.003; // quadratic air drag (1/m): 2.7 m/s² at 30 m/s
const SUB_H = 1 / 120; // integration step
const HAND_UP = 1.1;
const CLEAR_LOW = 1.3; // m: lowest the feet may come to an empty street / a roof under the arc...
const CLEAR_HIGH = 2.6; // ...with people under the low part of the arc...
const VEH_CLEAR = 0.8; // ...and over a vehicle's roof there
const LOW_BAND = 3.2; // m: the part of the arc lower than this over the street is checked for traffic
const REEL_BUDGET = 3.5; // m the rope can be reeled in on a down-swing (anchor pre-filter)
const RELEASE_BUFFER = 1.0; // s: a jump tapped on the down-swing lets go (boosted) past the bottom, by then
const ALT = 10; // m: preferred lowest point of the feet over the street, when the anchor allows it
const MIN_ROPE = 9; // never reel shorter than this for ALT
const REL_ELEV = 0.42; // rad: forward held, let go once the velocity climbs this steeply past the bottom
const REL_ELEV_SHORT = 0.68; // ...later on short ropes (a street light, a low roof): a longer sweep, and
const REL_SHORT = 8; // the flight climbs higher for the next web (REL_ELEV_SHORT at ropes up to this
const REL_LONG_ROPE = 16; // long, REL_ELEV from this long)
const REL_MIN_T = 0.45; // ...and not before this long on the rope
const REL_LONG = 1.8; // ...or anywhere on the upswing past the anchor after this long (long ropes)
const STALL = 8; // m/s: ...or once the upswing slows to this
const WALL_AHEAD = 0.28; // s: ...or this long before running into a wall (while rising)
const CEIL_OVER = 1.5; // m: ...or once the flight would top out this far over the roofs ahead (ceiling)
const CEIL_AHEAD = [18, 38, 58]; // m ahead of the anchor along the swing: where the next webs come from
const CEIL_R = 24;
const G_FLIGHT = 20; // (= controller.js G_FLIGHT: gravity in the flight after letting go)
const NEXT_AHEAD = [22, 42]; // candidate rating: roofs this far ahead of the release...
const NEXT_R = 20; // ...within this radius
const HELD_LEAP = 0.3; // s standing still with swing held (no stick) before it leaps into a swing
const HELD_WALL = 0.6; // s on a wall with swing held before springing off it...
const HELD_WALL_ROOF = 7; // ...unless its top is closer than this (then climb over)
const LATE_BOOST = 0.3; // s after an automatic release in which jump still gives the boosted release
const BOOST_UP = 7; // m/s up and...
const BOOST_FWD = 3.5; // ...forward from a boosted (jump) release, applied over BOOST_T
const BOOST_T = 0.12;
const REFIRE_VY = 6; // held swing after a release: next web once rising slower than this (m/s)...
const REFIRE_T = 0.3; // ...or this long after letting go
// Plunge catch (the opening dive off the Reserve Bank): see _plungeCatch.
const CATCH_ALT = 42; // m above what is below: the web goes out from here down
const CATCH_RISE = 15; // m above the hand: the web goes this far back up the facade
const KICK_OUT = 14; // m/s straight out from the facade when the feet meet it on the catch swing...
const KICK_ALONG = 11; // ...plus this along the street below (the sweep's direction)...
const KICK_UP = 3;
const KICK_T = 0.26; // ...the whole kick (taking up the swing in, then pushing off) over this long
// Brushing a wall mid-swing (moving within atan(GRAZE) of along it): kick off it and keep swinging.
const GRAZE = 0.8;
const GRAZE_KICK = 5; // m/s out from the wall...
const GRAZE_T = 0.12; // ...over this long
// Web launch off the ground (see webLaunch).
const LAUNCH_REACH = 42; // m: roof edges within this, at least ~27 degrees up
const LAUNCH_JUMP = 12; // m/s: the legs' part (a jump)...
const LAUNCH_PULL = 14; // ...plus this along the lines...
const LAUNCH_UP = 3; // ...plus this straight up...
const LAUNCH_T = 0.22; // ...pushed over this long
const STREET_REACH = 35;
const STREET_MIN_W = 6;
const STREET_COS = Math.cos(0.95);
const STREET_PULL = 0.7;
const AIM_COS = Math.cos(1.1); // input within this of the swing direction steers along the latter
const ALIGN_MIN = Math.cos(1.3); // a candidate's release must head within this of the wanted direction...
const MIN_REL_SPEED = 10; // ...at least this fast (m/s; or 80 % of the speed at the start)...
const MIN_TRAVEL = 8; // ...having carried you this far along it (m)
const HUG = 2.4; // m: a building this close on the anchor's side during the swing counts as hugging it
// Candidate simulation.
const SIM_H = 1 / 30;
const SIM_T = 2.6;
const TRICKS = ['flip', 'twirl', 'corkscrew'];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _u = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _steer = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);
// Sine of the release elevation for a rope of length L (see REL_ELEV_SHORT).
const relSin = (L) => Math.sin(REL_ELEV_SHORT + (REL_ELEV - REL_ELEV_SHORT) * clamp((L - REL_SHORT) / (REL_LONG_ROPE - REL_SHORT), 0, 1));

export class SwingMove {
  constructor(ctrl) {
    this.c = ctrl;
    // The web's anchor; also the physics pivot (`pivot` is the same vector, kept for readers).
    this.anchor = new THREE.Vector3();
    this.pivot = this.anchor;
    this.ropeLen = 0; // rest length of the rope now (m)
    this.ropeTarget = 0; // planned length (m)
    this.reelSpeed = 0;
    this.dist = 0; // hand... body centre to anchor now (m)
    this.tension = 0; // rope pull per unit mass (m/s²), 0 while slack: for animation / camera / audio
    this.taut = -1; // s since the rope first went taut (-1 before)
    this.delay = 0;
    this.side = 1;
    this.time = 0;
    this.retry = 0;
    this.sinceRelease = 10;
    this.lateBoost = 0;
    this.cinematic = false;
    this.kick = 0; // plunge catch: kick off the facade when the feet reach it (1 = armed, 2 = done)
    this.kickV = new THREE.Vector3();
    this.kickT = 0;
    this.kickAt = -10;
    this.launchLines = [];
    this.launchT = 0;
    this.kind = '';
    this.line = null;
    this.hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), side: 1, buildingId: -1, kind: '', score: 0 };
    this.aim = new THREE.Vector3(0, 0, -1); // desired travel direction at the start (street-aligned)
    this.facadeN = new THREE.Vector3();
    this.plan = { L0: 0, target: 0, delay: 0, hd: 0, ceiling: 0, clear: CLEAR_LOW };
    this.clear = CLEAR_LOW; // this swing's street clearance (raised if traffic comes under it)
    this.releaseQueued = -1; // s since a jump was tapped on the down-swing (-1: none)
    this._low = { n: 0, x0: 0, z0: 0, x1: 0, z1: 0 };
    this._cars = [];
    this._people = [];
    this._trafficT = 0;
    this.ceiling = 0;
    this.sim = { hit: false, ground: false, hitT: 0, tRel: 0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0, minFeet: 0, streetRel: 0, hug: 0, kicks: 0 };
    this._planHand = new THREE.Vector3();
    this._planDir = new THREE.Vector3();
    this._planPump = false;
    // Anchor-search telemetry (counts since start; for tests / tuning).
    this.stats = { tries: 0, found: 0, rated: 0, ground: 0, wall: 0, align: 0, plan: 0, traffic: 0, props: 0 };
    this.query = {
      speed: 0,
      fall: 0,
      side: 1,
      street: 0,
      alt: ALT,
      minBottom: -Infinity,
      // Rooftop structures, street-light heads and tree crowns, if the city provides them.
      props: (x, z, r) => ctrl.game.city?.anchorsNear?.(x, z, r),
      accept: (point, cand) => this._rate(point, cand),
    };
  }

  _street(x, z) {
    const h = this.c.game.city?.heightAt?.(x, z);
    return Number.isFinite(h) ? h : 0;
  }

  // Where the player wants to go: input (camera-relative) blended with the current motion, lined up
  // with the street below when that is roughly the same way (swings flow down avenues instead of
  // cutting across blocks into walls).
  _direction(out) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    out.copy(c.wish.lengthSq() > 0.04 ? c.wish : c.camFwd).setY(0).normalize();
    // Just sprang off a wall: don't aim back into it.
    const wn = c.wall.lastNormal;
    if (c.wall.cooldown > 0 && out.dot(wn) < 0.5) out.addScaledVector(wn, 0.5 - out.dot(wn)).normalize();
    if (hs > 4) out.multiplyScalar(0.55).addScaledVector(_a.set(v.x / hs, 0, v.z / hs), 0.45).normalize();
    const near = c.world.nearestRoad?.(p.position.x + out.x * 12, p.position.z + out.z * 12, STREET_REACH);
    const r = near?.road;
    if (r && r.w >= STREET_MIN_W && !r.link) {
      const i = near.seg * 2;
      let sx = r.pts[i + 2] - r.pts[i];
      let sz = r.pts[i + 3] - r.pts[i + 1];
      const sl = Math.hypot(sx, sz);
      if (sl > 1) {
        sx /= sl;
        sz /= sl;
        let cos = sx * out.x + sz * out.z;
        if (cos < 0) {
          sx = -sx;
          sz = -sz;
          cos = -cos;
        }
        const k = STREET_PULL * Math.min(1, Math.max(0, (cos - STREET_COS) / (1 - STREET_COS)) * 2);
        if (k > 0) out.multiplyScalar(1 - k).add(_a.set(sx * k, 0, sz * k)).normalize();
      }
    }
    return out;
  }

  // Swing button pressed (fresh) or still held (retrying while no anchor was in reach).
  tryStart(fresh) {
    const c = this.c;
    const p = c.p;
    const st = p.state;
    if (st === 'ground' || st === 'perch' || st === 'wall') {
      // On the ground the held button is the parkour sprint (controller); with no stick input a
      // press, or holding it while standing, leaps up and the web goes out near the top of the jump.
      if (st === 'ground' && c.wish.lengthSq() > 0.04) return;
      // On a wall with the stick pushed up it is the parkour wall-run (keeps running up).
      if (st === 'wall' && c.move.y > 0.3) return;
      if (!fresh) {
        // (Not a hold that was sprinting: letting go of the stick stops the run, nothing more.)
        if (st !== 'wall' && (c.standTime < HELD_LEAP || c.sprintHold)) return;
        // On a wall: climb over a low one; spring off a tall one.
        if (st === 'wall' && (c.wallTime < HELD_WALL || !this._wallAbove(HELD_WALL_ROOF))) return;
      }
      if (st === 'wall') {
        if (fresh) c.wall.jump();
        else c.wall.launchOff();
      } else if (st === 'perch') c.leaveHighPerch(c.perchOut.x * 6, 10, c.perchOut.z * 6);
      else if (!this.webLaunch()) c.launch(p.velocity.x, 13, p.velocity.z);
      this.retry = 0.2;
      return;
    }
    // Held (after letting go, or through a jump): wait for the top of the flight before the next web.
    if (!fresh && p.velocity.y > REFIRE_VY && (this.sinceRelease < REFIRE_T || c.airTime < 1)) {
      this.retry = 0.03;
      return;
    }
    const dir = this._direction(_dir);
    const hand = _hand.copy(c.center);
    hand.y += HAND_UP;
    if (c.plunge) {
      if (c.center.y - c.floorAt(hand.x, hand.z) > CATCH_ALT) {
        this.retry = 0.05;
        return;
      }
      if (this._plungeCatch(hand, dir)) return;
    }
    const q = this.query;
    q.speed = p.velocity.length();
    q.fall = -p.velocity.y;
    q.side = -this.side;
    q.street = this._street(hand.x, hand.z);
    q.minBottom = q.street + CLEAR_LOW + c.centerHeight - REEL_BUDGET;
    this._planHand.copy(hand);
    this._planDir.copy(dir);
    this._planPump = c.wish.lengthSq() > 0.09;
    this.cinematic = false;
    this.stats.tries++;
    this._gatherTraffic(hand.x, hand.z);
    const hit = findSwingAnchor(c.world, hand, dir, q, this.hit);
    if (!hit || !this._start(hit, hand, dir)) this.retry = 0.1;
    else this.stats.found++;
  }

  // Web launch off the ground (jump while sprinting with swing held, or swing held standing still):
  // both hands shoot a line to a roof edge ahead and up and yank, flinging you up and on (the pull
  // is pushed over LAUNCH_T, along the lines); the lines let go and the held swing webs on near the
  // top of the leap. False (nothing to pull on) leaves the caller to do a plain jump.
  webLaunch() {
    const c = this.c;
    const p = c.p;
    const dir = this._direction(_dir);
    const hand = _hand.copy(c.center);
    hand.y += HAND_UP;
    const q = this.query;
    q.speed = p.velocity.length();
    q.fall = 0;
    q.side = -this.side;
    q.street = this._street(hand.x, hand.z);
    const accept = q.accept;
    q.minBottom = -Infinity;
    q.accept = (pt) => {
      const d = hand.distanceTo(pt);
      const up = (pt.y - hand.y) / d;
      return d > LAUNCH_REACH || up < 0.45 ? null : -Math.abs(up - 0.7);
    };
    const hit = findSwingAnchor(c.world, hand, dir, q, this.hit);
    q.accept = accept;
    if (!hit) return false;
    _a.subVectors(hit.point, hand).normalize();
    const v = p.velocity;
    c.launch(v.x, Math.max(v.y, LAUNCH_JUMP), v.z);
    _b.copy(_a).multiplyScalar(LAUNCH_PULL);
    _b.y += LAUNCH_UP;
    c.push(_b, LAUNCH_T);
    this.dropLaunch();
    _c.crossVectors(_a, _b.set(0, 1, 0));
    if (_c.lengthSq() < 1e-4) _c.set(1, 0, 0);
    _c.normalize().multiplyScalar(0.12);
    this.launchLines.push(p.webs.shoot('L', p.hands.L, _b.copy(hit.point).sub(_c), hit.normal));
    this.launchLines.push(p.webs.shoot('R', p.hands.R, _b.copy(hit.point).add(_c), hit.normal, { splat: false }));
    this.launchT = LAUNCH_T + 0.08;
    c.emit('player:webShot', { from: hand.clone(), to: hit.point.clone() });
    return true;
  }

  // (Controller, every frame.) Let the launch lines go once the yank is done.
  updateLaunch(dt) {
    if (this.launchT > 0 && (this.launchT -= dt) <= 0) this.dropLaunch();
  }

  dropLaunch() {
    for (const l of this.launchLines) this.c.p.webs.release(l);
    this.launchLines.length = 0;
    this.launchT = 0;
  }

  // Does the wall we cling to go on at least `h` metres above the chest? (A probe into it.)
  _wallAbove(h) {
    const c = this.c;
    const n = c.wall.normal;
    _c.copy(c.center);
    _c.y += h;
    const hit = c.world.raycast(_c, _b.set(-n.x, 0, -n.z), c.p.radius + 1.5);
    return !!hit && Math.abs(hit.normal.y) < 0.5;
  }

  // ------------------------------------------------------------------ planning

  // Rope for a web to `point` from the body centre (cx, cy, cz): its length when it lands (L0,
  // including the shot's slack) and the planned length (target): as shot, unless the arc would
  // then bottom out too low (below ALT over the street when the anchor is high enough, and never
  // closer than out.clear to the street or a roof under the arc), in which case it reels in to that.
  // False if no usable rope is left.
  _planRope(point, cx, cy, cz, out) {
    const c = this.c;
    const d = Math.hypot(point.x - cx, point.y - cy, point.z - cz);
    // What is under the arc: between here and the anchor, under it, and a little beyond.
    const dx = point.x - cx;
    const dz = point.z - cz;
    const hd = Math.hypot(dx, dz) || 1;
    // (Roofs as high as the anchor are its own building or walls in the way: the simulation judges
    // those.)
    let floor = 0;
    for (let k = 0.45; k <= 0.9; k += 0.15) {
      const f = c.floorAt(cx + dx * k, cz + dz * k);
      if (f < point.y - 2) floor = Math.max(floor, f);
    }
    const street = this._street(point.x, point.z);
    const ch = c.centerHeight;
    const low = Math.max(floor + out.clear, Math.min(street + ALT, point.y - MIN_ROPE - ch)) + ch;
    out.L0 = d + SHOT_SLACK;
    out.target = Math.min(out.L0, point.y - low);
    out.hd = hd;
    out.ceiling = this._ceiling(point, this._planDir, street);
    return out.target >= 5;
  }

  // Tallest roof within NEXT_R of the points NEXT_AHEAD m ahead of (x, z) along (dx, dz).
  _roofsAhead(x, z, dx, dz) {
    const world = this.c.world;
    let top = 0;
    for (const s of NEXT_AHEAD) {
      const list = world.buildingsNear(x + dx * s, z + dz * s, NEXT_R);
      for (let i = 0; i < list.length; i++) if (list[i].h > top) top = list[i].h;
    }
    return top;
  }

  // Roof height the next webs can come from, ahead of the anchor along dir: releases don't climb far
  // above it (a flight high over low roofs has nothing to catch; it just falls to the street).
  _ceiling(point, dir, street) {
    const world = this.c.world;
    let top = street + ALT + 6;
    for (const s of CEIL_AHEAD) {
      const list = world.buildingsNear(point.x + dir.x * s, point.z + dir.z * s, CEIL_R);
      for (let i = 0; i < list.length; i++) if (list[i].h > top) top = list[i].h;
    }
    return top;
  }

  // Rate a candidate anchor by simulating the swing it would give (rigid rope, same gravity, reel,
  // drag and pumping; auto-release as step() does). null vetoes it.
  _rate(point, cand) {
    const c = this.c;
    const plan = this.plan;
    const hand = this._planHand;
    const v = c.p.velocity;
    const center = c.center;
    const delay = Math.max(0.03, hand.distanceTo(point) / SHOT_SPEED);
    // Where the body is when the web lands.
    const cx = center.x + v.x * delay;
    const cy = center.y + v.y * delay - 0.5 * SWING_G * delay * delay;
    const cz = center.z + v.z * delay;
    const st = this.stats;
    st.rated++;
    plan.clear = CLEAR_LOW;
    if (!this._planRope(point, cx, cy, cz, plan)) {
      st.plan++;
      return null;
    }
    plan.delay = delay;
    let s = this._simulate(point, plan.L0, plan.target, this._planPump, this.sim, cand);
    // Someone or something under the low part of the arc: plan it higher over them (more reeling),
    // or not at all.
    if (!s.hit && s.minFeet < LOW_BAND) {
      const need = this._clearanceUnder(this._low);
      if (need > s.minFeet) {
        st.traffic++;
        plan.clear = need;
        if (!this._planRope(point, cx, cy, cz, plan)) {
          st.plan++;
          return null;
        }
        s = this._simulate(point, plan.L0, plan.target, this._planPump, this.sim, cand);
        if (!s.hit && s.minFeet < this._clearanceUnder(this._low)) return null;
      }
    }
    if (cand) cand.clear = plan.clear;
    // Never a swing into the street / onto a roof, nor into a wall before it would let go.
    if (s.hit) {
      if (s.ground) st.ground++;
      else st.wall++;
      return null;
    }
    const dir = this._planDir;
    const speed0 = v.length();
    const hs = Math.hypot(s.vx, s.vz) || 1;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const align = (s.vx * dir.x + s.vz * dir.z) / hs;
    // Not a swing that carries you off the way you are going / steering (a corner swing wins when
    // the stick or camera turns into the side street).
    if (align < ALIGN_MIN) {
      st.align++;
      return null;
    }
    const reel = plan.L0 - plan.target;
    const dur = s.tRel - plan.delay;
    // Worth a web: it keeps (most of) the speed and carries you on, not a slow dangle down a wall.
    const travel = (s.x - center.x) * dir.x + (s.z - center.z) * dir.z;
    if (spd < Math.max(MIN_REL_SPEED, 0.8 * speed0) || travel < MIN_TRAVEL) {
      st.align++;
      return null;
    }
    let score =
      2 * align +
      0.025 * clamp(s.streetRel - (center.y - c.centerHeight - this._street(center.x, center.z)), -12, 12) +
      0.08 * clamp(spd - speed0, -10, 10) +
      0.6 * smooth(CLEAR_LOW, ALT, s.minFeet) +
      0.35 * smooth(8, 18, s.streetRel) +
      0.5 * bump(dur, 1.4, 0.9) -
      0.8 * smooth(2.2, 2.6, dur) -
      0.05 * Math.max(0, reel - 3);
    score -= 1.2 * s.hug;
    // Somewhere to go next: roofs ahead of the release point at about the release height or above.
    const ahead = this._roofsAhead(s.x, s.z, s.vx / hs, s.vz / hs);
    score += 0.6 * smooth(-8, 3, ahead - s.y);
    if (s.minFeet < plan.clear) {
      st.ground++;
      return null;
    }
    return score;
  }

  // Vehicles and people near the player, gathered once per anchor search (for _clearanceUnder).
  _gatherTraffic(x, z) {
    const game = this.c.game;
    const cars = this._cars;
    const people = this._people;
    cars.length = 0;
    people.length = 0;
    const vs = game.traffic?.vehiclesNear?.(x, z, 80);
    if (vs) for (let i = 0; i < vs.length; i++) if (vs[i]?.position) cars.push(vs[i]);
    const ps = game.npcs?.npcsNear?.(x, z, 70);
    if (ps) for (let i = 0; i < ps.length; i++) if (ps[i]?.position) people.push(ps[i]);
  }

  // The street clearance the low part of an arc (low: its first and last point under LOW_BAND)
  // needs: CLEAR_LOW over an empty street, more over people and vehicles.
  _clearanceUnder(low) {
    if (!low.n) return CLEAR_LOW;
    let need = CLEAR_LOW;
    const ax = low.x0;
    const az = low.z0;
    const bx = low.x1 - ax;
    const bz = low.z1 - az;
    const bl = bx * bx + bz * bz || 1e-6;
    const dist = (px, pz) => {
      const t = clamp(((px - ax) * bx + (pz - az) * bz) / bl, 0, 1);
      return Math.hypot(px - ax - bx * t, pz - az - bz * t);
    };
    for (const v of this._cars) {
      if (dist(v.position.x, v.position.z) < (v.length || 4) / 2 + 1.5) need = Math.max(need, (v.height || 1.6) + VEH_CLEAR);
    }
    for (const n of this._people) {
      if (dist(n.position.x, n.position.z) < 1.6) need = Math.max(need, CLEAR_HIGH);
    }
    return need;
  }

  // The swing on a rope to `point` from the current state, as far as the automatic release (or a
  // hit, or SIM_T). Writes {hit, hitT, tRel, v at release, y, minFeet (lowest feet over the street),
  // streetRel (feet over the street at release)} into out.
  _simulate(point, L0, target, pump, out, cand = null) {
    const c = this.c;
    const world = c.world;
    const v = c.p.velocity;
    const center = c.center;
    const ch = c.centerHeight;
    let x = center.x;
    let y = center.y;
    let z = center.z;
    let vx = v.x;
    let vy = v.y;
    let vz = v.z;
    let L = L0;
    let reel = 0;
    let taut = false;
    const delay = this.plan.delay;
    const ceiling = this.plan.ceiling + CEIL_OVER;
    const h = SIM_H;
    out.hit = false;
    out.ground = false;
    out.hitT = SIM_T;
    out.minFeet = Infinity;
    out.hug = 0;
    out.kicks = 0;
    const low = this._low;
    low.n = 0;
    let samples = 0;
    let t = 0;
    let released = false;
    for (; t < SIM_T; t += h) {
      vy -= SWING_G * h;
      const sp = Math.hypot(vx, vy, vz);
      const dk = 1 - DRAG * sp * h;
      vx *= dk;
      vy *= dk;
      vz *= dk;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let d = 0;
      if (t >= delay) {
        dx = x - point.x;
        dy = y - point.y;
        dz = z - point.z;
        d = Math.hypot(dx, dy, dz) || 1e-3;
        dx /= d;
        dy /= d;
        dz /= d;
        if (pump && vy < PUMP_VY && taut) {
          const vr = vx * dx + vy * dy + vz * dz;
          const tx = vx - dx * vr;
          const ty = vy - dy * vr;
          const tz = vz - dz * vr;
          const tl = Math.hypot(tx, ty, tz);
          if (tl > 1) {
            vx += (tx / tl) * PUMP * h;
            vy += (ty / tl) * PUMP * h;
            vz += (tz / tl) * PUMP * h;
          }
        }
        const excess = L - target;
        const want = excess > 0 && taut ? Math.min(REEL_MAX, excess * REEL_GAIN) : 0;
        reel += clamp(want - reel, -REEL_ACC * h, REEL_ACC * h);
        L -= reel * h;
      }
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (t >= delay) {
        dx = x - point.x;
        dy = y - point.y;
        dz = z - point.z;
        d = Math.hypot(dx, dy, dz) || 1e-3;
        if (d > L) {
          dx /= d;
          dy /= d;
          dz /= d;
          x -= dx * (d - L);
          y -= dy * (d - L);
          z -= dz * (d - L);
          const vr = vx * dx + vy * dy + vz * dz;
          if (vr > 0) {
            vx -= dx * vr;
            vy -= dy * vr;
            vz -= dz * vr;
          }
          taut = true;
        } else {
          // Slack is taken in as it appears (the line is kept snug: flying towards the anchor the
          // rope shortens, and the swing starts from where you actually are when it pulls).
          const keep = taut ? KEEP_SLACK : SHOT_SLACK;
          if (d < L - keep) L = d + keep;
        }
      }
      // Collisions: roofs / street under the feet, building volumes at the body.
      const feet = y - ch;
      const street = this._street(x, z);
      if (feet - street < out.minFeet) out.minFeet = feet - street;
      if (feet - street < LOW_BAND) {
        if (!low.n) {
          low.x0 = x;
          low.z0 = z;
        }
        low.x1 = x;
        low.z1 = z;
        low.n++;
      }
      // Hugging a wall: a building right beside the body, on the anchor's side.
      if (t >= delay) {
        const ad2 = Math.hypot(point.x - x, point.z - z) || 1;
        samples++;
        if (this._solidAt(world, x + ((point.x - x) / ad2) * HUG, z + ((point.z - z) / ad2) * HUG, feet)) out.hug++;
      }
      if (feet < street + 0.3) {
        out.hit = out.ground = true;
        out.hitT = t;
        break;
      }
      // (The body's bulk: its centre, and a body-width ahead and towards the anchor's side.)
      const hs = Math.hypot(vx, vz) || 1;
      const ad = Math.hypot(point.x - x, point.z - z) || 1;
      const solid =
        this._solidAt(world, x, z, feet) ||
        this._solidAt(world, x + (vx / hs) * 0.7, z + (vz / hs) * 0.7, feet) ||
        this._solidAt(world, x + ((point.x - x) / ad) * 0.6, z + ((point.z - z) / ad) * 0.6, feet);
      if (solid && cand && cand.id >= 0 && out.kicks < 2 && this._simKick(world, cand, x, z, vx, vz, feet)) {
        // Brushing the anchor's own facade: a foot-plant kick off it (as step() does).
        const vn = vx * cand.nx + vz * cand.nz;
        vx += cand.nx * (Math.max(0, -vn) + GRAZE_KICK);
        vz += cand.nz * (Math.max(0, -vn) + GRAZE_KICK);
        x += cand.nx * 0.5;
        z += cand.nz * 0.5;
        out.kicks++;
      } else if (solid) {
        out.hit = true;
        out.ground = world.roofHeightAt(x, z) > feet - 0.5 && world.roofHeightAt(x, z) < feet + 0.6;
        out.hitT = t;
        break;
      }
      // Automatic release (forward held), as in step().
      if (taut && t - delay > REL_MIN_T && vy > 0) {
        const vs = Math.hypot(vx, vy, vz);
        const ahead = (x - point.x) * vx + (z - point.z) * vz > 0;
        const apex = y - ch + (vy * vy) / (2 * G_FLIGHT);
        if ((ahead && (vy > vs * relSin(L) || t - delay > REL_LONG || apex > ceiling)) || vs < STALL || y > point.y - 1) {
          released = true;
          break;
        }
      }
    }
    out.tRel = released || !out.hit ? t : Math.max(0, t - 0.2);
    out.hug = samples ? out.hug / samples : 0;
    out.x = x;
    out.z = z;
    out.vx = vx;
    out.vy = vy;
    out.vz = vz;
    out.y = y;
    out.streetRel = y - ch - this._street(x, z);
    if (!Number.isFinite(out.minFeet)) out.minFeet = 0;
    return out;
  }

  // Would the swing's body at (x, z) moving (vx, vz) brush candidate cand's own facade (not run into
  // it head-on, nor into another building)?
  _simKick(world, cand, x, z, vx, vz, feet) {
    const b = world.buildingAt(x + cand.nx * 0.2, z + cand.nz * 0.2) || world.buildingAt(x - cand.nx * 0.7, z - cand.nz * 0.7);
    if (!b || b.id !== cand.id || b.h < feet + 0.2) return false;
    const hs = Math.hypot(vx, vz);
    const vn = -(vx * cand.nx + vz * cand.nz);
    return hs > 4 && vn < GRAZE * hs;
  }

  // A building volume at (x, z) spanning the body (feet .. head)?
  _solidAt(world, x, z, feet) {
    const b = world.buildingAt(x, z);
    return !!b && b.h > feet + 0.2 && (b.minH || 0) < feet + 1.8;
  }

  // ------------------------------------------------------------------ start

  _start(hit, hand, dir) {
    const c = this.c;
    const p = c.p;
    const plan = this.plan;
    if (!this.cinematic) {
      // (_rate planned the rope for the candidate it saw last, which need not be the winner.)
      const center = c.center;
      const v = p.velocity;
      plan.delay = Math.max(0.03, hand.distanceTo(hit.point) / SHOT_SPEED);
      const cx = center.x + v.x * plan.delay;
      const cy = center.y + v.y * plan.delay;
      const cz = center.z + v.z * plan.delay;
      plan.clear = hit.clear || CLEAR_LOW;
      if (!this._planRope(hit.point, cx, cy, cz, plan)) return false;
    }
    this.clear = this.cinematic ? CLEAR_LOW : plan.clear;
    this.releaseQueued = -1;
    if (hit.kind === 'prop') this.stats.props++;
    this.aim.copy(dir);
    if (p.state === 'dive') c.game.cameraRig?.fovKick?.(-3);
    this.anchor.copy(hit.point);
    this.kind = hit.kind || 'roof';
    this.ropeLen = plan.L0;
    this.ropeTarget = plan.target;
    this.ceiling = plan.ceiling + CEIL_OVER;
    this.reelSpeed = 0;
    this.delay = plan.delay;
    this.side = hit.side;
    this.time = 0;
    this.taut = -1;
    this.tension = 0;
    this.lateBoost = 0;
    this.kick = 0;
    this.kickT = 0;
    this.kickAt = -10;
    p.state = 'swing';
    c.clearActions();
    c.flight = false;
    const handKey = hit.side > 0 ? 'R' : 'L';
    this.line = p.webs.shoot(handKey, p.hands[handKey], hit.point, hit.normal, { splat: hit.kind !== 'prop' });
    c.emit('player:webShot', { from: hand.clone(), to: hit.point.clone() });
    c.emit('player:swingStart', { anchor: hit.point.clone() });
    return true;
  }

  // ------------------------------------------------------------------ physics

  step(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    this.time += h;
    const n = Math.max(1, Math.ceil(h / SUB_H - 1e-6));
    for (let i = 0; i < n; i++) this._integrate(h / n);

    if (this.kick === 1) {
      // About to meet the tower (its footprint can stand a little proud of the facade mesh).
      const ctr = c.center;
      const b = c.world.buildingAt(ctr.x + v.x * 0.2, ctr.z + v.z * 0.2);
      if (b && b.h > p.position.y && this._kickOff()) return;
    }
    const res = c.collide();
    // (Catch swing: the body meeting the facade at all, a band or ledge on it included, is the kick.)
    if (res.hit && this.kick === 1 && res.delta.y < 0.7 * res.delta.length() && this._kickOff()) return;
    if (res.ground && c.impactVy >= -0.5) {
      this.release(false, true);
      c.land(Math.max(0, c.impactVy));
      return;
    }
    // (Pushing off the facade after the catch: the feet are meant to be on it.)
    const kicking = this.kickT > 0 || this.time - this.kickAt < 0.3;
    if (res.wall && c.wallImpact > 2 && !kicking) {
      // Brushing a wall: plant a foot and kick off it, still on the web; running into one: grab it.
      const hs = Math.hypot(v.x, v.z);
      if (this.taut > 0.2 && hs > 4 && c.wallImpact < GRAZE * hs && Math.abs(res.wallNormal.y) < 0.3) {
        this._kickFrom(res.wallNormal, c.wallImpact);
        return;
      }
      this.release(false, true);
      c.obstacle(res.wallNormal, c.wallImpact);
      return;
    }
    this._watchTraffic(h);
    if (this.releaseQueued >= 0) {
      // A jump tapped on the down-swing: let go (boosted) once past the bottom and rising.
      this.releaseQueued += h;
      const ctr = c.center;
      const ahead = (ctr.x - this.anchor.x) * v.x + (ctr.z - this.anchor.z) * v.z > 0;
      if ((ahead && v.y > 0) || this.taut >= RELEASE_BUFFER || this.releaseQueued > RELEASE_BUFFER) {
        this.release(true);
        return;
      }
    }
    if (this.delay > 0 || this.taut < 0) return;
    const center = c.center;
    const sp = v.length();
    // Swung up to the anchor's level (the rope goes slack) or left dangling: let go.
    if ((center.y > this.anchor.y - 1 && v.y > 0) || (this.time > 6 && sp < 3)) {
      this.release(false);
      return;
    }
    // Holding forward: let go on the forward-upward part of the arc, when the upswing stalls, or just
    // before a wall.
    const steer = this._steer();
    // (Not while the catch swing is still heading for the facade, nor while its kick pushes off.)
    if (steer.lengthSq() > 0.09 && this.kick !== 1 && this.time - this.kickAt > 0.35) {
      if (this.taut > REL_MIN_T && v.y > 0) {
        const ahead = (center.x - this.anchor.x) * v.x + (center.z - this.anchor.z) * v.z > 0;
        const apex = p.position.y + (v.y * v.y) / (2 * G_FLIGHT);
        if ((ahead && (v.y > sp * relSin(this.ropeLen) || this.taut > REL_LONG || apex > this.ceiling)) || sp < STALL) {
          this.release(false);
          return;
        }
      }
      // (Going down, better to meet the wall and cling to it than to drop off the web.)
      if (this.taut > 0.2 && sp > 6 && v.y > 0 && this._wallAhead(sp)) this.release(false);
    }
  }

  _integrate(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    v.y -= SWING_G * h;
    if (this.kickT > 0) {
      v.addScaledVector(this.kickV, Math.min(h, this.kickT));
      this.kickT -= h;
    }
    v.multiplyScalar(1 - DRAG * v.length() * h);
    if (this.delay > 0) {
      // Web still in flight: momentum carries on.
      this.delay -= h;
      p.position.addScaledVector(v, h);
      if (this.delay <= 0) this.dist = c.center.distanceTo(this.anchor);
      return;
    }
    const center = c.center;
    const u = _u.subVectors(center, this.anchor);
    let d = u.length();
    if (d < 1e-3) return;
    u.divideScalar(d);
    const taut = this.taut >= 0;
    if (taut) {
      this.taut += h;
      // Input: forward pumps along the arc (on the downswing and through the bottom); sideways
      // steers across the swing plane.
      const vr0 = v.dot(u);
      const vt = _a.copy(v).addScaledVector(u, -vr0);
      const vtl = vt.length();
      const steer = this._steer();
      if (vtl > 1 && steer.lengthSq() > 0.01) {
        vt.divideScalar(vtl);
        const fwd = steer.dot(vt);
        if (fwd > 0 && v.y < PUMP_VY) v.addScaledVector(vt, fwd * PUMP * h);
        const side = _b.crossVectors(u, vt);
        const lat = steer.dot(side);
        v.addScaledVector(side, lat * STEER * h);
        c.steerTowardsWish(h, 0.6, steer);
      }
      // Dropping towards the street / a roof anyway (steering or pumping took the arc lower than
      // planned): pull up on the web.
      const feet = p.position.y - this._street(p.position.x, p.position.z);
      if (feet < this.clear && v.y < 0) this.ropeTarget = Math.min(this.ropeTarget, d - (this.clear - feet) - 1);
      // Reel in towards the planned length (smoothly); take up slack beyond KEEP_SLACK.
      const excess = this.ropeLen - this.ropeTarget;
      const want = excess > 0 ? Math.min(REEL_MAX, excess * REEL_GAIN) : 0;
      this.reelSpeed += clamp(want - this.reelSpeed, -REEL_ACC * h, REEL_ACC * h);
      this.ropeLen -= this.reelSpeed * h;
    }
    // Slack is taken in as it appears (see _simulate).
    const keep = taut ? KEEP_SLACK : SHOT_SLACK;
    if (d < this.ropeLen - keep) this.ropeLen = d + keep;
    // Rope: a stiff, critically damped spring along the web (implicit, so stable at any step).
    const x = d - this.ropeLen;
    const vr = v.dot(u);
    let T = 0;
    if (x > 0) {
      if (!taut) this.taut = 0;
      const vr1 = (vr - h * ROPE_K * x) / (1 + h * ROPE_C + h * h * ROPE_K);
      T = Math.max(0, (vr - vr1) / h);
      // What the arc itself needs (centripetal + gravity along the rope) is always there; the extra
      // radial tug is capped, easing in after the catch.
      const vt2 = Math.max(0, v.lengthSq() - vr * vr);
      const need = vt2 / d + Math.max(0, -u.y) * SWING_G;
      // (Reeling in needs its own pull on top.)
      const cap = 1.25 * need + TUG + (TUG_MAX - TUG) * smooth(0, TUG_RAMP, this.taut) + (this.reelSpeed > 0.5 ? 1.5 * REEL_ACC : 0);
      if (T > cap) {
        T = cap;
        // The web pays out under the cap instead of winding up the spring (a catch's stretch is not
        // reeled back in).
        this.ropeLen = Math.max(this.ropeLen, d - cap / ROPE_K);
        if (this.reelSpeed < 0.5) this.ropeTarget = Math.max(this.ropeTarget, this.ropeLen);
      }
      v.addScaledVector(u, -T * h);
    }
    this.tension += (T - this.tension) * Math.min(1, h * 30);
    p.position.addScaledVector(v, h);
    this.dist = d;
    if (this.line) this.line.slack = Math.max(0, this.ropeLen - d);
  }

  // A wall straight ahead within WALL_AHEAD seconds of travel?
  _wallAhead(sp) {
    const c = this.c;
    const v = c.p.velocity;
    const hit = c.world.raycast(c.center, _c.copy(v).divideScalar(sp), sp * WALL_AHEAD + c.p.radius + 0.5);
    return !!hit && Math.abs(hit.normal.y) < 0.6;
  }

  // The input as a steering direction: along the swing's aim when roughly that way (down the street),
  // or always along it for the cinematic plunge catch (the camera is still whipping round).
  _steer() {
    const c = this.c;
    const wl = c.wish.length();
    if (wl > 0.2 && (this.cinematic || c.wish.dot(this.aim) > AIM_COS * wl)) return _steer.copy(this.aim).multiplyScalar(wl);
    return _steer.copy(c.wish);
  }

  // ------------------------------------------------------------------ plunge catch

  // The opening dive off the Reserve Bank: nothing else near is anywhere near as tall, so the only
  // web that can take the fall goes back up the tower's own face. It catches the plunge (a firm,
  // capped pull that turns the fall into a swing in towards the facade); the feet meet the glass at
  // the bottom of that swing and kick off (KICK_OUT), and the same web sweeps you out and up over
  // the street below in a real arc (the release carries on down Samora Machel Avenue).
  // False if there is no wall there.
  _plungeCatch(hand, dir) {
    const c = this.c;
    const out = c.perchOut;
    _c.set(hand.x, hand.y + CATCH_RISE, hand.z);
    const hit = c.world.raycast(_c, _b.set(-out.x, 0, -out.z), 40);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return false;
    const h = this.hit;
    h.point.copy(hit.point).addScaledVector(hit.normal, 0.05);
    h.normal.copy(hit.normal);
    h.side = (hand.x - hit.point.x) * dir.z - (hand.z - hit.point.z) * dir.x > 0 ? 1 : -1;
    h.buildingId = hit.buildingId;
    h.kind = 'facade';
    this.cinematic = true;
    this.facadeN.set(hit.normal.x, 0, hit.normal.z).normalize();
    // Kick out along the street below the tower when it leads away from it, else straight out.
    const near = c.world.nearestRoad?.(hand.x + out.x * 12, hand.z + out.z * 12, STREET_REACH);
    const r = near?.road;
    this.aim.copy(this.facadeN);
    if (r && r.w >= STREET_MIN_W && !r.link) {
      const i = near.seg * 2;
      _a.set(r.pts[i + 2] - r.pts[i], 0, r.pts[i + 3] - r.pts[i + 1]);
      const len = _a.length();
      if (len > 1) {
        _a.divideScalar(len);
        if (_a.dot(dir) < 0) _a.negate();
        if (_a.dot(this.facadeN) > -0.2) this.aim.copy(_a);
      }
    }
    const center = c.center;
    const plan = this.plan;
    plan.delay = Math.max(0.03, hand.distanceTo(h.point) / SHOT_SPEED);
    plan.L0 = center.distanceTo(h.point) + SHOT_SLACK;
    plan.target = plan.L0;
    plan.ceiling = Infinity;
    const ok = this._start(h, hand, this.aim);
    if (ok) this.kick = 1;
    return ok;
  }

  // Feet on the facade at the bottom of the catch swing: push off it, out along the aim, staying on
  // the web (which now swings you out over the street).
  _kickOff() {
    const c = this.c;
    const v = c.p.velocity;
    // The legs take up the swing into the wall and push off, out and along the street, all over
    // KICK_T (the kick starts a moment before the body would touch).
    const into = Math.max(0, -(v.x * this.facadeN.x + v.z * this.facadeN.z));
    const k = this.kickV;
    k.copy(this.facadeN).multiplyScalar(KICK_OUT + into);
    _a.copy(this.aim).addScaledVector(this.facadeN, -this.aim.dot(this.facadeN));
    if (_a.lengthSq() > 0.01) k.addScaledVector(_a.normalize(), KICK_ALONG);
    k.y += KICK_UP;
    k.divideScalar(KICK_T);
    this.kickT = KICK_T;
    this.kick = 2;
    this.kickAt = this.time;
    c.emit('player:jump', { pos: c.p.position.clone() });
    return true;
  }

  // Foot-plant kick off a wall brushed mid-swing: the into-wall speed back out, plus a push.
  _kickFrom(n, impact) {
    const k = this.kickV;
    k.set(n.x, 0, n.z).normalize().multiplyScalar(impact * 0.6 + GRAZE_KICK);
    k.divideScalar(GRAZE_T);
    this.kickT = GRAZE_T;
    this.kickAt = this.time;
    this.c.emit('player:wallKick', { pos: this.c.p.position.clone() });
  }

  // ------------------------------------------------------------------ release

  // Jump pressed mid-swing: a boosted release; tapped on the down-swing of a young swing it waits for
  // the bottom of the arc (letting go on the way down would only drop you towards the street).
  jumpPressed() {
    const c = this.c;
    const v = c.p.velocity;
    const ctr = c.center;
    const ahead = (ctr.x - this.anchor.x) * v.x + (ctr.z - this.anchor.z) * v.z > 0;
    const young = this.taut < 0 ? this.time < RELEASE_BUFFER : this.taut < RELEASE_BUFFER;
    if (young && !(ahead && v.y > 0) && this.kick !== 1) {
      if (this.releaseQueued < 0) this.releaseQueued = 0;
      return;
    }
    this.release(true);
  }

  // On the way down, vehicles or people moving in under the arc: raise the clearance (the reel pulls
  // up; failing that, the feet meet the roof and land on it).
  _watchTraffic(h) {
    if ((this._trafficT -= h) > 0) return;
    this._trafficT = 0.1;
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const feet = p.position.y - this._street(p.position.x, p.position.z);
    if (feet > LOW_BAND + 3 || v.y > 2) return;
    const low = this._low;
    low.n = 1;
    low.x0 = p.position.x;
    low.z0 = p.position.z;
    low.x1 = p.position.x + v.x * 0.6;
    low.z1 = p.position.z + v.z * 0.6;
    this._gatherTraffic(p.position.x, p.position.z);
    this.clear = Math.max(this.clear, this._clearanceUnder(low));
  }

  // Let go: pure momentum. boost = jump pressed mid-swing (a hop up and on).
  release(boost, quiet = false) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    p.state = 'air';
    this.lateBoost = 0;
    this.releaseQueued = -1;
    this.kick = 0;
    this.kickT = 0;
    this.tension = 0;
    c.flight = true;
    if (!quiet) {
      if (boost) {
        this.boost();
      } else if (v.y > 0 && v.length() > 14) {
        if (v.length() > 24 && Math.random() < 0.55) c.startTrick(TRICKS[Math.floor(Math.random() * TRICKS.length)]);
        this.lateBoost = LATE_BOOST;
      }
    }
    this.retry = 0.12;
    this.sinceRelease = 0;
    this.dropLine();
    c.emit('player:swingEnd', { pos: p.position.clone(), vel: v.clone() });
  }

  // Boosted release (jump during a swing, or just after an automatic release): a hop up and on,
  // pushed over BOOST_T rather than in one frame.
  boost() {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    _a.set(0, BOOST_UP, 0);
    if (hs > 0.5) _a.addScaledVector(_b.set(v.x / hs, 0, v.z / hs), BOOST_FWD);
    c.push(_a, BOOST_T);
    this.lateBoost = 0;
    c.startTrick('flip');
    c.jumpHeld = true;
    c.emit('player:jump', { pos: p.position.clone() });
  }

  dropLine() {
    this.c.p.webs.release(this.line);
    this.line = null;
  }
}
