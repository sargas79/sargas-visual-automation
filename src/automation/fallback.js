/**
 * Generic fallback recipes, derived only from system-agnostic ItemDescriptors
 * (attackKind, weaponGroup, damageTypes, isHealing, area, traits). Used when
 * no item flag, world rule or system rule pack matches.
 *
 * Every animation below is a real JB2A Patreon database path (jb2a_patreon
 * 0.9.3, `patreonDatabase`). Branch paths are fine: api.db.resolve picks a
 * leaf (and the closest distance variant for stretched effects).
 */
import { AREA_SHAPES, ATTACK_KINDS, EVENT_TYPES } from "../shared/events.js";
import { NATURAL_GROUP, naturalFamilyOf } from "../shared/natural-attacks.js";
import { RECIPE_VERSION } from "./schema.js";

/** Synonyms used by different game systems → one canonical damage type. */
const DAMAGE_ALIASES = {
  lightning: "electricity",
  thunder: "sonic",
  necrotic: "void",
  negative: "void",
  radiant: "vitality",
  positive: "vitality",
  psychic: "mental",
  holy: "spirit",
  unholy: "spirit"
};

const PHYSICAL = new Set(["slashing", "piercing", "bludgeoning", "bleed", "precision"]);

/** Canonical energy types, in the order they win when an item deals several. */
const ENERGY_ORDER = [
  "fire",
  "cold",
  "electricity",
  "acid",
  "poison",
  "sonic",
  "force",
  "void",
  "vitality",
  "mental",
  "spirit"
];

export function canonicalDamageTypes(types = []) {
  return [...new Set((types ?? []).map((t) => String(t).toLowerCase()).map((t) => DAMAGE_ALIASES[t] ?? t))];
}

/** First energy (non-physical) damage type, or null. */
export function primaryEnergy(types) {
  const canon = canonicalDamageTypes(types);
  return ENERGY_ORDER.find((t) => canon.includes(t)) ?? canon.find((t) => !PHYSICAL.has(t)) ?? null;
}

const MELEE_BY_GROUP = {
  sword: "jb2a.sword.melee.01.white",
  axe: "jb2a.greataxe.melee.standard.white",
  spear: "jb2a.spear.melee.01.white",
  polearm: "jb2a.spear.melee.01.white",
  club: "jb2a.mace.melee.01.white",
  mace: "jb2a.mace.melee.01.white",
  flail: "jb2a.mace.melee.01.white",
  hammer: "jb2a.hammer.melee.01.white",
  knife: "jb2a.dagger.melee.02.white",
  dagger: "jb2a.dagger.melee.02.white",
  brawling: "jb2a.unarmed_strike.physical.01.blue",
  unarmed: "jb2a.unarmed_strike.physical.01.blue",
  [NATURAL_GROUP]: "jb2a.melee_generic.creature_attack.fist",
  claw: "jb2a.claws.200px.red",
  bite: "jb2a.bite.200px.red",
  jaws: "jb2a.bite.200px.red"
};

/**
 * Natural attacks of creatures (NPC strikes named after a body part). Family by name, then a JB2A path sized to the
 * creature (200px up to Medium, 400px from Large) and coloured by its energy damage or creature type.
 */
/** JB2A paths per natural family: `{size}` is 200px/400px, `{color}` a colour variant. */
const NATURAL_PATHS = {
  bite: { base: "jb2a.bite.{size}", colored: "jb2a.bite.{size}.{color}" },
  claw: { base: "jb2a.claws.{size}", colored: "jb2a.claws.{size}.{color}" },
  sting: { base: "jb2a.melee_generic.piercing.one_handed", colored: null },
  slam: { base: "jb2a.melee_generic.creature_attack.fist", colored: null }
};

/** Colour of a natural attack: by energy damage first, else by creature type, else red. */
const NATURAL_COLOR_BY_ENERGY = {
  fire: "orange",
  cold: "blue",
  electricity: "yellow",
  acid: "green",
  poison: "green",
  sonic: "yellow",
  force: "purple",
  void: "purple",
  vitality: "yellow",
  mental: "purple",
  spirit: "blue"
};
const NATURAL_COLOR_BY_CREATURE = {
  undead: "purple",
  aberration: "purple",
  fiend: "red",
  dragon: "red",
  fey: "green",
  plant: "green",
  ooze: "green",
  celestial: "yellow",
  elemental: "blue",
  construct: "blue"
};
const NATURAL_DEFAULT_COLOR = "red";
const LARGE_SIZES = new Set(["size:large", "size:huge", "size:gargantuan"]);

/** Natural attack family of a creature strike (by base item or name), or null. */
export function naturalFamily(descriptors) {
  const d = descriptors ?? {};
  const group = d.weaponGroup ? String(d.weaponGroup).toLowerCase() : null;
  // A strike with a real weapon group (sword, bow...) is a weapon, whatever its name.
  if (group && group !== NATURAL_GROUP && group !== "brawling" && group !== "unarmed") return null;
  return naturalFamilyOf(d.baseItem, d.name);
}

/**
 * Animation of a natural attack, trying the exact size + colour variant first and falling back to branch paths.
 * @param {(path: string) => boolean} [exists]  Database check; without it the most specific path is used.
 */
export function naturalAnimation(family, descriptors, { exists } = {}) {
  const d = descriptors ?? {};
  const paths = NATURAL_PATHS[family];
  if (!paths) return null;
  const actorTraits = (d.actorTraits ?? []).map((t) => String(t).toLowerCase());
  const size = actorTraits.some((t) => LARGE_SIZES.has(t)) ? "400px" : "200px";
  const energy = primaryEnergy(d.damageTypes);
  const creature = actorTraits.find((t) => NATURAL_COLOR_BY_CREATURE[t]);
  const color =
    (energy && NATURAL_COLOR_BY_ENERGY[energy]) ??
    (creature && NATURAL_COLOR_BY_CREATURE[creature]) ??
    NATURAL_DEFAULT_COLOR;
  const fill = (tpl) => tpl.replace("{size}", size).replace("{color}", color);
  const candidates = [
    paths.colored && fill(paths.colored),
    fill(paths.base),
    fill(paths.base.replace(".{size}", ""))
  ].filter(Boolean);
  const ok = typeof exists === "function" ? exists : () => true;
  const animation = candidates.find((c) => ok(c)) ?? candidates[candidates.length - 1];
  const why = [`natural ${family} attack`];
  if (size === "400px") why.push("large creature");
  if (energy && NATURAL_COLOR_BY_ENERGY[energy]) why.push(`${energy} damage`);
  else if (creature) why.push(`${creature} creature`);
  return { animation, reason: why.join(", ") };
}

const MELEE_BY_DAMAGE = {
  slashing: "jb2a.melee_generic.slashing.one_handed",
  piercing: "jb2a.melee_generic.piercing.one_handed",
  bludgeoning: "jb2a.melee_generic.bludgeoning.one_handed"
};
const MELEE_DEFAULT = "jb2a.melee_generic.slash.01.orange";

const RANGED_BY_GROUP = {
  bow: "jb2a.arrow.physical.white.01",
  crossbow: "jb2a.bolt.physical.white",
  firearm: "jb2a.bullet.01.orange",
  sling: "jb2a.slingshot",
  dart: "jb2a.dart.01.throw.physical.white",
  bomb: "jb2a.throwable.throw.bomb.01.black"
};
const RANGED_DEFAULT = "jb2a.arrow.physical.white.01";

const THROWN_BY_GROUP = {
  knife: "jb2a.dagger.throw.01.white",
  dagger: "jb2a.dagger.throw.01.white",
  spear: "jb2a.javelin.01.throw",
  polearm: "jb2a.javelin.01.throw",
  axe: "jb2a.greataxe.throw.white",
  hammer: "jb2a.hammer.throw",
  club: "jb2a.hammer.throw",
  dart: "jb2a.dart.01.throw.physical.white",
  bomb: "jb2a.throwable.throw.bomb.01.black",
  shield: "jb2a.shield_attack.ranged.throw.01.white.01"
};
const THROWN_DEFAULT = "jb2a.dagger.throw.01.white";

/** Per energy type: spell projectile, impact, melee touch and area animations. */
const ENERGY = {
  fire: {
    projectile: "jb2a.fire_bolt.orange",
    impact: "jb2a.impact.fire.01.orange",
    touch: "jb2a.unarmed_strike.magical.01.orange",
    burst: "jb2a.fireball.explosion.orange",
    cone: "jb2a.burning_hands.01.orange",
    line: "jb2a.breath_weapons.fire.line.orange"
  },
  cold: {
    projectile: "jb2a.ray_of_frost.blue",
    impact: "jb2a.impact.frost.blue.01",
    touch: "jb2a.unarmed_strike.magical.01.blue",
    burst: "jb2a.ice_spikes.radial.burst.blue",
    cone: "jb2a.cone_of_cold.blue",
    line: "jb2a.template_line.ice.01.blue"
  },
  electricity: {
    projectile: "jb2a.chain_lightning.primary.blue",
    impact: "jb2a.static_electricity.01.blue",
    touch: "jb2a.unarmed_strike.magical.01.blue",
    burst: "jb2a.explosion.02.blue",
    cone: "jb2a.breath_weapons.fire.cone.blue.01",
    line: "jb2a.lightning_bolt.wide.blue"
  },
  acid: {
    projectile: "jb2a.ranged.01.projectile.01.dark_green",
    impact: "jb2a.liquid.splash.green",
    touch: "jb2a.unarmed_strike.magical.01.green",
    burst: "jb2a.explosion.01.green",
    cone: "jb2a.breath_weapons.poison.cone.green",
    line: "jb2a.breath_weapons.acid.line.green"
  },
  poison: {
    projectile: "jb2a.spell_projectile.poison.greenyellow",
    impact: "jb2a.impact_themed.poison.greenyellow",
    touch: "jb2a.unarmed_strike.magical.01.green",
    burst: "jb2a.explosion.01.green",
    cone: "jb2a.breath_weapons.poison.cone.green",
    line: "jb2a.breath_weapons.acid.line.green"
  },
  sonic: {
    projectile: "jb2a.eldritch_blast.lightblue",
    impact: "jb2a.impact.sound.01.pinkteal",
    touch: "jb2a.unarmed_strike.magical.01.blue",
    burst: "jb2a.shatter.blue",
    cone: "jb2a.breath_weapons.cold.cone.blue",
    line: "jb2a.breath_weapons.lightning.line.blue"
  },
  force: {
    projectile: "jb2a.magic_missile.purple",
    impact: "jb2a.impact.003.dark_purple",
    touch: "jb2a.unarmed_strike.magical.01.dark_purple",
    burst: "jb2a.explosion.02.purple",
    cone: "jb2a.cone_of_cold.purple",
    line: "jb2a.breath_weapons.lightning.line.purple"
  },
  void: {
    projectile: "jb2a.eldritch_blast.dark_purple",
    impact: "jb2a.impact.003.dark_purple",
    touch: "jb2a.unarmed_strike.magical.01.dark_purple",
    burst: "jb2a.explosion.02.purple",
    cone: "jb2a.breath_weapons.poison.cone.dark_black",
    line: "jb2a.breath_weapons.lightning.line.purple"
  },
  vitality: {
    projectile: "jb2a.guiding_bolt.01.yellow",
    impact: "jb2a.impact.003.yellow",
    touch: "jb2a.unarmed_strike.magical.01.yellow",
    burst: "jb2a.explosion.01.yellow",
    cone: "jb2a.breath_weapons.fire.cone.yellow.01",
    line: "jb2a.breath_weapons.fire.line.orange"
  },
  mental: {
    projectile: "jb2a.spell_projectile.skull.pinkpurple",
    impact: "jb2a.impact_themed.skull.pinkpurple",
    touch: "jb2a.unarmed_strike.magical.01.pinkpurple",
    burst: "jb2a.explosion.02.purple",
    cone: "jb2a.cone_of_cold.purple",
    line: "jb2a.breath_weapons.lightning.line.purple"
  },
  spirit: {
    projectile: "jb2a.guiding_bolt.01.dark_bluewhite",
    impact: "jb2a.impact.003.blue",
    touch: "jb2a.unarmed_strike.magical.01.blue",
    burst: "jb2a.explosion.02.blue",
    cone: "jb2a.breath_weapons.cold.cone.blue",
    line: "jb2a.breath_weapons.lightning.line.blue"
  }
};

const GENERIC = {
  projectile: "jb2a.eldritch_blast.purple",
  impact: "jb2a.impact.003.blue",
  touch: "jb2a.unarmed_strike.magical.01.blue",
  burst: "jb2a.explosion.01.orange",
  emanation: "jb2a.template_circle.out_pulse.01.burst.bluewhite",
  cone: "jb2a.cone_of_cold.purple",
  line: "jb2a.breath_weapons.lightning.line.purple"
};

const HEALING = {
  onToken: "jb2a.healing_generic.200px.green",
  burst: "jb2a.healing_generic.burst.greenorange"
};

const AURA = "jb2a.template_circle.aura.01.loop.large.bluepurple";

const recipe = (preset, animation, extra = {}) => ({ version: RECIPE_VERSION, preset, animation, ...extra });
const impactStage = (animation) => ({ stages: { impact: { animation } } });

/** Every animation path the fallback can produce (for tests and the UI). */
export function fallbackAnimations() {
  const paths = new Set([
    ...Object.values(MELEE_BY_GROUP),
    ...Object.values(NATURAL_PATHS).flatMap((p) => ["200px", "400px"].map((size) => p.base.replace("{size}", size))),
    ...Object.values(MELEE_BY_DAMAGE),
    MELEE_DEFAULT,
    ...Object.values(RANGED_BY_GROUP),
    RANGED_DEFAULT,
    ...Object.values(THROWN_BY_GROUP),
    THROWN_DEFAULT,
    ...Object.values(ENERGY).flatMap((e) => Object.values(e)),
    ...Object.values(GENERIC),
    ...Object.values(HEALING),
    AURA
  ]);
  return [...paths].sort();
}

function areaRecipe(shape, energy, isHealing) {
  const table = energy ? ENERGY[energy] : null;
  let animation;
  if (isHealing) animation = HEALING.burst;
  else if (shape === AREA_SHAPES.CONE) animation = table?.cone ?? GENERIC.cone;
  else if (shape === AREA_SHAPES.LINE) animation = table?.line ?? GENERIC.line;
  else if (shape === AREA_SHAPES.EMANATION) animation = table?.burst ?? GENERIC.emanation;
  else animation = table?.burst ?? GENERIC.burst;
  return recipe("area", animation, { options: { shape } });
}

/**
 * @param {import("../shared/events.js").ItemDescriptors|null} descriptors
 * @param {{eventType?: string, area?: object|null, exists?: (path: string) => boolean}} [opts]
 *   `exists` checks a JB2A path against the loaded database (natural attacks pick colour/size variants with it).
 * @returns {{recipe: object, reason: string}|null}
 */
export function fallbackRecipe(descriptors, { eventType, area = null, exists } = {}) {
  const d = descriptors ?? {};
  const group = d.weaponGroup ? String(d.weaponGroup).toLowerCase() : null;
  const damage = canonicalDamageTypes(d.damageTypes);
  const energy = primaryEnergy(damage);
  const traits = (d.traits ?? []).map((t) => String(t).toLowerCase());
  const isWeapon = d.type === "weapon";
  const shape = area?.shape ?? d.area?.shape ?? null;

  switch (eventType) {
    case EVENT_TYPES.HEALING:
      return { recipe: recipe("onToken", HEALING.onToken), reason: "healing event" };

    case EVENT_TYPES.AREA_PLACED:
      if (!shape) return null;
      return {
        recipe: areaRecipe(shape, energy, d.isHealing),
        reason: `area ${shape}${energy ? `, ${energy} damage` : ""}${d.isHealing ? ", healing" : ""}`
      };

    case EVENT_TYPES.EFFECT_APPLIED:
      if (!traits.includes("aura")) return null;
      return { recipe: recipe("aura", AURA), reason: 'effect with the "aura" trait' };

    case EVENT_TYPES.ATTACK:
      break;

    default:
      return null;
  }

  // Attacks.
  const kind = d.attackKind ?? (traits.includes("thrown") ? ATTACK_KINDS.THROWN : null);
  if (kind === ATTACK_KINDS.MELEE) {
    const family = isWeapon ? naturalFamily(d) : null;
    if (family) {
      const natural = naturalAnimation(family, d, { exists });
      const extra = energy && ENERGY[energy] ? impactStage(ENERGY[energy].impact) : {};
      return { recipe: recipe("melee", natural.animation, extra), reason: natural.reason };
    }
    if (!isWeapon && energy) {
      const e = ENERGY[energy];
      return {
        recipe: recipe("melee", e.touch, impactStage(e.impact)),
        reason: `melee ${energy} attack (non-weapon)`
      };
    }
    if (group && MELEE_BY_GROUP[group]) {
      return { recipe: recipe("melee", MELEE_BY_GROUP[group]), reason: `melee weapon group "${group}"` };
    }
    const physical = damage.find((t) => MELEE_BY_DAMAGE[t]);
    if (physical) return { recipe: recipe("melee", MELEE_BY_DAMAGE[physical]), reason: `melee ${physical} damage` };
    return { recipe: recipe("melee", MELEE_DEFAULT), reason: "generic melee attack" };
  }
  if (kind === ATTACK_KINDS.THROWN) {
    const animation = (group && THROWN_BY_GROUP[group]) ?? THROWN_DEFAULT;
    return {
      recipe: recipe("ranged", animation),
      reason: group && THROWN_BY_GROUP[group] ? `thrown weapon group "${group}"` : "generic thrown attack"
    };
  }
  if (kind === ATTACK_KINDS.RANGED) {
    if (isWeapon || (group && RANGED_BY_GROUP[group])) {
      const animation = (group && RANGED_BY_GROUP[group]) ?? RANGED_DEFAULT;
      const extra = group === "bomb" ? impactStage(energy ? ENERGY[energy].burst : GENERIC.burst) : {};
      return {
        recipe: recipe("ranged", animation, extra),
        reason: group && RANGED_BY_GROUP[group] ? `ranged weapon group "${group}"` : "generic ranged weapon"
      };
    }
    const e = (energy && ENERGY[energy]) || GENERIC;
    return {
      recipe: recipe("ranged", e.projectile, impactStage(e.impact)),
      reason: energy ? `ranged ${energy} attack` : "generic ranged attack"
    };
  }
  return null;
}
