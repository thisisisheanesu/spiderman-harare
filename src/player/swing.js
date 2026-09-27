import * as THREE from 'three';
import { findSwingAnchor, groundBelow, SIDE_CLEAR } from './anchors.js';

// Web swinging: a rope pendulum with reel-in, pumping and steering.
// The web visibly sticks to a roof edge, a facade or (in low-rise streets) a street light / tree
// (anchor), but the physics pivot sits at the same height pulled most of the way over the line of
// travel, so swings arc down the street instead of slamming into the building the web is attached to.
// Altitude assist: ropes are reeled in so the arc bottoms out at a comfortable height above the
// street when the anchor is high enough (ALT), anchors that allow that score higher, and holding
// forward lets go on the way up so chained swings keep their height and flow.

const SWING_G = 34;
const PUMP = 8;
const STEER = 7;
const MAX_SPEED = 45;
const REEL = 14;
const MAX_REEL = 38;
const CLEARANCE = 3.8; // lowest the body centre gets above the street/roof below the pivot (clears kombis)
const ALT = 19; // preferred lowest point of a swing above the street, when the anchor is high enough
const MIN_ROPE = 9; // ...but never shorten the rope below this for it
// Low anchors (a 20-30 m roof edge, a lamp post) lift the physics pivot (never the web, which stays on
// the anchor) up to LIFT_MAX so it sits PIVOT_RISE above the body, leaving room for a real arc.
const PIVOT_RISE = 14;
const LIFT_MAX = 13;
const PLANAR = 0.85; // how far the pivot moves from the anchor towards the line of travel
const TURN_RATE = 1.4; // rad/s the swing bends towards the stick / camera direction
const HAND_UP = 1.1;
const RELEASE_ANGLE = 0.8; // rad past the bottom of the arc where holding forward lets go
const LATE_BOOST = 0.3; // s after an automatic release in which jump still gives the boosted release
const LIFT_BELOW = 20; // releases below this height above the street get a little extra lift...
const LIFT = 4; // ...of up to this many m/s
const BAND_TOP = 22; // releases above this height over the street fling / boost less upwards...
const BAND_FADE = 16; // ...fading out over this many metres
const BOOST_UP = 9; // m/s up from a boosted (jump) release, low in the band
// Plunge catch: diving head-first down a tall facade, the web goes back up that facade (CATCH_RISE
// above the hand) and the pivot sits CATCH_AHEAD out over the street, so the fall whips out into a
// big swing away from the tower. Only below CATCH_ALT, so the plunge itself gets its moment.
const CATCH_ALT = 62;
const CATCH_RISE = 16;
const CATCH_AHEAD = 17;
const CATCH_STREET_COS = Math.cos(0.6); // ...out along the street below if it runs within this of the dive
// Street following: within STREET_COS (cos of the angle) of a street at least STREET_MIN_W wide,
// the swing direction bends up to STREET_PULL of the way onto it.
const STREET_REACH = 35;
const STREET_MIN_W = 6;
const STREET_COS = Math.cos(0.95);
const STREET_PULL = 0.7;
const STREET_CENTER = 0.7; // how much of the way the swing line drifts to the street's centre line
const STREET_SHIFT_MAX = 10;
const AIM_COS = Math.cos(1.1); // input within this of the swing direction steers along the latter
const ARC_SAMPLES = 5;
const HELD_LEAP = 0.3; // s standing with swing held before it leaps into the next swing
const HELD_WALL = 0.6; // s on a wall with swing held before springing off it...
const HELD_WALL_ROOF = 7; // ...unless its top is closer than this (then climb over)
const TRICKS = ['flip', 'twirl', 'corkscrew'];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();

export class SwingMove {
  constructor(ctrl) {
    this.c = ctrl;
    this.anchor = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.ropeLen = 0;
    this.ropeTarget = 0;
    this.delay = 0;
    this.side = 1;
    this.time = 0;
    this.retry = 0;
    this.lateBoost = 0;
    this.preFling = 0;
    this.cinematic = false;
    this.kind = '';
    this.line = null;
    this.hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), side: 1, buildingId: -1, kind: '', clear: true };
    this.plan = { point: new THREE.Vector3(NaN, 0, 0), pivot: new THREE.Vector3(), L0: 0, target: 0 };
    this.street = { active: false, shift: new THREE.Vector3(), dir: new THREE.Vector3() };
    this.aim = new THREE.Vector3(0, 0, -1); // swing direction chosen at the start (street-aligned)
    this._planHand = new THREE.Vector3();
    this._planDir = new THREE.Vector3();
    this.query = {
      speed: 0,
      fall: 0,
      side: 1,
      street: 0,
      alt: ALT,
      minRope: MIN_ROPE,
      pivotRise: PIVOT_RISE,
      liftMax: LIFT_MAX,
      planar: PLANAR,
      // Street lights / trees for low-rise streets, if the city provides them.
      fallback: (x, z, r) => ctrl.game.city?.anchorsNear?.(x, z, r),
      // Prefer anchors whose swing has a clear arc (see _arcClear).
      accept: (point) => this._plan(point, this._planHand, this._planDir) && this._arcClear(),
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
    this.street.active = false;
    const qx = p.position.x + out.x * 12;
    const qz = p.position.z + out.z * 12;
    const near = c.world.nearestRoad?.(qx, qz, STREET_REACH);
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
        if (k > 0) {
          out.multiplyScalar(1 - k).add(_a.set(sx * k, 0, sz * k)).normalize();
          // Also drift the swing line over the middle of the street.
          const st = this.street;
          st.active = true;
          st.dir.set(sx, 0, sz);
          st.shift.set(near.x - qx, 0, near.z - qz).multiplyScalar(STREET_CENTER * k);
          const sl2 = st.shift.length();
          if (sl2 > STREET_SHIFT_MAX) st.shift.multiplyScalar(STREET_SHIFT_MAX / sl2);
        }
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
      // Leap first; the web goes out near the top of the jump. (Held rather than pressed: once
      // standing for a moment, so W + swing held keeps going after a landing or a roof run.)
      if (!fresh) {
        if (st !== 'wall' && c.standTime < HELD_LEAP) return;
        // On a wall: climb over a low one; spring off a tall one.
        if (st === 'wall' && (c.wallTime < HELD_WALL || !this._wallAbove(HELD_WALL_ROOF))) return;
      }
      if (st === 'wall') {
        if (fresh) c.wall.jump();
        else c.wall.launchOff();
      }
      else if (st === 'perch') c.leaveHighPerch(c.perchOut.x * 6, 10, c.perchOut.z * 6);
      else c.launch(p.velocity.x, 13, p.velocity.z);
      this.retry = 0.2;
      return;
    }
    const dir = this._direction(_dir);
    const hand = _hand.copy(c.center);
    hand.y += HAND_UP;
    if (c.plunge) {
      if (c.center.y - c.floorAt(hand.x, hand.z) > CATCH_ALT) {
        this.retry = 0.06;
        return;
      }
      if (this._plungeCatch(hand, dir)) return;
    }
    const q = this.query;
    q.speed = p.velocity.length();
    q.fall = -p.velocity.y;
    q.side = -this.side;
    q.street = this._street(hand.x, hand.z);
    this._planHand.copy(hand);
    this._planDir.copy(dir);
    this.plan.point.set(NaN, 0, 0);
    this.cinematic = false;
    const hit = findSwingAnchor(c.world, hand, dir, q, this.hit);
    if (!hit || !this._start(hit, hand, dir)) this.retry = 0.12;
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

  // Web back up the facade we are plunging down (see CATCH_*). False if there is no wall there.
  _plungeCatch(hand, dir) {
    const c = this.c;
    const out = c.perchOut;
    // Whip out along the street below if there is one, else straight out from the facade.
    if (this.street.active && this.street.dir.dot(out) > CATCH_STREET_COS) dir.copy(this.street.dir);
    else if (dir.dot(out) < 0.3) dir.copy(out);
    _c.set(hand.x, hand.y + CATCH_RISE, hand.z);
    const hit = c.world.raycast(_c, _b.set(-out.x, 0, -out.z), 30);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return false;
    const h = this.hit;
    h.point.copy(hit.point).addScaledVector(hit.normal, 0.05);
    h.normal.copy(hit.normal);
    h.side = (hand.x - hit.point.x) * dir.z - (hand.z - hit.point.z) * dir.x > 0 ? 1 : -1;
    h.buildingId = hit.buildingId;
    h.kind = 'facade';
    h.clear = true;
    this.cinematic = true;
    const center = c.center;
    this.plan.pivot.set(center.x + dir.x * CATCH_AHEAD, h.point.y, center.z + dir.z * CATCH_AHEAD);
    return this._plan(h.point, hand, dir, true) && this._start(h, hand, dir);
  }

  // Work out the swing a web to `point` would give: physics pivot, starting rope, rope target.
  // False if the arc would be too short to be worth it. (pivotSet: plan.pivot is already placed.)
  _plan(point, hand, dir, pivotSet = false) {
    const c = this.c;
    const center = c.center;
    const plan = this.plan;
    const pivot = plan.pivot;
    if (!pivotSet) {
      // Physics pivot: the anchor slid towards the line of travel...
      const rx = -dir.z;
      const rz = dir.x;
      const lat = (point.x - center.x) * rx + (point.z - center.z) * rz;
      // ...but always a little to the side of it, clear of the anchor's own wall.
      const slide = Math.sign(lat) * Math.min(Math.abs(lat), Math.max(Math.abs(lat) * PLANAR, SIDE_CLEAR));
      pivot.copy(point);
      pivot.x -= rx * slide;
      pivot.z -= rz * slide;
      if (this.street.active) {
        // Towards the street's centre line, but never back onto the anchor's side of the pivot.
        const sh = this.street.shift;
        const toward = sh.x * rx + sh.z * rz;
        if (toward * lat <= 0 || Math.abs(toward) < Math.abs(lat - slide)) pivot.add(sh);
      }
      if (point.y >= hand.y - 1) pivot.y += Math.min(LIFT_MAX, Math.max(0, center.y + PIVOT_RISE - point.y));
    }
    plan.point.copy(point);
    const L0 = center.distanceTo(pivot);
    const mx = (center.x + pivot.x) / 2;
    const mz = (center.z + pivot.z) / 2;
    // What is below the arc: halfway there, and under the pivot where it bottoms out.
    const floor = Math.max(groundBelow(c.world, mx, pivot.y - 0.5, mz), groundBelow(c.world, pivot.x, pivot.y - 0.5, pivot.z));
    // Lowest point of the arc: clear of whatever is below, and up at ALT over the street when the
    // anchor is high enough to leave a MIN_ROPE rope.
    const bottom = Math.max(floor + CLEARANCE, Math.min(this._street(mx, mz) + ALT, pivot.y - MIN_ROPE));
    plan.L0 = L0;
    plan.target = Math.min(L0, pivot.y - bottom);
    return plan.target >= 4;
  }

  // Would the planned arc (from here, down under the pivot and up to the release angle) run into a
  // wall? Samples the arc in the vertical plane through the body and the pivot.
  _arcClear() {
    const c = this.c;
    const center = c.center;
    const { pivot, target, L0 } = this.plan;
    const u = _c.subVectors(pivot, center).setY(0);
    const ul = u.length();
    if (ul < 0.5) return true;
    u.divideScalar(ul);
    const R = (target + L0) / 2;
    const th0 = Math.atan2(-ul, pivot.y - center.y);
    let px = center.x;
    let py = center.y;
    let pz = center.z;
    for (let k = 1; k <= ARC_SAMPLES; k++) {
      const th = th0 + ((RELEASE_ANGLE - th0) * k) / ARC_SAMPLES;
      const qx = pivot.x + u.x * R * Math.sin(th);
      const qy = pivot.y - R * Math.cos(th);
      const qz = pivot.z + u.z * R * Math.sin(th);
      _a.set(px, py, pz);
      _b.set(qx - px, qy - py, qz - pz);
      const len = _b.length();
      if (len > 0.01 && c.world.raycast(_a, _b.divideScalar(len), len + 0.5)) return false;
      px = qx;
      py = qy;
      pz = qz;
    }
    return true;
  }

  _start(hit, hand, dir) {
    const c = this.c;
    const p = c.p;
    const plan = this.plan;
    if (!plan.point.equals(hit.point) && !this._plan(hit.point, hand, dir)) return false;
    if (plan.target < 4) return false;
    this.pivot.copy(plan.pivot);
    this.aim.copy(dir);
    const L0 = plan.L0;
    const target = plan.target;
    if (p.state === 'dive') c.game.cameraRig?.fovKick?.(-3);
    this.anchor.copy(hit.point);
    this.kind = hit.kind || 'roof';
    this.ropeLen = L0;
    this.ropeTarget = target;
    this.delay = Math.max(0.05, hand.distanceTo(hit.point) / 520);
    this.side = hit.side;
    this.time = 0;
    this.lateBoost = 0;
    p.state = 'swing';
    c.clearActions();
    const handKey = hit.side > 0 ? 'R' : 'L';
    this.line = p.webs.shoot(handKey, p.hands[handKey], hit.point, hit.normal, { splat: hit.kind !== 'prop' });
    c.emit('player:webShot', { from: hand.clone(), to: hit.point.clone() });
    c.emit('player:swingStart', { anchor: hit.point.clone() });
    return true;
  }

  step(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    this.time += h;
    v.y -= SWING_G * h;
    if (this.delay > 0) {
      this.delay -= h;
    } else {
      const rope = _a.subVectors(this.pivot, c.center).normalize();
      // Forward input pumps along the arc; sideways input steers.
      const vt = _b.copy(v).addScaledVector(rope, -v.dot(rope));
      const vtl = vt.length();
      const steer = this._steer();
      if (vtl > 0.5) v.addScaledVector(vt, (Math.max(0, steer.dot(vt) / vtl) * PUMP * h) / vtl);
      v.addScaledVector(_c.copy(steer).addScaledVector(rope, -steer.dot(rope)), STEER * h);
      c.steerTowardsWish(h, TURN_RATE, steer);
    }
    // Reeling in (rope longer than the arc allows): the web yanks you up towards the pivot.
    const excess = this.ropeLen - this.ropeTarget;
    const reel = this.delay <= 0 && excess > 0 ? Math.min(MAX_REEL, Math.max(REEL, excess * 6)) : 0;
    this.ropeLen -= Math.min(Math.max(excess, 0), reel * h);
    p.position.addScaledVector(v, h);
    let len = 0;
    if (this.delay <= 0) {
      const d = _a.subVectors(c.center, this.pivot);
      len = d.length();
      if (len > this.ropeLen) {
        d.divideScalar(len);
        p.position.addScaledVector(d, this.ropeLen - len);
        const vr = v.dot(d);
        if (vr > -reel) v.addScaledVector(d, -reel - vr);
      }
      if (this.line) this.line.slack = Math.max(0, this.ropeLen - len);
    }
    const sp = v.length();
    if (sp > MAX_SPEED) v.multiplyScalar(MAX_SPEED / sp);

    const res = c.collide();
    if (res.ground && c.impactVy >= -0.5) {
      this.release(false, true);
      c.land(Math.max(0, c.impactVy));
      return;
    }
    if (res.wall && c.wallImpact > 2) {
      this.release(false, true);
      c.obstacle(res.wallNormal, c.wallImpact);
      return;
    }
    const center = c.center;
    // Past the top of the arc (or dangling): let go automatically. (Caught while still falling past
    // a level anchor is not the top of the arc.)
    if ((center.y > this.pivot.y - 1 && v.y > 0) || (this.time > 5 && sp < 4)) {
      this.release(false);
      return;
    }
    // Holding forward: let go on the way up, well before the arc stalls, so the next web carries on.
    const steer = this._steer();
    if (this.delay <= 0 && this.time > 0.35 && v.y > 1 && len > 1 && steer.dot(v) > 0.3 * sp * steer.length()) {
      const past = Math.acos(Math.min(1, Math.max(-1, (this.pivot.y - center.y) / len)));
      if (past > RELEASE_ANGLE) this.release(false);
    }
  }

  // The input as a steering direction: along the swing's aim when roughly that way (down the street),
  // or always along it for the cinematic plunge catch (the camera is still whipping round).
  _steer() {
    const c = this.c;
    const wl = c.wish.length();
    if (wl > 0.2 && (this.cinematic || c.wish.dot(this.aim) > AIM_COS * wl)) return _dir.copy(this.aim).multiplyScalar(wl);
    return c.wish;
  }

  // Let go. A release on the rising part of the arc flings you on; boost = jump pressed mid-swing.
  release(boost, quiet = false) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    p.state = 'air';
    this.lateBoost = 0;
    if (!quiet) {
      const sp = v.length();
      if (boost) {
        this.boost();
      } else if (v.y > 0 && sp > 14) {
        this.preFling = v.y;
        v.multiplyScalar(1.05);
        // Gentle height assist: the fling tapers off above the swing band (so a chain doesn't
        // bounce far above the roofs its webs need) and low swings get a little extra lift.
        const above = p.position.y - this._street(p.position.x, p.position.z);
        v.y += (2 + 0.12 * sp) * this._bandScale(above, 0.2);
        if (above < LIFT_BELOW) v.y += LIFT * (1 - Math.max(0, above) / LIFT_BELOW);
        if (sp > 24 && Math.random() < 0.55) c.startTrick(TRICKS[Math.floor(Math.random() * TRICKS.length)]);
        this.lateBoost = LATE_BOOST;
      }
    }
    this.retry = 0.18;
    this.dropLine();
    c.emit('player:swingEnd', { pos: p.position.clone(), vel: v.clone() });
  }

  // Boosted release (jump during a swing, or just after an automatic release): a hop up and on.
  boost() {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    // Up when low, more forward when already high in the swing band.
    const up = BOOST_UP * this._bandScale(p.position.y - this._street(p.position.x, p.position.z), 0.35);
    if (hs > 0.5) v.addScaledVector(_a.set(v.x / hs, 0, v.z / hs), 3 + (BOOST_UP - up) * 0.5);
    // Just after an automatic release the fling is already in v.y: boost from before it.
    const vy = this.lateBoost > 0 ? Math.min(v.y, this.preFling) : v.y;
    v.y = Math.max(vy, 2) + up;
    this.lateBoost = 0;
    c.startTrick('flip');
    c.jumpHeld = true;
    c.emit('player:jump', { pos: p.position.clone() });
  }

  // 1 up to BAND_TOP over the street, easing to `min` BAND_FADE higher.
  _bandScale(above, min) {
    return Math.max(min, Math.min(1, 1 - (above - BAND_TOP) / BAND_FADE));
  }

  dropLine() {
    this.c.p.webs.release(this.line);
    this.line = null;
  }
}
