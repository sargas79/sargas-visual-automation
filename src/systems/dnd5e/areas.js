/**
 * D&D 5e activity templates → AREA_PLACED events.
 *
 * On Foundry v14, dnd5e 6.x no longer creates MeasuredTemplates: `Activity#placeTemplate` calls
 * `TemplatePlacement.fromActivity`, which lets the user place the shapes and then creates **Regions**
 * (`canvas.scene.createEmbeddedDocuments("Region", ...)`) with
 * `flags.dnd5e = { activity (uuid), item (uuid), origin (token uuid), dimensions {size, width, height, units}, spellLevel }`
 * and `flags.core.MeasuredTemplate: true`. Several placements of a non-token-attached template share one region.
 *
 * Sources (foundryvtt/dnd5e, tag release-6.0.5):
 *  - module/canvas/template-placement.mjs  (fromActivity, #createShapeData: circle {radius}, cone {radius, angle =
 *    CONFIG.MeasuredTemplate.defaults.angle}, emanation {base (token), radius}, line/ray {length, width},
 *    rect/rectangle {width, height}, ring {radius}; distances in px)
 *  - module/documents/activity/mixin.mjs   (#placeTemplate, placeTemplateBehaviors)
 *  - module/canvas/ability-template.mjs    (deprecated MeasuredTemplate path, flags.dnd5e {item, origin (activity uuid)})
 * Shape distances are in pixels; the event uses scene distance units.
 */
import { AREA_SHAPES, EVENT_TYPES } from "../../shared/events.js";
import { describeItem } from "./descriptors.js";
import { tokenIdForActor, tokenIdFromUuid } from "./messages.js";

function gridScale() {
  const dims = globalThis.canvas?.dimensions;
  const size = dims?.size ?? globalThis.canvas?.grid?.size ?? 100;
  const distance = dims?.distance ?? globalThis.canvas?.grid?.distance ?? 5;
  return { size, distance, pxToUnits: (px) => (Number(px) / size) * distance };
}

/** Convert a v14 region shape to the event `area` geometry. */
export function areaFromShape(shape) {
  if (!shape) return null;
  const { size, distance, pxToUnits } = gridScale();
  const rotation = Number(shape.rotation ?? 0) || 0;
  switch (shape.type) {
    case "circle":
    case "ring":
      return {
        shape: AREA_SHAPES.BURST,
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
        // VERIFY(dnd5e): CONFIG.MeasuredTemplate.defaults.angle is 53.13 in dnd5e (a 5e cone is as wide as it is long).
        angle: shape.angle ?? 53.13
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
        shape: AREA_SHAPES.SQUARE,
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
      // Base is the caster's token: x/y top-left in px, width/height in grid spaces. VERIFY(v14): base units.
      const base = shape.base ?? {};
      const w = Number(base.width ?? 1);
      const h = Number(base.height ?? 1);
      return {
        shape: AREA_SHAPES.EMANATION,
        origin: { x: (base.x ?? shape.x ?? 0) + (w * size) / 2, y: (base.y ?? shape.y ?? 0) + (h * size) / 2 },
        direction: 0,
        distance: pxToUnits(shape.radius),
        width: w * distance
      };
    }
    default:
      return null;
  }
}

/** Deprecated MeasuredTemplate (dnd5e 5.x AbilityTemplate). t: circle | cone | ray | rect. */
export function areaFromTemplate(doc) {
  const shape = { circle: AREA_SHAPES.BURST, cone: AREA_SHAPES.CONE, ray: AREA_SHAPES.LINE, rect: AREA_SHAPES.SQUARE }[
    doc.t
  ];
  if (!shape) return null;
  const area = { shape, origin: { x: doc.x, y: doc.y }, direction: doc.direction ?? 0, distance: doc.distance ?? 0 };
  if (shape === AREA_SHAPES.LINE && doc.width) area.width = doc.width;
  if (shape === AREA_SHAPES.CONE) area.angle = doc.angle ?? 53.13;
  return area;
}

function resolve(uuid) {
  if (!uuid || typeof uuid !== "string" || uuid.startsWith("Compendium.") || !globalThis.fromUuidSync) return null;
  try {
    return globalThis.fromUuidSync(uuid, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

/** Item + activity that placed the area. The activity uuid ends with ".Activity.<id>". */
function originOf(flags) {
  const activityUuid = typeof flags.activity === "string" ? flags.activity : null;
  const itemUuid =
    (typeof flags.item === "string" ? flags.item : null) ?? activityUuid?.replace(/\.Activity\.[^.]+$/, "") ?? null;
  const item = resolve(itemUuid);
  const activityId = /\.Activity\.([^.]+)$/.exec(activityUuid ?? "")?.[1] ?? null;
  const activity = activityId ? (item?.system?.activities?.get?.(activityId) ?? null) : null;
  return { item, activity, itemUuid };
}

function sourceOf(item, originTokenUuid) {
  const actor = item?.actor ?? item?.parent ?? null;
  const tokenId = tokenIdFromUuid(originTokenUuid) ?? tokenIdForActor(actor);
  const actorId = actor?.id ?? null;
  return actorId || tokenId ? { tokenId: tokenId ?? null, actorId } : null;
}

function tokensInside(doc) {
  // RegionDocument#tokens: Set<TokenDocument> of tokens inside the region.
  const tokens = doc.tokens;
  if (!tokens || typeof tokens[Symbol.iterator] !== "function") return [];
  return [...tokens].map((t) => ({ tokenId: t.id })).filter((t) => t.tokenId);
}

/**
 * RegionDocument placed from a dnd5e activity → partial AREA_PLACED events (one per shape), or [] for other regions.
 * @returns {object[]}
 */
export function eventsFromRegion(doc, { userId } = {}) {
  const flags = doc?.flags?.dnd5e;
  if (!flags?.item && !flags?.activity) return [];
  const { item, activity, itemUuid } = originOf(flags);
  const descriptors = item ? describeItem(item, { activity }) : null;
  const shapes = doc.shapes ?? [];
  const events = [];
  shapes.forEach((shape, i) => {
    const area = areaFromShape(shape);
    if (!area) return;
    area.documentUuid = doc.uuid ?? null;
    const d = descriptors ?? { ...describeItem(null), area: { shape: area.shape, size: area.distance } };
    if (!d.area) d.area = { shape: area.shape, size: area.distance };
    events.push({
      id: doc.id ? `${doc.id}:${i ? `${i}:` : ""}${EVENT_TYPES.AREA_PLACED}` : null,
      type: EVENT_TYPES.AREA_PLACED,
      source: sourceOf(item, flags.origin),
      targets: tokensInside(doc),
      itemUuid: item?.uuid ?? itemUuid,
      descriptors: d,
      area,
      sceneId: doc.parent?.id ?? globalThis.canvas?.scene?.id ?? null,
      userId: userId ?? globalThis.game?.user?.id ?? null
    });
  });
  return events;
}

/**
 * A dnd5e template region was removed (concentration ended, manual delete): EFFECT_REMOVED for its item, so
 * persistent (aura) animations started from it can end.
 */
export function removalFromRegion(doc, { userId } = {}) {
  const [placed] = eventsFromRegion(doc, { userId });
  if (!placed || !placed.descriptors?.key) return null;
  return {
    ...placed,
    id: doc.id ? `${doc.id}:${EVENT_TYPES.EFFECT_REMOVED}` : null,
    type: EVENT_TYPES.EFFECT_REMOVED,
    targets: [],
    effectUuid: doc.uuid ?? null
  };
}

/** Deprecated MeasuredTemplateDocument with dnd5e flags (`item` uuid, `origin` activity uuid) → AREA_PLACED. */
export function eventFromTemplate(doc, { userId } = {}) {
  const flags = doc?.flags?.dnd5e;
  if (!flags?.item && !flags?.origin) return null;
  const area = areaFromTemplate(doc);
  if (!area) return null;
  area.documentUuid = doc.uuid ?? null;
  const { item, activity, itemUuid } = originOf({ item: flags.item, activity: flags.origin });
  const descriptors = item ? describeItem(item, { activity }) : { ...describeItem(null) };
  if (!descriptors.area) descriptors.area = { shape: area.shape, size: area.distance };
  return {
    id: doc.id ? `${doc.id}:${EVENT_TYPES.AREA_PLACED}` : null,
    type: EVENT_TYPES.AREA_PLACED,
    source: sourceOf(item, null),
    targets: [],
    itemUuid: item?.uuid ?? itemUuid,
    descriptors,
    area,
    sceneId: doc.parent?.id ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null
  };
}
