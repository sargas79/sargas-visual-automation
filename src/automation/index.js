/**
 * System-agnostic automation core: api.automation, api.systems
 * See docs/architecture.md "Automation core" for the contract.
 *
 * Lifecycle (called by src/main.js):
 *   init(api)   - register settings, attach api.systems / api.automation, register built-in adapters
 *   ready(api)  - activate the adapter for the current game system
 */
import { MODULE_ID } from "../constants.js";
import { BUILTIN_ADAPTERS } from "../systems/index.js";
import { SETTING_ENABLED, createAutomation } from "./automation.js";
import { EMPTY_RULES, SETTING_RULES, createRulesStore } from "./rules.js";
import { RECIPE_VERSION, checkRecipe, migrateRecipe, normalizeRecipe, validateRecipe } from "./schema.js";
import { createSystemsRegistry } from "./systems.js";

function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_ENABLED, {
    name: "SVA.Automation.Settings.Enabled.Name",
    hint: "SVA.Automation.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTING_RULES, {
    name: "SVA.Automation.Settings.Rules.Name",
    scope: "world",
    config: false,
    type: Object,
    default: EMPTY_RULES
  });
}

export function init(api) {
  registerSettings();
  api.systems = createSystemsRegistry(api);
  api.automation = createAutomation(api, createRulesStore());
  api.automation.schema = { RECIPE_VERSION, validateRecipe, migrateRecipe, normalizeRecipe, checkRecipe };
  for (const AdapterClass of BUILTIN_ADAPTERS) api.systems.register(AdapterClass);
}

export async function ready(api) {
  api.systems.activate();
}
