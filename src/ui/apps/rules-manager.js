import { log } from "../../logger.js";
import { randomId } from "../../shared/descriptors.js";
import {
  confirm,
  dragEventData,
  getApi,
  getHandlebarsAppBase,
  notify,
  resolveUuid,
  saveTextFile,
  t,
  templatePath
} from "../context.js";
import { readFormElements } from "../models/form-utils.js";
import { summarizeResolution } from "../models/explain-model.js";
import {
  duplicateRule,
  formToRule,
  inspectImport,
  newRule,
  ruleRows,
  ruleToFormModel,
  toExportText
} from "../models/rules-model.js";
import { getPresets, pickAnimationInto, renderRecipeForm } from "./recipe-editor.js";

export const EXPORT_FILENAME = "sva-world-rules.json";

let RulesManagerClass = null;
let sharedManager = null;

function rulesApi() {
  return getApi()?.automation?.rules ?? null;
}

/**
 * Lazily defines the world rules manager class.
 * @returns {typeof foundry.applications.api.ApplicationV2 | null}
 */
export function getRulesManagerClass() {
  if (RulesManagerClass) return RulesManagerClass;
  const Base = getHandlebarsAppBase();
  if (!Base) return null;

  RulesManagerClass = class SvaRulesManager extends Base {
    constructor(options = {}) {
      super(options);
      /** @type {{rule: object, isNew: boolean}|null} */
      this.editing = null;
      /** Last match-tester result. */
      this.test = null;
      this.rules = [];
    }

    static DEFAULT_OPTIONS = {
      id: "sva-rules-manager",
      classes: ["sva-app", "sva-rules-manager"],
      tag: "div",
      window: { title: "SVA.UI.Rules.Title", icon: "fa-solid fa-list-check", resizable: true },
      position: { width: 1040, height: 700 },
      actions: {
        addRule: SvaRulesManager.#onAddRule,
        editRule: SvaRulesManager.#onEditRule,
        duplicateRule: SvaRulesManager.#onDuplicateRule,
        deleteRule: SvaRulesManager.#onDeleteRule,
        toggleRule: SvaRulesManager.#onToggleRule,
        cancelEdit: SvaRulesManager.#onCancelEdit,
        exportRules: SvaRulesManager.#onExport,
        importRules: SvaRulesManager.#onImportClick,
        pickAnimation: SvaRulesManager.#onPickAnimation,
        clearTest: SvaRulesManager.#onClearTest
      }
    };

    static PARTS = {
      list: { template: templatePath("rules/list.hbs"), scrollable: [".sva-rules-scroll"] },
      editor: { template: templatePath("rules/editor.hbs"), scrollable: [".sva-rule-form"] }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const rules = rulesApi();
      if (!rules) return Object.assign(context, { unavailable: true, rows: [] });
      try {
        this.rules = (await rules.list()) ?? [];
      } catch (err) {
        log.error("Could not list world rules", err);
        this.rules = [];
      }
      Object.assign(context, {
        rows: ruleRows(this.rules),
        editingId: this.editing?.rule?.id ?? null,
        test: this.test
      });
      if (this.editing) {
        context.editing = true;
        context.rule = ruleToFormModel(this.editing.rule, { isNew: this.editing.isNew });
        context.recipeFormHtml = await renderRecipeForm(this.editing.rule.recipe, `${this.id}-recipe`);
      }
      return context;
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;

      const form = root.querySelector("form.sva-rule-form");
      if (form && !form.dataset.svaBound) {
        form.dataset.svaBound = "1";
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          this.#saveForm(form);
        });
        form.addEventListener("change", (event) => {
          this.editing.rule = this.#readForm(form).rule;
          if (event.target?.hasAttribute?.("data-sva-rerender")) this.render({ parts: ["editor"] });
        });
      }

      const drop = root.querySelector(".sva-drop-zone");
      if (drop && !drop.dataset.svaBound) {
        drop.dataset.svaBound = "1";
        drop.addEventListener("dragover", (event) => {
          event.preventDefault();
          drop.classList.add("sva-drag-over");
        });
        drop.addEventListener("dragleave", () => drop.classList.remove("sva-drag-over"));
        drop.addEventListener("drop", (event) => {
          event.preventDefault();
          drop.classList.remove("sva-drag-over");
          this.#onDropItem(event);
        });
      }

      const file = root.querySelector("input.sva-import-input");
      if (file && !file.dataset.svaBound) {
        file.dataset.svaBound = "1";
        file.addEventListener("change", () => this.#importFile(file));
      }
    }

    #readForm(form) {
      return formToRule(readFormElements(form.elements), {
        base: this.editing?.rule ?? null,
        presets: getPresets(),
        generateId: randomId
      });
    }

    async #saveForm(form) {
      const { rule, errors } = this.#readForm(form);
      if (errors.length) return notify("error", "SVA.UI.Rules.Invalid", { errors: errors.join("; ") });
      if (this.editing?.isNew && this.rules.some((r) => r.id === rule.id)) {
        return notify("error", "SVA.UI.Rules.DuplicateId", { id: rule.id });
      }
      try {
        await rulesApi().save(rule);
        notify("info", "SVA.UI.Rules.Saved", { label: rule.label });
        this.editing = { rule, isNew: false };
        this.render();
      } catch (err) {
        log.error("Could not save rule", err);
        notify("error", "SVA.UI.Rules.SaveFailed");
      }
    }

    async #onDropItem(event) {
      const data = dragEventData(event);
      if (data?.type !== "Item") return notify("warn", "SVA.UI.Rules.DropItemOnly");
      const item = await resolveUuid(data.uuid);
      if (!item) return notify("warn", "SVA.UI.Rules.DropItemOnly");
      const automation = getApi()?.automation;
      let result = null;
      try {
        result = (await (automation?.explain ?? automation?.resolveRecipe)?.call(automation, item)) ?? null;
      } catch (err) {
        log.error("Match test failed", err);
      }
      this.test = { itemName: item.name, itemImg: item.img ?? "", ...summarizeResolution(result) };
      this.render({ parts: ["list"] });
    }

    async #importFile(input) {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      const text = await file.text();
      const { count, error } = inspectImport(text);
      if (error) return notify("error", "SVA.UI.Rules.ImportInvalid", { error });
      const ok = await confirm("SVA.UI.Rules.ImportTitle", "SVA.UI.Rules.ImportConfirm", { count, file: file.name });
      if (!ok) return;
      try {
        // VERIFY(contract): importJSON is assumed to accept the JSON text (string).
        await rulesApi().importJSON(text);
        notify("info", "SVA.UI.Rules.Imported", { count });
        this.editing = null;
        this.render();
      } catch (err) {
        log.error("Rule import failed", err);
        notify("error", "SVA.UI.Rules.ImportFailed", { error: err.message });
      }
    }

    #findRule(target) {
      const id = target.closest("[data-rule-id]")?.dataset.ruleId;
      return this.rules.find((r) => r.id === id) ?? null;
    }

    static #onAddRule() {
      this.editing = { rule: newRule(getPresets()), isNew: true };
      this.render();
    }

    static #onEditRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      this.editing = { rule: structuredClone(rule), isNew: false };
      this.render();
    }

    static #onDuplicateRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      this.editing = { rule: duplicateRule(rule, t("SVA.UI.Rules.CopySuffix")), isNew: true };
      this.render();
    }

    static async #onDeleteRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      const ok = await confirm("SVA.UI.Rules.DeleteTitle", "SVA.UI.Rules.DeleteConfirm", {
        label: rule.label || rule.id
      });
      if (!ok) return;
      await rulesApi().delete(rule.id);
      if (this.editing?.rule?.id === rule.id) this.editing = null;
      this.render();
    }

    static async #onToggleRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      await rulesApi().save({ ...rule, enabled: rule.enabled === false });
      this.render({ parts: ["list"] });
    }

    static #onCancelEdit() {
      this.editing = null;
      this.render();
    }

    static async #onExport() {
      const rules = rulesApi();
      if (!rules) return;
      saveTextFile(toExportText(await rules.exportJSON()), EXPORT_FILENAME);
    }

    static #onImportClick() {
      this.element.querySelector("input.sva-import-input")?.click();
    }

    static #onPickAnimation(_event, target) {
      pickAnimationInto(this.element, target.dataset.target);
    }

    static #onClearTest() {
      this.test = null;
      this.render({ parts: ["list"] });
    }

    async close(options) {
      if (sharedManager === this) sharedManager = null;
      return super.close(options);
    }
  };
  return RulesManagerClass;
}

/** Open (or focus) the world rules manager. GM only. */
export function openRulesManager() {
  if (globalThis.game?.user && !game.user.isGM) {
    notify("warn", "SVA.UI.Rules.GMOnly");
    return null;
  }
  const RulesManager = getRulesManagerClass();
  if (!RulesManager) {
    log.warn("The rules manager needs Foundry VTT ApplicationV2");
    return null;
  }
  sharedManager ??= new RulesManager();
  sharedManager.render({ force: true });
  sharedManager.bringToFront?.();
  return sharedManager;
}
