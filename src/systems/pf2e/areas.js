/**
 * PF2e effect areas → AREA_PLACED events.
 *
 * On Foundry v14 PF2e no longer creates MeasuredTemplates for spell areas: `SpellPF2e#placeTemplate` calls
 * `placeRegionFromItem` which places a **Region** with a single shape and
 * `flags.pf2e = { messageId, areaShape, origin: { name, slug, traits, actor, uuid, type, rollOptions } }`.
 *
 * Sources (foundryvtt/pf2e, tag pf2e-8.5.1):
 *  - src/module/item/helpers.ts#placeRegionFromItem
 *  - src/module/canvas/helpers.ts#shapeDataFromEffectArea  (burst/cylinder → circle, cone → cone angle 90,
 *    cube/square → rectangle, emanation → emanation around a token base, line → line (width = 1 grid), ring → ring)
 *  - src/module/scene/region-document/document.ts  (areaShape, isEffectArea)
 *  - types/foundry/common/data/data.d.mts          (v14 shape data: circle {x,y,radius}, cone {x,y,radius,angle,rotation},
 *    line {x,y,length,width,rotation}, rectangle {x,y,width,height,rotation}, emanation {base,radius}, ring {x,y,radius})
 * Shape distances are in pixels; the event uses scene distance units.
 */
import { AREA_SHAPES, EVENT_TYPES } from "../../shared/events.js";
import { describeItem, mapAreaShape } from "./descriptors.js";

function gridScale() {
  const dims = globalThis.canvas?.dimensions;
  const size = dims?.size ?? globalThis.canvas?.grid?.size ?? 100;
  const distance = dims?.distance ?? globalThis.canvas?.grid?.distance ?? 5;
  return { size, distance, pxToUnits: (px) => (Number(px) / size) * distance };
}

/** Grid squares for a token base dimension: TokenShapeData mirrors TokenDocument (grid units); pixels otherwise. */
function tokenSquares(value, size) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  // No grid is smaller than 20 px and no token is wider than 20 squares, so the magnitude tells the unit apart.
  return n > 20 ? n / size : n;
}

/** Center (canvas px) of a region base shape, or null when it has no usable coordinates. */
export function baseCenter(base, size) {
  if (!base || typeof base !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const x = num(base.x);
  const y = num(base.y);
  switch (base.type) {
    case "token": {
      if (x === null || y === null) return null;
      const w = tokenSquares(base.width ?? 1, size);
      const h = tokenSquares(base.height ?? 1, size);
      return { x: x + (w * size) / 2, y: y + (h * size) / 2 };
    }
    case "rectangle": {
      if (x === null || y === null) return null;
      const rad = ((Number(base.rotation ?? 0) || 0) * Math.PI) / 180;
      const cx = (num(base.width) ?? 0) / 2;
      const cy = (num(base.height) ?? 0) / 2;
      return { x: x + cx * Math.cos(rad) - cy * Math.sin(rad), y: y + cx * Math.sin(rad) + cy * Math.cos(rad) };
    }
    case "polygon": {
      const pts = Array.isArray(base.points) ? base.points.map(Number) : [];
      if (pts.length < 2 || pts.some((n) => !Number.isFinite(n))) return null;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        sx += pts[i];
        sy += pts[i + 1];
      }
      const n = Math.floor(pts.length / 2);
      return { x: sx / n, y: sy / n };
    }
    default:
      // circle, cone, line, ellipse, unknown: x/y is the center or the apex.
      return x === null || y === null ? null : { x, y };
  }
}

/** Width of a region base shape in grid squares (1 when unknown), for sizing the emanation around it. */
function baseWidth(base, size) {
  if (!base || typeof base !== "object") return 1;
  switch (base.type) {
    case "token":
      return tokenSquares(base.width ?? 1, size);
    case "rectangle":
      return Number(base.width) > 0 ? Number(base.width) / size : 1;
    case "circle":
    case "ellipse":
      return Number(base.radius ?? base.radiusX) > 0 ? (2 * Number(base.radius ?? base.radiusX)) / size : 1;
    default:
      return 1;
  }
}

/** Convert a v14 region shape to the event `area` geometry. */
export function areaFromShape(shape, pf2eShape) {
  if (!shape) return null;
  const { size, pxToUnits } = gridScale();
  const shapeName = mapAreaShape(pf2eShape) ?? null;
  const rotation = Number(shape.rotation ?? 0) || 0;
  switch (shape.type) {
    case "circle":
    case "ring":
      return {
        shape: shapeName ?? AREA_SHAPES.BURST,
        origin: { x: shape.x, y: shape.y },
        direction: rotation,
        distance: pxToUnits(shape.radius)
      };
    case "cone":
      return {
        shape: AREA_SHAPES.CONE,
        origin: { x: shape.x, y: shape.y },
        direction: rotation,
        distance: pxToUnits(shape.radius),
        angle: shape.angle ?? 90
      };
    case "line":
      return {
        shape: AREA_SHAPES.LINE,
        origin: { x: shape.x, y: shape.y },
        direction: rotation,
        distance: pxToUnits(shape.length),
        width: pxToUnits(shape.width)
      };
    case "rectangle": {
      // VERIFY(v14): rectangle x/y is the top-left corner and rotation pivots around it; we report the center.
      const rad = (rotation * Math.PI) / 180;
      const cx = shape.width / 2;
      const cy = shape.height / 2;
      return {
        shape: shapeName ?? AREA_SHAPES.SQUARE,
        origin: {
          x: shape.x + cx * Math.cos(rad) - cy * Math.sin(rad),
          y: shape.y + cx * Math.sin(rad) + cy * Math.cos(rad)
        },
        direction: rotation,
        distance: pxToUnits(shape.width),
        width: pxToUnits(shape.height)
      };
    }
    case "emanation": {
      // v14: the base can be any shape but a ring or an emanation (token, circle, rectangle, polygon...).
      const base = shape.base ?? null;
      const center = baseCenter(base, size) ?? baseCenter(shape, size);
      const w = baseWidth(base, size);
      return {
        shape: AREA_SHAPES.EMANATION,
        // null origin: the recipe falls back to the caster's token (buildArea), which is where an emanation sits.
        origin: center,
        direction: 0,
        distance: pxToUnits(shape.radius),
        width: w * gridScale().distance
      };
    }
    default:
      return null;
  }
}

/** Legacy MeasuredTemplate (kept for modules that still create them). t: circle | cone | ray | rect. */
export function areaFromTemplate(doc) {
  const shape = { circle: AREA_SHAPES.BURST, cone: AREA_SHAPES.CONE, ray: AREA_SHAPES.LINE, rect: AREA_SHAPES.SQUARE }[
    doc.t
  ];
  if (!shape) return null;
  const area = { shape, origin: { x: doc.x, y: doc.y }, direction: doc.direction ?? 0, distance: doc.distance ?? 0 };
  if (shape === AREA_SHAPES.LINE && doc.width) area.width = doc.width;
  if (shape === AREA_SHAPES.CONE) area.angle = doc.angle ?? 90;
  return area;
}

function resolveOriginItem(origin) {
  const uuid = origin?.uuid;
  if (!uuid || uuid.startsWith("Compendium.") || !globalThis.fromUuidSync) return null;
  try {
    return globalThis.fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Build descriptors for the item that placed an area, or from the flag data if the item is gone. */
function originDescriptors(origin, pf2eShape, area) {
  const item = resolveOriginItem(origin);
  if (item) return { item, descriptors: describeItem(item) };
  if (!origin) return { item: null, descriptors: null };
  const descriptors = describeItem({
    name: origin.name ?? "",
    slug: origin.slug ?? null,
    type: origin.type ?? "other",
    system: { traits: { value: origin.traits ?? [] } }
  });
  if (!descriptors.area && pf2eShape && area) descriptors.area = { shape: area.shape, size: area.distance };
  return { item: null, descriptors };
}

function tokensInside(doc) {
  // RegionDocument#tokens: Set<TokenDocument> of tokens inside the region (v12+, v14 types).
  const tokens = doc.tokens;
  if (!tokens || typeof tokens[Symbol.iterator] !== "function") return [];
  return [...tokens].map((t) => ({ tokenId: t.id })).filter((t) => t.tokenId);
}

function sourceFrom(origin) {
  const actorUuid = origin?.actor ?? null;
  const actorId = /(?:^|\.)Actor\.([^.]+)/.exec(actorUuid ?? "")?.[1] ?? null;
  let tokenId = /(?:^|\.)Token\.([^.]+)/.exec(actorUuid ?? "")?.[1] ?? null;
  if (!tokenId && actorId) {
    const token = globalThis.canvas?.tokens?.placeables?.find((t) => (t.actor?.id ?? t.document?.actorId) === actorId);
    tokenId = token?.id ?? null;
  }
  return actorId || tokenId ? { tokenId, actorId } : null;
}

/** RegionDocument placed by PF2e → partial AREA_PLACED event, or null for non-PF2e regions. */
export function eventFromRegion(doc, { userId } = {}) {
  const flags = doc?.flags?.pf2e;
  if (!flags?.areaShape && !flags?.origin) return null;
  const shapes = doc.shapes ?? [];
  if (shapes.length !== 1) return null;
  const area = areaFromShape(shapes[0], flags.areaShape);
  if (!area) return null;
  area.documentUuid = doc.uuid ?? null;
  const { item, descriptors } = originDescriptors(flags.origin, flags.areaShape, area);
  return {
    id: doc.id ? `${doc.id}:${EVENT_TYPES.AREA_PLACED}` : null,
    type: EVENT_TYPES.AREA_PLACED,
    source: sourceFrom(flags.origin),
    targets: tokensInside(doc),
    itemUuid: item?.uuid ?? flags.origin?.uuid ?? null,
    descriptors,
    area,
    sceneId: doc.parent?.id ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}

/**
 * A PF2e effect area was removed (the chat card's "clear effect area" button or manual delete): EFFECT_REMOVED
 * for its origin item, so persistent (sustained) area/aura animations started from it can end.
 */
export function removalFromRegion(doc, { userId } = {}) {
  const placed = eventFromRegion(doc, { userId });
  if (!placed) return null;
  return {
    ...placed,
    id: doc.id ? `${doc.id}:${EVENT_TYPES.EFFECT_REMOVED}` : null,
    type: EVENT_TYPES.EFFECT_REMOVED,
    targets: [],
    effectUuid: doc.uuid ?? null
  };
}

/** Legacy MeasuredTemplateDocument with PF2e origin flags → partial AREA_PLACED event. */
export function eventFromTemplate(doc, { userId } = {}) {
  const origin = doc?.flags?.pf2e?.origin;
  if (!origin) return null;
  const area = areaFromTemplate(doc);
  if (!area) return null;
  area.documentUuid = doc.uuid ?? null;
  const { item, descriptors } = originDescriptors(origin, doc.flags.pf2e.areaType ?? null, area);
  return {
    id: doc.id ? `${doc.id}:${EVENT_TYPES.AREA_PLACED}` : null,
    type: EVENT_TYPES.AREA_PLACED,
    source: sourceFrom(origin),
    targets: [],
    itemUuid: item?.uuid ?? origin.uuid ?? null,
    descriptors,
    area,
    sceneId: doc.parent?.id ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}
