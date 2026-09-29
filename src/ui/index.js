/**
 * User interface (ApplicationV2): api.ui
 * See docs/architecture.md for the contract.
 *
 *   api.ui.openBrowser({ onPick, path })   animation browser (#36)
 *   api.ui.openItemConfig(item)            per-item recipe editor (#37)
 *   api.ui.openRulesManager()              world rules manager (#38)
 */
import { MODULE_ID } from "../constants.js";
import { setApi } from "./context.js";
import { FAVOURITES_SETTING, openBrowser } from "./apps/browser.js";
import { openItemConfig } from "./apps/item-config.js";
import { openRulesManager } from "./apps/rules-manager.js";

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
    openBrowser,
    openItemConfig,
    openRulesManager
  };
}
