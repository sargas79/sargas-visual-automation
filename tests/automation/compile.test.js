import { describe, expect, it } from "vitest";
import { compile } from "../../src/automation/compile.js";
import { PRESETS, auraName, defaultTriggers } from "../../src/automation/presets.js";
import { EVENT_TYPES, OUTCOMES } from "../../src/shared/events.js";

const grid = { size: 100, distance: 5 };
const ctx = { grid, getTokenSize: () => 1 };

const ev = (partial) => ({
  type: EVENT_TYPES.ATTACK,
  source: { tokenId: "src", actorId: "actor1" },
  targets: [{ tokenId: "t1" }],
  outcome: OUTCOMES.SUCCESS,
  sceneId: "scene1",
  ...partial
});

const effects = (seq) => seq.steps.filter((s) => s.type === "effect").map((s) => s.effect);

function one(recipe, event) {
  const out = compile(recipe, event, ctx);
  expect(out).toHaveLength(1);
  expect(JSON.parse(JSON.stringify(out[0]))).toEqual(out[0]);
  return out[0];
}

describe("compile: melee", () => {
  const recipe = {
    version: 1,
    preset: "melee",
    animation: "jb2a.sword.melee.01.white",
    stages: { impact: { animation: "jb2a.impact.003.orange" } },
    outcomes: { criticalSuccess: { animation: "jb2a.sword.melee.fire.orange" } }
  };

  it("stretches from source to target and adds the impact on a hit", () => {
    const seq = one(recipe, ev());
    expect(seq.sceneId).toBe("scene1");
    const [main, impact] = effects(seq);
    expect(main).toMatchObject({
      file: recipe.animation,
      atLocation: { tokenId: "src" },
      stretchTo: { tokenId: "t1" }
    });
    expect(main.missed).toBeUndefined();
    expect(impact).toMatchObject({ file: "jb2a.impact.003.orange", atLocation: { tokenId: "t1" } });
    expect(seq.steps.find((s) => s.effect === main).waitUntilFinished).toBe(-250);
  });

  it("uses missed:true and skips the impact on a miss", () => {
    const seq = one(recipe, ev({ outcome: OUTCOMES.FAILURE }));
    const list = effects(seq);
    expect(list).toHaveLength(1);
    expect(list[0].missed).toBe(true);
  });

  it("applies the critical override", () => {
    const seq = one(recipe, ev({ outcome: OUTCOMES.CRITICAL_SUCCESS }));
    expect(effects(seq)[0].file).toBe("jb2a.sword.melee.fire.orange");
  });

  it("accepts hit/miss/crit aliases", () => {
    const seq = one(
      { ...recipe, outcomes: { miss: { animation: "jb2a.melee_generic.slash.01.orange" } } },
      ev({ outcome: OUTCOMES.CRITICAL_FAILURE })
    );
    expect(effects(seq)[0]).toMatchObject({ file: "jb2a.melee_generic.slash.01.orange", missed: true });
  });

  it("returns nothing without targets or stages", () => {
    expect(compile({ version: 1, preset: "melee", animation: "a" }, ev({ targets: [] }), ctx)).toEqual([]);
  });
});

describe("compile: ranged", () => {
  const recipe = {
    version: 1,
    preset: "ranged",
    animation: "jb2a.fire_bolt.orange",
    options: { stagger: 100 },
    stages: {
      cast: { animation: "jb2a.cast_generic.fire.01.orange" },
      impact: { animation: "jb2a.impact.fire.01.orange" }
    }
  };

  it("fires one projectile per target with a stagger and per-target outcome", () => {
    const seq = one(
      recipe,
      ev({
        targets: [
          { tokenId: "t1", outcome: OUTCOMES.SUCCESS },
          { tokenId: "t2", outcome: OUTCOMES.FAILURE },
          { tokenId: "t3", outcome: OUTCOMES.CRITICAL_SUCCESS }
        ]
      })
    );
    const list = effects(seq);
    const projectiles = list.filter((e) => e.stretchTo);
    expect(projectiles.map((p) => [p.stretchTo.tokenId, p.delay ?? 0, !!p.missed])).toEqual([
      ["t2", 100, true],
      ["t3", 200, false],
      ["t1", 0, false]
    ]);
    const impacts = list.filter((e) => e.file === "jb2a.impact.fire.01.orange");
    expect(impacts.map((e) => e.atLocation.tokenId)).toEqual(["t1", "t3"]);
    // cast first and waited on
    expect(seq.steps[0]).toMatchObject({
      effect: { file: "jb2a.cast_generic.fire.01.orange" },
      waitUntilFinished: -500
    });
  });

  it("uses the projectile stage when set, and returnTrip", () => {
    const seq = one(
      {
        ...recipe,
        stages: { projectile: { animation: "jb2a.dagger.throw.01.white", options: { returnTrip: true } } }
      },
      ev()
    );
    expect(effects(seq)[0]).toMatchObject({ file: "jb2a.dagger.throw.01.white", returnTrip: true });
  });

  it("can disable a stage for an outcome with null", () => {
    const seq = one(
      { ...recipe, outcomes: { success: { stages: { impact: null } } } },
      ev({ targets: [{ tokenId: "t1" }] })
    );
    expect(effects(seq).map((e) => e.file)).toEqual(["jb2a.cast_generic.fire.01.orange", "jb2a.fire_bolt.orange"]);
  });

  it("adds the sound step", () => {
    const seq = one({ ...recipe, sound: { file: "sounds/x.ogg", volume: 0.5 } }, ev());
    expect(seq.steps[0]).toEqual({ type: "sound", file: "sounds/x.ogg", volume: 0.5 });
  });
});

describe("compile: onToken", () => {
  const recipe = { version: 1, preset: "onToken", animation: "jb2a.healing_generic.200px.green" };

  it("plays on every target", () => {
    const seq = one(recipe, ev({ type: EVENT_TYPES.HEALING, targets: [{ tokenId: "a" }, { tokenId: "b" }] }));
    expect(effects(seq).map((e) => [e.atLocation.tokenId, e.scaleToObject])).toEqual([
      ["a", 1.5],
      ["b", 1.5]
    ]);
  });

  it("falls back to the source, or forces it with target: source", () => {
    expect(effects(one(recipe, ev({ targets: [] })))[0].atLocation).toEqual({ tokenId: "src" });
    const forced = one({ ...recipe, options: { target: "source", attach: true } }, ev());
    expect(effects(forced)[0]).toMatchObject({ atLocation: { tokenId: "src" }, attachTo: { tokenId: "src" } });
  });
});

describe("compile: area", () => {
  const recipe = { version: 1, preset: "area", animation: "jb2a.fireball.explosion.orange" };
  const areaEvent = (area, extra = {}) => ev({ type: EVENT_TYPES.AREA_PLACED, targets: [], area, ...extra });

  it("sizes a burst from event.area (radius → diameter in squares)", () => {
    const seq = one(recipe, areaEvent({ shape: "burst", origin: { x: 500, y: 300 }, direction: 0, distance: 20 }));
    expect(effects(seq)[0]).toMatchObject({
      atLocation: { x: 500, y: 300 },
      size: { width: 8, height: 8, gridUnits: true }
    });
  });

  it("stretches cones and lines along the direction", () => {
    const cone = one(recipe, areaEvent({ shape: "cone", origin: { x: 0, y: 0 }, direction: 90, distance: 15 }));
    expect(effects(cone)[0]).toMatchObject({ atLocation: { x: 0, y: 0 }, stretchTo: { x: 0, y: 300 } });
    const line = one(recipe, areaEvent({ shape: "line", origin: { x: 100, y: 100 }, direction: 0, distance: 30 }));
    expect(effects(line)[0].stretchTo).toEqual({ x: 700, y: 100 });
  });

  it("sizes emanations around the source token and squares by side", () => {
    const eman = one(recipe, areaEvent(null, { descriptors: { area: { shape: "emanation", size: 10 } } }));
    expect(effects(eman)[0]).toMatchObject({ atLocation: { tokenId: "src" }, size: { width: 5, height: 5 } });
    const square = one(recipe, areaEvent({ shape: "square", origin: { x: 10, y: 10 }, distance: 10 }));
    expect(effects(square)[0].size).toMatchObject({ width: 2, height: 2 });
  });

  it("adds impacts on targets inside the area after the main effect", () => {
    const seq = one(
      { ...recipe, stages: { impact: { animation: "jb2a.impact.fire.01.orange" } } },
      areaEvent({ shape: "burst", origin: { x: 0, y: 0 }, distance: 10 }, { targets: [{ tokenId: "a" }] })
    );
    expect(seq.steps[0].waitUntilFinished).toBe(-500);
    expect(seq.steps[1].effect.atLocation).toEqual({ tokenId: "a" });
  });
});

describe("compile: aura", () => {
  const recipe = { version: 1, preset: "aura", animation: "jb2a.template_circle.aura.01.loop.large.bluepurple" };

  it("creates a persistent named effect attached to the source", () => {
    const event = ev({
      type: EVENT_TYPES.EFFECT_APPLIED,
      targets: [],
      descriptors: { key: "bless", area: { shape: "emanation", size: 15 } }
    });
    const effect = effects(one(recipe, event))[0];
    expect(effect).toMatchObject({
      persist: true,
      name: "aura:actor1:bless",
      attachTo: { tokenId: "src" },
      layer: "belowTokens",
      size: { width: 7, height: 7, gridUnits: true }
    });
    expect(auraName(event)).toBe("aura:actor1:bless");
  });

  it("compiles nothing for effectRemoved", () => {
    expect(compile(recipe, ev({ type: EVENT_TYPES.EFFECT_REMOVED }), ctx)).toEqual([]);
  });
});

describe("compile: teleport", () => {
  it("plays departure on the source and arrival at the destination", () => {
    const seq = one(
      {
        version: 1,
        preset: "teleport",
        animation: "jb2a.misty_step.01.blue",
        stages: { onTarget: { animation: "jb2a.misty_step.02.blue" } }
      },
      ev({ type: EVENT_TYPES.CAST, targets: [], area: { shape: "burst", origin: { x: 50, y: 60 }, distance: 0 } })
    );
    const [out, arrive] = effects(seq);
    expect(out).toMatchObject({ file: "jb2a.misty_step.01.blue", atLocation: { tokenId: "src" } });
    expect(arrive).toMatchObject({ file: "jb2a.misty_step.02.blue", atLocation: { x: 50, y: 60 }, delay: 400 });
  });
});

describe("presets metadata", () => {
  it("exposes label, stages and optionsSchema for every preset", () => {
    for (const id of ["melee", "ranged", "onToken", "area", "aura", "teleport"]) {
      expect(PRESETS[id]).toMatchObject({ id, label: `SVA.Automation.Presets.${id}` });
      expect(PRESETS[id].stages.length).toBeGreaterThan(0);
      expect(PRESETS[id].optionsSchema.scale.type).toBe("number");
    }
    expect(defaultTriggers("area")).toEqual(["areaPlaced"]);
    expect(defaultTriggers("aura")).toEqual(["effectApplied"]);
  });

  it("rejects invalid recipes", () => {
    expect(() => compile({ version: 1, preset: "nope", animation: "x" }, ev(), ctx)).toThrow(/preset/);
  });
});
