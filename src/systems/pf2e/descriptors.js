/**
 * PF2e item → system-agnostic ItemDescriptors.
 *
 * Sources (foundryvtt/pf2e, tag pf2e-8.5.1, Foundry v14.361+):
 *  - src/module/item/weapon/document.ts   (group, baseType, range, isThrown, altUsageType)
 *  - src/module/item/weapon/values.ts     (WEAPON_GROUPS, MANDATORY_RANGED_GROUPS)
 *  - src/module/item/melee/document.ts    (NPC attacks: range {increment,max}, damageRolls, group/baseType for claw/fist/jaws)
 *  - src/module/item/spell/document.ts    (isAttack = "attack" trait, isMelee = range "touch", area, damageKinds)
 *  - src/module/item/spell/data.ts        (system.area {type,value}, system.damage {type, kinds}, system.duration.sustained)
 *  - src/module/item/values.ts            (EFFECT_AREA_SHAPES)
 *  - src/module/actor/character/document.ts (in-memory "basic-unarmed" strike, group "brawling")
 *  - src/module/rules/rule-element/aura.ts (Aura rule element radius, in feet)
 */
import { AREA_SHAPES, ATTACK_KINDS } from "../../shared/events.js";

/** PF2e item type → descriptor type. NPC attacks ("melee" items) count as weapons. */
const TYPE_MAP = {
  weapon: "weapon",
  melee: "weapon",
  shield: "weapon",
  spell: "spell",
  action: "action",
  feat: "feat",
  consumable: "consumable",
  effect: "effect",
  condition: "condition",
  affliction: "effect"
};

/** PF2e EFFECT_AREA_SHAPES → AREA_SHAPES. Shapes without an equivalent use the closest match. */
const AREA_MAP = {
  burst: AREA_SHAPES.BURST,
  cylinder: AREA_SHAPES.BURST,
  ring: AREA_SHAPES.BURST,
  cone: AREA_SHAPES.CONE,
  line: AREA_SHAPES.LINE,
  emanation: AREA_SHAPES.EMANATION,
  square: AREA_SHAPES.SQUARE,
  cube: AREA_SHAPES.SQUARE
};

/** Slugs of natural attacks that PF2e itself recognizes as base types (melee/document.ts#prepareSiblingData). */
export const NATURAL_BASE_TYPES = ["claw", "fist", "jaws"];

/** Slugs PF2e uses for the in-memory unarmed strike (remaster "basic-unarmed", legacy "fist"). */
export const UNARMED_SLUGS = ["basic-unarmed", "fist", "unarmed-attack"];

/** Normalize an area from PF2e `{ type, value }` data. */
export function mapArea(area) {
  if (!area?.type) return null;
  const shape = AREA_MAP[area.type];
  const size = Number(area.value);
  if (!shape || !Number.isFinite(size)) return null;
  return { shape, size };
}

export function mapAreaShape(type) {
  return AREA_MAP[type] ?? null;
}

function sluggify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Stable key: the PF2e slug (items without one fall back to a sluggified name). */
export function itemKey(item) {
  if (!item) return null;
  const slug = item.slug ?? item.system?.slug ?? null;
  if (slug) return slug;
  return item.name ? sluggify(item.name) || null : null;
}

function traitsOf(item) {
  const value = item?.system?.traits?.value;
  const list = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  return list.filter((t) => typeof t === "string").map((t) => t.toLowerCase());
}

/** Parse "30 feet" / "30-ft" / "touch" spell ranges. */
function parseRangeText(text) {
  const s = sluggify(text);
  if (s === "touch") return 5;
  const match = /^(\d+)-f(?:t|eet)\b/.exec(s);
  return match ? Number(match[1]) : null;
}

function weaponRange(item) {
  // weapon: system.range is the range increment (number); melee (NPC): system.range = { increment, max }
  const r = item.system?.range;
  if (typeof r === "number") return r || null;
  if (r && typeof r === "object") return r.increment ?? r.max ?? null;
  return null;
}

function weaponAttackKind(item, { altUsage } = {}) {
  const traits = traitsOf(item);
  if (altUsage === "thrown") return ATTACK_KINDS.THROWN;
  if (altUsage === "melee") return ATTACK_KINDS.MELEE;
  const ranged = !!weaponRange(item);
  if (!ranged) return ATTACK_KINDS.MELEE;
  // A ranged usage with the plain "thrown" trait (weapon thrown usage) or a "thrown-N" trait (NPC attack / thrown-only weapon)
  if (traits.some((t) => t === "thrown" || /^thrown-\d+$/.test(t))) return ATTACK_KINDS.THROWN;
  if (item.isThrown === true) return ATTACK_KINDS.THROWN;
  return ATTACK_KINDS.RANGED;
}

function weaponGroup(item) {
  const traits = traitsOf(item);
  const group = item.group ?? item.system?.group ?? null;
  if (group) return String(group).toLowerCase();
  // NPC attacks: PF2e only knows the group through a linked weapon or the "unarmed" trait
  if (traits.includes("unarmed")) return "brawling";
  const key = itemKey(item);
  if (UNARMED_SLUGS.includes(key) || NATURAL_BASE_TYPES.includes(key)) return "brawling";
  return null;
}

function weaponDamageTypes(item) {
  const types = new Set();
  const dmg = item.system?.damage;
  if (dmg?.damageType) types.add(dmg.damageType);
  // NPC attack: system.damageRolls = { [id]: { damage, damageType, category } }
  for (const roll of Object.values(item.system?.damageRolls ?? {})) {
    if (roll?.damageType) types.add(roll.damageType);
  }
  return [...types].map((t) => String(t).toLowerCase());
}

function spellDamage(item) {
  const types = new Set();
  let healing = false;
  let damaging = false;
  for (const d of Object.values(item.system?.damage ?? {})) {
    const kinds = d?.kinds instanceof Set ? [...d.kinds] : Array.isArray(d?.kinds) ? d.kinds : ["damage"];
    if (kinds.includes("healing")) healing = true;
    if (kinds.includes("damage")) damaging = true;
    if (d?.type && kinds.includes("damage")) types.add(String(d.type).toLowerCase());
  }
  return { types: [...types], healing, damaging };
}

/** Radius (feet) of the first Aura rule element with a numeric radius, for emanation auras (Bless...). */
function auraArea(item) {
  const rules = item.system?.rules ?? [];
  for (const rule of rules) {
    if (rule?.key !== "Aura") continue;
    const radius = Number(rule.radius);
    if (Number.isFinite(radius) && radius > 0) return { shape: AREA_SHAPES.EMANATION, size: radius };
  }
  return null;
}

/**
 * @param {object} item PF2e item (or plain object shaped like one).
 * @param {{altUsage?: "thrown"|"melee"|null}} [context] Extra info from the chat message (context.altUsage).
 * @returns {import("../../shared/events.js").ItemDescriptors}
 */
export function describeItem(item, context = {}) {
  const type = TYPE_MAP[item?.type] ?? "other";
  const traits = traitsOf(item);
  const d = {
    name: item?.name ?? "",
    key: itemKey(item),
    type,
    traits,
    attackKind: null,
    weaponGroup: null,
    range: null,
    area: null,
    damageTypes: [],
    isHealing: false
  };
  if (!item) return d;
  const sys = item.system ?? {};

  switch (item.type) {
    case "weapon":
    case "melee":
    case "shield": {
      d.attackKind = weaponAttackKind(item, context);
      d.weaponGroup = item.type === "shield" ? "shield" : weaponGroup(item);
      d.range = weaponRange(item);
      d.damageTypes = weaponDamageTypes(item);
      if (item.type === "melee" && sys.area?.type && sys.action === "area-fire") d.area = mapArea(sys.area);
      // Extra field, not part of the ItemDescriptors contract (yet): base weapon, e.g. "longsword".
      d.baseItem = item.baseType ?? sys.baseItem ?? (NATURAL_BASE_TYPES.includes(d.key) ? d.key : null);
      break;
    }
    case "spell": {
      const isAttack = traits.includes("attack");
      const rangeText = sys.range?.value ?? "";
      const isTouch = sluggify(rangeText) === "touch";
      if (isAttack) d.attackKind = isTouch ? ATTACK_KINDS.MELEE : ATTACK_KINDS.RANGED;
      d.range = parseRangeText(rangeText);
      d.area = mapArea(sys.area);
      const dmg = spellDamage(item);
      d.damageTypes = dmg.types;
      // Heal: "healing" trait (its vitality damage also hurts undead). Harm: void damage that also heals undead,
      // but no "healing" trait - treated as damage.
      d.isHealing = traits.includes("healing") || (dmg.healing && !dmg.damaging);
      // Synthetic trait: PF2e has no "sustained" trait, but rules may want to match sustained spells.
      if (sys.duration?.sustained && !d.traits.includes("sustained")) d.traits.push("sustained");
      break;
    }
    case "consumable": {
      const dmg = sys.damage;
      if (dmg?.kind === "healing") d.isHealing = true;
      else if (dmg?.type) d.damageTypes = [String(dmg.type).toLowerCase()];
      if (traits.includes("healing") && !dmg?.type) d.isHealing = true;
      break;
    }
    case "effect":
    case "condition":
    case "affliction":
      d.area = auraArea(item);
      break;
    default:
      if (traits.includes("healing") || d.key === "battle-medicine") d.isHealing = true;
  }
  return d;
}
