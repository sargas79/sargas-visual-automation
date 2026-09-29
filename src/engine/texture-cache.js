import { LruCache } from "./lru.js";

/**
 * Texture cache for effect media (#13).
 *
 * Two levels:
 * - a **prototype** per file, loaded once through the backend (Foundry's texture loader) and kept in an LRU;
 * - **instances**: every playing effect gets its own independently playable clone of the prototype video
 *   (same bytes, separate `<video>` element and base texture). Released instances go back to a small pool per
 *   file and are reused; everything else is destroyed so no `<video>` element outlives its effect.
 *
 * The backend does all PIXI / DOM work (see ./video-backend.js); this class is pure bookkeeping and unit tested.
 *
 * @typedef {object} TextureBackend
 * @property {(src: string) => Promise<object>} load            Load a prototype ({texture, video, width, height, duration}).
 * @property {(proto: object) => Promise<object>} clone         New instance of a prototype ({texture, video, width, height, duration}).
 * @property {(instance: object) => boolean|void} reset         Rewind an instance for reuse; return false to refuse pooling.
 * @property {(instance: object) => void} destroyClone          Destroy an instance (pause, drop the element, free the GPU texture).
 * @property {(proto: object) => void} unload                   Release a prototype.
 *
 * @typedef {object} TextureInstance
 * @property {string} src
 * @property {any} texture       PIXI.Texture to draw.
 * @property {HTMLVideoElement|null} video  null for static images.
 * @property {number} width      Texture size in px.
 * @property {number} height
 * @property {number} duration   Video length in ms (0 for images).
 */
export class TextureCache {
  #lru;
  /** Entries whose prototype is still loading. @type {Map<string, object>} */
  #loading = new Map();

  counters = { loads: 0, hits: 0, failures: 0, clonesCreated: 0, clonesDestroyed: 0, clonesReused: 0, evictions: 0 };

  /**
   * @param {object} options
   * @param {TextureBackend} options.backend
   * @param {number} [options.max=30]       Prototypes kept in memory (LRU, in-use files are never evicted).
   * @param {number} [options.poolSize=4]   Idle instances kept per file for reuse.
   */
  constructor({ backend, max = 30, poolSize = 4 }) {
    this.backend = backend;
    this.poolSize = poolSize;
    this.#lru = new LruCache({
      max,
      isPinned: (entry) => entry.refs > 0,
      onEvict: (entry) => this.#evict(entry)
    });
  }

  /** Number of prototypes currently cached. */
  get size() {
    return this.#lru.size;
  }

  has(src) {
    return this.#lru.has(src);
  }

  resize(max) {
    this.#lru.resize(max);
  }

  /**
   * Load (once) and cache the prototype for `src`.
   * @returns {Promise<object>} the cache entry
   */
  #entry(src) {
    const cached = this.#lru.get(src);
    if (cached) {
      this.counters.hits++;
      return cached;
    }
    if (this.#loading.has(src)) return this.#loading.get(src);
    this.counters.loads++;
    const entry = { src, proto: null, refs: 0, pool: [], evicted: false, unloaded: false, ready: null };
    entry.ready = this.backend.load(src).then(
      (proto) => {
        entry.proto = proto;
        this.#loading.delete(src);
        this.#lru.set(src, entry);
        return entry;
      },
      (err) => {
        this.#loading.delete(src);
        this.counters.failures++;
        throw err;
      }
    );
    this.#loading.set(src, entry);
    return entry;
  }

  /**
   * Load files without playing them. Failures are reported per file, never thrown.
   * @param {string[]} srcs
   * @returns {Promise<{src: string, ok: boolean, error?: any}[]>}
   */
  async preload(srcs) {
    const unique = [...new Set(srcs.filter(Boolean))];
    const results = await Promise.allSettled(unique.map((src) => this.#entry(src).ready));
    return results.map((r, i) => ({ src: unique[i], ok: r.status === "fulfilled", error: r.reason }));
  }

  /**
   * Get a playable instance of `src`. Call `release(instance)` when done.
   * @param {string} src
   * @returns {Promise<TextureInstance>}
   */
  async acquire(src) {
    const entry = this.#entry(src);
    // Reserve synchronously so the entry cannot be evicted while it loads or clones.
    entry.refs++;
    try {
      await entry.ready;
    } catch (err) {
      entry.refs--;
      throw err;
    }
    let clone = entry.pool.pop();
    if (clone) this.counters.clonesReused++;
    else {
      try {
        clone = await this.backend.clone(entry.proto);
      } catch (err) {
        entry.refs--;
        this.#afterRelease(entry);
        throw err;
      }
      this.counters.clonesCreated++;
    }
    return {
      src,
      texture: clone.texture,
      video: clone.video ?? null,
      width: clone.width ?? entry.proto.width,
      height: clone.height ?? entry.proto.height,
      duration: clone.duration ?? entry.proto.duration ?? 0,
      _clone: clone,
      _entry: entry
    };
  }

  /**
   * Give an instance back. It is pooled for reuse unless `destroy` is set, the pool is full or the file was evicted.
   * @param {TextureInstance} instance
   * @param {{destroy?: boolean}} [options]
   */
  release(instance, { destroy = false } = {}) {
    const entry = instance?._entry;
    if (!entry || instance._released) return;
    instance._released = true;
    entry.refs = Math.max(0, entry.refs - 1);
    const clone = instance._clone;
    const poolable = !destroy && !entry.evicted && entry.pool.length < this.poolSize;
    if (poolable && this.backend.reset(clone) !== false) entry.pool.push(clone);
    else this.#destroyClone(clone);
    this.#afterRelease(entry);
  }

  #afterRelease(entry) {
    if (entry.evicted) {
      if (entry.refs === 0 && !entry.unloaded) {
        entry.unloaded = true;
        this.backend.unload(entry.proto);
      }
    } else this.#lru.trim();
  }

  #destroyClone(clone) {
    this.counters.clonesDestroyed++;
    try {
      this.backend.destroyClone(clone);
    } catch (err) {
      console.error(err);
    }
  }

  #evict(entry) {
    this.counters.evictions++;
    entry.evicted = true;
    for (const clone of entry.pool.splice(0)) this.#destroyClone(clone);
    if (entry.refs === 0 && !entry.unloaded) {
      entry.unloaded = true;
      this.backend.unload(entry.proto);
    }
  }

  /** Drop every idle instance (keep prototypes). */
  drainPools() {
    for (const entry of this.#lru.values()) for (const clone of entry.pool.splice(0)) this.#destroyClone(clone);
  }

  /** Drop everything. Instances still in use are destroyed when released. */
  clear() {
    this.#lru.clear();
  }

  stats() {
    let inUse = 0;
    let pooled = 0;
    for (const entry of this.#lru.values()) {
      inUse += entry.refs;
      pooled += entry.pool.length;
    }
    return {
      cached: this.#lru.size,
      inUse,
      pooled,
      liveInstances: this.counters.clonesCreated - this.counters.clonesDestroyed,
      ...this.counters
    };
  }
}
