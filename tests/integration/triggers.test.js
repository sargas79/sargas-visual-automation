/**
 * One action produces several chat messages (PF2e: spell card -> CAST, then an attack roll -> ATTACK or a healing
 * roll -> HEALING; dnd5e: usage card -> CAST, then the attack / healing roll). A recipe listening to two of them
 * animates the same action twice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultTriggers } from "../../src/automation/presets.js";

const PACKS = ["pf2e", "dnd5e", "gurps"].map((id) => [
  id,
  JSON.parse(readFileSync(new URL(`../../rules/${id}.json`, import.meta.url), "utf8"))
]);
const SAME_ACTION = [
  ["cast", "healing"],
  ["cast", "attack"],
  ["cast", "damage"],
  ["attack", "damage"]
];

describe("one animation per action", () => {
  // GURPS missile spells are cast (CAST) and thrown (ATTACK) with two rolls; its pack uses two rules, never one on both.
  it.each(PACKS)("%s rules never listen to two events of the same action", (_id, pack) => {
    const offenders = pack.rules.filter((r) => {
      const t = r.recipe.triggers ?? defaultTriggers(r.recipe.preset);
      return SAME_ACTION.some(([a, b]) => t.includes(a) && t.includes(b));
    });
    expect(offenders.map((r) => r.id)).toEqual([]);
  });

  it("preset defaults never listen to two events of the same action", () => {
    for (const preset of ["melee", "ranged", "onToken", "area", "aura", "teleport"]) {
      const t = defaultTriggers(preset);
      for (const [a, b] of SAME_ACTION) expect(t.includes(a) && t.includes(b), preset).toBe(false);
    }
  });
});
