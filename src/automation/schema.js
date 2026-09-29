/**
 * Recipe / Rule / RulePack schema: validation, normalization and versioned
 * migrations. Pure functions - no Foundry access.
 *
 * Recipe = {
 *   version: 1,
 *   preset: "melee" | "ranged" | "onToken" | "area" | "aura" | "teleport",
 *   animation: "jb2a.…",
 *   options?: {…},
 *   stages?: { cast?, projectile?, impact?, onSource?, onTarget? },   // { animation, options } | null (disabled)
 *   outcomes?: { criticalSuccess?, success?, failure?, criticalFailure? }, // partial recipe overrides
 *   sound?: { file, volume?, delay? },
 *   triggers?: EVENT_TYPES[]
 * }
 */
import { EVENT_TYPES, OUTCOMES } from "../shared/events.js";

export const RECIPE_VERSION = 1;
export const RULEPACK_VERSION = 1;

export const PRESET_IDS = Object.freeze(["melee", "ranged", "onToken", "area", "aura", "teleport"]);
export const STAGE_IDS = Object.freeze(["cast", "projectile", "impact", "onSource", "onTarget"]);
export const OUTCOME_KEYS = Object.freeze([
  OUTCOMES.CRITICAL_SUCCESS,
  OUTCOMES.SUCCESS,
  OUTCOMES.FAILURE,
  OUTCOMES.CRITICAL_FAILURE
]);

/** Friendly aliases accepted in `outcomes` and rewritten to the canonical keys. */
export const OUTCOME_ALIASES = Object.freeze({
  hit: OUTCOMES.SUCCESS,
  miss: OUTCOMES.FAILURE,
  crit: OUTCOMES.CRITICAL_SUCCESS,
  critical: OUTCOMES.CRITICAL_SUCCESS,
  fumble: OUTCOMES.CRITICAL_FAILURE,
  criticalMiss: OUTCOMES.CRITICAL_FAILURE
});

export const MATCH_KEYS = Object.freeze(["key", "name", "regex", "type", "traits", "attackKind", "weaponGroup"]);

const RECIPE_KEYS = new Set([
  "version",
  "preset",
  "animation",
  "options",
  "stages",
  "outcomes",
  "sound",
  "triggers",
  "label"
]);
const OVERRIDE_KEYS = new Set(["animation", "options", "stages", "sound"]);
const EVENT_TYPE_VALUES = new Set(Object.values(EVENT_TYPES));

export class RecipeError extends Error {
  constructor(message, errors = []) {
    super(errors.length ? `${message}: ${errors.join("; ")}` : message);
    this.name = "RecipeError";
    this.errors = errors;
  }
}

export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/* ------------------------------------------------------------------------ */
/*  Migrations                                                              */
/* ------------------------------------------------------------------------ */

/** fromVersion → fn(recipe) returning the recipe at fromVersion + 1. */
const migrations = new Map([
  // v0 (unversioned drafts) → v1: only stamps the version.
  [0, (recipe) => ({ ...recipe, version: 1 })]
]);

/**
 * Register a migration step (used when RECIPE_VERSION is bumped).
 * @param {number} fromVersion
 * @param {(recipe: object) => object} fn
 */
export function registerRecipeMigration(fromVersion, fn) {
  migrations.set(fromVersion, fn);
}

/** Bring a recipe up to RECIPE_VERSION. Returns a new object; never mutates. */
export function migrateRecipe(recipe) {
  if (!isPlainObject(recipe)) return recipe;
  let out = clone(recipe);
  let version = Number.isInteger(out.version) ? out.version : 0;
  while (version < RECIPE_VERSION) {
    const step = migrations.get(version);
    if (!step) throw new RecipeError(`No recipe migration from version ${version}`);
    out = step(out);
    version = out.version;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Validation                                                              */
/* ------------------------------------------------------------------------ */

function validateStage(stage, path, errors) {
  if (stage === null || stage === false) return; // explicitly disabled
  if (!isPlainObject(stage)) return void errors.push(`${path} must be an object or null`);
  if (stage.animation !== undefined && !isNonEmptyString(stage.animation)) {
    errors.push(`${path}.animation must be a non-empty string`);
  }
  if (stage.options !== undefined && !isPlainObject(stage.options)) errors.push(`${path}.options must be an object`);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateParts(recipe, path, errors) {
  if (recipe.animation !== undefined && recipe.animation !== null && !isNonEmptyString(recipe.animation)) {
    errors.push(`${path}animation must be a non-empty string`);
  }
  if (recipe.options !== undefined && !isPlainObject(recipe.options)) errors.push(`${path}options must be an object`);
  if (recipe.stages !== undefined) {
    if (!isPlainObject(recipe.stages)) errors.push(`${path}stages must be an object`);
    else {
      for (const [id, stage] of Object.entries(recipe.stages)) {
        if (!STAGE_IDS.includes(id)) errors.push(`${path}stages.${id} is not a known stage (${STAGE_IDS.join(", ")})`);
        else validateStage(stage, `${path}stages.${id}`, errors);
      }
    }
  }
  if (recipe.sound !== undefined && recipe.sound !== null) {
    const s = recipe.sound;
    if (!isPlainObject(s) || !isNonEmptyString(s.file)) errors.push(`${path}sound.file must be a non-empty string`);
    else {
      if (s.volume !== undefined && !(typeof s.volume === "number" && s.volume >= 0 && s.volume <= 1)) {
        errors.push(`${path}sound.volume must be a number between 0 and 1`);
      }
      if (s.delay !== undefined && typeof s.delay !== "number") errors.push(`${path}sound.delay must be a number`);
    }
  }
}

/**
 * Validate a (migrated) recipe.
 * @returns {string[]} list of problems, empty when valid.
 */
export function validateRecipe(recipe) {
  const errors = [];
  if (!isPlainObject(recipe)) return ["recipe must be an object"];
  if (recipe.version !== RECIPE_VERSION) errors.push(`version must be ${RECIPE_VERSION}`);
  if (!PRESET_IDS.includes(recipe.preset)) errors.push(`preset must be one of ${PRESET_IDS.join(", ")}`);
  for (const key of Object.keys(recipe)) if (!RECIPE_KEYS.has(key)) errors.push(`unknown property "${key}"`);
  validateParts(recipe, "", errors);
  const stageAnimation = Object.values(recipe.stages ?? {}).some((s) => isNonEmptyString(s?.animation));
  if (!isNonEmptyString(recipe.animation) && !stageAnimation) {
    errors.push("animation is required (or at least one stage animation)");
  }
  if (recipe.outcomes !== undefined) {
    if (!isPlainObject(recipe.outcomes)) errors.push("outcomes must be an object");
    else {
      for (const [key, override] of Object.entries(recipe.outcomes)) {
        const path = `outcomes.${key}.`;
        if (!OUTCOME_KEYS.includes(key))
          errors.push(`outcomes.${key} is not a known outcome (${OUTCOME_KEYS.join(", ")})`);
        else if (!isPlainObject(override)) errors.push(`outcomes.${key} must be an object`);
        else {
          for (const k of Object.keys(override))
            if (!OVERRIDE_KEYS.has(k)) errors.push(`${path}${k} cannot be overridden`);
          validateParts(override, path, errors);
        }
      }
    }
  }
  if (recipe.triggers !== undefined) {
    if (!Array.isArray(recipe.triggers)) errors.push("triggers must be an array");
    else {
      for (const t of recipe.triggers) if (!EVENT_TYPE_VALUES.has(t)) errors.push(`unknown trigger "${t}"`);
    }
  }
  return errors;
}

/**
 * Migrate, rewrite outcome aliases, and validate. Throws RecipeError when invalid.
 * @returns {object} a normalized copy.
 */
export function normalizeRecipe(recipe) {
  if (!isPlainObject(recipe)) throw new RecipeError("Invalid recipe", ["recipe must be an object"]);
  const out = migrateRecipe(recipe);
  if (isPlainObject(out.outcomes)) {
    const outcomes = {};
    for (const [key, value] of Object.entries(out.outcomes)) outcomes[OUTCOME_ALIASES[key] ?? key] = value;
    out.outcomes = outcomes;
  }
  const errors = validateRecipe(out);
  if (errors.length) throw new RecipeError("Invalid recipe", errors);
  return out;
}

/** Non-throwing variant: returns `{ recipe, errors }`. */
export function checkRecipe(recipe) {
  try {
    return { recipe: normalizeRecipe(recipe), errors: [] };
  } catch (err) {
    return { recipe: null, errors: err.errors?.length ? err.errors : [err.message] };
  }
}

/* ------------------------------------------------------------------------ */
/*  Rules and rule packs                                                    */
/* ------------------------------------------------------------------------ */

const isStringOrList = (v) =>
  isNonEmptyString(v) || (Array.isArray(v) && v.length > 0 && v.every((x) => isNonEmptyString(x)));

/** @returns {string[]} */
export function validateRule(rule) {
  const errors = [];
  if (!isPlainObject(rule)) return ["rule must be an object"];
  if (!isNonEmptyString(rule.id)) errors.push("id must be a non-empty string");
  if (rule.label !== undefined && typeof rule.label !== "string") errors.push("label must be a string");
  if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") errors.push("enabled must be a boolean");
  if (rule.priority !== undefined && !Number.isFinite(rule.priority)) errors.push("priority must be a number");
  if (!isPlainObject(rule.match)) errors.push("match must be an object");
  else {
    const keys = Object.keys(rule.match);
    if (!keys.some((k) => MATCH_KEYS.includes(k))) errors.push(`match needs at least one of ${MATCH_KEYS.join(", ")}`);
    for (const key of keys) {
      const value = rule.match[key];
      if (!MATCH_KEYS.includes(key)) errors.push(`match.${key} is not a known criterion`);
      else if (key === "regex") {
        const pattern = isPlainObject(value) ? value.pattern : value;
        const flags = isPlainObject(value) ? (value.flags ?? "i") : "i";
        try {
          new RegExp(pattern, flags);
          if (!isNonEmptyString(pattern)) throw new Error("empty");
        } catch {
          errors.push("match.regex must be a valid regular expression");
        }
      } else if (!isStringOrList(value)) errors.push(`match.${key} must be a string or a list of strings`);
    }
  }
  const { errors: recipeErrors } = checkRecipe(rule.recipe);
  errors.push(...recipeErrors.map((e) => `recipe: ${e}`));
  return errors;
}

/** Normalize a rule (defaults + normalized recipe). Throws RecipeError when invalid. */
export function normalizeRule(rule) {
  const errors = validateRule(rule);
  if (errors.length) throw new RecipeError(`Invalid rule "${rule?.id ?? "?"}"`, errors);
  return {
    id: rule.id,
    label: rule.label ?? rule.id,
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 0,
    match: clone(rule.match),
    recipe: normalizeRecipe(rule.recipe)
  };
}

/**
 * Validate a rule pack. Invalid rules are reported but do not invalidate the
 * pack; `rules` contains only the normalized valid ones.
 * @returns {{ pack: {system: string, version: number, rules: object[]}|null, errors: string[] }}
 */
export function checkRulePack(pack) {
  if (!isPlainObject(pack)) return { pack: null, errors: ["rule pack must be an object"] };
  const errors = [];
  if (!isNonEmptyString(pack.system)) errors.push("system must be a non-empty string");
  if (pack.version !== RULEPACK_VERSION) errors.push(`version must be ${RULEPACK_VERSION}`);
  if (!Array.isArray(pack.rules)) errors.push("rules must be an array");
  if (errors.length) return { pack: null, errors };
  const rules = [];
  const seen = new Set();
  pack.rules.forEach((rule, i) => {
    try {
      const normalized = normalizeRule(rule);
      if (seen.has(normalized.id)) throw new RecipeError(`Duplicate rule id "${normalized.id}"`);
      seen.add(normalized.id);
      rules.push(normalized);
    } catch (err) {
      errors.push(`rules[${i}]: ${err.message}`);
    }
  });
  return { pack: { system: pack.system, version: pack.version, rules }, errors };
}
