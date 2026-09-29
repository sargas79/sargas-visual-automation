/**
 * D&D 5e item → system-agnostic ItemDescriptors.
 *
 * Sources (foundryvtt/dnd5e, tag release-6.0.5, Foundry v14.367+):
 *  - module/data/item/templates/item-description.mjs  system.identifier (IdentifierField, slug of the name on create)
 *  - module/data/item/weapon.mjs      system.type {value: simpleM|simpleR|martialM|martialR|natural|improv|siege,
 *                                     baseItem}, properties (Set: thr, fin, lgt, hvy, two, ver, amm, lod, rch, ret, mgc...),
 *                                     damage.base.types (Set), range {value, long, reach, units}, attackType, attackModes
 *  - module/config.mjs                DND5E.weaponTypeMap, DND5E.weaponIds (base weapon ids), DND5E.areaTargetTypes,
 *                                     DND5E.spellSchools (abj, con, div, enc, evo, ill, nec, trs), DND5E.healingTypes
 *  - module/data/activity/attack-data.mjs  attack.type {value: melee|ranged, classification: weapon|spell|unarmed}
 *  - module/data/activity/base-activity.mjs damage.parts[].types, target.template {type, size, units}
 *  - module/data/activity/heal-data.mjs     healing.types (healing | temphp | maximum)
 *  - packs/_source/spells24, equipment24    real identifiers ("fire-bolt", "potion-of-healing", "unarmed-strike")
 */
import { AREA_SHAPES, ATTACK_KINDS } from "../../shared/events.js";

/** dnd5e item type → descriptor type. */
const TYPE_MAP = {
  weapon: "weapon",
  spell: "spell",
  consumable: "consumable",
  feat: "feat"
};

/** DND5E.areaTargetTypes keys (and v14 region shape types) → AREA_SHAPES. */
const AREA_MAP = {
  circle: AREA_SHAPES.BURST,
  sphere: AREA_SHAPES.BURST,
  cylinder: AREA_SHAPES.BURST,
  ring: AREA_SHAPES.BURST,
  cone: AREA_SHAPES.CONE,
  line: AREA_SHAPES.LINE,
  ray: AREA_SHAPES.LINE,
  wall: AREA_SHAPES.LINE,
  cube: AREA_SHAPES.SQUARE,
  square: AREA_SHAPES.SQUARE,
  rect: AREA_SHAPES.SQUARE,
  rectangle: AREA_SHAPES.SQUARE,
  radius: AREA_SHAPES.EMANATION,
  emanation: AREA_SHAPES.EMANATION
};

/**
 * DND5E.weaponIds (base weapons) → weapon group, in the PF2e vocabulary (WEAPON_GROUPS) so rules and the
 * generic fallback are shared: PF2e files daggers under "knife", staves and maces under "club", whips under "flail".
 */
export const WEAPON_GROUPS = {
  battleaxe: "axe",
  greataxe: "axe",
  handaxe: "axe",
  blowgun: "dart",
  dart: "dart",
  club: "club",
  greatclub: "club",
  mace: "club",
  morningstar: "club",
  quarterstaff: "club",
  dagger: "knife",
  sickle: "knife",
  flail: "flail",
  whip: "flail",
  glaive: "polearm",
  halberd: "polearm",
  pike: "polearm",
  greatsword: "sword",
  longsword: "sword",
  rapier: "sword",
  scimitar: "sword",
  shortsword: "sword",
  handcrossbow: "crossbow",
  heavycrossbow: "crossbow",
  lightcrossbow: "crossbow",
  javelin: "spear",
  lance: "spear",
  spear: "spear",
  trident: "spear",
  lighthammer: "hammer",
  maul: "hammer",
  warhammer: "hammer",
  warpick: "pick",
  longbow: "bow",
  shortbow: "bow",
  musket: "firearm",
  pistol: "firearm",
  sling: "sling"
};

/** Weapon property ids (DND5E.itemProperties) → readable traits. Unknown ids are kept as-is. */
const PROPERTY_TRAITS = {
  ada: "adamantine",
  amm: "ammunition",
  fin: "finesse",
  fir: "firearm",
  foc: "focus",
  hvy: "heavy",
  lgt: "light",
  lod: "loading",
  mgc: "magical",
  rch: "reach",
  rel: "reload",
  ret: "returning",
  sil: "silvered",
  spc: "special",
  thr: "thrown",
  two: "two-handed",
  ver: "versatile"
};

/** DND5E.spellSchools abbreviations → full names (both are added as traits). */
const SCHOOLS = {
  abj: "abjuration",
  con: "conjuration",
  div: "divination",
  enc: "enchantment",
  evo: "evocation",
  ill: "illusion",
  nec: "necromancy",
  trs: "transmutation"
};

/** DND5E.weaponTypeMap: weapon type → attack type. natural / improv have no entry. */
const WEAPON_TYPE_MAP = { simpleM: "melee", simpleR: "ranged", martialM: "melee", martialR: "ranged", siege: "ranged" };

/** DND5E.healingTypes. */
export const HEALING_TYPES = ["healing", "temphp", "maximum"];

/** Identifiers of the 2024 / 2014 unarmed strike items. */
export const UNARMED_KEYS = ["unarmed-strike", "unarmed"];

export function sluggify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Set, Array, Collection/Map (values) or plain object → array. */
export function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  if (value instanceof Map) return [...value.values()];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  if (typeof value === "object") return Object.values(value);
  return [];
}

/** item.system.activities (ActivityCollection, a Collection) → Activity[]. */
export function activitiesOf(item) {
  const acts = item?.system?.activities;
  if (!acts) return [];
  if (typeof acts.values === "function" && !Array.isArray(acts)) return [...acts.values()];
  return toArray(acts);
}

/**
 * Stable key: dnd5e `system.identifier` (the slugged English name for compendium items, "fire-bolt"), falling back
 * to the `identifier` getter and to a slug of the name. Apostrophes are dropped like dnd5e's slugify ("hunters-mark").
 */
export function itemKey(item) {
  if (!item) return null;
  const id = item.system?.identifier || item.identifier || null;
  if (id) return String(id);
  return item.name ? sluggify(item.name) || null : null;
}

export function mapAreaShape(type) {
  return AREA_MAP[type] ?? null;
}

/** Numeric size from a template size that may be a number, numeric string or formula ("5 * @item.level"). */
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `{ type, size }` template data → `{ shape, size }`, or null. */
export function mapArea(template) {
  if (!template?.type) return null;
  const shape = AREA_MAP[template.type];
  const size = numeric(template.size);
  if (!shape || size === null) return null;
  return { shape, size };
}

/** Attack kind of an attack activity (attack.type.value), or null. */
function activityAttackKind(activity) {
  const value = activity?.attack?.type?.value;
  if (value === "melee") return ATTACK_KINDS.MELEE;
  if (value === "ranged") return ATTACK_KINDS.RANGED;
  return null;
}

function weaponAttackKind(item, { activity, attackMode } = {}) {
  const sys = item.system ?? {};
  const properties = toArray(sys.properties);
  // AttackActivity#getActionType: "thrown*" and "ranged" attack modes turn a melee weapon into a ranged attack.
  if (typeof attackMode === "string" && attackMode.startsWith("thrown")) return ATTACK_KINDS.THROWN;
  if (attackMode === "ranged") return ATTACK_KINDS.RANGED;
  const attackType = WEAPON_TYPE_MAP[sys.type?.value] ?? null;
  if (attackMode && attackType === "melee") return ATTACK_KINDS.MELEE;
  if (attackType === "ranged") return properties.includes("thr") ? ATTACK_KINDS.THROWN : ATTACK_KINDS.RANGED;
  if (attackType === "melee") return ATTACK_KINDS.MELEE;
  // natural / improvised weapons: the attack activity says melee or ranged.
  const act = activity?.type === "attack" ? activity : activitiesOf(item).find((a) => a?.type === "attack");
  return activityAttackKind(act) ?? ATTACK_KINDS.MELEE;
}

function weaponGroup(item, key, activity) {
  const base = item.system?.type?.baseItem;
  if (base && WEAPON_GROUPS[base]) return WEAPON_GROUPS[base];
  if (UNARMED_KEYS.includes(key)) return "brawling";
  const act = activity?.type === "attack" ? activity : activitiesOf(item).find((a) => a?.type === "attack");
  if (act?.attack?.type?.classification === "unarmed") return "brawling";
  return null;
}

/** Damage and healing types over the item's damage and its activities (or one activity). */
function damageInfo(item, activity) {
  const damage = new Set();
  const healing = new Set();
  const add = (types) => {
    for (const t of toArray(types)) {
      const type = String(t).toLowerCase();
      if (HEALING_TYPES.includes(type)) healing.add(type);
      else damage.add(type);
    }
  };
  const acts = activity ? [activity] : activitiesOf(item);
  if (!activity) add(item.system?.damage?.base?.types);
  else if (activity.type === "attack" && item.type === "weapon") add(item.system?.damage?.base?.types);
  let heals = false;
  for (const a of acts) {
    for (const part of toArray(a?.damage?.parts)) add(part?.types);
    if (a?.type === "heal") {
      heals = true;
      add(a.healing?.types);
    }
  }
  return { damage: [...damage], healing: [...healing], heals };
}

function rangeOf(sys) {
  const r = sys?.range;
  if (!r) return null;
  if (typeof r === "number") return r || null;
  if (r.units === "touch") return 5;
  const value = numeric(r.value);
  if (value) return value;
  const reach = numeric(r.reach);
  return reach || null;
}

function areaOf(item, activity) {
  const acts = activity ? [activity] : activitiesOf(item);
  for (const a of acts) {
    const area = mapArea(a?.target?.template);
    if (area) return area;
  }
  return mapArea(item.system?.target?.template);
}

/**
 * @param {object} item dnd5e Item (or a plain object shaped like one).
 * @param {{activity?: object, attackMode?: string}} [context] The activity that was used / rolled and the attack mode
 *   of the roll (attack message `system.mode`: oneHanded, twoHanded, offhand, thrown, thrown-offhand, ranged).
 * @returns {import("../../shared/events.js").ItemDescriptors}
 */
export function describeItem(item, context = {}) {
  const key = itemKey(item);
  const d = {
    name: item?.name ?? "",
    key,
    type: TYPE_MAP[item?.type] ?? "other",
    traits: [],
    attackKind: null,
    weaponGroup: null,
    baseItem: null,
    range: null,
    area: null,
    damageTypes: [],
    isHealing: false
  };
  if (!item) return d;
  const sys = item.system ?? {};
  const activity = context.activity ?? null;
  const traits = new Set();
  for (const p of toArray(sys.properties)) traits.add(PROPERTY_TRAITS[p] ?? String(p).toLowerCase());
  if (typeof sys.type?.value === "string" && item.type !== "weapon") traits.add(sys.type.value.toLowerCase());

  const info = damageInfo(item, activity);
  d.damageTypes = info.damage;
  d.isHealing = activity
    ? activity.type === "heal" || (info.healing.length > 0 && info.damage.length === 0)
    : (info.heals || info.healing.length > 0) && info.damage.length === 0;
  d.range = rangeOf(sys);
  d.area = areaOf(item, activity);

  switch (item.type) {
    case "weapon": {
      d.attackKind = weaponAttackKind(item, context);
      d.weaponGroup = weaponGroup(item, key, activity);
      d.baseItem = sys.type?.baseItem || (UNARMED_KEYS.includes(key) ? "unarmed" : null);
      const wtype = sys.type?.value;
      if (wtype === "natural") traits.add("natural");
      else if (wtype?.startsWith("simple")) traits.add("simple");
      else if (wtype?.startsWith("martial")) traits.add("martial");
      break;
    }
    case "spell": {
      const school = sys.school ? String(sys.school).toLowerCase() : null;
      if (school) traits.add(SCHOOLS[school] ?? school);
      if (Number(sys.level) === 0) traits.add("cantrip");
      break;
    }
    default:
      break;
  }

  // Non-weapons (spells, features, consumables): the attack activity decides melee / ranged.
  if (!d.attackKind) {
    const act = activity?.type === "attack" ? activity : activitiesOf(item).find((a) => a?.type === "attack");
    d.attackKind = activityAttackKind(act);
  }
  const types = new Set(activity ? [activity.type] : activitiesOf(item).map((a) => a?.type));
  if (types.has("attack")) traits.add("attack");
  if (types.has("save")) traits.add("save");
  for (const t of d.damageTypes) traits.add(t);
  if (d.isHealing) traits.add("healing");
  d.traits = [...traits].filter(Boolean);
  return d;
}
