/**
 * Finds the installed JB2A module and reads its animation database.
 *
 * JB2A builds `patreonDatabase` in its `init` hook (paths already carry the
 * `jb2aLocation` prefix, e.g. an S3 bucket) and publishes it as
 * `game.modules.get(id).api` in its own async `ready` hook, so the api may
 * appear a little after our `ready` runs. We poll for it, then fall back to
 * importing JB2A's database script directly.
 */

/** Supported JB2A modules, preferred first. */
export const PROVIDERS = Object.freeze(["jb2a_patreon", "JB2A_DnD5e"]);

/** Script that exports the database object (Patreon 0.9.3 layout). */
const DATABASE_SCRIPT = "scripts/jb2a_sequencer.js";

/** Candidate names for the database on the JB2A module api / script exports. */
// VERIFY: the free module (JB2A_DnD5e) is expected to mirror the Patreon api
// (`api.patreonDatabase`); the other names are defensive guesses.
const DATABASE_KEYS = ["patreonDatabase", "freeDatabase", "database", "db"];

/** @returns {string|null} id of the first active JB2A module. */
export function detectProvider(modules = globalThis.game?.modules) {
  for (const id of PROVIDERS) {
    if (modules?.get?.(id)?.active) return id;
  }
  return null;
}

/** A usable database is an object with `_templates` or at least one category. */
export function isDatabase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => !k.startsWith("_"));
}

/** @returns {object|null} the database exposed by a JB2A module api or script namespace. */
export function pickDatabase(source) {
  if (!source || typeof source !== "object") return null;
  for (const key of DATABASE_KEYS) {
    if (isDatabase(source[key])) return source[key];
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Default importer: loads JB2A's own script (same URL, so the same, already-built module instance). */
async function importScript(providerId) {
  const relative = `modules/${providerId}/${DATABASE_SCRIPT}`;
  // VERIFY(v14): foundry.utils.getRoute adds the server route prefix.
  const url = globalThis.foundry?.utils?.getRoute?.(relative) ?? `/${relative}`;
  return import(/* @vite-ignore */ url);
}

/**
 * @param {object} [options]
 * @param {object} [options.modules]    `game.modules`-like collection.
 * @param {number} [options.timeout]    ms to wait for JB2A's `ready` hook to publish its api.
 * @param {number} [options.interval]   polling interval in ms.
 * @param {(id: string) => Promise<object>} [options.importer]  fallback script importer (tests).
 * @returns {Promise<{provider: string|null, database: object|null, source: "api"|"script"|null}>}
 */
export async function loadDatabase({
  modules = globalThis.game?.modules,
  timeout = 5000,
  interval = 100,
  importer = importScript
} = {}) {
  const provider = detectProvider(modules);
  if (!provider) return { provider: null, database: null, source: null };

  const deadline = Date.now() + timeout;
  for (;;) {
    const database = pickDatabase(modules.get(provider)?.api);
    if (database) return { provider, database, source: "api" };
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }

  try {
    const database = pickDatabase(await importer(provider));
    if (database) return { provider, database, source: "script" };
  } catch {
    // Unknown layout (e.g. hosted elsewhere) - reported as a load failure by the caller.
  }
  return { provider, database: null, source: null };
}
