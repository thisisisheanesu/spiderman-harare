import * as THREE from 'three';
import { bubbleLayer } from '../npc/bubbles.js';

// Hwindi calls over kombis ("KuMbare! KuMbare!"). They are drawn by the street's shared speech-bubble
// layer (src/npc/bubbles.js, owned by the npcs system), the same bubbles the touts on foot use, so one
// budget covers everything said on screen: on phones at most one or two bubbles, only for speakers near
// Spider-Man, never over him or the HUD. Without that layer (npcs system absent) calls are silent text-wise.
//
// Interface (traffic.js / kombi.js): show(vehicle, call {text, en}, life s) -> bool (false: refused by the
// budget or no layer), canShow(vehicle) -> bool, release(vehicle), update(dt, camera) (no-op: the layer
// updates itself), active (calls on screen now).

const LIFE = 3.4; // s
const ROOF = 0.45; // m above the roof
const SIDE = 1.1; // m towards the door side (left of the heading)

export class SpeechBubbles {
  constructor(scene, size = 3) {
    this.scene = scene;
    this.size = size;
    this.calls = new Map(); // vehicle -> layer item
    this._pos = new THREE.Vector3();
  }

  get layer() {
    return bubbleLayer(this.scene);
  }

  get active() {
    let n = 0;
    for (const [v, item] of this.calls) {
      if (item.key === v && item.until > (this.layer?.game.time ?? 0)) n++;
      else this.calls.delete(v);
    }
    return n;
  }

  // Where the call's tail points: above the kombi's door side (false once the vehicle is gone).
  _anchor(v) {
    const id = v.id;
    return (out) => {
      if (v.id !== id || (!v.parked && !v.path)) return false;
      const lx = -Math.cos(v.heading);
      const lz = Math.sin(v.heading);
      out.set(v.position.x + lx * SIDE, v.position.y + (v.height || 2.2) + ROOF, v.position.z + lz * SIDE);
      return true;
    };
  }

  // Would a call from this kombi get a bubble now?
  canShow(vehicle) {
    const layer = this.layer;
    if (!layer) return false;
    return this._anchor(vehicle)(this._pos) && layer.canShow('call', this._pos);
  }

  // Shows call {text, en} over the vehicle for `life` seconds (default LIFE).
  show(vehicle, call, life = LIFE) {
    const layer = this.layer;
    if (!layer || !call?.text) return false;
    if (this.active >= this.size && !this.calls.has(vehicle)) return false;
    const en = call.en && call.en !== call.text ? call.en : '';
    const item = layer.showAt(vehicle, vehicle.id, this._anchor(vehicle), call.text, en, Math.max(LIFE, life) * 1000, 'call');
    if (!item) return false;
    this.calls.set(vehicle, item);
    return true;
  }

  release(vehicle) {
    if (!this.calls.has(vehicle)) return;
    this.calls.delete(vehicle);
    this.layer?.release(vehicle);
  }

  update() {}
}
