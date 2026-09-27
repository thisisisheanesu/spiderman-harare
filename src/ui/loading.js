// Title-card loading bar (index.html #load-bar, #load-text), driven by src/main.js.
//
// Boot runs in stages: the map download, then one init() per system. Most of the waiting is now on the
// files the systems ask game.assets for while they initialise (humans and their animations, vehicles,
// props, PBR textures, the shop signs: ~20 MB on a first visit), so within a stage the bar also moves
// with the share of those files that has arrived, and the text says how many files / megabytes have
// come in. The bar never moves backwards (a stage that asks for more files lowers the share done).
//
//   const load = new LoadingProgress();
//   load.stage(frac0, frac1, label)   the next stage starts at frac0 of the bar and ends at frac1
//   load.assets(done, total)          from game.assets.onProgress
//   load.set(frac, label)             jump straight to a point (map download, warm-up, ready)

const ASSET_RE = /\/(models|textures|data|audio)\//;

export class LoadingProgress {
  constructor() {
    this.bar = document.getElementById('load-bar');
    this.text = document.getElementById('load-text');
    this.frac = 0;
    this.shown = -1;
    this.label = '';
    this.from = 0;
    this.to = 0;
    this.done = 0;
    this.total = 0;
    this.base = 0; // files already finished when the current stage began
    this.bytes = 0;
    this._urls = new Set();
    this._observe();
  }

  // Megabytes of game data received so far (from resource timing; cached files count their size too).
  _observe() {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this._count(e);
      });
      this.observer.observe({ type: 'resource', buffered: true });
    } catch {
      this.observer = null; // no PerformanceObserver: the text shows file counts only
    }
  }

  _count(e) {
    if (!ASSET_RE.test(e.name) || this._urls.has(e.name)) return;
    this._urls.add(e.name);
    this.bytes += e.encodedBodySize || e.transferSize || 0;
  }

  set(frac, label) {
    this.from = this.to = frac;
    if (label) this.label = label;
    this._render(frac);
  }

  stage(from, to, label) {
    this.from = from;
    this.to = to;
    this.base = this.done;
    if (label) this.label = label;
    this._render(from);
  }

  assets(done, total) {
    this.done = done;
    this.total = total;
    const open = total - this.base;
    const share = open > 0 ? Math.min(1, (done - this.base) / open) : 0;
    this._render(this.from + (this.to - this.from) * share);
  }

  _render(frac) {
    this.frac = Math.max(this.frac, Math.min(1, frac));
    if (this.bar && Math.abs(this.frac - this.shown) >= 0.004) {
      this.shown = this.frac;
      this.bar.style.width = `${(this.frac * 100).toFixed(1)}%`;
    }
    if (!this.text) return;
    // Pick up entries the observer hasn't delivered yet (it batches them).
    if (this.observer) for (const e of this.observer.takeRecords()) this._count(e);
    let detail = '';
    if (this.total) {
      const mb = this.bytes / 1048576;
      detail = ` · ${this.done}/${this.total} files${mb >= 0.1 ? ` · ${mb.toFixed(mb < 10 ? 1 : 0)} MB` : ''}`;
    }
    const text = `${this.label}${detail}`;
    if (this.text.textContent !== text) this.text.textContent = text;
  }

  // Loading is over: plain status text from here on.
  finish(label) {
    this.observer?.disconnect();
    this.observer = null;
    this.total = 0;
    this.set(1, label);
  }
}
