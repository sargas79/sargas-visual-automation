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
