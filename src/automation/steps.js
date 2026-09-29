/**
 * Helpers shared by the preset compilers: outcome resolution, option mapping,
 * anchors and grid geometry. Pure apart from reading the canvas for defaults.
 */
import { LAYERS } from "../shared/descriptors.js";
import { OUTCOMES } from "../shared/events.js";
import { isPlainObject } from "./schema.js";

/** Outcome → override keys applied in order (crit inherits the plain hit/miss override). */
const OUTCOME_CHAIN = {
  [OUTCOMES.CRITICAL_SUCCESS]: [OUTCOMES.SUCCESS, OUTCOMES.CRITICAL_SUCCESS],
  [OUTCOMES.SUCCESS]: [OUTCOMES.SUCCESS],
  [OUTCOMES.FAILURE]: [OUTCOMES.FAILURE],
  [OUTCOMES.CRITICAL_FAILURE]: [OUTCOMES.FAILURE, OUTCOMES.CRITICAL_FAILURE]
};

export const isMiss = (outcome) => outcome === OUTCOMES.FAILURE || outcome === OUTCOMES.CRITICAL_FAILURE;

/** Deep merge for plain objects; arrays and scalars replace, `null` clears. */
export function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = merge(base[k], v);
  return out;
}

/** The recipe as it applies to one outcome (overrides merged, `outcomes` dropped). */
export function recipeForOutcome(recipe, outcome) {
  const { outcomes, ...base } = recipe;
  let out = base;
  for (const key of OUTCOME_CHAIN[outcome] ?? []) {
    if (outcomes?.[key]) out = merge(out, outcomes[key]);
  }
  return out;
}

/** A stage `{ animation, options }` if present and enabled, else null. */
export function getStage(recipe, id) {
  const stage = recipe.stages?.[id];
  return stage && typeof stage.animation === "string" && stage.animation ? stage : null;
}

/** EffectDescriptor fields that options pass through unchanged. */
const PASSTHROUGH = [
  "layer",
  "tint",
  "opacity",
  "playbackRate",
  "startTime",
  "endTime",
  "zIndex",
  "mirrorX",
  "mirrorY",
  "rotation",
  "duration"
];

/**
 * Build an effect from an animation path and recipe options.
 * `extra` holds preset-computed fields (anchors, size...); `delay` adds up.
 */
export function makeEffect(file, options = {}, extra = {}) {
  const effect = {};
  for (const key of PASSTHROUGH) if (options[key] !== undefined) effect[key] = options[key];
  if (options.fadeIn) effect.fadeIn = { duration: options.fadeIn };
  if (options.fadeOut) effect.fadeOut = { duration: options.fadeOut };
  const delay = (options.delay ?? 0) + (extra.delay ?? 0);
  Object.assign(effect, extra, { file });
  if (delay > 0) effect.delay = delay;
  else delete effect.delay;
  return effect;
}

export const effectStep = (effect, waitUntilFinished) =>
  waitUntilFinished === undefined || waitUntilFinished === null
    ? { type: "effect", effect }
    : { type: "effect", effect, waitUntilFinished };

export const tokenAnchor = (tokenId) => (tokenId ? { tokenId } : null);

/** Grid info: pixels per square and scene units per square. VERIFY(v14): canvas.grid.size / .distance */
export function defaultGrid() {
  const grid = globalThis.canvas?.grid;
  return {
    size: grid?.size ?? globalThis.canvas?.scene?.grid?.size ?? 100,
    distance: grid?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? 5
  };
}

/** Token footprint in grid squares (width). VERIFY(v14): TokenDocument#width is in grid units. */
export function defaultTokenSize(tokenId) {
  return globalThis.canvas?.tokens?.get?.(tokenId)?.document?.width ?? 1;
}

/** Point `distance` scene units from `origin` towards `direction` degrees (0 = east, clockwise). */
export function project(origin, direction, distance, grid) {
  const px = (distance / grid.distance) * grid.size;
  const rad = ((direction ?? 0) * Math.PI) / 180;
  return { x: Math.round(origin.x + Math.cos(rad) * px), y: Math.round(origin.y + Math.sin(rad) * px) };
}

export { LAYERS };
