/**
 * PF2e effect / condition items on actors → EFFECT_APPLIED / EFFECT_REMOVED.
 *
 * Sources (foundryvtt/pf2e, tag pf2e-8.5.1):
 *  - src/module/item/abstract-effect/data.ts  system.context.origin {actor, token, item} / target {actor, token}
 *  - src/module/item/effect/, src/module/item/condition/  item types "effect" and "condition" (slug e.g. "frightened")
 *  - src/module/rules/rule-element/aura.ts     Aura rule element (radius in feet) → descriptors.area (emanation)
 */
import { actorIdFromUuid, tokenIdFromUuid } from "./messages.js";
import { describeItem } from "./descriptors.js";

export const EFFECT_ITEM_TYPES = ["effect", "condition"];

function actorTokens(actor) {
  const tokens = actor?.getActiveTokens?.(true, true) ?? [];
  return tokens.map((t) => t?.id).filter(Boolean);
}

/**
 * @param {object} item  Effect/condition item embedded on an actor.
 * @param {"effectApplied"|"effectRemoved"} type
 * @param {{userId?: string, conditions?: boolean}} [opts] conditions: false ignores condition items.
 */
export function eventFromEffectItem(item, type, { userId, conditions = true } = {}) {
  if (!item || !EFFECT_ITEM_TYPES.includes(item.type)) return null;
  if (item.type === "condition" && !conditions) return null;
  const actor = item.parent ?? item.actor ?? null;
  if (!actor || actor.documentName === "Item") return null;

  const tokenIds = actorTokens(actor);
  // Nothing to show for actors without a token on the canvas; removals are still sent so persistent auras end.
  if (!tokenIds.length && type === "effectApplied") return null;
  // The affected creature is always the actor carrying the effect.
  const targets = tokenIds.map((tokenId) => ({ tokenId }));
  // Source: who applied it (system.context.origin), falling back to the affected actor.
  const origin = item.system?.context?.origin ?? null;
  const originActorId = actorIdFromUuid(origin?.actor);
  const originTokenId = tokenIdFromUuid(origin?.token);
  const source =
    originActorId && originActorId !== actor.id
      ? { tokenId: originTokenId, actorId: originActorId }
      : { tokenId: tokenIds[0] ?? null, actorId: actor.id ?? null };

  return {
    type,
    source,
    targets,
    itemUuid: item.uuid ?? null,
    effectUuid: item.uuid ?? null,
    descriptors: describeItem(item),
    sceneId: globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}
