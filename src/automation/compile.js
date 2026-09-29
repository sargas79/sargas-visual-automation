/**
 * Recipe compiler: (Recipe, AutomationEvent) → SequenceDescriptor[].
 * Builds plain descriptors with createSequence; it never plays anything and
 * does not depend on the sequence builder.
 */
import { createSequence } from "../shared/descriptors.js";
import { EVENT_TYPES, createAutomationEvent } from "../shared/events.js";
import { getBuilder } from "./presets.js";
import { normalizeRecipe } from "./schema.js";
import { defaultGrid, defaultTokenSize } from "./steps.js";

/**
 * @param {object} recipe  Recipe (normalized or raw; it is normalized here).
 * @param {object} event   AutomationEvent (partial events are filled with defaults).
 * @param {object} [ctx]
 * @param {{size: number, distance: number}} [ctx.grid]  Defaults to the current canvas grid.
 * @param {(tokenId: string) => number} [ctx.getTokenSize] Token width in grid squares.
 * @returns {object[]} SequenceDescriptor[] - empty when there is nothing to play.
 */
export function compile(recipe, event, ctx = {}) {
  const normalized = normalizeRecipe(recipe);
  const ev = createAutomationEvent(event);
  if (ev.type === EVENT_TYPES.EFFECT_REMOVED) return [];
  const build = getBuilder(normalized.preset);
  const targets = (ev.targets ?? []).filter((t) => t?.tokenId);
  const steps = build({
    recipe: normalized,
    event: ev,
    sourceId: ev.source?.tokenId ?? null,
    targets,
    grid: ctx.grid ?? defaultGrid(),
    getTokenSize: ctx.getTokenSize ?? defaultTokenSize
  });
  if (!steps.some((s) => s.type === "effect")) return [];
  return [createSequence(steps, { sceneId: ev.sceneId, userId: ev.userId })];
}
