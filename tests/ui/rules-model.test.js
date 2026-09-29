import { describe, expect, it } from "vitest";
import {
  duplicateRule,
  formToRule,
  inspectImport,
  matchText,
  newRule,
  ruleRows,
  ruleToFormModel,
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
      match: { key: "fire-bolt", traits: ["fire", "attack"], attackKind: "ranged", custom: 1 },
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

  it("normalizes export text and inspects imports", () => {
    expect(toExportText('{"rules":[]}')).toBe('{\n  "rules": []\n}');
    expect(JSON.parse(toExportText([{ id: "a" }]))).toEqual([{ id: "a" }]);
    expect(inspectImport('[{"id":"a"},{"id":"b"}]')).toEqual({ count: 2, error: null });
    expect(inspectImport('{"system":"world","rules":[{"id":"a"}]}')).toEqual({ count: 1, error: null });
    expect(inspectImport("{").error).toBeTruthy();
    expect(inspectImport('{"x":1}').error).toBeTruthy();
  });
});
