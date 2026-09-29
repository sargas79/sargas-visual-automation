/**
 * Canvas placement of effect display objects (PIXI glue).
 */

/** Primary-group sort layer used for effects (between tokens and weather). */
function aboveTokensSortLayer() {
  const layers = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
  return (layers?.TOKENS ?? 700) + 50;
}

export class LayerManager {
  /**
   * Create a display object for `texture` and add it to the canvas.
   * @param {PIXI.Texture} texture
   * @param {object} _descriptor  EffectDescriptor
   * @returns {PIXI.DisplayObject}
   */
  create(texture, _descriptor) {
    const mesh = new foundry.canvas.primary.PrimarySpriteMesh({ texture, name: "sva-effect" });
    mesh.anchor.set(0.5, 0.5);
    mesh.sortLayer = aboveTokensSortLayer();
    mesh.elevation = canvas.level?.elevation?.base ?? 0;
    canvas.primary.addChild(mesh);
    return mesh;
  }

  /** Remove and destroy a display object created by `create`. */
  release(display) {
    if (!display || display.destroyed) return;
    display.parent?.removeChild(display);
    display.destroy({ children: true, texture: false, baseTexture: false });
  }
}
