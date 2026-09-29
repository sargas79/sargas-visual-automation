/**
 * Foundry v14 implementation of the engine environment (see EngineEnvironment in ./engine.js).
 */
import { EffectSprite, tokenCenter } from "./effect-sprite.js";
import { distance, resolveAnchor } from "./math.js";
import { sceneDistance } from "./stretch.js";

/**
 * @param {import("./layers.js").LayerManager} layers
 * @returns {import("./engine.js").EngineEnvironment}
 */
export function createFoundryEnvironment(layers) {
  /** @type {Map<Function, Function>} */
  const tickers = new Map();
  const getToken = (id) => canvas.tokens?.get(id) ?? null;
  const tokenPoint = (id) => tokenCenter(getToken(id));
  return {
    isReady: () => !!canvas?.ready && !!canvas.scene,
    sceneId: () => canvas?.scene?.id ?? null,
    userId: () => game.user?.id ?? null,
    createContext: () => ({
      getToken,
      gridSize: () => canvas.grid?.size ?? 100,
      layers
    }),
    createSprite: (params) => new EffectSprite(params),
    measure(a, b) {
      const pa = resolveAnchor(a, tokenPoint);
      const pb = resolveAnchor(b, tokenPoint);
      if (!pa || !pb) return null;
      return sceneDistance(distance(pa, pb), canvas.grid.size, canvas.grid.distance);
    },
    addTicker(fn) {
      const ticker = canvas.app.ticker;
      const cb = () => fn(ticker.deltaMS);
      tickers.set(fn, cb);
      ticker.add(cb);
    },
    removeTicker(fn) {
      const cb = tickers.get(fn);
      if (!cb) return;
      tickers.delete(fn);
      canvas.app?.ticker?.remove(cb);
    }
  };
}
