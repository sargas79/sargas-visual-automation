import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFoundry, uninstallFakeFoundry } from "./helpers/fake-foundry.js";

function createAutomation({ stored = null } = {}) {
  let recipe = stored;
  return {
    presets: { ranged: { label: "Ranged", optionsSchema: { scale: { type: "number" } } } },
    getItemRecipe: vi.fn(() => recipe),
    setItemRecipe: vi.fn(async (_item, r) => {
      recipe = r;
    }),
    setItemDisabled: vi.fn(async () => {}),
    explain: vi.fn(() => ({
      recipe: recipe ?? { version: 1, preset: "ranged", animation: "jb2a.matched" },
      source: recipe ? "item" : "system",
      ruleId: recipe ? null : "fire-bolt",
      reason: "key",
      candidates: [{ id: "fire-bolt", label: "Fire bolt" }]
    })),
    preview: vi.fn(async () => {})
  };
}

async function load(api) {
  vi.resetModules();
  installFakeFoundry();
  const ui = await import("../../src/ui/index.js");
  ui.init(api);
  return ui;
}

const item = { uuid: "Actor.a.Item.b", name: "Fire Bolt", type: "spell", img: "x.webp", flags: {} };

describe("item recipe editor app", () => {
  afterEach(() => uninstallFakeFoundry());

  it("starts from the matched recipe when the item has none", async () => {
    const api = { automation: createAutomation() };
    await load(api);
    const app = api.ui.openItemConfig(item);
    expect(api.ui.openItemConfig(item)).toBe(app);
    const context = await app._prepareContext({});
    expect(context).toMatchObject({ hasCustom: false, canUseMatched: true, disabled: false });
    expect(context.resolution).toMatchObject({ source: "system", ruleId: "fire-bolt" });
    expect(app.draft).toMatchObject({ animation: "jb2a.matched" });
    expect(app.id).toBe("sva-item-config-Actor-a-Item-b");
  });

  it("shows an existing item recipe and the disabled flag", async () => {
    const api = {
      automation: createAutomation({ stored: { version: 1, preset: "ranged", animation: "jb2a.own" } })
    };
    await load(api);
    const app = api.ui.openItemConfig({
      ...item,
      uuid: "Item.c",
      flags: { "sargas-visual-automation": { disabled: true } }
    });
    const context = await app._prepareContext({});
    expect(context).toMatchObject({ hasCustom: true, disabled: true });
    expect(app.draft.animation).toBe("jb2a.own");
  });

  it("guards a missing automation api", async () => {
    const api = {};
    await load(api);
    const context = await api.ui.openItemConfig({ ...item, uuid: "Item.d" })._prepareContext({});
    expect(context.unavailable).toBe(true);
    expect(api.ui.openItemConfig(null)).toBeNull();
  });
});
