/**
 * User interface (ApplicationV2): api.ui
 * See docs/architecture.md for the contract.
 *
 *   api.ui.openBrowser({ onPick, path })   animation browser (#36)
 */
import { MODULE_ID } from "../constants.js";
import { setApi } from "./context.js";
import { FAVOURITES_SETTING, openBrowser } from "./apps/browser.js";

export const UI_SETTINGS = {
  FAVOURITES: FAVOURITES_SETTING
};

function registerSettings() {
  const settings = globalThis.game?.settings;
  if (!settings?.register) return;
  settings.register(MODULE_ID, UI_SETTINGS.FAVOURITES, {
    name: "SVA.UI.Settings.Favourites.Name",
    hint: "SVA.UI.Settings.Favourites.Hint",
    scope: "client",
    config: false,
    type: Array,
    default: []
  });
}

export function init(api) {
  setApi(api);
  registerSettings();
  api.ui = {
    openBrowser
  };
}
