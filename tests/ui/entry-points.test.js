import { describe, expect, it, vi } from "vitest";
import {
  OVERVIEW_ACTION,
  addTokenHudButton,
  addV1HeaderButton,
  addV2HeaderControl,
  canOpenOverview,
  controlledActor,
  openForControlled,
  registerOverviewEntryPoints
} from "../../src/ui/entry-points.js";
import { init, onGetSceneControlButtons } from "../../src/ui/index.js";

const actor = { documentName: "Actor", id: "a1", uuid: "Actor.a1", isOwner: true };

/** Tiny DOM stand-in: a HUD root with a right column. */
function fakeHud() {
  const children = [];
  const makeButton = () => {
    const listeners = {};
    return {
      dataset: {},
      setAttribute() {},
      addEventListener: (name, fn) => (listeners[name] = fn),
      click: () => listeners.click?.({ preventDefault() {}, stopPropagation() {} })
    };
  };
  const column = {
    children,
    append: (el) => children.push(el),
    querySelector: (sel) => children.find((c) => sel.includes(c.dataset.svaAction)) ?? null
  };
  const root = {
    ownerDocument: { createElement: makeButton },
    querySelector: (sel) => (sel === ".col.right" ? column : null)
  };
  return { root, column };
}

describe("overview entry points", () => {
  it("only offers the overview to owners and GMs", () => {
    game.user.isGM = false;
    expect(canOpenOverview({ isOwner: false })).toBe(false);
    expect(canOpenOverview({ isOwner: true })).toBe(true);
    game.user.isGM = true;
    expect(canOpenOverview({ isOwner: false })).toBe(true);
    expect(canOpenOverview(null)).toBe(false);
  });

  it("adds one token HUD button that opens the token's actor", () => {
    const open = vi.fn();
    const { root, column } = fakeHud();
    expect(addTokenHudButton(open, { actor }, root)).toBe(true);
    expect(addTokenHudButton(open, { actor }, root)).toBe(false);
    expect(column.children).toHaveLength(1);
    expect(column.children[0].className).toContain("control-icon");
    column.children[0].click();
    expect(open).toHaveBeenCalledWith(actor);
  });

  it("skips the HUD button without an actor", () => {
    const { root, column } = fakeHud();
    expect(addTokenHudButton(vi.fn(), { actor: null }, root)).toBe(false);
    expect(column.children).toHaveLength(0);
  });

  it("adds a V1 actor sheet header button once, for actors only", () => {
    const open = vi.fn();
    const buttons = [{ class: "close" }];
    expect(addV1HeaderButton(open, { object: actor }, buttons)).toBe(true);
    expect(addV1HeaderButton(open, { object: actor }, buttons)).toBe(false);
    expect(buttons[0].class).toBe("sva-actor-overview");
    buttons[0].onclick();
    expect(open).toHaveBeenCalledWith(actor);
    expect(addV1HeaderButton(open, { object: { documentName: "Item", isOwner: true } }, [])).toBe(false);
  });

  it("adds a V2 actor sheet header control and its action", () => {
    const open = vi.fn();
    const app = { document: actor, options: { actions: {} } };
    const controls = [];
    expect(addV2HeaderControl(open, app, controls)).toBe(true);
    expect(addV2HeaderControl(open, app, controls)).toBe(false);
    expect(controls).toHaveLength(1);
    expect(controls[0].action).toBe(OVERVIEW_ACTION);
    app.options.actions[OVERVIEW_ACTION]();
    controls[0].onClick();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("registers and unregisters its hooks", () => {
    const on = vi.fn();
    const off = vi.fn();
    globalThis.Hooks = { on, off };
    const unregister = registerOverviewEntryPoints(vi.fn());
    const names = on.mock.calls.map(([name]) => name);
    expect(names).toEqual(["renderTokenHUD", "getActorSheetHeaderButtons", "getHeaderControlsActorSheetV2"]);
    unregister();
    expect(off).toHaveBeenCalledTimes(3);
  });

  it("opens the controlled token's actor, or warns", () => {
    const open = vi.fn();
    globalThis.ui = { notifications: { warn: vi.fn() } };
    globalThis.canvas = { tokens: { controlled: [{ actor: null }, { actor }] } };
    expect(controlledActor()).toBe(actor);
    openForControlled(open);
    expect(open).toHaveBeenCalledWith(actor);
    globalThis.canvas = { tokens: { controlled: [] } };
    openForControlled(open);
    expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
    delete globalThis.canvas;
    delete globalThis.ui;
  });

  it("adds the overview button to the token controls", () => {
    init({});
    const controls = { tokens: { tools: {} } };
    onGetSceneControlButtons(controls);
    expect(Object.keys(controls.tokens.tools)).toEqual(["svaBrowser", "svaOverview"]);
    expect(controls.tokens.tools.svaOverview).toMatchObject({ button: true, title: "SVA.UI.Overview.SceneControl" });
  });
});
