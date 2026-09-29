/**
 * Pure helpers that turn raw JB2A database data into rendering metadata:
 * templates, markers, native sizes, thumbnails and distance variants.
 * No Foundry access here, so everything is unit-testable.
 */

/** Distance variant keys used by JB2A: "05ft", "15ft", "30ft", "60ft", "90ft" (also "10ft", "20ft"). */
export const DISTANCE_KEY = /^(\d+)ft$/;

/** JB2A authors distance variants for 5 ft squares. */
export const JB2A_FEET_PER_SQUARE = 5;

/** Distance (in JB2A feet) used when a distance variant has to be picked without a requested distance. */
export const DEFAULT_VARIANT_FEET = 30;

/** @returns {boolean} true for a key that holds metadata (`_template`, `_markers`, `_metadata`...) rather than a node. */
export function isMetaKey(key) {
  return typeof key === "string" && key.startsWith("_");
}

/** @returns {number|null} feet encoded in a distance key ("30ft" → 30). */
export function distanceKeyFeet(key) {
  const m = DISTANCE_KEY.exec(key);
  return m ? Number(m[1]) : null;
}

/** A node whose child keys are all distance variants. */
export function isDistanceGroup(childKeys) {
  return childKeys.length > 0 && childKeys.every((k) => DISTANCE_KEY.test(k));
}

/**
 * Pick the distance variant closest to the requested distance. Comparison is in grid
 * squares so scenes that don't use 5 ft squares still get a sensible variant.
 * Ties go to the longer variant (less stretching of the tail).
 * @param {string[]} keys          Variant keys ("05ft", "30ft"...).
 * @param {number|null|undefined} distance  Requested distance in scene units.
 * @param {number} [gridDistance]  Scene units per grid square.
 * @returns {string|null}
 */
export function pickDistanceKey(keys, distance, gridDistance = JB2A_FEET_PER_SQUARE) {
  const variants = keys.map((key) => ({ key, feet: distanceKeyFeet(key) })).filter((v) => v.feet !== null);
  if (!variants.length) return null;
  const perSquare = gridDistance > 0 ? gridDistance : JB2A_FEET_PER_SQUARE;
  const squares =
    typeof distance === "number" && Number.isFinite(distance)
      ? distance / perSquare
      : DEFAULT_VARIANT_FEET / JB2A_FEET_PER_SQUARE;
  let best = null;
  for (const v of variants) {
    const diff = Math.abs(v.feet / JB2A_FEET_PER_SQUARE - squares);
    if (!best || diff < best.diff || (diff === best.diff && v.feet > best.feet)) best = { ...v, diff };
  }
  return best.key;
}

/**
 * `_templates` entry → `{name, gridSize, startPad, endPad}`.
 * @param {object} templates  The database `_templates` object.
 * @param {string|null} name
 */
export function parseTemplate(templates, name) {
  if (!name) return null;
  const raw = templates?.[name];
  if (!Array.isArray(raw) || raw.length < 3 || raw.some((n) => typeof n !== "number")) return null;
  const [gridSize, startPad, endPad] = raw;
  return { name, gridSize, startPad, endPad };
}

/** Deep-copies `_markers` (`{loop: {start, end}, forcedEnd?}`) so callers can't mutate the catalog. */
export function parseMarkers(raw) {
  if (!raw || typeof raw !== "object") return null;
  return JSON.parse(JSON.stringify(raw));
}

function fileName(file) {
  const clean = String(file).split(/[?#]/)[0];
  return clean.slice(clean.lastIndexOf("/") + 1);
}

/**
 * Native pixel size encoded in a JB2A file name ("..._1600x400.webm", "..._600x600_StillFrame.webp").
 * @returns {{width: number, height: number}|null}
 */
export function parseSize(file) {
  if (!file) return null;
  const matches = [...fileName(file).matchAll(/(?:^|_)(\d+)x(\d+)(?=_|\.|$)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  return { width: Number(last[1]), height: Number(last[2]) };
}

/**
 * Candidate `_Thumb.webp` URLs for a JB2A file, best guess first. JB2A does not list
 * thumbnails in its database and their names are not fully regular, so only the
 * first candidate is used synchronously; `findThumbnail` probes the others.
 * Still images (`.webp`, `.png`...) are their own thumbnail.
 * @returns {string[]}
 */
export function thumbnailCandidates(file) {
  if (!file) return [];
  const str = String(file);
  const name = fileName(str);
  const dir = str.slice(0, str.length - name.length);
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (["webp", "png", "jpg", "jpeg", "gif", "svg"].includes(ext) && !/_Thumb\.webp$/i.test(name)) {
    // A still frame: the image itself is the best preview.
    return [str];
  }
  const tokens = (dot >= 0 ? name.slice(0, dot) : name).split("_");
  const noSize = tokens.filter((t) => !/^\d+x\d+$/.test(t));
  const base = noSize.filter((t) => !DISTANCE_KEY.test(t));
  const out = [];
  const add = (parts) => {
    const candidate = `${dir}${parts.join("_")}_Thumb.webp`;
    if (parts.length && !out.includes(candidate)) out.push(candidate);
  };
  add(base);
  add(noSize);
  // Variants often share the thumbnail of their first sibling ("..._02_Regular" → "..._01_Regular").
  const variantIndex = base.findLastIndex((t, i) => i > 0 && /^\d{2,3}$/.test(t));
  if (variantIndex > 0) {
    const first = base[variantIndex].length === 2 ? "01" : "001";
    add(base.with(variantIndex, first));
    add(base.filter((_, i) => i !== variantIndex));
  }
  for (const phase of ["Loop", "Intro", "Outro"]) {
    const i = base.indexOf(phase);
    if (i >= 0) add(base.with(i, "Complete"));
  }
  return out;
}

/** Best-guess thumbnail (first candidate) or null. */
export function guessThumbnail(file) {
  return thumbnailCandidates(file)[0] ?? null;
}

/** Normalizes a leaf value (string or array of strings) to a list of files. */
export function leafFiles(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((f) => typeof f === "string" && f.length > 0);
  return [];
}

/** A leaf is a file path string or an array of file paths. */
export function isLeafValue(value) {
  return typeof value === "string" || Array.isArray(value);
}
