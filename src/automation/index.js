/**
 * System-agnostic automation core: api.automation, api.systems
 * See docs/architecture.md "Automation core" for the contract.
 *
 * Lifecycle (called by src/main.js):
 *   init(api)   - attach api.systems / api.automation, register built-in adapters
 *   ready(api)  - activate the adapter for the current game system
 */
import { BUILTIN_ADAPTERS } from "../systems/index.js";
import { compile } from "./compile.js";
import { PRESETS } from "./presets.js";
import { RECIPE_VERSION, checkRecipe, migrateRecipe, normalizeRecipe, validateRecipe } from "./schema.js";
import { createSystemsRegistry } from "./systems.js";

export function init(api) {
  api.systems = createSystemsRegistry(api);
  api.automation = {
    presets: PRESETS,
    compile,
    schema: { RECIPE_VERSION, validateRecipe, migrateRecipe, normalizeRecipe, checkRecipe }
  };
  for (const AdapterClass of BUILTIN_ADAPTERS) api.systems.register(AdapterClass);
}

export async function ready(api) {
  api.systems.activate();
}
