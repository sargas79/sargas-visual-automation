/**
 * PF2e ChatMessage → normalized AutomationEvent(s).
 *
 * Sources (foundryvtt/pf2e, tag pf2e-8.5.1, Foundry v14):
 *  - src/module/chat-message/data.ts       flags.pf2e.{context, origin, casting, appliedDamage} shapes
 *  - src/module/chat-message/document.ts   `message.item` (strike weapon / thrown alt usage / heightened spell), `target`
 *  - src/module/system/check/check.ts      check context flag: type, outcome, origin/target {actor, token} uuids, isReroll
 *  - src/module/system/check/types.ts      CheckType: attack-roll, saving-throw, skill-check, ...
 *  - src/module/item/spellcasting-entry/document.ts  spell attacks are type "attack-roll" with domain "spell-attack-roll"
 *  - src/module/system/damage/damage.ts    damage-roll context flag: outcome, target, sourceType
 *  - src/module/system/damage/roll.ts      DamageRoll#kinds ("damage" | "healing")
 *  - src/module/item/spell/document.ts     spell cast message: origin.rollOptions has "origin:action:slug:cast-a-spell";
 *                                          context {type:"spell-cast"} only when the spell has a defense
 *  - src/module/item/consumable/document.ts  consume(): origin {uuid,type:"consumable"}, DamageRoll for potions
 *  - src/module/system/degree-of-success.ts  "criticalFailure" | "failure" | "success" | "criticalSuccess"
 *
 * Which event fires for which message (one message → at most one event):
 *   attack-roll (strike or spell attack)       → ATTACK  (per-target outcome; PF2e rolls one message per target)
 *   saving-throw with an origin item           → SAVE    (target = the saving token, source = the origin actor)
 *   damage-roll                                → DAMAGE, or HEALING when the roll only heals / the item is healing
 *   spell card from Cast a Spell (spell-cast)  → CAST    (targets = the caster's current user targets)
 *   self-effect (action with a self effect)    → CAST
 *   consumable use                             → HEALING for healing potions/elixirs, CAST otherwise
 *   skill-check for Battle Medicine            → HEALING (outcome from the check)
 * So a Strike fires ATTACK then DAMAGE, an attack spell fires CAST then ATTACK (then DAMAGE), a save spell fires CAST,
 * one SAVE per target, then DAMAGE. Recipes pick the ones they react to via `triggers`.
 * Ignored: rerolls (context.isReroll), applied-damage cards (damage-taken / appliedDamage), spell cards posted to chat
 * without casting, checks without an item (plain saves, skills, initiative, flat checks).
 */
import { EVENT_TYPES, OUTCOMES } from "../../shared/events.js";
import { describeItem } from "./descriptors.js";

/** PF2e item roll option added only when a spell is actually cast (src/module/item/spell/values.ts). */
export const CAST_A_SPELL_OPTION = "origin:action:slug:cast-a-spell";

const DEGREE_STRINGS = [OUTCOMES.CRITICAL_FAILURE, OUTCOMES.FAILURE, OUTCOMES.SUCCESS, OUTCOMES.CRITICAL_SUCCESS];

/** PF2e degree of success (string or 0-3) → OUTCOMES. */
export function mapOutcome(outcome) {
  if (typeof outcome === "number") return DEGREE_STRINGS[outcome] ?? OUTCOMES.NONE;
  if (typeof outcome === "string" && DEGREE_STRINGS.includes(outcome)) return outcome;
  return OUTCOMES.NONE;
}

/** "Scene.abc.Token.xyz" → "xyz" */
export function tokenIdFromUuid(uuid) {
  if (typeof uuid !== "string") return null;
  return /(?:^|\.)Token\.([^.]+)/.exec(uuid)?.[1] ?? null;
}

/** "Actor.abc" | "Scene.s.Token.t.Actor.abc" → "abc" */
export function actorIdFromUuid(uuid) {
  if (typeof uuid !== "string") return null;
  return /(?:^|\.)Actor\.([^.]+)/.exec(uuid)?.[1] ?? null;
}

/** First token on the viewed canvas for an actor id. */
function tokenIdForActor(actorId) {
  if (!actorId) return null;
  const token = globalThis.canvas?.tokens?.placeables?.find((t) => (t.actor?.id ?? t.document?.actorId) === actorId);
  return token?.id ?? token?.document?.id ?? null;
}

/** Token ids the local user is targeting (only meaningful on the originating client). */
export function userTargetIds() {
  const targets = globalThis.game?.user?.targets;
  if (!targets) return [];
  return [...targets].map((t) => t?.id ?? t?.document?.id).filter(Boolean);
}

function speakerSource(message) {
  const ctx = message.flags?.pf2e?.context;
  const actor = message.actor ?? message.speakerActor ?? null;
  const actorId = message.speaker?.actor ?? actor?.id ?? null;
  const tokenId =
    message.speaker?.token ??
    message.token?.id ??
    (typeof ctx?.token === "string" ? ctx.token : null) ??
    actor?.getActiveTokens?.(true, true)?.[0]?.id ??
    tokenIdForActor(actorId);
  return { tokenId: tokenId ?? null, actorId };
}

function rollKinds(message) {
  const kinds = new Set();
  for (const roll of message.rolls ?? []) {
    if (roll?.kinds) for (const k of roll.kinds) kinds.add(k);
    else if (typeof roll?.formula === "string" && /\bhealing\b/.test(roll.formula)) kinds.add("healing");
  }
  return kinds;
}

/** Resolve the item a message came from. */
export function resolveItem(message) {
  let item;
  try {
    item = message.item ?? null; // PF2e getter: strike item (incl. thrown alt usage) or heightened spell
  } catch {
    item = null;
  }
  if (item) return item;
  const flags = message.flags?.pf2e ?? {};
  if (flags.context?.type === "self-effect") {
    const actor = message.actor ?? message.speakerActor;
    const found = actor?.items?.get?.(flags.context.item);
    if (found) return found;
  }
  const uuid = flags.origin?.uuid;
  if (uuid && globalThis.fromUuidSync) {
    try {
      return globalThis.fromUuidSync(uuid) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function isBattleMedicine(ctx) {
  // VERIFY(pf2e): the "Treat Wounds and Battle Medicine" compendium macro rolls a Medicine skill-check whose roll
  // options contain "action:battle-medicine" (Statistic#roll adds `self:action:slug:<action>` when `action` is passed).
  const values = [
    ctx.action,
    ctx.identifier,
    ...(ctx.options ?? []),
    ...(ctx.domains ?? []),
    ...(ctx.contextualOptions?.postRoll ?? [])
  ];
  return values.some((v) => typeof v === "string" && /(^|:)battle-medicine$/.test(v));
}

function findActorItem(message, slug) {
  const items = (message.actor ?? message.speakerActor)?.items;
  if (!items) return null;
  const list = typeof items.values === "function" ? [...items.values()] : Array.from(items);
  return list.find((i) => (i.slug ?? i.system?.slug) === slug) ?? null;
}

/** Decide the event type for a message, or null to ignore it. */
export function classify(message, item) {
  const flags = message.flags?.pf2e ?? {};
  const ctx = flags.context ?? null;
  const origin = flags.origin ?? null;
  const type = ctx?.type ?? null;

  if (flags.appliedDamage || type === "damage-taken") return null;
  if (ctx?.isReroll) return null;

  switch (type) {
    case "attack-roll":
    case "spell-attack-roll":
      return EVENT_TYPES.ATTACK;
    case "saving-throw":
      return origin || item ? EVENT_TYPES.SAVE : null;
    case "damage-roll": {
      const kinds = rollKinds(message);
      const healing = kinds.has("healing") && (!kinds.has("damage") || describeItem(item).isHealing);
      return healing ? EVENT_TYPES.HEALING : EVENT_TYPES.DAMAGE;
    }
    case "skill-check":
      return isBattleMedicine(ctx) ? EVENT_TYPES.HEALING : null;
    case "self-effect":
      return EVENT_TYPES.CAST;
    case "spell-cast":
      return isActualCast(origin) ? EVENT_TYPES.CAST : null;
    case null:
      break;
    default:
      return null;
  }

  // No context: spell cards and consumable use
  if (origin?.type === "spell") return isActualCast(origin) ? EVENT_TYPES.CAST : null;
  if (origin?.type === "consumable") {
    const kinds = rollKinds(message);
    if (kinds.has("healing") && !kinds.has("damage")) return EVENT_TYPES.HEALING;
    if (item && describeItem(item).isHealing) return EVENT_TYPES.HEALING;
    return EVENT_TYPES.CAST;
  }
  return null;
}

function isActualCast(origin) {
  // Posting a spell to chat from the sheet (not casting) omits the option; older data may lack rollOptions entirely.
  const opts = origin?.rollOptions;
  return !Array.isArray(opts) || opts.includes(CAST_A_SPELL_OPTION);
}

/**
 * Build the (partial) AutomationEvent for a PF2e chat message, or null.
 * @param {object} message ChatMessagePF2e
 * @param {{userId?: string}} [opts] userId: id of the user who created the message.
 */
export function eventFromMessage(message, { userId } = {}) {
  const flags = message?.flags?.pf2e;
  if (!flags) return null;
  let item = resolveItem(message);
  const type = classify(message, item);
  if (!type) return null;

  const ctx = flags.context ?? {};
  // Battle Medicine is a skill check without an origin item: use the actor's feat so item recipes apply.
  if (!item && type === EVENT_TYPES.HEALING && isBattleMedicine(ctx)) item = findActorItem(message, "battle-medicine");
  const altUsage = ctx.altUsage ?? item?.altUsageType ?? null;
  const descriptors = item
    ? describeItem(item, { altUsage })
    : type === EVENT_TYPES.HEALING && isBattleMedicine(ctx)
      ? { ...describeItem({ name: "Battle Medicine", slug: "battle-medicine", type: "action" }), isHealing: true }
      : null;
  if (type === EVENT_TYPES.HEALING && descriptors) descriptors.isHealing = true;

  // Blind rolls: don't leak the degree of success through the animation.
  const outcome = message.blind ? OUTCOMES.NONE : mapOutcome(ctx.outcome);
  let source = speakerSource(message);
  let targets = [];

  const contextTarget = tokenIdFromUuid(ctx.target?.token) ?? tokenIdFromUuid(flags.target?.token);
  switch (type) {
    case EVENT_TYPES.SAVE: {
      // The saving creature is the speaker; the source is whoever forced the save.
      targets = source.tokenId ? [{ tokenId: source.tokenId, outcome }] : [];
      const originActorUuid = ctx.origin?.actor ?? flags.origin?.actor ?? null;
      const originActorId = actorIdFromUuid(originActorUuid);
      const originTokenId = tokenIdFromUuid(ctx.origin?.token) ?? tokenIdFromUuid(originActorUuid);
      if (originActorId && originActorId !== source.actorId) {
        source = { tokenId: originTokenId ?? tokenIdForActor(originActorId), actorId: originActorId };
      } else if (originTokenId && originTokenId !== source.tokenId) {
        source = { tokenId: originTokenId, actorId: originActorId };
      }
      break;
    }
    case EVENT_TYPES.ATTACK:
    case EVENT_TYPES.DAMAGE:
    case EVENT_TYPES.HEALING: {
      if (contextTarget) {
        targets = [{ tokenId: contextTarget, outcome }];
      } else {
        const ids = userTargetIds();
        // Only attach the outcome when it can only belong to one target.
        targets = ids.map((tokenId) => (ids.length === 1 ? { tokenId, outcome } : { tokenId }));
        // Self-healing (potions) with no target: heal the speaker.
        if (!targets.length && type === EVENT_TYPES.HEALING && source.tokenId) targets = [{ tokenId: source.tokenId }];
      }
      break;
    }
    case EVENT_TYPES.CAST: {
      targets = userTargetIds().map((tokenId) => ({ tokenId }));
      if (!targets.length && item?.type === "consumable" && source.tokenId) targets = [{ tokenId: source.tokenId }];
      break;
    }
  }

  return {
    // One message → at most one event, so message id + type identifies it (a reroll is a new message).
    id: message.id ? `${message.id}:${type}` : null,
    type,
    source,
    targets,
    outcome,
    itemUuid: item?.uuid ?? flags.origin?.uuid ?? null,
    descriptors,
    sceneId: message.speaker?.scene ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? message.author?.id ?? globalThis.game?.user?.id ?? null
  };
}
