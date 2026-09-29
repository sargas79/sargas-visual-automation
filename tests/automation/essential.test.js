import { describe, expect, it } from "vitest";
import { compile } from "../../src/automation/compile.js";
import { applyReducedMotion } from "../../src/net/preferences.js";
import { EVENT_TYPES, OUTCOMES } from "../../src/shared/events.js";

const ctx = { grid: { size: 100, distance: 5 }, getTokenSize: () => 1 };

const ev = (partial) => ({
  type: EVENT_TYPES.ATTACK,
  source: { tokenId: "src", actorId: "actor1" },
  targets: [{ tokenId: "t1" }],
  outcome: OUTCOMES.SUCCESS,
  sceneId: "scene1",
  ...partial
});

const effects = (recipe, event) =>
  compile(recipe, event, ctx)[0]
    .steps.filter((s) => s.type === "effect")
    .map((s) => s.effect);
const byFile = (list) => Object.fromEntries(list.map((e) => [e.file, e.essential]));
const kept = (list) =>
  list
    .map(applyReducedMotion)
    .filter(Boolean)
    .map((e) => e.file);

const stages = {
  cast: { animation: "cast" },
  onSource: { animation: "onSource" },
  impact: { animation: "impact" },
  onTarget: { animation: "onTarget" }
};

describe("presets mark essential stages (#66)", () => {
  it("ranged: projectile, impact and onTarget are essential; cast and onSource are not", () => {
    const recipe = { version: 1, preset: "ranged", animation: "bolt", options: { returnTrip: true }, stages };
    const list = effects(recipe, ev());
    expect(byFile(list)).toEqual({ cast: false, onSource: false, bolt: true, impact: true, onTarget: true });
    expect(kept(list)).toEqual(["bolt", "impact", "onTarget"]);
  });

  it("a miss keeps the missed projectile with reduced motion", () => {
    const recipe = { version: 1, preset: "ranged", animation: "bolt", stages };
    const list = effects(recipe, ev({ outcome: OUTCOMES.FAILURE }));
    expect(kept(list)).toEqual(["bolt"]);
    expect(list.find((e) => e.file === "bolt").missed).toBe(true);
  });

  it("melee and onToken mark the main animation essential", () => {
    expect(byFile(effects({ version: 1, preset: "melee", animation: "sword" }, ev())).sword).toBe(true);
    const heal = effects({ version: 1, preset: "onToken", animation: "heal" }, ev({ type: EVENT_TYPES.HEALING }));
    expect(byFile(heal).heal).toBe(true);
  });

  it("area: the area effect and target impacts are essential", () => {
    const recipe = { version: 1, preset: "area", animation: "boom", stages };
    const list = effects(
      recipe,
      ev({ type: EVENT_TYPES.AREA_PLACED, area: { shape: "burst", distance: 10, origin: { x: 0, y: 0 } } })
    );
    expect(byFile(list)).toEqual({ cast: false, onSource: false, boom: true, impact: true, onTarget: true });
  });
});
