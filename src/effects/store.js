/**
 * Pure helpers over the persistent-effects scene flag:
 * `scene.flags["sargas-visual-automation"].effects[id] = EffectDescriptor`.
 */
import { MODULE_ID } from "../constants.js";

export const FLAG_KEY = "effects";

/** @returns {Record<string, object>} stored descriptors keyed by id (never null). */
export function getStored(scene) {
  const stored = scene?.flags?.[MODULE_ID]?.[FLAG_KEY];
  return stored && typeof stored === "object" ? stored : {};
}

/** Does an effect match `{ id, name }`? With neither, everything matches. */
export function matches(effect, { id, name } = {}) {
  if (id !== undefined && id !== null && effect?.id !== id) return false;
  if (name !== undefined && name !== null && effect?.name !== name) return false;
  return true;
}

const TOKEN_KEYS = ["atLocation", "stretchTo", "rotateTowards", "attachTo"];

/** Is the effect anchored to, pointed at or attached to this token? */
export function referencesToken(effect, tokenId) {
  return TOKEN_KEYS.some((key) => effect?.[key]?.tokenId === tokenId);
}

/** Effect descriptors that should be stored for a sequence, grouped by scene id. */
export function collectPersistent(sequence, resolveEffect) {
  /** @type {Map<string, object[]>} */
  const byScene = new Map();
  for (const step of sequence?.steps ?? []) {
    if (step.type !== "effect" || !step.effect?.persist) continue;
    const effect = resolveEffect(step.effect, sequence);
    const sceneId = effect.sceneId ?? globalThis.canvas?.scene?.id ?? null;
    if (!sceneId) continue;
    effect.sceneId = sceneId;
    if (!byScene.has(sceneId)) byScene.set(sceneId, []);
    byScene.get(sceneId).push(effect);
  }
  return byScene;
}
