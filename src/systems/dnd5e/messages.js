/**
 * D&D 5e ChatMessage → normalized AutomationEvent.
 *
 * dnd5e 6.x (Foundry v14) posts one typed ChatMessage per step of an activity, with a data model in `message.system`.
 * Sources (foundryvtt/dnd5e, tag release-6.0.5):
 *  - module/documents/activity/mixin.mjs      use(): usage card (type "usage", system.activity/item/targets), then
 *                                             `_triggerSubsequentActions` rolls the attack / damage / healing
 *  - module/documents/activity/attack.mjs     rollAttack(): message type "attack", system {activity, item, targets, mode},
 *                                             `dnd5e.rollAttack(V2)` hooks fire afterwards (local only, no message id)
 *  - module/documents/activity/heal.mjs       rollDamage() with message type "healing"
 *  - module/documents/activity/save.mjs       #rollSave → actor.rollSavingThrow with system {activity, item, origin}
 *  - module/data/chat-message/*.mjs           roll-message-data (activity, item, origin, targets), attack-message-data
 *                                             (evaluatedTargets: miss when ac is null, or !crit && (total < ac || fumble)),
 *                                             save-message-data (type ability | concentration | death)
 *  - module/data/chat-message/fields/targets-field.mjs  descriptors {actor, token (uuid), ac, name, img}
 *  - module/documents/chat-message.mjs        getAssociatedItem / getAssociatedActivity / getAssociatedToken
 *  - module/dice/d20-roll.mjs, basic-roll.mjs isCritical / isFumble / isSuccess / isFailure (vs options.target)
 *
 * Which event fires for which message (one message → at most one event, id "<messageId>:<type>"):
 *   usage (any activity used)             → CAST    (targets = the card's targets)
 *   attack                                → ATTACK  (per-target hit/miss vs AC, natural 20 / 1 → critical)
 *   damage                                → DAMAGE, or HEALING when every rolled type is a healing type
 *   healing (heal activity)               → HEALING (targets, else the speaker: potions)
 *   save (ability save from an activity)  → SAVE    (target = the saving token, source = the activity's actor)
 * So a weapon attack fires CAST then ATTACK (then DAMAGE), Fireball CAST, AREA_PLACED, one SAVE per target, DAMAGE,
 * Cure Wounds CAST then HEALING. Recipes pick the ones they react to via `triggers`.
 * Ignored: concentration and death saves, checks, rolls without an item (enrichers, falling damage), other types.
 */
import { EVENT_TYPES, OUTCOMES } from "../../shared/events.js";
import { HEALING_TYPES, describeItem } from "./descriptors.js";

/** dnd5e 6 ChatMessage subtypes handled here. */
export const MESSAGE_TYPES = ["usage", "attack", "damage", "healing", "save"];

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

/** Token ids the local user is targeting (only meaningful on the originating client). */
export function userTargetIds() {
  const targets = globalThis.game?.user?.targets;
  if (!targets) return [];
  return [...targets].map((t) => t?.id ?? t?.document?.id).filter(Boolean);
}

/** First token of an actor on the viewed scene. */
export function tokenIdForActor(actor) {
  if (!actor) return null;
  const token = actor.getActiveTokens?.(true, true)?.[0] ?? actor.getActiveTokens?.()?.[0];
  if (token) return token.id ?? token.document?.id ?? null;
  const placeable = globalThis.canvas?.tokens?.placeables?.find(
    (t) => (t.actor?.id ?? t.document?.actorId) === actor.id
  );
  return placeable?.id ?? null;
}

function safeUuid(uuid) {
  if (!uuid || typeof uuid !== "string" || !globalThis.fromUuidSync) return null;
  try {
    return globalThis.fromUuidSync(uuid, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Message kind: the dnd5e 6 ChatMessage subtype; dnd5e 4.x/5.x stored roll types in `flags.dnd5e.roll.type`.
 * VERIFY(dnd5e 5.x): the legacy flag layout; dnd5e 6.x on Foundry v14 is the supported target.
 */
export function messageKind(message) {
  if (MESSAGE_TYPES.includes(message?.type)) return message.type;
  const legacy = message?.flags?.dnd5e?.roll?.type ?? message?.flags?.dnd5e?.messageType;
  return MESSAGE_TYPES.includes(legacy) ? legacy : null;
}

/** The item a message came from. */
export function resolveItem(message) {
  try {
    const item = message.getAssociatedItem?.();
    if (item) return item;
  } catch {
    // fall through
  }
  const sys = message.system ?? {};
  return safeUuid(sys.item?.uuid) ?? safeUuid(message.flags?.dnd5e?.item?.uuid);
}

/** The activity a message came from (or null). */
export function resolveActivity(message, item) {
  try {
    const activity = message.getAssociatedActivity?.();
    if (activity) return activity;
  } catch {
    // fall through
  }
  const ref = message.system?.activity ?? message.flags?.dnd5e?.activity ?? null;
  if (!ref) return null;
  const acts = item?.system?.activities;
  if (ref.id && typeof acts?.get === "function") {
    const found = acts.get(ref.id);
    if (found) return found;
  }
  const byUuid = safeUuid(ref.uuid);
  if (byUuid) return byUuid;
  // The reference itself carries the activity type, which is all the descriptors need.
  return ref.type ? { id: ref.id ?? null, type: ref.type } : null;
}

/** Stored target descriptors (TargetsField) → [{tokenId, ac}] */
export function messageTargets(message) {
  const list = message.system?.targets ?? message.flags?.dnd5e?.targets ?? [];
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const tokenId = tokenIdFromUuid(t?.token) ?? tokenIdFromUuid(t?.uuid);
    if (!tokenId || out.some((o) => o.tokenId === tokenId)) continue;
    out.push({ tokenId, ac: typeof t.ac === "number" ? t.ac : null });
  }
  return out;
}

function speakerSource(message, item) {
  const actor = item?.actor ?? item?.parent ?? null;
  const actorId = message.speaker?.actor ?? actor?.id ?? null;
  const tokenId = message.speaker?.token ?? tokenIdForActor(actor);
  return { tokenId: tokenId ?? null, actorId };
}

/**
 * Attack outcome against one target, following AttackMessageData#evaluatedTargets:
 * natural 20 (roll.isCritical, honours the activity's critical threshold) → criticalSuccess,
 * natural 1 → criticalFailure, else total >= AC → success. A target without AC (total cover) is a miss.
 */
export function attackOutcome(roll, ac) {
  if (!roll) return OUTCOMES.NONE;
  if (roll.isCritical) return OUTCOMES.CRITICAL_SUCCESS;
  if (roll.isFumble) return OUTCOMES.CRITICAL_FAILURE;
  if (ac === undefined) return OUTCOMES.SUCCESS; // unknown target: assume a hit
  if (ac === null) return OUTCOMES.FAILURE;
  return Number(roll.total) >= ac ? OUTCOMES.SUCCESS : OUTCOMES.FAILURE;
}

/** Saving throw outcome from the saver's point of view (vs the DC stored as roll.options.target). */
export function saveOutcome(roll) {
  if (!roll) return OUTCOMES.NONE;
  if (roll.isSuccess === true) return OUTCOMES.SUCCESS;
  if (roll.isFailure === true) return OUTCOMES.FAILURE;
  return OUTCOMES.NONE;
}

/** True when every roll of a damage message is a healing type (Revivify, a damage activity healing HP...). */
function onlyHealing(message) {
  const rolls = message.rolls ?? [];
  if (!rolls.length) return false;
  return rolls.every((r) => HEALING_TYPES.includes(String(r?.options?.type ?? "").toLowerCase()));
}

/** Decide the event type for a message, or null to ignore it. */
export function classify(message) {
  switch (messageKind(message)) {
    case "usage":
      return EVENT_TYPES.CAST;
    case "attack":
      return EVENT_TYPES.ATTACK;
    case "healing":
      return EVENT_TYPES.HEALING;
    case "damage":
      return onlyHealing(message) ? EVENT_TYPES.HEALING : EVENT_TYPES.DAMAGE;
    case "save": {
      const sys = message.system ?? {};
      // Only activity saves (a spell or feature forced it); concentration / death saves have their own types.
      if (sys.type && sys.type !== "ability") return null;
      return sys.activity?.uuid || sys.item?.uuid || sys.origin || message.flags?.dnd5e?.item?.uuid
        ? EVENT_TYPES.SAVE
        : null;
    }
    default:
      return null;
  }
}

/**
 * Build the (partial) AutomationEvent for a dnd5e chat message, or null.
 * @param {object} message ChatMessage5e
 * @param {{userId?: string}} [opts] userId: id of the user who created the message.
 */
export function eventFromMessage(message, { userId } = {}) {
  if (!message) return null;
  const type = classify(message);
  if (!type) return null;
  const item = resolveItem(message);
  if (!item) return null; // enricher rolls, falling damage, plain checks: nothing to animate from
  const activity = resolveActivity(message, item);
  const descriptors = describeItem(item, { activity, attackMode: message.system?.mode ?? null });
  if (type === EVENT_TYPES.HEALING) descriptors.isHealing = true;

  // VERIFY(v14): `blind` is still set on blind-mode messages; don't leak a hidden result through the animation.
  const blind = message.blind === true;
  const roll = message.rolls?.[0] ?? null;
  let source = speakerSource(message, item);
  let targets = [];
  let outcome = OUTCOMES.NONE;
  const stored = messageTargets(message);
  const fallbackTargets = () => (stored.length ? stored.map((t) => t.tokenId) : userTargetIds());

  switch (type) {
    case EVENT_TYPES.ATTACK: {
      if (stored.length) {
        targets = stored.map((t) => ({
          tokenId: t.tokenId,
          outcome: blind ? OUTCOMES.NONE : attackOutcome(roll, t.ac)
        }));
      } else {
        const o = blind ? OUTCOMES.NONE : attackOutcome(roll, undefined);
        targets = userTargetIds().map((tokenId) => ({ tokenId, outcome: o }));
      }
      outcome = blind
        ? OUTCOMES.NONE
        : targets.length === 1
          ? targets[0].outcome
          : roll?.isCritical
            ? OUTCOMES.CRITICAL_SUCCESS
            : roll?.isFumble
              ? OUTCOMES.CRITICAL_FAILURE
              : targets.some((t) => t.outcome === OUTCOMES.SUCCESS) || !targets.length
                ? OUTCOMES.SUCCESS
                : OUTCOMES.FAILURE;
      break;
    }
    case EVENT_TYPES.SAVE: {
      // The saving creature is the speaker; the source is whoever owns the activity that forced the save.
      outcome = blind ? OUTCOMES.NONE : saveOutcome(roll);
      const saver = message.speaker?.token ?? null;
      targets = saver ? [{ tokenId: saver, outcome }] : [];
      const actor = item.actor ?? item.parent ?? null;
      source = { tokenId: tokenIdForActor(actor), actorId: actor?.id ?? null };
      break;
    }
    case EVENT_TYPES.DAMAGE:
      if (!blind && roll?.isCritical) outcome = OUTCOMES.CRITICAL_SUCCESS;
      targets = fallbackTargets().map((tokenId) => ({ tokenId }));
      break;
    case EVENT_TYPES.HEALING:
      targets = fallbackTargets().map((tokenId) => ({ tokenId }));
      // Self-healing (potions, Second Wind) with no target: heal the speaker.
      if (!targets.length && source.tokenId) targets = [{ tokenId: source.tokenId }];
      break;
    case EVENT_TYPES.CAST:
      targets = fallbackTargets().map((tokenId) => ({ tokenId }));
      break;
  }

  return {
    // One message → at most one event, so message id + type identifies it (a reroll is a new message).
    id: message.id ? `${message.id}:${type}` : null,
    type,
    source,
    targets,
    outcome,
    itemUuid: item.uuid ?? message.system?.item?.uuid ?? null,
    descriptors,
    sceneId: message.speaker?.scene ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? message.author?.id ?? globalThis.game?.user?.id ?? null
  };
}

/**
 * CAST for an activity used without a usage card (`message.create === false`, e.g. by automation modules), from
 * `dnd5e.postUseActivity(activity, usageConfig, results)`. When the card was created, createChatMessage handles it.
 */
export function eventFromActivityUse(activity, results, { userId, seq = 0 } = {}) {
  const item = activity?.item ?? activity?.parent?.parent ?? null;
  if (!item) return null;
  const msg = results?.message;
  if (msg && typeof msg === "object" && msg.id && msg.documentName === "ChatMessage") return null;
  const actor = item.actor ?? item.parent ?? null;
  return {
    id: `${activity.uuid ?? `${item.uuid}.Activity.${activity.id}`}:${EVENT_TYPES.CAST}:${seq}`,
    type: EVENT_TYPES.CAST,
    source: { tokenId: tokenIdForActor(actor), actorId: actor?.id ?? null },
    targets: userTargetIds().map((tokenId) => ({ tokenId })),
    outcome: OUTCOMES.NONE,
    itemUuid: item.uuid ?? null,
    descriptors: describeItem(item, { activity }),
    sceneId: globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}
