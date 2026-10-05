/**
 * Default sounds for recipes that have none (#sounds): attacks by weapon family, criticals, misses, magic by
 * energy type, healing and buffs. Pure: the automation core passes the sound folder and the event in.
 *
 * With the SoundFx Library module installed (`modules/soundfxlibrary`), names it covers play one of its recordings
 * (LIBRARY_SOUNDS). The rest are `<folder>/<name>.wav`, the bank shipped in `sounds/` (tools/generate-sounds.py).
 * A GM can point the "Sound folder" setting at another folder with the same names; that folder then wins.
 */
import { ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../shared/events.js";
import { canonicalDamageTypes, naturalFamily, primaryEnergy } from "./fallback.js";

export const SETTING_SOUNDS = "soundsEnabled";
export const SETTING_SOUND_FOLDER = "soundFolder";
export const DEFAULT_SOUND_FOLDER = "modules/sargas-visual-automation/sounds";
export const DEFAULT_VOLUME = 0.6;
export const SOUND_LIBRARY_ID = "soundfxlibrary";
export const SOUND_LIBRARY_FOLDER = `modules/${SOUND_LIBRARY_ID}`;

const numbered = (dir, name, ns) => ns.map((n) => `${dir}/${name}-${n}.mp3`);
const meleeHit = (...ns) => numbered("Combat/Single/Melee Hit", "melee-hit", ns);
const shieldHit = (...ns) => numbered("Combat/Single/Shield Hit", "shield-hit", ns);
const arrowFlyBy = numbered("Combat/Single/Arrow Fly-By", "arrow-fly-by", [1, 2, 3]);
const arrowImpact = numbered("Combat/Single/Arrow Impact", "arrow-impact", [1, 2, 3, 4, 5]);
const spellImpact = (...ns) => numbered("Combat/Single/Spell Impact", "spell-impact", ns);
const growl = (...ns) => numbered("Creatures/Monsters/Growl", "growl", ns);
const throwHit = ["Combat/Single/Throw Hit/throw-hit-1.mp3"];

/**
 * SoundFx Library recordings per sound name (paths inside the library; one is picked at random). Names missing
 * here have no fitting recording (unarmed, firearm, most energies, healing, buff) and use the sound folder.
 */
export const LIBRARY_SOUNDS = Object.freeze({
  "melee-slash": meleeHit(4, 5, 6, 10, 11), // axe, slash, sword on flesh
  "crit-melee-slash": meleeHit(1, 2, 3), // axe impacts, gore
  "melee-pierce": meleeHit(8, 9), // spear hits
  "crit-melee-pierce": meleeHit(12), // sword impale
  "melee-blunt": [...shieldHit(12), "Misc/Single/Impact/impact-4.mp3"], // shield slam, cart impact
  "crit-melee-blunt": shieldHit(11), // shield bash
  bite: growl(1, 2),
  "crit-bite": growl(3),
  claw: meleeHit(6),
  "crit-claw": meleeHit(1),
  bow: arrowFlyBy,
  "crit-bow": arrowImpact,
  crossbow: arrowFlyBy,
  "crit-crossbow": arrowImpact,
  throw: throwHit,
  "crit-throw": throwHit,
  miss: ["Combat/Single/Melee Miss/melee-miss-1.mp3"],
  magic: numbered("Combat/Single/Spell Whoosh", "spell-whoosh", [1, 2, 3, 4]),
  "crit-magic": spellImpact(1),
  "magic-fire": spellImpact(1, 3, 5),
  "magic-electricity": numbered("Combat/Single/Spell Impact Lightning", "spell-impact-lightning", [1, 2, 3, 4])
});

/** Energies with their own magic sound; others use the generic "magic". */
const MAGIC_ENERGIES = new Set([
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
]);
/** Attack sounds that have a "crit-" variant. */
const CRIT_BASES = new Set([
  "melee-slash",
  "melee-pierce",
  "melee-blunt",
  "unarmed",
  "bite",
  "claw",
  "bow",
  "crossbow",
  "firearm",
  "throw",
  "magic"
]);
const MELEE_BY_DAMAGE = { slashing: "melee-slash", piercing: "melee-pierce", bludgeoning: "melee-blunt" };
const MELEE_BY_GROUP = {
  sword: "melee-slash",
  axe: "melee-slash",
  knife: "melee-pierce",
  dagger: "melee-pierce",
  spear: "melee-pierce",
  polearm: "melee-slash",
  pick: "melee-pierce",
  club: "melee-blunt",
  mace: "melee-blunt",
  flail: "melee-blunt",
  hammer: "melee-blunt",
  shield: "melee-blunt",
  brawling: "unarmed",
  unarmed: "unarmed"
};
const RANGED_BY_GROUP = {
  bow: "bow",
  crossbow: "crossbow",
  firearm: "firearm",
  sling: "throw",
  dart: "throw",
  bomb: "throw"
};

/** Every sound name the selection can produce (for tests and the bank generator). */
export const SOUND_NAMES = Object.freeze([
  ...CRIT_BASES,
  ...[...CRIT_BASES].map((b) => `crit-${b}`),
  "miss",
  ...[...MAGIC_ENERGIES].map((e) => `magic-${e}`),
  "healing",
  "buff"
]);

function magicName(descriptors) {
  const energy = primaryEnergy(descriptors?.damageTypes);
  return energy && MAGIC_ENERGIES.has(energy) ? `magic-${energy}` : "magic";
}

/**
 * Name of the default sound for an item on an event (without folder or extension), or null.
 * @param {import("../shared/events.js").ItemDescriptors|null} descriptors
 * @param {{eventType?: string, outcome?: string}} [opts]
 */
export function soundName(descriptors, { eventType, outcome } = {}) {
  const d = descriptors ?? {};
  const isWeapon = d.type === "weapon";
  const traits = (d.traits ?? []).map((t) => String(t).toLowerCase());
  const group = d.weaponGroup ? String(d.weaponGroup).toLowerCase() : null;
  switch (eventType) {
    case EVENT_TYPES.HEALING:
      return "healing";
    case EVENT_TYPES.EFFECT_APPLIED:
      return d.type === "effect" || traits.includes("aura") ? "buff" : null;
    case EVENT_TYPES.AREA_PLACED:
    case EVENT_TYPES.CAST:
    case EVENT_TYPES.SAVE:
      return d.isHealing ? "healing" : magicName(d);
    case EVENT_TYPES.ATTACK:
    case EVENT_TYPES.DAMAGE:
      break;
    default:
      return null;
  }
  const kind = d.attackKind ?? (traits.includes("thrown") ? ATTACK_KINDS.THROWN : null);
  const miss = outcome === OUTCOMES.FAILURE || outcome === OUTCOMES.CRITICAL_FAILURE;
  let base;
  if (kind === ATTACK_KINDS.MELEE) {
    if (!isWeapon) base = magicName(d);
    else {
      const family = naturalFamily(d);
      if (family === "bite") base = "bite";
      else if (family === "claw" || family === "sting") base = family === "claw" ? "claw" : "melee-pierce";
      else if (family === "slam") base = "melee-blunt";
      else if (group && MELEE_BY_GROUP[group]) base = MELEE_BY_GROUP[group];
      else base = MELEE_BY_DAMAGE[canonicalDamageTypes(d.damageTypes).find((t) => MELEE_BY_DAMAGE[t])] ?? "melee-slash";
    }
  } else if (kind === ATTACK_KINDS.THROWN) base = "throw";
  else if (kind === ATTACK_KINDS.RANGED) base = isWeapon ? (RANGED_BY_GROUP[group] ?? "bow") : magicName(d);
  else return null;
  if (miss) return kind === ATTACK_KINDS.MELEE || kind === ATTACK_KINDS.THROWN ? "miss" : base;
  if (outcome === OUTCOMES.CRITICAL_SUCCESS && CRIT_BASES.has(base)) return `crit-${base}`;
  return base;
}

/**
 * `{ file, volume }` for a sound name: a SoundFx Library recording when `library` is on and has one, else
 * `<folder>/<name>.wav`.
 * @param {string|null} name
 * @param {string} [folder]
 * @param {number} [volume]
 * @param {{library?: boolean, random?: () => number}} [opts]
 */
export function soundFile(
  name,
  folder = DEFAULT_SOUND_FOLDER,
  volume = DEFAULT_VOLUME,
  { library = false, random = Math.random } = {}
) {
  if (!name) return null;
  const variants = library ? LIBRARY_SOUNDS[name] : null;
  if (variants?.length) {
    const pick = variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))];
    return { file: `${SOUND_LIBRARY_FOLDER}/${encodeURI(pick)}`, volume };
  }
  const base = String(folder ?? DEFAULT_SOUND_FOLDER).replace(/\/+$/, "");
  return { file: `${base}/${name}.wav`, volume };
}

/**
 * The recipe with default sounds filled in where it has none: `sound` for the event's outcome and, when the
 * recipe has no outcome-specific sound, `outcomes.criticalSuccess.sound` / `outcomes.failure.sound` so a critical
 * or a miss of the same event sounds different. A recipe with its own `sound` is left alone; `sound: null`
 * explicitly keeps it silent.
 * @param {object} recipe  Normalized recipe.
 * @param {object} event   AutomationEvent (descriptors, type, outcome).
 * @param {{folder?: string, volume?: number, library?: boolean, random?: () => number}} [opts]
 */
export function withDefaultSound(recipe, event, { folder, volume, library, random } = {}) {
  const pick = { library, random };
  if (!recipe || recipe.sound !== undefined) return recipe;
  const d = event?.descriptors ?? null;
  const eventType = event?.type;
  const base = soundName(d, { eventType, outcome: OUTCOMES.SUCCESS });
  if (!base) return recipe;
  const out = { ...recipe, sound: soundFile(base, folder, volume, pick) };
  const outcomes = { ...(recipe.outcomes ?? {}) };
  for (const outcome of [OUTCOMES.CRITICAL_SUCCESS, OUTCOMES.FAILURE]) {
    const name = soundName(d, { eventType, outcome });
    if (!name || name === base || outcomes[outcome]?.sound !== undefined) continue;
    outcomes[outcome] = { ...(outcomes[outcome] ?? {}), sound: soundFile(name, folder, volume, pick) };
  }
  if (Object.keys(outcomes).length) out.outcomes = outcomes;
  return out;
}
