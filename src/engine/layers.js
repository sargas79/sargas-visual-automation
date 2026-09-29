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
import { ObjectPool } from "./pool.js";

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

/** Put a released display object back into its initial state (it keeps no texture). */
function resetDisplay(display) {
  display.texture = PIXI.Texture.EMPTY;
  display.position.set(0, 0);
  display.scale.set(1, 1);
  display.anchor.set(0.5, 0.5);
  display.rotation = 0;
  display.alpha = 1;
  display.tint = 0xffffff;
  display.visible = true;
  display.name = null;
  display.svaGroup = null;
  return true;
}

function destroyDisplay(display) {
  if (!display.destroyed) display.destroy({ children: true, texture: false, baseTexture: false });
}

/** PIXI glue: creates display objects (pooled) and owns the interface / overlay containers. */
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
    const display = this.#pools[placement.group === "primary" ? "primary" : "sprite"].acquire(texture);
    display.name = `sva:${descriptor.id}`;
    if (placement.group === "primary") {
      display.sortLayer = placement.sortLayer;
      display.sort = descriptor.zIndex ?? 0;
      canvas.primary.addChild(display);
    } else {
      display.zIndex = descriptor.zIndex ?? 0;
      this.#container(placement.group).addChild(display);
    }
    display.svaGroup = placement.group;
    return display;
  }

  /** Sprite pooling (#19): display objects are reset and reused instead of re-allocated. */
  #pools = {
    primary: new ObjectPool({
      create: (texture) => new foundry.canvas.primary.PrimarySpriteMesh({ texture }),
      prepare: (mesh, texture) => {
        mesh.texture = texture;
        mesh.eventMode = "none";
      },
      reset: (mesh) => resetDisplay(mesh),
      destroy: (mesh) => destroyDisplay(mesh),
      isAlive: (mesh) => !mesh.destroyed
    }),
    sprite: new ObjectPool({
      create: (texture) => new PIXI.Sprite(texture),
      prepare: (sprite, texture) => {
        sprite.texture = texture;
        sprite.eventMode = "none";
      },
      reset: (sprite) => resetDisplay(sprite),
      destroy: (sprite) => destroyDisplay(sprite),
      isAlive: (sprite) => !sprite.destroyed
    })
  };

  /** Set the elevation of a primary-group effect (no-op elsewhere). */
  setElevation(display, elevation) {
    if (display?.svaGroup === "primary" && Number.isFinite(elevation) && display.elevation !== elevation) {
      display.elevation = elevation;
    }
  }

  /** Remove a display object created by `create` and return it to its pool (the texture belongs to the cache). */
  release(display) {
    if (!display || display.destroyed) return;
    display.parent?.removeChild(display);
    this.#pools[display.svaGroup === "primary" ? "primary" : "sprite"].release(display);
  }

  poolStats() {
    return Object.fromEntries(
      Object.entries(this.#pools).map(([name, pool]) => [name, { free: pool.size, ...pool.counters }])
    );
  }

  /** Drop pooled objects and our containers (canvas tear down). */
  tearDown() {
    for (const pool of Object.values(this.#pools)) pool.clear();
    for (const [group, c] of Object.entries(this.#containers)) {
      if (c && !c.destroyed) {
        c.parent?.removeChild(c);
        c.destroy({ children: true, texture: false, baseTexture: false });
      }
      this.#containers[group] = null;
    }
  }
}
