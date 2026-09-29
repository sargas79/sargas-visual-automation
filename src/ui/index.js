/**
 * User interface (ApplicationV2): api.ui
 * See docs/architecture.md for the contract.
 *
 *   api.ui.openBrowser({ onPick, path })   animation browser (#36)
 *   api.ui.openItemConfig(item)            per-item recipe editor (#37)
 *   api.ui.openRulesManager()              world rules manager (#38)
 *   api.ui.openSettings()                  grouped settings panel (#39)
 *
 * Settings submenus and the scene-control button are registered in init.
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import { setApi } from "./context.js";
import { FAVOURITES_SETTING, openBrowser } from "./apps/browser.js";
import { openItemConfig } from "./apps/item-config.js";
import { openRulesManager } from "./apps/rules-manager.js";
import { createMenuLauncher, getSettingsPanelClass, openSettingsPanel } from "./apps/settings-panel.js";
import { addSceneControlTool } from "./models/settings-model.js";

export const UI_SETTINGS = {
  FAVOURITES: FAVOURITES_SETTING,
  SCENE_CONTROL: "uiSceneControl"
};

export const UI_MENUS = {
  SETTINGS: "uiSettingsPanel",
  BROWSER: "uiBrowser",
  RULES: "uiRulesManager"
};

function registerSettings(settings) {
  settings.register(MODULE_ID, UI_SETTINGS.FAVOURITES, {
    name: "SVA.UI.Settings.Favourites.Name",
    hint: "SVA.UI.Settings.Favourites.Hint",
    scope: "client",
    config: false,
    type: Array,
    default: []
  });
  settings.register(MODULE_ID, UI_SETTINGS.SCENE_CONTROL, {
    name: "SVA.UI.Settings.SceneControl.Name",
    hint: "SVA.UI.Settings.SceneControl.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    // VERIFY(v14): re-render the scene controls so the tool appears/disappears.
    onChange: () => globalThis.ui?.controls?.render?.({ reset: true })
  });
}

function registerMenus(settings) {
  if (typeof settings.registerMenu !== "function") return;
  const menus = [
    [UI_MENUS.SETTINGS, "Settings", "fa-solid fa-sliders", getSettingsPanelClass(), false],
    [UI_MENUS.BROWSER, "Browser", "fa-solid fa-film", createMenuLauncher(() => openBrowser()), false],
    [UI_MENUS.RULES, "Rules", "fa-solid fa-list-check", createMenuLauncher(() => openRulesManager()), true]
  ];
  for (const [key, name, icon, type, restricted] of menus) {
    if (!type) continue;
    settings.registerMenu(MODULE_ID, key, {
      name: `SVA.UI.Menus.${name}.Name`,
      label: `SVA.UI.Menus.${name}.Label`,
      hint: `SVA.UI.Menus.${name}.Hint`,
      icon,
      type,
      restricted
    });
  }
}

/** Is the scene-control browser button enabled for this client? */
function sceneControlEnabled() {
  try {
    return game.settings.get(MODULE_ID, UI_SETTINGS.SCENE_CONTROL) !== false;
  } catch {
    return false;
  }
}

/** Hook handler: add an "Animation browser" button to the token controls. */
export function onGetSceneControlButtons(controls) {
  if (!sceneControlEnabled()) return;
  addSceneControlTool(controls, "tokens", {
    name: "svaBrowser",
    title: "SVA.UI.Browser.Title",
    icon: "fa-solid fa-film",
    button: true,
    visible: true,
    // VERIFY(v14): button tools fire onChange(event, active) when clicked.
    onChange: () => openBrowser()
  });
}

export function init(api) {
  setApi(api);
  api.ui = {
    openBrowser,
    openItemConfig,
    openRulesManager,
    openSettings: openSettingsPanel
  };
  const settings = globalThis.game?.settings;
  if (settings?.register) {
    registerSettings(settings);
    try {
      registerMenus(settings);
    } catch (err) {
      log.error("Could not register settings menus", err);
    }
  }
  globalThis.Hooks?.on?.("getSceneControlButtons", onGetSceneControlButtons);
}
