import * as THREE from 'three';
import { synthesizeSfx } from './synth.js';
import { VoiceBank } from './voices.js';
import { Ambience } from './ambience.js';

// Audio system (game.audio).
//
// Graph: sources -> {voices, sfx, ambience} buses -> master -> limiter -> THREE.AudioListener
// (on the camera, so PannerNodes hear the world from the camera position).
//
// Public API:
//   unlock()                                   resume the context from a user gesture (retried on later gestures)
//   playVoice(clipId, position|null, {volume, onEnd}) -> {stop(), duration, setPosition(v)} | null
//   voiceClips({kind, gender, voice})          manifest clips matching every given field
//   playSfx(name, position|null, {volume, pitch}) -> {stop()} | null
//        'thwip' 'zip' 'whoosh' 'land' 'landHard' 'step' 'horn' 'kombiHoot' 'ui' (all synthesized)
//   setAmbience('crowd'|'traffic', level 0..1)
//   setMasterVolume(v), setBusVolume('voices'|'sfx'|'ambience', v), muted (get/set)
// Nothing throws while the context is suspended: sounds are simply skipped (play* return null).

const MAX_PER_SFX = 5;
const MAX_HEAR_DIST = 260; // m: positional sounds further than this are not started
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];

export class AudioManager {
  async init(game) {
    this.game = game;
    this.listener = new THREE.AudioListener();
    game.camera.add(this.listener);
    const ctx = (this.ctx = this.listener.context);
    this.hrtf = game.quality.level !== 'low';

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(this.listener.getInput());
    this.master = ctx.createGain();
    this.master.connect(this.limiter);
    this.buses = {};
    for (const name of ['voices', 'sfx', 'ambience']) {
      this.buses[name] = ctx.createGain();
      this.buses[name].connect(this.master);
    }
    this.volumes = { master: 0.8, voices: 1, sfx: 0.8, ambience: 0.7 };
    this._muted = false;
    this._applyVolumes(true);

    this.sfx = synthesizeSfx(ctx);
    this.active = {};
    this.voiceBank = new VoiceBank(game.voices);
    this.ambience = new Ambience(this);
    this._camPos = new THREE.Vector3();
    this._started = false;

    const ev = game.events;
    ev.on('player:webShot', () => this.playSfx('thwip', null, { volume: 0.7, pitch: 0.95 + Math.random() * 0.1 }));
    ev.on('player:zip', () => this.playSfx('zip', null, { volume: 0.8 }));
    ev.on('player:land', (e) => {
      const v = Math.min(1, 0.35 + (e?.speed ?? 8) / 30);
      this.playSfx(e?.hard ? 'landHard' : 'land', null, { volume: v });
    });
    ev.on('player:jump', () => this.playSfx('whoosh', null, { volume: 0.3, pitch: 1.15 }));
    ev.on('player:swingEnd', () => this.playSfx('whoosh', null, { volume: 0.45 }));
    ev.on('game:pause', (e) => this.ambience.setPaused(!!e?.paused));

    // Browsers only start audio from a gesture; keep retrying on any later one (iOS can re-suspend).
    const retry = () => {
      if (ctx.state !== 'running') this.unlock();
    };
    for (const type of GESTURES) window.addEventListener(type, retry, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && ctx.state === 'running') {
        this._hiddenSuspend = true;
        ctx.suspend().catch(() => {});
      } else if (!document.hidden && this._hiddenSuspend) {
        this._hiddenSuspend = false;
        ctx.resume().catch(() => {});
      }
    });
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback'; // play through the iOS silent switch
    } catch {
      /* not supported */
    }
  }

  unlock() {
    const ctx = this.ctx;
    if (ctx.state === 'running') {
      this._start();
      return;
    }
    try {
      ctx
        .resume()
        .then(() => this._start())
        .catch(() => {});
    } catch {
      /* resume() unavailable in this state */
    }
  }

  // First time the context runs: build the beds and start fetching recordings.
  _start() {
    if (this._started || this.ctx.state !== 'running') return;
    this._started = true;
    this.ambience.start();
    const m = this.game.voices;
    if (m) {
      this.voiceBank.load(this.ctx);
      if (m.ambient?.crowd) this.ambience.loadCrowd(m.ambient.crowd, m.ambientLoop?.crowd);
    }
  }

  get muted() {
    return this._muted;
  }

  set muted(v) {
    this._muted = !!v;
    this._applyVolumes();
  }

  setMasterVolume(v) {
    this.volumes.master = v;
    this._applyVolumes();
  }

  setBusVolume(bus, v) {
    if (!(bus in this.buses)) return;
    this.volumes[bus] = v;
    this._applyVolumes();
  }

  _applyVolumes(immediate) {
    const now = this.ctx.currentTime;
    const set = (param, v) => (immediate ? (param.value = v) : param.setTargetAtTime(v, now, 0.05));
    set(this.master.gain, this._muted ? 0 : this.volumes.master);
    for (const [name, node] of Object.entries(this.buses)) set(node.gain, this.volumes[name]);
  }

  setAmbience(key, level) {
    this.ambience.setLevel(key, level);
  }

  voiceClips(filter) {
    return this.voiceBank.filter(filter);
  }

  playVoice(clipId, position = null, { volume = 1, onEnd } = {}) {
    const clip = this.voiceBank.clip(clipId);
    const buffer = clip && this.voiceBank.buffer(clip.sprite);
    if (!buffer) return null;
    const handle = this.playBuffer(buffer, position, { volume, bus: 'voices', offset: clip.start, duration: clip.dur, ref: 4, rolloff: 1, onEnd });
    if (handle) handle.duration = clip.dur;
    return handle;
  }

  playSfx(name, position = null, { volume = 1, pitch = 1 } = {}) {
    const buffer = this.sfx[name];
    if (!buffer || (this.active[name] || 0) >= MAX_PER_SFX) return null;
    const far = name === 'horn' || name === 'kombiHoot';
    const handle = this.playBuffer(buffer, position, {
      volume,
      rate: pitch * (0.97 + Math.random() * 0.06),
      ref: far ? 8 : 4,
      rolloff: far ? 0.8 : 1.2,
      onEnd: () => this.active[name]--,
    });
    if (handle) this.active[name] = (this.active[name] || 0) + 1;
    return handle;
  }

  // Shared player for buffers: optional world position (PannerNode), bus routing and cleanup.
  playBuffer(buffer, position, { volume = 1, bus = 'sfx', rate = 1, offset = 0, duration, ref = 4, rolloff = 1, onEnd } = {}) {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return null;
    if (position) {
      this.game.camera.getWorldPosition(this._camPos);
      if (this._camPos.distanceTo(position) > MAX_HEAR_DIST) return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    let panner = null;
    if (position) {
      panner = ctx.createPanner();
      panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = ref;
      panner.rolloffFactor = rolloff;
      panner.maxDistance = 1000;
      setPannerPosition(panner, position);
      gain.connect(panner).connect(this.buses[bus]);
    } else {
      gain.connect(this.buses[bus]);
    }
    let done = false;
    src.onended = () => {
      if (done) return;
      done = true;
      src.disconnect();
      gain.disconnect();
      panner?.disconnect();
      onEnd?.();
    };
    src.start(0, offset, duration);
    return {
      stop() {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      },
      setPosition(v) {
        if (panner) setPannerPosition(panner, v);
      },
    };
  }

  update(dt, game) {
    if (!this._started) {
      if (this.ctx.state !== 'running') return;
      this._start();
    }
    this.ambience.update(dt, game.player);
  }

  pausedUpdate(dt, game) {
    if (this._started) this.ambience.update(dt, game.player);
  }
}

function setPannerPosition(panner, p) {
  if (panner.positionX) {
    panner.positionX.value = p.x;
    panner.positionY.value = p.y;
    panner.positionZ.value = p.z;
  } else {
    panner.setPosition(p.x, p.y, p.z);
  }
}
