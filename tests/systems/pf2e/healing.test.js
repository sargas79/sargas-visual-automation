import { describe, expect, it, vi } from "vitest";
import Pf2eAdapter from "../../../src/systems/pf2e/index.js";
import { eventFromMessage } from "../../../src/systems/pf2e/messages.js";
import { EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import {
  checkContext,
  consumables,
  damageContext,
  damageRoll,
  feats,
  installCanvas,
  mockActor,
  mockMessage,
  spells,
  weapons
} from "./helpers/fixtures.js";

const CAST = ["origin:action:slug:cast-a-spell"];

describe("multi-target", () => {
  it("Force Barrage split across 3 targets → one CAST with 3 targets", () => {
    const barrage = spells.forceBarrage();
    const wizard = mockActor("wizard", { items: [barrage] });
    const gobs = ["g1", "g2", "g3"].map((id) => mockActor(id));
    installCanvas({ actors: [wizard, ...gobs], targets: ["tok-g1", "tok-g2", "tok-g3"] });
    const emit = vi.fn();
    new Pf2eAdapter({ api: {}, emit }).register();
    const msg = mockMessage({
      actor: wizard,
      item: barrage,
      origin: { actor: wizard.uuid, uuid: barrage.uuid, type: "spell", castRank: 1, rollOptions: CAST }
    });
    Hooks.callAll("createChatMessage", msg, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].targets).toEqual([
      { tokenId: "tok-g1" },
      { tokenId: "tok-g2" },
      { tokenId: "tok-g3" }
    ]);
  });

  it("per-target outcomes come from one message per target; ambiguous targets carry no outcome", () => {
    const sword = weapons.longsword();
    const hero = mockActor("hero", { items: [sword] });
    const a = mockActor("a");
    const b = mockActor("b");
    installCanvas({ actors: [hero, a, b], targets: ["tok-a", "tok-b"] });
    const withTarget = eventFromMessage(
      mockMessage({ actor: hero, item: sword, context: checkContext("attack-roll", { actor: hero, target: b }) })
    );
    expect(withTarget.targets).toEqual([{ tokenId: "tok-b", outcome: OUTCOMES.SUCCESS }]);
    const ctx = checkContext("attack-roll", { actor: hero });
    const untargeted = eventFromMessage(mockMessage({ actor: hero, item: sword, context: ctx }));
    expect(untargeted.targets).toEqual([{ tokenId: "tok-a" }, { tokenId: "tok-b" }]);
  });
});

describe("healing", () => {
  it("Heal's healing roll → HEALING (vitality damage+healing kinds on a healing-trait spell)", () => {
    const heal = spells.heal();
    const cleric = mockActor("cleric", { items: [heal] });
    const ally = mockActor("ally");
    installCanvas({ actors: [cleric, ally], targets: ["tok-ally"] });
    const ev = eventFromMessage(
      mockMessage({
        actor: cleric,
        item: heal,
        context: damageContext({ actor: cleric, outcome: null, sourceType: "save" }),
        rolls: [damageRoll(["damage", "healing"], "(1d8+8)[vitality,healing]")]
      })
    );
    expect(ev).toMatchObject({
      type: EVENT_TYPES.HEALING,
      targets: [{ tokenId: "tok-ally" }],
      descriptors: { key: "heal", isHealing: true }
    });
  });

  it("Harm (no healing trait) stays DAMAGE; a pure healing roll is always HEALING", () => {
    const harm = spells.harm();
    const cleric = mockActor("cleric", { items: [harm] });
    installCanvas({ actors: [cleric] });
    const dmg = eventFromMessage(
      mockMessage({
        actor: cleric,
        item: harm,
        context: damageContext({ actor: cleric }),
        rolls: [damageRoll(["damage", "healing"])]
      })
    );
    expect(dmg.type).toBe(EVENT_TYPES.DAMAGE);
    const heal = eventFromMessage(
      mockMessage({
        actor: cleric,
        item: harm,
        context: damageContext({ actor: cleric }),
        rolls: [damageRoll(["healing"])]
      })
    );
    expect(heal.type).toBe(EVENT_TYPES.HEALING);
  });

  it("drinking a healing potion → HEALING on the drinker", () => {
    const potion = consumables.healingPotion();
    const hero = mockActor("hero", { items: [potion] });
    installCanvas({ actors: [hero] });
    // consumable/document.ts#consume: DamageRoll "(1d8)[vitality,healing]" with flags.pf2e.origin {uuid, type}
    const ev = eventFromMessage(
      mockMessage({
        actor: hero,
        item: null,
        origin: { uuid: potion.uuid, type: "consumable" },
        rolls: [damageRoll(["healing"], "(1d8)[vitality,healing]")]
      })
    );
    expect(ev).toMatchObject({
      type: EVENT_TYPES.HEALING,
      source: { tokenId: "tok-hero" },
      targets: [{ tokenId: "tok-hero" }],
      itemUuid: potion.uuid,
      descriptors: { type: "consumable", isHealing: true, traits: expect.arrayContaining(["potion"]) }
    });
  });

  it("Battle Medicine check → HEALING with the check outcome, using the actor's feat", () => {
    const feat = feats.battleMedicine();
    const medic = mockActor("medic", { items: [feat] });
    const ally = mockActor("ally");
    installCanvas({ actors: [medic, ally] });
    const ev = eventFromMessage(
      mockMessage({
        actor: medic,
        item: null,
        origin: null,
        context: checkContext("skill-check", {
          actor: medic,
          target: ally,
          outcome: "criticalSuccess",
          domains: ["medicine", "skill-check"],
          options: ["action:battle-medicine", "self:action:slug:battle-medicine"]
        })
      })
    );
    expect(ev).toMatchObject({
      type: EVENT_TYPES.HEALING,
      outcome: OUTCOMES.CRITICAL_SUCCESS,
      targets: [{ tokenId: "tok-ally", outcome: OUTCOMES.CRITICAL_SUCCESS }],
      itemUuid: feat.uuid,
      descriptors: { key: "battle-medicine", isHealing: true }
    });
  });

  it("other skill checks are ignored", () => {
    const hero = mockActor("hero");
    installCanvas({ actors: [hero] });
    const msg = mockMessage({
      actor: hero,
      origin: null,
      context: checkContext("skill-check", { actor: hero, options: ["action:demoralize"] })
    });
    expect(eventFromMessage(msg)).toBeNull();
  });
});
