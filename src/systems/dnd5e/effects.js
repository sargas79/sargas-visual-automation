/**
 * D&D 5e ActiveEffects on actors → EFFECT_APPLIED / EFFECT_REMOVED.
 *
 * Sources (foundryvtt/dnd5e, tag release-6.0.5):
 *  - module/documents/active-effect.mjs  ActiveEffect types: "condition" (status effects, `system.type` = status id,
 *    set by _fromStatusEffect), "enchantment" (on items), base effects (spell / feature effects applied from usage cards,
 *    `origin` = the item uuid). createConcentrationEffectData: statuses ["concentrating"], system.type "concentrating",
 *    flags.dnd5e.item {id, uuid, type, data}, flags.dnd5e.activity {id, uuid, type}, origin = item uuid.
 *  - module/documents/actor/actor.mjs    beginConcentrating / endConcentration (create / delete that effect)
 *
 * Descriptors:
 *  - concentration → the concentrated item (e.g. the "spirit-guardians" spell, type "spell"), so an `aura` rule on the
 *    spell starts when concentration begins and ends when it ends. Unresolvable item → condition "concentrating".
 *  - condition     → type "condition", key = status id ("prone", "stunned"...).
 *  - other effects → type "effect", key = slug of the effect name ("bless", "shield-of-faith"...).
 * The source is the creature carrying the effect, so `aura` recipes attach to it (and end on it).
 */
import { EVENT_TYPES } from "../../shared/events.js";
import { describeItem, sluggify, toArray } from "./descriptors.js";

export const CONCENTRATING = "concentrating";

function actorTokenIds(actor) {
  const tokens = actor?.getActiveTokens?.(true, true) ?? [];
  return tokens.map((t) => t?.id ?? t?.document?.id).filter(Boolean);
}

function statusesOf(effect) {
  return toArray(effect?.statuses).map((s) => String(s));
}

export function isConcentration(effect) {
  return effect?.system?.type === CONCENTRATING || statusesOf(effect).includes(CONCENTRATING);
}

export function isCondition(effect) {
  if (!effect || isConcentration(effect)) return false;
  return effect.type === "condition" || (!effect.origin && statusesOf(effect).length > 0);
}

function resolveItem(effect, actor) {
  const ref = effect.flags?.dnd5e?.item ?? {};
  const uuid = ref.uuid ?? effect.origin ?? null;
  if (uuid && globalThis.fromUuidSync && !String(uuid).startsWith("Compendium.")) {
    try {
      const found = globalThis.fromUuidSync(uuid, { strict: false });
      if (found?.documentName === "Item" || found?.system) return found;
    } catch {
      // fall through
    }
  }
  if (ref.id) {
    const found = actor?.items?.get?.(ref.id);
    if (found) return found;
  }
  return null;
}

/** Descriptors for an effect (see the module comment). */
export function describeEffect(effect, actor) {
  if (isConcentration(effect)) {
    const item = resolveItem(effect, actor);
    if (item) {
      const d = describeItem(item);
      if (!d.traits.includes("concentration")) d.traits.push("concentration");
      return { item, descriptors: d };
    }
    return {
      item: null,
      descriptors: { ...describeItem({ name: effect.name ?? "Concentrating" }), key: CONCENTRATING, type: "condition" }
    };
  }
  const base = describeItem({ name: effect.name ?? "" });
  if (isCondition(effect)) {
    const key = effect.system?.type || statusesOf(effect)[0] || base.key;
    return { item: null, descriptors: { ...base, key, type: "condition", traits: statusesOf(effect) } };
  }
  return { item: null, descriptors: { ...base, key: sluggify(effect.name) || base.key, type: "effect" } };
}

/**
 * @param {object} effect ActiveEffect5e embedded on an actor.
 * @param {"effectApplied"|"effectRemoved"} type
 * @param {{userId?: string, conditions?: boolean}} [opts] conditions: false ignores status conditions.
 */
export function eventFromEffect(effect, type, { userId, conditions = true } = {}) {
  if (!effect) return null;
  const actor = effect.parent ?? null;
  // Only effects on actors: item effects are templates / transfers, enchantments live on items.
  if (!actor || actor.documentName !== "Actor") return null;
  if (effect.type === "enchantment") return null;
  if (type === EVENT_TYPES.EFFECT_APPLIED && (effect.disabled || effect.isSuppressed)) return null;
  if (!conditions && isCondition(effect)) return null;

  const tokenIds = actorTokenIds(actor);
  // Nothing to show for actors without a token on the canvas; removals are still sent so persistent auras end.
  if (!tokenIds.length && type === EVENT_TYPES.EFFECT_APPLIED) return null;
  const { item, descriptors } = describeEffect(effect, actor);
  return {
    id: effect.uuid || effect.id ? `${effect.uuid ?? effect.id}:${type}` : null,
    type,
    source: { tokenId: tokenIds[0] ?? null, actorId: actor.id ?? null },
    targets: tokenIds.map((tokenId) => ({ tokenId })),
    itemUuid: item?.uuid ?? effect.origin ?? null,
    effectUuid: effect.uuid ?? null,
    descriptors,
    sceneId: globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}
