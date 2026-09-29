import { MODULE_ID } from "../../constants.js";
import { log } from "../../logger.js";
import {
  confirm,
  controlledTokens,
  getApi,
  getHandlebarsAppBase,
  notify,
  t,
  targetedTokens,
  templatePath
} from "../context.js";
import { cloneJson } from "../models/form-utils.js";
import { summarizeResolution } from "../models/explain-model.js";
import { pickAnimationInto, readRecipe, renderRecipeForm } from "./recipe-editor.js";

let ItemConfigClass = null;
const openWindows = new Map();

/** `flags["sargas-visual-automation"].disabled` of an item. */
export function isItemDisabled(item) {
  return item?.flags?.[MODULE_ID]?.disabled === true;
}

/** Token to preview from: the first controlled token, else one of the item's actor tokens. */
function previewSource(item) {
  return controlledTokens()[0] ?? item?.actor?.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Lazily defines the per-item recipe editor class.
 * @returns {typeof foundry.applications.api.ApplicationV2 | null}
 */
export function getItemConfigClass() {
  if (ItemConfigClass) return ItemConfigClass;
  const Base = getHandlebarsAppBase();
  if (!Base) return null;

  ItemConfigClass = class SvaItemConfig extends Base {
    /** @param {{item: object}} options */
    constructor({ item, ...options } = {}) {
      const key = String(item?.uuid ?? item?.id ?? "item").replace(/[^\w-]/g, "-");
      super({ id: `sva-item-config-${key}`, ...options });
      this.item = item;
      /** Working copy shown in the form; undefined until first loaded. */
      this.draft = undefined;
    }

    static DEFAULT_OPTIONS = {
      classes: ["sva-app", "sva-item-config"],
      tag: "form",
      window: { title: "SVA.UI.ItemConfig.Title", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
      position: { width: 560, height: 720 },
      form: { handler: SvaItemConfig.#onSubmit, submitOnChange: false, closeOnSubmit: false },
      actions: {
        pickAnimation: SvaItemConfig.#onPickAnimation,
        preview: SvaItemConfig.#onPreview,
        clearRecipe: SvaItemConfig.#onClearRecipe,
        useMatched: SvaItemConfig.#onUseMatched
      }
    };

    static PARTS = {
      main: { template: templatePath("item-config.hbs"), scrollable: [".sva-scroll"] }
    };

    get title() {
      return t("SVA.UI.ItemConfig.TitleFor", { name: this.item?.name ?? "" });
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const automation = getApi()?.automation;
      context.item = { name: this.item?.name ?? "", img: this.item?.img ?? "", type: this.item?.type ?? "" };
      if (!automation) return Object.assign(context, { unavailable: true });

      let stored = null;
      let resolution = null;
      try {
        stored = (await automation.getItemRecipe?.(this.item)) ?? null;
        resolution = (await (automation.explain ?? automation.resolveRecipe)?.call(automation, this.item)) ?? null;
      } catch (err) {
        log.error("Could not resolve the item recipe", err);
      }
      if (this.draft === undefined) this.draft = cloneJson(stored) ?? cloneJson(resolution?.recipe) ?? null;
      this.matched = resolution?.recipe ?? null;

      return Object.assign(context, {
        hasCustom: !!stored,
        noCustom: !stored,
        disabled: isItemDisabled(this.item),
        resolution: summarizeResolution(resolution),
        canUseMatched: !!resolution?.recipe,
        recipeFormHtml: await renderRecipeForm(this.draft, this.id)
      });
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      // The root <form> survives re-renders, so bind once.
      this.element.addEventListener("change", (event) => this.#onChange(event));
    }

    /** Keep the draft in sync; re-render when the preset (and so the option fields) changes. */
    async #onChange(event) {
      const target = event.target;
      if (target?.name === "itemDisabled") {
        await getApi()?.automation?.setItemDisabled?.(this.item, target.checked);
        notify("info", target.checked ? "SVA.UI.ItemConfig.DisabledOn" : "SVA.UI.ItemConfig.DisabledOff");
        return this.render();
      }
      this.draft = readRecipe(this.element, this.draft).recipe;
      if (target?.hasAttribute?.("data-sva-rerender")) this.render();
    }

    static async #onSubmit(_event, form) {
      const { recipe, errors } = readRecipe(form, this.draft);
      if (errors.length) return notify("error", "SVA.UI.Recipe.Invalid", { errors: errors.join("; ") });
      try {
        await getApi().automation.setItemRecipe(this.item, recipe);
        this.draft = recipe;
        notify("info", "SVA.UI.ItemConfig.Saved", { name: this.item?.name ?? "" });
        this.render();
      } catch (err) {
        log.error("Could not save the item recipe", err);
        notify("error", "SVA.UI.ItemConfig.SaveFailed");
      }
    }

    static #onPickAnimation(_event, target) {
      pickAnimationInto(this.element, target.dataset.target);
    }

    static async #onPreview() {
      const automation = getApi()?.automation;
      if (!automation?.preview) return notify("warn", "SVA.UI.ItemConfig.NoAutomation");
      const { recipe, errors } = readRecipe(this.element, this.draft);
      if (errors.length) return notify("error", "SVA.UI.Recipe.Invalid", { errors: errors.join("; ") });
      const sourceToken = previewSource(this.item);
      if (!sourceToken) return notify("warn", "SVA.UI.ItemConfig.NoSourceToken");
      try {
        await automation.preview(recipe, { sourceToken, targetTokens: targetedTokens() });
      } catch (err) {
        log.error("Preview failed", err);
        notify("error", "SVA.UI.ItemConfig.PreviewFailed");
      }
    }

    static async #onClearRecipe() {
      const ok = await confirm("SVA.UI.ItemConfig.ClearTitle", "SVA.UI.ItemConfig.ClearConfirm", {
        name: this.item?.name ?? ""
      });
      if (!ok) return;
      // VERIFY(contract): setItemRecipe(item, null) is assumed to remove the item flag.
      await getApi()?.automation?.setItemRecipe?.(this.item, null);
      this.draft = undefined;
      this.render();
    }

    static #onUseMatched() {
      this.draft = cloneJson(this.matched);
      this.render();
    }

    async close(options) {
      openWindows.delete(this.item?.uuid ?? this.item);
      return super.close(options);
    }
  };
  return ItemConfigClass;
}

/**
 * Open (or focus) the recipe editor for an item.
 * @param {object} item a Foundry Item
 */
export function openItemConfig(item) {
  if (!item) return null;
  const ItemConfig = getItemConfigClass();
  if (!ItemConfig) {
    log.warn("The item recipe editor needs Foundry VTT ApplicationV2");
    return null;
  }
  const key = item.uuid ?? item;
  let app = openWindows.get(key);
  if (!app) {
    app = new ItemConfig({ item });
    openWindows.set(key, app);
  }
  app.render({ force: true });
  app.bringToFront?.();
  return app;
}
