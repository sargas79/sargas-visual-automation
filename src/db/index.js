/**
 * JB2A database layer: api.db (#8-#11) - see docs/architecture.md for the contract.
 *
 * init(api)  attaches `api.db` (queries return empty results until loaded).
 * ready(api) starts loading without blocking the other areas; `api.db.ready`
 *            resolves once the catalog is built or JB2A is known to be missing.
 */
import { log } from "../logger.js";
import { Catalog } from "./catalog.js";
import { loadDatabase } from "./loader.js";
import { thumbnailCandidates } from "./metadata.js";

function localize(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function warn(key, data) {
  const message = localize(key, data);
  log.warn(message);
  // Only GMs can fix a missing module; players just get the console message.
  if (globalThis.game?.user?.isGM) globalThis.ui?.notifications?.warn(message);
}

/** Current scene units per grid square (for distance variant selection). */
function sceneGridDistance() {
  // VERIFY(v14): canvas.grid.distance / canvas.scene.grid.distance
  return globalThis.canvas?.grid?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? undefined;
}

/**
 * Creates the `api.db` object.
 * @param {object} [options]  Passed to `loadDatabase` (tests inject modules/importer/timeout).
 */
export function createDb(options = {}) {
  let catalog = null;
  let provider = null;
  let settle;
  let started = false;
  const ready = new Promise((resolve) => (settle = resolve));
  const thumbnailCache = new Map();

  const db = {
    /** @type {Promise<void>} */
    ready,
    get available() {
      return catalog !== null;
    },
    /** @type {"jb2a_patreon"|"JB2A_DnD5e"|null} */
    get provider() {
      return provider;
    },

    resolve(path, { distance, gridDistance = sceneGridDistance() } = {}) {
      return catalog?.resolve(path, { distance, gridDistance }) ?? null;
    },
    has(path) {
      return catalog?.has(path) ?? false;
    },
    getEntry(path) {
      return catalog?.getEntry(path) ?? null;
    },
    list(prefix, { depth = 1 } = {}) {
      return catalog?.list(prefix, { depth }) ?? [];
    },
    search(query, { limit = 50 } = {}) {
      return catalog?.search(query, { limit }) ?? [];
    },

    /**
     * Not in the contract yet: verified thumbnail for a db path or file URL.
     * Probes the candidate names with HEAD requests and caches the result.
     * @returns {Promise<string|null>}
     */
    async findThumbnail(pathOrFile) {
      const file = String(pathOrFile).includes("/") ? pathOrFile : db.resolve(pathOrFile)?.file;
      if (!file) return null;
      if (thumbnailCache.has(file)) return thumbnailCache.get(file);
      let found = null;
      for (const candidate of thumbnailCandidates(file)) {
        try {
          const response = await fetch(candidate, { method: "HEAD" });
          if (response.ok) {
            found = candidate;
            break;
          }
        } catch {
          // network error: try the next candidate
        }
      }
      thumbnailCache.set(file, found);
      return found;
    },

    /** Loads the catalog once. Always resolves; never throws. */
    async load() {
      if (started) return ready;
      started = true;
      try {
        const result = await loadDatabase(options);
        provider = result.provider;
        if (!result.provider) {
          warn("SVA.Db.Missing");
        } else if (!result.database) {
          warn("SVA.Db.LoadFailed", { module: result.provider });
        } else {
          catalog = new Catalog(result.database, options);
          log.info(`JB2A catalog loaded from ${result.provider} (${result.source}): ${catalog.units.length} entries`);
        }
      } catch (err) {
        log.error("Failed to build the JB2A catalog", err);
      }
      settle();
      return ready;
    },

    /** Internal: the Catalog instance (debugging / tests). */
    get catalog() {
      return catalog;
    }
  };
  return db;
}

export function init(api) {
  api.db = createDb();
}

export function ready(api) {
  // Don't await: JB2A may publish its api a moment after our ready hook,
  // and the areas after us must not wait for it. Consumers await api.db.ready.
  api.db?.load();
}
