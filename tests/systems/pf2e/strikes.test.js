import { describe, expect, it } from "vitest";
import { describeItem } from "../../../src/systems/pf2e/descriptors.js";
import { eventFromMessage } from "../../../src/systems/pf2e/messages.js";
import { ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import { checkContext, installCanvas, mockActor, mockMessage, npcAttacks, weapons } from "./helpers/fixtures.js";

function strike(item, { outcome = "success", altUsage, mapIncreases = 0 } = {}) {
  const hero = mockActor("hero", { items: [item] });
  const goblin = mockActor("goblin");
  installCanvas({ actors: [hero, goblin] });
  const context = checkContext("attack-roll", { actor: hero, target: goblin, outcome, mapIncreases });
  if (altUsage !== undefined) context.altUsage = altUsage;
  return eventFromMessage(mockMessage({ actor: hero, item, context }), { userId: "user1" });
}

describe("strike descriptors", () => {
  it("longsword: melee, sword group, slashing", () => {
    expect(describeItem(weapons.longsword())).toMatchObject({
      key: "longsword",
      type: "weapon",
      attackKind: ATTACK_KINDS.MELEE,
      weaponGroup: "sword",
      baseItem: "longsword",
      range: null,
      damageTypes: ["slashing"],
      isHealing: false
    });
  });

  it("shortbow: ranged, bow group, 60 ft increment", () => {
    expect(describeItem(weapons.shortbow())).toMatchObject({
      attackKind: ATTACK_KINDS.RANGED,
      weaponGroup: "bow",
      range: 60,
      damageTypes: ["piercing"]
    });
  });

  it("dagger: melee usage by default, thrown usage from the alt-usage clone or context", () => {
    expect(describeItem(weapons.dagger()).attackKind).toBe(ATTACK_KINDS.MELEE);
    expect(describeItem(weapons.daggerThrown())).toMatchObject({
      attackKind: ATTACK_KINDS.THROWN,
      weaponGroup: "knife",
      range: 10
    });
    expect(describeItem(weapons.dagger(), { altUsage: "thrown" }).attackKind).toBe(ATTACK_KINDS.THROWN);
  });

  it("basic unarmed attack (fist): melee brawling", () => {
    expect(describeItem(weapons.fist())).toMatchObject({
      key: "basic-unarmed",
      attackKind: ATTACK_KINDS.MELEE,
      weaponGroup: "brawling",
      traits: expect.arrayContaining(["unarmed"])
    });
  });

  it("NPC natural attacks: jaws and claw are in the natural group with a natural base", () => {
    expect(describeItem(npcAttacks.jaws())).toMatchObject({
      key: "jaws",
      type: "weapon",
      attackKind: ATTACK_KINDS.MELEE,
      weaponGroup: "natural",
      baseItem: "jaws",
      damageTypes: ["piercing"]
    });
    expect(describeItem(npcAttacks.claw())).toMatchObject({ weaponGroup: "natural", baseItem: "claw" });
    // A creature's weapon strike keeps its group; an NPC "Fist" is still brawling.
    const spear = npcAttacks.spear();
    spear.system.group = "spear";
    expect(describeItem(spear).weaponGroup).toBe("spear");
    const fist = npcAttacks.claw();
    Object.assign(fist, { name: "Fist", slug: "fist" });
    expect(describeItem(fist).weaponGroup).toBe("brawling");
  });

  it("carries the creature's traits and size as actorTraits", () => {
    const jaws = npcAttacks.jaws();
    jaws.parent = {
      documentName: "Actor",
      system: { traits: { value: ["dragon", "fire"], size: { value: "lg" } } }
    };
    expect(describeItem(jaws).actorTraits).toEqual(["dragon", "fire", "size:large"]);
    const loose = npcAttacks.claw();
    loose.parent = null;
    expect(describeItem(loose).actorTraits).toEqual([]);
  });

  it("bombs are thrown, mandatory-ranged groups are ranged without range data", () => {
    const bomb = weapons.shortbow();
    Object.assign(bomb.system, { group: "bomb", range: 20, traits: { value: ["alchemical", "splash", "thrown"] } });
    expect(describeItem(bomb).attackKind).toBe(ATTACK_KINDS.THROWN);
    const crossbow = weapons.shortbow();
    Object.assign(crossbow.system, { group: "crossbow", range: null });
    expect(describeItem(crossbow).attackKind).toBe(ATTACK_KINDS.RANGED);
  });

  it("NPC thrown attack uses range.increment and thrown-N trait", () => {
    expect(describeItem(npcAttacks.spear())).toMatchObject({ attackKind: ATTACK_KINDS.THROWN, range: 20 });
  });
});

describe("strike events", () => {
  it("emits ATTACK with degree of success, independent of MAP", () => {
    const first = strike(weapons.longsword(), { outcome: "criticalSuccess" });
    const third = strike(weapons.longsword(), { outcome: "criticalSuccess", mapIncreases: 2 });
    expect(first.type).toBe(EVENT_TYPES.ATTACK);
    expect(first.outcome).toBe(OUTCOMES.CRITICAL_SUCCESS);
    expect(third.outcome).toBe(first.outcome);
    expect(third.descriptors).toEqual(first.descriptors);
  });

  it.each([
    ["miss", "failure", OUTCOMES.FAILURE],
    ["fumble", "criticalFailure", OUTCOMES.CRITICAL_FAILURE]
  ])("reports a %s on the target", (_label, pf2e, outcome) => {
    const ev = strike(weapons.shortbow(), { outcome: pf2e });
    expect(ev.targets).toEqual([{ tokenId: "tok-goblin", outcome }]);
    expect(ev.descriptors.attackKind).toBe(ATTACK_KINDS.RANGED);
  });

  it("thrown dagger strike (context.altUsage = thrown)", () => {
    const ev = strike(weapons.dagger(), { altUsage: "thrown" });
    expect(ev.descriptors).toMatchObject({ key: "dagger", attackKind: ATTACK_KINDS.THROWN, weaponGroup: "knife" });
  });

  it("fist and jaws strikes", () => {
    expect(strike(weapons.fist()).descriptors).toMatchObject({ weaponGroup: "brawling", key: "basic-unarmed" });
    expect(strike(npcAttacks.jaws()).descriptors).toMatchObject({ weaponGroup: "natural", key: "jaws" });
  });
});
