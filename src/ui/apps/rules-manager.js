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
  hasMatchCriterion,
  inspectImport,
  newRule,
  RULE_SORTS,
  ruleRows,
  ruleToFormModel,
  toExportText
} from "../models/rules-model.js";
import {
  bindJsonValidation,
  getPresets,
  pickAnimationInto,
  pickFileInto,
  renderRecipeForm,
  validateJsonFields
} from "./recipe-editor.js";

export const EXPORT_FILENAME = "sva-world-rules.json";
const SEARCH_DEBOUNCE_MS = 150;

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
      /** Rules list search + sort. */
      this.viewState = { query: "", sort: "priority" };
      /** The editor form has edits that are not saved yet. */
      this.dirty = false;
    }

    #searchTimer = null;

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
        pickSound: SvaRulesManager.#onPickSound,
        clearTest: SvaRulesManager.#onClearTest,
        clearSearch: SvaRulesManager.#onClearSearch
      }
    };

    static PARTS = {
      toolbar: { template: templatePath("rules/toolbar.hbs") },
      list: { template: templatePath("rules/list.hbs"), scrollable: [".sva-rules-scroll"] },
      editor: { template: templatePath("rules/editor.hbs"), scrollable: [".sva-rule-form"] }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const rules = rulesApi();
      Object.assign(context, {
        state: this.viewState,
        noQuery: !this.viewState.query,
        sorts: Object.fromEntries(RULE_SORTS.map((id) => [id, t(`SVA.UI.Rules.Sorts.${id}`)])),
        ruleIdPrefix: `${this.id}-rule`
      });
      if (!rules) return Object.assign(context, { unavailable: true, rows: [] });
      try {
        this.rules = (await rules.list()) ?? [];
      } catch (err) {
        log.error("Could not list world rules", err);
        this.rules = [];
      }
      Object.assign(context, {
        rows: ruleRows(this.rules, this.viewState),
        emptyKey: this.rules.length ? "SVA.UI.Rules.NoMatches" : "SVA.UI.Rules.Empty",
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
        form.addEventListener("input", () => {
          this.dirty = true;
        });
        form.addEventListener("change", (event) => {
          this.dirty = true;
          this.editing.rule = this.#readForm(form).rule;
          if (event.target?.hasAttribute?.("data-sva-rerender")) this.render({ parts: ["editor"] });
        });
        bindJsonValidation(form);
      }
      if (form) validateJsonFields(form);

      const search = root.querySelector("input[name=ruleQuery]");
      if (search && !search.dataset.svaBound) {
        search.dataset.svaBound = "1";
        search.addEventListener("input", () => {
          const clear = root.querySelector(".sva-rules-toolbar [data-action=clearSearch]");
          if (clear) clear.disabled = !search.value;
          clearTimeout(this.#searchTimer);
          this.#searchTimer = setTimeout(() => {
            this.viewState.query = search.value;
            this.render({ parts: ["list"] });
          }, SEARCH_DEBOUNCE_MS);
        });
      }
      const sort = root.querySelector("select[name=ruleSort]");
      if (sort && !sort.dataset.svaBound) {
        sort.dataset.svaBound = "1";
        sort.addEventListener("change", () => {
          this.viewState.sort = sort.value;
          this.render({ parts: ["list"] });
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

    /** Start editing a rule (or stop, with null) and forget the unsaved-edits flag. */
    #setEditing(editing) {
      this.editing = editing;
      this.dirty = false;
    }

    /**
     * Ask before throwing away unsaved edits of the editor form.
     * @returns {Promise<boolean>} true when it is fine to replace the editor content
     */
    async confirmDiscard() {
      if (!this.editing || !this.dirty) return true;
      return confirm("SVA.UI.Rules.UnsavedTitle", "SVA.UI.Rules.UnsavedConfirm", {
        label: this.editing.rule?.label || this.editing.rule?.id || t("SVA.UI.Rules.NewRule")
      });
    }

    async #saveForm(form) {
      const { rule, errors } = this.#readForm(form);
      if (!hasMatchCriterion(rule.match)) return notify("warn", "SVA.UI.Rules.NeedMatch");
      if (errors.length) return notify("error", "SVA.UI.Rules.Invalid", { errors: errors.join("; ") });
      if (this.editing?.isNew && this.rules.some((r) => r.id === rule.id)) {
        return notify("error", "SVA.UI.Rules.DuplicateId", { id: rule.id });
      }
      try {
        await rulesApi().save(rule);
        notify("info", "SVA.UI.Rules.Saved", { label: rule.label });
        this.#setEditing({ rule, isNew: false });
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
        this.#setEditing(null);
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

    static async #onAddRule() {
      if (!(await this.confirmDiscard())) return;
      this.#setEditing({ rule: newRule(getPresets()), isNew: true });
      this.render();
    }

    static async #onEditRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      // Already editing this rule: keep the edits.
      if (this.dirty && !this.editing?.isNew && this.editing?.rule?.id === rule.id) return;
      if (!(await this.confirmDiscard())) return;
      this.#setEditing({ rule: structuredClone(rule), isNew: false });
      this.render();
    }

    static async #onDuplicateRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      if (!(await this.confirmDiscard())) return;
      this.#setEditing({ rule: duplicateRule(rule, t("SVA.UI.Rules.CopySuffix")), isNew: true });
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
      if (this.editing?.rule?.id === rule.id) this.#setEditing(null);
      this.render();
    }

    static async #onToggleRule(_event, target) {
      const rule = this.#findRule(target);
      if (!rule) return;
      await rulesApi().save({ ...rule, enabled: rule.enabled === false });
      this.render({ parts: ["list"] });
    }

    static async #onCancelEdit() {
      if (!(await this.confirmDiscard())) return;
      this.#setEditing(null);
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

    static #onPickSound(_event, target) {
      if (!pickFileInto(this.element, target.dataset.target, { type: "audio" })) {
        notify("warn", "SVA.UI.Recipe.NoFilePicker");
      }
    }

    static #onClearTest() {
      this.test = null;
      this.render({ parts: ["list"] });
    }

    static #onClearSearch(_event, target) {
      clearTimeout(this.#searchTimer);
      this.viewState.query = "";
      const input = this.element?.querySelector("input[name=ruleQuery]");
      if (input) input.value = "";
      if (target) target.disabled = true;
      this.render({ parts: ["list"] });
    }

    async close(options) {
      clearTimeout(this.#searchTimer);
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
