import { describe, expect, it, vi } from "vitest";
import { isDirectFile, resolveFile, resolvePreloadList } from "../../src/engine/files.js";
import { createMockDb } from "./helpers/mock-db.js";

describe("resolveFile", () => {
  it("uses values containing / as direct URLs", async () => {
    expect(isDirectFile("modules/x/y.webm")).toBe(true);
    expect(isDirectFile("jb2a.fire_bolt")).toBe(false);
    const r = await resolveFile({}, "modules/x/y.webm");
    expect(r).toMatchObject({ file: "modules/x/y.webm", template: null, markers: null });
  });

  it("resolves database paths through api.db with the distance", async () => {
    const db = createMockDb();
    const r = await resolveFile({ db }, "jb2a.fire_bolt.orange", { distance: 25 });
    expect(db.resolve).toHaveBeenCalledWith("jb2a.fire_bolt.orange", { distance: 25 });
    expect(r.distance).toBe("30ft");
  });

  it("returns null when the database is missing or the path is unknown", async () => {
    expect(await resolveFile({}, "jb2a.nope")).toBeNull();
    expect(await resolveFile({ db: createMockDb() }, "jb2a.nope")).toBeNull();
  });

  it("waits for api.db.ready", async () => {
    let release;
    const db = createMockDb({ ready: new Promise((r) => (release = r)) });
    const pending = resolveFile({ db }, "jb2a.fire_bolt.orange");
    await Promise.resolve();
    expect(db.resolve).not.toHaveBeenCalled();
    release();
    expect(await pending).not.toBeNull();
  });
});

describe("resolvePreloadList", () => {
  it("expands branches to every leaf and keeps URLs", async () => {
    const db = createMockDb();
    const urls = await resolvePreloadList({ db }, ["jb2a.fire_bolt.orange", "a/b.webm", "a/b.webm", "jb2a.nope"]);
    expect(urls).toEqual([
      "jb2a/FireBolt_Orange_05ft_600x400.webm",
      "jb2a/FireBolt_Orange_30ft_1600x400.webm",
      "jb2a/FireBolt_Orange_60ft_2800x400.webm",
      "a/b.webm"
    ]);
  });

  it("works with a single string", async () => {
    const db = createMockDb();
    db.getEntry = undefined;
    const spy = vi.spyOn(db, "resolve");
    const urls = await resolvePreloadList({ db }, "jb2a.fire_bolt.orange.30ft");
    expect(spy).toHaveBeenCalled();
    expect(urls).toEqual(["jb2a/FireBolt_Orange_30ft_1600x400.webm"]);
  });
});
