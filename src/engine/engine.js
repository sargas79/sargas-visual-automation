import { log } from "../logger.js";
import { normalizeEffect } from "../shared/descriptors.js";
import { resolveFile, resolvePreloadList } from "./files.js";
import { planCapacity } from "./pool.js";

/**
 * @typedef {object} EffectHandle
 * @property {string} id
 * @property {object} descriptor     Normalized EffectDescriptor.
 * @property {Promise<void>} finished Resolves when the effect is removed for any reason.
 * @property {number} [duration] Wall ms until the effect ends on its own (Infinity when persistent), once known.
 * @property {(opts?: {immediate?: boolean}) => Promise<void>} end
 */

/**
 * Everything the engine needs from Foundry, injected so the engine logic is unit tested without a canvas.
 * See ./environment.js for the Foundry implementation.
 * @typedef {object} EngineEnvironment
 * @property {() => boolean} isReady                 Is a scene canvas drawn?
 * @property {() => string|null} sceneId             Viewed scene id.
 * @property {() => string|null} userId
 * @property {() => object} createContext            SpriteContext for new sprites.
 * @property {(params: object) => object} createSprite  EffectSprite-like: mount(), update(dt), requestEnd(opts), destroy().
 * @property {(fn: (dtMs: number) => void) => void} addTicker
 * @property {(fn: (dtMs: number) => void) => void} removeTicker
 * @property {(ms: number) => Promise<void>} [wait]
 * @property {(a: object, b: object) => number|null} [measure]  Distance between two anchors in scene units.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A handle for an effect that is not shown on this client. */
export function finishedHandle(descriptor) {
  return {
    id: descriptor?.id ?? null,
    descriptor: descriptor ?? null,
    finished: Promise.resolve(),
    end: async () => {}
  };
}

/**
 * Should this client show the effect?
 * @returns {string|null} reason to skip, or null to play.
 */
export function skipReason(descriptor, { sceneId, userId, ready }) {
  if (!ready) return "canvas not ready";
  if (descriptor.sceneId && descriptor.sceneId !== sceneId) return "other scene";
  if (Array.isArray(descriptor.users) && descriptor.users.length && !descriptor.users.includes(userId)) {
    return "not for this user";
  }
  return null;
}

/**
 * The local rendering engine behind `api.engine` (see docs/architecture.md).
 * Renders only on this client: no sockets, no document writes.
 */
export class EffectEngine {
  /** @type {Map<string, object>} id → record */
  #records = new Map();
  #tickerFn = (dt) => this.#tick(dt);
  #tickerOn = false;

  /**
   * @param {object} options
   * @param {object} options.api                                        Module api (for api.db).
   * @param {import("./texture-cache.js").TextureCache} options.textures
   * @param {EngineEnvironment} options.env
   */
  /** Debug counters (#19). */
  counters = { played: 0, skipped: 0, evicted: 0, failed: 0, peak: 0 };

  /**
   * @param {object} options
   * @param {object} options.api                                        Module api (for api.db).
   * @param {import("./texture-cache.js").TextureCache} options.textures
   * @param {EngineEnvironment} options.env
   * @param {() => number} [options.maxEffects]                          Budget of simultaneous effects.
   */
  constructor({ api, textures, env, maxEffects = () => Infinity }) {
    this.api = api;
    this.textures = textures;
    this.env = env;
    this.maxEffects = maxEffects;
  }

  /** Make room for a new effect within the budget; false when it must be skipped. */
  #makeRoom(descriptor) {
    // Cancelled records (still loading, dropped when their load completes) no longer count against the budget.
    const active = [];
    for (const r of this.#records.values())
      if (!r.cancelled) active.push({ id: r.id, persist: !!r.descriptor.persist });
    const plan = planCapacity({ active, max: this.maxEffects(), incomingPersist: !!descriptor.persist });
    for (const id of plan.evict) {
      const record = this.#records.get(id);
      if (!record) continue;
      this.counters.evicted++;
      log.debug(`Effect budget reached, ending ${id}`);
      this.#cancel(record);
    }
    return !plan.skip;
  }

  /**
   * Play an effect locally.
   * @param {object} effect  EffectDescriptor (normalized here if needed).
   * @returns {Promise<EffectHandle>} resolves once the sprite is on the canvas (or right away when skipped).
   */
  async play(effect) {
    let descriptor;
    try {
      descriptor = normalizeEffect(effect);
    } catch (err) {
      log.warn("Invalid effect descriptor", err, effect);
      return finishedHandle(effect);
    }
    const existing = this.#records.get(descriptor.id);
    if (existing && !existing.cancelled && !existing.endRequest && !existing.sprite?.ending) return existing.handle;
    // An older copy that is ending (e.g. dropped by a scene change while loading) is replaced.
    if (existing) this.#cancel(existing);

    const reason = skipReason(descriptor, {
      ready: this.env.isReady(),
      sceneId: this.env.sceneId(),
      userId: this.env.userId()
    });
    if (reason || !this.#makeRoom(descriptor)) {
      this.counters.skipped++;
      log.debug(`Skipping effect ${descriptor.id}: ${reason ?? "effect budget reached"}`);
      return finishedHandle(descriptor);
    }

    const record = this.#createRecord(descriptor);
    this.counters.played++;
    this.counters.peak = Math.max(this.counters.peak, this.#records.size);
    try {
      const [prepared] = await Promise.all([this.#prepare(descriptor), (this.env.wait ?? wait)(descriptor.delay ?? 0)]);
      record.instance = prepared.instance;
      if (record.cancelled) {
        this.#remove(record);
        return record.handle;
      }
      const sprite = this.env.createSprite({
        descriptor,
        resolved: prepared.resolved,
        instance: prepared.instance,
        context: this.env.createContext()
      });
      record.sprite = sprite;
      // Wall-clock length (ms, Infinity when persistent) - lets the sequence runner honour negative waitUntilFinished.
      record.handle.duration = sprite.timeline?.total;
      await sprite.mount();
      if (record.cancelled) {
        this.#remove(record);
        return record.handle;
      }
      if (record.endRequest) sprite.requestEnd(record.endRequest);
      this.#ensureTicker();
    } catch (err) {
      this.counters.failed++;
      log.warn(`Effect ${descriptor.id} could not play`, err);
      this.#remove(record);
    }
    return record.handle;
  }

  /** Stop an effect right away (it is removed now if shown, or as soon as it finishes loading). */
  #cancel(record) {
    record.cancelled = true;
    if (record.sprite?.display) this.#remove(record);
  }

  /** Resolve the file (closest distance variant when stretched) and get a texture instance. */
  async #prepare(descriptor) {
    let distance;
    if (descriptor.stretchTo) {
      const from = descriptor.atLocation ?? { tokenId: descriptor.attachTo?.tokenId };
      distance = this.env.measure?.(from, descriptor.stretchTo) ?? undefined;
    }
    const resolved = await resolveFile(this.api, descriptor.file, { distance });
    if (!resolved?.file) throw new Error(`Unknown animation "${descriptor.file}"`);
    const instance = await this.textures.acquire(resolved.file);
    return { resolved, instance };
  }

  #createRecord(descriptor) {
    const record = {
      id: descriptor.id,
      descriptor,
      sprite: null,
      instance: null,
      cancelled: false,
      endRequest: null,
      removed: false,
      resolve: null
    };
    const finished = new Promise((resolve) => (record.resolve = resolve));
    record.handle = {
      id: descriptor.id,
      descriptor,
      finished,
      end: (opts) => this.end(descriptor.id, opts)
    };
    this.#records.set(descriptor.id, record);
    return record;
  }

  #remove(record) {
    if (record.removed) return;
    record.removed = true;
    if (this.#records.get(record.id) === record) this.#records.delete(record.id);
    try {
      record.sprite?.destroy();
    } catch (err) {
      log.error("Failed to destroy effect", err);
    }
    if (record.instance) this.textures.release(record.instance);
    record.resolve();
    if (!this.#records.size) this.#stopTicker();
  }

  #tick(dt) {
    // Iterating the Map directly is safe while #remove deletes entries (no per-frame array copy).
    for (const record of this.#records.values()) {
      if (!record.sprite || record.removed || !record.sprite.display) continue;
      let alive = false;
      try {
        alive = record.sprite.update(dt);
      } catch (err) {
        log.error(`Effect ${record.id} failed`, err);
      }
      if (!alive) this.#remove(record);
    }
  }

  #ensureTicker() {
    if (this.#tickerOn || !this.#records.size) return;
    this.env.addTicker(this.#tickerFn);
    this.#tickerOn = true;
  }

  #stopTicker() {
    if (!this.#tickerOn) return;
    this.env.removeTicker(this.#tickerFn);
    this.#tickerOn = false;
  }

  /** @returns {EffectHandle|undefined} */
  get(id) {
    return this.#records.get(id)?.handle;
  }

  /** @returns {EffectHandle[]} */
  active() {
    return [...this.#records.values()].map((r) => r.handle);
  }

  /**
   * End an effect: fade out unless immediate. Resolves once it is removed.
   * @param {string} id
   * @param {{immediate?: boolean}} [options]
   */
  async end(id, { immediate = false } = {}) {
    const record = this.#records.get(id);
    if (!record) return;
    if (immediate) this.#cancel(record);
    else if (record.sprite?.display) record.sprite.requestEnd({ immediate: false });
    else record.endRequest = { immediate: false };
    return record.handle.finished;
  }

  /** End every effect. */
  async endAll({ immediate = false } = {}) {
    await Promise.all([...this.#records.keys()].map((id) => this.end(id, { immediate })));
  }

  /**
   * Canvas tear down (scene change): remove every effect synchronously, before Foundry destroys the canvas groups.
   * Effects still loading are dropped when their load completes.
   */
  tearDown() {
    for (const record of [...this.#records.values()]) this.#cancel(record);
    this.#stopTicker();
  }

  /** Debug counters: effects, textures (cache / video elements). */
  stats() {
    const records = [...this.#records.values()];
    return {
      active: records.length,
      mounted: records.filter((r) => r.sprite?.display).length,
      loading: records.filter((r) => !r.sprite).length,
      persistent: records.filter((r) => r.descriptor.persist).length,
      max: this.maxEffects(),
      ...this.counters,
      textures: this.textures.stats()
    };
  }

  /**
   * Load files ahead of time so the first play has no loading delay.
   * @param {string|string[]} pathsOrFiles  Database paths (branches expand to their variants) and/or URLs.
   * @returns {Promise<void>}
   */
  async preload(pathsOrFiles) {
    const urls = await resolvePreloadList(this.api, pathsOrFiles ?? []);
    const results = await this.textures.preload(urls);
    for (const r of results) if (!r.ok) log.warn(`Preload failed for ${r.src}`, r.error);
  }
}
