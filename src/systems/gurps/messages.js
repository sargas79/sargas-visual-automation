/**
 * GURPS Game Aid ChatMessage → normalized AutomationEvent.
 *
 * GGA fires no roll hooks (only `gurpsinit`, `gurpsready`, `updateLastActorGURPS`) and sets no flags on roll
 * messages, so the chat message itself is parsed. Sources (crnormand/gurps, tag v0.18.23, Foundry v13-v14):
 *  - module/dierolls/dieroll.js#_doRoll      every targeted roll (attack, parry, block, skill, spell, attribute) posts
 *                                            templates/die-roll-chat-message.hbs; its `chatthing` is the OtF that was
 *                                            rolled, e.g. `[@<actorId>@M:"Broadsword (Swing)"]`, and the roll formula
 *                                            is `3d6[<thing>]`. Outcome spans: `crit success`, `crit failure`,
 *                                            `failure`, `success` (success rules: 3-4 always crit, 17-18 fail...).
 *  - module/chat.js (preCreateChatMessage)   GGA rewrites the content with gurpslink(): every OtF becomes
 *                                            `<span class='gga-app gurpslink' data-action='<base64 JSON>' data-otf='...'>`
 *  - lib/otf-parser.ts#gspan / AttackDamageParser / SkillSpellParser   the data-action JSON: {type: "attack" |
 *                                            "weapon-parry" | "weapon-block" | "skill-spell" | "attribute" | ...,
 *                                            name, isMelee, isRanged, isSpellOnly, isSkillOnly, sourceId}
 *  - lib/utilities.js#utoa                   base64 of the UTF-8 JSON
 *  - module/damage/damagechat.js             damage rolls: flags.gurps.transfer = {type: "damageItem",
 *                                            payload: [{attacker, damageType, damage, ...}], userTarget}
 *  - module/drag-drop-types.ts               DragDropType.DAMAGE = "damageItem"
 *
 * Which event fires for which message (one message → at most one event):
 *   attack roll (M:/R:/A: OtF)               → ATTACK   outcome = the roll result
 *   spell roll (Sp: / S: resolving to a spell) → CAST, or HEALING for healing spells (Minor Healing...)
 *   healing skill roll (First Aid...)        → HEALING
 *   damage roll                              → DAMAGE   (descriptors of the actor's last attack, if recent)
 * Ignored: parry/block/dodge and other defenses (no defense event in the contract), attribute/skill/control rolls,
 * plain dice rolls, and messages from other users.
 */
import { EVENT_TYPES, OUTCOMES } from "../../shared/events.js";
import { damageCode, damageTypesFor, describeAttack, describeSkill, describeSpell, slugify } from "./descriptors.js";
import { findAttack, findSkill, findSpell, itemForEntry, resolveActor, tokenIdForActor } from "./actor-data.js";

/** VERIFY(gurps): module/drag-drop-types.ts DragDropType.DAMAGE */
export const DAMAGE_TRANSFER_TYPE = "damageItem";

/** Action types GGA rolls against a target number (lib/otf-parser.ts OtfActionType). */
const ROLL_ACTION_TYPES = ["attack", "weapon-parry", "weapon-block", "skill-spell", "attribute", "controlroll"];

const OUTCOME_CLASSES = {
  "crit success": OUTCOMES.CRITICAL_SUCCESS,
  "crit failure": OUTCOMES.CRITICAL_FAILURE,
  failure: OUTCOMES.FAILURE,
  success: OUTCOMES.SUCCESS
};

/** Decode GGA's utoa() (base64 of UTF-8) back to a string. */
export function atou(b64) {
  const bin = globalThis.atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3D;/g, "=")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Parse a GGA OtF string ("@abc@M:\"Broadsword (Swing)\"", "!Sp:Fireball", "S:\"First Aid\" +2") into the subset of
 * the GGA action we need. Fallback when data-action is missing or not decodable.
 */
export function parseOtf(otf) {
  let s = decodeEntities(otf).trim();
  s = s.replace(/^"[^"]*"/, "").trim(); // override text
  s = s.replace(/^!/, "").trim(); // blind roll
  let sourceId = null;
  const src = /^@([^@]+)@\s*/.exec(s);
  if (src) {
    sourceId = src[1];
    s = s.slice(src[0].length);
  }
  const m = /^(sk|sp|s|m|r|a|p|b|d)\s*:\s*("([^"]+)"|'([^']+)'|([^\s+-]+))/i.exec(s);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const name = (m[3] ?? m[4] ?? m[5] ?? "").trim();
  // Attack OtFs merge a trailing "(Mode)" into the name (AttackDamageParser).
  const rest = s.slice(m[0].length).trim();
  const modeMatch = /^\(([^)]*)\)/.exec(rest);
  const fullName = modeMatch && !/\(.*\)$/.test(name) ? `${name} (${modeMatch[1]})` : name;
  if (["S", "SK", "SP"].includes(prefix)) {
    return { type: "skill-spell", name, isSpellOnly: prefix === "SP", isSkillOnly: prefix === "SK", sourceId };
  }
  const type = { P: "weapon-parry", B: "weapon-block", D: "attackdamage" }[prefix] ?? "attack";
  return {
    type,
    name: fullName,
    isMelee: /[AMDPB]/.test(prefix),
    isRanged: /[ARD]/.test(prefix),
    sourceId
  };
}

/**
 * Every GGA action embedded in the content, in document order.
 * VERIFY(gurps|v14): the stored content keeps GGA's `data-action` / `data-otf` attributes after Foundry's HTML
 * cleaning (GGA's own click handlers depend on them); attribute quotes may be normalized, so both are accepted.
 */
export function actionsInContent(content) {
  const html = String(content ?? "");
  const actions = [];
  const spanRe = /<span\b[^>]*\bgurpslink\b[^>]*>/gi;
  for (const [tag] of html.matchAll(spanRe)) {
    const data = /data-action=(["'])([A-Za-z0-9+/=]+)\1/.exec(tag)?.[2];
    let action = null;
    if (data) {
      try {
        action = JSON.parse(atou(data));
      } catch {
        action = null;
      }
    }
    if (!action?.type) {
      const otf = /data-otf=(["'])([\s\S]*?)\1/.exec(tag)?.[2];
      action = otf ? parseOtf(otf) : null;
    }
    if (action?.type) actions.push(action);
  }
  return actions;
}

/** Outcome from the die-roll card, or null when the card has none. VERIFY(gurps): class names of die-roll-chat-message.hbs. */
export function outcomeFromContent(content) {
  const m = /class=(["'])(crit success|crit failure|failure|success)\1/i.exec(String(content ?? ""));
  return m ? OUTCOME_CLASSES[m[2].toLowerCase()] : null;
}

/** GGA chatdata (GURPS.lastTargetedRolls[actorId]) → outcome. */
export function outcomeFromChatdata(data) {
  if (!data || typeof data !== "object") return null;
  if (data.isCritSuccess) return OUTCOMES.CRITICAL_SUCCESS;
  if (data.isCritFailure) return OUTCOMES.CRITICAL_FAILURE;
  if (typeof data.failure === "boolean") return data.failure ? OUTCOMES.FAILURE : OUTCOMES.SUCCESS;
  return null;
}

/**
 * Name rolled against, from the roll formula flavor: "3d6[Broadsword]" → "Broadsword" (dieroll.js#_doRoll).
 * VERIFY(v14): Roll#formula keeps term flavors.
 */
export function thingFromRolls(message) {
  for (const roll of message?.rolls ?? []) {
    const formula = typeof roll === "string" ? roll : (roll?.formula ?? roll?._formula);
    const m = /^\s*3d6\[([^\]]+)\]/.exec(formula ?? "");
    if (m) return m[1].trim();
    const flavor = roll?.terms?.[0]?.flavor ?? roll?.terms?.[0]?.options?.flavor;
    if (flavor) return String(flavor).trim();
  }
  return null;
}

/** True for GGA die-roll cards (targeted or not). */
export function isDieRollCard(content) {
  return /\broll-message\b/.test(String(content ?? ""));
}

/** Token ids the local user is targeting (only meaningful on the originating client). */
export function userTargetIds() {
  const targets = globalThis.game?.user?.targets;
  if (!targets) return [];
  return [...targets].map((t) => t?.id ?? t?.document?.id).filter(Boolean);
}

function sourceOf(message, actor, actorId) {
  const tokenId = message.speaker?.token ?? tokenIdForActor(actor, actorId) ?? null;
  return { tokenId, actorId: actorId ?? actor?.id ?? null };
}

function attackTargets(outcome) {
  const ids = userTargetIds();
  // Only attach the outcome when it can only belong to one target.
  return ids.map((tokenId) => (ids.length === 1 ? { tokenId, outcome } : { tokenId }));
}

/**
 * Classify a die-roll card. Returns { type, descriptors, itemUuid } or null.
 * @param {object} action decoded GGA action of the roll
 * @param {object|null} actor
 */
export function classifyRoll(action, actor) {
  const type = action?.type;
  if (type === "attack") {
    const found = findAttack(actor, action.name, {
      melee: action.isMelee !== false,
      ranged: action.isRanged !== false
    });
    const list = found?.list ?? (action.isRanged && !action.isMelee ? "ranged" : "melee");
    const entry = found?.entry ?? { name: action.name };
    const isSpell = !!findSpell(actor, entry.name);
    const item = itemForEntry(actor, found?.entry);
    return {
      type: EVENT_TYPES.ATTACK,
      descriptors: describeAttack(entry, { list, isSpell }),
      itemUuid: item?.uuid ?? null
    };
  }
  if (type === "skill-spell") {
    const spell = action.isSkillOnly ? null : findSpell(actor, action.name);
    const skill = spell || action.isSpellOnly ? null : findSkill(actor, action.name);
    if (spell || action.isSpellOnly) {
      const descriptors = describeSpell(spell ?? { name: action.name });
      const item = itemForEntry(actor, spell);
      return {
        type: descriptors.isHealing ? EVENT_TYPES.HEALING : EVENT_TYPES.CAST,
        descriptors,
        itemUuid: item?.uuid ?? null
      };
    }
    const descriptors = describeSkill(skill ?? { name: action.name });
    if (!descriptors.isHealing) return null;
    return { type: EVENT_TYPES.HEALING, descriptors, itemUuid: itemForEntry(actor, skill)?.uuid ?? null };
  }
  return null;
}

/** The rolled action of a die-roll card: the first targeted-roll OtF, else the roll flavor looked up on the actor. */
export function rolledAction(message, actor) {
  const action = actionsInContent(message?.content).find((a) => ROLL_ACTION_TYPES.includes(a.type));
  if (action) return action;
  // Rolls started from a sheet row without an OtF have no chatthing: use the "3d6[<thing>]" flavor.
  const thing = thingFromRolls(message);
  if (!thing || !actor) return null;
  const attack = findAttack(actor, thing);
  if (attack)
    return { type: "attack", name: thing, isMelee: attack.list === "melee", isRanged: attack.list === "ranged" };
  if (findSpell(actor, thing)) return { type: "skill-spell", name: thing, isSpellOnly: true };
  if (findSkill(actor, thing)) return { type: "skill-spell", name: thing, isSkillOnly: true };
  return null;
}

/**
 * Build the (partial) AutomationEvent for a GGA chat message, or null.
 * @param {object} message ChatMessage
 * @param {{userId?: string, lastAttack?: (actorId: string) => object|null, animateFailedCasts?: boolean}} [opts]
 *   lastAttack: descriptors (+ itemUuid) of the actor's most recent attack, used to describe damage rolls.
 */
export function eventFromMessage(message, { userId, lastAttack, animateFailedCasts = true } = {}) {
  if (!message) return null;
  const transfer = message.flags?.gurps?.transfer;
  if (transfer?.type === DAMAGE_TRANSFER_TYPE) return damageEvent(message, transfer, { userId, lastAttack });

  const content = message.content;
  if (!isDieRollCard(content)) return null;
  const speakerActorId = message.speaker?.actor ?? null;
  const speakerActor = resolveActor({
    actorId: speakerActorId,
    tokenId: message.speaker?.token,
    sceneId: message.speaker?.scene
  });
  const action = rolledAction(message, speakerActor);
  if (!action) return null;
  // @actorId@ in the OtF names the roller when a GM rolls for another actor.
  const actor =
    action.sourceId && action.sourceId !== speakerActor?.id
      ? (resolveActor({ actorId: action.sourceId }) ?? speakerActor)
      : speakerActor;
  const actorId = actor?.id ?? action.sourceId ?? speakerActorId;
  const classified = classifyRoll(action, actor);
  if (!classified) return null;

  let outcome = outcomeFromContent(content);
  if (!outcome) outcome = outcomeFromChatdata(globalThis.GURPS?.lastTargetedRolls?.[actorId]) ?? OUTCOMES.NONE;
  // Blind rolls: don't leak the result through the animation.
  // VERIFY(v14): ChatMessage#blind is set for GGA blind rolls (dieroll.js sets messageData.blind + blind message mode).
  if (message.blind) outcome = OUTCOMES.NONE;
  const failed = outcome === OUTCOMES.FAILURE || outcome === OUTCOMES.CRITICAL_FAILURE;
  if (!animateFailedCasts && failed && classified.type !== EVENT_TYPES.ATTACK) return null;

  const source = sourceOf(message, actor, actorId);
  let targets;
  if (classified.type === EVENT_TYPES.ATTACK) targets = attackTargets(outcome);
  else targets = userTargetIds().map((tokenId) => ({ tokenId }));
  // Healing without a target: the caster heals themself.
  if (!targets.length && classified.type === EVENT_TYPES.HEALING && source.tokenId) {
    targets = [{ tokenId: source.tokenId }];
  }

  return {
    // One message → at most one event, so message id + type identifies it.
    id: message.id ? `${message.id}:${classified.type}` : null,
    type: classified.type,
    source,
    targets,
    outcome,
    itemUuid: classified.itemUuid,
    descriptors: classified.descriptors,
    sceneId: message.speaker?.scene ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? message.author?.id ?? globalThis.game?.user?.id ?? null
  };
}

function damageEvent(message, transfer, { userId, lastAttack }) {
  const payload = Array.isArray(transfer.payload) ? transfer.payload : [];
  const first = payload[0] ?? {};
  const actorId = first.attacker ?? message.speaker?.actor ?? null;
  const actor = resolveActor({ actorId, tokenId: message.speaker?.token, sceneId: message.speaker?.scene });
  const code = damageCode(first.damageType);
  const rolledTypes = damageTypesFor(code ? [code] : []);

  const recent = actorId && typeof lastAttack === "function" ? lastAttack(actorId) : null;
  let descriptors;
  if (recent?.descriptors) {
    descriptors = { ...recent.descriptors, traits: [...recent.descriptors.traits] };
    if (rolledTypes.length) descriptors.damageTypes = rolledTypes;
    if (code && !descriptors.traits.includes(code)) descriptors.traits.push(code);
  } else {
    const name = code && code !== "dmg" ? `${code} damage` : "Damage";
    descriptors = {
      name,
      key: slugify(name),
      type: "other",
      traits: code ? [code] : [],
      attackKind: null,
      weaponGroup: null,
      baseItem: null,
      range: null,
      area: null,
      damageTypes: rolledTypes,
      isHealing: false
    };
  }

  let targets = transfer.userTarget ? [{ tokenId: transfer.userTarget }] : [];
  if (!targets.length) targets = userTargetIds().map((tokenId) => ({ tokenId }));

  return {
    id: message.id ? `${message.id}:${EVENT_TYPES.DAMAGE}` : null,
    type: EVENT_TYPES.DAMAGE,
    source: sourceOf(message, actor, actorId),
    targets,
    outcome: OUTCOMES.NONE,
    itemUuid: recent?.itemUuid ?? null,
    descriptors,
    sceneId: message.speaker?.scene ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? message.author?.id ?? globalThis.game?.user?.id ?? null
  };
}
