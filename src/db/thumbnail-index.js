/**
 * Thumbnail index (#67): JB2A ships `_Thumb.webp` previews next to its videos but
 * doesn't list them in its database, and their names don't follow the video
 * names exactly. This module matches videos to the thumbnails found in the real
 * folder listing. Everything here is pure (the folder walk takes an injected
 * `browse` function) so it is unit-testable; Foundry glue lives in `index.js`.
 */
import { DISTANCE_KEY } from "./metadata.js";

/** Bump when the cached shape or the matching rules change. */
export const INDEX_FORMAT = 1;

const STILL_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "gif", "svg"]);
const THUMB_NAME = /[_-]thumb\.[a-z0-9]+$/i;
const SIZE_TOKEN = /^(\d+)x(\d+)$/;
const GRID_TOKEN = /^(\d+)x(\d+)(?:ft)?$/;
/** Pixel sizes ("1600x400") are dropped; small ones ("2x2", "8x8") are grid sizes and kept. */
const MIN_PIXEL_SIZE = 100;

function isPixelSize(token) {
  const m = SIZE_TOKEN.exec(token);
  return !!m && Number(m[1]) >= MIN_PIXEL_SIZE && Number(m[2]) >= MIN_PIXEL_SIZE;
}
const PHASES = new Set(["loop", "intro", "outro", "complete"]);
const PHASE_WORD = /complete|loop|intro|outro/;
const PHASE_WORDS = /complete|loop|intro|outro/g;

function splitUrl(file) {
  const clean = String(file ?? "").split(/[?#]/)[0];
  const cut = clean.lastIndexOf("/");
  return { dir: clean.slice(0, cut + 1), name: clean.slice(cut + 1) };
}

/** @returns {boolean} true for a JB2A thumbnail file name ("..._Thumb.webp", "...-thumb.webp"). */
export function isThumbnailName(name) {
  return THUMB_NAME.test(String(name ?? ""));
}

/** @returns {boolean} true when the file is a still image, i.e. its own preview. */
export function isStillImage(file) {
  const { name } = splitUrl(file);
  const dot = name.lastIndexOf(".");
  return dot >= 0 && STILL_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) && !isThumbnailName(name);
}

/**
 * Lower-case name tokens without extension, `thumb` suffix, pixel size and distance
 * ("FireBolt_01_Regular_Orange_30ft_1600x400.webm" → ["firebolt","01","regular","orange"]).
 * Numbers lose their leading zeros so "01" and "001" compare equal.
 * @returns {string[]}
 */
export function nameTokens(name) {
  let base = String(name ?? "");
  base = base.replace(THUMB_NAME, "");
  const dot = base.lastIndexOf(".");
  if (dot > 0 && /^[a-z0-9]{2,4}$/i.test(base.slice(dot + 1))) base = base.slice(0, dot);
  return base
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter((t) => t && !isPixelSize(t) && !DISTANCE_KEY.test(t))
    .map((t) => {
      if (/^\d+$/.test(t)) return String(Number(t));
      // Grid sizes: "10x10ft", "10x10" and "05x05ft" all become "10x10" / "5x5".
      const grid = GRID_TOKEN.exec(t);
      return grid ? `${Number(grid[1])}x${Number(grid[2])}` : t;
    });
}

/**
 * Tokens with the animation phase removed, also inside words
 * ("BubbleLoop001" → "bubble001", a standalone "Loop" disappears), so a Loop or Outro
 * video can use the Intro/Complete thumbnail of the same animation.
 * @param {string[]} tokens  from `nameTokens`
 */
export function looseTokens(tokens) {
  return tokens.map((t) => t.replace(PHASE_WORDS, "")).filter(Boolean);
}

/** Phase word of a token list ("loop", "intro", "outro", "complete") or null. */
function phaseOf(tokens) {
  for (const t of tokens) {
    const m = PHASE_WORD.exec(t);
    if (m) return m[0];
  }
  return null;
}

/**
 * Candidate lookups for a video, most specific first. Strict keys come from the exact
 * tokens, the first variant ("_02_" → "_01_"), the variant number dropped and
 * Loop/Intro/Outro → Complete; loose keys are the same lists without the phase.
 * @returns {{strict: string[], loose: string[]}}
 */
export function candidateKeys(name) {
  const tokens = nameTokens(name);
  const strict = [];
  const loose = [];
  if (!tokens.length) return { strict, loose };
  const add = (out, list) => {
    const key = list.join("_");
    if (list.length && !out.includes(key)) out.push(key);
  };
  const numeric = tokens.findLastIndex((t, i) => i > 0 && /^\d+$/.test(t));
  const lists = [tokens];
  if (numeric > 0)
    lists.push(
      tokens.with(numeric, "1"),
      tokens.filter((_, i) => i !== numeric)
    );
  const phase = tokens.findIndex((t) => PHASES.has(t) && t !== "complete");
  for (const list of lists) add(strict, list);
  if (phase >= 0) for (const list of lists.slice(0, 2)) add(strict, list.with(phase, "complete"));
  for (const list of lists) add(loose, looseTokens(list));
  return { strict, loose };
}

/** Strict key of a thumbnail name (same normalization as `candidateKeys`). */
export function thumbnailKey(name) {
  return nameTokens(name).join("_");
}

/**
 * Directory of a file relative to the JB2A module folder, lower-cased, or null when
 * the URL isn't inside it. Works for `modules/jb2a_patreon/...`, S3 and CDN URLs.
 * ("https://b.s3.x/jb2a_patreon/Library/Cantrip/X.webm" → "library/cantrip")
 */
export function relativeDir(file, provider) {
  if (!provider) return null;
  const { dir } = splitUrl(file);
  const lower = decodeURIComponentSafe(dir).toLowerCase();
  const marker = `/${String(provider).toLowerCase()}/`;
  const at = lower.lastIndexOf(marker);
  const start = at >= 0 ? at + marker.length : lower.startsWith(marker.slice(1)) ? marker.length - 1 : -1;
  if (start < 0) return null;
  return lower.slice(start).replace(/\/+$/, "");
}

function decodeURIComponentSafe(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function parentDir(dir) {
  const cut = dir.lastIndexOf("/");
  return cut > 0 ? dir.slice(0, cut) : null;
}

/**
 * In-memory index: relative dir → thumbnail file names. `find(file)` returns the
 * thumbnail URL built from the video's own directory, so it works whatever the
 * JB2A location prefix (local, S3, CDN) is.
 */
export class ThumbnailIndex {
  /**
   * @param {{provider: string, dirs: Record<string, string[]>}} data
   */
  constructor({ provider, dirs = {} } = {}) {
    this.provider = provider;
    this.dirs = new Map();
    let count = 0;
    for (const [dir, names] of Object.entries(dirs ?? {})) {
      const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && isThumbnailName(n));
      if (!list.length) continue;
      const byKey = new Map();
      const byLoose = new Map();
      const thumbs = [];
      for (const name of [...list].sort()) {
        const tokens = nameTokens(name);
        const key = tokens.join("_");
        if (!byKey.has(key)) byKey.set(key, name);
        const loose = looseTokens(tokens);
        const looseKey = loose.join("_");
        const thumb = { name, phase: phaseOf(tokens), set: new Set(loose), size: loose.length };
        if (!byLoose.has(looseKey)) byLoose.set(looseKey, []);
        byLoose.get(looseKey).push(thumb);
        thumbs.push(thumb);
      }
      this.dirs.set(dir.toLowerCase(), { names: list, byKey, byLoose, thumbs });
      count += list.length;
    }
    /** Number of thumbnails in the index. */
    this.count = count;
    this.cache = new Map();
  }

  /** Plain data for caching (`new ThumbnailIndex(index.toJSON())` round-trips). */
  toJSON() {
    const dirs = {};
    for (const [dir, { names }] of this.dirs) dirs[dir] = [...names];
    return { provider: this.provider, dirs };
  }

  /**
   * Thumbnail URL for a video (or the image itself for a still), null when none matches.
   * @param {string} file
   * @returns {string|null}
   */
  find(file) {
    if (!file) return null;
    if (this.cache.has(file)) return this.cache.get(file);
    const found = this.#find(String(file));
    this.cache.set(file, found);
    return found;
  }

  #find(file) {
    if (isStillImage(file)) return file;
    const rel = relativeDir(file, this.provider);
    if (rel === null) return null;
    const { dir: urlDir, name } = splitUrl(file);
    const { strict, loose } = candidateKeys(name);
    const tokens = nameTokens(name);
    const phase = phaseOf(tokens);
    // Same folder first, then the parent (e.g. ".../Call_Lightning/High_Res/").
    const places = [
      { dir: rel, url: urlDir },
      { dir: parentDir(rel), url: parentDir(urlDir.replace(/\/$/, "")) }
    ];
    for (const place of places) {
      const entry = place.dir !== null ? this.dirs.get(place.dir) : null;
      if (!entry || !place.url) continue;
      const prefix = place.url.endsWith("/") ? place.url : `${place.url}/`;
      const hit =
        strict.map((key) => entry.byKey.get(key)).find(Boolean) ??
        loose.map((key) => pickPhase(entry.byLoose.get(key), phase)).find(Boolean) ??
        bestSubset(entry.thumbs, looseTokens(tokens), phase);
      if (hit) return prefix + hit;
    }
    return null;
  }
}

/** Among thumbnails of the same animation, prefer the video's phase, then "complete". */
function pickPhase(thumbs, phase) {
  if (!thumbs?.length) return null;
  return (
    thumbs.find((t) => t.phase === phase) ??
    thumbs.find((t) => t.phase === "complete") ??
    thumbs.find((t) => t.phase === "intro") ??
    thumbs[0]
  ).name;
}

/**
 * Fuzzy fallback: a thumbnail whose (phase-free) tokens are all in the video name,
 * preferring the most specific one. It must share the first token (the animation
 * name) and at least two tokens, so an unrelated animation in the folder never wins.
 */
function bestSubset(thumbs, fileTokens, phase) {
  if (!fileTokens.length) return null;
  const set = new Set(fileTokens);
  let best = [];
  for (const thumb of thumbs) {
    if (thumb.size < 2 || !thumb.set.has(fileTokens[0])) continue;
    if (![...thumb.set].every((t) => set.has(t))) continue;
    if (!best.length || thumb.size > best[0].size) best = [thumb];
    else if (thumb.size === best[0].size) best.push(thumb);
  }
  return pickPhase(best, phase);
}

/**
 * Walks the JB2A folder with an injected browser and collects thumbnail names.
 * @param {object} options
 * @param {(target: string) => Promise<{dirs?: string[], files?: string[]}>} options.browse
 * @param {string} options.root       Folder to start from (as `browse` understands it).
 * @param {string} options.provider   JB2A module id, used to compute relative dirs.
 * @param {number} [options.concurrency]
 * @param {number} [options.maxDirs]  Safety cap on the number of folders visited.
 * @returns {Promise<{provider: string, dirs: Record<string, string[]>, visited: number, failed: number}>}
 *   `failed` counts folders whose listing threw (they are skipped).
 */
export async function collectThumbnails({ browse, root, provider, concurrency = 6, maxDirs = 5000 }) {
  const dirs = {};
  const seen = new Set([root]);
  const queue = [root];
  let visited = 0;
  let failed = 0;
  const visit = async (target) => {
    let result;
    try {
      result = await browse(target);
    } catch {
      failed++;
      return;
    }
    for (const sub of result?.dirs ?? []) {
      if (seen.has(sub)) continue;
      seen.add(sub);
      queue.push(sub);
    }
    for (const file of result?.files ?? []) {
      const { name } = splitUrl(file);
      if (!isThumbnailName(name)) continue;
      const rel = relativeDir(file, provider);
      if (rel !== null) (dirs[rel] ??= []).push(decodeURIComponentSafe(name));
    }
  };
  while (queue.length && visited < maxDirs) {
    const batch = queue.splice(0, Math.min(concurrency, maxDirs - visited));
    visited += batch.length;
    await Promise.all(batch.map(visit));
  }
  return { provider, dirs, visited, failed };
}

/**
 * Where to browse for a JB2A root URL.
 * @param {string} rootUrl  e.g. "modules/jb2a_patreon/Library" or an S3 URL.
 * @param {{matchS3URL?: (url: string) => RegExpMatchArray|null}} [picker]
 * @returns {{source: string, target: string, options: object}|null}
 */
export function browseLocation(rootUrl, picker = {}) {
  if (!rootUrl) return null;
  const url = String(rootUrl);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return { source: "data", target: url.replace(/^\/+/, ""), options: {} };
  }
  let match;
  try {
    // VERIFY(v14): FilePicker.matchS3URL(url) → match with `groups.bucket` / `groups.key`.
    match = picker.matchS3URL?.(url) ?? null;
  } catch {
    match = null;
  }
  const bucket = match?.groups?.bucket;
  if (bucket) {
    return { source: "s3", target: decodeURIComponentSafe(match.groups.key ?? ""), options: { bucket } };
  }
  // CDNs and other hosts: no generic way to list them; the browser captures frames instead.
  // VERIFY(v14): The Forge serves modules from relative paths (handled as "data" above)
  // through its own FilePicker override; absolute assets.forge-vtt.com URLs land here.
  return null;
}

/**
 * Folder holding the JB2A `Library` for a catalog file URL
 * ("modules/jb2a_patreon/Library/Cantrip/X.webm" → "modules/jb2a_patreon/Library").
 */
export function libraryRoot(file, provider) {
  if (!file || !provider) return null;
  const str = String(file).split(/[?#]/)[0];
  const lower = str.toLowerCase();
  const marker = `${String(provider).toLowerCase()}/library/`;
  const at = lower.indexOf(marker);
  if (at < 0) return null;
  return str.slice(0, at + marker.length - 1);
}

/**
 * Validates cached index data against the installed JB2A.
 * @returns {{provider: string, dirs: object}|null}
 */
export function readCachedIndex(raw, { provider, version, root }) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  if (data.format !== INDEX_FORMAT || data.provider !== provider || data.version !== version || data.root !== root) {
    return null;
  }
  if (!data.dirs || typeof data.dirs !== "object") return null;
  return { provider: data.provider, dirs: data.dirs };
}

/** Serializes an index for the client cache. */
export function writeCachedIndex(index, { version, root }) {
  return JSON.stringify({ format: INDEX_FORMAT, version, root, ...index.toJSON() });
}
