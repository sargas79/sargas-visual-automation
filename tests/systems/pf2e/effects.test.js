import { describe, expect, it, vi } from "vitest";
import Pf2eAdapter, { SETTING_CONDITIONS } from "../../../src/systems/pf2e/index.js";
import { eventFromEffectItem } from "../../../src/systems/pf2e/effects.js";
import { AREA_SHAPES, EVENT_TYPES } from "../../../src/shared/events.js";
import { effects, installCanvas, mockActor, weapons } from "./helpers/fixtures.js";

function setup() {
  const bless = effects.bless();
  const frightened = effects.frightened();
  const fighter = mockActor("fighter", { items: [bless, frightened] });
  const cleric = mockActor("cleric");
  installCanvas({ actors: [fighter, cleric] });
  const emit = vi.fn();
  Pf2eAdapter.init({});
  const adapter = new Pf2eAdapter({ api: {}, emit });
  adapter.register();
  return { adapter, emit, bless, frightened, fighter };
}

describe("effects & conditions", () => {
  it("effect item → EFFECT_APPLIED with aura size from the Aura rule element", () => {
    const { bless } = setup();
    expect(eventFromEffectItem(bless, EVENT_TYPES.EFFECT_APPLIED, { userId: "user1" })).toMatchObject({
      type: EVENT_TYPES.EFFECT_APPLIED,
      source: { tokenId: "tok-cleric", actorId: "cleric" },
      targets: [{ tokenId: "tok-fighter" }],
      itemUuid: bless.uuid,
      effectUuid: bless.uuid,
      descriptors: {
        key: "spell-effect-bless",
        type: "effect",
        area: { shape: AREA_SHAPES.EMANATION, size: 15 }
      }
    });
  });

  it("createItem / deleteItem hooks emit applied then removed for the acting user", () => {
    const { emit, bless } = setup();
    Hooks.callAll("createItem", bless, {}, "otherUser");
    expect(emit).not.toHaveBeenCalled();
    Hooks.callAll("createItem", bless, {}, "user1");
    Hooks.callAll("deleteItem", bless, {}, "user1");
    expect(emit.mock.calls.map((c) => c[0].type)).toEqual([EVENT_TYPES.EFFECT_APPLIED, EVENT_TYPES.EFFECT_REMOVED]);
    expect(emit.mock.calls.map((c) => c[0].id)).toEqual([`${bless.uuid}:effectApplied`, `${bless.uuid}:effectRemoved`]);
  });

  it("conditions are animated unless the setting is off", async () => {
    const { emit, frightened } = setup();
    Hooks.callAll("createItem", frightened, {}, "user1");
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: EVENT_TYPES.EFFECT_APPLIED,
      source: { tokenId: "tok-fighter", actorId: "fighter" },
      descriptors: { key: "frightened", type: "condition" }
    });
    await game.settings.set("sargas-visual-automation", SETTING_CONDITIONS, false);
    Hooks.callAll("deleteItem", frightened, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores other item types and unembedded effects", () => {
    const { emit, fighter } = setup();
    const sword = weapons.longsword();
    sword.parent = fighter;
    Hooks.callAll("createItem", sword, {}, "user1");
    const loose = effects.bless();
    loose.parent = null;
    Hooks.callAll("createItem", loose, {}, "user1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not announce effects on actors without tokens, but still announces removal", () => {
    const ghost = mockActor("ghost", { tokenIds: [], items: [effects.bless()] });
    const [bless] = ghost.items.values();
    expect(eventFromEffectItem(bless, EVENT_TYPES.EFFECT_APPLIED)).toBeNull();
    expect(eventFromEffectItem(bless, EVENT_TYPES.EFFECT_REMOVED)).toMatchObject({ targets: [] });
  });
});
