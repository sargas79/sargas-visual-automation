/**
 * Pure geometry / scale helpers for effect sprites (#14). No Foundry or PIXI access: everything canvas related is
 * passed in, so the math is unit tested in tests/engine/math.test.js.
 */

/** JB2A assets without a `_templates` entry are authored for a 100 px grid with no padding. */
export const DEFAULT_TEMPLATE = Object.freeze({ gridSize: 100, startPad: 0, endPad: 0 });

/** @returns {{x: number, y: number}} */
export function addOffset(point, offset) {
  if (!point) return null;
  return { x: point.x + (offset?.x ?? 0), y: point.y + (offset?.y ?? 0) };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Angle in radians of the vector a → b (0 = pointing right, clockwise positive on the canvas). */
export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function toRadians(degrees) {
  return ((degrees ?? 0) * Math.PI) / 180;
}

/**
 * Resolve an Anchor to a canvas point.
 * @param {import("../shared/descriptors.js").Anchor} anchor
 * @param {(tokenId: string) => ({x: number, y: number}|null)} tokenPoint  Current (rendered) center of a token.
 * @returns {{x: number, y: number}|null} null when the anchor's token is gone.
 */
export function resolveAnchor(anchor, tokenPoint) {
  if (!anchor) return null;
  if (anchor.tokenId) return addOffset(tokenPoint(anchor.tokenId), anchor.offset);
  if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) return addOffset(anchor, anchor.offset);
  return null;
}

/** Template of a ResolvedFile, with the JB2A default for assets that do not declare one. */
export function templateOf(resolved) {
  const t = resolved?.template;
  if (!t?.gridSize) return DEFAULT_TEMPLATE;
  return { gridSize: t.gridSize, startPad: t.startPad ?? 0, endPad: t.endPad ?? 0 };
}

/** Scale that makes an asset authored for `template.gridSize` match the scene grid. */
export function gridScale(gridSizePx, template = DEFAULT_TEMPLATE) {
  if (!(gridSizePx > 0) || !(template?.gridSize > 0)) return 1;
  return gridSizePx / template.gridSize;
}

/** Normalize `scale` (number or {x, y}) to {x, y}. */
export function scaleVector(scale) {
  if (typeof scale === "number" && Number.isFinite(scale)) return { x: scale, y: scale };
  if (scale && typeof scale === "object") return { x: scale.x ?? 1, y: scale.y ?? 1 };
  return { x: 1, y: 1 };
}

/**
 * Sprite scale for a non-stretched effect. Priority: `size` > `scaleToObject` > grid scale; then `scale` and mirror.
 *
 * - `size`: explicit width/height in px (or grid squares with gridUnits). A missing or non-positive side keeps the
 *   texture's aspect ratio.
 * - `scaleToObject`: uniform scale so the texture's larger side equals the object's larger side times the factor.
 * - otherwise: JB2A grid scale (canvas grid / template gridSize); 1 for files without a template (direct URLs) or
 *   screen-space effects.
 *
 * @param {object} params
 * @param {{width: number, height: number}} params.texture   Texture size in px.
 * @param {number} params.gridSizePx                          canvas.grid.size
 * @param {{gridSize: number}|null} params.template           null → no grid scaling.
 * @param {{width?: number, height?: number, gridUnits?: boolean}} [params.size]
 * @param {number} [params.scaleToObject]
 * @param {{width: number, height: number}|null} [params.objectSize]  Size in px of the token the effect sits on.
 * @param {number|{x: number, y: number}} [params.scale]
 * @param {boolean} [params.mirrorX]
 * @param {boolean} [params.mirrorY]
 * @returns {{x: number, y: number}}
 */
export function computeScale({
  texture,
  gridSizePx,
  template,
  size,
  scaleToObject,
  objectSize,
  scale,
  mirrorX,
  mirrorY
}) {
  const tw = texture?.width || 1;
  const th = texture?.height || 1;
  let sx;
  let sy;
  const unit = size?.gridUnits ? gridSizePx || 1 : 1;
  const w = size?.width > 0 ? size.width * unit : null;
  const h = size?.height > 0 ? size.height * unit : null;
  if (w || h) {
    sx = w ? w / tw : h / th;
    sy = h ? h / th : w / tw;
  } else if (scaleToObject > 0 && objectSize?.width > 0) {
    sx = sy = (scaleToObject * Math.max(objectSize.width, objectSize.height || 0)) / Math.max(tw, th);
  } else {
    sx = sy = template ? gridScale(gridSizePx, template) : 1;
  }
  const user = scaleVector(scale);
  return { x: sx * user.x * (mirrorX ? -1 : 1), y: sy * user.y * (mirrorY ? -1 : 1) };
}

/**
 * Parse a CSS hex color ("#ff8800", "ff8800", "#f80") or a number to a 0xRRGGBB number.
 * @returns {number|null}
 */
export function parseTint(tint) {
  if (typeof tint === "number" && Number.isFinite(tint)) return tint & 0xffffff;
  if (typeof tint !== "string") return null;
  let hex = tint.trim().replace(/^#|^0x/i, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return parseInt(hex, 16);
}
