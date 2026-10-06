import { describe, expect, it } from "vitest";
import { expandFlat, parseList, readFormElements } from "../../src/ui/models/form-utils.js";
import {
  emptyRecipe,
  formToRecipe,
  jsonFieldError,
  presetChoices,
  presetStages,
  recipeToFormModel,
  TRIGGERS
} from "../../src/ui/models/recipe-form.js";
import { summarizeResolution } from "../../src/ui/models/explain-model.js";

const presets = {
  ranged: {
    label: "Ranged",
    stages: ["projectile", "impact"],
    optionsSchema: { scale: { type: "number", default: 1 }, missed: { type: "boolean" } }
  },
  melee: { label: "Melee", stages: { onTarget: {} } }
};

/** Flatten a nested object into form names (the inverse of expandFlat). */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

/** Simulate what a rendered form would submit for a model (unchanged values). */
function formFromModel(model) {
  const flat = { "recipe.preset": model.preset, "recipe.animation": model.animation };
  for (const f of model.optionFields) flat[f.name] = f.isCheckbox ? f.checked : f.value;
  flat["recipe.optionsExtra"] = model.optionsExtra;
  for (const s of model.stages) {
    flat[`recipe.stages.${s.key}.animation`] = s.animation;
    flat[`recipe.stages.${s.key}.options`] = s.options;
  }
  for (const o of model.outcomes) {
    flat[`recipe.outcomes.${o.key}.animation`] = o.animation;
    flat[`recipe.outcomes.${o.key}.options`] = o.options;
  }
  Object.assign(flat, flatten({ recipe: { sound: model.sound } }));
  for (const t of model.triggers) flat[`recipe.triggers.${t.key}`] = t.checked;
  return flat;
}

describe("form utils", () => {
  it("reads form elements by type", () => {
    const flat = readFormElements([
      { name: "a", type: "text", value: "x" },
      { name: "b", type: "checkbox", checked: true },
      { name: "c", type: "number", value: "3" },
      { name: "d", type: "number", value: "" },
      { name: "e", type: "radio", value: "1", checked: false },
      { name: "e", type: "radio", value: "2", checked: true },
      { name: "f", type: "select-multiple", multiple: true, selectedOptions: [{ value: "p" }] },
      { name: "g", type: "text", value: "skip", disabled: true },
      { name: "h", type: "file", value: "" },
      { type: "button" }
    ]);
    expect(flat).toEqual({ a: "x", b: true, c: 3, d: "", e: "2", f: ["p"] });
  });

  it("expands flat keys and parses lists", () => {
    expect(expandFlat({ "a.b.c": 1, "a.d": 2, e: 3 })).toEqual({ a: { b: { c: 1 }, d: 2 }, e: 3 });
    expect(parseList(" Fire, cold ,,")).toEqual(["fire", "cold"]);
    expect(parseList("A,B", { lower: false })).toEqual(["A", "B"]);
  });
});

describe("recipe form", () => {
  it("lists presets and their stages", () => {
    expect(presetChoices(presets).map((c) => c.value)).toEqual(["ranged", "melee"]);
    expect(presetChoices({}).map((c) => c.value)).toContain("aura");
    expect(presetChoices(presets, "custom").at(-1)).toEqual({ value: "custom", label: "custom" });
    expect(presetStages(presets.ranged)).toEqual(["projectile", "impact"]);
    expect(presetStages(presets.melee)).toEqual(["onTarget"]);
    expect(emptyRecipe(presets)).toMatchObject({ version: 1, preset: "ranged" });
  });

  it("builds a form model with schema fields and extra options", () => {
    const model = recipeToFormModel(
      {
        version: 1,
        preset: "ranged",
        animation: "jb2a.fire_bolt.orange",
        options: { scale: 2, tint: "#ff0000" },
        outcomes: { failure: { options: { missed: true } } },
        triggers: ["attack"]
      },
      { presets }
    );
    expect(model.optionFields.map((f) => f.name)).toEqual(["recipe.options.scale", "recipe.options.missed"]);
    expect(JSON.parse(model.optionsExtra)).toEqual({ tint: "#ff0000" });
    expect(model.stages.map((s) => s.key)).toEqual(["projectile", "impact"]);
    expect(model.outcomesSet).toBe(1);
    expect(model.triggers.find((t) => t.key === "attack").checked).toBe(true);
    expect(TRIGGERS).not.toContain("effectRemoved");
  });

  it("round-trips a full recipe through the form", () => {
    const recipe = {
      version: 1,
      preset: "ranged",
      animation: "jb2a.fire_bolt.orange",
      options: { scale: 2, missed: false, tint: "#ff0000" },
      stages: { impact: { animation: "jb2a.explosion.01", options: { scale: 0.5 } } },
      outcomes: {
        criticalSuccess: { animation: "jb2a.fire_bolt.purple" },
        failure: { options: { missed: true }, preset: "melee" }
      },
      sound: { file: "sounds/fire.ogg", volume: 0.5 },
      triggers: ["attack", "damage"]
    };
    const model = recipeToFormModel(recipe, { presets });
    const { recipe: back, errors } = formToRecipe(formFromModel(model), { presets, base: recipe });
    expect(errors).toEqual([]);
    expect(back).toEqual(recipe);
  });

  it("drops empty sections and keeps triggers default", () => {
    const { recipe } = formToRecipe(
      {
        "recipe.preset": "melee",
        "recipe.animation": " ",
        "recipe.optionsExtra": "",
        "recipe.stages.onTarget.animation": "",
        "recipe.stages.onTarget.options": "",
        "recipe.sound.file": "",
        "recipe.triggers.attack": false,
        other: "ignored"
      },
      { presets }
    );
    expect(recipe).toEqual({ version: 1, preset: "melee", options: {} });
  });

  it("reports invalid JSON", () => {
    const { errors } = formToRecipe(
      { "recipe.preset": "melee", "recipe.optionsExtra": "[1]", "recipe.stages.x.options": "{" },
      { presets }
    );
    expect(errors).toHaveLength(2);
  });
});

describe("resolution summary", () => {
  it("summarizes explain output and candidates", () => {
    const s = summarizeResolution({
      recipe: { preset: "ranged", animation: "jb2a.x" },
      source: "world",
      ruleId: "r2",
      reason: "matched traits",
      candidates: [
        { rule: { id: "r1", label: "One" }, matched: false },
        { id: "r2", label: "Two", priority: 5 }
      ]
    });
    expect(s).toMatchObject({ found: true, sourceKey: "SVA.UI.Source.world", ruleId: "r2", preset: "ranged" });
    expect(s.candidates).toEqual([
      expect.objectContaining({ id: "r1", matched: false, winner: false }),
      expect.objectContaining({ id: "r2", label: "Two", matched: true, winner: true, priority: 5 })
    ]);
    expect(summarizeResolution(null)).toMatchObject({ found: false, candidates: [] });
  });

  it("accepts the api.automation.explain() trace shape", () => {
    const s = summarizeResolution({
      descriptors: {},
      disabled: false,
      reasons: ["world rule"],
      result: { recipe: { preset: "melee", animation: "jb2a.sword" }, source: "world", ruleId: "w1", reason: "key" },
      candidates: [
        { source: "world", ruleId: "w1", label: "Sword", priority: 10, matched: true, reasons: ["key", "type"] },
        { source: "fallback", ruleId: null, matched: false, reasons: ["no generic match"] }
      ]
    });
    expect(s).toMatchObject({ found: true, source: "world", ruleId: "w1", preset: "melee" });
    expect(s.candidates[0]).toMatchObject({ id: "w1", winner: true, reason: "key, type" });
    expect(s.candidates[1]).toMatchObject({ matched: false, reason: "no generic match" });
    expect(summarizeResolution({ result: null, candidates: [], reasons: [] })).toMatchObject({ found: false });
  });

  it("checks JSON textareas live", () => {
    expect(jsonFieldError("")).toBeNull();
    expect(jsonFieldError('{"a": 1}')).toBeNull();
    expect(jsonFieldError("[1, 2]")).toBeNull();
    expect(jsonFieldError("{a:")).toBeTruthy();
    expect(jsonFieldError("[1]", { object: true })).toMatch(/object/);
    expect(jsonFieldError("3", { object: true })).toMatch(/object/);
    expect(jsonFieldError("null", { object: true })).toMatch(/object/);
    expect(jsonFieldError('{"a": 1}', { object: true })).toBeNull();
  });

  it("marks invalid JSON textareas and clears the mark once fixed", async () => {
    const { validateJsonField, validateJsonFields } = await import("../../src/ui/apps/recipe-editor.js");
    const classes = new Set();
    const attrs = new Map();
    const hint = {
      hidden: true,
      textContent: "",
      id: "x-error",
      classList: { contains: (c) => c === "sva-json-error" }
    };
    const field = {
      value: "{oops",
      dataset: {},
      nextElementSibling: hint,
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k)
    };
    expect(validateJsonField(field)).toBe(false);
    expect(classes.has("sva-invalid")).toBe(true);
    expect(attrs.get("aria-invalid")).toBe("true");
    expect(attrs.get("aria-describedby")).toBe("x-error");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe("SVA.UI.Recipe.JsonInvalid");

    field.value = "[1]";
    field.dataset.svaJson = "object";
    expect(validateJsonFields({ querySelectorAll: () => [field] })).toBe(false);

    field.value = '{"ok": true}';
    expect(validateJsonField(field)).toBe(true);
    expect(classes.has("sva-invalid")).toBe(false);
    expect(attrs.has("aria-invalid")).toBe(false);
    expect(attrs.has("aria-describedby")).toBe(false);
    expect(hint.hidden).toBe(true);
    expect(validateJsonFields(null)).toBe(true);
  });
});
