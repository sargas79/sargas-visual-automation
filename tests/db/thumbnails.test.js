import { describe, expect, it, vi } from "vitest";
import { Catalog } from "../../src/db/catalog.js";
import { CACHE_KEY, createThumbnailService } from "../../src/db/thumbnails.js";
import { loadFixture } from "./helpers/fixture.js";

const LIB = "modules/jb2a_patreon/Library";
const SAMPLE = `${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm`;
const THUMB = `${LIB}/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_Thumb.webp`;
const INFO = { provider: "jb2a_patreon", version: "0.9.3", sampleFile: SAMPLE };

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: vi.fn((k, v) => map.set(k, String(v))),
    removeItem: (k) => map.delete(k),
    map
  };
}

function fakePicker() {
  return {
    browse: vi.fn(async (source, target) => {
      if (target === LIB) return { dirs: [`${LIB}/Cantrip`], files: [] };
      if (target === `${LIB}/Cantrip`) return { dirs: [`${LIB}/Cantrip/Fire_Bolt`], files: [] };
      return { dirs: [], files: [SAMPLE, THUMB] };
    })
  };
}

describe("thumbnail service", () => {
  it("builds the index in the background, then serves it from the cache", async () => {
    const storage = memoryStorage();
    const picker = fakePicker();
    const service = createThumbnailService({ storage: () => storage, picker: () => picker, canBrowse: () => true });
    expect(service.find(SAMPLE)).toBeUndefined();
    expect(service.start(INFO)).toBe(false);
    expect(service.status).toBe("building");
    await expect(service.ready).resolves.toBe(true);
    expect(service.status).toBe("ready");
    expect(service.count).toBe(1);
    expect(service.find(SAMPLE)).toBe(THUMB);
    expect(picker.browse).toHaveBeenCalledWith("data", LIB, { extensions: [".webp"] });
    expect(storage.map.has(CACHE_KEY)).toBe(true);

    const second = createThumbnailService({ storage: () => storage, picker: () => picker, canBrowse: () => true });
    expect(second.start(INFO)).toBe(true);
    expect(second.status).toBe("ready");
    expect(second.find(SAMPLE)).toBe(THUMB);
    expect(picker.browse).toHaveBeenCalledTimes(3);
  });

  it("rebuilds when the JB2A version changes", async () => {
    const storage = memoryStorage();
    const picker = fakePicker();
    const make = () => createThumbnailService({ storage: () => storage, picker: () => picker, canBrowse: () => true });
    make().start(INFO);
    await Promise.resolve();
    const service = make();
    await service.build(); // no context yet: no-op
    expect(service.start({ ...INFO, version: "0.9.4" })).toBe(false);
    await service.ready;
    expect(service.status).toBe("ready");
  });

  it("is unavailable without permission, picker or a known root", async () => {
    const storage = memoryStorage();
    const denied = createThumbnailService({ storage: () => storage, picker: fakePicker, canBrowse: () => false });
    denied.start(INFO);
    await expect(denied.ready).resolves.toBe(false);
    expect(denied.status).toBe("unavailable");
    expect(denied.find(SAMPLE)).toBeUndefined();

    const noPicker = createThumbnailService({ storage: () => storage, picker: () => null, canBrowse: () => true });
    noPicker.start(INFO);
    expect(noPicker.status).toBe("unavailable");

    const cdn = createThumbnailService({ storage: () => storage, picker: fakePicker, canBrowse: () => true });
    cdn.start({ ...INFO, sampleFile: "https://cdn.example.com/jb2a_patreon/Library/X.webm" });
    expect(cdn.status).toBe("unavailable");

    const unknown = createThumbnailService({ storage: () => storage, picker: fakePicker, canBrowse: () => true });
    unknown.start({ ...INFO, sampleFile: "modules/other/X.webm" });
    expect(unknown.status).toBe("unavailable");
  });

  it("survives browse errors, empty listings and storage failures", async () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      }
    };
    const failing = createThumbnailService({
      storage: () => broken,
      picker: () => ({
        browse: async () => {
          throw new Error("offline");
        }
      }),
      canBrowse: () => true
    });
    failing.start(INFO);
    await expect(failing.ready).resolves.toBe(false);
    expect(failing.status).toBe("unavailable");

    const storing = createThumbnailService({ storage: () => broken, picker: fakePicker, canBrowse: () => true });
    storing.start(INFO);
    await expect(storing.ready).resolves.toBe(true);
    expect(storing.find(SAMPLE)).toBe(THUMB);
    storing.clearCache();
  });

  it("forces a rebuild and clears the cache", async () => {
    const storage = memoryStorage();
    const picker = fakePicker();
    const service = createThumbnailService({ storage: () => storage, picker: () => picker, canBrowse: () => true });
    service.start(INFO);
    await service.ready;
    await expect(service.build()).resolves.toBe(true);
    expect(picker.browse).toHaveBeenCalledTimes(3);
    await expect(service.build({ force: true })).resolves.toBe(true);
    expect(picker.browse).toHaveBeenCalledTimes(6);
    service.clearCache();
    expect(storage.map.has(CACHE_KEY)).toBe(false);
  });
});

describe("catalog thumbnail lookup", () => {
  it("uses the lookup when it knows and the name guess otherwise", () => {
    const known = new Map([[SAMPLE, THUMB]]);
    const catalog = new Catalog(loadFixture(), {
      thumbnail: (file) => (known.has(file) ? known.get(file) : file.includes("_05ft_") ? null : undefined)
    });
    expect(catalog.resolve("jb2a.fire_bolt.orange", { distance: 30 }).thumbnail).toBe(THUMB);
    expect(catalog.getEntry("jb2a.fire_bolt.orange.05ft").thumbnail).toBeNull();
    expect(catalog.getEntry("jb2a.fire_bolt.orange.15ft").thumbnail).toBe(THUMB); // name guess
  });
});
