import { describe, expect, it } from "vitest";
import {
  duplicateRule,
  filterRules,
  formToRule,
  hasMatchCriterion,
  inspectImport,
  matchText,
  newRule,
  ruleRows,
  RULE_SORTS,
  ruleToFormModel,
  sortRules,
  toExportText
} from "../../src/ui/models/rules-model.js";

const presets = { ranged: { label: "Ranged", optionsSchema: { scale: { type: "number" } } } };

describe("rules model", () => {
  it("creates and duplicates rules", () => {
    expect(newRule(presets)).toMatchObject({ id: "", enabled: true, priority: 0, recipe: { preset: "ranged" } });
    const copy = duplicateRule({ id: "a", label: "Fire", match: { key: "fire" } });
    expect(copy).toEqual({ id: "", label: "Fire (copy)", match: { key: "fire" } });
  });

  it("builds a form model with joined traits", () => {
    const m = ruleToFormModel({ id: "r", label: "R", match: { traits: ["fire", "cantrip"], type: "spell" } });
    expect(m.match.traits).toBe("fire, cantrip");
    expect(m.typeOptions[0]).toEqual({ value: "", label: "—" });
    expect(m.enabled).toBe(true);
  });

  it("round-trips a rule through the form", () => {
    const rule = {
      id: "fire-bolt",
      label: "Fire bolt",
      enabled: false,
      priority: 10,
      match: {
        key: "fire-bolt",
        traits: ["fire", "attack"],
        actorTraits: ["dragon", "size:large"],
        attackKind: "ranged",
        baseItem: "longsword",
        custom: 1
      },
      recipe: { version: 1, preset: "ranged", animation: "jb2a.fire_bolt.orange", options: { scale: 2 } }
    };
    const m = ruleToFormModel(rule);
    const flat = {
      "rule.id": m.id,
      "rule.label": m.label,
      "rule.enabled": m.enabled,
      "rule.priority": m.priority,
      ...Object.fromEntries(Object.entries(m.match).map(([k, v]) => [`rule.match.${k}`, v])),
      "recipe.preset": "ranged",
      "recipe.animation": "jb2a.fire_bolt.orange",
      "recipe.options.scale": 2,
      "recipe.optionsExtra": ""
    };
    const { rule: back, errors } = formToRule(flat, { base: rule, presets });
    expect(errors).toEqual([]);
    expect(back).toEqual(rule);
  });

  it("generates ids, requires a match and validates the regex", () => {
    const { rule, errors } = formToRule(
      { "rule.id": "", "rule.label": "", "rule.priority": "", "rule.match.regex": "(", "recipe.preset": "ranged" },
      { presets, generateId: () => "gen1" }
    );
    expect(rule).toMatchObject({ id: "gen1", label: "gen1", priority: 0, enabled: true });
    expect(errors.join()).toMatch(/regex/);
    const empty = formToRule({ "rule.id": "x", "recipe.preset": "ranged" }, { presets });
    expect(empty.errors.join()).toMatch(/criterion/);
  });

  it("sorts rows by priority and summarizes matches", () => {
    const rows = ruleRows([
      { id: "b", label: "B", priority: 1, match: { key: "b" } },
      { id: "a", label: "A", priority: 5, enabled: false, match: { traits: ["x", "y"] }, recipe: { preset: "aura" } }
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({
      enabled: false,
      toggleIcon: "fa-toggle-off",
      preset: "aura",
      matchText: "traits: x, y"
    });
    expect(matchText({ key: "k", name: "", traits: [] })).toBe("key: k");
    expect(ruleRows(null)).toEqual([]);
  });

  it("filters rows by label, id, match criteria and animation", () => {
    const rules = [
      { id: "fire-bolt", label: "Fire bolt", priority: 1, match: { key: "fire-bolt" }, recipe: { preset: "ranged" } },
      {
        id: "bows",
        label: "All bows",
        priority: 3,
        match: { weaponGroup: "bow" },
        recipe: { preset: "ranged", animation: "jb2a.arrow.physical" }
      },
      { id: "heal", label: "Heal", priority: 2, match: { traits: ["healing"] }, recipe: { preset: "onToken" } }
    ];
    expect(filterRules(rules, "").map((r) => r.id)).toEqual(["fire-bolt", "bows", "heal"]);
    expect(filterRules(rules, "FIRE").map((r) => r.id)).toEqual(["fire-bolt"]);
    expect(filterRules(rules, "bows").map((r) => r.id)).toEqual(["bows"]);
    expect(filterRules(rules, "weaponGroup").map((r) => r.id)).toEqual(["bows"]);
    expect(filterRules(rules, "arrow").map((r) => r.id)).toEqual(["bows"]);
    expect(filterRules(rules, "healing").map((r) => r.id)).toEqual(["heal"]);
    expect(filterRules(rules, "ranged bow").map((r) => r.id)).toEqual(["bows"]);
    expect(filterRules(rules, "nothing")).toEqual([]);
    expect(filterRules(null, "x")).toEqual([]);
    expect(ruleRows(rules, { query: "heal" }).map((r) => r.id)).toEqual(["heal"]);
  });

  it("sorts rows by priority, label or id", () => {
    const rules = [
      { id: "c", label: "beta", priority: 1 },
      { id: "a", label: "Gamma", priority: 5 },
      { id: "b", label: "alpha", priority: 5 }
    ];
    expect(RULE_SORTS).toEqual(["priority", "label", "id"]);
    expect(sortRules(rules).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortRules(rules, "label").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRules(rules, "id").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortRules(rules, "bogus").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rules.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(ruleRows(rules, { sort: "id" }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("detects whether a rule has a match criterion", () => {
    expect(hasMatchCriterion({ key: "x" })).toBe(true);
    expect(hasMatchCriterion({ traits: ["fire"] })).toBe(true);
    expect(hasMatchCriterion({ key: "", traits: [], name: null })).toBe(false);
    expect(hasMatchCriterion({})).toBe(false);
    expect(hasMatchCriterion(undefined)).toBe(false);
  });

  it("normalizes export text and inspects imports", () => {
    expect(toExportText('{"rules":[]}')).toBe('{\n  "rules": []\n}');
    expect(JSON.parse(toExportText([{ id: "a" }]))).toEqual([{ id: "a" }]);
    expect(inspectImport('[{"id":"a"},{"id":"b"}]')).toEqual({ count: 2, error: null });
    expect(inspectImport('{"system":"world","rules":[{"id":"a"}]}')).toEqual({ count: 1, error: null });
    expect(inspectImport("{").error).toBeTruthy();
    expect(inspectImport('{"x":1}').error).toBeTruthy();
  });
});
