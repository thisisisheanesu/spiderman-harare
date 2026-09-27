import * as THREE from 'three';

// Baseline audio manager (placeholder — the full audio system replaces this file, keeping the API).
//
// Public API (game.audio):
//   ctx                       AudioContext (created on first user gesture via unlock())
//   unlock()                  call from a click/tap handler
//   playVoice(clipId, position?, opts?) -> handle {stop(), ended: Promise} | null
//   playSfx(name, position?, opts?)     -> synthesized one-shots: 'thwip', 'whoosh', 'land', 'horn', 'zip'
//   setMasterVolume(v), muted
export class AudioManager {
  async init(game) {
    this.game = game;
    this.listener = new THREE.AudioListener();
    game.camera.add(this.listener);
    this.ctx = this.listener.context;
    this.muted = false;
  }

  unlock() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  playVoice() {
    return null;
  }

  playSfx() {
    return null;
  }

  setMasterVolume(v) {
    this.listener.setMasterVolume(v);
  }

  update() {}
}
