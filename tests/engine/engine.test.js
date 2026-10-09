import { describe, expect, it, vi } from "vitest";
import { EffectEngine, skipReason } from "../../src/engine/engine.js";
import { TextureCache } from "../../src/engine/texture-cache.js";
import { createFakeBackend } from "./helpers/fake-backend.js";
import { createFakeEnv } from "./helpers/fake-env.js";
import { createMockDb } from "./helpers/mock-db.js";

function setup(options = {}) {
  const backend = createFakeBackend();
  const textures = new TextureCache({ backend });
  const env = createFakeEnv(options);
  const api = { db: createMockDb() };
  const engine = new EffectEngine({ api, textures, env });
  return { engine, env, backend, textures, api };
}

const effect = (extra = {}) => ({ file: "jb2a.aura.blue", atLocation: { x: 100, y: 100 }, ...extra });

describe("skipReason", () => {
  const ctx = { ready: true, sceneId: "s1", userId: "u1" };
  it("plays for the viewed scene and listed users", () => {
    expect(skipReason({ sceneId: "s1", users: ["u1"] }, ctx)).toBeNull();
    expect(skipReason({ users: [] }, ctx)).toBeNull();
  });
  it("skips other scenes, other users and missing canvas", () => {
    expect(skipReason({ sceneId: "s2" }, ctx)).toBe("other scene");
    expect(skipReason({ users: ["u2"] }, ctx)).toBe("not for this user");
    expect(skipReason({}, { ...ctx, ready: false })).toBe("canvas not ready");
  });
});

describe("EffectEngine", () => {
  it("plays an effect and resolves finished when it ends", async () => {
    const { engine, env, textures } = setup();
    const handle = await engine.play(effect({ id: "e1" }));
    expect(handle.id).toBe("e1");
    expect(engine.get("e1")).toBe(handle);
    expect(engine.active()).toEqual([handle]);
    expect(env.sprites[0].params.resolved.file).toBe("jb2a/Aura_Blue_400x400.webm");
    expect(textures.stats().inUse).toBe(1);
    env.tick(500);
    expect(engine.active()).toHaveLength(1);
    env.tick(600);
    await handle.finished;
    expect(engine.active()).toHaveLength(0);
    expect(env.sprites[0].destroyed).toBe(true);
    expect(textures.stats().inUse).toBe(0);
    expect(env.tickers.size).toBe(0);
  });

  it("returns an already finished handle for skipped effects", async () => {
    const { engine, env } = setup();
    const other = await engine.play(effect({ sceneId: "elsewhere" }));
    const hidden = await engine.play(effect({ users: ["someone"] }));
    await other.finished;
    await hidden.finished;
    expect(env.createSprite).not.toHaveBeenCalled();
    expect(engine.active()).toHaveLength(0);
  });

  it("handles invalid descriptors and unknown files without throwing", async () => {
    const { engine } = setup();
    await (
      await engine.play({ file: "x" })
    ).finished;
    const h = await engine.play(effect({ file: "jb2a.nope" }));
    await h.finished;
    expect(engine.active()).toHaveLength(0);
  });

  it("reports the file as loaded before the effect's delay has elapsed", async () => {
    const { engine, env } = setup();
    let endDelay;
    env.wait.mockImplementationOnce(() => new Promise((resolve) => (endDelay = resolve)));
    const onLoaded = vi.fn();
    const playing = engine.play(effect({ id: "late", delay: 500 }), { onLoaded });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(env.createSprite).not.toHaveBeenCalled();
    endDelay();
    await playing;
    expect(env.createSprite).toHaveBeenCalledTimes(1);

    const failed = vi.fn();
    await engine.play(effect({ id: "bad", file: "jb2a.nope" }), { onLoaded: failed });
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("returns the existing handle for a duplicate id", async () => {
    const { engine } = setup();
    const a = await engine.play(effect({ id: "same" }));
    const b = await engine.play(effect({ id: "same" }));
    expect(b).toBe(a);
  });

  it("ends with a fade unless immediate", async () => {
    const { engine, env } = setup();
    const a = await engine.play(effect({ id: "a", persist: true }));
    const b = await engine.play(effect({ id: "b", persist: true }));
    const endA = engine.end("a");
    env.tick(50);
    expect(engine.get("a")).toBeDefined();
    env.tick(60);
    await endA;
    await a.finished;
    await engine.end("b", { immediate: true });
    await b.finished;
    expect(engine.active()).toHaveLength(0);
  });

  it("endAll ends everything, including effects still loading", async () => {
    const { engine } = setup();
    const pending = engine.play(effect({ id: "late" }));
    await engine.play(effect({ id: "now", persist: true }));
    const all = engine.endAll({ immediate: true });
    const late = await pending;
    await all;
    await late.finished;
    expect(engine.active()).toHaveLength(0);
  });

  it("waits for the delay before showing the effect", async () => {
    const { engine, env } = setup();
    await engine.play(effect({ delay: 250 }));
    expect(env.wait).toHaveBeenCalledWith(250);
  });

  it("preloads database paths and URLs", async () => {
    const { engine, backend } = setup();
    await engine.preload(["jb2a.aura.blue", "modules/x/y.webm"]);
    expect(backend.load).toHaveBeenCalledTimes(2);
    await engine.play(effect());
    expect(backend.load).toHaveBeenCalledTimes(2);
  });
});
