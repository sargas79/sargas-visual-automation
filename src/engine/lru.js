/**
 * Small least-recently-used map. Pure (no Foundry / PIXI), unit tested.
 *
 * Entries can be pinned through `isPinned(value, key)`: a pinned entry is never
 * evicted, so the cache may temporarily grow above `max` while every entry is in use.
 */
export class LruCache {
  /** @type {Map<string, any>} insertion order = recency order (oldest first) */
  #map = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.max=20]                                  Maximum number of unpinned entries kept.
   * @param {(value: any, key: string) => void} [options.onEvict]      Called when an entry leaves the cache.
   * @param {(value: any, key: string) => boolean} [options.isPinned]  Entries that must not be evicted.
   */
  constructor({ max = 20, onEvict, isPinned } = {}) {
    this.max = Math.max(0, max);
    this.onEvict = onEvict ?? (() => {});
    this.isPinned = isPinned ?? (() => false);
  }

  get size() {
    return this.#map.size;
  }

  has(key) {
    return this.#map.has(key);
  }

  /** Read without touching recency. */
  peek(key) {
    return this.#map.get(key);
  }

  /** Read and mark as most recently used. */
  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  /** Insert or replace (a replaced value is evicted), then trim. */
  set(key, value) {
    if (this.#map.has(key)) {
      const old = this.#map.get(key);
      this.#map.delete(key);
      if (old !== value) this.onEvict(old, key);
    }
    this.#map.set(key, value);
    this.trim();
    return this;
  }

  delete(key) {
    if (!this.#map.has(key)) return false;
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.onEvict(value, key);
    return true;
  }

  /** Evict least recently used, unpinned entries until the size fits `max`. */
  trim() {
    if (this.#map.size <= this.max) return;
    for (const [key, value] of this.#map) {
      if (this.#map.size <= this.max) break;
      if (this.isPinned(value, key)) continue;
      this.#map.delete(key);
      this.onEvict(value, key);
    }
  }

  resize(max) {
    this.max = Math.max(0, max);
    this.trim();
  }

  clear() {
    const entries = [...this.#map];
    this.#map.clear();
    for (const [key, value] of entries) this.onEvict(value, key);
  }

  keys() {
    return [...this.#map.keys()];
  }

  values() {
    return [...this.#map.values()];
  }
}
