/**
 * Foundry v14 implementation of the engine environment (see EngineEnvironment in ./engine.js).
 */
import { EffectSprite } from "./effect-sprite.js";

/**
 * @param {import("./layers.js").LayerManager} layers
 * @returns {import("./engine.js").EngineEnvironment}
 */
export function createFoundryEnvironment(layers) {
  /** @type {Map<Function, Function>} */
  const tickers = new Map();
  return {
    isReady: () => !!canvas?.ready && !!canvas.scene,
    sceneId: () => canvas?.scene?.id ?? null,
    userId: () => game.user?.id ?? null,
    createContext: () => ({
      getToken: (id) => canvas.tokens?.get(id) ?? null,
      gridSize: () => canvas.grid?.size ?? 100,
      layers
    }),
    createSprite: (params) => new EffectSprite(params),
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
