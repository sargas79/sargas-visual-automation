import { describe, expect, it } from "vitest";
import {
  angleTo,
  computeScale,
  DEFAULT_TEMPLATE,
  gridScale,
  parseTint,
  resolveAnchor,
  scaleVector,
  templateOf
} from "../../src/engine/math.js";

describe("anchors", () => {
  const tokens = { t1: { x: 150, y: 250 } };
  const tokenPoint = (id) => tokens[id] ?? null;
  it("resolves token and point anchors with offsets", () => {
    expect(resolveAnchor({ tokenId: "t1" }, tokenPoint)).toEqual({ x: 150, y: 250 });
    expect(resolveAnchor({ tokenId: "t1", offset: { x: 10, y: -10 } }, tokenPoint)).toEqual({ x: 160, y: 240 });
    expect(resolveAnchor({ x: 1, y: 2, offset: { x: 1 } }, tokenPoint)).toEqual({ x: 2, y: 2 });
  });
  it("returns null for missing tokens or invalid anchors", () => {
    expect(resolveAnchor({ tokenId: "gone" }, tokenPoint)).toBeNull();
    expect(resolveAnchor({}, tokenPoint)).toBeNull();
    expect(resolveAnchor(null, tokenPoint)).toBeNull();
  });
  it("measures angles clockwise from the x axis", () => {
    expect(angleTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});

describe("scale", () => {
  const texture = { width: 400, height: 200 };
  it("uses the JB2A grid scale by default", () => {
    expect(gridScale(150, { gridSize: 100 })).toBe(1.5);
    expect(templateOf({ template: null })).toBe(DEFAULT_TEMPLATE);
    expect(computeScale({ texture, gridSizePx: 50, template: DEFAULT_TEMPLATE })).toEqual({ x: 0.5, y: 0.5 });
  });
  it("draws direct files at native size", () => {
    expect(computeScale({ texture, gridSizePx: 50, template: null })).toEqual({ x: 1, y: 1 });
  });
  it("applies explicit sizes in px or grid units, keeping the aspect ratio for a missing side", () => {
    expect(computeScale({ texture, gridSizePx: 100, size: { width: 800, height: 100 } })).toEqual({ x: 2, y: 0.5 });
    expect(computeScale({ texture, gridSizePx: 100, size: { width: 2, gridUnits: true } })).toEqual({
      x: 0.5,
      y: 0.5
    });
    expect(computeScale({ texture, gridSizePx: 100, size: { height: 400 } })).toEqual({ x: 2, y: 2 });
  });
  it("scales to an object uniformly by its larger side", () => {
    const s = computeScale({ texture, gridSizePx: 100, scaleToObject: 1.5, objectSize: { width: 200, height: 100 } });
    expect(s).toEqual({ x: 0.75, y: 0.75 });
  });
  it("multiplies the user scale and mirrors", () => {
    const s = computeScale({
      texture,
      gridSizePx: 100,
      template: DEFAULT_TEMPLATE,
      scale: { x: 2, y: 3 },
      mirrorX: true,
      mirrorY: true
    });
    expect(s).toEqual({ x: -2, y: -3 });
    expect(scaleVector(0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(scaleVector(undefined)).toEqual({ x: 1, y: 1 });
  });
});

describe("parseTint", () => {
  it("parses css hex colors", () => {
    expect(parseTint("#ff8800")).toBe(0xff8800);
    expect(parseTint("f80")).toBe(0xff8800);
    expect(parseTint(0x123456)).toBe(0x123456);
    expect(parseTint("red")).toBeNull();
    expect(parseTint(undefined)).toBeNull();
  });
});
