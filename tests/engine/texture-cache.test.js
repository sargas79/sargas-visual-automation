import { describe, expect, it } from "vitest";
import { TextureCache } from "../../src/engine/texture-cache.js";
import { createFakeBackend } from "./helpers/fake-backend.js";

describe("TextureCache", () => {
  it("loads the same file only once, even concurrently", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend });
    const [a, b] = await Promise.all([cache.acquire("x.webm"), cache.acquire("x.webm")]);
    const c = await cache.acquire("x.webm");
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(new Set([a.video, b.video, c.video]).size).toBe(3);
    expect(a).toMatchObject({ width: 400, height: 400, duration: 2000 });
  });

  it("leaves no live video element after release beyond the pool", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend, poolSize: 1 });
    const instances = await Promise.all([1, 2, 3].map(() => cache.acquire("x.webm")));
    expect(backend.live.size).toBe(3);
    for (const i of instances) cache.release(i);
    expect(backend.live.size).toBe(1);
    expect(cache.stats()).toMatchObject({ inUse: 0, pooled: 1, liveInstances: 1 });
    cache.clear();
    expect(backend.live.size).toBe(0);
    expect(backend.unload).toHaveBeenCalledTimes(1);
  });

  it("reuses pooled instances", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend });
    const a = await cache.acquire("x.webm");
    cache.release(a);
    const b = await cache.acquire("x.webm");
    expect(b.video).toBe(a.video);
    expect(backend.clone).toHaveBeenCalledTimes(1);
    expect(backend.reset).toHaveBeenCalledTimes(1);
  });

  it("releasing twice is harmless and destroy skips the pool", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend });
    const a = await cache.acquire("x.webm");
    cache.release(a, { destroy: true });
    cache.release(a);
    expect(backend.live.size).toBe(0);
    expect(cache.stats().inUse).toBe(0);
  });

  it("evicts least recently used files but never files in use", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend, max: 1 });
    const a = await cache.acquire("a.webm");
    const b = await cache.acquire("b.webm");
    expect(cache.has("a.webm")).toBe(true);
    expect(cache.has("b.webm")).toBe(true);
    cache.release(a);
    expect(cache.has("a.webm")).toBe(false);
    expect(cache.has("b.webm")).toBe(true);
    expect(backend.unload).toHaveBeenCalledWith(expect.objectContaining({ src: "a.webm" }));
    expect(backend.live.size).toBe(1);
    // A preloaded, unused file is the first to go when the cache is full.
    await cache.preload(["c.webm"]);
    expect(cache.has("c.webm")).toBe(false);
    cache.release(b);
    expect(cache.size).toBe(1);
  });

  it("defers unloading a cleared file until its last instance is released", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend });
    const a = await cache.acquire("a.webm");
    cache.clear();
    expect(backend.unload).not.toHaveBeenCalled();
    cache.release(a);
    expect(backend.unload).toHaveBeenCalledTimes(1);
    expect(backend.live.size).toBe(0);
  });

  it("reports preload failures without throwing", async () => {
    const backend = createFakeBackend({ fail: ["bad.webm"] });
    const cache = new TextureCache({ backend });
    const results = await cache.preload(["ok.webm", "bad.webm", "ok.webm"]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    await expect(cache.acquire("bad.webm")).rejects.toThrow();
    // The failure is remembered: no second fetch.
    expect(cache.stats().failures).toBe(1);
    expect(cache.stats().inUse).toBe(0);
  });

  it("retries a failed file only after the failure TTL", async () => {
    const backend = createFakeBackend({ fail: ["bad.webm"] });
    let now = 0;
    const cache = new TextureCache({ backend, failureTtl: 1000, now: () => now });
    await expect(cache.acquire("bad.webm")).rejects.toThrow("missing bad.webm");
    now = 999;
    await expect(cache.acquire("bad.webm")).rejects.toThrow("missing bad.webm");
    expect(backend.load).toHaveBeenCalledTimes(1);
    now = 1000;
    await expect(cache.acquire("bad.webm")).rejects.toThrow();
    expect(backend.load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("retries a transient failure right away", async () => {
    const backend = createFakeBackend({ flaky: ["slow.webm"] });
    const cache = new TextureCache({ backend });
    expect((await cache.preload(["slow.webm"]))[0].ok).toBe(false);
    await expect(cache.acquire("slow.webm")).rejects.toThrow("network error");
    expect(backend.load).toHaveBeenCalledTimes(2);
  });

  it("pruneIdle unloads files unused for a while and forgets failures", async () => {
    const backend = createFakeBackend({ fail: ["bad.webm"] });
    let now = 0;
    const cache = new TextureCache({ backend, now: () => now });
    cache.release(await cache.acquire("old.webm"));
    await expect(cache.acquire("bad.webm")).rejects.toThrow();
    now = 500;
    cache.release(await cache.acquire("recent.webm"));
    const held = await cache.acquire("held.webm");
    now = 1000;
    cache.pruneIdle(600);
    expect(cache.has("old.webm")).toBe(false);
    expect(cache.has("recent.webm")).toBe(true);
    expect(cache.has("held.webm")).toBe(true);
    expect(backend.unload).toHaveBeenCalledTimes(1);
    await expect(cache.acquire("bad.webm")).rejects.toThrow();
    expect(backend.load.mock.calls.filter(([src]) => src === "bad.webm")).toHaveLength(2);
    cache.release(held);
  });

  it("drainPools frees idle instances but keeps prototypes", async () => {
    const backend = createFakeBackend();
    const cache = new TextureCache({ backend });
    cache.release(await cache.acquire("x.webm"));
    expect(backend.live.size).toBe(1);
    cache.drainPools();
    expect(backend.live.size).toBe(0);
    expect(cache.has("x.webm")).toBe(true);
    expect(backend.unload).not.toHaveBeenCalled();
    await cache.acquire("x.webm");
    expect(backend.load).toHaveBeenCalledTimes(1);
  });
});
