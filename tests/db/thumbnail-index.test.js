import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  browseLocation,
  candidateKeys,
  collectThumbnails,
  isStillImage,
  isThumbnailName,
  libraryRoot,
  looseTokens,
  nameTokens,
  readCachedIndex,
  relativeDir,
  ThumbnailIndex,
  writeCachedIndex
} from "../../src/db/thumbnail-index.js";

/** A slice of the real JB2A Patreon 0.9.3 file listing (names only). */
const LISTING = readFileSync(fileURLToPath(new URL("../fixtures/jb2a-thumbnail-listing.txt", import.meta.url)), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((name) => `modules/${name}`);

const PROVIDER = "jb2a_patreon";
const LIB = "modules/jb2a_patreon/Library";

/** Fake FilePicker.browse over the listing. */
function fakeBrowse(files = LISTING) {
  const calls = [];
  const browse = async (target) => {
    calls.push(target);
    const prefix = `${target}/`;
    const inside = files.filter((f) => f.startsWith(prefix));
    const direct = inside.filter((f) => !f.slice(prefix.length).includes("/"));
    const dirs = [...new Set(inside.map((f) => f.slice(prefix.length)).filter((r) => r.includes("/")))].map(
      (r) => prefix + r.slice(0, r.indexOf("/"))
    );
    return { target, dirs: [...new Set(dirs)], files: direct };
  };
  return { browse, calls };
}

async function buildIndex(files = LISTING) {
  return new ThumbnailIndex(
    await collectThumbnails({ browse: fakeBrowse(files).browse, root: LIB, provider: PROVIDER })
  );
}

describe("name normalization", () => {
  it("recognizes thumbnails and stills", () => {
    expect(isThumbnailName("FireBolt_01_Regular_Orange_Thumb.webp")).toBe(true);
    expect(isThumbnailName("Tile-Disk-BlackHole-OutwardLoop-001-001-Blue-8x8-thumb.webp")).toBe(true);
    expect(isThumbnailName("FireBolt_01_Regular_Orange_30ft_1600x400.webm")).toBe(false);
    expect(isStillImage("modules/x/Coal_01_HardEdge_Black_10x10ft.webp")).toBe(true);
    expect(isStillImage("modules/x/Coal_Thumb.webp")).toBe(false);
    expect(isStillImage("modules/x/Coal.webm")).toBe(false);
  });

  it("drops extension, thumb suffix, pixel size and distance; keeps grid sizes", () => {
    expect(nameTokens("FireBolt_01_Regular_Orange_30ft_1600x400.webm")).toEqual(["firebolt", "1", "regular", "orange"]);
    expect(nameTokens("FireBolt_01_Regular_Orange_Thumb.webp")).toEqual(["firebolt", "1", "regular", "orange"]);
    expect(nameTokens("Coal_01_HardEdge_Green_10x10ft_Thumb.webp")).toEqual(
      nameTokens("Coal_01_HardEdge_Green_10x10_500x500.webm")
    );
    expect(nameTokens("Tile-Disk-BlackHole-001-8x8-thumb.webp")).toEqual(["tile", "disk", "blackhole", "1", "8x8"]);
  });

  it("removes phases, also inside words", () => {
    expect(looseTokens(nameTokens("AbjurationRuneLoop_01_Regular_Blue_400x400.webm"))).toEqual(
      looseTokens(nameTokens("AbjurationRuneIntro_01_Regular_Blue_Thumb.webp"))
    );
    expect(looseTokens(["energywall01", "loop", "blue"])).toEqual(["energywall01", "blue"]);
  });

  it("lists candidate keys from most to least specific", () => {
    const { strict, loose } = candidateKeys("LaserSword01_02_Regular_Blue_Loop_800x600.webm");
    expect(strict[0]).toBe("lasersword01_2_regular_blue_loop");
    expect(strict).toContain("lasersword01_1_regular_blue_loop");
    expect(strict).toContain("lasersword01_1_regular_blue_complete");
    expect(loose).toContain("lasersword01_1_regular_blue");
    expect(candidateKeys("")).toEqual({ strict: [], loose: [] });
  });

  it("finds the directory relative to the JB2A module, for local and S3 URLs", () => {
    expect(relativeDir(`${LIB}/Cantrip/Fire_Bolt/X.webm`, PROVIDER)).toBe("library/cantrip/fire_bolt");
    expect(relativeDir("https://bucket.s3.eu.amazonaws.com/assets/jb2a_patreon/Library/Cantrip/X.webm", PROVIDER)).toBe(
      "library/cantrip"
    );
    expect(relativeDir("jb2a_patreon/Library/X.webm", PROVIDER)).toBe("library");
    expect(relativeDir("modules/other/Library/X.webm", PROVIDER)).toBeNull();
  });
});

describe("ThumbnailIndex", () => {
  const cases = [
    // exact name, any distance
    [
      "Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_60ft_2800x400.webm",
      "Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_Thumb.webp"
    ],
    [
      "Cantrip/Fire_Bolt/FireBolt_01_Dark_Green02_05ft_600x400.webm",
      "Cantrip/Fire_Bolt/FireBolt_01_Dark_Green02_Thumb.webp"
    ],
    // the thumbnail lives in the parent folder
    [
      "3rd_Level/Call_Lightning/High_Res/CallLightning_01_Blue_2400x2400.webm",
      "3rd_Level/Call_Lightning/CallLightning_01_Blue_Thumb.webp"
    ],
    // phase inside a word: same phase preferred, else Intro
    [
      "Generic/Magic_Signs/Runes/AbjurationRuneLoop_01_Regular_Blue_400x400.webm",
      "Generic/Magic_Signs/Runes/AbjurationRuneLoop_01_Regular_Blue_Thumb.webp"
    ],
    [
      "Generic/Magic_Signs/Runes/AbjurationRuneComplete_01_Regular_Blue_400x400.webm",
      "Generic/Magic_Signs/Runes/AbjurationRuneIntro_01_Regular_Blue_Thumb.webp"
    ],
    // grid size written "10x10ft" in the thumbnail, "10x10" in the video
    [
      "Generic/Fire/Brazier/Coal_01_HardEdge_Green_10x10_500x500.webm",
      "Generic/Fire/Brazier/Coal_01_HardEdge_Green_10x10ft_Thumb.webp"
    ],
    // variant 02 uses the 01 thumbnail, without mixing Blue / Blue02
    [
      "Generic/Weapon_Attacks/Melee/LaserSword01_02_Regular_Blue_800x600.webm",
      "Generic/Weapon_Attacks/Melee/LaserSword01_01_Regular_Blue_Thumb.webp"
    ],
    [
      "Generic/Weapon_Attacks/Melee/LaserSword01_02_Regular_Blue02_800x600.webm",
      "Generic/Weapon_Attacks/Melee/LaserSword01_01_Regular_Blue02_Thumb.webp"
    ]
  ];

  it.each(cases)("%s → %s", async (video, thumb) => {
    const index = await buildIndex();
    expect(index.find(`${LIB}/${video}`)).toBe(`${LIB}/${thumb}`);
  });

  it("returns null rather than another colour or animation", async () => {
    const index = await buildIndex();
    expect(index.find(`${LIB}/Generic/Conditions/Curse01/ConditionCurse01_001_Blue_600x600.webm`)).toBeNull();
    expect(index.find(`${LIB}/Generic/Marker/MarkerFear_01_Dark_Red_400x400.webm`)).toBeNull();
    expect(index.find(`${LIB}/Generic/Nature/VineElemental02_01_Dark_Blue_300x300.webm`)).toBeNull();
    expect(index.find(`${LIB}/Generic/Template/Circle/Radar/RadarLoop_001_001_Blue_15ft_800x800.webm`)).toBeNull();
    expect(index.find("modules/other/X.webm")).toBeNull();
    expect(index.find(null)).toBeNull();
  });

  it("uses a still image as its own thumbnail", async () => {
    const index = await buildIndex();
    const still = `${LIB}/Generic/Fire/Brazier/Coal_01_HardEdge_Black_10x10ft.webp`;
    expect(index.find(still)).toBe(still);
  });

  it("builds URLs from the video's own location (S3 prefix)", async () => {
    const index = await buildIndex();
    const base = "https://bucket.s3.eu.amazonaws.com/jb2a_patreon/Library/Cantrip/Fire_Bolt";
    expect(index.find(`${base}/FireBolt_01_Regular_Orange_30ft_1600x400.webm`)).toBe(
      `${base}/FireBolt_01_Regular_Orange_Thumb.webp`
    );
  });

  it("matches every video of the fixture that has a thumbnail in reach", async () => {
    const index = await buildIndex();
    const videos = LISTING.filter((f) => f.endsWith(".webm"));
    const found = videos.map((f) => index.find(f)).filter(Boolean);
    expect(found.every((t) => LISTING.includes(t))).toBe(true);
    expect(found.length).toBe(videos.length - 6); // Curse Blue, Fear Red, Vine 02 ×2, Radar ×2
  });

  it("round-trips through the cache format and rejects stale caches", async () => {
    const index = await buildIndex();
    const meta = { provider: PROVIDER, version: "0.9.3", root: LIB };
    const raw = writeCachedIndex(index, meta);
    const restored = new ThumbnailIndex(readCachedIndex(raw, meta));
    expect(restored.count).toBe(index.count);
    const video = `${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm`;
    expect(restored.find(video)).toBe(index.find(video));
    expect(readCachedIndex(raw, { ...meta, version: "0.9.4" })).toBeNull();
    expect(readCachedIndex(raw, { ...meta, root: "https://cdn/jb2a_patreon/Library" })).toBeNull();
    expect(readCachedIndex("{not json", meta)).toBeNull();
    expect(readCachedIndex(JSON.stringify({ format: 0 }), meta)).toBeNull();
  });
});

describe("collectThumbnails", () => {
  it("walks every folder once and keeps only thumbnails", async () => {
    const { browse, calls } = fakeBrowse();
    const result = await collectThumbnails({ browse, root: LIB, provider: PROVIDER, concurrency: 2 });
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls).toContain(`${LIB}/3rd_Level/Call_Lightning/High_Res`);
    expect(result.failed).toBe(0);
    expect(result.dirs["library/cantrip/fire_bolt"]).toEqual([
      "FireBolt_01_Dark_Green02_Thumb.webp",
      "FireBolt_01_Regular_Orange_Thumb.webp"
    ]);
    expect(Object.values(result.dirs).flat().every(isThumbnailName)).toBe(true);
  });

  it("skips folders that fail and respects maxDirs", async () => {
    const { browse } = fakeBrowse();
    const flaky = (target) => (target.endsWith("/Generic") ? Promise.reject(new Error("denied")) : browse(target));
    const result = await collectThumbnails({ browse: flaky, root: LIB, provider: PROVIDER });
    expect(result.failed).toBe(1);
    expect(result.dirs["library/cantrip/fire_bolt"]).toHaveLength(2);
    expect(Object.keys(result.dirs).some((d) => d.startsWith("library/generic"))).toBe(false);
    const capped = await collectThumbnails({ browse, root: LIB, provider: PROVIDER, maxDirs: 1 });
    expect(capped.visited).toBe(1);
  });
});

describe("browse locations", () => {
  it("maps local paths to the data source", () => {
    expect(browseLocation("modules/jb2a_patreon/Library")).toEqual({
      source: "data",
      target: "modules/jb2a_patreon/Library",
      options: {}
    });
  });

  it("maps S3 URLs with FilePicker.matchS3URL", () => {
    const matchS3URL = (url) => /^https:\/\/(?<bucket>[^.]+)\.s3\.[^/]+\/(?<key>.*)$/.exec(url);
    expect(browseLocation("https://my-bucket.s3.eu.amazonaws.com/jb2a_patreon/Library", { matchS3URL })).toEqual({
      source: "s3",
      target: "jb2a_patreon/Library",
      options: { bucket: "my-bucket" }
    });
  });

  it("gives up on other hosts", () => {
    expect(browseLocation("https://assets.example.com/jb2a_patreon/Library", {})).toBeNull();
    expect(
      browseLocation("https://x/y", {
        matchS3URL: () => {
          throw new Error("x");
        }
      })
    ).toBeNull();
    expect(browseLocation("")).toBeNull();
  });

  it("finds the Library root of a catalog file", () => {
    expect(libraryRoot(`${LIB}/Cantrip/Fire_Bolt/X.webm`, PROVIDER)).toBe(LIB);
    expect(libraryRoot("https://b.s3.x/jb2a_patreon/Library/Cantrip/X.webm", PROVIDER)).toBe(
      "https://b.s3.x/jb2a_patreon/Library"
    );
    expect(libraryRoot("modules/JB2A_DnD5e/Library/1st_Level/X.webm", "JB2A_DnD5e")).toBe("modules/JB2A_DnD5e/Library");
    expect(libraryRoot("modules/other/X.webm", PROVIDER)).toBeNull();
  });
});
