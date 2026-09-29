/**
 * Foundry glue for the thumbnail index (#67): walks the JB2A `Library` folder with
 * the FilePicker once per JB2A version, keeps the result in the browser's
 * localStorage, and answers `find(file)` from memory afterwards.
 *
 * States: "idle" (nothing loaded yet), "building", "ready", "unavailable" (can't list
 * the folder: no permission, unknown host, error). When unavailable the catalog keeps
 * its name guess and the animation browser captures video frames instead.
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import {
  browseLocation,
  collectThumbnails,
  libraryRoot,
  readCachedIndex,
  ThumbnailIndex,
  writeCachedIndex
} from "./thumbnail-index.js";

export const CACHE_KEY = `${MODULE_ID}.thumbnailIndex`;

/** @returns {Storage|null} */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @returns {object|null} the FilePicker class to browse with. */
function defaultPicker() {
  // VERIFY(v14): FilePicker lives at foundry.applications.apps.FilePicker; `.implementation`
  // is the configured subclass (The Forge and other hosts replace it).
  const FP = globalThis.foundry?.applications?.apps?.FilePicker;
  return FP?.implementation ?? FP ?? null;
}

/** Whether the current user may list server folders. */
function defaultCanBrowse() {
  const user = globalThis.game?.user;
  if (!user) return false;
  // VERIFY(v14): "FILES_BROWSE" is the core permission for the file browser.
  return user.isGM || user.can?.("FILES_BROWSE") === true;
}

/**
 * @param {object} [options]  All injectable for tests.
 * @param {() => Storage|null} [options.storage]
 * @param {() => object|null} [options.picker]      FilePicker class (`browse`, `matchS3URL`).
 * @param {() => boolean} [options.canBrowse]
 */
export function createThumbnailService({
  storage = defaultStorage,
  picker = defaultPicker,
  canBrowse = defaultCanBrowse
} = {}) {
  let index = null;
  let status = "idle";
  let context = null;
  let building = null;
  let settle;
  let ready = new Promise((resolve) => (settle = resolve));

  const finish = (next) => {
    status = next;
    settle(status === "ready");
  };

  const readCache = () => {
    try {
      const raw = storage()?.getItem(CACHE_KEY);
      return raw ? readCachedIndex(raw, context) : null;
    } catch {
      return null;
    }
  };

  const writeCache = () => {
    try {
      storage()?.setItem(CACHE_KEY, writeCachedIndex(index, context));
    } catch (err) {
      // Quota or privacy mode: the index still works for this session.
      log.debug("Could not cache the thumbnail index", err);
    }
  };

  const service = {
    /** @type {"idle"|"building"|"ready"|"unavailable"} */
    get status() {
      return status;
    },
    /** Resolves `true` once the index is usable, `false` when it can't be built. */
    get ready() {
      return ready;
    },
    /** Number of thumbnails indexed. */
    get count() {
      return index?.count ?? 0;
    },
    /** @returns {ThumbnailIndex|null} */
    get index() {
      return index;
    },

    /**
     * Thumbnail for a file: a URL, `null` when the index knows there is none, or
     * `undefined` when the index isn't available (callers fall back to guessing).
     */
    find(file) {
      return index ? index.find(file) : undefined;
    },

    /**
     * Loads the cached index for this JB2A install, or starts building it in the
     * background. Never throws, never blocks on the folder walk.
     * @param {{provider: string, version: string, sampleFile: string}} info
     * @returns {boolean} true when the index came from the cache.
     */
    start({ provider, version, sampleFile }) {
      const root = libraryRoot(sampleFile, provider);
      if (!provider || !root) {
        finish("unavailable");
        return false;
      }
      context = { provider, version: String(version ?? ""), root };
      const cached = readCache();
      if (cached) {
        index = new ThumbnailIndex(cached);
        finish("ready");
        return true;
      }
      service.build();
      return false;
    },

    /**
     * Walks the JB2A folder and replaces the index.
     * @param {{force?: boolean}} [options]  force: rebuild even when ready.
     * @returns {Promise<boolean>}
     */
    build({ force = false } = {}) {
      if (!context) return Promise.resolve(false);
      if (building) return building;
      if (status === "ready" && !force) return Promise.resolve(true);
      const FP = picker();
      const location = browseLocation(context.root, FP ?? {});
      if (!FP?.browse || !location || !canBrowse()) {
        if (status !== "ready") finish("unavailable");
        return Promise.resolve(status === "ready");
      }
      if (status !== "idle") ready = new Promise((resolve) => (settle = resolve));
      status = "building";
      const started = Date.now();
      building = (async () => {
        try {
          const result = await collectThumbnails({
            browse: (target) => FP.browse(location.source, target, { ...location.options, extensions: [".webp"] }),
            root: location.target,
            provider: context.provider
          });
          const next = new ThumbnailIndex(result);
          if (!next.count) {
            log.warn("No JB2A thumbnails found; the browser will capture video frames instead");
            finish(index ? "ready" : "unavailable");
            return status === "ready";
          }
          index = next;
          // A partial walk is used but not cached, so the next session tries again.
          if (!result.failed) writeCache();
          log.info(`Indexed ${next.count} JB2A thumbnails in ${Date.now() - started} ms`);
          finish("ready");
          return true;
        } catch (err) {
          log.warn("Could not index the JB2A thumbnails", err);
          finish(index ? "ready" : "unavailable");
          return status === "ready";
        } finally {
          building = null;
        }
      })();
      return building;
    },

    /** Forgets the cached index (next `build` walks the folder again). */
    clearCache() {
      try {
        storage()?.removeItem(CACHE_KEY);
      } catch {
        // ignore
      }
    }
  };
  return service;
}
