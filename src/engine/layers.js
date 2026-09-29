/**
 * Canvas placement of effects (#16).
 *
 * Foundry v14 canvas (CONFIG.Canvas.groups): stage → rendered → environment → primary / effects (lighting),
 * then visibility (fog), then interface; `overlay` sits on the stage outside the world transform.
 *
 * | LAYERS          | Where                                                            |
 * | --------------- | ---------------------------------------------------------------- |
 * | belowTiles      | canvas.primary, sortLayer between the scene (0) and tiles (500)  |
 * | belowTokens     | canvas.primary, sortLayer between drawings (600) and tokens (700)|
 * | aboveTokens     | canvas.primary, sortLayer between tokens (700) and weather (1000)|
 * | aboveLighting   | own container in canvas.interface, right above the grid layer    |
 * | screen          | own container in canvas.overlay (screen pixels, ignores pan/zoom)|
 *
 * Primary objects are sorted by elevation first, then sortLayer, then sort (zIndex): effects take the elevation
 * of their tokens so they sort with them on multi-level scenes, and are lit / darkened like other scene objects.
 * Interface and overlay are drawn above lighting and fog, so their visibility is handled by ./visibility.js.
 */
import { LAYERS } from "../shared/descriptors.js";

/** PrimaryCanvasGroup.SORT_LAYERS in v14, used when the canvas is not available (tests). */
export const DEFAULT_SORT_LAYERS = Object.freeze({ SCENE: 0, TILES: 500, DRAWINGS: 600, TOKENS: 700, WEATHER: 1000 });

/**
 * Where an effect of `layer` goes. Pure.
 * @param {string} layer   One of LAYERS (unknown → aboveTokens).
 * @param {object} [sortLayers]  PrimaryCanvasGroup.SORT_LAYERS
 * @returns {{group: "primary"|"interface"|"overlay", sortLayer?: number}}
 */
export function layerPlacement(layer, sortLayers = DEFAULT_SORT_LAYERS) {
  const s = { ...DEFAULT_SORT_LAYERS, ...sortLayers };
  switch (layer) {
    case LAYERS.BELOW_TILES:
      return { group: "primary", sortLayer: s.TILES - 50 };
    case LAYERS.BELOW_TOKENS:
      return { group: "primary", sortLayer: (s.DRAWINGS + s.TOKENS) / 2 };
    case LAYERS.ABOVE_LIGHTING:
      return { group: "interface" };
    case LAYERS.SCREEN:
      return { group: "overlay" };
    case LAYERS.ABOVE_TOKENS:
    default:
      return { group: "primary", sortLayer: (s.TOKENS + s.WEATHER) / 2 };
  }
}

/**
 * Elevation of a primary-group effect. Pure.
 * - belowTiles: the level's base elevation (under the tiles of the viewed level);
 * - belowTokens: the lowest of its tokens (so it stays under them);
 * - aboveTokens (and others): the highest of its tokens, at least the base.
 * @param {object} params
 * @param {string} params.layer
 * @param {number} params.base                 canvas.level elevation base (0 without levels).
 * @param {number[]} [params.tokenElevations]  Elevations of the tokens the effect is anchored / attached to.
 */
export function effectElevation({ layer, base = 0, tokenElevations = [] }) {
  const els = tokenElevations.filter(Number.isFinite);
  if (layer === LAYERS.BELOW_TILES || !els.length) return base;
  if (layer === LAYERS.BELOW_TOKENS) return Math.min(...els);
  return Math.max(base, ...els);
}

/** PIXI glue: creates display objects and owns the interface / overlay containers. */
export class LayerManager {
  /** @type {Record<string, PIXI.Container|null>} */
  #containers = { interface: null, overlay: null };

  get sortLayers() {
    return foundry.canvas.groups.PrimaryCanvasGroup?.SORT_LAYERS ?? DEFAULT_SORT_LAYERS;
  }

  /** The parent of our effects in the interface / overlay group (created on demand, once per canvas draw). */
  #container(group) {
    const parent = group === "interface" ? canvas.interface : canvas.overlay;
    let c = this.#containers[group];
    if (c && !c.destroyed && c.parent === parent) return c;
    c = new PIXI.Container();
    c.name = `sva-effects-${group}`;
    c.sortableChildren = true;
    c.eventMode = "none";
    if (group === "interface") {
      // VERIFY(v14): GridLayer is a child of the interface group; effects go right above it, under token UI.
      const GridLayer = foundry.canvas.layers.GridLayer;
      const grid = parent.children.find((child) => GridLayer && child instanceof GridLayer);
      parent.addChildAt(c, grid ? parent.getChildIndex(grid) + 1 : 0);
    } else parent.addChild(c);
    this.#containers[group] = c;
    return c;
  }

  /**
   * Create a display object for `texture` in the effect's layer.
   * @param {PIXI.Texture} texture
   * @param {object} descriptor  EffectDescriptor
   * @returns {PIXI.DisplayObject & {svaGroup: string}}
   */
  create(texture, descriptor) {
    const placement = layerPlacement(descriptor.layer, this.sortLayers);
    let display;
    if (placement.group === "primary") {
      display = new foundry.canvas.primary.PrimarySpriteMesh({ texture, name: `sva:${descriptor.id}` });
      display.sortLayer = placement.sortLayer;
      display.sort = descriptor.zIndex ?? 0;
      canvas.primary.addChild(display);
    } else {
      display = new PIXI.Sprite(texture);
      display.name = `sva:${descriptor.id}`;
      display.zIndex = descriptor.zIndex ?? 0;
      this.#container(placement.group).addChild(display);
    }
    display.anchor.set(0.5, 0.5);
    display.eventMode = "none";
    display.svaGroup = placement.group;
    return display;
  }

  /** Set the elevation of a primary-group effect (no-op elsewhere). */
  setElevation(display, elevation) {
    if (display?.svaGroup === "primary" && Number.isFinite(elevation) && display.elevation !== elevation) {
      display.elevation = elevation;
    }
  }

  /** Remove and destroy a display object created by `create` (the texture belongs to the texture cache). */
  release(display) {
    if (!display || display.destroyed) return;
    display.parent?.removeChild(display);
    display.destroy({ children: true, texture: false, baseTexture: false });
  }

  /** Drop our containers (canvas tear down). */
  tearDown() {
    for (const [group, c] of Object.entries(this.#containers)) {
      if (c && !c.destroyed) {
        c.parent?.removeChild(c);
        c.destroy({ children: true, texture: false, baseTexture: false });
      }
      this.#containers[group] = null;
    }
  }
}
