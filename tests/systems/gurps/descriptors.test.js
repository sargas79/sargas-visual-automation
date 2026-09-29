import { describe, expect, it } from "vitest";
import GurpsAdapter from "../../../src/systems/gurps/index.js";
import {
  describeAttack,
  describeSpell,
  parseDamage,
  parseRange,
  splitMode,
  weaponGroupFromName
} from "../../../src/systems/gurps/descriptors.js";
import { findInList, walkList } from "../../../src/systems/gurps/actor-data.js";
import { list } from "./helpers/fixtures.js";

describe("GURPS damage strings", () => {
  it.each([
    ["2d+1 cut", ["cut"], []],
    ["sw+2 imp", ["imp"], []],
    ["1d+1 pi+, 1d burn", ["pi+", "burn"], []],
    ["3d(2) cut", ["cut"], []],
    ["6d burn ex", ["burn"], ["ex"]],
    ["1d-1 cr inc", ["cr"], ["inc"]],
    ["2d pi++", ["pi++"], []],
    ["1d tox", ["tox"], []],
    ["1d-2 cor", ["cor"], []],
    ["2d fat", ["fat"], []],
    ["4d-1 crushing", ["cr"], []],
    ["", [], []]
  ])("%s", (text, codes, modifiers) => {
    expect(parseDamage(text)).toEqual({ codes, modifiers });
  });

  it("maps codes to SVA damage types", () => {
    const types = (text) => describeAttack({ name: "Thing", damage: text }).damageTypes;
    expect(types("2d cut")).toEqual(["slashing"]);
    expect(types("2d cr")).toEqual(["bludgeoning"]);
    expect(types("2d imp")).toEqual(["piercing"]);
    expect(types("2d pi-")).toEqual(["piercing"]);
    expect(types("2d burn")).toEqual(["fire"]);
    expect(types("2d cor")).toEqual(["acid"]);
    expect(types("2d tox")).toEqual(["poison"]);
    expect(types("2d fat")).toEqual(["fatigue"]);
  });
});

describe("GURPS weapon groups from names", () => {
  it.each([
    ["Broadsword", "sword"],
    ["Thrusting Bastard Sword", "sword"],
    ["Rapier", "sword"],
    ["Large Knife", "knife"],
    ["Dagger", "knife"],
    ["Axe", "axe"],
    ["Great Axe", "axe"],
    ["Mace", "club"],
    ["Quarterstaff", "club"],
    ["Warhammer", "hammer"],
    ["Maul", "hammer"],
    ["Morningstar", "flail"],
    ["Halberd", "polearm"],
    ["Spear", "spear"],
    ["Javelin", "spear"],
    ["Longbow", "bow"],
    ["Composite Bow", "bow"],
    ["Heavy Crossbow", "crossbow"],
    ["Sling", "sling"],
    ["Pistol, .45", "firearm"],
    ["Hunting Rifle", "firearm"],
    ["Laser Rifle", "laser"],
    ["Hand Grenade", "bomb"],
    ["Punch", "brawling"],
    ["Kick", "brawling"],
    ["Bite", "bite"],
    ["Claws", "claw"],
    ["Shield Bash", "shield"],
    ["Shuriken", "dart"],
    ["Fireball", null]
  ])("%s → %s", (name, group) => {
    expect(weaponGroupFromName(name)).toBe(group);
  });
});

describe("GURPS descriptors", () => {
  it("splits a usage mode from a name", () => {
    expect(splitMode("Broadsword (Swing)")).toEqual({ name: "Broadsword", mode: "Swing" });
    expect(splitMode("Punch")).toEqual({ name: "Punch", mode: "" });
  });

  it("parses ranges in yards and ignores ST-relative ranges", () => {
    expect(parseRange("20/25")).toBe(25);
    expect(parseRange("175/1900")).toBe(1900);
    expect(parseRange("x1/x1.5")).toBeNull();
    expect(parseRange("")).toBeNull();
  });

  it("describes spells with college/class traits and healing", () => {
    expect(describeSpell({ name: "Lightning", college: "Air", class: "Missile" })).toMatchObject({
      type: "spell",
      key: "lightning",
      traits: ["spell", "air", "missile"],
      damageTypes: ["electricity"],
      isHealing: false
    });
    const heal = describeSpell({ name: "Major Healing", college: "Healing", class: "Regular" });
    expect(heal.isHealing).toBe(true);
    expect(heal.traits).toContain("healing");
    expect(describeSpell({ name: "Ice Dart", college: "Water", class: "Missile" }).damageTypes).toEqual(["cold"]);
    expect(describeSpell({ name: "Stone Missile", college: "Earth" }).damageTypes).toEqual(["bludgeoning"]);
  });

  it("walks nested GGA lists", () => {
    const l = list({ name: "Group", contains: list({ name: "Inner Sword", mode: "Swing" }) });
    const names = [];
    walkList(l, (e) => void names.push(e.name));
    expect(names).toEqual(["Group", "Inner Sword"]);
    expect(findInList(l, "inner sword (swing)")?.name).toBe("Inner Sword");
    expect(findInList(l, "Inner*")?.name).toBe("Inner Sword");
    expect(findInList(l, "Inner Sword (Thrust)")).toBeNull();
  });
});

describe("GurpsAdapter item descriptors (GGA Item documents)", () => {
  const adapter = new GurpsAdapter({});

  it("equipment with a melee attack is a melee weapon", () => {
    const item = {
      name: "Broadsword",
      type: "equipment",
      system: {
        eqt: { name: "Broadsword" },
        melee: { "00000": { name: "Broadsword", mode: "Swing", damage: "sw+1 cut" } },
        ranged: {}
      }
    };
    expect(adapter.getItemKey(item)).toBe("broadsword");
    expect(adapter.getItemDescriptors(item)).toMatchObject({
      name: "Broadsword",
      type: "weapon",
      attackKind: "melee",
      weaponGroup: "sword",
      damageTypes: ["slashing"]
    });
  });

  it("equipment with only a ranged attack is a ranged weapon", () => {
    const item = {
      name: "Heavy Crossbow",
      type: "equipment",
      system: { eqt: {}, melee: {}, ranged: { "00000": { name: "Heavy Crossbow", damage: "4d imp", range: "25/30" } } }
    };
    expect(adapter.getItemDescriptors(item)).toMatchObject({
      attackKind: "ranged",
      weaponGroup: "crossbow",
      range: 30
    });
  });

  it("spell, skill, meleeAtk, rangedAtk, feature and plain equipment items", () => {
    expect(
      adapter.getItemDescriptors({
        name: "Fireball",
        type: "spell",
        system: { spl: { college: "Fire", class: "Missile" } }
      })
    ).toMatchObject({ type: "spell", key: "fireball", traits: ["spell", "fire", "missile"] });
    expect(adapter.getItemDescriptors({ name: "First Aid", type: "skill", system: { ski: {} } })).toMatchObject({
      type: "action",
      isHealing: true
    });
    expect(
      adapter.getItemDescriptors({ name: "Bite", type: "meleeAtk", system: { mel: { damage: "1d-1 cut" } } })
    ).toMatchObject({ type: "weapon", attackKind: "melee", weaponGroup: "bite" });
    expect(
      adapter.getItemDescriptors({ name: "Spit Acid", type: "rangedAtk", system: { rng: { damage: "1d cor" } } })
    ).toMatchObject({ attackKind: "ranged", damageTypes: ["acid"] });
    expect(adapter.getItemDescriptors({ name: "Combat Reflexes", type: "feature", system: {} }).type).toBe("feat");
    expect(
      adapter.getItemDescriptors({
        name: "Healing Potion",
        type: "equipment",
        system: { eqt: {}, melee: {}, ranged: {} }
      })
    ).toMatchObject({ type: "consumable", isHealing: true, traits: ["healing"] });
  });

  it("never throws on missing data", () => {
    expect(adapter.getItemKey(null)).toBeNull();
    expect(adapter.getItemDescriptors(null)).toMatchObject({ type: "other", key: null });
    expect(adapter.getItemDescriptors({ type: "equipment" })).toMatchObject({ type: "other" });
    expect(adapter.getItemDescriptors({ name: "Odd", type: "weird" })).toMatchObject({ type: "other", key: "odd" });
  });
});
