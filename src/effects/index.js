/**
 * Persistent effects manager (scene flags): api.effects
 * Implemented in #17 - see docs/architecture.md for the contract and
 * ./manager.js for the storage / ending / replay rules.
 */
import { log } from "../logger.js";
import { createEffectsManager } from "./manager.js";

export { createEffectsManager } from "./manager.js";

/** @param {object} api */
export function init(api) {
  const manager = createEffectsManager(api);
  api.effects = manager.effects;

  api.net?.on("effectsWrite", (data, payload) => manager.onWriteRequest(data, payload));
  api.net?.on("end", (data, payload) => manager.endLocal(data ?? {}, payload));

  const guard =
    (label, fn) =>
    (...args) =>
      Promise.resolve()
        .then(() => fn(...args))
        .catch((err) => log.error(`Persistent effects: ${label} failed`, err));

  Hooks.on(
    "canvasReady",
    guard("replay", (board) => manager.replay(board?.scene))
  );
  Hooks.on(
    "updateScene",
    guard("scene update", (scene) => manager.onSceneUpdate(scene))
  );
  Hooks.on(
    "deleteToken",
    guard("token cleanup", (tokenDoc) => manager.onTokenDeleted(tokenDoc))
  );
}
