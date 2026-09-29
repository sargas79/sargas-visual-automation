import { describe, expect, it } from "vitest";
import { WEAPON_GROUPS, describeItem, itemKey, mapArea } from "../../../src/systems/dnd5e/descriptors.js";
import { AREA_SHAPES, ATTACK_KINDS } from "../../../src/shared/events.js";
import { consumables, spells, weapons } from "./helpers/fixtures.js";

/** DND5E.weaponIds (module/config.mjs, release-6.0.5). */
const WEAPON_IDS = [
  "battleaxe",
  "blowgun",
  "club",
  "dagger",
  "dart",
  "flail",
  "glaive",
  "greataxe",
  "greatclub",
  "greatsword",
  "halberd",
  "handaxe",
  "handcrossbow",
  "heavycrossbow",
  "javelin",
  "lance",
  "lightcrossbow",
  "lighthammer",
  "longbow",
  "longsword",
  "mace",
  "maul",
  "morningstar",
  "musket",
  "pike",
  "pistol",
  "quarterstaff",
  "rapier",
  "scimitar",
  "shortsword",
  "sickle",
  "spear",
  "shortbow",
  "sling",
  "trident",
  "warpick",
  "warhammer",
  "whip"
];

describe("dnd5e item keys", () => {
  it("uses system.identifier, then a slug of the name", () => {
    expect(itemKey(spells.fireBolt())).toBe("fire-bolt");
    expect(itemKey({ name: "Hunter's Mark", system: {} })).toBe("hunters-mark");
    expect(itemKey({ name: "Homebrew Bolt!", system: { identifier: "" } })).toBe("homebrew-bolt");
    expect(itemKey(null)).toBeNull();
  });

  it("never throws on odd items", () => {
    for (const odd of [null, {}, { type: "weapon" }, { type: "spell", system: { activities: null } }]) {
      expect(() => describeItem(odd)).not.toThrow();
    }
  });
});

describe("dnd5e weapons", () => {
  it("describes a longsword", () => {
    expect(describeItem(weapons.longsword())).toMatchObject({
      key: "longsword",
      type: "weapon",
      attackKind: ATTACK_KINDS.MELEE,
      weaponGroup: "sword",
      baseItem: "longsword",
      range: 5,
      damageTypes: ["slashing"],
      isHealing: false
    });
    expect(describeItem(weapons.longsword()).traits).toEqual(
      expect.arrayContaining(["versatile", "martial", "attack"])
    );
  });

  it("keeps the base weapon of magic variants", () => {
    expect(describeItem(weapons.sunBlade())).toMatchObject({
      key: "sun-blade",
      baseItem: "longsword",
      weaponGroup: "sword"
    });
  });

  it("uses the attack mode for thrown / melee daggers", () => {
    const dagger = weapons.dagger();
    expect(describeItem(dagger).attackKind).toBe(ATTACK_KINDS.MELEE);
    expect(describeItem(dagger, { attackMode: "thrown" }).attackKind).toBe(ATTACK_KINDS.THROWN);
    expect(describeItem(dagger, { attackMode: "thrown-offhand" }).attackKind).toBe(ATTACK_KINDS.THROWN);
    expect(describeItem(dagger, { attackMode: "offhand" }).attackKind).toBe(ATTACK_KINDS.MELEE);
    expect(describeItem(dagger).weaponGroup).toBe("knife");
  });

  it("maps ranged and thrown ranged weapons", () => {
    expect(describeItem(weapons.longbow())).toMatchObject({
      attackKind: ATTACK_KINDS.RANGED,
      weaponGroup: "bow",
      range: 150
    });
    expect(describeItem(weapons.dart())).toMatchObject({ attackKind: ATTACK_KINDS.THROWN, weaponGroup: "dart" });
  });

  it("maps unarmed and natural weapons", () => {
    expect(describeItem(weapons.unarmedStrike())).toMatchObject({
      key: "unarmed-strike",
      attackKind: ATTACK_KINDS.MELEE,
      weaponGroup: "brawling",
      baseItem: "unarmed"
    });
    expect(describeItem(weapons.claw())).toMatchObject({ attackKind: ATTACK_KINDS.MELEE, weaponGroup: null });
    expect(describeItem(weapons.claw()).traits).toContain("natural");
  });

  it("has a PF2e-vocabulary group for every dnd5e base weapon", () => {
    const pf2eGroups = ["axe", "bow", "club", "crossbow", "dart", "firearm", "flail", "hammer", "knife", "pick"];
    const more = ["polearm", "sling", "spear", "sword"];
    for (const id of WEAPON_IDS) expect([...pf2eGroups, ...more], id).toContain(WEAPON_GROUPS[id]);
  });
});

describe("dnd5e spells", () => {
  it("describes an attack cantrip", () => {
    const d = describeItem(spells.fireBolt());
    expect(d).toMatchObject({ key: "fire-bolt", type: "spell", attackKind: ATTACK_KINDS.RANGED, range: 120 });
    expect(d.damageTypes).toEqual(["fire"]);
    expect(d.traits).toEqual(expect.arrayContaining(["evocation", "cantrip", "attack", "fire"]));
  });

  it("uses melee for touch spell attacks", () => {
    expect(describeItem(spells.shockingGrasp())).toMatchObject({ attackKind: ATTACK_KINDS.MELEE, range: 5 });
  });

  it("reads the area from the template", () => {
    expect(describeItem(spells.fireball()).area).toEqual({ shape: AREA_SHAPES.BURST, size: 20 });
    expect(describeItem(spells.burningHands()).area).toEqual({ shape: AREA_SHAPES.CONE, size: 15 });
    expect(describeItem(spells.spiritGuardians()).area).toEqual({ shape: AREA_SHAPES.EMANATION, size: 15 });
    expect(mapArea({ type: "cube", size: 15 })).toEqual({ shape: AREA_SHAPES.SQUARE, size: 15 });
    expect(mapArea({ type: "line", size: "100" })).toEqual({ shape: AREA_SHAPES.LINE, size: 100 });
    expect(mapArea({ type: "sphere", size: "5 * @item.level" })).toBeNull();
  });

  it("flags healing spells and potions", () => {
    expect(describeItem(spells.cureWounds())).toMatchObject({ isHealing: true, damageTypes: [] });
    expect(describeItem(spells.cureWounds()).traits).toContain("healing");
    expect(describeItem(spells.revivify()).isHealing).toBe(true);
    expect(describeItem(spells.fireball()).isHealing).toBe(false);
    expect(describeItem(consumables.potionOfHealing())).toMatchObject({ type: "consumable", isHealing: true });
    expect(describeItem(consumables.potionOfHealing()).traits).toEqual(expect.arrayContaining(["potion", "healing"]));
  });

  it("adds concentration and school traits", () => {
    expect(describeItem(spells.bless()).traits).toEqual(expect.arrayContaining(["enchantment", "concentration"]));
  });
});
