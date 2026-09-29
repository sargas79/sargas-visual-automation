/**
 * Object pooling and effect budget (#19). Pure, unit tested in tests/engine/pool.test.js.
 */

/** Generic object pool: reuse released objects instead of allocating new ones. */
export class ObjectPool {
  #free = [];
  counters = { created: 0, reused: 0, destroyed: 0 };

  /**
   * @param {object} options
   * @param {(...args: any[]) => any} options.create      New object.
   * @param {(obj: any, ...args: any[]) => void} [options.prepare]  Configure an object on acquire (new or reused).
   * @param {(obj: any) => boolean|void} [options.reset]  Clean up on release; return false to destroy instead.
   * @param {(obj: any) => void} [options.destroy]
   * @param {(obj: any) => boolean} [options.isAlive]     Pooled objects failing this are discarded on acquire.
   * @param {number} [options.max=32]                     Free objects kept.
   */
  constructor({ create, prepare, reset, destroy, isAlive, max = 32 }) {
    this.create = create;
    this.prepare = prepare ?? (() => {});
    this.reset = reset ?? (() => true);
    this.destroyFn = destroy ?? (() => {});
    this.isAlive = isAlive ?? (() => true);
    this.max = max;
  }

  get size() {
    return this.#free.length;
  }

  acquire(...args) {
    let obj;
    while (this.#free.length) {
      const candidate = this.#free.pop();
      if (this.isAlive(candidate)) {
        obj = candidate;
        this.counters.reused++;
        break;
      }
    }
    if (!obj) {
      obj = this.create(...args);
      this.counters.created++;
    }
    this.prepare(obj, ...args);
    return obj;
  }

  release(obj) {
    if (!obj) return;
    if (this.#free.includes(obj)) return;
    let keep;
    try {
      keep = this.#free.length < this.max && this.reset(obj) !== false;
    } catch {
      keep = false;
    }
    if (keep) this.#free.push(obj);
    else this.#destroy(obj);
  }

  #destroy(obj) {
    this.counters.destroyed++;
    try {
      this.destroyFn(obj);
    } catch (err) {
      console.error(err);
    }
  }

  clear() {
    for (const obj of this.#free.splice(0)) this.#destroy(obj);
  }
}

/**
 * Decide what to do when a new effect arrives and the budget (`engineMaxEffects`) may be exceeded.
 * Oldest non-persistent effects make room first; persistent effects (auras...) are never dropped, and a new
 * persistent effect always plays; a new short effect is skipped when everything playing is persistent.
 * @param {object} params
 * @param {{id: string, persist?: boolean}[]} params.active  Effects playing or loading, oldest first.
 * @param {number} params.max
 * @param {boolean} [params.incomingPersist]
 * @returns {{evict: string[], skip: boolean}}
 */
export function planCapacity({ active, max, incomingPersist = false }) {
  const limit = Math.max(1, max || 1);
  const overflow = active.length + 1 - limit;
  if (overflow <= 0) return { evict: [], skip: false };
  const evictable = active.filter((e) => !e.persist).map((e) => e.id);
  const evict = evictable.slice(0, overflow);
  const skip = evict.length < overflow && !incomingPersist;
  return { evict, skip };
}
