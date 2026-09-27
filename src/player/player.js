import * as THREE from 'three';
import { buildSpiderManMesh, PIVOT_Y, B } from './model.js';
import { SuitMaterial, SUITS } from './suits.js';
import { Animator } from './animator.js';
import { Controller } from './controller.js';
import { Webs } from './web.js';
import { roofEdgeFacing, groundBelow } from './anchors.js';

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
// Emits player:jump / land / webShot / swingStart / swingEnd / zip / wallStart / perch / suit.

const PALM = new THREE.Vector3(0, -0.09, -0.012);
const AIM_INTERVAL = 0.1;

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
    this._syncVisual(0);
  }

  // Start crouched on the Reserve Bank's roof edge looking out over the CBD (like a perch shot).
  _spawnOnRBZ(data) {
    const rbz = data.buildings.find((b) => b.lm === 'rbz') || data.buildings.reduce((a, b) => (b.h > a.h ? b : a));
    const edge = roofEdgeFacing(rbz, -rbz.cx, -rbz.cz);
    const x = edge.x - edge.nx * 0.35;
    const z = edge.z - edge.nz * 0.35;
    this.teleport(x, groundBelow(this.game.world, x, rbz.h + 5, z, 10, rbz.h), z);
    this.controller.perchAt(this.position, { x: edge.nx, z: edge.nz });
    this.heading = Math.atan2(-edge.nx, -edge.nz);
  }

  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.state = 'air';
    this.controller.reset();
    this.webs.clear();
    this.game.cameraRig?.snap?.();
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
