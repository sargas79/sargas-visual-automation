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
import {
  FILTERS,
  buildRow,
  changedRecipe,
  groupRows,
  isActorItem,
  pickSourceToken,
  resolveForOverview,
  summarize
} from "../models/overview-model.js";

/** World setting holding the world rules (owned by the automation area). */
const RULES_SETTING = `${MODULE_ID}.automationRules`;
const SEARCH_DEBOUNCE_MS = 150;
const REFRESH_DEBOUNCE_MS = 100;

let OverviewClass = null;
const openWindows = new Map();

/** Key of an actor (uuid, so synthetic token actors get their own window). */
function actorKey(actor) {
  return actor?.uuid ?? actor?.id ?? actor;
}

/** May the current user change this item's flags? */
function canEdit(item) {
  const user = globalThis.game?.user;
  return !!(user?.isGM || item?.isOwner);
}

/**
 * Lazily defines the actor animation overview class (#74).
 * @returns {typeof foundry.applications.api.ApplicationV2 | null}
 */
export function getActorOverviewClass() {
  if (OverviewClass) return OverviewClass;
  const Base = getHandlebarsAppBase();
  if (!Base) return null;

  OverviewClass = class SvaActorOverview extends Base {
    /** @param {{actor: object}} options */
    constructor({ actor, ...options } = {}) {
      const key = String(actorKey(actor) ?? "actor").replace(/[^\w-]/g, "-");
      super({ id: `sva-actor-overview-${key}`, ...options });
      this.actor = actor;
      this.state = { query: "", filter: "all", showAll: false };
      /** Cached rows; null = rebuild on next render. */
      this.rows = null;
    }

    #hooks = [];
    #searchTimer = null;
    #refreshTimer = null;

    static DEFAULT_OPTIONS = {
      classes: ["sva-app", "sva-overview"],
      tag: "div",
      window: { title: "SVA.UI.Overview.Title", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
      position: { width: 760, height: 640 },
      actions: {
        preview: SvaActorOverview.#onPreview,
        change: SvaActorOverview.#onChange,
        edit: SvaActorOverview.#onEdit,
        reset: SvaActorOverview.#onReset,
        toggleDisabled: SvaActorOverview.#onToggleDisabled,
        clearSearch: SvaActorOverview.#onClearSearch
      }
    };

    static PARTS = {
      toolbar: { template: templatePath("overview/toolbar.hbs") },
      list: { template: templatePath("overview/list.hbs"), scrollable: [".sva-overview-scroll"] }
    };

    get title() {
      return t("SVA.UI.Overview.TitleFor", { name: this.actor?.name ?? "" });
    }

    /** Explain every item of the actor (cached until something changes). */
    buildRows() {
      const api = getApi();
      const automation = api?.automation;
      if (!automation?.explain) return [];
      const explain = (item, opts) => automation.explain(item, opts);
      const rows = [];
      for (const item of this.actor?.items ?? []) {
        try {
          const resolution = resolveForOverview(explain, item);
          const hasOwnRecipe = !!item?.flags?.[MODULE_ID]?.recipe;
          const row = buildRow(item, resolution, { db: api.db, presets: automation.presets, hasOwnRecipe });
          row.canEdit = canEdit(item);
          rows.push(row);
        } catch (err) {
          log.warn(`Could not explain the animation of "${item?.name}"`, err);
        }
      }
      return rows;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const api = getApi();
      const db = api?.db;
      if (db?.ready && typeof db.ready.then === "function") await db.ready;
      context.actor = { name: this.actor?.name ?? "", img: this.actor?.img ?? "" };
      context.state = this.state;
      context.filters = Object.fromEntries(FILTERS.map((id) => [id, t(`SVA.UI.Overview.Filters.${id}`)]));
      if (!api?.automation?.explain) return Object.assign(context, { unavailable: true, groups: [] });
      this.rows ??= this.buildRows();
      const groups = groupRows(this.rows, this.state);
      return Object.assign(context, {
        groups,
        empty: !groups.length,
        counts: summarize(this.rows, this.state),
        dbUnavailable: db?.available === false
      });
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.#watch();
      // Broken thumbnails fall back to the placeholder icon (error events don't bubble: capture).
      this.element?.addEventListener(
        "error",
        (event) => {
          const img = event.target;
          if (img?.matches?.(".sva-overview-thumb img"))
            img.closest(".sva-overview-thumb")?.classList.add("sva-thumb-none");
        },
        true
      );
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const input = this.element?.querySelector("input[name=query]");
      if (input && !input.dataset.svaBound) {
        input.dataset.svaBound = "1";
        input.addEventListener("input", () => {
          clearTimeout(this.#searchTimer);
          this.#searchTimer = setTimeout(() => {
            this.state.query = input.value;
            this.render({ parts: ["list"] });
          }, SEARCH_DEBOUNCE_MS);
        });
      }
      const filter = this.element?.querySelector("select[name=filter]");
      if (filter && !filter.dataset.svaBound) {
        filter.dataset.svaBound = "1";
        filter.addEventListener("change", () => {
          this.state.filter = filter.value;
          this.render();
        });
      }
      const showAll = this.element?.querySelector("input[name=showAll]");
      if (showAll && !showAll.dataset.svaBound) {
        showAll.dataset.svaBound = "1";
        showAll.addEventListener("change", () => {
          this.state.showAll = showAll.checked;
          this.render();
        });
      }
    }

    /** Rebuild rows and re-render soon (several hooks usually fire together). */
    refresh() {
      this.rows = null;
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = setTimeout(() => {
        if (this.rendered) this.render();
      }, REFRESH_DEBOUNCE_MS);
    }

    /** Hook handlers, exposed for tests. */
    onItemChanged(item) {
      if (isActorItem(this.actor, item)) this.refresh();
    }

    onSettingChanged(setting) {
      if (setting?.key === RULES_SETTING) this.refresh();
    }

    #watch() {
      const hooks = globalThis.Hooks;
      if (!hooks?.on || this.#hooks.length) return;
      const onItem = (item) => this.onItemChanged(item);
      const onSetting = (setting) => this.onSettingChanged(setting);
      const onDeleteActor = (actor) => {
        if (actorKey(actor) === actorKey(this.actor)) this.close();
      };
      // VERIFY(v14): embedded item changes of synthetic (unlinked token) actors fire the Item hooks
      // with `item.parent` = the synthetic actor; world rule changes fire `updateSetting` (Setting document).
      this.#hooks = [
        ["createItem", hooks.on("createItem", onItem)],
        ["updateItem", hooks.on("updateItem", onItem)],
        ["deleteItem", hooks.on("deleteItem", onItem)],
        ["createSetting", hooks.on("createSetting", onSetting)],
        ["updateSetting", hooks.on("updateSetting", onSetting)],
        ["deleteActor", hooks.on("deleteActor", onDeleteActor)]
      ];
    }

    #unwatch() {
      for (const [name, id] of this.#hooks) globalThis.Hooks?.off?.(name, id);
      this.#hooks = [];
    }

    /** Row + item of an action target. */
    rowOf(target) {
      const id = target?.closest?.("[data-item-id]")?.dataset.itemId;
      const row = this.rows?.find((r) => r.id === id) ?? null;
      const item = id ? (this.actor?.items?.get?.(id) ?? null) : null;
      return { row, item };
    }

    /** Preview the row's recipe from a token of this actor to the current targets. */
    async previewRow(row) {
      const automation = getApi()?.automation;
      if (!automation?.preview) return notify("warn", "SVA.UI.ItemConfig.NoAutomation");
      if (!row?.recipe) return notify("warn", "SVA.UI.Overview.NothingToPreview", { name: row?.name ?? "" });
      const sourceToken = pickSourceToken(this.actor, controlledTokens(), this.actor?.getActiveTokens?.() ?? []);
      if (!sourceToken) return notify("warn", "SVA.UI.Overview.NoSourceToken", { name: this.actor?.name ?? "" });
      try {
        await automation.preview(row.recipe, {
          sourceToken,
          targetTokens: targetedTokens(),
          descriptors: row.descriptors,
          eventType: row.eventType ?? undefined
        });
      } catch (err) {
        log.error("Preview failed", err);
        notify("error", "SVA.UI.ItemConfig.PreviewFailed");
      }
    }

    /** Save a picked animation as the item's recipe. */
    async changeAnimation(item, row, path) {
      if (!path || !item) return;
      try {
        await getApi().automation.setItemRecipe(item, changedRecipe(row, path));
        notify("info", "SVA.UI.Overview.Changed", { name: item.name ?? "", path });
        this.refresh();
      } catch (err) {
        log.error("Could not save the item recipe", err);
        notify("error", "SVA.UI.ItemConfig.SaveFailed");
      }
    }

    static async #onPreview(_event, target) {
      const { row } = this.rowOf(target);
      return this.previewRow(row);
    }

    static #onChange(_event, target) {
      const { row, item } = this.rowOf(target);
      if (!row || !item) return;
      const open = getApi()?.ui?.openBrowser;
      if (typeof open !== "function") return;
      open({ path: row.animation || undefined, onPick: (path) => this.changeAnimation(item, row, path) });
    }

    static #onEdit(_event, target) {
      const { item } = this.rowOf(target);
      if (item) getApi()?.ui?.openItemConfig?.(item);
    }

    static async #onReset(_event, target) {
      const { item } = this.rowOf(target);
      if (!item) return;
      const ok = await confirm("SVA.UI.ItemConfig.ClearTitle", "SVA.UI.ItemConfig.ClearConfirm", {
        name: item.name ?? ""
      });
      if (!ok) return;
      await getApi()?.automation?.setItemRecipe?.(item, null);
      this.refresh();
    }

    static async #onToggleDisabled(_event, target) {
      const { row, item } = this.rowOf(target);
      if (!item || !row) return;
      const disabled = !row.disabled;
      await getApi()?.automation?.setItemDisabled?.(item, disabled);
      notify("info", disabled ? "SVA.UI.ItemConfig.DisabledOn" : "SVA.UI.ItemConfig.DisabledOff");
      this.refresh();
    }

    static #onClearSearch() {
      this.state.query = "";
      const input = this.element?.querySelector("input[name=query]");
      if (input) input.value = "";
      this.render({ parts: ["list"] });
    }

    async close(options) {
      this.#unwatch();
      clearTimeout(this.#searchTimer);
      clearTimeout(this.#refreshTimer);
      openWindows.delete(actorKey(this.actor));
      return super.close(options);
    }
  };
  return OverviewClass;
}

/**
 * Open (or focus) the animation overview of an actor.
 * @param {object} actor a Foundry Actor (a token's synthetic actor works too)
 */
export function openActorOverview(actor) {
  if (!actor) {
    notify("warn", "SVA.UI.Overview.NoActor");
    return null;
  }
  const Overview = getActorOverviewClass();
  if (!Overview) {
    log.warn("The animation overview needs Foundry VTT ApplicationV2");
    return null;
  }
  const key = actorKey(actor);
  let app = openWindows.get(key);
  if (!app) {
    app = new Overview({ actor });
    openWindows.set(key, app);
  } else app.rows = null;
  app.render({ force: true });
  app.bringToFront?.();
  return app;
}
