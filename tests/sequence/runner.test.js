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
});
