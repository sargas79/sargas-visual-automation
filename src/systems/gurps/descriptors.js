/**
 * GURPS Game Aid (GGA) data → system-agnostic ItemDescriptors.
 *
 * GURPS attacks and spells are mostly NOT Item documents: they are entries of the actor's `system.melee`,
 * `system.ranged`, `system.spells` and `system.skills` lists (objects keyed "00000", "00001"... with nested
 * `contains` / `collapsed` children). Keys are therefore slugs of the entry name.
 *
 * Sources (crnormand/gurps, tag v0.18.23, Foundry v13-v14):
 *  - template.json                          Item types equipment/feature/skill/spell/meleeAtk/rangedAtk and their
 *                                           system keys eqt/fea/ski/spl/mel/rng (mel: damage, mode, reach, parry...;
 *                                           rng: damage, mode, range, rof, rcl...; spl: college, class, resist...)
 *  - module/actor/actor-components.js       Melee/Ranged/Spell entries (name, mode, damage, level, fromItem, itemid)
 *  - module/damage/damage-tables.js         damageTypeMap: cr, cut, imp, pi-, pi, pi+, pi++, burn, cor, tox, fat, dmg, kb
 *  - lib/utilities.js#recurselist           list walking through `contains` / `collapsed`
 *  - module/item.js                         GurpsItem#itemSysKey / getItemAttacks (item.system.melee / ranged)
 */
import { ATTACK_KINDS } from "../../shared/events.js";

export function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** "Broadsword (Swing)" → { name: "Broadsword", mode: "Swing" } */
export function splitMode(text) {
  const s = String(text ?? "").trim();
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s);
  return m && m[1] ? { name: m[1].trim(), mode: m[2].trim() } : { name: s, mode: "" };
}

/** GGA damage type code (damage-tables.js#damageTypeMap aliases included) → canonical code. */
const DAMAGE_CODES = {
  cr: "cr",
  crush: "cr",
  crushing: "cr",
  cut: "cut",
  cutting: "cut",
  imp: "imp",
  impaling: "imp",
  "pi-": "pi-",
  "piercing-": "pi-",
  pi: "pi",
  piercing: "pi",
  "pi+": "pi+",
  "piercing+": "pi+",
  "pi++": "pi++",
  "piercing++": "pi++",
  burn: "burn",
  burning: "burn",
  cor: "cor",
  corrosion: "cor",
  corrosive: "cor",
  tox: "tox",
  toxic: "tox",
  fat: "fat",
  fatigue: "fat",
  dmg: "dmg",
  injury: "dmg",
  kb: "kb"
};

/** GURPS damage code → SVA damage type (the vocabulary of src/automation/fallback.js), or null. */
export const DAMAGE_TYPE_MAP = Object.freeze({
  cr: "bludgeoning",
  cut: "slashing",
  imp: "piercing",
  "pi-": "piercing",
  pi: "piercing",
  "pi+": "piercing",
  "pi++": "piercing",
  burn: "fire",
  cor: "acid",
  tox: "poison",
  fat: "fatigue",
  dmg: null,
  kb: null
});

/** Normalize one GGA damage type word to its code, or null. */
export function damageCode(word) {
  if (!word) return null;
  return DAMAGE_CODES[String(word).trim().toLowerCase()] ?? null;
}

/**
 * Damage type codes in a GGA damage string: "2d+1 cut", "sw+2 imp", "1d+1 pi+, 1d burn", "3d(2) cut",
 * "2d burn ex" (explosive), "1d-1 cr inc". Returns { codes, modifiers } (modifiers: "ex", "inc", "sur"...).
 */
export function parseDamage(text) {
  const codes = [];
  const modifiers = [];
  if (!text) return { codes, modifiers };
  for (const part of String(text).split(",")) {
    // Drop dice, adds, multipliers and armor divisors; keep the words.
    const words = part
      .replace(/\([^)]*\)/g, " ")
      .replace(/\*.*$/, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let found = false;
    for (const w of words) {
      const code = damageCode(w);
      if (code && !found) {
        codes.push(code);
        found = true;
      } else if (found && /^(ex|inc|sur|frag|rad)$/i.test(w)) {
        modifiers.push(w.toLowerCase());
      }
    }
  }
  return { codes: [...new Set(codes)], modifiers: [...new Set(modifiers)] };
}

/** SVA damage types for GURPS codes (drops codes without an equivalent). */
export function damageTypesFor(codes = []) {
  return [...new Set(codes.map((c) => DAMAGE_TYPE_MAP[c]).filter(Boolean))];
}

/**
 * Weapon name → weapon group (PF2e vocabulary where it exists, so fallbacks and rules are shared).
 * Order matters: the first match wins ("Crossbow" before "Bow", "Throwing Axe" is still an axe).
 */
const WEAPON_GROUPS = [
  ["brawling", /\b(punch|kick|brawling|boxing|karate|judo|unarmed|fist|knee|elbow|head ?butt|slam|sumo)\b/i],
  ["bite", /\b(bite|jaws?|fangs?|teeth)\b/i],
  ["claw", /\b(claws?|talons?)\b/i],
  ["shield", /\bshield\b/i],
  ["crossbow", /\b(crossbow|arbalest|prodd?)\b/i],
  ["bow", /(bow)\b/i],
  ["sling", /\b(sling|staff sling)\b/i],
  ["bomb", /\b(grenade|bomb|molotov|dynamite|explosive)\b/i],
  ["laser", /\b(laser|blaster|ray gun|raygun|plasma|phaser)\b/i],
  [
    "firearm",
    /\b(pistol|revolver|rifle|musket|shotgun|handgun|carbine|gun|smg|submachine|machine ?gun|derringer|blunderbuss|arquebus|colt|glock|luger|mauser|uzi|ak-?47|m-?16)\b/i
  ],
  ["dart", /\b(darts?|shuriken|throwing star|blowpipe)\b/i],
  [
    "knife",
    /\b(knife|dagger|dirk|stiletto|main[- ]gauche|tanto|kukri|sai|bayonet|poniard|misericorde|knuckle ?knife)\b/i
  ],
  [
    "sword",
    /(sword|sabre|saber|rapier|katana|cutlass|scimitar|falchion|estoc|wakizashi|jian|dao\b|machete|longsword|cleaver)/i
  ],
  ["axe", /\b(axe|hatchet|tomahawk|bardiche)\b|axe\b/i],
  ["hammer", /(hammer|maul)\b/i],
  ["flail", /\b(flail|morningstar|morning star|nunchaku|kusari|chain)\b/i],
  ["pick", /\bpick\b/i],
  ["polearm", /\b(halberd|glaive|poleaxe|pollaxe|naginata|bill|guisarme|partisan|voulge|polearm|scythe)\b/i],
  ["spear", /\b(spear|javelin|trident|pike|lance|pitchfork|harpoon|boar spear)\b/i],
  ["club", /\b(club|mace|baton|cudgel|staff|quarterstaff|cane|tonfa|jo|bo|blackjack|sap|nightstick|stick|rod)\b/i],
  ["whip", /\bwhip\b/i]
];

/** Weapon group from a weapon name (and optional usage/mode), or null. */
export function weaponGroupFromName(name, mode = "") {
  const text = `${name ?? ""}`;
  for (const [group, re] of WEAPON_GROUPS) if (re.test(text)) return group;
  // Unarmed usages are sometimes only in the mode ("Natural Attacks (Punch)").
  if (mode) for (const [group, re] of WEAPON_GROUPS) if (re.test(mode)) return group;
  return null;
}

/** Spell / skill names that heal (GURPS Magic Healing college, First Aid & co). */
export const HEALING_NAME =
  /\b(minor healing|major healing|great healing|healing slumber|instant regeneration|regeneration|restoration|instant restoration|cure disease|relieve sickness|stop bleeding|lend vitality|recover energy|first aid|esoteric medicine|physician|heal(?:ing)?)\b/i;

/** Energy hints in a spell / power name (GURPS spells carry no damage data). */
const ENERGY_HINTS = [
  ["fire", /\b(fire|flame|burn|inferno|heat|lava|magma)/i],
  ["electricity", /\b(lightning|electric|shock|spark|thunder)/i],
  ["cold", /\b(ice|frost|cold|freez|snow|sleet|hail)/i],
  ["acid", /\b(acid|corros)/i],
  ["poison", /\b(poison|venom|toxic)/i],
  ["bludgeoning", /\b(stone|rock|earth|boulder)/i],
  ["force", /\b(force|concussion|kinetic)/i]
];

export function energyFromName(name) {
  for (const [type, re] of ENERGY_HINTS) if (re.test(name ?? "")) return type;
  return null;
}

function lowerWords(text) {
  return String(text ?? "")
    .split(/[/,;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "100/1500" → 1500 (max range, yards); "x1/x1.5" (ST-relative) → null. VERIFY(gurps): yards vs scene units. */
export function parseRange(text) {
  const s = String(text ?? "").trim();
  if (!s || /x/i.test(s)) return null;
  const nums = s.split("/").map((p) => numberOrNull(p.replace(/[^0-9.]/g, "")));
  return nums.filter(Boolean).pop() ?? null;
}

function base(name, key, type) {
  return {
    name: name ?? "",
    key: key ?? (name ? slugify(name) || null : null),
    type,
    traits: [],
    attackKind: null,
    weaponGroup: null,
    baseItem: null,
    range: null,
    area: null,
    damageTypes: [],
    isHealing: false
  };
}

/**
 * Descriptors of a melee/ranged attack entry (actor.system.melee/ranged, or item.system.mel/rng).
 * @param {object} entry  { name, mode, damage, range, reach, ... }
 * @param {{list?: "melee"|"ranged", isSpell?: boolean}} [opts]
 */
export function describeAttack(entry, { list = "melee", isSpell = false } = {}) {
  const split = splitMode(entry?.name);
  const name = split.name;
  const mode = String(entry?.mode ?? split.mode ?? "").trim();
  const d = base(name, slugify(name) || null, "weapon");
  if (!entry) return d;
  const { codes, modifiers } = parseDamage(entry.damage);
  const traits = new Set([...codes, ...modifiers]);
  if (mode) traits.add(mode.toLowerCase());
  if (isSpell) traits.add("spell");

  const thrown = /\bthrown?\b|\bthrowing\b/i.test(`${mode} ${entry.name ?? ""}`);
  if (list === "ranged") d.attackKind = thrown ? ATTACK_KINDS.THROWN : ATTACK_KINDS.RANGED;
  else d.attackKind = ATTACK_KINDS.MELEE;
  if (d.attackKind === ATTACK_KINDS.THROWN) traits.add("thrown");

  d.weaponGroup = weaponGroupFromName(name, mode);
  d.range = list === "ranged" ? parseRange(entry.range ?? entry.max) : null;
  d.damageTypes = damageTypesFor(codes);
  // Spells and innate attacks without a physical damage code: use the name ("Fireball", "Lightning").
  const energy = energyFromName(name);
  if (energy && (isSpell || !d.damageTypes.length)) d.damageTypes = [...new Set([energy, ...d.damageTypes])];
  if (modifiers.includes("ex") || modifiers.includes("frag")) traits.add("explosive");
  d.traits = [...traits];
  return d;
}

/** Descriptors of a spell entry (actor.system.spells, or item.system.spl). */
export function describeSpell(entry) {
  const name = String(entry?.name ?? "").trim();
  const d = base(name, slugify(name) || null, "spell");
  if (!entry) return d;
  const traits = new Set(["spell"]);
  for (const c of lowerWords(entry.college)) traits.add(c);
  for (const c of lowerWords(entry.class)) traits.add(c);
  const energy = energyFromName(name);
  if (energy) d.damageTypes = [energy];
  d.isHealing = HEALING_NAME.test(name);
  if (d.isHealing) traits.add("healing");
  d.traits = [...traits];
  return d;
}

/** Descriptors of a skill entry (only healing skills produce events). */
export function describeSkill(entry) {
  const name = String(entry?.name ?? "").trim();
  const d = base(name, slugify(name) || null, "action");
  d.isHealing = HEALING_NAME.test(name);
  d.traits = d.isHealing ? ["skill", "healing"] : ["skill"];
  return d;
}

/** GGA item type → system key holding its data (module/item.js#itemSysKey). */
const SYS_KEY = { equipment: "eqt", feature: "fea", skill: "ski", spell: "spl", meleeAtk: "mel", rangedAtk: "rng" };

function firstEntry(map) {
  if (!map || typeof map !== "object") return null;
  return Object.values(map).find((v) => v && typeof v === "object") ?? null;
}

/** Stable key of a GGA Item document: slug of its (English) name, without the usage mode. */
export function itemKey(item) {
  if (!item) return null;
  const name = item.name ?? item.system?.[SYS_KEY[item.type]]?.name ?? "";
  return slugify(splitMode(name).name) || null;
}

/** Descriptors of a GGA Item document (equipment, spell, skill, feature, meleeAtk, rangedAtk). */
export function describeItem(item) {
  if (!item) return base("", null, "other");
  const sys = item.system ?? {};
  const data = sys[SYS_KEY[item.type]] ?? {};
  const name = item.name ?? data.name ?? "";
  let d;
  switch (item.type) {
    case "spell":
      d = describeSpell({ ...data, name });
      break;
    case "skill":
      d = describeSkill({ ...data, name });
      break;
    case "meleeAtk":
      d = describeAttack({ ...data, name }, { list: "melee" });
      break;
    case "rangedAtk":
      d = describeAttack({ ...data, name }, { list: "ranged" });
      break;
    case "equipment": {
      // Weapons are equipment that contribute melee/ranged attack entries (item.system.melee / ranged).
      const melee = firstEntry(sys.melee);
      const ranged = firstEntry(sys.ranged);
      if (melee || ranged) {
        d = describeAttack({ ...(melee ?? ranged), name: splitMode(name).name }, { list: melee ? "melee" : "ranged" });
      } else {
        d = base(
          name,
          null,
          /\b(potion|elixir|salve|draught|scroll|grenade|flask)\b/i.test(name) ? "consumable" : "other"
        );
        d.isHealing = HEALING_NAME.test(name);
        if (d.isHealing) d.traits = ["healing"];
      }
      break;
    }
    case "feature":
      d = base(name, null, "feat");
      break;
    default:
      d = base(name, null, "other");
  }
  d.key = itemKey(item);
  return d;
}
