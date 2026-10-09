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
import { createThumbnailService } from "./thumbnails.js";

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
 * @param {object} [options]  Passed to `loadDatabase` (tests inject modules/importer/timeout);
 *   `options.thumbnails` is passed to `createThumbnailService` (storage/picker/canBrowse).
 */
export function createDb(options = {}) {
  let catalog = null;
  let provider = null;
  let settle;
  let started = false;
  const ready = new Promise((resolve) => (settle = resolve));
  const thumbnailCache = new Map();
  const thumbnails = createThumbnailService(options.thumbnails);

  /** Loads the cached thumbnail index or starts building it (background, never throws). */
  const startThumbnails = (id) => {
    try {
      const sample = catalog.units.find((n) => n.isLeaf)?.files?.[0] ?? catalog.resolve("jb2a")?.file;
      const version = options.modules?.get?.(id)?.version ?? globalThis.game?.modules?.get?.(id)?.version;
      thumbnails.start({ provider: id, version, sampleFile: sample });
    } catch (err) {
      log.warn("Could not start the thumbnail index", err);
    }
  };

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

    resolve(path, { distance, gridDistance = sceneGridDistance(), seed } = {}) {
      return catalog?.resolve(path, { distance, gridDistance, seed }) ?? null;
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
     * Thumbnail index (#67): `status`, `ready`, `count`, `find(file)`, `build({force})`,
     * `clearCache()`. Built from the JB2A folder listing, cached per JB2A version.
     */
    thumbnails,

    /**
     * Verified thumbnail for a db path or file URL. Uses the thumbnail index when it
     * is ready; otherwise probes the candidate names with HEAD requests (cached).
     * @returns {Promise<string|null>}
     */
    async findThumbnail(pathOrFile) {
      const file = String(pathOrFile).includes("/") ? pathOrFile : db.resolve(pathOrFile)?.file;
      if (!file) return null;
      const indexed = thumbnails.find(file);
      if (indexed !== undefined) return indexed;
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
          catalog = new Catalog(result.database, { ...options, thumbnail: (file) => thumbnails.find(file) });
          log.info(`JB2A catalog loaded from ${result.provider} (${result.source}): ${catalog.units.length} entries`);
          startThumbnails(result.provider);
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
