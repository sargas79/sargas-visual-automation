import { describe, expect, it, vi } from "vitest";
import {
  captureSize,
  captureTime,
  createFrameCapture,
  createLimiter,
  createUrlCache,
  grabFrame
} from "../../src/ui/frame-capture.js";

describe("frame capture helpers", () => {
  it("seeks into the effect, never past the end", () => {
    expect(captureTime(2)).toBeCloseTo(0.8);
    expect(captureTime(2, 1)).toBeCloseTo(1.95);
    expect(captureTime(2, -1)).toBe(0);
    expect(captureTime(Number.NaN)).toBe(0);
    expect(captureTime(0)).toBe(0);
  });

  it("keeps the aspect ratio and never upscales", () => {
    expect(captureSize(1600, 400, 240)).toEqual({ width: 240, height: 60 });
    expect(captureSize(100, 50, 240)).toEqual({ width: 100, height: 50 });
    expect(captureSize(0, 50)).toBeNull();
  });

  it("evicts and revokes the least recently used URL", () => {
    const revoke = vi.fn();
    const cache = createUrlCache(2, revoke);
    cache.set("a", "blob:a");
    cache.set("b", "blob:b");
    expect(cache.get("a")).toBe("blob:a"); // a is now the most recent
    cache.set("c", null);
    expect(revoke).toHaveBeenCalledWith("blob:b");
    expect(cache.has("b")).toBe(false);
    expect(cache.get("c")).toBeNull();
    expect(cache.get("missing")).toBeUndefined();
    cache.clear();
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(cache.size).toBe(0);
  });

  it("limits concurrency", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          resolve(active);
        }, 1);
      });
    await Promise.all([
      run(task),
      run(task),
      run(task),
      run(task),
      run(() => Promise.reject(new Error("x"))).catch(() => 0)
    ]);
    expect(peak).toBe(2);
  });

  it("returns null without a DOM", async () => {
    await expect(grabFrame("modules/x.webm")).resolves.toBeNull();
  });
});

describe("createFrameCapture", () => {
  it("captures once per key and caches failures", async () => {
    const grab = vi.fn(async (file) => (file.includes("ok") ? `blob:${file}` : null));
    const capture = createFrameCapture({ grab, limit: 1 });
    expect(capture.peek("jb2a.a")).toBeUndefined();
    const [a, b] = await Promise.all([capture.capture("jb2a.a", "ok.webm"), capture.capture("jb2a.a", "ok.webm")]);
    expect(a).toBe("blob:ok.webm");
    expect(b).toBe(a);
    expect(grab).toHaveBeenCalledTimes(1);
    expect(capture.peek("jb2a.a")).toBe("blob:ok.webm");
    await expect(capture.capture("jb2a.b", "bad.webm")).resolves.toBeNull();
    await capture.capture("jb2a.b", "bad.webm");
    expect(grab).toHaveBeenCalledTimes(2);
    expect(capture.peek("jb2a.b")).toBeNull();
  });

  it("treats a throwing grabber as a failed capture", async () => {
    const capture = createFrameCapture({
      grab: async () => {
        throw new Error("decode");
      }
    });
    await expect(capture.capture("k", "f.webm")).resolves.toBeNull();
  });
});
