import { describe, expect, it } from "vitest";
import { EffectSprite } from "../../src/engine/effect-sprite.js";
import { computeTimeline, endRequestedAt, loopSegment, videoStep } from "../../src/engine/timeline.js";
import { normalizeEffect } from "../../src/shared/descriptors.js";
import { createFakeContext, createFakeInstance } from "./helpers/fake-canvas.js";

const markers = { loop: { start: 1000, end: 3000 } };

describe("loopSegment", () => {
  it("clamps markers into the played range and ignores unusable ones", () => {
    expect(loopSegment(markers, 0, 4000)).toEqual({ start: 1000, end: 3000 });
    expect(loopSegment(markers, 1500, 2500)).toEqual({ start: 1500, end: 2500 });
    expect(loopSegment({ loop: { start: 1000, end: 1010 } }, 0, 4000)).toBeNull();
    expect(loopSegment(null, 0, 4000)).toBeNull();
  });
});

describe("persistent timeline with markers", () => {
  const t = computeTimeline({ persist: true }, 4000, markers);
  it("uses the marker loop instead of repeating the whole clip", () => {
    expect(t).toMatchObject({ loop: { start: 1000, end: 3000 }, repeat: false, total: Infinity });
    expect(computeTimeline({}, 4000, markers).loop).toBeNull();
    expect(computeTimeline({ persist: true }, 4000).repeat).toBe(true);
  });
  it("plays the intro, loops the segment, and lets the outro play once ending", () => {
    expect(videoStep(t, 500)).toBeNull();
    expect(videoStep(t, 2000)).toBeNull();
    expect(videoStep(t, 3000)).toEqual({ seek: 1000, play: true });
    expect(videoStep(t, 3200, { ending: true })).toBeNull();
    expect(videoStep(t, 4000, { ending: true })).toEqual({ pause: true });
  });
  it("ends after the outro", () => {
    expect(endRequestedAt({ elapsed: 10000, endAt: Infinity, timeline: t, videoTime: 2500 })).toBe(11500);
    const fast = computeTimeline({ persist: true, playbackRate: 2 }, 4000, markers);
    expect(endRequestedAt({ elapsed: 0, endAt: Infinity, timeline: fast, videoTime: 3000 })).toBe(500);
    expect(endRequestedAt({ elapsed: 0, endAt: Infinity, timeline: t, videoTime: 2500, immediate: true })).toBe(0);
  });
});

describe("EffectSprite loop", () => {
  function fakeVideo() {
    return {
      currentTime: 0,
      paused: true,
      playbackRate: 1,
      loop: false,
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      }
    };
  }

  it("loops between the markers until ended, then plays the outro", async () => {
    const video = fakeVideo();
    const ctx = createFakeContext();
    const s = new EffectSprite({
      descriptor: normalizeEffect({ file: "jb2a.aura.blue", atLocation: { x: 0, y: 0 }, persist: true }),
      resolved: { path: "jb2a.aura.blue", file: "a.webm", markers },
      instance: createFakeInstance({ duration: 4000, video }),
      context: ctx
    });
    await s.mount();
    video.currentTime = 3.0;
    expect(s.update(16)).toBe(true);
    expect(video.currentTime).toBe(1);
    video.currentTime = 2.5;
    s.requestEnd();
    expect(s.endAt - s.elapsed).toBeCloseTo(1500);
    video.currentTime = 3.2;
    expect(s.update(16)).toBe(true);
    expect(video.currentTime).toBe(3.2);
    expect(s.update(1500)).toBe(false);
  });

  it("fades out a persistent effect without markers", async () => {
    const ctx = createFakeContext();
    const s = new EffectSprite({
      descriptor: normalizeEffect({ file: "x/y.webm", atLocation: { x: 0, y: 0 }, persist: true }),
      resolved: { file: "x/y.webm" },
      instance: createFakeInstance({ duration: 4000, video: fakeVideo() }),
      context: ctx
    });
    await s.mount();
    s.update(10000);
    s.requestEnd();
    expect(s.update(250)).toBe(true);
    expect(ctx.layers.displays[0].alpha).toBeCloseTo(0.5);
    expect(s.update(300)).toBe(false);
  });
});
