import { describe, expect, it } from "vitest";
import { EffectEngine } from "../../src/engine/engine.js";
import { distance } from "../../src/engine/math.js";
import {
  computeStretch,
  missedOffset,
  sceneDistance,
  seededRandom,
  stretchEndpoints
} from "../../src/engine/stretch.js";
import { computeTimeline, legAt } from "../../src/engine/timeline.js";
import { TextureCache } from "../../src/engine/texture-cache.js";
import { createFakeBackend } from "./helpers/fake-backend.js";
import { createFakeEnv } from "./helpers/fake-env.js";
import { createMockDb } from "./helpers/mock-db.js";

const RANGED = { gridSize: 200, startPad: 200, endPad: 200 };

describe("computeStretch", () => {
  const db = createMockDb();

  for (const gridSizePx of [100, 140]) {
    for (const squares of [1, 6, 18]) {
      it(`lands start on the source and end on the target at ${squares} squares (grid ${gridSizePx}px)`, () => {
        const source = { x: 1000, y: 1000 };
        const angle = 0.6;
        const px = squares * gridSizePx;
        const target = { x: source.x + Math.cos(angle) * px, y: source.y + Math.sin(angle) * px };
        const resolved = db.resolve("jb2a.fire_bolt.orange", { distance: sceneDistance(px, gridSizePx, 5) });
        const texture = resolved.size;
        const s = computeStretch({ source, target, texture, template: resolved.template, gridSizePx });
        const ends = stretchEndpoints({ source, texture, template: resolved.template, ...s });
        expect(distance(ends.start, source)).toBeLessThan(1e-6);
        expect(distance(ends.end, target)).toBeLessThan(1e-6);
        expect(s.rotation).toBeCloseTo(angle);
        expect(s.anchorX).toBeCloseTo(200 / texture.width);
        expect(s.scaleY).toBeCloseTo(gridSizePx / 200);
      });
    }
  }

  it("is not distorted when the variant matches the distance", () => {
    // 30ft variant: 1600 px wide, 1200 px between pads = 6 squares of 200 px.
    const s = computeStretch({
      source: { x: 0, y: 0 },
      target: { x: 600, y: 0 },
      texture: { width: 1600 },
      template: RANGED,
      gridSizePx: 100
    });
    expect(s.scaleX).toBeCloseTo(0.5);
    expect(s.scaleY).toBeCloseTo(0.5);
  });

  it("stretches the whole texture for files without a template", () => {
    const s = computeStretch({ source: { x: 0, y: 0 }, target: { x: 0, y: 500 }, texture: { width: 1000 } });
    expect(s).toMatchObject({ anchorX: 0, scaleX: 0.5, scaleY: 1 });
  });

  it("applies only the y part of the user scale and mirrorY", () => {
    const s = computeStretch({
      source: { x: 0, y: 0 },
      target: { x: 600, y: 0 },
      texture: { width: 1600 },
      template: RANGED,
      gridSizePx: 100,
      scale: { x: 3, y: 2 },
      mirrorY: true
    });
    expect(s.scaleX).toBeCloseTo(0.5);
    expect(s.scaleY).toBeCloseTo(-1);
  });
});

describe("sceneDistance", () => {
  it("converts pixels to scene units", () => {
    expect(sceneDistance(600, 100, 5)).toBe(30);
    expect(sceneDistance(600, 0, 5)).toBe(0);
  });
});

describe("missed shots", () => {
  it("are deterministic per effect id", () => {
    const a = seededRandom("effect-1");
    const b = seededRandom("effect-1");
    const c = seededRandom("effect-2");
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect(c()).not.toBe(seqA[0]);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it("land beside the target, outside its footprint and not behind the shooter", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 1000, y: 0 };
    for (let i = 0; i < 50; i++) {
      const o = missedOffset({ source, target, radius: 50, gridSizePx: 100, rng: seededRandom(`id${i}`) });
      const reach = Math.hypot(o.x, o.y);
      expect(reach).toBeGreaterThanOrEqual(50 + 25 - 1e-9);
      expect(reach).toBeLessThanOrEqual(50 + 75 + 1e-9);
      // 45°..90° off the line of fire, towards or beside the far side of the target.
      expect(o.x).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(o.y)).toBeGreaterThanOrEqual(reach * Math.SQRT1_2 - 1e-9);
    }
  });
});

describe("return trip", () => {
  it("doubles the lifetime of stretched effects and switches leg halfway", () => {
    const t = computeTimeline({ returnTrip: true, stretchTo: { x: 0, y: 0 } }, 1000);
    expect(t).toMatchObject({ legs: 2, legDuration: 1000, total: 2000 });
    expect(legAt(t, 999)).toBe(0);
    expect(legAt(t, 1000)).toBe(1);
    expect(legAt(t, 5000)).toBe(1);
  });

  it("is ignored for non-stretched or persistent effects", () => {
    expect(computeTimeline({ returnTrip: true }, 1000).legs).toBe(1);
    expect(computeTimeline({ returnTrip: true, stretchTo: {}, persist: true }, 1000).legs).toBe(1);
  });
});

describe("engine distance variants", () => {
  it("resolves the file with the distance between the anchors in scene units", async () => {
    const env = createFakeEnv();
    env.measure = () => 42;
    const db = createMockDb();
    const engine = new EffectEngine({ api: { db }, textures: new TextureCache({ backend: createFakeBackend() }), env });
    await engine.play({
      id: "fx1",
      file: "jb2a.fire_bolt.orange",
      atLocation: { tokenId: "a" },
      stretchTo: { tokenId: "b" }
    });
    expect(db.resolve).toHaveBeenCalledWith("jb2a.fire_bolt.orange", { distance: 42, seed: "fx1" });
    expect(env.sprites[0].params.resolved.distance).toBe("30ft");
  });
});
