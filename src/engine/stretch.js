/**
 * Stretch-to-target math (#15). Pure, unit tested in tests/engine/stretch.test.js.
 *
 * JB2A ranged assets (`_templates`, e.g. `ranged: [200, 200, 200]` = [gridSize, startPad, endPad]) are authored so that
 * on a texture `width` px wide:
 *   - the texture x = startPad is where the projectile visibly leaves the caster (source),
 *   - the texture x = width - endPad is where it visibly hits (target),
 *   - the art assumes a grid of `gridSize` px: a "30ft" variant has 6 × gridSize px between the pads.
 *
 * To draw it from S to T, D = |T - S| canvas px apart, on a scene grid of g px:
 *   anchor   = (startPad / width, 0.5)   → the texture point (startPad, h/2) sits on S
 *   rotation = atan2(T.y - S.y, T.x - S.x)
 *   scale.x  = D / (width - startPad - endPad)
 *              → the texture point (width - endPad) lands at S + (width - endPad - startPad) · scale.x = S + D = T
 *   scale.y  = g / gridSize   → thickness stays proportional to the grid (like a non-stretched effect)
 * Because api.db picks the distance variant closest to D, scale.x ≈ scale.y and the art is barely distorted.
 * User `scale` / scale-in/out only affect the thickness (y); x must stay exact to land on the target.
 */
import { angleTo, distance, DEFAULT_TEMPLATE, scaleVector } from "./math.js";

/**
 * @param {object} params
 * @param {{x: number, y: number}} params.source
 * @param {{x: number, y: number}} params.target
 * @param {{width: number}} params.texture
 * @param {{gridSize: number, startPad: number, endPad: number}} [params.template]  null/omitted → no padding.
 * @param {number} params.gridSizePx
 * @param {number|{x: number, y: number}} [params.scale]   Only the y component is used.
 * @param {boolean} [params.mirrorY]
 * @returns {{anchorX: number, anchorY: number, rotation: number, scaleX: number, scaleY: number, distancePx: number}}
 */
export function computeStretch({ source, target, texture, template, gridSizePx, scale, mirrorY }) {
  const width = texture?.width || 1;
  const t = template ?? { gridSize: 0, startPad: 0, endPad: 0 };
  const startPad = Math.max(0, t.startPad ?? 0);
  const endPad = Math.max(0, t.endPad ?? 0);
  const span = Math.max(1, width - startPad - endPad);
  const distancePx = distance(source, target);
  const thickness = template?.gridSize > 0 && gridSizePx > 0 ? gridSizePx / template.gridSize : 1;
  return {
    anchorX: Math.min(1, startPad / width),
    anchorY: 0.5,
    rotation: angleTo(source, target),
    scaleX: distancePx / span,
    scaleY: thickness * scaleVector(scale).y * (mirrorY ? -1 : 1),
    distancePx
  };
}

/** Where the visible start and end of a stretched sprite land (used by tests and the debug overlay). */
export function stretchEndpoints({ source, texture, anchorX, rotation, scaleX, template }) {
  const t = template ?? DEFAULT_TEMPLATE;
  const width = texture.width;
  const along = (texX) => (texX - anchorX * width) * scaleX;
  const at = (d) => ({ x: source.x + Math.cos(rotation) * d, y: source.y + Math.sin(rotation) * d });
  return { start: at(along(t.startPad)), end: at(along(width - t.endPad)) };
}

/** Canvas px → scene distance units (feet, meters...). */
export function sceneDistance(px, gridSizePx, gridDistance) {
  if (!(gridSizePx > 0)) return 0;
  return (px / gridSizePx) * (gridDistance || 1);
}

/** Deterministic PRNG in [0, 1) from a string (mulberry32 over a FNV-1a hash): same result on every client. */
export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Offset from the target for a missed projectile: beside the target, not on it.
 * The shot deviates 45°–90° to a random side of the line of fire (measured at the target, so it can also pass
 * behind it) and lands just outside the target's footprint: radius + ¼–¾ of a grid square away.
 * @param {object} params
 * @param {{x: number, y: number}} params.source
 * @param {{x: number, y: number}} params.target
 * @param {number} params.radius        Half the target's size in px (half a square for a point).
 * @param {number} params.gridSizePx
 * @param {() => number} params.rng     Use seededRandom(effect.id) so every client agrees.
 * @returns {{x: number, y: number}}    Offset to add to the target position.
 */
export function missedOffset({ source, target, radius, gridSizePx, rng }) {
  const line = angleTo(source, target);
  const side = rng() < 0.5 ? -1 : 1;
  const deviation = (Math.PI / 4) * (1 + rng());
  const reach = radius + gridSizePx * (0.25 + 0.5 * rng());
  const angle = line + side * deviation;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}
