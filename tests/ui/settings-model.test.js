import { describe, expect, it } from "vitest";
import {
  addSceneControlTool,
  coerceSettingValue,
  collectModuleSettings,
  diffSettings,
  groupFields,
  groupFor,
  settingField,
  settingType
} from "../../src/ui/models/settings-model.js";

const M = "sargas-visual-automation";

function registry() {
  return new Map([
    [`${M}.debug`, { name: "Debug", scope: "client", config: true, type: Boolean, default: false }],
    [
      `${M}.engineMaxEffects`,
      { name: "Max", scope: "world", config: true, type: Number, default: 50, range: { min: 1, max: 200, step: 1 } }
    ],
    [
      `${M}.netMinTriggerRole`,
      { name: "Role", scope: "world", config: true, type: Number, choices: { 1: "Player", 4: "GM" }, default: 1 }
    ],
    [`${M}.automationSystemPack`, { name: "Pack", scope: "world", config: true, type: Boolean, default: true }],
    [
      `${M}.automationEnabled`,
      { name: "Auto", scope: "world", config: true, type: Boolean, default: true, requiresReload: true }
    ],
    [`${M}.automationWorldRules`, { scope: "world", config: false, type: Array, default: [] }],
    [`${M}.uiFavourites`, { scope: "client", config: false, type: Array, default: [] }],
    [`${M}.blob`, { scope: "world", config: true, type: Object, default: {} }],
    ["core.other", { scope: "world", config: true, type: Boolean }]
  ]);
}

describe("settings collection and grouping", () => {
  it("keeps only this module's visible scalar settings, world ones for GMs", () => {
    const gm = collectModuleSettings(registry(), { moduleId: M, isGM: true }).map((s) => s.key);
    expect(gm).toEqual(["debug", "engineMaxEffects", "netMinTriggerRole", "automationSystemPack", "automationEnabled"]);
    const player = collectModuleSettings(registry(), { moduleId: M, isGM: false }).map((s) => s.key);
    expect(player).toEqual(["debug"]);
    expect(collectModuleSettings(undefined, { moduleId: M })).toEqual([]);
  });

  it("infers groups from scope and key, honouring svaGroup", () => {
    expect(groupFor({ key: "debug", scope: "client" })).toBe("client");
    expect(groupFor({ key: "engineMaxEffects", scope: "world" })).toBe("performance");
    expect(groupFor({ key: "netMinTriggerRole", scope: "world" })).toBe("permissions");
    expect(groupFor({ key: "automationSystemPack", scope: "world" })).toBe("systems");
    expect(groupFor({ key: "automationEnabled", scope: "world" })).toBe("automation");
    expect(groupFor({ key: "whatever", scope: "world" })).toBe("general");
    expect(groupFor({ key: "debug", scope: "client", svaGroup: "general" })).toBe("general");
  });

  it("detects types including DataField instances", () => {
    class BooleanField {}
    class NumberField {}
    expect(settingType({ type: Boolean })).toBe("boolean");
    expect(settingType({ type: new BooleanField() })).toBe("boolean");
    expect(settingType({ type: new NumberField() })).toBe("number");
    expect(settingType({ type: Object })).toBe("object");
    expect(settingType({})).toBe("string");
  });

  it("builds grouped fields in a stable order", () => {
    const settings = collectModuleSettings(registry(), { moduleId: M, isGM: true });
    const groups = groupFields(settings, (s) => (s.key === "debug" ? true : s.default));
    expect(groups.map((g) => g.id)).toEqual(["automation", "performance", "permissions", "systems", "client"]);
    const fields = Object.fromEntries(groups.flatMap((g) => g.fields).map((f) => [f.key, f]));
    expect(fields.debug).toMatchObject({ isCheckbox: true, checked: true, id: `${M}.debug` });
    expect(fields.engineMaxEffects).toMatchObject({ isRange: true, min: 1, max: 200, value: 50 });
    expect(fields.netMinTriggerRole).toMatchObject({ isSelect: true, value: "1" });
    expect(fields.netMinTriggerRole.options).toEqual([
      { value: "1", label: "Player" },
      { value: "4", label: "GM" }
    ]);
    expect(fields.automationEnabled.requiresReload).toBe(true);
  });

  it("renders plain text and number fields", () => {
    expect(settingField({ id: "a.b", key: "b", type: String }, "x")).toMatchObject({ isText: true, value: "x" });
    expect(settingField({ id: "a.c", key: "c", type: Number }, 3)).toMatchObject({ isNumber: true, step: "any" });
  });
});

describe("settings submission", () => {
  it("coerces values by type", () => {
    expect(coerceSettingValue({ type: Boolean }, true)).toBe(true);
    expect(coerceSettingValue({ type: Number }, "4")).toBe(4);
    expect(coerceSettingValue({ type: Number }, "")).toBeUndefined();
    expect(coerceSettingValue({ type: String }, 5)).toBe("5");
  });

  it("returns only changed settings", () => {
    const settings = collectModuleSettings(registry(), { moduleId: M, isGM: true });
    const changes = diffSettings(
      settings,
      { [`${M}.debug`]: true, [`${M}.engineMaxEffects`]: "50", [`${M}.netMinTriggerRole`]: "4", other: 1 },
      (s) => s.default
    );
    expect(changes.map((c) => [c.setting.key, c.value])).toEqual([
      ["debug", true],
      ["netMinTriggerRole", 4]
    ]);
  });
});

describe("scene controls", () => {
  const tool = { name: "svaBrowser", title: "t", icon: "i", button: true };

  it("adds a tool to the v13+ record shape with the next order", () => {
    const controls = { tokens: { name: "tokens", tools: { select: { order: 0 }, target: { order: 3 } } } };
    expect(addSceneControlTool(controls, "tokens", tool)).toBe(true);
    expect(controls.tokens.tools.svaBrowser).toMatchObject({ ...tool, order: 4 });
  });

  it("supports the legacy array shape and missing controls", () => {
    const controls = [{ name: "tokens", tools: [] }];
    expect(addSceneControlTool(controls, "tokens", tool)).toBe(true);
    expect(controls[0].tools).toHaveLength(1);
    expect(addSceneControlTool({}, "tokens", tool)).toBe(false);
  });
});
