import { beforeEach, describe, expect, it } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import * as prefs from "../../src/net/preferences.js";
import { SequenceBuilder } from "../../src/sequence/builder.js";
import { runSequence } from "../../src/sequence/runner.js";
import { createMockEngine } from "./helpers/engine.js";

const newSequence = () => new SequenceBuilder({}, { sceneId: "scene1", userId: "user1" });

describe("EffectBuilder.essential (#66)", () => {
  it("sets essential, defaults to true, and null clears it", () => {
    const desc = newSequence()
      .effect()
      .file("a")
      .atLocation("t")
      .essential()
      .effect()
      .file("b")
      .atLocation("t")
      .essential(false)
      .effect()
      .file("c")
      .atLocation("t")
      .essential(true)
      .essential(null)
      .toDescriptor();
    const [a, b, c] = desc.steps.map((s) => s.effect);
    expect(a.essential).toBe(true);
    expect(b.essential).toBe(false);
    expect("essential" in c).toBe(false);
    expect(JSON.parse(JSON.stringify(desc))).toEqual(desc);
  });

  it("accepts essential from an initial partial descriptor", () => {
    const desc = newSequence().effect({ file: "a", atLocation: "t", essential: true }).toDescriptor();
    expect(desc.steps[0].effect.essential).toBe(true);
  });
});

describe("runner with reduced motion (#66)", () => {
  beforeEach(() => prefs.registerNetSettings());

  const build = () =>
    newSequence()
      .effect()
      .file("flourish")
      .atLocation("t")
      .essential(false)
      .waitUntilFinished(0)
      .effect()
      .file("impact")
      .atLocation("t")
      .layer("screen")
      .scaleIn(0, 200)
      .essential()
      .effect()
      .file("legacy")
      .atLocation("t")
      .returnTrip()
      .effect()
      .file("legacy-screen")
      .atLocation("t")
      .layer("screen")
      .effect()
      .file("aura")
      .atLocation("t")
      .persist()
      .essential(false)
      .toDescriptor();

  const run = async () => {
    const engine = createMockEngine({ autoFinishMs: 1 });
    await runSequence(build(), {
      engine,
      userId: "user1",
      viewedSceneId: "scene1",
      filterEffect: prefs.filterEffect
    });
    return engine.play.mock.calls.map(([effect]) => effect);
  };

  it("plays everything when reduced motion is off", async () => {
    const played = await run();
    expect(played.map((e) => e.file)).toEqual(["flourish", "impact", "legacy", "legacy-screen", "aura"]);
  });

  it("skips non-essential effects, keeps essential ones as-is, and falls back for unset", async () => {
    await game.settings.set(MODULE_ID, prefs.NET_SETTINGS.REDUCED_MOTION, true);
    const played = await run();
    expect(played.map((e) => e.file)).toEqual(["impact", "legacy", "aura"]);
    const [impact, legacy] = played;
    expect(impact.scaleIn).toEqual({ value: 0, duration: 200 });
    expect(legacy.returnTrip).toBeUndefined();
  });
});
