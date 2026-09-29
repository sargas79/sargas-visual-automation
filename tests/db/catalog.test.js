import { describe, expect, it } from "vitest";
import { Catalog, normalizePath } from "../../src/db/catalog.js";
import { loadFixture, sequence } from "./helpers/fixture.js";

const FIRE_BOLT_ORANGE_30 =
  "modules/jb2a_patreon/Library/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm";

describe("index", () => {
  const catalog = new Catalog(loadFixture());

  it("normalizes paths", () => {
    expect(normalizePath("fire_bolt.orange")).toBe("jb2a.fire_bolt.orange");
    expect(normalizePath(" jb2a.fire_bolt..orange ")).toBe("jb2a.fire_bolt.orange");
    expect(normalizePath("")).toBe("jb2a");
    expect(normalizePath(42)).toBeNull();
  });

  it("indexes nodes by dot path and skips metadata keys", () => {
    expect(catalog.has("jb2a.fire_bolt.orange")).toBe(true);
    expect(catalog.has("jb2a.fire_bolt.orange.30ft")).toBe(true);
    expect(catalog.has("fire_bolt.orange")).toBe(true);
    expect(catalog.has("jb2a.fire_bolt._template")).toBe(false);
    expect(catalog.has("jb2a._templates")).toBe(false);
    expect(catalog.has("jb2a.ambient_fog.001.complete._markers")).toBe(false);
    expect(catalog.has("jb2a.nope")).toBe(false);
  });

  it("returns entries for leaves and branches", () => {
    expect(catalog.getEntry("jb2a.fire_bolt.orange.30ft")).toMatchObject({
      path: "jb2a.fire_bolt.orange.30ft",
      name: "30ft",
      isLeaf: true
    });
    const branch = catalog.getEntry("jb2a.fire_bolt");
    expect(branch).toMatchObject({ path: "jb2a.fire_bolt", name: "fire_bolt", label: "Fire Bolt", isLeaf: false });
    expect(branch.children).toEqual(["orange", "blue", "dark_red"]);
    expect(branch.distances).toBeUndefined();
    expect(catalog.getEntry("jb2a.fire_bolt.orange").distances).toEqual(["05ft", "15ft", "30ft", "60ft", "90ft"]);
    expect(catalog.getEntry("jb2a.nope")).toBeNull();
  });

  it("lists children, optionally deeper", () => {
    const root = catalog.list();
    expect(root.map((e) => e.name)).toContain("fire_bolt");
    expect(root.every((e) => e.path.split(".").length === 2)).toBe(true);
    expect(catalog.list("jb2a.greatsword").map((e) => e.name)).toEqual(["melee", "return", "throw"]);
    const deep = catalog.list("jb2a.greatsword", { depth: 2 }).map((e) => e.path);
    expect(deep).toContain("jb2a.greatsword.melee.fire");
    expect(deep).toContain("jb2a.greatsword.throw.30ft");
    expect(catalog.list("jb2a.fire_bolt.orange.30ft")).toEqual([]);
    expect(catalog.list("jb2a.nope")).toEqual([]);
  });
});

describe("resolve", () => {
  it("resolves a full path to a file with metadata", () => {
    const catalog = new Catalog(loadFixture());
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 30 })).toEqual({
      path: "jb2a.fire_bolt.orange",
      file: FIRE_BOLT_ORANGE_30,
      thumbnail: "modules/jb2a_patreon/Library/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_Thumb.webp",
      size: { width: 1600, height: 400 },
      template: { name: "ranged", gridSize: 200, startPad: 200, endPad: 200 },
      markers: null,
      distance: "30ft"
    });
  });

  it("accepts an explicit distance variant", () => {
    const catalog = new Catalog(loadFixture());
    const r = catalog.resolve("jb2a.fire_bolt.orange.90ft", { distance: 5 });
    expect(r.distance).toBe("90ft");
    expect(r.path).toBe("jb2a.fire_bolt.orange");
    expect(r.size).toEqual({ width: 4000, height: 400 });
  });

  it("picks the closest distance variant", () => {
    const catalog = new Catalog(loadFixture());
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 8 }).distance).toBe("05ft");
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 65 }).distance).toBe("60ft");
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 3, gridDistance: 1.5 }).distance).toBe("15ft");
    expect(catalog.resolve("jb2a.fire_bolt.orange").distance).toBe("30ft");
    expect(catalog.resolve("jb2a.greatsword.throw", { distance: 5 }).distance).toBe("15ft");
  });

  it("resolves a partial path to a random playable leaf", () => {
    const catalog = new Catalog(loadFixture(), { random: sequence(0, 0, 0.99, 0) });
    const first = catalog.resolve("jb2a.fire_bolt", { distance: 30 });
    expect(first.path).toBe("jb2a.fire_bolt.orange");
    expect(first.file).toBe(FIRE_BOLT_ORANGE_30);
    const last = catalog.resolve("jb2a.fire_bolt", { distance: 30 });
    expect(last.path).toBe("jb2a.fire_bolt.dark_red");
  });

  it("only ever returns valid leaves for partial paths", () => {
    const catalog = new Catalog(loadFixture());
    for (let i = 0; i < 50; i++) {
      const r = catalog.resolve("jb2a.scorching_ray", { distance: 20 });
      expect(r.file).toMatch(/^modules\/jb2a_patreon\/.+_15ft(_\d+)?_1000x400\.webm$/);
      expect(r.distance).toBe("15ft");
      expect(catalog.has(r.path)).toBe(true);
    }
    const any = catalog.resolve("jb2a");
    expect(any.file).toMatch(/^modules\//);
  });

  it("picks randomly inside arrays", () => {
    const catalog = new Catalog(loadFixture(), { random: sequence(0.9) });
    const r = catalog.resolve("jb2a.burrow.out.01.brown");
    expect(r.file).toMatch(/BurrowOut01_02_Regular_Brown_600x600\.webm$/);
    expect(r.path).toBe("jb2a.burrow.out.01.brown");
    const low = new Catalog(loadFixture(), { random: sequence(0) }).resolve("jb2a.burrow.out.01.brown");
    expect(low.file).toMatch(/BurrowOut01_01_/);
  });

  it("resolves arrays inside distance variants", () => {
    const catalog = new Catalog(loadFixture(), { random: sequence(0.5) });
    const r = catalog.resolve("jb2a.burrow.ranged.01.brown", { distance: 60 });
    expect(r).toMatchObject({ distance: "60ft", template: { name: "ranged" } });
    expect(r.file).toMatch(/BurrowRanged01_02_Regular_Brown_60ft_2800x400\.webm$/);
    const missile = catalog.resolve("jb2a.magic_missile.blue", { distance: 15 });
    expect(missile.file).toMatch(/MagicMissile_01_Regular_Blue_15ft_0\d_1000x400\.webm$/);
  });

  it("selects an array element by index", () => {
    const catalog = new Catalog(loadFixture());
    const r = catalog.resolve("jb2a.breath_weapons.fire.cone.multicolored.01.2");
    expect(r.file).toMatch(/BreathWeapon_Fire01_Regular_MultiColor03_30ft_Cone_Burst_600x600\.webm$/);
    expect(r.template).toMatchObject({ name: "cone" });
    expect(catalog.resolve("jb2a.breath_weapons.fire.cone.multicolored.01.9")).toBeNull();
    expect(catalog.resolve("jb2a.fire_bolt.orange.1")).toBeNull();
  });

  it("returns null for unknown paths", () => {
    const catalog = new Catalog(loadFixture());
    expect(catalog.resolve("jb2a.nope")).toBeNull();
    expect(catalog.resolve("")).not.toBeNull(); // the root is a (huge) partial path
    expect(catalog.resolve(null)).toBeNull();
  });

  it("tolerates empty and malformed databases", () => {
    const catalog = new Catalog({
      _templates: { ranged: [200, 200, 200] },
      empty: { blue: [] },
      weird: { blue: 42, ok: "modules/x/Y_10x20.webm" }
    });
    expect(catalog.has("jb2a.empty")).toBe(false);
    expect(catalog.has("jb2a.weird.blue")).toBe(false);
    expect(catalog.resolve("jb2a.weird").file).toBe("modules/x/Y_10x20.webm");
    expect(new Catalog(null).resolve("jb2a")).toBeNull();
  });
});
