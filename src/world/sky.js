import * as THREE from 'three';

// Baseline sky + lighting. The sun light follows the player so shadows stay crisp near the camera.
// Public: sky.sun (DirectionalLight), sky.hemi, sky.setTimeOfDay(hours), sky.timeOfDay
export class Sky {
  async init(game) {
    this.game = game;
    const scene = game.scene;
    scene.background = new THREE.Color('#9cc3e6');
    scene.fog = new THREE.Fog('#c9d6e0', 300, 2600);

    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#8a7a62', 1.1);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    sun.castShadow = game.quality.shadows;
    sun.shadow.mapSize.set(game.quality.shadowMapSize, game.quality.shadowMapSize);
    const s = 90;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 700 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.sunDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
    this.timeOfDay = 10.5;
  }

  setTimeOfDay(hours) {
    this.timeOfDay = hours;
  }

  update() {
    const focus = this.game.player?.position || this.game.camera.position;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 350);
  }
}
