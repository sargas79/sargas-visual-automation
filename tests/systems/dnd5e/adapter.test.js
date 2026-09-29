import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ADAPTERS } from "../../../src/systems/index.js";
import { init as initAutomation } from "../../../src/automation/index.js";
import Dnd5eAdapter, { SETTING_CONDITIONS } from "../../../src/systems/dnd5e/index.js";
import { addV1HeaderButton, addV2HeaderControl } from "../../../src/systems/dnd5e/sheet.js";
import { EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import { resetFoundryMock } from "../../setup/foundry-mock.js";
import {
  SCENE,
  d20Roll,
  installCanvas,
  mockActor,
  mockMessage,
  spells,
  targetDescriptor,
  weapons
} from "./helpers/fixtures.js";

function setup() {
  game.system.id = "dnd5e";
  const sword = weapons.longsword();
  const fireball = spells.fireball();
  const hero = mockActor("hero", { items: [sword, fireball] });
  const goblin = mockActor("goblin", { ac: 12 });
  installCanvas({ actors: [hero, goblin], targets: ["tok-goblin"] });
  const emit = vi.fn();
  const adapter = new Dnd5eAdapter({ api: {}, emit });
  adapter.register();
  return { adapter, emit, hero, goblin, sword, fireball };
}

describe("Dnd5eAdapter skeleton", () => {
  it("is a built-in adapter active for the dnd5e system", () => {
    expect(BUILTIN_ADAPTERS).toContain(Dnd5eAdapter);
    expect(Dnd5eAdapter.id).toBe("dnd5e");
    expect(Dnd5eAdapter.isActive()).toBe(false); // mock world is pf2e
    game.system.id = "dnd5e";
    expect(Dnd5eAdapter.isActive()).toBe(true);
    expect(new Dnd5eAdapter({}).rulePackUrl).toBe("modules/sargas-visual-automation/rules/dnd5e.json");
  });

  it("registers hooks once and unregisters them", () => {
    const { adapter } = setup();
    for (const hook of [
      "createChatMessage",
      "dnd5e.postUseActivity",
      "createRegion",
      "deleteRegion",
      "createMeasuredTemplate",
      "createActiveEffect",
      "deleteActiveEffect",
      "getHeaderControlsDocumentSheetV2"
    ]) {
      expect(Hooks._handlers.get(hook)?.length, hook).toBe(1);
    }
    adapter.register();
    expect(Hooks._handlers.get("createChatMessage").length).toBe(1);
    Hooks.off = vi.fn();
    adapter.unregister();
    expect(Hooks.off).toHaveBeenCalledWith("createChatMessage", expect.any(Function));
    expect(Hooks.off).toHaveBeenCalledWith("getHeaderControlsDocumentSheetV2", expect.any(Function));
  });

  it("uses dnd5e identifiers and descriptors", () => {
    const adapter = new Dnd5eAdapter({});
    expect(adapter.getItemKey(spells.fireBolt())).toBe("fire-bolt");
    expect(adapter.getItemDescriptors(weapons.longbow())).toMatchObject({ attackKind: "ranged", weaponGroup: "bow" });
  });
});

describe("hooks → events", () => {
  let env;
  beforeEach(() => {
    env = setup();
  });

  it("emits a whole weapon attack (CAST, ATTACK, DAMAGE) from the roller's client only", () => {
    const { emit, hero, goblin, sword } = env;
    const usage = mockMessage({
      id: "u1",
      type: "usage",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin)]
    });
    const attack = mockMessage({
      id: "a1",
      type: "attack",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin)],
      rolls: [d20Roll(14)],
      system: { origin: "u1", mode: "oneHanded" }
    });
    const damage = mockMessage({
      id: "d1",
      type: "damage",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin)]
    });
    for (const msg of [usage, attack, damage]) {
      Hooks.callAll("createChatMessage", msg, {}, "user2"); // another client created it
      Hooks.callAll("createChatMessage", msg, {}, "user1");
    }
    expect(emit.mock.calls.map(([e]) => e.id)).toEqual(["u1:cast", "a1:attack", "d1:damage"]);
    expect(emit.mock.calls[1][0].targets).toEqual([{ tokenId: "tok-goblin", outcome: OUTCOMES.SUCCESS }]);
  });

  it("does not emit the same message twice", () => {
    const { emit, hero, sword } = env;
    const msg = mockMessage({ type: "attack", actor: hero, item: sword, rolls: [d20Roll(14)] });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("postUseActivity emits CAST only without a usage card and never cancels the hook", () => {
    const { emit, sword } = env;
    const activity = sword.system.activities.values().next().value;
    const handler = Hooks._handlers.get("dnd5e.postUseActivity")[0].fn;
    expect(handler(activity, {}, { message: { id: "u1", documentName: "ChatMessage" } })).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    handler(activity, {}, { message: { content: "" } });
    expect(emit.mock.calls[0][0]).toMatchObject({ type: EVENT_TYPES.CAST, descriptors: { key: "longsword" } });
  });

  it("emits AREA_PLACED for the user's own template region and EFFECT_REMOVED when deleted", () => {
    const { emit, fireball } = env;
    const activity = fireball.system.activities.values().next().value;
    const doc = {
      id: "r1",
      uuid: `Scene.${SCENE}.Region.r1`,
      shapes: [{ type: "circle", x: 0, y: 0, radius: 400 }],
      flags: { dnd5e: { item: fireball.uuid, activity: activity.uuid } }
    };
    Hooks.callAll("createRegion", doc, {}, "user2");
    expect(emit).not.toHaveBeenCalled();
    Hooks.callAll("createRegion", doc, {}, "user1");
    Hooks.callAll("createRegion", doc, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ type: EVENT_TYPES.AREA_PLACED, area: { distance: 20 } });
    Hooks.callAll("deleteRegion", doc, {}, "user1");
    expect(emit.mock.calls[1][0]).toMatchObject({ type: EVENT_TYPES.EFFECT_REMOVED, descriptors: { key: "fireball" } });
  });

  it("emits effect events from the creating client, honouring the conditions setting", () => {
    const { emit, goblin } = env;
    Dnd5eAdapter.init();
    const prone = {
      id: "e1",
      uuid: "Actor.goblin.ActiveEffect.e1",
      parent: goblin,
      name: "Prone",
      type: "condition",
      statuses: new Set(["prone"]),
      system: { type: "prone" }
    };
    Hooks.callAll("createActiveEffect", prone, {}, "user2");
    Hooks.callAll("createActiveEffect", prone, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    Hooks.callAll("deleteActiveEffect", prone, {}, "user1");
    expect(emit.mock.calls[1][0].type).toBe(EVENT_TYPES.EFFECT_REMOVED);

    game.settings.set("sargas-visual-automation", SETTING_CONDITIONS, false);
    Hooks.callAll("createActiveEffect", { ...prone, uuid: "Actor.goblin.ActiveEffect.e2" }, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe("item sheet header control", () => {
  it("adds a V2 header control that opens the item config once", () => {
    const openItemConfig = vi.fn();
    const item = { documentName: "Item", isOwner: true };
    const app = { document: item, options: { actions: {} } };
    const controls = [];
    addV2HeaderControl({ ui: { openItemConfig } }, app, controls);
    addV2HeaderControl({ ui: { openItemConfig } }, app, controls);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ action: "svaItemConfig", label: "Animation" });
    app.options.actions.svaItemConfig();
    controls[0].onClick();
    expect(openItemConfig).toHaveBeenCalledTimes(2);
    expect(openItemConfig).toHaveBeenCalledWith(item);
  });

  it("warns without the UI, supports V1 sheets and skips other documents", () => {
    globalThis.ui = { notifications: { warn: vi.fn() } };
    const controls = [];
    addV2HeaderControl({}, { document: { documentName: "Item", isOwner: true } }, controls);
    controls[0].onClick();
    expect(ui.notifications.warn).toHaveBeenCalled();
    const buttons = [];
    addV1HeaderButton({}, { document: { documentName: "Item", isOwner: true } }, buttons);
    expect(buttons[0].class).toBe("sva-item-config");
    const none = [];
    addV2HeaderControl({}, { document: { documentName: "Actor" } }, none);
    expect(none).toHaveLength(0);
  });
});

describe("Dnd5eAdapter.init", () => {
  it("registers the dnd5e settings during the automation area's init, only in dnd5e worlds", () => {
    const id = `sargas-visual-automation.${SETTING_CONDITIONS}`;
    game.system.id = "dnd5e";
    initAutomation({});
    expect(game.settings._configs.get(id)).toMatchObject({ scope: "world", config: true, svaGroup: "systems" });

    resetFoundryMock();
    initAutomation({});
    expect(game.settings._configs.has(id)).toBe(false);
  });
});
