/**
 * Turns an EffectDescriptor `file` into a ResolvedFile (see docs/architecture.md, api.db). Pure; api.db is injected.
 */

/** A value containing "/" is a direct URL, anything else a JB2A database path. */
export function isDirectFile(file) {
  return typeof file === "string" && file.includes("/");
}

/** ResolvedFile for a direct URL: no template, markers or distance information. */
export function directFile(file) {
  return { path: null, file, thumbnail: null, size: null, template: null, markers: null, distance: null };
}

/**
 * @param {object} api            Module api (only `api.db` is used).
 * @param {string} file           Database path or URL.
 * @param {{distance?: number}} [options]  Distance in scene units, for stretched effects.
 * @returns {Promise<object|null>} ResolvedFile or null when it cannot be resolved.
 */
export async function resolveFile(api, file, { distance } = {}) {
  if (!file || typeof file !== "string") return null;
  if (isDirectFile(file)) return directFile(file);
  const db = api?.db;
  if (!db?.resolve) return null;
  if (db.ready && typeof db.ready.then === "function") await db.ready;
  return db.resolve(file, distance === undefined ? {} : { distance }) ?? null;
}

/** Most files a single branch path expands to when preloading (e.g. every distance variant of a projectile). */
export const MAX_PRELOAD_PER_PATH = 32;

/** Leaf paths under a database branch (depth first, capped). */
function leafPaths(db, path, limit) {
  const out = [];
  const visit = (p) => {
    if (out.length >= limit) return;
    const entry = db.getEntry?.(p);
    if (!entry) return;
    if (entry.isLeaf) {
      out.push(entry.path ?? p);
      return;
    }
    for (const child of db.list?.(p, { depth: 1 }) ?? []) visit(child.path);
  };
  visit(path);
  return out;
}

/**
 * Normalize a preload request (db paths and/or URLs) into URLs. A branch path expands to its leaves (all color /
 * distance variants, capped at MAX_PRELOAD_PER_PATH). Unknown paths are dropped.
 * @param {object} api
 * @param {string|string[]} pathsOrFiles
 * @returns {Promise<string[]>}
 */
export async function resolvePreloadList(api, pathsOrFiles) {
  const list = (Array.isArray(pathsOrFiles) ? pathsOrFiles : [pathsOrFiles]).filter(Boolean);
  const db = api?.db;
  if (db?.ready && typeof db.ready.then === "function" && list.some((f) => !isDirectFile(f))) await db.ready;
  const urls = [];
  for (const item of list) {
    if (isDirectFile(item)) {
      urls.push(item);
      continue;
    }
    const leaves = db?.getEntry ? leafPaths(db, item, MAX_PRELOAD_PER_PATH) : [];
    for (const path of leaves.length ? leaves : [item]) {
      const resolved = await resolveFile(api, path);
      if (resolved?.file) urls.push(resolved.file);
    }
  }
  return [...new Set(urls)];
}
