import { describe, expect, it } from "vitest";
import {
  distanceKeyFeet,
  guessThumbnail,
  isDistanceGroup,
  parseMarkers,
  parseSize,
  parseTemplate,
  pickDistanceKey,
  thumbnailCandidates
} from "../../src/db/metadata.js";
import { Catalog } from "../../src/db/catalog.js";
import { loadFixture } from "./helpers/fixture.js";

const LIB = "modules/jb2a_patreon/Library";

describe("templates", () => {
  const templates = loadFixture()._templates;

  it("maps _templates arrays to gridSize/startPad/endPad", () => {
    expect(parseTemplate(templates, "ranged")).toEqual({ name: "ranged", gridSize: 200, startPad: 200, endPad: 200 });
    expect(parseTemplate(templates, "melee")).toEqual({ name: "melee", gridSize: 200, startPad: 300, endPad: 300 });
    expect(parseTemplate(templates, "cone100")).toEqual({ name: "cone100", gridSize: 100, startPad: 100, endPad: 100 });
  });

  it("returns null for missing or unknown templates", () => {
    expect(parseTemplate(templates, null)).toBeNull();
    // JB2A references "line" without defining it.
    expect(parseTemplate(templates, "line")).toBeNull();
  });

  it("is inherited from the nearest ancestor", () => {
    const catalog = new Catalog(loadFixture());
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 30 }).template).toMatchObject({ name: "ranged" });
    expect(catalog.resolve("jb2a.greatsword.melee.fire.blue").template).toMatchObject({ name: "melee" });
    // Same category, different branch template.
    expect(catalog.resolve("jb2a.greatsword.throw", { distance: 30 }).template).toMatchObject({ name: "ranged" });
    expect(catalog.resolve("jb2a.template_cone_PF2e.001.001.blue").template).toMatchObject({ name: "cone100" });
    expect(catalog.resolve("jb2a.ambient_fog.001.complete.small.blue").template).toBeNull();
  });
});

describe("markers", () => {
  it("copies loop markers from an ancestor", () => {
    const catalog = new Catalog(loadFixture());
    const r = catalog.resolve("jb2a.ambient_fog.001.complete.small.blue");
    expect(r.markers).toEqual({ loop: { start: 3000, end: 5958 } });
    expect(catalog.resolve("jb2a.magic_signs.circle.02.abjuration.complete.dark_blue").markers).toEqual({
      loop: { start: 3000, end: 8000 },
      forcedEnd: 8000
    });
    expect(catalog.resolve("jb2a.fire_bolt.orange").markers).toBeNull();
  });

  it("returns copies that can't mutate the catalog", () => {
    const catalog = new Catalog(loadFixture());
    catalog.resolve("jb2a.ambient_fog.001.complete.small.blue").markers.loop.start = 0;
    expect(catalog.resolve("jb2a.ambient_fog.001.complete.small.blue").markers.loop.start).toBe(3000);
    expect(parseMarkers(null)).toBeNull();
  });
});

describe("sizes", () => {
  it("parses the native size from the file name", () => {
    expect(parseSize(`${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm`)).toEqual({
      width: 1600,
      height: 400
    });
    expect(parseSize(`${LIB}/Generic/Creature/BurrowOut01_600x600_StillFrame.webp`)).toEqual({
      width: 600,
      height: 600
    });
    // Grid footprint "3x3" before the pixel size: the last match wins.
    expect(parseSize(`${LIB}/X/BubbleComplete002_002_Blue_3x3_600x600.webm`)).toEqual({ width: 600, height: 600 });
  });

  it("returns null when the name has no size", () => {
    expect(parseSize(`${LIB}/Generic/Traps/Caltrops01_01_Regular_Grey_Endframe.webp`)).toBeNull();
    expect(parseSize(null)).toBeNull();
  });
});

describe("thumbnails", () => {
  it("strips size and distance to build the _Thumb.webp name", () => {
    expect(guessThumbnail(`${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm`)).toBe(
      `${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_Thumb.webp`
    );
    expect(guessThumbnail(`${LIB}/Generic/Fog/AmbientFog001_001_Complete_Blue_500x500.webm`)).toBe(
      `${LIB}/Generic/Fog/AmbientFog001_001_Complete_Blue_Thumb.webp`
    );
  });

  it("offers fallbacks for irregular names", () => {
    const cone = thumbnailCandidates(
      `${LIB}/Generic/Template/Cone/001/TemplateCone5e001_001_OrangeYellow_30ft_800x800.webm`
    );
    expect(cone).toContain(`${LIB}/Generic/Template/Cone/001/TemplateCone5e001_001_OrangeYellow_30ft_Thumb.webp`);
    const sword = thumbnailCandidates(`${LIB}/Generic/Weapon_Attacks/Melee/LaserSword01_02_Regular_Blue_800x600.webm`);
    expect(sword).toContain(`${LIB}/Generic/Weapon_Attacks/Melee/LaserSword01_01_Regular_Blue_Thumb.webp`);
    const fog = thumbnailCandidates(`${LIB}/Generic/Fog/AmbientFog001_001_Loop_White_1200x1200.webm`);
    expect(fog).toContain(`${LIB}/Generic/Fog/AmbientFog001_001_Complete_White_Thumb.webp`);
    expect(new Set(sword).size).toBe(sword.length);
  });

  it("uses still images as their own thumbnail", () => {
    const still = `${LIB}/Generic/Creature/BurrowOut01_600x600_StillFrame.webp`;
    expect(thumbnailCandidates(still)).toEqual([still]);
    expect(thumbnailCandidates(null)).toEqual([]);
  });

  it("is exposed on catalog entries", () => {
    const catalog = new Catalog(loadFixture());
    expect(catalog.getEntry("jb2a.fire_bolt.orange.30ft").thumbnail).toBe(
      `${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_Thumb.webp`
    );
    expect(catalog.getEntry("jb2a.fire_bolt").thumbnail).toMatch(/_Thumb\.webp$/);
  });
});

describe("distance variants", () => {
  const keys = ["05ft", "15ft", "30ft", "60ft", "90ft"];

  it("recognizes distance keys and groups", () => {
    expect(distanceKeyFeet("05ft")).toBe(5);
    expect(distanceKeyFeet("blue")).toBeNull();
    expect(isDistanceGroup(keys)).toBe(true);
    expect(isDistanceGroup(["30ft", "blue"])).toBe(false);
    expect(isDistanceGroup([])).toBe(false);
  });

  it("picks the closest variant in grid squares", () => {
    expect(pickDistanceKey(keys, 5)).toBe("05ft");
    expect(pickDistanceKey(keys, 20)).toBe("15ft");
    expect(pickDistanceKey(keys, 40)).toBe("30ft");
    expect(pickDistanceKey(keys, 50)).toBe("60ft");
    expect(pickDistanceKey(keys, 500)).toBe("90ft");
    expect(pickDistanceKey(keys, 0)).toBe("05ft");
  });

  it("breaks ties towards the longer variant", () => {
    expect(pickDistanceKey(keys, 45)).toBe("60ft");
  });

  it("scales by the scene grid distance (metric scenes)", () => {
    // 1.5 m squares: 9 m = 6 squares = 30 ft.
    expect(pickDistanceKey(keys, 9, 1.5)).toBe("30ft");
  });

  it("defaults to the 30 ft variant without a distance", () => {
    expect(pickDistanceKey(keys, undefined)).toBe("30ft");
    expect(pickDistanceKey(["15ft", "60ft"], null)).toBe("15ft");
    expect(pickDistanceKey(["blue"], 10)).toBeNull();
  });

  it("covers the PF2e cone variants", () => {
    const catalog = new Catalog(loadFixture());
    const cone = catalog.getEntry("jb2a.template_cone_PF2e.001.001.blue");
    expect(cone.distances).toEqual(["30ft"]);
    expect(catalog.resolve("jb2a.template_cone_PF2e.001.001.blue", { distance: 15 })).toMatchObject({
      distance: "30ft",
      size: { width: 800, height: 1000 }
    });
    const volley = catalog.getEntry("jb2a.volley_of_projectiles_ConePF2e.arrow.001.001.blue");
    expect(volley.distances).toEqual(["15ft", "30ft", "60ft"]);
    expect(catalog.resolve(volley.path, { distance: 60 }).file).toMatch(/ConePF2e_Blue_60ft_1400x1800\.webm$/);
  });
});
