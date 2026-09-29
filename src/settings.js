import { MODULE_ID } from "./constants.js";
import { log } from "./logger.js";

export const SETTINGS = {
  DEBUG: "debug"
};

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "SVA.Settings.Debug.Name",
    hint: "SVA.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => {
      log.debugEnabled = value;
    }
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
