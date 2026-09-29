import { MODULE_ID } from "../../constants.js";
import { log } from "../../logger.js";
import { getHandlebarsAppBase, notify, templatePath } from "../context.js";
import { readFormElements } from "../models/form-utils.js";
import { collectModuleSettings, diffSettings, groupFields } from "../models/settings-model.js";
import { openBrowser } from "./browser.js";
import { openRulesManager } from "./rules-manager.js";

let SettingsPanelClass = null;

/** SVA settings the current user may edit. */
export function editableSettings() {
  return collectModuleSettings(globalThis.game?.settings?.settings, {
    moduleId: MODULE_ID,
    isGM: !!globalThis.game?.user?.isGM
  });
}

function currentValue(setting) {
  return game.settings.get(setting.namespace, setting.key);
}

/**
 * Lazily defines the grouped settings panel class (a settings submenu).
 * @returns {typeof foundry.applications.api.ApplicationV2 | null}
 */
export function getSettingsPanelClass() {
  if (SettingsPanelClass) return SettingsPanelClass;
  const Base = getHandlebarsAppBase();
  if (!Base) return null;

  SettingsPanelClass = class SvaSettingsPanel extends Base {
    static DEFAULT_OPTIONS = {
      id: "sva-settings-panel",
      classes: ["sva-app", "sva-settings-panel"],
      tag: "form",
      window: { title: "SVA.UI.SettingsPanel.Title", icon: "fa-solid fa-sliders", resizable: true },
      position: { width: 600, height: 680 },
      form: { handler: SvaSettingsPanel.#onSubmit, submitOnChange: false, closeOnSubmit: true },
      actions: {
        openBrowser: () => openBrowser(),
        openRules: () => openRulesManager()
      }
    };

    static PARTS = {
      main: { template: templatePath("settings-panel.hbs"), scrollable: [".sva-scroll"] }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      return Object.assign(context, {
        isGM: !!game.user?.isGM,
        groups: groupFields(editableSettings(), currentValue)
      });
    }

    static async #onSubmit(_event, form) {
      const settings = editableSettings();
      const changes = diffSettings(settings, readFormElements(form.elements), currentValue);
      let reload = false;
      for (const { setting, value } of changes) {
        try {
          await game.settings.set(setting.namespace, setting.key, value);
          reload ||= setting.requiresReload;
        } catch (err) {
          log.error(`Could not save setting ${setting.id}`, err);
          notify("error", "SVA.UI.SettingsPanel.SaveFailed", { name: setting.key });
        }
      }
      if (changes.length) notify("info", "SVA.UI.SettingsPanel.Saved", { count: changes.length });
      if (reload) {
        // VERIFY(v14): SettingsConfig.reloadConfirm location/signature.
        const SettingsConfig = foundry.applications?.settings?.SettingsConfig;
        if (SettingsConfig?.reloadConfirm) {
          await SettingsConfig.reloadConfirm({ world: changes.some((c) => c.setting.scope === "world") });
        } else notify("warn", "SVA.UI.SettingsPanel.ReloadRequired");
      }
    }
  };
  return SettingsPanelClass;
}

/**
 * A settings-menu entry must be an application class that Foundry instantiates
 * and renders. This builds one that just opens a shared window instead.
 * @param {() => void} open
 */
export function createMenuLauncher(open) {
  const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!ApplicationV2) return null;
  return class SvaMenuLauncher extends ApplicationV2 {
    render() {
      open();
      return this;
    }
  };
}

/** Open the grouped settings panel. */
export function openSettingsPanel() {
  const Panel = getSettingsPanelClass();
  if (!Panel) return null;
  const app = new Panel();
  app.render({ force: true });
  return app;
}
