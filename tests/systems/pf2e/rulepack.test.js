import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeItem } from "../../../src/systems/pf2e/descriptors.js";
import { EVENT_TYPES } from "../../../src/shared/events.js";
import { consumables, effects, npcAttacks, spells, weapons } from "./helpers/fixtures.js";

const pack = JSON.parse(readFileSync(new URL("../../../rules/pf2e.json", import.meta.url), "utf8"));
const jb2a = new Set(JSON.parse(readFileSync(new URL("./jb2a-paths.json", import.meta.url), "utf8")).paths);

const PRESETS = ["melee", "ranged", "onToken", "area", "aura", "teleport"];
const TRIGGERS = ["attack", "damage", "cast", "save", "healing", "areaPlaced", "effectApplied"];
const MATCH_KEYS = ["key", "name", "regex", "type", "traits", "attackKind", "weaponGroup", "baseItem"];
/** PF2e WEAPON_GROUPS (src/module/item/weapon/values.ts, pf2e-8.5.1). */
const WEAPON_GROUPS = [
  "axe",
  "bomb",
  "bow",
  "brawling",
  "club",
  "corrosive",
  "crossbow",
  "cryo",
  "dart",
  "firearm",
  "flail",
  "flame",
  "grenade",
  "hammer",
  "knife",
  "laser",
  "mental",
  "pick",
  "plasma",
  "poison",
  "polearm",
  "projectile",
  "shield",
  "shock",
  "sling",
  "sniper",
  "sonic",
  "spear",
  "sword"
];

function animations(recipe) {
  const list = [recipe.animation];
  for (const s of Object.values(recipe.stages ?? {})) list.push(s.animation);
  for (const o of Object.values(recipe.outcomes ?? {})) list.push(...animations({ animation: o.animation, ...o }));
  return list.filter(Boolean);
}

/** Reference matcher for the documented Rule.match semantics (all given fields must match; highest priority wins). */
function matches(match, d) {
  if (match.key && match.key !== d.key) return false;
  if (match.name && match.name.toLowerCase() !== d.name.toLowerCase()) return false;
  if (match.regex && !new RegExp(match.regex, "i").test(d.name)) return false;
  if (match.type && match.type !== d.type) return false;
  if (match.traits && !match.traits.every((t) => d.traits.includes(t))) return false;
  if (match.attackKind && match.attackKind !== d.attackKind) return false;
  if (match.weaponGroup && match.weaponGroup !== d.weaponGroup) return false;
  if (match.baseItem && match.baseItem !== d.baseItem) return false;
  return true;
}
function resolve(d) {
  const hits = pack.rules.filter((r) => r.enabled && matches(r.match, d));
  hits.sort((a, b) => b.priority - a.priority);
  return hits[0] ?? null;
}

describe("rules/pf2e.json", () => {
  it("is a valid rule pack", () => {
    expect(pack).toMatchObject({ system: "pf2e", version: 1 });
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

  it("maps at least 40 spells and every weapon group", () => {
    const spellRules = pack.rules.filter((r) => r.match.type === "spell" && r.match.key);
    expect(spellRules.length).toBeGreaterThanOrEqual(40);
    const groups = new Set(pack.rules.map((r) => r.match.weaponGroup).filter(Boolean));
    for (const g of WEAPON_GROUPS) expect(groups.has(g), g).toBe(true);
    for (const key of [
      "electric-arc",
      "ignition",
      "ray-of-frost",
      "needle-darts",
      "telekinetic-projectile",
      "divine-lance",
      "force-barrage",
      "fireball",
      "heal",
      "harm",
      "bless",
      "shield",
      "lightning-bolt",
      "breathe-fire",
      "chain-lightning"
    ]) {
      expect(
        spellRules.some((r) => r.match.key === key),
        key
      ).toBe(true);
    }
  });

  it("leaves natural attacks (jaws, claws) to the generic fallback, which sizes and colours them", () => {
    expect(resolve(describeItem(npcAttacks.jaws()))).toBeNull();
    expect(resolve(describeItem(npcAttacks.claw()))).toBeNull();
  });

  it("uses the PF2e-specific JB2A cone entries", () => {
    const paths = pack.rules.flatMap((r) => animations(r.recipe));
    expect(paths.some((p) => p.startsWith("jb2a.template_cone_PF2e"))).toBe(true);
    expect(paths.some((p) => p.startsWith("jb2a.volley_of_projectiles_ConePF2e"))).toBe(true);
  });

  it.each([
    ["longsword", () => describeItem(weapons.longsword()), "weapon-longsword"],
    ["shortbow", () => describeItem(weapons.shortbow()), "weapon-shortbow"],
    ["thrown dagger", () => describeItem(weapons.daggerThrown()), "weapon-dagger-thrown"],
    ["fist", () => describeItem(weapons.fist()), "unarmed-basic"],
    ["NPC thrown spear", () => describeItem(npcAttacks.spear()), "weapon-spear-thrown"],
    ["fireball", () => describeItem(spells.fireball()), "spell-fireball"],
    ["force barrage", () => describeItem(spells.forceBarrage()), "spell-force-barrage"],
    ["heal", () => describeItem(spells.heal()), "spell-heal"],
    ["healing potion", () => describeItem(consumables.healingPotion()), "potion-healing"],
    ["bless effect", () => describeItem(effects.bless()), "effect-spell-effect-bless"],
    ["frightened", () => describeItem(effects.frightened()), "condition-frightened"]
  ])("resolves %s", (_label, make, id) => {
    expect(resolve(make())?.id).toBe(id);
  });

  it("matches every variant of a base weapon", () => {
    const named = { ...describeItem(weapons.longsword()), name: "Holy Avenger", key: "holy-avenger" };
    expect(named.baseItem).toBe("longsword");
    expect(resolve(named)?.id).toBe("weapon-longsword");
  });

  it("falls back by weapon group and traits", () => {
    const homebrew = { ...describeItem(weapons.longsword()), key: "homebrew-blade", baseItem: null };
    expect(resolve(homebrew)?.id).toBe("group-sword");
    const unknownFire = { ...describeItem(spells.ignition()), key: "homebrew-flare" };
    expect(resolve(unknownFire)?.id).toBe("fallback-fire-attack");
  });

  it("teleport spells vanish, move and appear on CAST", () => {
    for (const key of [
      "translocate",
      "dimension-door",
      "abundant-step",
      "dimensional-assault",
      "dimensional-disappearance"
    ]) {
      const rule = pack.rules.find((r) => r.match.key === key);
      expect(rule?.recipe, key).toMatchObject({ preset: "teleport", triggers: [EVENT_TYPES.CAST] });
      expect(rule.recipe.animation, key).toMatch(/^jb2a\.misty_step\.01\./);
      expect(rule.recipe.stages.onTarget.animation, key).toMatch(/^jb2a\.misty_step\.02\./);
    }
  });

  it("healing rules react to HEALING events", () => {
    for (const id of ["potion-healing", "battle-medicine", "spell-heal"]) {
      expect(pack.rules.find((r) => r.id === id).recipe.triggers).toContain(EVENT_TYPES.HEALING);
    }
  });
});
