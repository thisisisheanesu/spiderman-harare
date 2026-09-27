import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Shared, cached loading of the game's static assets (game.assets). Every URL is relative to the
// page (e.g. 'models/humans/npc_man_overalls.glb'), so the build works from any sub-path.
//
//   gltf(url)                      -> Promise<GLTF>  (meshopt-compressed files supported; cached —
//                                     clone scenes with SkeletonUtils.clone before adding twice)
//   texture(url, {srgb, repeat, anisotropy, flipY}) -> THREE.Texture (returned at once, fills in
//                                     when loaded; cached per url + options)
//   textureAsync(url, opts)        -> Promise<THREE.Texture>
//   hdr(url)                       -> Promise<THREE.DataTexture> (equirectangular)
//   json(url)                      -> Promise<any> (null on 404 / network error)
//   pending, loaded                 counts of requests in flight / finished (for loading bars)
//   onProgress(fn)                 fn(loaded, total) whenever a request starts or finishes
//   whenIdle()                     -> Promise resolving once nothing is in flight
export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.hdrLoader = new HDRLoader(this.manager);
    this.cache = new Map();
    this.pending = 0;
    this.loaded = 0;
    this._listeners = new Set();
    this._idle = [];
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  }

  onProgress(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _track(promise) {
    this.pending++;
    this._emit();
    const done = () => {
      this.pending--;
      this.loaded++;
      this._emit();
      if (this.pending === 0) {
        const waiting = this._idle;
        this._idle = [];
        for (const r of waiting) r();
      }
    };
    promise.then(done, done);
    return promise;
  }

  _emit() {
    for (const fn of this._listeners) fn(this.loaded, this.loaded + this.pending);
  }

  whenIdle() {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((r) => this._idle.push(r));
  }

  gltf(url) {
    const key = `gltf:${url}`;
    if (!this.cache.has(key)) this.cache.set(key, this._track(this.gltfLoader.loadAsync(url)));
    return this.cache.get(key);
  }

  _textureKey(url, opts) {
    return `tex:${url}|${opts.srgb ? 's' : 'l'}|${opts.flipY === false ? 'n' : 'f'}|${opts.repeat ?? ''}|${opts.anisotropy ?? ''}`;
  }

  _configure(tex, opts) {
    tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (opts.flipY === false) tex.flipY = false;
    if (opts.repeat !== undefined) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      if (typeof opts.repeat === 'number') tex.repeat.set(opts.repeat, opts.repeat);
    }
    tex.anisotropy = Math.min(opts.anisotropy ?? 4, this.maxAnisotropy);
    return tex;
  }

  texture(url, opts = {}) {
    const key = this._textureKey(url, opts);
    let entry = this.cache.get(key);
    if (!entry) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const tex = this.textureLoader.load(url, (t) => resolve(t), undefined, (e) => reject(e));
      this._configure(tex, opts);
      promise.catch(() => console.warn(`[assets] texture failed: ${url}`));
      entry = { tex, promise: this._track(promise) };
      this.cache.set(key, entry);
    }
    return entry.tex;
  }

  textureAsync(url, opts = {}) {
    this.texture(url, opts);
    return this.cache.get(this._textureKey(url, opts)).promise;
  }

  hdr(url) {
    const key = `hdr:${url}`;
    if (!this.cache.has(key)) {
      const p = this.hdrLoader.loadAsync(url).then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      });
      this.cache.set(key, this._track(p));
    }
    return this.cache.get(key);
  }

  json(url) {
    const key = `json:${url}`;
    if (!this.cache.has(key)) {
      const p = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      this.cache.set(key, this._track(p));
    }
    return this.cache.get(key);
  }
}
