import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFoundry, uninstallFakeFoundry } from "./helpers/fake-foundry.js";

/** In-memory api.automation.rules that round-trips through JSON like a setting would. */
function createRulesApi(initial = []) {
  let rules = structuredClone(initial);
  return {
    list: vi.fn(async () => structuredClone(rules)),
    save: vi.fn(async (rule) => {
      rules = [...rules.filter((r) => r.id !== rule.id), structuredClone(rule)];
    }),
    delete: vi.fn(async (id) => {
      rules = rules.filter((r) => r.id !== id);
    }),
    exportJSON: vi.fn(() => JSON.stringify({ rules })),
    importJSON: vi.fn(async (json) => {
      rules = JSON.parse(json).rules;
    })
  };
}

async function load(api) {
  vi.resetModules();
  installFakeFoundry();
  const ui = await import("../../src/ui/index.js");
  ui.init(api);
  return ui;
}

describe("rules manager app", () => {
  afterEach(() => uninstallFakeFoundry());

  it("lists world rules sorted by priority", async () => {
    const rules = createRulesApi([
      { id: "a", label: "A", priority: 1, enabled: true, match: { key: "a" }, recipe: { preset: "melee" } },
      { id: "b", label: "B", priority: 9, enabled: true, match: { key: "b" }, recipe: { preset: "ranged" } }
    ]);
    const api = { automation: { rules, presets: {} } };
    await load(api);
    const app = api.ui.openRulesManager();
    expect(api.ui.openRulesManager()).toBe(app);
    const context = await app._prepareContext({});
    expect(context.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(context.editing).toBeUndefined();
  });

  it("round-trips rules via export and import", async () => {
    const original = [
      { id: "a", label: "A", priority: 1, enabled: true, match: { key: "a" }, recipe: { preset: "melee" } }
    ];
    const source = createRulesApi(original);
    const target = createRulesApi([]);
    const { toExportText, inspectImport } = await import("../../src/ui/models/rules-model.js");
    const text = toExportText(await source.exportJSON());
    expect(inspectImport(text)).toEqual({ count: 1, error: null });
    await target.importJSON(text);
    expect(await target.list()).toEqual(original);
  });

  it("is GM only and guards a missing automation api", async () => {
    const api = {};
    await load(api);
    game.user.isGM = false;
    expect(api.ui.openRulesManager()).toBeNull();
    game.user.isGM = true;
    const context = await api.ui.openRulesManager()._prepareContext({});
    expect(context.unavailable).toBe(true);
  });
});
