import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import { installFakeFoundry, uninstallFakeFoundry } from "./helpers/fake-foundry.js";

async function load() {
  vi.resetModules();
  installFakeFoundry();
  const menus = new Map();
  game.settings.registerMenu = vi.fn((ns, key, data) => menus.set(`${ns}.${key}`, data));
  // Real Foundry exposes the registry as game.settings.settings.
  game.settings.settings = game.settings._configs;
  const ui = await import("../../src/ui/index.js");
  const api = {};
  ui.init(api);
  return { ui, api, menus };
}

describe("settings panel and menus", () => {
  afterEach(() => uninstallFakeFoundry());

  it("registers the settings, browser and rules submenus", async () => {
    const { menus } = await load();
    expect([...menus.keys()]).toEqual([
      `${MODULE_ID}.uiSettingsPanel`,
      `${MODULE_ID}.uiBrowser`,
      `${MODULE_ID}.uiRulesManager`
    ]);
    expect(menus.get(`${MODULE_ID}.uiRulesManager`).restricted).toBe(true);
    const Launcher = menus.get(`${MODULE_ID}.uiBrowser`).type;
    expect(new Launcher().render()).toBeInstanceOf(Launcher);
  });

  it("groups registered module settings dynamically", async () => {
    const { api } = await load();
    game.settings.register(MODULE_ID, "engineMaxEffects", {
      name: "Max",
      hint: "Hint",
      scope: "world",
      config: true,
      type: Number,
      default: 30
    });
    const context = await api.ui.openSettings()._prepareContext({});
    const ids = context.groups.map((g) => g.id);
    expect(ids).toEqual(["performance", "client"]);
    expect(context.groups[1].fields.map((f) => f.key)).toEqual(["uiSceneControl"]);
  });

  it("adds the browser button to the token controls unless disabled", async () => {
    await load();
    const controls = { tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls);
    expect(controls.tokens.tools.svaBrowser).toMatchObject({ button: true, icon: "fa-solid fa-film" });
    await game.settings.set(MODULE_ID, "uiSceneControl", false);
    const again = { tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", again);
    expect(again.tokens.tools.svaBrowser).toBeUndefined();
  });
});
