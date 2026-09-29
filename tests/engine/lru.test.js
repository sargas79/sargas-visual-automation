import { describe, expect, it, vi } from "vitest";
import { LruCache } from "../../src/engine/lru.js";

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const onEvict = vi.fn();
    const lru = new LruCache({ max: 2, onEvict });
    lru.set("a", 1).set("b", 2);
    lru.get("a");
    lru.set("c", 3);
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(onEvict).toHaveBeenCalledWith(2, "b");
  });

  it("never evicts pinned entries", () => {
    const lru = new LruCache({ max: 1, isPinned: (v) => v.pinned });
    lru.set("a", { pinned: true });
    lru.set("b", { pinned: true });
    expect(lru.size).toBe(2);
    lru.peek("a").pinned = false;
    lru.trim();
    expect(lru.keys()).toEqual(["b"]);
  });

  it("peek does not change recency", () => {
    const lru = new LruCache({ max: 2 });
    lru.set("a", 1).set("b", 2);
    lru.peek("a");
    lru.set("c", 3);
    expect(lru.has("a")).toBe(false);
  });

  it("resize and clear evict", () => {
    const onEvict = vi.fn();
    const lru = new LruCache({ max: 3, onEvict });
    lru.set("a", 1).set("b", 2).set("c", 3);
    lru.resize(1);
    expect(lru.keys()).toEqual(["c"]);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it("replacing a value evicts the old one", () => {
    const onEvict = vi.fn();
    const lru = new LruCache({ max: 3, onEvict });
    lru.set("a", 1).set("a", 2);
    expect(onEvict).toHaveBeenCalledWith(1, "a");
    expect(lru.get("a")).toBe(2);
  });
});
