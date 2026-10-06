import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFoundry, uninstallFakeFoundry, setFakeElement } from "./helpers/fake-foundry.js";

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

  it("turns automation off and on instantly from the header toggle, keeping unsaved edits", async () => {
    const automation = createAutomation({ stored: { version: 1, preset: "ranged", animation: "jb2a.own" } });
    const edited = { ...item, uuid: "Item.toggle", flags: {} };
    automation.setItemDisabled.mockImplementation(async (target, disabled) => {
      target.flags = { "sargas-visual-automation": { disabled } };
    });
    const api = { automation };
    await load(api);
    const app = api.ui.openItemConfig(edited);
    const fields = [
      { name: "recipe.preset", value: "ranged" },
      { name: "recipe.animation", value: "jb2a.own" }
    ];
    setFakeElement(app, { addEventListener: vi.fn(), elements: fields });
    let context = await app._prepareContext({});
    expect(context.toggle).toMatchObject({
      disabled: false,
      pressed: "false",
      label: "SVA.UI.ItemConfig.Disabled",
      icon: "fa-toggle-on"
    });
    fields[1].value = "jb2a.unsaved";
    const toggle = app.constructor.DEFAULT_OPTIONS.actions.toggleItemDisabled;
    await toggle.call(app, {}, null);
    expect(automation.setItemDisabled).toHaveBeenCalledWith(edited, true);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("SVA.UI.ItemConfig.DisabledOn");
    expect(app.draft.animation).toBe("jb2a.unsaved");
    expect(automation.setItemRecipe).not.toHaveBeenCalled();
    context = await app._prepareContext({});
    expect(context.toggle).toMatchObject({ disabled: true, pressed: "true", label: "SVA.UI.ItemConfig.Enable" });
    await toggle.call(app, {}, null);
    expect(automation.setItemDisabled).toHaveBeenLastCalledWith(edited, false);
  });

  it("follows updates of its item and unregisters the hooks on close", async () => {
    const hooks = new Map();
    let nextId = 1;
    globalThis.Hooks = {
      on: vi.fn((name, fn) => {
        const id = nextId++;
        hooks.set(id, { name, fn });
        return id;
      }),
      off: vi.fn((name, id) => hooks.delete(id))
    };
    const itemHooks = () => [...hooks.values()].filter((h) => h.name.endsWith("Item")).length;
    const fire = (name, ...args) => {
      for (const hook of [...hooks.values()]) if (hook.name === name) hook.fn(...args);
    };
    try {
      const automation = createAutomation({ stored: { version: 1, preset: "ranged", animation: "jb2a.own" } });
      const api = { automation };
      await load(api);
      const edited = { ...item, uuid: "Item.sync" };
      const app = api.ui.openItemConfig(edited);
      const fields = [
        { name: "recipe.preset", value: "ranged" },
        { name: "recipe.animation", value: "jb2a.own" }
      ];
      setFakeElement(app, { addEventListener: vi.fn(), elements: fields });
      await app._prepareContext({});
      app._onFirstRender({}, {});
      app._onRender({}, {});
      expect(itemHooks()).toBe(2);
      const renders = app.renderCalls.length;

      // Another item: ignored.
      fire("updateItem", { uuid: "Item.other" }, {});
      expect(app.renderCalls.length).toBe(renders);

      // No unsaved edits: reload from the item.
      fire("updateItem", { ...edited }, {});
      expect(app.draft).toBeUndefined();
      expect(app.stale).toBe(false);
      expect(app.renderCalls.length).toBe(renders + 1);

      // Unsaved edits: keep them and flag the editor as stale.
      await app._prepareContext({});
      app._onRender({}, {});
      fields[1].value = "jb2a.edited";
      expect(app.onItemUpdated({ ...edited })).toBe("prompt");
      expect(app.stale).toBe(true);
      expect(app.draft.animation).toBe("jb2a.edited");
      expect((await app._prepareContext({})).stale).toBe(true);

      await app.close();
      expect(itemHooks()).toBe(0);
      expect(globalThis.Hooks.off).toHaveBeenCalledWith("updateItem", expect.any(Number));
    } finally {
      delete globalThis.Hooks;
    }
  });

  it("ignores the update hooks of its own saves", async () => {
    const hooks = [];
    globalThis.Hooks = { on: (name, fn) => hooks.push({ name, fn }), off: vi.fn() };
    try {
      const automation = createAutomation();
      const api = { automation };
      await load(api);
      const edited = { ...item, uuid: "Item.own" };
      const app = api.ui.openItemConfig(edited);
      const fields = [
        { name: "recipe.preset", value: "ranged" },
        { name: "recipe.animation", value: "jb2a.mine" }
      ];
      setFakeElement(app, { addEventListener: vi.fn(), elements: fields });
      await app._prepareContext({});
      app._onFirstRender({}, {});
      const seen = [];
      automation.setItemRecipe.mockImplementation(async () => {
        seen.push(app.onItemUpdated({ ...edited }));
      });
      const { getItemConfigClass } = await import("../../src/ui/apps/item-config.js");
      const submit = getItemConfigClass().DEFAULT_OPTIONS.form.handler;
      await submit.call(app, {}, app.element);
      expect(seen).toEqual(["ignore"]);
      expect(app.stale).toBe(false);
    } finally {
      delete globalThis.Hooks;
    }
  });

  it("closes when its item is deleted", async () => {
    const hooks = [];
    globalThis.Hooks = { on: (name, fn) => hooks.push({ name, fn }), off: vi.fn() };
    try {
      const api = { automation: createAutomation() };
      await load(api);
      const app = api.ui.openItemConfig({ ...item, uuid: "Item.del" });
      setFakeElement(app, { addEventListener: vi.fn(), elements: [] });
      app._onFirstRender({}, {});
      const close = vi.spyOn(app, "close");
      hooks.find((h) => h.name === "deleteItem").fn({ uuid: "Item.del" });
      expect(close).toHaveBeenCalled();
    } finally {
      delete globalThis.Hooks;
    }
  });

  it("opens an audio FilePicker for the sound field", async () => {
    const api = { automation: createAutomation() };
    await load(api);
    const created = [];
    class FakePicker {
      constructor(options) {
        this.options = options;
        this.render = vi.fn();
        created.push(this);
      }
    }
    globalThis.foundry.applications.apps = { FilePicker: { implementation: FakePicker } };
    const hadCss = "CSS" in globalThis;
    if (!hadCss) globalThis.CSS = { escape: (s) => s };
    try {
      const { pickFileInto } = await import("../../src/ui/apps/recipe-editor.js");
      const input = { value: "sounds/old.ogg", dispatchEvent: vi.fn() };
      const root = { querySelector: vi.fn(() => input) };
      const picker = pickFileInto(root, "recipe.sound.file");
      expect(picker).toBe(created[0]);
      expect(picker.options).toMatchObject({ type: "audio", current: "sounds/old.ogg" });
      expect(picker.render).toHaveBeenCalledWith({ force: true });
      picker.options.callback("sounds/new.ogg");
      expect(input.value).toBe("sounds/new.ogg");
      expect(input.dispatchEvent).toHaveBeenCalled();
      delete globalThis.foundry.applications.apps;
      expect(pickFileInto(root, "recipe.sound.file")).toBeNull();
    } finally {
      if (!hadCss) delete globalThis.CSS;
    }
  });

  it("guards a missing automation api", async () => {
    const api = {};
    await load(api);
    const context = await api.ui.openItemConfig({ ...item, uuid: "Item.d" })._prepareContext({});
    expect(context.unavailable).toBe(true);
    expect(api.ui.openItemConfig(null)).toBeNull();
  });
});
