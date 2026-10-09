/**
 * Recipe ↔ form conversion for the item recipe editor (#37) and the rules
 * manager (#38). Pure: presets are passed in (api.automation.presets).
 *
 * Form input names (all under `recipe.`):
 *   recipe.preset, recipe.animation,
 *   recipe.options.<key>            one per preset optionsSchema entry
 *   recipe.optionsExtra             JSON for options outside the schema
 *   recipe.stages.<stage>.animation / .options (JSON)
 *   recipe.outcomes.<outcome>.animation / .options (JSON)
 *   recipe.sound.file / .volume / .delay
 *   recipe.triggers.<eventType>     checkboxes
 */
import { EVENT_TYPES, OUTCOMES } from "../../shared/events.js";
import { cloneJson, compact, expandFlat, isEmptyValue, parseJsonText, toJsonText } from "./form-utils.js";
import { describeSchema, fieldsToOptions, schemaToFields } from "./schema-fields.js";

export const RECIPE_VERSION = 1;
export const FALLBACK_PRESETS = ["melee", "ranged", "onToken", "area", "aura", "teleport"];
export const STAGES = ["cast", "projectile", "impact", "onSource", "onTarget"];
export const OUTCOME_KEYS = [OUTCOMES.CRITICAL_SUCCESS, OUTCOMES.SUCCESS, OUTCOMES.FAILURE, OUTCOMES.CRITICAL_FAILURE];
/** Event types a recipe can be triggered by (effectRemoved only ends auras). */
export const TRIGGERS = Object.values(EVENT_TYPES).filter((t) => t !== EVENT_TYPES.EFFECT_REMOVED);

const PREFIX = "recipe.";

/** Select options for the preset dropdown. */
export function presetChoices(presets, selected) {
  const entries = presets && typeof presets === "object" ? Object.entries(presets) : [];
  const list = entries.length
    ? entries.map(([id, p]) => ({ value: id, label: p?.label ?? id }))
    : FALLBACK_PRESETS.map((id) => ({ value: id, label: id }));
  if (selected && !list.some((c) => c.value === selected)) list.push({ value: selected, label: selected });
  return list;
}

/** Stage names a preset uses (array or object form); unknown → []. */
export function presetStages(preset) {
  const stages = preset?.stages;
  if (Array.isArray(stages)) return stages.map((s) => (typeof s === "string" ? s : (s?.id ?? s?.key))).filter(Boolean);
  if (stages && typeof stages === "object") return Object.keys(stages);
  return [];
}

/** A new, empty recipe for the first preset. */
export function emptyRecipe(presets) {
  return { version: RECIPE_VERSION, preset: presetChoices(presets)[0].value, animation: "", options: {} };
}

/**
 * Build the template model for a recipe.
 * @param {object|null} recipe
 * @param {{presets?: object}} [options]
 */
export function recipeToFormModel(recipe, { presets } = {}) {
  const r = recipe ?? emptyRecipe(presets);
  const preset = presets?.[r.preset] ?? null;
  const schema = preset?.optionsSchema;
  const schemaKeys = new Set(describeSchema(schema).map((d) => d.key));
  const extra = Object.fromEntries(Object.entries(r.options ?? {}).filter(([k]) => !schemaKeys.has(k)));

  const stageNames = [...new Set([...presetStages(preset), ...Object.keys(r.stages ?? {})])];
  const stageList = stageNames.length ? stageNames : STAGES;
  const triggers = new Set(r.triggers ?? []);

  return {
    prefix: PREFIX,
    preset: r.preset ?? "",
    presetOptions: presetChoices(presets, r.preset),
    presetHint: preset?.hint ?? preset?.description ?? "",
    animation: r.animation ?? "",
    optionFields: schemaToFields(schema, r.options ?? {}, { prefix: `${PREFIX}options.` }),
    optionsExtra: toJsonText(extra),
    stages: stageList.map((key) => ({
      key,
      labelKey: `SVA.UI.Recipe.Stages.${key}`,
      animation: r.stages?.[key]?.animation ?? "",
      options: toJsonText(r.stages?.[key]?.options),
      inPreset: presetStages(preset).includes(key)
    })),
    outcomes: OUTCOME_KEYS.map((key) => ({
      key,
      labelKey: `SVA.UI.Recipe.Outcomes.${key}`,
      animation: r.outcomes?.[key]?.animation ?? "",
      options: toJsonText(r.outcomes?.[key]?.options),
      active: !isEmptyValue(r.outcomes?.[key])
    })),
    stagesSet: Object.values(r.stages ?? {}).filter((s) => !isEmptyValue(s)).length,
    outcomesSet: OUTCOME_KEYS.filter((k) => !isEmptyValue(r.outcomes?.[k])).length,
    sound: { file: r.sound?.file ?? "", volume: r.sound?.volume ?? "", delay: r.sound?.delay ?? "" },
    triggers: TRIGGERS.map((key) => ({ key, labelKey: `SVA.UI.Recipe.Triggers.${key}`, checked: triggers.has(key) }))
  };
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a recipe from flat form values (keys starting with `recipe.`; other keys are ignored).
 * Fields the form does not know about (on `base` and its outcome overrides) are preserved.
 * @param {object} flat  e.g. readFormElements(form.elements)
 * @param {{presets?: object, base?: object|null}} [options]
 * @returns {{recipe: object, errors: string[]}}
 */
export function formToRecipe(flat, { presets, base = null } = {}) {
  const scoped = Object.fromEntries(
    Object.entries(flat ?? {})
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), v])
  );
  const data = expandFlat(scoped);
  const errors = [];
  const recipe = { ...(cloneJson(base) ?? {}), version: RECIPE_VERSION };

  recipe.preset = String(data.preset ?? recipe.preset ?? presetChoices(presets)[0].value);
  const animation = String(data.animation ?? "").trim();
  if (animation) recipe.animation = animation;
  else delete recipe.animation;

  // Options: typed schema fields + free JSON for the rest.
  const schema = presets?.[recipe.preset]?.optionsSchema;
  const typed = fieldsToOptions(schema, data.options ?? {});
  errors.push(...typed.errors);
  const extra = parseJsonText(data.optionsExtra);
  if (extra.error) errors.push(`options: ${extra.error}`);
  else if (extra.value !== undefined && (typeof extra.value !== "object" || Array.isArray(extra.value))) {
    errors.push("options: must be a JSON object");
  }
  const extraObj = extra.value && typeof extra.value === "object" && !Array.isArray(extra.value) ? extra.value : {};
  recipe.options = { ...extraObj, ...typed.options };

  // Stages.
  const stages = {};
  for (const [key, stage] of Object.entries(data.stages ?? {})) {
    const opts = parseJsonText(stage?.options);
    if (opts.error) errors.push(`stages.${key}: ${opts.error}`);
    const entry = compact({ animation: String(stage?.animation ?? "").trim(), options: opts.value });
    if (!isEmptyValue(entry)) stages[key] = entry;
  }
  if (isEmptyValue(stages)) delete recipe.stages;
  else recipe.stages = stages;

  // Per-outcome overrides (partial recipes); keep override fields the form doesn't edit.
  const outcomes = {};
  for (const key of OUTCOME_KEYS) {
    const form = data.outcomes?.[key];
    const previous = { ...(base?.outcomes?.[key] ?? {}) };
    delete previous.animation;
    delete previous.options;
    const opts = parseJsonText(form?.options);
    if (opts.error) errors.push(`outcomes.${key}: ${opts.error}`);
    const entry = {
      ...cloneJson(previous),
      ...compact({ animation: String(form?.animation ?? "").trim(), options: opts.value })
    };
    if (!isEmptyValue(entry)) outcomes[key] = entry;
  }
  if (isEmptyValue(outcomes)) delete recipe.outcomes;
  else recipe.outcomes = outcomes;

  // Sound.
  const file = String(data.sound?.file ?? "").trim();
  if (file) recipe.sound = compact({ file, volume: toNumber(data.sound?.volume), delay: toNumber(data.sound?.delay) });
  else delete recipe.sound;

  // Triggers (none checked = preset default).
  if (data.triggers && typeof data.triggers === "object") {
    const triggers = TRIGGERS.filter((t) => data.triggers[t] === true);
    if (triggers.length) recipe.triggers = triggers;
    else delete recipe.triggers;
  }

  return { recipe, errors };
}

/**
 * Live check of a JSON textarea (`.sva-json`): "" when empty or valid, else the error.
 * @param {string} text
 * @param {{object?: boolean}} [options]  object: the value must be a JSON object
 * @returns {string|null} error message, or null when valid
 */
export function jsonFieldError(text, { object = false } = {}) {
  const { value, error } = parseJsonText(text);
  if (error) return error;
  if (object && value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    return "must be a JSON object";
  }
  return null;
}
