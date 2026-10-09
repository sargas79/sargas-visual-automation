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
    app.viewState.query = "orange";
    let context = await app._prepareContext({});
    expect(context.cards.map((c) => c.path)).toEqual(["jb2a.fire_bolt.orange"]);
    app.viewState.query = "";
    app.viewState.favourites = true;
    context = await app._prepareContext({});
    expect(context.cards.map((c) => [c.path, c.favourite])).toEqual([["jb2a.fire_bolt.purple", true]]);
  });

  it("always offers the clear-search button and labels the pager", async () => {
    const api = { db: createFakeDb() };
    await load(api);
    const app = api.ui.openBrowser({ path: "jb2a.fire_bolt.orange" });
    let context = await app._prepareContext({});
    expect(context.noQuery).toBe(true);
    expect(context.pager).toMatchObject({ noPrev: true, noNext: true });
    app.viewState.query = "orange";
    context = await app._prepareContext({});
    expect(context.noQuery).toBe(false);
  });

  it("toggles the narrow-window category tree without re-rendering", async () => {
    const api = { db: createFakeDb() };
    await load(api);
    const { setFakeElement } = await import("./helpers/fake-foundry.js");
    const app = api.ui.openBrowser();
    const classes = new Set();
    setFakeElement(app, { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } });
    expect((await app._prepareContext({})).sidebarOpen).toBe("false");
    const button = { setAttribute: vi.fn() };
    const renders = app.renderCalls.length;
    app.constructor.DEFAULT_OPTIONS.actions.toggleSidebar.call(app, {}, button);
    expect(classes.has("sva-sidebar-open")).toBe(true);
    expect(button.setAttribute).toHaveBeenCalledWith("aria-pressed", "true");
    expect(app.renderCalls.length).toBe(renders);
    expect((await app._prepareContext({})).sidebarOpen).toBe("true");
    app.constructor.DEFAULT_OPTIONS.actions.toggleSidebar.call(app, {}, button);
    expect(classes.has("sva-sidebar-open")).toBe(false);
  });

  it("uses captured frames for missing thumbnails and re-renders once the index is built", async () => {
    let finish;
    const db = createFakeDb();
    db.resolve = (path) => ({ path, file: `modules/jb2a/${path}.webm`, thumbnail: null });
    db.thumbnails = { status: "building", ready: new Promise((resolve) => (finish = resolve)) };
    const api = { db };
    await load(api);
    const { frameCapture } = await import("../../src/ui/frame-capture.js");
    await frameCapture().capture("jb2a.fire_bolt.orange", "modules/jb2a/x.webm"); // no DOM: cached as null
    const app = api.ui.openBrowser({ path: "jb2a.fire_bolt.orange" });
    const context = await app._prepareContext({});
    expect(context.cards.find((c) => c.path === "jb2a.fire_bolt.orange").thumbnail).toBeNull();
    const before = app.renderCalls.length;
    await app._prepareContext({}); // still building: only one pending refresh
    finish(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.renderCalls.slice(before)).toEqual([{ parts: ["grid"] }]);
  });

  it("reports an unavailable database", async () => {
    const api = { db: { available: false } };
    await load(api);
    const context = await api.ui.openBrowser()._prepareContext({});
    expect(context.unavailable).toBe(true);
  });
});
