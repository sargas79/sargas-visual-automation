import { afterEach, describe, expect, it, vi } from "vitest";
import { foundryTextureBackend, isUsedByCanvas } from "../../src/engine/video-backend.js";

describe("video backend unload safety", () => {
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.PIXI;
  });

  const base = {};
  const proto = () => ({ src: "modules/jb2a/Fire%20Bolt.webm", texture: { baseTexture: base }, owned: true });

  it("detects files used by tiles, tokens or the scene", () => {
    expect(isUsedByCanvas(proto())).toBe(false);
    globalThis.canvas = { scene: {}, tiles: { placeables: [] }, tokens: { placeables: [] } };
    expect(isUsedByCanvas(proto())).toBe(false);
    globalThis.canvas.tiles.placeables.push({ document: { texture: { src: "/modules/jb2a/Fire Bolt.webm" } } });
    expect(isUsedByCanvas(proto())).toBe(true);
    globalThis.canvas = { tokens: { placeables: [{ mesh: { texture: { baseTexture: base } } }] } };
    expect(isUsedByCanvas(proto())).toBe(true);
    globalThis.canvas = { scene: { background: { src: "modules/jb2a/Fire Bolt.webm" } } };
    expect(isUsedByCanvas(proto())).toBe(true);
  });

  it("unloads its own prototypes unless Foundry uses them", () => {
    const unload = vi.fn(async () => {});
    globalThis.PIXI = { Assets: { unload } };
    foundryTextureBackend.unload(proto());
    expect(unload).toHaveBeenCalledTimes(1);
    foundryTextureBackend.unload({ ...proto(), owned: false });
    globalThis.canvas = { tiles: { placeables: [{ texture: { baseTexture: base } }] } };
    foundryTextureBackend.unload(proto());
    expect(unload).toHaveBeenCalledTimes(1);
  });
});

describe("video backend load failures", () => {
  afterEach(() => {
    delete globalThis.PIXI;
    delete globalThis.foundry;
    vi.unstubAllGlobals();
  });

  async function failure({ response, network = false, throws = false }) {
    globalThis.PIXI = { Assets: { cache: new Map() } };
    globalThis.foundry = {
      canvas: { loadTexture: vi.fn(async () => (throws ? Promise.reject(new Error("decode")) : null)) }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (network) throw new TypeError("Failed to fetch");
        return response;
      })
    );
    return foundryTextureBackend.load("modules/jb2a/x.webm").catch((err) => err);
  }

  it("flags network and server errors as transient", async () => {
    expect((await failure({ network: true })).transient).toBe(true);
    expect((await failure({ response: { ok: false, status: 503 } })).transient).toBe(true);
  });

  it("treats a missing or undecodable file as definitive", async () => {
    expect((await failure({ response: { ok: false, status: 404 } })).transient).toBeUndefined();
    const broken = await failure({ response: { ok: true, status: 200 }, throws: true });
    expect(broken.message).toBe("decode");
    expect(broken.transient).toBeUndefined();
  });
});
