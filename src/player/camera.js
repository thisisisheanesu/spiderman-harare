import * as THREE from 'three';

// Baseline third-person orbit camera (placeholder — the full camera rig replaces this file).
// Public: yaw, pitch (radians), distance, shake(amount)
export class CameraRig {
  constructor() {
    this.yaw = Math.PI; // looking south
    this.pitch = -0.25;
    this.distance = 6;
    this.target = new THREE.Vector3();
  }

  async init(game) {
    this.game = game;
  }

  shake() {}

  update(dt, game) {
    const input = game.input;
    this.yaw -= input.look.x * 0.0025;
    this.pitch -= input.look.y * 0.0025;
    this.pitch = Math.max(-1.35, Math.min(1.0, this.pitch));
    const p = game.player;
    this.target.copy(p.position).add(new THREE.Vector3(0, 1.6, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const cam = game.camera;
    cam.position.copy(this.target).addScaledVector(dir, -this.distance);
    cam.lookAt(this.target);
  }
}
