import { log } from "../logger.js";
import { resolvePreloadList } from "./files.js";

/**
 * The local rendering engine behind `api.engine` (see docs/architecture.md).
 * Renders only on this client: no sockets, no document writes.
 */
export class EffectEngine {
  /**
   * @param {object} options
   * @param {object} options.api                                        Module api (for api.db).
   * @param {import("./texture-cache.js").TextureCache} options.textures
   */
  constructor({ api, textures }) {
    this.api = api;
    this.textures = textures;
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
