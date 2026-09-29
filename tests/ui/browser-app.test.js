import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { installFakeFoundry, uninstallFakeFoundry } from "./helpers/fake-foundry.js";

async function load(api) {
  vi.resetModules();
  installFakeFoundry();
  const ui = await import("../../src/ui/index.js");
  ui.init(api);
  return ui;
}

describe("animation browser app", () => {
  beforeEach(() => uninstallFakeFoundry());
  afterEach(() => uninstallFakeFoundry());

  it("reuses a single shared window and opens separate pickers", async () => {
    const api = { db: createFakeDb() };
    await load(api);
    const a = api.ui.openBrowser();
    const b = api.ui.openBrowser();
    const picker = api.ui.openBrowser({ onPick: () => {} });
    expect(a).toBe(b);
    expect(picker).not.toBe(a);
    expect(picker.onPick).toBeTypeOf("function");
  });

  it("prepares tree rows and a branch grid", async () => {
    const api = { db: createFakeDb() };
    await load(api);
    const app = api.ui.openBrowser({ path: "jb2a.fire_bolt.orange" });
    const context = await app._prepareContext({});
    expect(context.rows.map((r) => r.path)).toContain("jb2a.fire_bolt.dark");
    expect(context.cards.map((c) => c.path)).toEqual([
      "jb2a.fire_bolt.dark",
      "jb2a.fire_bolt.orange",
      "jb2a.fire_bolt.purple"
    ]);
    expect(context.cards[1].thumbnail).toBe("modules/jb2a/jb2a.fire_bolt.orange.webp");
    expect(context.crumbs.at(-1).path).toBe("jb2a.fire_bolt");
  });

  it("switches to search results and favourites", async () => {
    const api = { db: createFakeDb() };
    await load(api);
    await game.settings.set(MODULE_ID, "uiFavourites", ["jb2a.fire_bolt.purple"]);
    const app = api.ui.openBrowser();
    app.state.query = "orange";
    let context = await app._prepareContext({});
    expect(context.cards.map((c) => c.path)).toEqual(["jb2a.fire_bolt.orange"]);
    app.state.query = "";
    app.state.favourites = true;
    context = await app._prepareContext({});
    expect(context.cards.map((c) => [c.path, c.favourite])).toEqual([["jb2a.fire_bolt.purple", true]]);
  });

  it("reports an unavailable database", async () => {
    const api = { db: { available: false } };
    await load(api);
    const context = await api.ui.openBrowser()._prepareContext({});
    expect(context.unavailable).toBe(true);
  });
});
