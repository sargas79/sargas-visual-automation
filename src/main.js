import { MODULE_ID } from "./constants.js";
import { createApi } from "./api.js";
import { log } from "./logger.js";
import { registerSettings, getSetting, SETTINGS } from "./settings.js";
import * as db from "./db/index.js";
import * as engine from "./engine/index.js";
import * as net from "./net/index.js";
import * as sequence from "./sequence/index.js";
import * as effects from "./effects/index.js";
import * as automation from "./automation/index.js";
import * as ui from "./ui/index.js";

/** Areas in dependency order. Each may export init/setup/ready(api). */
export const AREAS = [db, engine, net, sequence, effects, automation, ui];

Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  registerSettings();
  log.debugEnabled = getSetting(SETTINGS.DEBUG);
  const api = createApi(module.version);
  module.api = api;
  globalThis.SVA = api;
  for (const area of AREAS) area.init?.(api);
  log.info(`Initializing v${module.version}`);
});

Hooks.once("setup", () => {
  const api = game.modules.get(MODULE_ID).api;
  for (const area of AREAS) area.setup?.(api);
});

Hooks.once("ready", async () => {
  const api = game.modules.get(MODULE_ID).api;
  for (const area of AREAS) {
    try {
      await area.ready?.(api);
    } catch (err) {
      log.error("Area failed to start", err);
    }
  }
  api.ready = true;
  Hooks.callAll(`${MODULE_ID}.ready`, api);
  log.info("Ready");
});
