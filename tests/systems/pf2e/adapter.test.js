import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ADAPTERS } from "../../../src/systems/index.js";
import Pf2eAdapter from "../../../src/systems/pf2e/index.js";
import { mapOutcome, tokenIdFromUuid } from "../../../src/systems/pf2e/messages.js";
import { addV1HeaderButton, addV2HeaderControl } from "../../../src/systems/pf2e/sheet.js";
import { EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import {
  checkContext,
  checkRoll,
  damageContext,
  damageRoll,
  installCanvas,
  mockActor,
  mockMessage,
  spells,
  weapons
} from "./helpers/fixtures.js";

function setup() {
  const sword = weapons.longsword();
  const hero = mockActor("hero", { items: [sword] });
  const goblin = mockActor("goblin");
  installCanvas({ actors: [hero, goblin], targets: ["tok-goblin"] });
  const emit = vi.fn();
  const adapter = new Pf2eAdapter({ api: {}, emit });
  adapter.register();
  return { adapter, emit, hero, goblin, sword };
}

describe("Pf2eAdapter skeleton", () => {
  it("is a built-in adapter active for the pf2e system", () => {
    expect(BUILTIN_ADAPTERS).toContain(Pf2eAdapter);
    expect(Pf2eAdapter.id).toBe("pf2e");
    expect(Pf2eAdapter.isActive()).toBe(true);
    game.system.id = "dnd5e";
    expect(Pf2eAdapter.isActive()).toBe(false);
  });

  it("registers hooks once and unregisters them", () => {
    const { adapter } = setup();
    const count = Hooks._handlers.get("createChatMessage").length;
    adapter.register();
    expect(Hooks._handlers.get("createChatMessage").length).toBe(count);
    Hooks.off = vi.fn();
    adapter.unregister();
    expect(Hooks.off).toHaveBeenCalledWith("createChatMessage", expect.any(Function));
  });

  it("uses the PF2e slug as item key", () => {
    const adapter = new Pf2eAdapter({});
    expect(adapter.getItemKey(spells.forceBarrage())).toBe("force-barrage");
    expect(adapter.getItemKey({ name: "Homebrew Bolt!", type: "spell", system: {} })).toBe("homebrew-bolt");
    expect(adapter.getItemKey(null)).toBeNull();
  });

  it("maps PF2e degrees of success", () => {
    expect(mapOutcome("criticalSuccess")).toBe(OUTCOMES.CRITICAL_SUCCESS);
    expect(mapOutcome("criticalFailure")).toBe(OUTCOMES.CRITICAL_FAILURE);
    expect(mapOutcome(2)).toBe(OUTCOMES.SUCCESS);
    expect(mapOutcome(null)).toBe(OUTCOMES.NONE);
    expect(tokenIdFromUuid("Scene.s1.Token.abc")).toBe("abc");
  });
});

describe("createChatMessage → events", () => {
  let env;
  beforeEach(() => {
    env = setup();
  });

  it("strike attack roll emits one ATTACK with the per-target outcome", () => {
    const { emit, hero, goblin, sword } = env;
    const msg = mockMessage({
      actor: hero,
      item: sword,
      context: checkContext("attack-roll", { actor: hero, target: goblin, outcome: "criticalSuccess" }),
      rolls: [checkRoll()]
    });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: EVENT_TYPES.ATTACK,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-goblin", outcome: OUTCOMES.CRITICAL_SUCCESS }],
      outcome: OUTCOMES.CRITICAL_SUCCESS,
      itemUuid: sword.uuid,
      sceneId: "scene1",
      userId: "user1",
      descriptors: { key: "longsword", type: "weapon", weaponGroup: "sword", attackKind: "melee" }
    });
  });

  it("damage roll emits one DAMAGE", () => {
    const { emit, hero, goblin, sword } = env;
    const msg = mockMessage({
      actor: hero,
      item: sword,
      context: damageContext({ actor: hero, target: goblin, outcome: "success" }),
      rolls: [damageRoll()]
    });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ type: EVENT_TYPES.DAMAGE, targets: [{ tokenId: "tok-goblin" }] });
  });

  it("spell cast emits one CAST with the caster's targets", () => {
    const { emit, hero } = env;
    const spell = spells.forceBarrage();
    const msg = mockMessage({
      actor: hero,
      item: spell,
      origin: { actor: hero.uuid, uuid: spell.uuid, type: "spell", rollOptions: ["origin:action:slug:cast-a-spell"] }
    });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: EVENT_TYPES.CAST,
      targets: [{ tokenId: "tok-goblin" }],
      descriptors: { key: "force-barrage", type: "spell", damageTypes: ["force"] }
    });
  });

  it("only the originating user emits", () => {
    const { emit, hero, sword } = env;
    const msg = mockMessage({ actor: hero, item: sword, context: checkContext("attack-roll", { actor: hero }) });
    Hooks.callAll("createChatMessage", msg, {}, "someoneElse");
    expect(emit).not.toHaveBeenCalled();
  });

  it("handles a message only once", () => {
    const { emit, hero, sword } = env;
    const msg = mockMessage({ actor: hero, item: sword, context: checkContext("attack-roll", { actor: hero }) });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores rerolls, applied damage, spells posted without casting and item-less checks", () => {
    const { emit, hero, sword } = env;
    const spell = spells.fireball();
    const messages = [
      mockMessage({
        actor: hero,
        item: sword,
        context: checkContext("attack-roll", { actor: hero, isReroll: true })
      }),
      mockMessage({ actor: hero, context: { type: "damage-taken" }, origin: null }),
      mockMessage({
        actor: hero,
        item: spell,
        origin: { actor: hero.uuid, uuid: spell.uuid, type: "spell", rollOptions: ["origin:item:slug:fireball"] }
      }),
      mockMessage({ actor: hero, context: checkContext("perception-check", { actor: hero }), origin: null }),
      mockMessage({ actor: hero, context: checkContext("saving-throw", { actor: hero }), origin: null }),
      { id: "plain", flags: {}, speaker: {} }
    ];
    for (const msg of messages) Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("hides the degree of success of blind rolls", () => {
    const { emit, hero, goblin, sword } = env;
    const msg = mockMessage({
      actor: hero,
      item: sword,
      blind: true,
      context: checkContext("attack-roll", { actor: hero, target: goblin, outcome: "failure" })
    });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit.mock.calls[0][0].outcome).toBe(OUTCOMES.NONE);
  });
});

describe("item sheet header control", () => {
  it("adds a V1 header button that opens the item config", () => {
    const openItemConfig = vi.fn();
    const item = { documentName: "Item", isOwner: true };
    const buttons = [{ class: "close" }];
    addV1HeaderButton({ ui: { openItemConfig } }, { document: item }, buttons);
    expect(buttons[0].class).toBe("sva-item-config");
    buttons[0].onclick();
    expect(openItemConfig).toHaveBeenCalledWith(item);
    addV1HeaderButton({ ui: { openItemConfig } }, { document: item }, buttons);
    expect(buttons.filter((b) => b.class === "sva-item-config")).toHaveLength(1);
  });

  it("adds a V2 header control and guards a missing UI", () => {
    const item = { documentName: "Item", isOwner: true };
    const app = { document: item, options: { actions: {} } };
    const controls = [];
    globalThis.ui = { notifications: { warn: vi.fn() } };
    addV2HeaderControl({}, app, controls);
    expect(controls[0]).toMatchObject({ action: "svaItemConfig" });
    app.options.actions.svaItemConfig();
    expect(ui.notifications.warn).toHaveBeenCalled();
  });

  it("skips non-item documents", () => {
    const buttons = [];
    addV1HeaderButton({}, { document: { documentName: "Actor" } }, buttons);
    expect(buttons).toHaveLength(0);
  });
});
