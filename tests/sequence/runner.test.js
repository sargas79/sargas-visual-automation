import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequence } from "../../src/shared/descriptors.js";
import { isVisibleTo, playLocalSound, resolveEffect, runSequence } from "../../src/sequence/runner.js";
import { createMockEngine } from "./helpers/engine.js";

const fx = (id, extra = {}) => ({ type: "effect", effect: { id, file: "f", atLocation: { x: 0, y: 0 }, ...extra } });

function deps(engine, extra = {}) {
  return { engine, userId: "user1", viewedSceneId: "scene1", playSound: vi.fn(async () => {}), ...extra };
}

describe("runSequence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays effects in order without waiting by default", async () => {
    const engine = createMockEngine();
    const seq = createSequence([fx("a"), fx("b")], { sceneId: "scene1" });
    await runSequence(seq, deps(engine));
    expect(engine.log).toEqual(["play:a", "play:b"]);
    expect(engine.play.mock.calls[0][0]).toMatchObject({ id: "a", sceneId: "scene1" });
  });

  it("waits for the effect to finish plus the offset", async () => {
    const engine = createMockEngine();
    const seq = createSequence([{ ...fx("a"), waitUntilFinished: 100 }, fx("b")], { sceneId: "scene1" });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.log).toEqual(["play:a"]);
    engine.finish("a");
    await vi.advanceTimersByTimeAsync(99);
    expect(engine.log).toEqual(["play:a"]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(engine.log).toEqual(["play:a", "play:b"]);
  });

  it("negative offsets continue early when the duration is known", async () => {
    const engine = createMockEngine();
    const seq = createSequence([{ ...fx("a", { duration: 1000 }), waitUntilFinished: -300 }, fx("b")], {
      sceneId: "scene1"
    });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(699);
    expect(engine.log).toEqual(["play:a"]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(engine.log).toEqual(["play:a", "play:b"]);
  });

  it("does not block on persistent effects", async () => {
    const engine = createMockEngine();
    const seq = createSequence([{ ...fx("a", { persist: true }), waitUntilFinished: 0 }, fx("b")], {
      sceneId: "scene1"
    });
    await runSequence(seq, deps(engine));
    expect(engine.log).toEqual(["play:a", "play:b"]);
  });

  it("honours wait steps", async () => {
    const engine = createMockEngine();
    const seq = createSequence([fx("a"), { type: "wait", ms: 500 }, fx("b")], { sceneId: "scene1" });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(499);
    expect(engine.log).toEqual(["play:a"]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(engine.log).toEqual(["play:a", "play:b"]);
  });

  it("plays sounds after their delay without blocking", async () => {
    const engine = createMockEngine();
    const d = deps(engine, { volume: 0.5 });
    const seq = createSequence([{ type: "sound", file: "s.ogg", volume: 0.8, delay: 200 }, fx("b")], {
      sceneId: "scene1"
    });
    const run = runSequence(seq, d);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.log).toEqual(["play:b"]);
    expect(d.playSound).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await run;
    expect(d.playSound).toHaveBeenCalledWith("s.ogg", { volume: 0.4 });
  });

  it("skips sequences for another scene or other users", async () => {
    const engine = createMockEngine();
    await runSequence(createSequence([fx("a")], { sceneId: "other" }), deps(engine));
    await runSequence(createSequence([fx("b")], { sceneId: "scene1", users: ["u9"] }), deps(engine));
    await runSequence(createSequence([fx("c", { users: ["u9"] })], { sceneId: "scene1" }), deps(engine));
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("keeps going when a step fails", async () => {
    const engine = createMockEngine();
    vi.spyOn(console, "error").mockImplementation(() => {});
    engine.play.mockRejectedValueOnce(new Error("bad file"));
    await runSequence(createSequence([fx("a"), fx("b")], { sceneId: "scene1" }), deps(engine));
    expect(engine.play).toHaveBeenCalledTimes(2);
  });

  it("applies the effect filter", async () => {
    const engine = createMockEngine();
    const filterEffect = (e) => (e.id === "a" ? null : { ...e, tint: "#fff" });
    await runSequence(createSequence([fx("a"), fx("b")], { sceneId: "scene1" }), deps(engine, { filterEffect }));
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.play.mock.calls[0][0]).toMatchObject({ id: "b", tint: "#fff" });
  });
});

/**
 * Engine whose play() behaves like the real one: resolves after the file loads AND the effect's delay elapses
 * (in parallel), then the effect runs for `duration` ms.
 */
function createTimedEngine({ loadMs = 50 } = {}) {
  const log = [];
  const engine = {
    log,
    play: vi.fn(async (effect) => {
      log.push(`start:${effect.id}@${Date.now()}`);
      await new Promise((r) => setTimeout(r, Math.max(loadMs, effect.delay ?? 0)));
      log.push(`mounted:${effect.id}@${Date.now()}`);
      const finished = new Promise((r) => setTimeout(r, effect.duration ?? 1000));
      return { id: effect.id, finished };
    })
  };
  return engine;
}

describe("runSequence timing with a loading engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("starts effects in order and in parallel: delays stagger instead of accumulating", async () => {
    const engine = createTimedEngine();
    const seq = createSequence([fx("a"), fx("b", { delay: 100 }), fx("c", { delay: 200 })], { sceneId: "scene1" });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.log).toEqual(["start:a@0", "start:b@0", "start:c@0"]);
    await vi.advanceTimersByTimeAsync(200);
    await run;
    expect(engine.log.filter((l) => l.startsWith("mounted"))).toEqual([
      "mounted:a@50",
      "mounted:b@100",
      "mounted:c@200"
    ]);
  });

  it("waitUntilFinished still blocks the next step", async () => {
    const engine = createTimedEngine();
    const seq = createSequence([{ ...fx("a", { duration: 500 }), waitUntilFinished: 0 }, fx("b")], {
      sceneId: "scene1"
    });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(549);
    expect(engine.log).toEqual(["start:a@0", "mounted:a@50"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.log).toContain("start:b@550");
    await vi.advanceTimersByTimeAsync(50);
    await run;
  });

  it("negative offsets count the delay once", async () => {
    const engine = createTimedEngine();
    // Mounted at 300 (delay), ends at 1300: the next step starts 200 ms before, at 1100.
    const seq = createSequence([{ ...fx("a", { delay: 300, duration: 1000 }), waitUntilFinished: -200 }, fx("b")], {
      sceneId: "scene1"
    });
    const run = runSequence(seq, deps(engine));
    await vi.advanceTimersByTimeAsync(1099);
    expect(engine.log).toEqual(["start:a@0", "mounted:a@300"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.log).toContain("start:b@1100");
    await vi.advanceTimersByTimeAsync(1000);
    await run;
  });

  it("logs failures of non-blocking effects without stopping the sequence", async () => {
    const engine = createTimedEngine();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    engine.play.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("bad file");
    });
    const run = runSequence(createSequence([fx("a"), fx("b")], { sceneId: "scene1" }), deps(engine));
    await vi.advanceTimersByTimeAsync(100);
    await run;
    expect(engine.play).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("isVisibleTo treats empty lists as everyone", () => {
    expect(isVisibleTo([], "a")).toBe(true);
    expect(isVisibleTo(undefined, "a")).toBe(true);
    expect(isVisibleTo(["b"], "a")).toBe(false);
  });

  it("resolveEffect inherits scene and users", () => {
    expect(resolveEffect({ id: "x" }, { sceneId: "s", users: ["u"] })).toEqual({ id: "x", sceneId: "s", users: ["u"] });
    expect(resolveEffect({ id: "x", sceneId: "t", users: ["v"] }, { sceneId: "s", users: ["u"] })).toEqual({
      id: "x",
      sceneId: "t",
      users: ["v"]
    });
  });

  it("playLocalSound uses AudioHelper locally", async () => {
    const play = vi.fn(() => ({ duration: 0, addEventListener: vi.fn() }));
    globalThis.foundry = { audio: { AudioHelper: { play } } };
    await playLocalSound("x.ogg", { volume: 0.3 });
    expect(play).toHaveBeenCalledWith({ src: "x.ogg", volume: 0.3, autoplay: true, loop: false }, false);
    delete globalThis.foundry;
  });

  it("playLocalSound skips sounds of modules that are not installed", async () => {
    const play = vi.fn(() => ({ duration: 0, addEventListener: vi.fn() }));
    globalThis.foundry = { audio: { AudioHelper: { play } } };
    const before = globalThis.game;
    globalThis.game = { modules: new Map([["soundfxlibrary", { active: false }]]) };
    await playLocalSound("modules/missing-module/a.mp3");
    expect(play).not.toHaveBeenCalled();
    await playLocalSound("modules/soundfxlibrary/Combat/Single/Melee%20Miss/melee-miss-1.mp3");
    await playLocalSound("worlds/w/a.mp3");
    expect(play).toHaveBeenCalledTimes(2);
    globalThis.game = before;
    delete globalThis.foundry;
  });
});
