import * as THREE from 'three';

// Baseline player: capsule that runs, jumps and does a very simple web swing.
// (Placeholder — the full Spider-Man controller replaces this file, keeping the public API.)
//
// Public API (game.player):
//   position   THREE.Vector3  feet position (bottom of the capsule), world metres
//   velocity   THREE.Vector3  m/s
//   state      'ground' | 'air' | 'swing' | 'zip' | 'wall' | 'perch'
//   heading    radians, facing direction around +y (0 = facing -z / north)
//   object     THREE.Object3D  visual root
//   suit       'classic' | 'symbiote'
//   radius, height
//   teleport(x, y, z)
export class Player {
  constructor() {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.state = 'air';
    this.heading = 0;
    this.radius = 0.4;
    this.height = 1.8;
    this.suit = 'classic';
    this.anchor = null;
  }

  async init(game) {
    this.game = game;
    this.world = game.world;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(this.radius, this.height - this.radius * 2, 4, 8),
      new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.6 }),
    );
    body.position.y = this.height / 2;
    body.castShadow = true;
    this.object = new THREE.Group();
    this.object.add(body);
    game.scene.add(this.object);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.webLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#ffffff' }));
    this.webLine.frustumCulled = false;
    this.webLine.visible = false;
    game.scene.add(this.webLine);

    // Start perched on the Reserve Bank of Zimbabwe (tallest building) if present.
    const rbz = game.data.buildings.find((b) => b.lm === 'rbz' || b.name === 'Reserve Bank of Zimbabwe');
    if (rbz) this.teleport(rbz.cx, rbz.h + 0.05, rbz.cz);
    else this.teleport(0, 2, 0);
  }

  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.state = 'air';
  }

  update(dt, game) {
    const input = game.input;
    const cam = game.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, input.move.y).addScaledVector(right, input.move.x);

    if (input.pressed('jump') && this.state === 'ground') {
      this.velocity.y = 9;
      this.state = 'air';
      game.events.emit('player:jump', { pos: this.position.clone() });
    }

    if (input.pressed('swing') && this.state !== 'swing') {
      const dir = fwd.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 1, 0)).normalize();
      const origin = this.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const hit = this.world.raycast(origin, dir, 120);
      if (hit) {
        this.anchor = hit.point;
        this.ropeLen = hit.distance;
        this.state = 'swing';
        game.events.emit('player:webShot', { from: origin, to: hit.point.clone() });
      }
    }
    if (this.state === 'swing' && !input.down('swing')) {
      this.state = 'air';
      this.anchor = null;
    }

    const steps = Math.max(1, Math.ceil((this.velocity.length() * dt) / 0.3));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.substep(h, wish);

    this.object.position.copy(this.position);
    const hv = Math.hypot(this.velocity.x, this.velocity.z);
    if (hv > 0.5) this.heading = Math.atan2(-this.velocity.x, -this.velocity.z);
    this.object.rotation.y = this.heading;

    this.webLine.visible = !!this.anchor;
    if (this.anchor) {
      const p = this.webLine.geometry.attributes.position;
      p.setXYZ(0, this.position.x, this.position.y + 1.4, this.position.z);
      p.setXYZ(1, this.anchor.x, this.anchor.y, this.anchor.z);
      p.needsUpdate = true;
    }
  }

  substep(h, wish) {
    const v = this.velocity;
    if (this.state === 'ground') {
      const target = wish.clone().multiplyScalar(14);
      v.x += (target.x - v.x) * Math.min(1, h * 10);
      v.z += (target.z - v.z) * Math.min(1, h * 10);
    } else {
      v.x += wish.x * 8 * h;
      v.z += wish.z * 8 * h;
    }
    v.y -= 22 * h;

    this.position.addScaledVector(v, h);

    if (this.state === 'swing' && this.anchor) {
      const hand = this.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const d = hand.clone().sub(this.anchor);
      const len = d.length();
      if (len > this.ropeLen) {
        d.normalize();
        this.position.addScaledVector(d, this.ropeLen - len);
        const radial = v.dot(d);
        if (radial > 0) v.addScaledVector(d, -radial);
      }
    }

    const start = this.position.clone().add(new THREE.Vector3(0, this.radius, 0));
    const end = this.position.clone().add(new THREE.Vector3(0, this.height - this.radius, 0));
    const res = this.world.collideCapsule(start, end, this.radius);
    if (res.hit) {
      this.position.copy(start).y -= this.radius;
      const n = res.normal;
      const into = v.dot(n);
      if (into < 0) v.addScaledVector(n, -into);
    }
    if (res.ground && v.y <= 0.1) {
      if (this.state !== 'ground' && this.state !== 'swing') {
        this.game.events.emit('player:land', { pos: this.position.clone(), speed: -v.y, hard: v.y < -18 });
      }
      if (this.state !== 'swing') this.state = 'ground';
    } else if (this.state === 'ground') {
      this.state = 'air';
    }
  }
}
