import { SystemAdapter } from "./shared/adapter.js";
import { LAYERS } from "./shared/descriptors.js";
import { AREA_SHAPES, ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "./shared/events.js";

/**
 * Builds the public API exposed at `game.modules.get("sargas-visual-automation").api` (also `globalThis.SVA`).
 * Areas (db, engine, sequence, effects, net, automation, ui) attach themselves during init.
 * Shared contract classes/constants are exposed so macros and third-party system adapters can use them.
 */
export function createApi(version) {
  return {
    version,
    ready: false,
    SystemAdapter,
    LAYERS,
    EVENT_TYPES,
    OUTCOMES,
    AREA_SHAPES,
    ATTACK_KINDS
  };
}
