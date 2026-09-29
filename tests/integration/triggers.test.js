/**
 * One PF2e action produces several chat messages (spell card -> CAST, then an attack roll -> ATTACK
 * or a healing roll -> HEALING). A recipe listening to two of them animates the same action twice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultTriggers } from "../../src/automation/presets.js";

const pack = JSON.parse(readFileSync(new URL("../../rules/pf2e.json", import.meta.url), "utf8"));
const SAME_ACTION = [
  ["cast", "healing"],
  ["cast", "attack"]
];

describe("one animation per action", () => {
  it("PF2e rules never listen to two events of the same action", () => {
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
