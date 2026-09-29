import { describe, expect, it } from "vitest";
import { Catalog } from "../../src/db/catalog.js";
import { fuzzyScore, tokenize } from "../../src/db/search.js";
import { loadFixture } from "./helpers/fixture.js";

describe("search", () => {
  const catalog = new Catalog(loadFixture());

  it("tokenizes paths and labels", () => {
    expect(tokenize("Fire Bolt.orange_30ft")).toEqual(["fire", "bolt", "orange", "30ft"]);
    expect(tokenize(null)).toEqual([]);
  });

  it("finds playable entries by words, best match first", () => {
    const results = catalog.search("fire bolt orange");
    expect(results[0].path).toBe("jb2a.fire_bolt.orange");
    expect(results[0].distances).toEqual(["05ft", "15ft", "30ft", "60ft", "90ft"]);
  });

  it("returns distance groups instead of each variant", () => {
    const paths = catalog.search("fire_bolt").map((e) => e.path);
    expect(paths).toContain("jb2a.fire_bolt.blue");
    expect(paths.some((p) => p.endsWith("ft"))).toBe(false);
  });

  it("matches labels from JB2A _metadata", () => {
    const paths = catalog.search("volley cone pf2e").map((e) => e.path);
    expect(paths).toContain("jb2a.volley_of_projectiles_ConePF2e.arrow.001.001.blue");
  });

  it("returns leaves", () => {
    const results = catalog.search("burrow brown");
    expect(results.map((e) => e.path)).toContain("jb2a.burrow.out.01.brown");
    expect(results.find((e) => e.path === "jb2a.burrow.out.01.brown").isLeaf).toBe(true);
  });

  it("requires every token and honours the limit", () => {
    expect(catalog.search("fire bolt purple")).toEqual([]);
    expect(catalog.search("greatsword", { limit: 2 })).toHaveLength(2);
    expect(catalog.search("   ")).toEqual([]);
  });

  it("falls back to fuzzy matching", () => {
    expect(fuzzyScore("frblt", "firebolt")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "firebolt")).toBe(0);
    const paths = catalog.search("grtswrd").map((e) => e.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith("jb2a.greatsword"))).toBe(true);
  });
});
