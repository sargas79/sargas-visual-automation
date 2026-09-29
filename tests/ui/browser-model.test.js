import { describe, expect, it, vi } from "vitest";
import {
  breadcrumbs,
  createChildCache,
  expandTo,
  favouriteEntries,
  flattenTree,
  normalizeQuery,
  paginate,
  searchPage,
  shortPath,
  sortEntries,
  toCards,
  toggleFavourite,
  toggleInSet
} from "../../src/ui/models/browser-model.js";
import { createFakeDb } from "./helpers/fake-db.js";

describe("browser tree", () => {
  it("lists only branches and visits only expanded ones", () => {
    const db = createFakeDb();
    const list = createChildCache((p) => db.list(p));
    const collapsed = flattenTree(list, {});
    expect(collapsed.map((r) => r.path)).toEqual(["jb2a.fire_bolt", "jb2a.healing_generic"]);
    const open = flattenTree(list, { expanded: new Set(["jb2a.fire_bolt"]), selected: "jb2a.fire_bolt" });
    expect(open.map((r) => [r.path, r.depth])).toEqual([
      ["jb2a.fire_bolt", 0],
      ["jb2a.fire_bolt.dark", 1],
      ["jb2a.healing_generic", 0]
    ]);
    expect(open[0]).toMatchObject({ expanded: true, selected: true, name: "fire bolt" });
  });

  it("caches list calls and survives lister errors", () => {
    const lister = vi.fn((p) => {
      if (p === "bad") throw new Error("boom");
      return [{ path: `${p}.a`, name: "a", isLeaf: true }];
    });
    const list = createChildCache(lister);
    list("x");
    list("x");
    expect(lister).toHaveBeenCalledTimes(1);
    expect(list("bad")).toEqual([]);
  });

  it("stays bounded for a large catalog", () => {
    const branches = Array.from({ length: 300 }, (_, i) => ({ path: `jb2a.b${i}`, name: `b${i}`, isLeaf: false }));
    const leaves = Array.from({ length: 12000 }, (_, i) => ({ path: `jb2a.b0.l${i}`, name: `l${i}`, isLeaf: true }));
    const list = createChildCache((p) => (p === "jb2a" ? branches : p === "jb2a.b0" ? leaves : []));
    const start = performance.now();
    const rows = flattenTree(list, { expanded: new Set(["jb2a.b0"]) });
    const page = paginate(sortEntries(list("jb2a.b0")), 3, 48);
    expect(rows).toHaveLength(300);
    expect(page.items).toHaveLength(48);
    expect(page.pageCount).toBe(250);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("expands ancestors and toggles", () => {
    expect([...expandTo(new Set(), "jb2a.fire_bolt.dark.leaf")]).toEqual(["jb2a.fire_bolt", "jb2a.fire_bolt.dark"]);
    expect(toggleInSet(new Set(["a"]), "a").has("a")).toBe(false);
    expect(toggleInSet(new Set(), "a").has("a")).toBe(true);
  });

  it("builds breadcrumbs and short paths", () => {
    expect(breadcrumbs("jb2a.fire_bolt")).toEqual([
      { path: "jb2a", name: "jb2a" },
      { path: "jb2a.fire_bolt", name: "fire bolt" }
    ]);
    expect(breadcrumbs(null)).toEqual([]);
    expect(shortPath("jb2a.fire_bolt.orange")).toBe("fire_bolt.orange");
  });
});

describe("browser paging and search", () => {
  it("clamps pages", () => {
    const p = paginate([1, 2, 3, 4, 5], 9, 2);
    expect(p).toMatchObject({ items: [5], page: 2, pageCount: 3, hasPrev: true, hasNext: false, total: 5 });
    expect(paginate([], 0, 10)).toMatchObject({ items: [], pageCount: 1, hasNext: false });
  });

  it("ignores too-short queries", () => {
    expect(normalizeQuery(" f ")).toBe("");
    expect(normalizeQuery(" fire ")).toBe("fire");
    const db = { search: vi.fn() };
    expect(searchPage(db, "f").items).toEqual([]);
    expect(db.search).not.toHaveBeenCalled();
  });

  it("requests one extra result to detect the next page", () => {
    const all = Array.from({ length: 25 }, (_, i) => ({ path: `jb2a.x${i}`, isLeaf: true }));
    const db = { search: vi.fn((q, { limit }) => all.slice(0, limit)) };
    const first = searchPage(db, "fire", 0, 10);
    expect(db.search).toHaveBeenCalledWith("fire", { limit: 11 });
    expect(first).toMatchObject({ page: 0, hasNext: true, hasPrev: false });
    expect(first.items).toHaveLength(10);
    const last = searchPage(db, "fire", 2, 10);
    expect(last.items).toHaveLength(5);
    expect(last).toMatchObject({ hasNext: false, hasPrev: true, total: 25 });
  });
});

describe("browser cards and favourites", () => {
  it("sorts branches before leaves", () => {
    const sorted = sortEntries([
      { path: "b", name: "b", isLeaf: true },
      { path: "z", name: "z", isLeaf: false },
      { path: "a", name: "a10", isLeaf: true },
      { path: "c", name: "a2", isLeaf: true }
    ]);
    expect(sorted.map((e) => e.path)).toEqual(["z", "c", "a", "b"]);
  });

  it("resolves missing thumbnails for leaves and flags favourites", () => {
    const resolveThumbnail = vi.fn(() => "thumb.webp");
    const cards = toCards(
      [
        { path: "jb2a.a", name: "a", isLeaf: true, thumbnail: "own.webp" },
        { path: "jb2a.b", name: "b", isLeaf: true },
        { path: "jb2a.c", name: "c", isLeaf: false }
      ],
      { favourites: ["jb2a.b"], resolveThumbnail, pickMode: true }
    );
    expect(cards.map((c) => c.thumbnail)).toEqual(["own.webp", "thumb.webp", null]);
    expect(cards.map((c) => c.favourite)).toEqual([false, true, false]);
    expect(resolveThumbnail).toHaveBeenCalledTimes(1);
    expect(cards[0]).toMatchObject({ label: "a", pickMode: true });
  });

  it("toggles favourites without duplicates", () => {
    expect(toggleFavourite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavourite(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleFavourite(null, "a")).toEqual(["a"]);
  });

  it("keeps unknown favourites as placeholders", () => {
    const entries = favouriteEntries(["jb2a.a.b", "jb2a.x"], (p) =>
      p === "jb2a.x" ? { path: p, name: "x", isLeaf: true, thumbnail: "t" } : null
    );
    expect(entries).toEqual([
      { path: "jb2a.a.b", name: "b", isLeaf: true, thumbnail: null },
      { path: "jb2a.x", name: "x", isLeaf: true, thumbnail: "t" }
    ]);
  });
});
