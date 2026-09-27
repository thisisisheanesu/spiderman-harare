import * as THREE from 'three';
import { EventBus } from './events.js';
import { Input } from './input.js';
import { PostFX } from './postfx.js';

// Game: owns the renderer, scene, camera, main loop and the list of systems.
//
// A system is any object with (all optional):
//   async init(game)      called once, in registration order, during boot
//   update(dt, game)      called every frame (dt in seconds, clamped to 1/20) unless game.paused
//   pausedUpdate(dt,game) called every frame while paused (menus, map)
//   onResize(w, h, game)
// Systems are also reachable by name: game.systems.player, game.player, ...
export class Game {
  constructor({ container, data, voices, quality }) {
    this.container = container;
    this.data = data;
    this.voices = voices;
    this.events = new EventBus();
    this.systems = {};
    this.order = [];
    this.paused = false;
    this.time = 0;
    this.frame = 0;
    this.quality = quality;

    const renderer = new THREE.WebGLRenderer({
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('game-canvas');
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.25, 5000);
    this.camera.position.set(0, 60, 60);
    this.scene.add(this.camera);

    this.input = new Input(renderer.domElement);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  add(name, system) {
    this.systems[name] = system;
    this[name] = system;
    this.order.push(system);
    return system;
  }

  async init(onProgress) {
    for (let i = 0; i < this.order.length; i++) {
      const s = this.order[i];
      if (s.init) await s.init(this);
      onProgress?.((i + 1) / this.order.length, s);
      // Yield a frame so the loading bar can repaint between heavy steps (timeout covers hidden tabs).
      await new Promise((r) => {
        const t = setTimeout(r, 50);
        requestAnimationFrame(() => {
          clearTimeout(t);
          setTimeout(r, 0);
        });
      });
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const s of this.order) s.onResize?.(w, h, this);
  }

  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    this.events.emit('game:pause', { paused: p });
  }

  start() {
    this.timer.reset();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.step();
    };
    loop();
  }

  step(forcedDt) {
    let raw = forcedDt;
    if (raw === undefined) {
      this.timer.update();
      raw = this.timer.getDelta();
    }
    const dt = Math.min(raw, 1 / 20);
    this._fpsAcc += raw;
    this._fpsFrames++;
    if (this._fpsAcc > 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this.input.update(dt);
    if (!this.paused) {
      this.time += dt;
      for (const s of this.order) {
        if (s.update) {
          try {
            s.update(dt, this);
          } catch (err) {
            if (!s._errored) console.error('[game] system update failed', s, err);
            s._errored = true;
          }
        }
      }
    } else {
      for (const s of this.order) {
        if (!s.pausedUpdate) continue;
        try {
          s.pausedUpdate(dt, this);
        } catch (err) {
          if (!s._pausedErrored) console.error('[game] system pausedUpdate failed', s, err);
          s._pausedErrored = true;
        }
      }
    }
    // Scene + post effects (ambient occlusion, night glow; none on 'low'). See postfx.js.
    if (!this.postfx) this.postfx = new PostFX(this);
    this.postfx.render(this.scene, this.camera);
    this.frame++;
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }
}
