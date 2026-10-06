import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectProvider, isDatabase, loadDatabase, pickDatabase } from "../../src/db/loader.js";
import { createDb, init, ready } from "../../src/db/index.js";
import { resetFoundryMock } from "../setup/foundry-mock.js";
import { loadFixture } from "./helpers/fixture.js";

const FAST = { timeout: 30, interval: 5 };

function mockUi() {
  globalThis.ui = { notifications: { warn: vi.fn() } };
  game.i18n = {
    localize: (key) => `loc:${key}`,
    format: (key, data) => `fmt:${key}:${JSON.stringify(data)}`
  };
}

beforeEach(mockUi);
afterEach(() => {
  delete globalThis.ui;
});

describe("provider detection", () => {
  it("prefers the Patreon module over the free one", () => {
    resetFoundryMock({ modules: [{ id: "JB2A_DnD5e" }, { id: "jb2a_patreon" }] });
    expect(detectProvider()).toBe("jb2a_patreon");
  });

  it("falls back to the free module and ignores inactive modules", () => {
    resetFoundryMock({ modules: [{ id: "JB2A_DnD5e" }, { id: "jb2a_patreon", active: false }] });
    expect(detectProvider()).toBe("JB2A_DnD5e");
  });

  it("returns null without JB2A", () => {
    expect(detectProvider()).toBeNull();
    expect(detectProvider(undefined)).toBeNull();
  });

  it("recognizes database objects on the module api", () => {
    const db = loadFixture();
    expect(isDatabase(db)).toBe(true);
    expect(isDatabase({ _templates: {} })).toBe(false);
    expect(isDatabase([])).toBe(false);
    expect(pickDatabase({ patreonDatabase: db })).toBe(db);
    expect(pickDatabase({ freeDatabase: db })).toBe(db);
    expect(pickDatabase({ patreonDatabase: {} })).toBeNull();
    expect(pickDatabase(null)).toBeNull();
  });
});

describe("loadDatabase", () => {
  it("reads api.patreonDatabase", async () => {
    const database = loadFixture();
    resetFoundryMock({ modules: [{ id: "jb2a_patreon", api: { patreonDatabase: database } }] });
    await expect(loadDatabase(FAST)).resolves.toEqual({ provider: "jb2a_patreon", database, source: "api" });
  });

  it("waits for JB2A to publish its api in its own ready hook", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon" }] });
    const database = loadFixture();
    setTimeout(() => (game.modules.get("jb2a_patreon").api = { patreonDatabase: database }), 10);
    const result = await loadDatabase({ timeout: 1000, interval: 5 });
    expect(result).toMatchObject({ provider: "jb2a_patreon", source: "api" });
  });

  it("falls back to importing the JB2A database script", async () => {
    resetFoundryMock({ modules: [{ id: "JB2A_DnD5e" }] });
    const database = loadFixture();
    const importer = vi.fn(async () => ({ patreonDatabase: database }));
    const result = await loadDatabase({ ...FAST, importer });
    expect(importer).toHaveBeenCalledWith("JB2A_DnD5e");
    expect(result).toEqual({ provider: "JB2A_DnD5e", database, source: "script" });
  });

  it("reports a failure when nothing can be read", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon" }] });
    const importer = vi.fn(async () => {
      throw new Error("404");
    });
    await expect(loadDatabase({ ...FAST, importer })).resolves.toEqual({
      provider: "jb2a_patreon",
      database: null,
      source: null
    });
  });

  it("does not wait when no JB2A module is active", async () => {
    const importer = vi.fn();
    await expect(loadDatabase({ importer })).resolves.toEqual({ provider: null, database: null, source: null });
    expect(importer).not.toHaveBeenCalled();
  });
});

describe("api.db", () => {
  it("is empty but safe before loading", () => {
    const db = createDb(FAST);
    expect(db.available).toBe(false);
    expect(db.provider).toBeNull();
    expect(db.resolve("jb2a.fire_bolt.orange")).toBeNull();
    expect(db.has("jb2a.fire_bolt")).toBe(false);
    expect(db.getEntry("jb2a.fire_bolt")).toBeNull();
    expect(db.list("jb2a")).toEqual([]);
    expect(db.search("fire")).toEqual([]);
  });

  it("builds the catalog after the Foundry ready hook", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon", api: { patreonDatabase: loadFixture() } }] });
    mockUi();
    const api = {};
    init(api);
    expect(api.db.available).toBe(false);
    ready(api);
    await api.db.ready;
    expect(api.db.available).toBe(true);
    expect(api.db.provider).toBe("jb2a_patreon");
    expect(api.db.resolve("jb2a.fire_bolt.orange", { distance: 30 }).file).toMatch(/_30ft_1600x400\.webm$/);
    expect(api.db.has("jb2a.fire_bolt.orange")).toBe(true);
    expect(api.db.getEntry("jb2a.fire_bolt").isLeaf).toBe(false);
    expect(api.db.list("jb2a.fire_bolt").length).toBe(3);
    expect(api.db.search("fire bolt orange")[0].path).toBe("jb2a.fire_bolt.orange");
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  it("uses the scene grid distance for distance variants", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon", api: { patreonDatabase: loadFixture() } }] });
    globalThis.canvas = { grid: { distance: 1.5 } };
    try {
      const db = createDb(FAST);
      await db.load();
      expect(db.resolve("jb2a.fire_bolt.orange", { distance: 9 }).distance).toBe("30ft");
      expect(db.resolve("jb2a.fire_bolt.orange", { distance: 9, gridDistance: 5 }).distance).toBe("05ft");
    } finally {
      delete globalThis.canvas;
    }
  });

  it("warns the GM when no JB2A module is active and still resolves ready", async () => {
    const db = createDb(FAST);
    await db.load();
    await expect(db.ready).resolves.toBeUndefined();
    expect(db.available).toBe(false);
    expect(ui.notifications.warn).toHaveBeenCalledWith("loc:SVA.Db.Missing");
  });

  it("only logs for players", async () => {
    game.user.isGM = false;
    const db = createDb(FAST);
    await db.load();
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  it("warns when JB2A is active but its database can't be read", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon" }] });
    mockUi();
    const db = createDb({ ...FAST, importer: async () => ({}) });
    await db.load();
    expect(db.available).toBe(false);
    expect(db.provider).toBe("jb2a_patreon");
    expect(ui.notifications.warn).toHaveBeenCalledWith('fmt:SVA.Db.LoadFailed:{"module":"jb2a_patreon"}');
  });

  it("loads only once", async () => {
    const importer = vi.fn(async () => ({}));
    resetFoundryMock({ modules: [{ id: "jb2a_patreon" }] });
    mockUi();
    const db = createDb({ ...FAST, importer });
    await Promise.all([db.load(), db.load()]);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("probes thumbnail candidates and caches the result", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon", api: { patreonDatabase: loadFixture() } }] });
    const fetch = vi.fn(async (url) => ({ ok: url.includes("LaserSword01_01_") }));
    vi.stubGlobal("fetch", fetch);
    try {
      const db = createDb(FAST);
      const file =
        "modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Melee/LaserSword01_02_Regular_Blue_800x600.webm";
      await expect(db.findThumbnail(file)).resolves.toBe(
        "modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Melee/LaserSword01_01_Regular_Blue_Thumb.webp"
      );
      const calls = fetch.mock.calls.length;
      await db.findThumbnail(file);
      expect(fetch.mock.calls.length).toBe(calls);
      fetch.mockImplementation(async () => ({ ok: false }));
      await expect(db.findThumbnail("modules/x/Nothing_10x10.webm")).resolves.toBeNull();
      await expect(db.findThumbnail("jb2a.fire_bolt.orange")).resolves.toBeNull(); // not loaded yet
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("caches definitive thumbnail misses but retries after network or server errors", async () => {
    resetFoundryMock({ modules: [{ id: "jb2a_patreon", api: { patreonDatabase: loadFixture() } }] });
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const db = createDb(FAST);
      const file = "modules/x/Thing_10x10.webm";
      await expect(db.findThumbnail(file)).resolves.toBeNull();
      fetch.mockImplementation(async () => ({ ok: false, status: 503 }));
      await expect(db.findThumbnail(file)).resolves.toBeNull();
      fetch.mockImplementation(async (url) => ({ ok: true, status: 200, url }));
      await expect(db.findThumbnail(file)).resolves.toMatch(/Thumb/);
      // Definitive 404s are remembered.
      fetch.mockImplementation(async () => ({ ok: false, status: 404 }));
      await expect(db.findThumbnail("modules/x/Other_10x10.webm")).resolves.toBeNull();
      const calls = fetch.mock.calls.length;
      await db.findThumbnail("modules/x/Other_10x10.webm");
      expect(fetch.mock.calls.length).toBe(calls);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
