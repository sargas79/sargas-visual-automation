import { describe, expect, it } from "vitest";
import {
  coerceOption,
  describeOption,
  describeSchema,
  fieldsToOptions,
  INPUTS,
  normalizeChoices,
  schemaToFields
} from "../../src/ui/models/schema-fields.js";

describe("schema shapes", () => {
  const expected = ["scale", "color"];

  it("accepts plain maps, JSON schema, arrays and SchemaField-like objects", () => {
    const plain = { scale: { type: "number" }, color: { type: "string" } };
    const json = { type: "object", properties: plain };
    const array = [
      { key: "scale", type: "number" },
      { name: "color", type: "string" }
    ];
    const schemaField = { fields: plain };
    for (const schema of [plain, json, array, schemaField]) {
      expect(describeSchema(schema).map((d) => d.key)).toEqual(expected);
    }
    expect(describeSchema(null)).toEqual([]);
  });

  it("infers inputs from types, formats, choices and defaults", () => {
    expect(describeOption("a", { type: "boolean" }).input).toBe(INPUTS.CHECKBOX);
    expect(describeOption("a", { type: "integer" })).toMatchObject({ input: INPUTS.NUMBER, step: 1, integer: true });
    expect(describeOption("a", { type: Number, minimum: 0, maximum: 2 })).toMatchObject({ min: 0, max: 2 });
    expect(describeOption("a", { type: "string", format: "color" }).input).toBe(INPUTS.COLOR);
    expect(describeOption("a", { type: "string", enum: ["x", "y"] }).input).toBe(INPUTS.SELECT);
    expect(describeOption("impactAnimation", { type: "animation" }).input).toBe(INPUTS.ANIMATION);
    expect(describeOption("animation", { type: "string" }).input).toBe(INPUTS.ANIMATION);
    expect(describeOption("offset", { type: "object" }).input).toBe(INPUTS.JSON);
    expect(describeOption("scale", 1.5)).toMatchObject({ input: INPUTS.NUMBER, default: 1.5 });
    expect(describeOption("mirror", false)).toMatchObject({ input: INPUTS.CHECKBOX, default: false });
    expect(describeOption("flag", Boolean).input).toBe(INPUTS.CHECKBOX);
  });

  it("reads Foundry DataField-like instances", () => {
    class NumberField {
      constructor() {
        Object.assign(this, { initial: 1, min: 0, max: 5, step: 0.1, label: "Scale", hint: "How big" });
      }
    }
    class StringField {
      constructor() {
        this.choices = { belowTokens: "Below", aboveTokens: "Above" };
        this.initial = "aboveTokens";
      }
    }
    const fields = describeSchema({ fields: { scale: new NumberField(), layer: new StringField() } });
    expect(fields[0]).toMatchObject({ input: INPUTS.NUMBER, default: 1, label: "Scale", hint: "How big", max: 5 });
    expect(fields[1]).toMatchObject({ input: INPUTS.SELECT, default: "aboveTokens" });
    expect(fields[1].choices).toEqual([
      { value: "belowTokens", label: "Below" },
      { value: "aboveTokens", label: "Above" }
    ]);
  });

  it("normalizes choices", () => {
    expect(normalizeChoices(["a", 2])).toEqual([
      { value: "a", label: "a" },
      { value: 2, label: "2" }
    ]);
    expect(normalizeChoices([{ value: "x", label: "X" }])).toEqual([{ value: "x", label: "X" }]);
    expect(normalizeChoices({ a: { label: "A" } })).toEqual([{ value: "a", label: "A" }]);
    expect(normalizeChoices(null)).toBeNull();
  });
});

describe("schema fields", () => {
  const schema = {
    scale: { type: "number", default: 1 },
    missed: { type: "boolean" },
    layer: { type: "string", choices: ["belowTokens", "aboveTokens"] },
    offset: { type: "object" },
    tint: { type: "string", format: "color" }
  };

  it("renders current values with defaults", () => {
    const fields = schemaToFields(schema, { missed: true, offset: { x: 1 } }, { prefix: "recipe.options." });
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.scale).toMatchObject({ name: "recipe.options.scale", value: 1, isNumber: true, placeholder: "1" });
    expect(byKey.missed).toMatchObject({ checked: true, isCheckbox: true });
    expect(byKey.layer.options[0]).toEqual({ value: "", label: "—" });
    expect(byKey.offset.value).toContain('"x": 1');
    expect(byKey.tint).toMatchObject({ isColor: true, colorValue: "#ffffff" });
  });

  it("coerces raw values", () => {
    const [scale, missed, layer, offset] = describeSchema(schema);
    expect(coerceOption(scale, "2.5")).toEqual({ value: 2.5, error: null });
    expect(coerceOption(scale, "")).toEqual({ value: undefined, error: null });
    expect(coerceOption(scale, "abc").error).toMatch(/scale/);
    expect(coerceOption(missed, true).value).toBe(true);
    expect(coerceOption(layer, "").value).toBeUndefined();
    expect(coerceOption(offset, "{bad").error).toMatch(/offset/);
    expect(coerceOption(describeOption("n", { type: "integer" }), 2.6).value).toBe(3);
  });

  it("builds typed options and reports errors", () => {
    const { options, errors } = fieldsToOptions(schema, {
      scale: 2,
      missed: false,
      layer: "belowTokens",
      offset: "{bad",
      unknown: "x"
    });
    expect(options).toEqual({ scale: 2, missed: false, layer: "belowTokens" });
    expect(errors).toHaveLength(1);
  });
});
