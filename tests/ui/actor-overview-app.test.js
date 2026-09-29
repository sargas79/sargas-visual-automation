import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFoundry, uninstallFakeFoundry } from "./helpers/fake-foundry.js";

const MODULE_ID = "sargas-visual-automation";

function makeItems(list) {
  const map = new Map(list.map((i) => [i.id, i]));
  return Object.assign([...list], { get: (id) => map.get(id) });
}

function createApi({ ownRecipe = null } = {}) {
  const automation = {
    presets: { ranged: { label: "Ranged" }, onToken: { label: "On token" } },
    explain: vi.fn((item) => {
      const d = { name: item.name, key: item.id, type: item.type, traits: [], attackKind: item.attackKind ?? null };
      if (item.flags?.[MODULE_ID]?.disabled) return { descriptors: d, disabled: true, result: null, reasons: [] };
      if (item.flags?.[MODULE_ID]?.recipe) {
        const recipe = item.flags[MODULE_ID].recipe;
        return { descriptors: d, result: { recipe, source: "item", triggers: ["attack"], triggered: true } };
      }
      if (item.id === "bolt") {
        return {
          descriptors: d,
          result: {
            recipe: { version: 1, preset: "ranged", animation: "jb2a.fire_bolt", options: { scale: 2 } },
            source: "system",
            ruleId: "fire-bolt",
            reason: "key",
            triggers: ["attack"],
            triggered: true
          }
        };
      }
      return { descriptors: d, result: null, reasons: ["no recipe found"] };
    }),
    setItemRecipe: vi.fn(async () => {}),
    setItemDisabled: vi.fn(async () => {}),
    preview: vi.fn(async () => true)
  };
  const items = makeItems([
    { id: "bolt", name: "Fire Bolt", type: "spell", img: "b.webp", isOwner: true, flags: {} },
    {
      id: "sword",
      name: "Sword",
      type: "weapon",
      isOwner: true,
      flags: ownRecipe ? { [MODULE_ID]: { recipe: ownRecipe } } : {}
    },
    { id: "rope", name: "Rope", type: "other", isOwner: true, flags: {} }
  ]);
  const actor = { id: "a1", uuid: "Actor.a1", name: "Ezren", img: "e.webp", items, getActiveTokens: () => [] };
  for (const item of items) item.parent = actor;
  const api = {
    automation,
    db: { available: true, getEntry: (p) => (p === "jb2a.fire_bolt" ? { thumbnail: "fb.webp" } : null) }
  };
  return { api, actor, items };
}

async function load(api) {
  vi.resetModules();
  installFakeFoundry();
  const ui = await import("../../src/ui/index.js");
  ui.init(api);
  return ui;
}

const target = (id) => ({ closest: () => ({ dataset: { itemId: id } }) });

describe("actor animation overview app", () => {
  afterEach(() => {
    uninstallFakeFoundry();
    vi.useRealTimers();
  });

  it("lists the actor's animatable items grouped, with their resolved animation", async () => {
    const { api, actor } = createApi();
    await load(api);
    const app = api.ui.openActorOverview(actor);
    expect(api.ui.openActorOverview(actor)).toBe(app);
    expect(app.id).toBe("sva-actor-overview-Actor-a1");
    const context = await app._prepareContext({});
    expect(context.groups.map((g) => g.id)).toEqual(["spell", "weapon"]);
    const bolt = context.groups[0].rows[0];
    expect(bolt).toMatchObject({
      name: "Fire Bolt",
      source: "system",
      animation: "jb2a.fire_bolt",
      thumbnail: "fb.webp",
      presetLabel: "Ranged",
      canEdit: true
    });
    expect(context.groups[1].rows[0]).toMatchObject({ name: "Sword", found: false, source: "none" });
    expect(context.counts).toEqual({ total: 2, animated: 1, none: 1, disabled: 0 });

    app.viewState.showAll = true;
    const all = await app._prepareContext({});
    expect(all.groups.map((g) => g.id)).toEqual(["spell", "weapon", "other"]);
  });

  it("warns without an actor", async () => {
    const { api } = createApi();
    await load(api);
    expect(api.ui.openActorOverview(null)).toBeNull();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
  });

  it("changes an animation keeping the resolved recipe", async () => {
    const { api, actor, items } = createApi();
    await load(api);
    const app = api.ui.openActorOverview(actor);
    await app._prepareContext({});
    const row = app.rows.find((r) => r.id === "bolt");
    await app.changeAnimation(items.get("bolt"), row, "jb2a.ray_of_frost");
    expect(api.automation.setItemRecipe).toHaveBeenCalledWith(items.get("bolt"), {
      version: 1,
      preset: "ranged",
      animation: "jb2a.ray_of_frost",
      options: { scale: 2 }
    });
    expect(app.rows).toBeNull();
  });

  it("previews from a controlled token of the actor to the targets", async () => {
    const { api, actor } = createApi();
    await load(api);
    const token = { id: "t1", actor };
    const targetToken = { id: "t2" };
    globalThis.canvas = { tokens: { controlled: [token] } };
    globalThis.game.user.targets = new Set([targetToken]);
    const app = api.ui.openActorOverview(actor);
    await app._prepareContext({});
    await app.previewRow(app.rows.find((r) => r.id === "bolt"));
    expect(api.automation.preview).toHaveBeenCalledWith(
      expect.objectContaining({ animation: "jb2a.fire_bolt" }),
      expect.objectContaining({ sourceToken: token, targetTokens: [targetToken] })
    );
    // No token of the actor: warn instead.
    globalThis.canvas = { tokens: { controlled: [] } };
    await app.previewRow(app.rows.find((r) => r.id === "bolt"));
    expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
  });

  it("finds the row and item of an action target", async () => {
    const { api, actor, items } = createApi();
    await load(api);
    const app = api.ui.openActorOverview(actor);
    await app._prepareContext({});
    const { row, item } = app.rowOf(target("sword"));
    expect(row.name).toBe("Sword");
    expect(item).toBe(items.get("sword"));
  });

  it("refreshes on changes of its actor's items and world rules, and unhooks on close", async () => {
    vi.useFakeTimers();
    const { api, actor, items } = createApi();
    await load(api);
    const handlers = new Map();
    let nextId = 1;
    globalThis.Hooks = {
      on: vi.fn((name, fn) => {
        const id = nextId++;
        handlers.set(id, { name, fn });
        return id;
      }),
      off: vi.fn((_name, id) => handlers.delete(id))
    };
    const fire = (name, ...args) => {
      for (const h of [...handlers.values()]) if (h.name === name) h.fn(...args);
    };
    const app = api.ui.openActorOverview(actor);
    app._onFirstRender({}, {});
    // _onFirstRender needs an element for the thumbnail error listener.
    await app._prepareContext({});
    app.render();
    const render = vi.spyOn(app, "render");

    fire("updateItem", { parent: { id: "other", uuid: "Actor.other" } });
    vi.runAllTimers();
    expect(render).not.toHaveBeenCalled();
    expect(app.rows).not.toBeNull();

    fire("updateItem", items.get("bolt"));
    expect(app.rows).toBeNull();
    vi.runAllTimers();
    expect(render).toHaveBeenCalledTimes(1);

    await app._prepareContext({});
    fire("updateSetting", { key: `${MODULE_ID}.automationRules` });
    expect(app.rows).toBeNull();

    await app.close();
    expect(handlers.size).toBe(0);
  });
});
