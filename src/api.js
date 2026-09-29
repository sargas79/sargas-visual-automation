/**
 * Builds the public API exposed at `game.modules.get("sargas-visual-automation").api`.
 * Sub-systems (db, engine, automation, systems) attach themselves here as they are implemented.
 */
export function createApi(version) {
  return {
    version,
    ready: false
  };
}
