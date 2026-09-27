import * as THREE from 'three';

// Floating comic-style speech bubbles for hwindi calls: a small pool of sprites that follow their
// kombi, pop in, hold, and fade. Textures are rendered once per phrase and cached.

const LIFE = 3.4;
const W = 512;
const H = 200;

function bubbleTexture(text, en) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 46px "Arial Black", Impact, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.font = 'italic 26px sans-serif';
  const ew = en ? ctx.measureText(en).width : 0;
  const bw = Math.min(W - 12, Math.max(tw, ew) + 56);
  const x0 = (W - bw) / 2;
  const y0 = 8;
  const bh = en ? 136 : 100;
  const r = 34;
  ctx.fillStyle = '#fffdf4';
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, r);
  ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, r);
  ctx.lineTo(W / 2 - 4, y0 + bh);
  ctx.lineTo(W / 2 - 34, H - 8);
  ctx.lineTo(W / 2 - 34, y0 + bh);
  ctx.arcTo(x0, y0 + bh, x0, y0, r);
  ctx.arcTo(x0, y0, x0 + bw, y0, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#141414';
  ctx.font = 'bold 46px "Arial Black", Impact, sans-serif';
  const sx = Math.min(1, (bw - 40) / tw);
  ctx.save();
  ctx.translate(W / 2, y0 + (en ? 50 : bh / 2));
  ctx.scale(sx, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  if (en) {
    ctx.fillStyle = '#5a5a5a';
    ctx.font = 'italic 26px sans-serif';
    ctx.fillText(en, W / 2, y0 + 104, bw - 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SpeechBubbles {
  constructor(scene, size = 3) {
    this.cache = new Map();
    this.pool = [];
    for (let i = 0; i < size; i++) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.center.set(0.5, 0);
      sprite.visible = false;
      sprite.renderOrder = 5;
      scene.add(sprite);
      this.pool.push({ sprite, vehicle: null, age: 0 });
    }
  }

  get active() {
    let n = 0;
    for (const b of this.pool) if (b.vehicle) n++;
    return n;
  }

  show(vehicle, call) {
    let slot = this.pool.find((b) => !b.vehicle);
    if (!slot) slot = this.pool.reduce((a, b) => (b.age > a.age ? b : a));
    const key = call.text;
    if (!this.cache.has(key)) this.cache.set(key, bubbleTexture(call.text, call.en && call.en !== call.text ? call.en : ''));
    slot.sprite.material.map = this.cache.get(key);
    slot.sprite.material.needsUpdate = true;
    slot.vehicle = vehicle;
    slot.age = 0;
    slot.sprite.visible = true;
  }

  release(vehicle) {
    for (const b of this.pool) {
      if (b.vehicle !== vehicle) continue;
      b.vehicle = null;
      b.sprite.visible = false;
    }
  }

  update(dt, camera) {
    for (const b of this.pool) {
      const v = b.vehicle;
      if (!v) continue;
      b.age += dt;
      if (b.age > LIFE) {
        b.vehicle = null;
        b.sprite.visible = false;
        continue;
      }
      const s = b.sprite;
      // Above the door side of the kombi (left of the heading).
      const lx = -Math.cos(v.heading);
      const lz = Math.sin(v.heading);
      s.position.set(v.position.x + lx * 1.2, v.height + 0.5, v.position.z + lz * 1.2);
      const dist = camera.position.distanceTo(s.position);
      const pop = Math.min(1, b.age / 0.18);
      const scale = (0.75 + 0.25 * pop) * Math.max(1, dist / 16);
      s.scale.set(3.4 * scale, 1.33 * scale, 1);
      s.material.opacity = Math.min(pop, (LIFE - b.age) / 0.5, 1);
    }
  }
}
