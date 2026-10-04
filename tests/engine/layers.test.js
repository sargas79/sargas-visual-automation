import { describe, expect, it } from "vitest";
import { EffectSprite } from "../../src/engine/effect-sprite.js";
import { DEFAULT_SORT_LAYERS, effectElevation, layerPlacement } from "../../src/engine/layers.js";
import { isEffectVisible } from "../../src/engine/visibility.js";
import { LAYERS, normalizeEffect } from "../../src/shared/descriptors.js";
import { createFakeContext, createFakeInstance, createFakeToken } from "./helpers/fake-canvas.js";

describe("layerPlacement", () => {
  const s = DEFAULT_SORT_LAYERS;
  it("puts world layers in the primary group between the right sort layers", () => {
    const below = layerPlacement(LAYERS.BELOW_TILES);
    expect(below.group).toBe("primary");
    expect(below.sortLayer).toBeGreaterThan(s.SCENE);
    expect(below.sortLayer).toBeLessThan(s.TILES);
    const underTokens = layerPlacement(LAYERS.BELOW_TOKENS).sortLayer;
    expect(underTokens).toBeGreaterThan(s.DRAWINGS);
    expect(underTokens).toBeLessThan(s.TOKENS);
    const overTokens = layerPlacement(LAYERS.ABOVE_TOKENS).sortLayer;
    expect(overTokens).toBeGreaterThan(s.TOKENS);
    expect(overTokens).toBeLessThan(s.WEATHER);
  });
  it("puts aboveLighting in the interface and screen in the overlay", () => {
    expect(layerPlacement(LAYERS.ABOVE_LIGHTING)).toEqual({ group: "interface" });
    expect(layerPlacement(LAYERS.SCREEN)).toEqual({ group: "overlay" });
    expect(layerPlacement("nope").group).toBe("primary");
  });
});

describe("effectElevation", () => {
  it("follows the tokens of the effect", () => {
    expect(effectElevation({ layer: LAYERS.ABOVE_TOKENS, base: 0, tokenElevations: [10, 30] })).toBe(30);
    expect(effectElevation({ layer: LAYERS.BELOW_TOKENS, base: 0, tokenElevations: [10, 30] })).toBe(10);
    expect(effectElevation({ layer: LAYERS.BELOW_TILES, base: 5, tokenElevations: [10] })).toBe(5);
    expect(effectElevation({ layer: LAYERS.ABOVE_TOKENS, base: 20, tokenElevations: [] })).toBe(20);
  });
});

describe("isEffectVisible", () => {
  const visible = { hidden: false, visible: true };
  const unseen = { hidden: false, visible: false };
  const hidden = { hidden: true, visible: false };
  it("attached effects follow their token's visibility, even for the GM", () => {
    expect(isEffectVisible({ isGM: false, attached: visible })).toBe(true);
    expect(isEffectVisible({ isGM: false, attached: unseen })).toBe(false);
    expect(isEffectVisible({ isGM: true, attached: { hidden: true, visible: true } })).toBe(true);
  });
  it("never reveals GM-hidden tokens to players", () => {
    expect(isEffectVisible({ isGM: false, tokens: [visible, hidden] })).toBe(false);
    expect(isEffectVisible({ isGM: true, tokens: [hidden] })).toBe(true);
  });
  it("shows effects of a visible token, and tests vision for the rest", () => {
    expect(isEffectVisible({ isGM: false, tokens: [unseen, visible], tokenVision: true })).toBe(true);
    expect(isEffectVisible({ isGM: false, tokens: [unseen], tokenVision: false })).toBe(true);
    expect(isEffectVisible({ isGM: false, tokens: [unseen], tokenVision: true, pointVisible: () => false })).toBe(
      false
    );
    expect(isEffectVisible({ isGM: false, tokenVision: true, pointVisible: () => true })).toBe(true);
  });
  it("always shows screen effects", () => {
    expect(isEffectVisible({ isGM: false, layer: LAYERS.SCREEN, attached: unseen })).toBe(true);
  });
});

function sprite(descriptor, ctx, instance = createFakeInstance()) {
  return new EffectSprite({
    descriptor: normalizeEffect(descriptor),
    resolved: { file: "x/y.webp" },
    instance,
    context: ctx
  });
}

describe("EffectSprite attachment", () => {
  it("follows an attached token while it moves, and its rotation when asked", async () => {
    const token = createFakeToken({ x: 100, y: 100, elevation: 10 });
    const ctx = createFakeContext({ tokens: { t: token } });
    const s = sprite({ file: "x/y.webp", attachTo: { tokenId: "t", followRotation: true }, persist: true }, ctx);
    await s.mount();
    const d = ctx.layers.displays[0];
    expect(d.position).toMatchObject({ x: 100, y: 100 });
    expect(d.elevation).toBe(10);
    token.mesh.position = { x: 350, y: 120 };
    token.mesh.rotation = 1;
    token.document.elevation = 20;
    expect(s.update(16)).toBe(true);
    expect(d.position).toMatchObject({ x: 350, y: 120 });
    expect(d.rotation).toBeCloseTo(1);
    expect(d.elevation).toBe(20);
  });

  it("attaches to the token center when the art anchor is offset", async () => {
    const token = createFakeToken({ x: 130, y: 120, w: 100, h: 100 });
    token.mesh.anchor = { x: 0.3, y: 0.2 };
    const ctx = createFakeContext({ tokens: { t: token } });
    const s = sprite({ file: "x/y.webp", attachTo: { tokenId: "t" }, persist: true }, ctx);
    await s.mount();
    expect(ctx.layers.displays[0].position).toMatchObject({ x: 150, y: 150 });
  });

  it("ends when the attached token disappears", async () => {
    const ctx = createFakeContext({ tokens: { t: createFakeToken() } });
    const s = sprite({ file: "x/y.webp", attachTo: { tokenId: "t" }, persist: true }, ctx);
    await s.mount();
    delete ctx.tokens.t;
    expect(s.update(16)).toBe(false);
  });

  it("hides effects of hidden tokens from players", async () => {
    const ctx = createFakeContext({ tokens: { t: createFakeToken({ hidden: true }) }, isGM: false });
    const s = sprite({ file: "x/y.webp", atLocation: { tokenId: "t" } }, ctx);
    await s.mount();
    expect(ctx.layers.displays[0].visible).toBe(false);
  });

  it("scales to the host token and draws screen effects in screen px", async () => {
    const ctx = createFakeContext({ tokens: { t: createFakeToken({ x: 200, y: 100, w: 200, h: 200 }) } });
    const s = sprite({ file: "x/y.webp", atLocation: { tokenId: "t" }, scaleToObject: 1, layer: LAYERS.SCREEN }, ctx);
    await s.mount();
    const d = ctx.layers.displays[0];
    expect(d.scale).toMatchObject({ x: 0.5, y: 0.5 });
    expect(d.position).toMatchObject({ x: 100, y: 50 });
  });
});

describe("EffectSprite stretch", () => {
  it("anchors at the start pad and scales to the target", async () => {
    const ctx = createFakeContext({
      tokens: { a: createFakeToken({ x: 0, y: 0 }), b: createFakeToken({ x: 0, y: 600 }) }
    });
    const s = new EffectSprite({
      descriptor: normalizeEffect({ file: "jb2a.x", atLocation: { tokenId: "a" }, stretchTo: { tokenId: "b" } }),
      resolved: { path: "jb2a.x", file: "f.webm", template: { gridSize: 200, startPad: 200, endPad: 200 } },
      instance: createFakeInstance({ width: 1600, height: 400 }),
      context: ctx
    });
    await s.mount();
    const d = ctx.layers.displays[0];
    expect(d.anchor.x).toBeCloseTo(200 / 1600);
    expect(d.scale.x).toBeCloseTo(0.5);
    expect(d.scale.y).toBeCloseTo(0.5);
    expect(d.rotation).toBeCloseTo(Math.PI / 2);
  });
});
