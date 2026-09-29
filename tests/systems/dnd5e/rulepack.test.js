import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WEAPON_GROUPS, describeItem } from "../../../src/systems/dnd5e/descriptors.js";
import { describeEffect } from "../../../src/systems/dnd5e/effects.js";
import { EVENT_TYPES } from "../../../src/shared/events.js";
import { findRule } from "../../../src/automation/matcher.js";
import { consumables, spells, weapons } from "./helpers/fixtures.js";

const pack = JSON.parse(readFileSync(new URL("../../../rules/dnd5e.json", import.meta.url), "utf8"));
const jb2a = new Set(JSON.parse(readFileSync(new URL("./jb2a-paths.json", import.meta.url), "utf8")).paths);

const PRESETS = ["melee", "ranged", "onToken", "area", "aura", "teleport"];
const TRIGGERS = ["attack", "damage", "cast", "save", "healing", "areaPlaced", "effectApplied"];
const MATCH_KEYS = ["key", "name", "regex", "type", "traits", "attackKind", "weaponGroup", "baseItem"];

function animations(recipe) {
  const list = [recipe.animation];
  for (const s of Object.values(recipe.stages ?? {})) list.push(s?.animation);
  for (const o of Object.values(recipe.outcomes ?? {})) list.push(...animations({ animation: o.animation, ...o }));
  return list.filter(Boolean);
}

const asList = (v) => (Array.isArray(v) ? v : [v]);

/** Resolve with the core matcher (priority, then specificity, then file order). */
function resolve(d) {
  return findRule(pack.rules, d).winner?.rule ?? null;
}

describe("rules/dnd5e.json", () => {
  it("is a valid rule pack", () => {
    expect(pack).toMatchObject({ system: "dnd5e", version: 1 });
    const ids = new Set();
    for (const rule of pack.rules) {
      expect(ids.has(rule.id), rule.id).toBe(false);
      ids.add(rule.id);
      expect(typeof rule.label).toBe("string");
      expect(typeof rule.priority).toBe("number");
      expect(Object.keys(rule.match).length, rule.id).toBeGreaterThan(0);
      for (const k of Object.keys(rule.match)) expect(MATCH_KEYS, `${rule.id}.${k}`).toContain(k);
      expect(rule.recipe.version).toBe(1);
      expect(PRESETS, rule.id).toContain(rule.recipe.preset);
      for (const t of rule.recipe.triggers ?? []) expect(TRIGGERS, rule.id).toContain(t);
      if (rule.match.regex) expect(() => new RegExp(rule.match.regex)).not.toThrow();
    }
  });

  it("only uses real JB2A database paths", () => {
    for (const rule of pack.rules) {
      for (const path of animations(rule.recipe)) {
        expect(path.startsWith("jb2a."), `${rule.id}: ${path}`).toBe(true);
        expect(jb2a.has(path), `${rule.id}: ${path} not in JB2A 0.9.3`).toBe(true);
      }
    }
  });

  it("maps at least 40 SRD spells, every base weapon and every weapon group", () => {
    const spellKeys = pack.rules
      .filter((r) => r.match.type === "spell" && r.match.key)
      .flatMap((r) => asList(r.match.key));
    expect(spellKeys.length).toBeGreaterThanOrEqual(40);
    for (const key of [
      "fire-bolt",
      "eldritch-blast",
      "ray-of-frost",
      "sacred-flame",
      "toll-the-dead",
      "magic-missile",
      "guiding-bolt",
      "cure-wounds",
      "healing-word",
      "bless",
      "shield",
      "thunderwave",
      "burning-hands",
      "misty-step",
      "scorching-ray",
      "shatter",
      "spiritual-weapon",
      "moonbeam",
      "fireball",
      "lightning-bolt",
      "call-lightning",
      "spirit-guardians",
      "cone-of-cold",
      "wall-of-fire",
      "chain-lightning",
      "disintegrate",
      "hunters-mark",
      "divine-smite"
    ]) {
      expect(spellKeys, key).toContain(key);
    }
    const bases = new Set(pack.rules.flatMap((r) => (r.match.baseItem ? asList(r.match.baseItem) : [])));
    for (const id of Object.keys(WEAPON_GROUPS)) expect(bases.has(id), id).toBe(true);
    const groups = new Set(pack.rules.flatMap((r) => (r.match.weaponGroup ? asList(r.match.weaponGroup) : [])));
    for (const g of new Set(Object.values(WEAPON_GROUPS))) expect(groups.has(g), g).toBe(true);
  });

  it("uses the 5e-specific JB2A cone entries", () => {
    const paths = pack.rules.flatMap((r) => animations(r.recipe));
    expect(paths.some((p) => p.startsWith("jb2a.template_cone_5e"))).toBe(true);
    expect(paths.some((p) => p.startsWith("jb2a.volley_of_projectiles_Cone5e"))).toBe(true);
  });

  it.each([
    ["longsword", () => describeItem(weapons.longsword()), "weapon-longsword"],
    ["Sun Blade (longsword variant)", () => describeItem(weapons.sunBlade()), "weapon-longsword"],
    ["thrown dagger", () => describeItem(weapons.dagger(), { attackMode: "thrown" }), "weapon-dagger-thrown"],
    ["melee dagger", () => describeItem(weapons.dagger(), { attackMode: "offhand" }), "weapon-dagger"],
    ["longbow", () => describeItem(weapons.longbow()), "weapon-longbow"],
    ["war pick", () => describeItem(weapons.warPick()), "weapon-warpick"],
    ["unarmed strike", () => describeItem(weapons.unarmedStrike()), "weapon-unarmed-strike"],
    ["claws", () => describeItem(weapons.claw()), "natural-claw"],
    ["fire bolt", () => describeItem(spells.fireBolt()), "spell-fire-bolt"],
    ["fireball", () => describeItem(spells.fireball()), "spell-fireball"],
    ["cure wounds", () => describeItem(spells.cureWounds()), "spell-cure-wounds"],
    ["potion of healing", () => describeItem(consumables.potionOfHealing()), "potion-healing"],
    ["homebrew potion", () => describeItem(consumables.homebrewPotion()), "potion-healing-generic"],
    ["spirit guardians", () => describeItem(spells.spiritGuardians()), "spell-spirit-guardians"]
  ])("resolves %s", (_label, make, id) => {
    expect(resolve(make())?.id).toBe(id);
  });

  it("falls back by weapon group for homebrew weapons with a group", () => {
    const d = { ...describeItem(weapons.longsword()), key: "homebrew", baseItem: null, name: "Homebrew" };
    expect(resolve(d)?.id).toBe("group-sword");
    const thrown = { ...d, weaponGroup: "axe", attackKind: "thrown" };
    expect(resolve(thrown)?.id).toBe("group-axe-thrown");
    // No base item, no group: left to the generic fallback (melee by damage type).
    expect(resolve(describeItem(weapons.homebrewBlade()))).toBeNull();
  });

  it("animates effects and conditions as auras on the carrier", () => {
    const goblin = { id: "goblin", documentName: "Actor" };
    const blessed = describeEffect({ name: "Blessed", origin: "Actor.hero.Item.bless", statuses: new Set() }, goblin);
    expect(resolve(blessed.descriptors)?.id).toBe("effect-blessed");
    const paralyzed = describeEffect(
      { name: "Paralyzed", type: "condition", statuses: new Set(["paralyzed"]), system: { type: "paralyzed" } },
      goblin
    );
    expect(resolve(paralyzed.descriptors)?.recipe.preset).toBe("aura");
    const holdPerson = describeEffect(
      { name: "Paralyzed", origin: "Actor.hero.Item.hold", statuses: new Set(["paralyzed"]) },
      goblin
    );
    expect(resolve(holdPerson.descriptors)?.id).toBe("condition-paralyzed");
  });

  it("teleport spells vanish, move and appear on CAST", () => {
    for (const key of ["misty-step", "dimension-door"]) {
      const rule = pack.rules.find((r) => r.match.key === key);
      expect(rule?.recipe, key).toMatchObject({ preset: "teleport", triggers: [EVENT_TYPES.CAST] });
      expect(rule.recipe.animation, key).toMatch(/^jb2a\.misty_step\.01\./);
      expect(rule.recipe.stages.onTarget.animation, key).toMatch(/^jb2a\.misty_step\.02\./);
    }
  });

  it("healing rules react to HEALING only, attack spells to ATTACK only, areas to AREA_PLACED", () => {
    const byKey = (key) => pack.rules.find((r) => asList(r.match.key ?? []).includes(key));
    for (const key of ["cure-wounds", "healing-word", "potion-of-healing", "revivify"]) {
      expect(byKey(key).recipe.triggers, key).toEqual([EVENT_TYPES.HEALING]);
    }
    for (const key of ["fire-bolt", "eldritch-blast", "guiding-bolt", "scorching-ray"]) {
      expect(byKey(key).recipe.triggers, key).toEqual([EVENT_TYPES.ATTACK]);
    }
    for (const key of ["fireball", "burning-hands", "cone-of-cold", "thunderwave", "moonbeam"]) {
      expect(byKey(key).recipe.triggers, key).toEqual([EVENT_TYPES.AREA_PLACED]);
    }
    expect(byKey("spirit-guardians").recipe).toMatchObject({ preset: "aura", triggers: [EVENT_TYPES.EFFECT_APPLIED] });
  });
});
