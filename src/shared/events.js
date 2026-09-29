/**
 * Normalized automation events - the contract between system adapters
 * (src/systems/<id>) and the system-agnostic automation core (src/automation).
 *
 * Owned by the core: change only through a reviewed PR to docs/architecture.md.
 */

export const EVENT_TYPES = Object.freeze({
  ATTACK: "attack",
  DAMAGE: "damage",
  CAST: "cast",
  SAVE: "save",
  HEALING: "healing",
  AREA_PLACED: "areaPlaced",
  EFFECT_APPLIED: "effectApplied",
  EFFECT_REMOVED: "effectRemoved"
});

/** Degree of success. Systems without degrees map to SUCCESS/FAILURE; no roll = NONE. */
export const OUTCOMES = Object.freeze({
  CRITICAL_SUCCESS: "criticalSuccess",
  SUCCESS: "success",
  FAILURE: "failure",
  CRITICAL_FAILURE: "criticalFailure",
  NONE: "none"
});

export const AREA_SHAPES = Object.freeze({
  BURST: "burst",
  CONE: "cone",
  LINE: "line",
  EMANATION: "emanation",
  SQUARE: "square"
});

export const ATTACK_KINDS = Object.freeze({
  MELEE: "melee",
  RANGED: "ranged",
  THROWN: "thrown"
});

/**
 * System-agnostic description of an item, produced by SystemAdapter#getItemDescriptors.
 * @typedef {object} ItemDescriptors
 * @property {string} name
 * @property {string|null} key          Stable identifier (PF2e slug, 5e identifier...). Used by rules.
 * @property {string} type              "weapon" | "spell" | "action" | "consumable" | "effect" | "condition" | "feat" | "other"
 * @property {string[]} traits          Lower-case traits/tags ("fire", "thrown", "cantrip"...).
 * @property {string|null} attackKind   One of ATTACK_KINDS or null.
 * @property {string|null} weaponGroup  Normalized weapon group/base ("sword", "bow", "axe"...) or null.
 * @property {number|null} range        In scene distance units.
 * @property {{shape: string, size: number}|null} area  Shape from AREA_SHAPES, size in scene distance units.
 * @property {string[]} damageTypes     Lower-case ("fire", "cold", "piercing"...).
 * @property {boolean} isHealing
 */

/**
 * @typedef {object} AutomationEvent
 * @property {string} type              One of EVENT_TYPES.
 * @property {string} systemId          Adapter id that produced it.
 * @property {{tokenId: string|null, actorId: string|null}|null} source
 * @property {{tokenId: string, outcome?: string}[]} targets  Per-target outcome when the system provides it.
 * @property {string} outcome           Overall outcome, one of OUTCOMES.
 * @property {string|null} itemUuid
 * @property {ItemDescriptors|null} descriptors
 * @property {{shape: string, origin: {x:number,y:number}, direction: number, distance: number, width?: number, documentUuid?: string}|null} area
 *   Present for AREA_PLACED (and optionally for area spells). origin in canvas px, direction in degrees, distance/width in scene units.
 * @property {string|null} effectUuid   For EFFECT_APPLIED / EFFECT_REMOVED.
 * @property {string|null} sceneId
 * @property {string|null} userId       User whose client produced the event (only that client runs automation).
 */

/** Fill defaults and validate the type. */
export function createAutomationEvent(partial) {
  if (!Object.values(EVENT_TYPES).includes(partial?.type)) {
    throw new Error(`Unknown automation event type: ${partial?.type}`);
  }
  return {
    systemId: null,
    source: null,
    targets: [],
    outcome: OUTCOMES.NONE,
    itemUuid: null,
    descriptors: null,
    area: null,
    effectUuid: null,
    sceneId: globalThis.canvas?.scene?.id ?? null,
    userId: globalThis.game?.user?.id ?? null,
    ...partial
  };
}
