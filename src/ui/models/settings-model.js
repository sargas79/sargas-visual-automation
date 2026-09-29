/**
 * Pure helpers for the grouped settings panel (#39). Settings are read
 * dynamically from `game.settings.settings` (Map "namespace.key" → config),
 * so settings registered by any area show up without changes here.
 *
 * Grouping: a config may name its group explicitly with `svaGroup`
 * (one of GROUPS); otherwise it is inferred from scope and key.
 */

export const GROUPS = ["general", "automation", "performance", "permissions", "systems", "client"];

const GROUP_RULES = [
  ["permissions", /role|permission|trigger|gmOnly|players?/i],
  ["performance", /max|limit|performance|preload|quality|cache|fps|resolution|concurren|budget/i],
  ["systems", /pack|system|adapter|rulePack/i],
  ["automation", /^automation|rule/i]
];

/** Settings of the scalar types the panel can edit. */
const EDITABLE = new Set(["boolean", "number", "string"]);

/** Normalized type name of a setting config ("boolean" | "number" | "string" | "object" | ...). */
export function settingType(config) {
  const type = config?.type;
  if (!type) return "string";
  if (typeof type === "function") {
    if (type === Boolean) return "boolean";
    if (type === Number) return "number";
    if (type === String) return "string";
    return (type.name ?? "object").toLowerCase().replace(/field$/, "") || "object";
  }
  // A DataField instance.
  const name = (type.constructor?.name ?? "").toLowerCase().replace(/field$/, "");
  if (name === "boolean" || name === "number" || name === "string") return name;
  if (name === "alpha" || name === "angle") return "number";
  if (name === "color" || name === "filepath") return "string";
  return name || "object";
}

/** Group id for a setting. */
export function groupFor(config) {
  if (GROUPS.includes(config?.svaGroup)) return config.svaGroup;
  if (config?.scope === "client" || config?.scope === "user") return "client";
  const key = String(config?.key ?? "");
  for (const [group, re] of GROUP_RULES) if (re.test(key)) return group;
  return "general";
}

/**
 * Settings of a module that the current user may edit in the panel.
 * @param {Map<string, object>|Iterable<[string, object]>} settings  game.settings.settings
 * @param {{moduleId: string, isGM?: boolean}} options
 * @returns {object[]} configs with `key`/`namespace` filled in
 */
export function collectModuleSettings(settings, { moduleId, isGM = false }) {
  const out = [];
  for (const [id, config] of settings ?? []) {
    const dot = id.indexOf(".");
    const namespace = config?.namespace ?? id.slice(0, dot);
    const key = config?.key ?? id.slice(dot + 1);
    if (namespace !== moduleId || !config) continue;
    if (config.config === false || config.config === undefined) continue;
    if (config.scope === "world" && !isGM) continue;
    if (config.restricted && !isGM) continue;
    const type = settingType(config);
    if (!EDITABLE.has(type) && !config.choices) continue;
    out.push({ ...config, namespace, key, id: `${namespace}.${key}`, valueType: type });
  }
  return out;
}

/**
 * Render-ready field for one setting.
 * @param {object} setting a collectModuleSettings() entry
 * @param {any} value current value
 */
export function settingField(setting, value) {
  const type = setting.valueType ?? settingType(setting);
  const choices = setting.choices
    ? Object.entries(typeof setting.choices === "function" ? setting.choices() : setting.choices).map(([v, label]) => ({
        value: v,
        label: String(label)
      }))
    : null;
  const range = setting.range ?? (setting.type?.min !== undefined ? setting.type : null);
  const input = choices
    ? "select"
    : type === "boolean"
      ? "checkbox"
      : type === "number"
        ? range
          ? "range"
          : "number"
        : "text";
  return {
    id: setting.id,
    key: setting.key,
    name: setting.name || setting.key,
    hint: setting.hint ?? "",
    scope: setting.scope ?? "client",
    scopeKey: setting.scope === "world" ? "SVA.UI.SettingsPanel.ScopeWorld" : "SVA.UI.SettingsPanel.ScopeClient",
    requiresReload: !!setting.requiresReload,
    valueType: type,
    input,
    isCheckbox: input === "checkbox",
    isNumber: input === "number",
    isRange: input === "range",
    isSelect: input === "select",
    isText: input === "text",
    value: input === "select" ? String(value ?? "") : (value ?? ""),
    checked: input === "checkbox" ? !!value : undefined,
    options: choices,
    min: range?.min,
    max: range?.max,
    step: range?.step ?? (type === "number" ? "any" : undefined)
  };
}

/**
 * Group fields for the template, in GROUPS order, skipping empty groups.
 * @returns {{id: string, labelKey: string, hintKey: string, fields: object[]}[]}
 */
export function groupFields(settings, getValue) {
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const setting of settings) {
    let value;
    try {
      value = getValue(setting);
    } catch {
      value = setting.default;
    }
    groups.get(groupFor(setting)).push(settingField(setting, value));
  }
  return [...groups]
    .filter(([, fields]) => fields.length)
    .map(([id, fields]) => ({
      id,
      labelKey: `SVA.UI.SettingsPanel.Groups.${id}`,
      hintKey: `SVA.UI.SettingsPanel.Groups.${id}Hint`,
      fields
    }));
}

/** Convert a raw form value to the setting's type (undefined = invalid, skip). */
export function coerceSettingValue(setting, raw) {
  const type = setting.valueType ?? settingType(setting);
  if (type === "boolean") return raw === true || raw === "true" || raw === "on";
  if (type === "number") {
    if (raw === "" || raw === null || raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return raw === undefined || raw === null ? "" : String(raw);
}

/**
 * Changed settings between current values and the submitted form.
 * @param {object[]} settings collectModuleSettings() entries
 * @param {object} flat form values keyed by setting id ("module.key")
 * @param {(setting: object) => any} getValue current value
 * @returns {{setting: object, value: any}[]}
 */
export function diffSettings(settings, flat, getValue) {
  const changes = [];
  for (const setting of settings) {
    if (!Object.prototype.hasOwnProperty.call(flat, setting.id)) continue;
    const value = coerceSettingValue(setting, flat[setting.id]);
    if (value === undefined) continue;
    let current;
    try {
      current = getValue(setting);
    } catch {
      current = undefined;
    }
    if (value !== current) changes.push({ setting, value });
  }
  return changes;
}

/**
 * Add a tool to a v13+/v14 scene control (controls and tools are records).
 * Falls back to the legacy array shape. Returns true when added.
 * @param {object|object[]} controls argument of the getSceneControlButtons hook
 * @param {string} controlName e.g. "tokens"
 * @param {object} tool SceneControlTool
 */
export function addSceneControlTool(controls, controlName, tool) {
  const control = Array.isArray(controls)
    ? controls.find((c) => c.name === controlName)
    : (controls?.[controlName] ?? null);
  if (!control) return false;
  if (Array.isArray(control.tools)) {
    control.tools.push(tool);
    return true;
  }
  control.tools ??= {};
  const order = Object.values(control.tools).reduce((max, t) => Math.max(max, t?.order ?? 0), 0);
  control.tools[tool.name] = { order: order + 1, ...tool };
  return true;
}
