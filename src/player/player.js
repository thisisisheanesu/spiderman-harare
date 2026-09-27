import * as THREE from 'three';
import { buildSpiderManMesh, PIVOT_Y, B } from './model.js';
import { SuitMaterial, SUITS } from './suits.js';
import { Animator } from './animator.js';
import { Controller } from './controller.js';
import { Webs } from './web.js';
import { roofEdgeFacing } from './anchors.js';

// Spider-Man: procedural skinned model, traversal controller, animation and web visuals.
//
// Public API (game.player):
//   position   THREE.Vector3  feet position, world metres
//   velocity   THREE.Vector3  m/s
//   state      'ground' | 'air' | 'swing' | 'zip' | 'wall' | 'perch' | 'dive'
//   heading    radians, 0 = facing north (-z), CCW positive: forward = (-sin h, 0, -cos h)
//   object     THREE.Object3D visual root (pivot at the hips; the rig hangs below it)
//   suit       'classic' | 'symbiote' (F toggles; setSuit(name) to force)
//   radius, height, speed (m/s getter)
//   teleport(x, y, z)
//   hands      {L, R} world positions of the palms (web anchors), updated every frame
//   locomotion 'idle' | 'walk' | 'run' | 'sprint': the ground gait (meaningful while state is 'ground';
//              'idle' in every other state). Thresholds on groundSpeed with hysteresis: walk above
//              0.25 m/s, run above 2.6 (back to walk below 2.2), sprint above 9.5 (back below 8.5).
//   groundSpeed horizontal speed on the ground, m/s (0 off the ground). Typical: walk ~1.0-1.8,
//              run ~3.6-7, sprint ~13, more for a moment after landing out of a swing.
//   turnRate   rad/s the body is turning on the ground (+ = left / CCW seen from above), smoothed;
//              0 off the ground. (controller.skid is true while reversing at speed skids.)
// Emits player:jump / land / webShot / swingStart / swingEnd / zip / wallStart / perch / suit.

const PALM = new THREE.Vector3(0, -0.09, -0.012);
const AIM_INTERVAL = 0.1;
const SKY_Y = 1500; // above anything in the city: start of the "is this spot enclosed" ray casts

const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

// Outermost standable point of a roof / crown lip near edge point (x, z) with outward normal
// (nx, nz): scans outwards with downward rays for the last surface within ~2 m of the roof height.
// Returns feet {x, y, z} a little inside that lip.
function crownLip(world, x, z, nx, nz, roofH) {
  let best = null;
  for (let s = -1.5; s <= 3.0001; s += 0.1) {
    _o.set(x + nx * s, roofH + 12, z + nz * s);
    const hit = world.raycast(_o, _down, 16);
    if (hit && hit.point.y > roofH - 0.6 && hit.normal.y > 0.7) best = { s, y: hit.point.y };
    else if (best && s - best.s > 0.35) break;
  }
  const s = best ? best.s - 0.3 : -0.35;
  return { x: x + nx * s, y: best ? best.y : roofH, z: z + nz * s };
}

export class Player {
  constructor() {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.state = 'air';
    this.heading = 0;
    this.radius = 0.4;
    this.height = 1.8;
    this.suit = 'classic';
    this.object = null;
    this.hands = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this._aim = { kind: '', point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    this._aimTimer = 0;
  }

  get speed() {
    return this.velocity.length();
  }

  get locomotion() {
    return this.controller?.locomotion ?? 'idle';
  }

  get groundSpeed() {
    return this.controller?.groundSpeed ?? 0;
  }

  get turnRate() {
    return this.controller?.turnRate ?? 0;
  }

  async init(game) {
    this.game = game;
    this.suitMaterial = new SuitMaterial(game.renderer, game.quality);
    this.rig = buildSpiderManMesh(this.suitMaterial.material);
    this.rig.mesh.position.y = -PIVOT_Y;
    this.rig.mesh.castShadow = game.quality.shadows;
    this.object = new THREE.Group();
    this.object.name = 'player';
    this.object.add(this.rig.mesh);
    game.scene.add(this.object);

    this.webs = new Webs(game.scene);
    this.controller = new Controller(this, game);
    this.animator = new Animator(this.rig, this.object);
    this._spawnOnRBZ(game.data);
    // A long first step settles the rig into the perch crouch instead of blending there on screen.
    this._syncVisual(1);
  }

  // Start crouched on the outer lip of the Reserve Bank's crown, on the facet that faces Africa Unity
  // Square, looking out over the CBD (a perch shot; the opening dive goes straight down this face).
  _spawnOnRBZ(data) {
    const world = this.game.world;
    const rbz = data.buildings.find((b) => b.lm === 'rbz') || data.buildings.reduce((a, b) => (b.h > a.h ? b : a));
    const aus = data.features?.find((f) => f.key === 'africa_unity_square') || { x: 0, z: 0 };
    const edge = roofEdgeFacing(rbz, aus.x - rbz.cx, aus.z - rbz.cz);
    const lip = crownLip(world, edge.x, edge.z, edge.nx, edge.nz, rbz.h);
    this.teleport(lip.x, lip.y, lip.z);
    this.controller.perchAt(this.position, { x: edge.nx, z: edge.nz });
    this.heading = Math.atan2(-edge.nx, -edge.nz);
  }

  // Move the player (feet) to x, y, z. A target inside solid geometry (a building volume, the Kopje,
  // a landmark crown) is lifted onto the surface found by a ray cast down from well above.
  teleport(x, y, z) {
    // A NaN here (e.g. a malformed ?spawn=) would poison the camera and every system that follows it.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      console.warn('[player] teleport ignored: non-finite position', x, y, z);
      return;
    }
    const top = this._surfaceIfInside(x, y, z);
    if (top !== null) y = top + 0.02;
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.state = 'air';
    this.controller.reset();
    this.webs.clear();
    this.game.cameraRig?.snap?.();
  }

  // Top surface at (x, z) if feet at y would be inside something solid, else null.
  _surfaceIfInside(x, y, z) {
    const world = this.game.world;
    let inside = false;
    const b = world.buildingAt?.(x, z);
    if (b && y < b.h - 0.05 && y + this.height > (b.minH || 0) + 0.1) inside = true;
    const ground = this.game.city?.heightAt?.(x, z);
    if (Number.isFinite(ground) && y < ground - 0.05) inside = true;
    // Anything else (closed landmark volumes, rooftop boxes): an odd number of surfaces crossed by
    // a vertical line above the feet, and walls all round (so the open-bottomed box of a shop canopy
    // overhead doesn't count).
    let crossings = 0;
    let first = null;
    _o.set(x, SKY_Y, z);
    for (let k = 0; k < 12; k++) {
      const hit = world.raycast(_o, _down, _o.y - y);
      if (!hit) break;
      if (first === null) first = hit.point.y;
      crossings++;
      _o.y = hit.point.y - 0.02;
    }
    if (!inside && crossings % 2 === 1) inside = this._walledIn(x, y + 0.9, z);
    if (!inside) return null;
    if (first === null) {
      // Nothing above the feet (e.g. the target is in the air below an open lip): use what is below.
      const hit = world.raycast(_o.set(x, y, z), _down, 400);
      first = hit ? hit.point.y : Math.max(0, ground || 0);
    }
    return first;
  }

  _walledIn(x, y, z) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      _o.set(x, y, z);
      if (!this.game.world.raycast(_o, _dir.set(Math.sin(a), 0, Math.cos(a)), 40)) return false;
    }
    return true;
  }

  setSuit(name) {
    if (!SUITS.includes(name) || name === this.suit) return;
    this.suit = name;
    this.suitMaterial.set(name);
    this.game.events.emit('player:suit', { suit: name });
  }

  update(dt, game) {
    if (game.input.pressed('suit') && !this.suitMaterial.transitioning) {
      this.setSuit(this.suit === 'classic' ? 'symbiote' : 'classic');
    }
    this.controller.update(dt);
    this._syncVisual(dt);
    this.webs.update(dt, game.camera, this.hands);
    this._aimTimer -= dt;
    if (this._aimTimer <= 0) {
      this._aimTimer = AIM_INTERVAL;
      const aim = this.state === 'zip' ? null : this.controller.zip.target(this._aim);
      this.webs.setAim(aim && aim.point);
    }
  }

  _syncVisual(dt) {
    this.suitMaterial.update(dt);
    this.animator.update(dt, this, this.controller);
    this.object.updateMatrixWorld(true);
    const bones = this.rig.bones;
    this.hands.L.copy(PALM).applyMatrix4(bones[B.handL].matrixWorld);
    this.hands.R.copy(PALM).applyMatrix4(bones[B.handR].matrixWorld);
  }
}
