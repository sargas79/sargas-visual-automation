import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRulePack } from "../../../src/automation/schema.js";
import { findRule } from "../../../src/automation/matcher.js";
import { triggersOf } from "../../../src/automation/automation.js";
import { PRESETS } from "../../../src/automation/presets.js";
import { EVENT_TYPES } from "../../../src/shared/events.js";
import { describeAttack, describeSkill, describeSpell } from "../../../src/systems/gurps/descriptors.js";

const raw = JSON.parse(readFileSync(new URL("../../../rules/gurps.json", import.meta.url), "utf8"));
/** Every JB2A path of the pack, checked against jb2a_patreon 0.9.3 by helpers/derive-jb2a-paths.mjs. */
const jb2a = new Set(JSON.parse(readFileSync(new URL("./jb2a-paths.json", import.meta.url), "utf8")).paths);

const { pack, errors } = checkRulePack(raw);

function animations(recipe) {
  const list = [recipe.animation];
  for (const s of Object.values(recipe.stages ?? {})) if (s) list.push(s.animation);
  for (const o of Object.values(recipe.outcomes ?? {})) list.push(...animations({ animation: o.animation, ...o }));
  return list.filter(Boolean);
}

/** Resolve with the real matcher and report the rule id, or null when the winner does not trigger on the event. */
function resolve(descriptors, eventType) {
  const { winner } = findRule(pack.rules, descriptors);
  if (!winner) return null;
  if (eventType && !triggersOf(winner.rule.recipe).includes(eventType)) return `${winner.rule.id} (not triggered)`;
  return winner.rule.id;
}

const melee = (name, mode = "", damage = "") => describeAttack({ name, mode, damage }, { list: "melee" });
const ranged = (name, mode = "", damage = "", isSpell = false) =>
  describeAttack({ name, mode, damage }, { list: "ranged", isSpell });
const spell = (name, college = "", cls = "Regular") => describeSpell({ name, college, class: cls });

describe("rules/gurps.json", () => {
  it("is a valid rule pack for gurps", () => {
    expect(errors).toEqual([]);
    expect(raw).toMatchObject({ system: "gurps", version: 1 });
    expect(pack.rules.length).toBe(raw.rules.length);
    for (const rule of raw.rules) {
      expect(typeof rule.label, rule.id).toBe("string");
      expect(Object.keys(PRESETS), rule.id).toContain(rule.recipe.preset);
    }
  });

  it("only uses real JB2A database paths", () => {
    for (const rule of raw.rules) {
      for (const path of animations(rule.recipe)) {
        expect(path.startsWith("jb2a."), `${rule.id}: ${path}`).toBe(true);
        expect(jb2a.has(path), `${rule.id}: ${path} not in JB2A 0.9.3`).toBe(true);
      }
    }
  });

  it.each([
    ["broadsword swing", () => melee("Broadsword", "Swing", "sw+1 cut"), EVENT_TYPES.ATTACK, "group-sword-melee"],
    ["katana", () => melee("Katana", "Swing", "sw+1 cut"), EVENT_TYPES.ATTACK, "weapon-katana"],
    ["great axe", () => melee("Great Axe", "Swing", "sw+3 cut"), EVENT_TYPES.ATTACK, "weapon-greataxe"],
    ["mace", () => melee("Mace", "Swing", "sw+3 cr"), EVENT_TYPES.ATTACK, "weapon-mace"],
    ["spear", () => melee("Spear", "Thrust", "thr+2 imp"), EVENT_TYPES.ATTACK, "group-spear-melee"],
    ["large knife", () => melee("Large Knife", "Swing", "sw-2 cut"), EVENT_TYPES.ATTACK, "group-knife-melee"],
    ["punch", () => melee("Punch", "", "thr-1 cr"), EVENT_TYPES.ATTACK, "unarmed-punch"],
    ["kick", () => melee("Kick", "", "thr cr"), EVENT_TYPES.ATTACK, "unarmed-kick"],
    ["bite", () => melee("Bite", "", "1d-1 cut"), EVENT_TYPES.ATTACK, "natural-bite"],
    ["composite bow", () => ranged("Composite Bow", "", "thr+3 imp"), EVENT_TYPES.ATTACK, "ranged-bow"],
    ["crossbow", () => ranged("Heavy Crossbow", "", "thr+4 imp"), EVENT_TYPES.ATTACK, "ranged-crossbow"],
    ["pistol", () => ranged("Pistol, .45", "", "2d pi+"), EVENT_TYPES.ATTACK, "ranged-pistol"],
    ["rifle", () => ranged("Hunting Rifle", "", "7d pi"), EVENT_TYPES.ATTACK, "ranged-rifle"],
    ["thrown knife", () => ranged("Large Knife", "Thrown", "thr imp"), EVENT_TYPES.ATTACK, "thrown-knife"],
    ["thrown axe", () => ranged("Throwing Axe", "Thrown", "sw+2 cut"), EVENT_TYPES.ATTACK, "thrown-axe"],
    ["javelin", () => ranged("Javelin", "Thrown", "thr+1 imp"), EVENT_TYPES.ATTACK, "thrown-spear"],
    ["grenade", () => ranged("Hand Grenade", "Thrown", "5d cr ex"), EVENT_TYPES.ATTACK, "thrown-grenade"],
    ["fireball (attack)", () => ranged("Fireball", "", "3d burn", true), EVENT_TYPES.ATTACK, "spell-fireball"],
    [
      "explosive fireball (attack)",
      () => ranged("Explosive Fireball", "", "3d burn ex", true),
      EVENT_TYPES.ATTACK,
      "spell-explosive-fireball"
    ],
    ["lightning (attack)", () => ranged("Lightning", "", "3d burn", true), EVENT_TYPES.ATTACK, "spell-lightning"],
    ["ice dart (attack)", () => ranged("Ice Dart", "", "2d cr", true), EVENT_TYPES.ATTACK, "spell-ice-dart"],
    [
      "stone missile (attack)",
      () => ranged("Stone Missile", "", "2d cr", true),
      EVENT_TYPES.ATTACK,
      "spell-stone-missile"
    ],
    ["unknown fire breath", () => ranged("Dragon Breath", "", "4d burn"), EVENT_TYPES.ATTACK, "fallback-burn-ranged"],
    [
      "unknown spell missile",
      () => ranged("Arcane Bolt", "", "2d cr", true),
      EVENT_TYPES.ATTACK,
      "fallback-spell-missile"
    ],
    ["fireball (cast)", () => spell("Fireball", "Fire", "Missile"), EVENT_TYPES.CAST, "cast-missile-fire"],
    ["lightning (cast)", () => spell("Lightning", "Air", "Missile"), EVENT_TYPES.CAST, "cast-missile-lightning"],
    ["minor healing", () => spell("Minor Healing", "Healing"), EVENT_TYPES.HEALING, "spell-minor-healing"],
    ["major healing", () => spell("Major Healing", "Healing"), EVENT_TYPES.HEALING, "spell-major-healing"],
    ["first aid", () => describeSkill({ name: "First Aid" }), EVENT_TYPES.HEALING, "skill-first-aid"],
    ["unknown healing spell", () => spell("Heal Plant", "Plant"), EVENT_TYPES.HEALING, "healing-generic"],
    ["shield", () => spell("Shield", "Protection and Warning"), EVENT_TYPES.CAST, "spell-shield"],
    [
      "missile shield",
      () => spell("Missile Shield", "Protection and Warning"),
      EVENT_TYPES.CAST,
      "spell-missile-shield"
    ],
    ["blink", () => spell("Blink", "Movement/Gate"), EVENT_TYPES.CAST, "spell-blink"],
    ["teleport", () => spell("Teleport", "Movement/Gate"), EVENT_TYPES.CAST, "spell-teleport"],
    ["create fire", () => spell("Create Fire", "Fire"), EVENT_TYPES.CAST, "spell-create-fire"],
    ["darkness", () => spell("Darkness", "Light and Darkness", "Area"), EVENT_TYPES.CAST, "spell-darkness"],
    ["light", () => spell("Light", "Light and Darkness"), EVENT_TYPES.CAST, "spell-light"],
    ["unknown fire spell", () => spell("Rain of Fire", "Fire", "Area"), EVENT_TYPES.CAST, "cast-college-fire"],
    ["unknown spell", () => spell("Knot", "Making and Breaking"), EVENT_TYPES.CAST, "cast-generic"]
  ])("resolves %s", (_label, make, eventType, id) => {
    expect(resolve(make(), eventType)).toBe(id);
  });

  it("covers the requested families", () => {
    const ids = new Set(raw.rules.map((r) => r.id));
    for (const id of [
      "group-sword-melee",
      "group-axe-melee",
      "group-club-melee",
      "group-spear-melee",
      "ranged-bow",
      "ranged-crossbow",
      "ranged-pistol",
      "ranged-rifle",
      "thrown-knife",
      "unarmed-punch",
      "unarmed-kick",
      "natural-bite",
      "spell-fireball",
      "spell-explosive-fireball",
      "spell-lightning",
      "spell-ice-dart",
      "spell-stone-missile",
      "spell-minor-healing",
      "spell-major-healing",
      "spell-shield",
      "spell-missile-shield",
      "spell-blink",
      "spell-teleport",
      "spell-create-fire",
      "spell-darkness",
      "spell-light"
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("teleport spells move the caster on CAST", () => {
    for (const id of ["spell-blink", "spell-teleport"]) {
      const rule = raw.rules.find((r) => r.id === id);
      expect(triggersOf(rule.recipe), id).toEqual([EVENT_TYPES.CAST]);
      expect(rule.recipe.preset).toBe("teleport");
    }
  });

  it("healing rules react to HEALING events only", () => {
    for (const rule of raw.rules.filter((r) => /heal|first-aid|cure|regeneration/.test(r.id))) {
      expect(triggersOf(rule.recipe), rule.id).toEqual([EVENT_TYPES.HEALING]);
    }
  });
});
