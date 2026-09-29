import { describe, expect, it } from "vitest";
import {
  computeTimeline,
  DEFAULT_END_FADE,
  DEFAULT_IMAGE_DURATION,
  endRequestedAt,
  sampleEnvelope,
  videoStep
} from "../../src/engine/timeline.js";
import { EASINGS, easedProgress, getEasing } from "../../src/engine/easing.js";

describe("easing", () => {
  it("every easing maps 0 → 0 and 1 → 1", () => {
    for (const [name, fn] of Object.entries(EASINGS)) {
      expect(fn(0), name).toBeCloseTo(0, 5);
      expect(fn(1), name).toBeCloseTo(1, 5);
    }
  });
  it("falls back to linear and clamps progress", () => {
    expect(getEasing("nope")(0.3)).toBe(0.3);
    expect(easedProgress(50, 100)).toBe(0.5);
    expect(easedProgress(500, 100, "easeInQuad")).toBe(1);
    expect(easedProgress(10, 0)).toBe(1);
    expect(easedProgress(50, 100, "easeInQuad")).toBe(0.25);
  });
});

describe("computeTimeline", () => {
  it("plays the whole clip once by default", () => {
    expect(computeTimeline({}, 2000)).toMatchObject({ playStart: 0, playEnd: 2000, segment: 2000, total: 2000 });
  });
  it("applies startTime, endTime and playbackRate", () => {
    const t = computeTimeline({ startTime: 500, endTime: 500, playbackRate: 2 }, 3000);
    expect(t).toMatchObject({ playStart: 500, playEnd: 2500, segment: 1000, total: 1000, repeat: false });
  });
  it("repeats the clip for a forced longer duration and cuts for a shorter one", () => {
    expect(computeTimeline({ duration: 5000 }, 2000)).toMatchObject({ total: 5000, repeat: true });
    expect(computeTimeline({ duration: 500 }, 2000)).toMatchObject({ total: 500, repeat: false });
  });
  it("clamps bad start/end times", () => {
    expect(computeTimeline({ startTime: 5000, endTime: 9000 }, 2000)).toMatchObject({ playStart: 2000, playEnd: 2000 });
  });
  it("persistent effects never end on their own", () => {
    expect(computeTimeline({ persist: true }, 2000)).toMatchObject({ total: Infinity, repeat: true });
  });
  it("images last the forced duration or a default", () => {
    expect(computeTimeline({}, 0)).toMatchObject({ isStatic: true, total: DEFAULT_IMAGE_DURATION });
    expect(computeTimeline({ duration: 3000 }, NaN)).toMatchObject({ isStatic: true, total: 3000 });
  });
});

describe("videoStep", () => {
  it("does nothing inside the segment", () => {
    expect(videoStep(computeTimeline({}, 2000), 1000)).toBeNull();
  });
  it("restarts repeating clips and pauses the others at playEnd", () => {
    expect(videoStep(computeTimeline({ duration: 5000, startTime: 200 }, 2000), 2000)).toEqual({
      seek: 200,
      play: true
    });
    expect(videoStep(computeTimeline({ endTime: 500 }, 2000), 1600)).toEqual({ pause: true });
  });
  it("ignores images", () => {
    expect(videoStep(computeTimeline({}, 0), 99999)).toBeNull();
  });
});

describe("endRequestedAt", () => {
  it("fades out from now, never later than planned", () => {
    expect(endRequestedAt({ elapsed: 100, endAt: Infinity })).toBe(100 + DEFAULT_END_FADE);
    expect(endRequestedAt({ elapsed: 100, endAt: Infinity, fadeOut: { duration: 200 } })).toBe(300);
    expect(endRequestedAt({ elapsed: 100, endAt: 150, fadeOut: { duration: 200 } })).toBe(150);
    expect(endRequestedAt({ elapsed: 100, endAt: Infinity, immediate: true })).toBe(100);
  });
});

describe("sampleEnvelope", () => {
  const base = { endAt: 1000 };
  it("is neutral without animations", () => {
    expect(sampleEnvelope({ ...base, elapsed: 500 })).toEqual({ alpha: 1, scale: 1 });
  });
  it("fades in and out", () => {
    const fades = { ...base, fadeIn: { duration: 200 }, fadeOut: { duration: 200 } };
    expect(sampleEnvelope({ ...fades, elapsed: 0 }).alpha).toBe(0);
    expect(sampleEnvelope({ ...fades, elapsed: 100 }).alpha).toBe(0.5);
    expect(sampleEnvelope({ ...fades, elapsed: 500 }).alpha).toBe(1);
    expect(sampleEnvelope({ ...fades, elapsed: 900 }).alpha).toBe(0.5);
    expect(sampleEnvelope({ ...fades, elapsed: 1000 }).alpha).toBe(0);
  });
  it("applies easing to fades", () => {
    const e = sampleEnvelope({ ...base, elapsed: 100, fadeIn: { duration: 200, ease: "easeInQuad" } });
    expect(e.alpha).toBe(0.25);
  });
  it("scales in from and out to a value", () => {
    const s = { ...base, scaleIn: { value: 0.5, duration: 200 }, scaleOut: { value: 2, duration: 200 } };
    expect(sampleEnvelope({ ...s, elapsed: 0 }).scale).toBe(0.5);
    expect(sampleEnvelope({ ...s, elapsed: 100 }).scale).toBe(0.75);
    expect(sampleEnvelope({ ...s, elapsed: 500 }).scale).toBe(1);
    expect(sampleEnvelope({ ...s, elapsed: 900 }).scale).toBe(1.5);
  });
  it("persistent effects (endAt = Infinity) never fade out on their own", () => {
    expect(sampleEnvelope({ endAt: Infinity, elapsed: 1e9, fadeOut: { duration: 500 } }).alpha).toBe(1);
  });
});
