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

  it("filters and sorts the rules list", async () => {
    const rules = createRulesApi([
      { id: "a", label: "Zap", priority: 1, enabled: true, match: { key: "zap" }, recipe: { preset: "melee" } },
      { id: "b", label: "Arrow", priority: 9, enabled: true, match: { weaponGroup: "bow" }, recipe: {} }
    ]);
    const api = { automation: { rules, presets: {} } };
    await load(api);
    const app = api.ui.openRulesManager();
    let context = await app._prepareContext({});
    expect(context).toMatchObject({ noQuery: true, state: { query: "", sort: "priority" } });
    expect(Object.keys(context.sorts)).toEqual(["priority", "label", "id"]);
    expect(context.ruleIdPrefix).toBe(`${app.id}-rule`);
    app.viewState.sort = "id";
    expect((await app._prepareContext({})).rows.map((r) => r.id)).toEqual(["a", "b"]);
    app.viewState.query = "bow";
    context = await app._prepareContext({});
    expect(context.rows.map((r) => r.id)).toEqual(["b"]);
    app.viewState.query = "nothing";
    context = await app._prepareContext({});
    expect(context.rows).toEqual([]);
    expect(context.emptyKey).toBe("SVA.UI.Rules.NoMatches");
  });

  it("asks before discarding unsaved edits", async () => {
    const rules = createRulesApi([
      { id: "a", label: "A", priority: 1, enabled: true, match: { key: "a" }, recipe: { preset: "melee" } },
      { id: "b", label: "B", priority: 2, enabled: true, match: { key: "b" }, recipe: { preset: "melee" } }
    ]);
    const api = { automation: { rules, presets: {} } };
    await load(api);
    const app = api.ui.openRulesManager();
    await app._prepareContext({});
    const actions = app.constructor.DEFAULT_OPTIONS.actions;
    const row = (id) => ({ closest: () => ({ dataset: { ruleId: id } }) });
    const dialog = globalThis.foundry.applications.api.DialogV2.confirm;

    await actions.editRule.call(app, {}, row("a"));
    expect(app.editing.rule.id).toBe("a");
    // Clean form: switching needs no confirmation.
    await actions.editRule.call(app, {}, row("b"));
    expect(dialog).not.toHaveBeenCalled();
    expect(app.editing.rule.id).toBe("b");

    app.dirty = true;
    dialog.mockResolvedValueOnce(false);
    await actions.editRule.call(app, {}, row("a"));
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(app.editing.rule.id).toBe("b");

    // Same rule again: keep the edits, no question.
    await actions.editRule.call(app, {}, row("b"));
    expect(dialog).toHaveBeenCalledTimes(1);

    dialog.mockResolvedValueOnce(false);
    await actions.addRule.call(app);
    expect(app.editing.isNew).toBe(false);
    dialog.mockResolvedValueOnce(false);
    await actions.cancelEdit.call(app);
    expect(app.editing).not.toBeNull();

    dialog.mockResolvedValueOnce(true);
    await actions.addRule.call(app);
    expect(app.editing.isNew).toBe(true);
    expect(app.dirty).toBe(false);
    await actions.cancelEdit.call(app);
    expect(app.editing).toBeNull();
    expect(dialog).toHaveBeenCalledTimes(4);
  });

  it("refuses to save a rule without a match criterion", async () => {
    const rules = createRulesApi([]);
    const api = { automation: { rules, presets: {} } };
    await load(api);
    const app = api.ui.openRulesManager();
    const listeners = {};
    const fire = (type, event = {}) => listeners[type]?.forEach((fn) => fn(event));
    const form = {
      dataset: {},
      elements: [
        { name: "rule.label", value: "No match" },
        { name: "rule.match.key", value: "" },
        { name: "recipe.preset", value: "melee" }
      ],
      addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
      querySelectorAll: () => []
    };
    const { setFakeElement } = await import("./helpers/fake-foundry.js");
    setFakeElement(app, { querySelector: (sel) => (sel === "form.sva-rule-form" ? form : null) });
    await app.constructor.DEFAULT_OPTIONS.actions.addRule.call(app);
    app._onRender({}, {});
    fire("submit", { preventDefault: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith("SVA.UI.Rules.NeedMatch");
    expect(rules.save).not.toHaveBeenCalled();

    fire("input", { target: form.elements[0] });
    expect(app.dirty).toBe(true);
    form.elements[1].value = "fire";
    fire("submit", { preventDefault: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rules.save).toHaveBeenCalledWith(expect.objectContaining({ match: { key: "fire" } }));
    expect(app.dirty).toBe(false);
  });
});
