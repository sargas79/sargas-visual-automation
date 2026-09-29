/**
 * Sequence builder and runner: api.sequence(), api.playSequence()
 * Implemented in #18 - see docs/architecture.md for the contract.
 *
 * Lifecycle (called by src/main.js, all optional):
 *   init(api)   - Foundry "init": register settings, attach to the api object
 *   setup(api)  - Foundry "setup"
 *   ready(api)  - Foundry "ready" (may be async; areas run in order)
 */
export function init(_api) {}
