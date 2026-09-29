import { beforeEach, describe, expect, it } from "vitest";
import {
  attackOutcome,
  eventFromActivityUse,
  eventFromMessage,
  saveOutcome,
  tokenIdFromUuid
} from "../../../src/systems/dnd5e/messages.js";
import { ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import {
  consumables,
  d20Roll,
  damageRoll,
  installCanvas,
  mockActor,
  mockMessage,
  spells,
  targetDescriptor,
  weapons
} from "./helpers/fixtures.js";

let env;
beforeEach(() => {
  const sword = weapons.longsword();
  const dagger = weapons.dagger();
  const fireball = spells.fireball();
  const fireBolt = spells.fireBolt();
  const cure = spells.cureWounds();
  const revivify = spells.revivify();
  const potion = consumables.potionOfHealing();
  const missile = spells.magicMissile();
  const hero = mockActor("hero", { items: [sword, dagger, fireball, fireBolt, cure, revivify, potion, missile] });
  const goblin = mockActor("goblin", { ac: 13 });
  const orc = mockActor("orc", { ac: 18 });
  installCanvas({ actors: [hero, goblin, orc], targets: ["tok-goblin"] });
  env = { hero, goblin, orc, sword, dagger, fireball, fireBolt, cure, revivify, potion, missile };
});

describe("outcomes", () => {
  it("compares attack totals to AC, natural 20 / 1 win", () => {
    expect(attackOutcome(d20Roll(15), 13)).toBe(OUTCOMES.SUCCESS);
    expect(attackOutcome(d20Roll(13), 13)).toBe(OUTCOMES.SUCCESS);
    expect(attackOutcome(d20Roll(12), 13)).toBe(OUTCOMES.FAILURE);
    expect(attackOutcome(d20Roll(8, { natural: 20 }), 30)).toBe(OUTCOMES.CRITICAL_SUCCESS);
    expect(attackOutcome(d20Roll(25, { natural: 1 }), 13)).toBe(OUTCOMES.CRITICAL_FAILURE);
    expect(attackOutcome(d20Roll(25), null)).toBe(OUTCOMES.FAILURE); // total cover
    expect(attackOutcome(d20Roll(3), undefined)).toBe(OUTCOMES.SUCCESS);
  });

  it("reads saves against the DC", () => {
    expect(saveOutcome(d20Roll(15, { target: 14 }))).toBe(OUTCOMES.SUCCESS);
    expect(saveOutcome(d20Roll(10, { target: 14 }))).toBe(OUTCOMES.FAILURE);
    expect(saveOutcome(d20Roll(10))).toBe(OUTCOMES.NONE);
    expect(tokenIdFromUuid("Scene.s1.Token.abc")).toBe("abc");
  });
});

describe("attack messages", () => {
  it("emits ATTACK with per-target hit / miss", () => {
    const { hero, goblin, orc, sword } = env;
    const msg = mockMessage({
      id: "m1",
      type: "attack",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin), targetDescriptor(orc)],
      rolls: [d20Roll(16)],
      system: { mode: "twoHanded" }
    });
    const event = eventFromMessage(msg, { userId: "user1" });
    expect(event).toMatchObject({
      id: "m1:attack",
      type: EVENT_TYPES.ATTACK,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [
        { tokenId: "tok-goblin", outcome: OUTCOMES.SUCCESS },
        { tokenId: "tok-orc", outcome: OUTCOMES.FAILURE }
      ],
      outcome: OUTCOMES.SUCCESS,
      itemUuid: sword.uuid,
      userId: "user1"
    });
    expect(event.descriptors).toMatchObject({ key: "longsword", attackKind: ATTACK_KINDS.MELEE, weaponGroup: "sword" });
  });

  it("marks a natural 20 as a critical on every target", () => {
    const { hero, orc, sword } = env;
    const msg = mockMessage({
      type: "attack",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(orc)],
      rolls: [d20Roll(9, { natural: 20 })]
    });
    const event = eventFromMessage(msg);
    expect(event.outcome).toBe(OUTCOMES.CRITICAL_SUCCESS);
    expect(event.targets[0].outcome).toBe(OUTCOMES.CRITICAL_SUCCESS);
  });

  it("marks a natural 1 as a fumble", () => {
    const { hero, goblin, sword } = env;
    const msg = mockMessage({
      type: "attack",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin)],
      rolls: [d20Roll(20, { natural: 1 })]
    });
    expect(eventFromMessage(msg).targets[0].outcome).toBe(OUTCOMES.CRITICAL_FAILURE);
  });

  it("uses the thrown attack mode", () => {
    const { hero, goblin, dagger } = env;
    const msg = mockMessage({
      type: "attack",
      actor: hero,
      item: dagger,
      targets: [targetDescriptor(goblin)],
      rolls: [d20Roll(18)],
      system: { mode: "thrown" }
    });
    expect(eventFromMessage(msg).descriptors).toMatchObject({ attackKind: ATTACK_KINDS.THROWN, baseItem: "dagger" });
  });

  it("falls back to the user's targets without stored targets", () => {
    const { hero, fireBolt } = env;
    const msg = mockMessage({ type: "attack", actor: hero, item: fireBolt, rolls: [d20Roll(18)] });
    expect(eventFromMessage(msg).targets).toEqual([{ tokenId: "tok-goblin", outcome: OUTCOMES.SUCCESS }]);
  });

  it("hides the result of blind rolls", () => {
    const { hero, orc, sword } = env;
    const msg = mockMessage({
      type: "attack",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(orc)],
      rolls: [d20Roll(2)]
    });
    msg.blind = true;
    const event = eventFromMessage(msg);
    expect(event.outcome).toBe(OUTCOMES.NONE);
    expect(event.targets[0].outcome).toBe(OUTCOMES.NONE);
  });
});

describe("usage, damage, healing and save messages", () => {
  it("usage card → CAST on the card's targets", () => {
    const { hero, goblin, orc, missile } = env;
    const msg = mockMessage({
      id: "u1",
      type: "usage",
      actor: hero,
      item: missile,
      targets: [targetDescriptor(goblin), targetDescriptor(orc)]
    });
    expect(eventFromMessage(msg)).toMatchObject({
      id: "u1:cast",
      type: EVENT_TYPES.CAST,
      targets: [{ tokenId: "tok-goblin" }, { tokenId: "tok-orc" }],
      outcome: OUTCOMES.NONE,
      descriptors: { key: "magic-missile", type: "spell" }
    });
  });

  it("damage roll → DAMAGE (critical when the roll is)", () => {
    const { hero, goblin, sword } = env;
    const msg = mockMessage({
      type: "damage",
      actor: hero,
      item: sword,
      targets: [targetDescriptor(goblin)],
      rolls: [damageRoll("slashing", { critical: true })]
    });
    expect(eventFromMessage(msg)).toMatchObject({
      type: EVENT_TYPES.DAMAGE,
      outcome: OUTCOMES.CRITICAL_SUCCESS,
      targets: [{ tokenId: "tok-goblin" }]
    });
  });

  it("heal activity roll → HEALING", () => {
    const { hero, goblin, cure } = env;
    const msg = mockMessage({
      type: "healing",
      actor: hero,
      item: cure,
      targets: [targetDescriptor(goblin)],
      rolls: [damageRoll("healing")]
    });
    expect(eventFromMessage(msg)).toMatchObject({
      type: EVENT_TYPES.HEALING,
      targets: [{ tokenId: "tok-goblin" }],
      descriptors: { key: "cure-wounds", isHealing: true }
    });
  });

  it("damage roll of a healing type → HEALING", () => {
    const { hero, goblin, revivify } = env;
    const msg = mockMessage({
      type: "damage",
      actor: hero,
      item: revivify,
      targets: [targetDescriptor(goblin)],
      rolls: [damageRoll("healing")]
    });
    expect(eventFromMessage(msg).type).toBe(EVENT_TYPES.HEALING);
  });

  it("a potion without targets heals the drinker", () => {
    const { hero, potion } = env;
    game.user.targets = new Set();
    const msg = mockMessage({ type: "healing", actor: hero, item: potion, rolls: [damageRoll("healing")] });
    expect(eventFromMessage(msg).targets).toEqual([{ tokenId: "tok-hero" }]);
  });

  it("activity save → SAVE on the saver, source = the caster", () => {
    const { goblin, fireball } = env;
    const msg = mockMessage({
      id: "s1",
      type: "save",
      actor: goblin,
      item: fireball,
      rolls: [d20Roll(9, { target: 15 })],
      system: { ability: "dex", type: "ability", origin: "u1" }
    });
    expect(eventFromMessage(msg)).toMatchObject({
      id: "s1:save",
      type: EVENT_TYPES.SAVE,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-goblin", outcome: OUTCOMES.FAILURE }],
      outcome: OUTCOMES.FAILURE,
      descriptors: { key: "fireball" }
    });
  });

  it("ignores concentration saves, checks and rolls without an item", () => {
    const { hero, fireball } = env;
    const conc = mockMessage({
      type: "save",
      actor: hero,
      item: fireball,
      rolls: [d20Roll(12, { target: 10 })],
      system: { type: "concentration" }
    });
    expect(eventFromMessage(conc)).toBeNull();
    expect(eventFromMessage(mockMessage({ type: "check", actor: hero, rolls: [d20Roll(12)] }))).toBeNull();
    expect(
      eventFromMessage(mockMessage({ type: "damage", actor: hero, rolls: [damageRoll("bludgeoning")] }))
    ).toBeNull();
    expect(eventFromMessage(null)).toBeNull();
  });

  it("reads the legacy dnd5e 5.x roll flag", () => {
    const { hero, goblin, sword } = env;
    const msg = mockMessage({ type: "base", actor: hero, item: sword, rolls: [d20Roll(17)] });
    msg.flags = {
      dnd5e: { roll: { type: "attack" }, item: { uuid: sword.uuid }, targets: [targetDescriptor(goblin)] }
    };
    msg.system = {};
    expect(eventFromMessage(msg)).toMatchObject({
      type: EVENT_TYPES.ATTACK,
      targets: [{ tokenId: "tok-goblin", outcome: OUTCOMES.SUCCESS }]
    });
  });
});

describe("postUseActivity fallback", () => {
  it("emits CAST only when no usage card was created", () => {
    const { missile } = env;
    const activity = missile.system.activities.values().next().value;
    expect(eventFromActivityUse(activity, { message: { id: "c1", documentName: "ChatMessage" } })).toBeNull();
    const event = eventFromActivityUse(activity, { message: { content: "not created" } }, { seq: 3 });
    expect(event).toMatchObject({
      id: `${activity.uuid}:cast:3`,
      type: EVENT_TYPES.CAST,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-goblin" }],
      descriptors: { key: "magic-missile" }
    });
  });
});
