import * as THREE from 'three';

// Phone-camera flashes from people filming Spider-Man: a handful of additive sprites in one draw call.

const MAX = 16;
const LIFE = 0.12;

function flareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(235,245,255,0.8)');
  grd.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Flashes {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX).fill(LIFE);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: flareTexture(), size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.next = 0;
  }

  // Fire a flash from an agent's raised phone.
  fire(a) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const s = a.look.scale;
    this.pos[i * 3] = a.position.x - Math.sin(a.heading) * 0.5 * s;
    this.pos[i * 3 + 1] = a.position.y + 1.62 * s;
    this.pos[i * 3 + 2] = a.position.z - Math.cos(a.heading) * 0.5 * s;
    this.age[i] = 0;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      this.age[i] += dt;
      if (this.age[i] < LIFE) live = i + 1;
      // Spent flashes drop out of sight instead of being re-packed.
      else this.pos[i * 3 + 1] = -1000;
    }
    this.points.geometry.setDrawRange(0, live);
    this.points.geometry.attributes.position.needsUpdate = live > 0;
    this.points.visible = live > 0;
  }
}
