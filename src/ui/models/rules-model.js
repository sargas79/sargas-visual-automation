/**
 * Pure view-model helpers for the world rules manager (#38).
 * Rule = { id, label, enabled, priority, match: { key?, name?, regex?, type?, traits?, actorTraits?, attackKind?, weaponGroup?, baseItem? }, recipe }
 */
import { ATTACK_KINDS } from "../../shared/events.js";
import { cloneJson, compact, expandFlat, parseList } from "./form-utils.js";
import { emptyRecipe, formToRecipe } from "./recipe-form.js";

export const ITEM_TYPES = ["weapon", "spell", "action", "consumable", "effect", "condition", "feat", "other"];
export const MATCH_KEYS = [
  "key",
  "name",
  "regex",
  "type",
  "traits",
  "actorTraits",
  "attackKind",
  "weaponGroup",
  "baseItem"
];

const PREFIX = "rule.";

/** A blank rule (id is assigned on save). */
export function newRule(presets) {
  return { id: "", label: "", enabled: true, priority: 0, match: {}, recipe: emptyRecipe(presets) };
}

/** Copy of a rule with a fresh id and a "(copy)" label. */
export function duplicateRule(rule, copySuffix = "(copy)") {
  const copy = cloneJson(rule) ?? {};
  copy.id = "";
  copy.label = `${copy.label ?? ""} ${copySuffix}`.trim();
  return copy;
}

function options(values, selected) {
  return [{ value: "", label: "—" }, ...values.map((v) => ({ value: v, label: v, selected: v === selected }))];
}

/** Template model for the rule meta fields (the recipe part is rendered separately). */
export function ruleToFormModel(rule, { isNew = false } = {}) {
  const r = rule ?? newRule();
  const match = r.match ?? {};
  return {
    isNew,
    id: r.id ?? "",
    label: r.label ?? "",
    enabled: r.enabled !== false,
    priority: r.priority ?? 0,
    match: {
      key: match.key ?? "",
      name: match.name ?? "",
      regex: match.regex ?? "",
      type: match.type ?? "",
      traits: Array.isArray(match.traits) ? match.traits.join(", ") : (match.traits ?? ""),
      actorTraits: Array.isArray(match.actorTraits) ? match.actorTraits.join(", ") : (match.actorTraits ?? ""),
      attackKind: match.attackKind ?? "",
      weaponGroup: match.weaponGroup ?? "",
      baseItem: match.baseItem ?? ""
    },
    typeOptions: options(ITEM_TYPES, match.type),
    attackKindOptions: options(Object.values(ATTACK_KINDS), match.attackKind)
  };
}

/**
 * Build a rule from flat form values (`rule.*` + `recipe.*`).
 * @param {object} flat
 * @param {{base?: object|null, presets?: object, generateId?: () => string}} [options]
 * @returns {{rule: object, errors: string[]}}
 */
export function formToRule(flat, { base = null, presets, generateId } = {}) {
  const scoped = Object.fromEntries(
    Object.entries(flat ?? {})
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), v])
  );
  const data = expandFlat(scoped);
  const errors = [];
  const rule = { ...(cloneJson(base) ?? {}) };

  const id = String(data.id ?? rule.id ?? "").trim();
  rule.id = id || generateId?.() || "";
  rule.label = String(data.label ?? "").trim() || rule.id;
  rule.enabled = data.enabled === undefined ? rule.enabled !== false : !!data.enabled;
  const priority = Number(data.priority);
  rule.priority = data.priority === "" || !Number.isFinite(priority) ? 0 : priority;

  // Keep match keys the form does not edit (future adapters may add some).
  const previous = Object.fromEntries(Object.entries(base?.match ?? {}).filter(([k]) => !MATCH_KEYS.includes(k)));
  const m = data.match ?? {};
  const match = compact({
    key: String(m.key ?? "").trim(),
    name: String(m.name ?? "").trim(),
    regex: String(m.regex ?? "").trim(),
    type: String(m.type ?? "").trim(),
    traits: parseList(m.traits),
    actorTraits: parseList(m.actorTraits),
    attackKind: String(m.attackKind ?? "").trim(),
    weaponGroup: String(m.weaponGroup ?? "")
      .trim()
      .toLowerCase(),
    baseItem: String(m.baseItem ?? "")
      .trim()
      .toLowerCase()
  });
  if (match.regex) {
    try {
      new RegExp(match.regex, "i");
    } catch (err) {
      errors.push(`match.regex: ${err.message}`);
    }
  }
  rule.match = { ...previous, ...match };
  if (!Object.keys(rule.match).length) errors.push("match: at least one criterion is required");

  const recipe = formToRecipe(flat, { presets, base: base?.recipe ?? null });
  errors.push(...recipe.errors);
  rule.recipe = recipe.recipe;
  return { rule, errors };
}

/** One-line summary of a rule's match criteria. */
export function matchText(match) {
  return Object.entries(match ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(" · ");
}

/** Rows for the rules table, highest priority first. */
export function ruleRows(rules) {
  const list = Array.isArray(rules) ? rules : [];
  return [...list]
    .sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id))
    )
    .map((rule) => {
      const enabled = rule.enabled !== false;
      return {
        id: rule.id,
        label: rule.label || rule.id,
        enabled,
        priority: rule.priority ?? 0,
        matchText: matchText(rule.match),
        preset: rule.recipe?.preset ?? "",
        animation: rule.recipe?.animation ?? "",
        rowClass: enabled ? "sva-rule-row" : "sva-rule-row sva-rule-disabled",
        toggleIcon: enabled ? "fa-toggle-on" : "fa-toggle-off"
      };
    });
}

/** Normalize exportJSON output to a pretty JSON string. */
export function toExportText(exported) {
  if (typeof exported === "string") {
    try {
      return JSON.stringify(JSON.parse(exported), null, 2);
    } catch {
      return exported;
    }
  }
  return JSON.stringify(exported ?? [], null, 2);
}

/**
 * Validate an import file before handing it to api.automation.rules.importJSON.
 * Accepts `Rule[]` or `{ rules: Rule[] }`.
 * @returns {{count: number, error: string|null}}
 */
export function inspectImport(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch (err) {
    return { count: 0, error: err.message };
  }
  const rules = Array.isArray(data) ? data : Array.isArray(data?.rules) ? data.rules : null;
  if (!rules) return { count: 0, error: "expected an array of rules or { rules: [...] }" };
  return { count: rules.length, error: null };
}
