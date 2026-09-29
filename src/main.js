import { MODULE_ID } from "./constants.js";
import { createApi } from "./api.js";
import { log } from "./logger.js";
import { registerSettings, getSetting, SETTINGS } from "./settings.js";

Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  registerSettings();
  log.debugEnabled = getSetting(SETTINGS.DEBUG);
  module.api = createApi(module.version);
  log.info(`Initializing v${module.version}`);
});

Hooks.once("ready", () => {
  const api = game.modules.get(MODULE_ID).api;
  api.ready = true;
  Hooks.callAll(`${MODULE_ID}.ready`, api);
  log.info("Ready");
});
