import { describe, expect, it } from "vitest";
import {
  RECIPE_VERSION,
  checkRecipe,
  checkRulePack,
  migrateRecipe,
  normalizeRecipe,
  registerRecipeMigration,
  validateRecipe,
  validateRule
} from "../../src/automation/schema.js";

const valid = { version: 1, preset: "ranged", animation: "jb2a.fire_bolt.orange" };

describe("recipe schema", () => {
  it("accepts a minimal recipe", () => {
    expect(validateRecipe(valid)).toEqual([]);
  });

  it("migrates unversioned recipes to the current version", () => {
    const draft = { preset: valid.preset, animation: valid.animation };
    expect(migrateRecipe(draft).version).toBe(RECIPE_VERSION);
    expect(draft.version).toBeUndefined();
  });

  it("runs registered migrations in order", () => {
    registerRecipeMigration(0, ({ file, ...r }) => ({ ...r, version: 1, animation: file }));
    expect(normalizeRecipe({ preset: "melee", file: "jb2a.sword.melee.01.white" })).toMatchObject({
      version: 1,
      animation: "jb2a.sword.melee.01.white"
    });
    registerRecipeMigration(0, (r) => ({ ...r, version: 1 }));
  });

  it("reports precise errors", () => {
    const errors = validateRecipe({
      version: 1,
      preset: "laser",
      stages: { boom: {}, impact: { animation: 3 } },
      outcomes: { maybe: {}, success: { preset: "melee" } },
      triggers: ["attack", "sneeze"],
      sound: { file: "x", volume: 4 },
      extra: 1
    });
    expect(errors.join("\n")).toMatch(/preset must be one of/);
    expect(errors.join("\n")).toMatch(/stages\.boom/);
    expect(errors.join("\n")).toMatch(/stages\.impact\.animation/);
    expect(errors.join("\n")).toMatch(/outcomes\.maybe/);
    expect(errors.join("\n")).toMatch(/outcomes\.success\.preset cannot be overridden/);
    expect(errors.join("\n")).toMatch(/unknown trigger "sneeze"/);
    expect(errors.join("\n")).toMatch(/sound\.volume/);
    expect(errors.join("\n")).toMatch(/unknown property "extra"/);
    expect(errors.join("\n")).toMatch(/animation is required/);
  });

  it("normalizes outcome aliases", () => {
    const r = normalizeRecipe({ ...valid, outcomes: { hit: {}, miss: {}, crit: {}, fumble: {} } });
    expect(Object.keys(r.outcomes).sort()).toEqual(["criticalFailure", "criticalSuccess", "failure", "success"]);
  });

  it("checkRecipe never throws", () => {
    expect(checkRecipe(null).errors.length).toBeGreaterThan(0);
    expect(checkRecipe(valid).recipe).toMatchObject(valid);
  });
});

describe("rule schema", () => {
  const rule = { id: "r1", match: { key: "fire-bolt" }, recipe: valid };

  it("accepts a rule and rejects empty/invalid matches", () => {
    expect(validateRule(rule)).toEqual([]);
    expect(validateRule({ ...rule, match: {} }).join()).toMatch(/at least one/);
    expect(validateRule({ ...rule, match: { regex: "(" } }).join()).toMatch(/regex/);
    expect(validateRule({ ...rule, match: { colour: "red" } }).join()).toMatch(/colour/);
    expect(validateRule({ ...rule, recipe: {} }).join()).toMatch(/^recipe:/);
  });

  it("keeps valid rules of a pack and reports the rest", () => {
    const { pack, errors } = checkRulePack({
      system: "dummy",
      version: 1,
      rules: [rule, { ...rule }, { id: "bad", match: {}, recipe: valid }]
    });
    expect(pack.rules.map((r) => r.id)).toEqual(["r1"]);
    expect(pack.rules[0]).toMatchObject({ enabled: true, priority: 0, label: "r1" });
    expect(errors).toHaveLength(2);
    expect(checkRulePack({ system: "x", version: 2, rules: [] }).pack).toBeNull();
  });
});
