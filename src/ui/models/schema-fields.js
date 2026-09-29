/**
 * Turns a preset `optionsSchema` (api.automation.presets[id].optionsSchema)
 * into render-ready form fields, and form values back into typed options.
 *
 * The contract does not fix the schema format, so several common shapes are
 * accepted:
 *   - a plain map `{ key: descriptor }`
 *   - a JSON-Schema object `{ type: "object", properties: { key: descriptor } }`
 *   - an array `[{ key | name, ...descriptor }]`
 *   - a Foundry `SchemaField` (`.fields`) whose values are DataField instances
 * A descriptor may be:
 *   - `{ type, label|title, hint|description, default|initial, choices|enum, min|minimum, max|maximum, step, format }`
 *     with type "boolean" | "number" | "integer" | "string" | "color" | "animation" | "object" | "array"
 *     or a constructor (Boolean, Number, String, Object, Array)
 *   - a Foundry DataField (BooleanField, NumberField, StringField, ColorField, ...)
 *   - a bare default value (its JS type decides the input)
 */

/** Input kinds rendered by templates/partials/recipe-form.hbs. */
export const INPUTS = Object.freeze({
  CHECKBOX: "checkbox",
  NUMBER: "number",
  TEXT: "text",
  SELECT: "select",
  COLOR: "color",
  ANIMATION: "animation",
  JSON: "json"
});

const ANIMATION_HINT = /^(animation|file|path|jb2a)$/i;

/** Entries `[key, descriptor]` of any accepted schema shape. */
export function schemaEntries(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) {
    return schema.filter((d) => d && (d.key || d.name)).map((d) => [d.key ?? d.name, d]);
  }
  if (schema.fields && typeof schema.fields === "object" && !Array.isArray(schema.fields)) {
    return Object.entries(schema.fields);
  }
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    return Object.entries(schema.properties);
  }
  return Object.entries(schema);
}

/** Is `value` a Foundry DataField instance? (duck-typed: has `constructor.name` ending in "Field"). */
function isDataField(value) {
  return !!value && typeof value === "object" && /Field$/.test(value.constructor?.name ?? "");
}

/** Normalize select choices to [{value, label}]. */
export function normalizeChoices(choices) {
  if (!choices) return null;
  if (typeof choices === "function") choices = choices();
  if (Array.isArray(choices)) {
    return choices.map((c) =>
      c && typeof c === "object"
        ? { value: c.value ?? c.id ?? c.key, label: c.label ?? c.name ?? String(c.value) }
        : { value: c, label: String(c) }
    );
  }
  if (typeof choices === "object") {
    return Object.entries(choices).map(([value, label]) => ({
      value,
      label: typeof label === "object" ? (label?.label ?? value) : String(label)
    }));
  }
  return null;
}

/** Map a type name / constructor to an input kind. */
function inputForType(type, format, key) {
  const name = typeof type === "function" ? type.name : String(type ?? "");
  const lower = name.toLowerCase().replace(/field$/, "");
  if (String(format ?? "").toLowerCase() === "color" || lower === "color") return INPUTS.COLOR;
  if (/^(animation|jb2a|jb2a-path|dbpath)$/.test(String(format ?? "").toLowerCase()) || lower === "animation") {
    return INPUTS.ANIMATION;
  }
  if (lower === "boolean") return INPUTS.CHECKBOX;
  if (lower === "number" || lower === "integer" || lower === "alpha" || lower === "angle") return INPUTS.NUMBER;
  if (lower === "object" || lower === "array" || lower === "schema" || lower === "json") return INPUTS.JSON;
  if (lower === "filepath" && ANIMATION_HINT.test(key)) return INPUTS.ANIMATION;
  return INPUTS.TEXT;
}

/**
 * Describe one option.
 * @returns {{key: string, label: string, hint: string, input: string, default: any, choices: {value:any,label:string}[]|null, min?: number, max?: number, step?: number, integer: boolean}}
 */
export function describeOption(key, def) {
  let d;
  if (isDataField(def)) {
    const initial = typeof def.initial === "function" ? undefined : def.initial;
    d = {
      type: def.constructor.name,
      label: def.label,
      hint: def.hint,
      default: initial,
      choices: def.choices,
      min: def.min,
      max: def.max,
      step: def.step,
      integer: def.integer
    };
  } else if (def && typeof def === "object" && !Array.isArray(def)) {
    d = {
      type: def.type,
      format: def.format,
      label: def.label ?? def.title,
      hint: def.hint ?? def.description,
      default: def.default ?? def.initial,
      choices: def.choices ?? def.enum ?? def.options,
      min: def.min ?? def.minimum,
      max: def.max ?? def.maximum,
      step: def.step ?? def.multipleOf,
      integer: def.type === "integer" || def.integer === true
    };
    if (d.type === undefined && d.default !== undefined) d.type = typeof d.default;
  } else if (typeof def === "function") {
    d = { type: def };
  } else {
    d = { type: Array.isArray(def) ? "array" : typeof def, default: def };
  }
  const choices = normalizeChoices(d.choices);
  let input = choices?.length ? INPUTS.SELECT : inputForType(d.type, d.format, key);
  if (input === INPUTS.TEXT && ANIMATION_HINT.test(key)) input = INPUTS.ANIMATION;
  return {
    key,
    label: d.label || key,
    hint: d.hint ?? "",
    input,
    default: d.default,
    choices: choices?.length ? choices : null,
    min: d.min,
    max: d.max,
    step: d.step ?? (d.integer ? 1 : undefined),
    integer: !!d.integer
  };
}

/** Describe every option of a schema. */
export function describeSchema(schema) {
  return schemaEntries(schema).map(([key, def]) => describeOption(key, def));
}

/**
 * Render-ready fields for a schema and current values.
 * @param {object} schema
 * @param {object} values current option values
 * @param {{prefix?: string}} [options] prefix for input names ("recipe.options.")
 */
export function schemaToFields(schema, values = {}, { prefix = "" } = {}) {
  return describeSchema(schema).map((desc) => {
    const has = values && Object.prototype.hasOwnProperty.call(values, desc.key);
    const value = has ? values[desc.key] : desc.default;
    const field = {
      ...desc,
      name: `${prefix}${desc.key}`,
      value,
      isCheckbox: desc.input === INPUTS.CHECKBOX,
      isNumber: desc.input === INPUTS.NUMBER,
      isText: desc.input === INPUTS.TEXT,
      isSelect: desc.input === INPUTS.SELECT,
      isColor: desc.input === INPUTS.COLOR,
      isAnimation: desc.input === INPUTS.ANIMATION,
      isJson: desc.input === INPUTS.JSON,
      placeholder: desc.default === undefined || typeof desc.default === "object" ? "" : String(desc.default)
    };
    if (field.isCheckbox) field.checked = !!value;
    if (field.isJson) field.value = value === undefined ? "" : JSON.stringify(value, null, 2);
    if (field.isSelect) {
      field.value = value === undefined ? "" : String(value);
      field.options = [
        { value: "", label: "—" },
        ...desc.choices.map((c) => ({ value: String(c.value), label: c.label }))
      ];
    }
    if (field.isColor) field.colorValue = /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? value : "#ffffff";
    return field;
  });
}

/**
 * Convert one raw form value to the option's type.
 * @returns {{value: any, error: string|null}} value undefined = option not set
 */
export function coerceOption(desc, raw) {
  switch (desc.input) {
    case INPUTS.CHECKBOX:
      return { value: raw === true || raw === "true" || raw === "on", error: null };
    case INPUTS.NUMBER: {
      if (raw === "" || raw === null || raw === undefined) return { value: undefined, error: null };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { value: undefined, error: `${desc.key}: not a number` };
      return { value: desc.integer ? Math.round(n) : n, error: null };
    }
    case INPUTS.JSON: {
      const str = String(raw ?? "").trim();
      if (!str) return { value: undefined, error: null };
      try {
        return { value: JSON.parse(str), error: null };
      } catch (err) {
        return { value: undefined, error: `${desc.key}: ${err.message}` };
      }
    }
    case INPUTS.SELECT: {
      if (raw === "" || raw === undefined || raw === null) return { value: undefined, error: null };
      const match = desc.choices?.find((c) => String(c.value) === String(raw));
      return { value: match ? match.value : raw, error: null };
    }
    default: {
      const str = String(raw ?? "").trim();
      return { value: str === "" ? undefined : str, error: null };
    }
  }
}

/**
 * Typed options from raw form values (keyed by option key, without prefix).
 * Keys missing from `raw` are left out; checkboxes always yield a boolean.
 * @returns {{options: object, errors: string[]}}
 */
export function fieldsToOptions(schema, raw = {}) {
  const options = {};
  const errors = [];
  for (const desc of describeSchema(schema)) {
    if (!Object.prototype.hasOwnProperty.call(raw, desc.key)) continue;
    const { value, error } = coerceOption(desc, raw[desc.key]);
    if (error) errors.push(error);
    if (value !== undefined) options[desc.key] = value;
  }
  return { options, errors };
}
