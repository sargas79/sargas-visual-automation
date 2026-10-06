import { describe, expect, it, vi } from "vitest";
import { formatStats } from "../../src/engine/debug-overlay.js";
import { EffectEngine } from "../../src/engine/engine.js";
import { ObjectPool, planCapacity } from "../../src/engine/pool.js";
import { TextureCache } from "../../src/engine/texture-cache.js";
import { createFakeBackend } from "./helpers/fake-backend.js";
import { createFakeEnv } from "./helpers/fake-env.js";
import { createMockDb } from "./helpers/mock-db.js";

describe("ObjectPool", () => {
  it("reuses released objects and prepares them on acquire", () => {
    const prepare = vi.fn((obj, texture) => (obj.texture = texture));
    const pool = new ObjectPool({ create: () => ({}), prepare });
    const a = pool.acquire("t1");
    pool.release(a);
    pool.release(a);
    expect(pool.size).toBe(1);
    const b = pool.acquire("t2");
    expect(b).toBe(a);
    expect(b.texture).toBe("t2");
    expect(pool.counters).toMatchObject({ created: 1, reused: 1 });
  });

  it("destroys objects beyond max, refused by reset, or dead", () => {
    const destroy = vi.fn();
    const pool = new ObjectPool({
      create: () => ({ dead: false }),
      reset: (o) => !o.bad,
      destroy,
      isAlive: (o) => !o.dead,
      max: 1
    });
    const [a, b, c] = [pool.acquire(), pool.acquire(), pool.acquire()];
    c.bad = true;
    pool.release(a);
    pool.release(b);
    pool.release(c);
    expect(destroy).toHaveBeenCalledTimes(2);
    a.dead = true;
    expect(pool.acquire()).not.toBe(a);
    pool.clear();
    expect(pool.size).toBe(0);
  });
});

describe("planCapacity", () => {
  const e = (id, persist = false) => ({ id, persist });
  it("does nothing under the budget", () => {
    expect(planCapacity({ active: [e("a")], max: 5 })).toEqual({ evict: [], skip: false });
  });
  it("evicts the oldest short effects first", () => {
    expect(planCapacity({ active: [e("p", true), e("a"), e("b")], max: 3 })).toEqual({ evict: ["a"], skip: false });
  });
  it("never evicts persistent effects; skips a short newcomer instead", () => {
    expect(planCapacity({ active: [e("p", true), e("q", true)], max: 2 })).toEqual({ evict: [], skip: true });
    expect(planCapacity({ active: [e("p", true)], max: 1, incomingPersist: true })).toEqual({
      evict: [],
      skip: false
    });
  });
});

function setup(max) {
  const env = createFakeEnv();
  const textures = new TextureCache({ backend: createFakeBackend() });
  const engine = new EffectEngine({ api: { db: createMockDb() }, textures, env, maxEffects: () => max });
  return { env, engine, textures };
}
const effect = (id, extra = {}) => ({ id, file: "jb2a.aura.blue", atLocation: { x: 0, y: 0 }, ...extra });

describe("engine budget and tear down", () => {
  it("does not count effects cancelled while loading against the budget", async () => {
    const { engine, env } = setup(2);
    let release;
    env.wait.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const loading = engine.play(effect("p", { persist: true }));
    engine.end("p", { immediate: true });
    await engine.play(effect("b"));
    await engine.play(effect("c"));
    release();
    await loading;
    expect(engine.active().map((h) => h.id)).toEqual(["b", "c"]);
    expect(engine.stats()).toMatchObject({ evicted: 0 });
  });

  it("ends the oldest effect when the budget is reached", async () => {
    const { engine } = setup(2);
    const a = await engine.play(effect("a"));
    await engine.play(effect("b"));
    await engine.play(effect("c"));
    await a.finished;
    expect(engine.active().map((h) => h.id)).toEqual(["b", "c"]);
    expect(engine.stats()).toMatchObject({ active: 2, evicted: 1, played: 3 });
  });

  it("keeps persistent effects and skips short ones when full", async () => {
    const { engine } = setup(1);
    await engine.play(effect("aura", { persist: true }));
    const short = await engine.play(effect("short"));
    await short.finished;
    expect(engine.active().map((h) => h.id)).toEqual(["aura"]);
    expect(engine.stats().skipped).toBe(1);
  });

  it("handles 20 simultaneous effects and tears everything down", async () => {
    const { engine, env, textures } = setup(50);
    const handles = await Promise.all(Array.from({ length: 20 }, (_, i) => engine.play(effect(`e${i}`))));
    expect(engine.stats().mounted).toBe(20);
    expect(textures.stats().liveInstances).toBe(20);
    engine.tearDown();
    await Promise.all(handles.map((h) => h.finished));
    expect(engine.active()).toHaveLength(0);
    expect(env.tickers.size).toBe(0);
    textures.clear();
    expect(textures.stats().liveInstances).toBe(0);
  });

  it("drops effects that were still loading at tear down, and replays the same id afterwards", async () => {
    const { engine } = setup(50);
    const loading = engine.play(effect("aura", { persist: true }));
    engine.tearDown();
    const old = await loading;
    await old.finished;
    const again = await engine.play(effect("aura", { persist: true }));
    expect(again).not.toBe(old);
    expect(engine.get("aura")).toBe(again);
  });

  it("formats debug counters", () => {
    const { engine } = setup(10);
    expect(formatStats(engine.stats(), 60)).toContain("SVA effects  0/10");
  });
});
