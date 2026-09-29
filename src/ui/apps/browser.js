import { MODULE_ID } from "../../constants.js";
import { log } from "../../logger.js";
import { playOnTokens } from "../actions.js";
import {
  controlledTokens,
  copyText,
  getApi,
  getHandlebarsAppBase,
  notify,
  t,
  targetedTokens,
  templatePath
} from "../context.js";
import { frameCapture } from "../frame-capture.js";
import {
  breadcrumbs,
  createChildCache,
  DEFAULT_PAGE_SIZE,
  expandTo,
  favouriteEntries,
  flattenTree,
  normalizeQuery,
  paginate,
  ROOT,
  searchPage,
  sortEntries,
  toCards,
  toggleFavourite,
  toggleInSet
} from "../models/browser-model.js";

export const FAVOURITES_SETTING = "uiFavourites";
const SEARCH_DEBOUNCE_MS = 250;
const PREVIEW_DELAY_MS = 150;

/** Read the favourites client setting (empty when unavailable). */
export function getFavourites() {
  try {
    const value = game.settings.get(MODULE_ID, FAVOURITES_SETTING);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let BrowserClass = null;
let sharedBrowser = null;

/** Path of the card / tree row an action element belongs to. */
function pathOf(target) {
  return target.closest("[data-path]")?.dataset.path ?? null;
}

/**
 * Lazily defines the ApplicationV2 class (Foundry globals only exist at runtime).
 * @returns {typeof foundry.applications.api.ApplicationV2 | null}
 */
export function getBrowserClass() {
  if (BrowserClass) return BrowserClass;
  const Base = getHandlebarsAppBase();
  if (!Base) return null;

  BrowserClass = class SvaAnimationBrowser extends Base {
    /**
     * @param {{onPick?: (path: string) => void, path?: string}} [options]
     *   onPick: picker mode, called with the chosen database path (the window then closes).
     *   path: path to reveal when opening.
     */
    constructor({ onPick, path, ...options } = {}) {
      super(options);
      this.onPick = typeof onPick === "function" ? onPick : null;
      this.viewState = { query: "", page: 0, selected: null, expanded: new Set(), favourites: false };
      if (path) this.reveal(path);
    }

    static DEFAULT_OPTIONS = {
      id: "sva-browser-{id}",
      classes: ["sva-app", "sva-browser"],
      tag: "div",
      window: { title: "SVA.UI.Browser.Title", icon: "fa-solid fa-film", resizable: true },
      position: { width: 920, height: 660 },
      actions: {
        toggleNode: SvaAnimationBrowser.#onToggleNode,
        selectNode: SvaAnimationBrowser.#onSelectNode,
        play: SvaAnimationBrowser.#onPlay,
        copy: SvaAnimationBrowser.#onCopy,
        favourite: SvaAnimationBrowser.#onFavourite,
        pick: SvaAnimationBrowser.#onPick,
        pagePrev: SvaAnimationBrowser.#onPagePrev,
        pageNext: SvaAnimationBrowser.#onPageNext,
        showFavourites: SvaAnimationBrowser.#onShowFavourites,
        clearSearch: SvaAnimationBrowser.#onClearSearch
      }
    };

    static PARTS = {
      header: { template: templatePath("browser/header.hbs") },
      tree: { template: templatePath("browser/tree.hbs"), scrollable: [""] },
      grid: { template: templatePath("browser/grid.hbs"), scrollable: [".sva-grid"] }
    };

    #children = null;
    #root = ROOT;
    #searchTimer = null;
    #thumbObserver = null;
    #awaitingThumbnails = false;

    get title() {
      return this.onPick ? t("SVA.UI.Browser.PickTitle") : super.title;
    }

    /** Select the branch containing `path` and expand the tree down to it. */
    reveal(path) {
      const parts = String(path).split(".");
      const branch = parts.length > 2 ? parts.slice(0, -1).join(".") : parts.join(".");
      this.viewState.selected = branch;
      this.viewState.expanded = expandTo(this.viewState.expanded, `${branch}.x`);
      this.viewState.page = 0;
    }

    /** Cached `api.db.list`. */
    #listChildren(db) {
      if (!this.#children) {
        this.#children = createChildCache((p) => db.list(p));
        if (!this.#children(ROOT).length && this.#children("").length) this.#root = "";
      }
      return this.#children;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const api = getApi();
      const db = api?.db;
      if (db?.ready && typeof db.ready.then === "function") await db.ready;
      Object.assign(context, {
        query: this.viewState.query,
        pickMode: !!this.onPick,
        showFavourites: this.viewState.favourites,
        favouritesClass: this.viewState.favourites ? "sva-toggle sva-active" : "sva-toggle",
        provider: db?.provider ?? ""
      });
      if (!db || db.available === false || typeof db.list !== "function") {
        return Object.assign(context, { unavailable: true, rows: [], cards: [] });
      }

      const list = this.#listChildren(db);
      context.rows = flattenTree(list, {
        root: this.#root,
        expanded: this.viewState.expanded,
        selected: this.viewState.selected
      });

      const favourites = getFavourites();
      const query = normalizeQuery(this.viewState.query);
      let page;
      if (query) {
        page = searchPage(db, query, this.viewState.page, DEFAULT_PAGE_SIZE);
        context.heading = t("SVA.UI.Browser.SearchResults", { query });
        context.emptyKey = "SVA.UI.Browser.NoResults";
      } else if (this.viewState.favourites) {
        const entries = favouriteEntries(favourites, (p) => db.getEntry?.(p));
        page = paginate(entries, this.viewState.page, DEFAULT_PAGE_SIZE);
        context.heading = t("SVA.UI.Browser.Favourites");
        context.emptyKey = "SVA.UI.Browser.NoFavourites";
      } else {
        const branch = this.viewState.selected ?? this.#root;
        page = paginate(sortEntries(list(branch)), this.viewState.page, DEFAULT_PAGE_SIZE);
        context.crumbs = breadcrumbs(branch);
        context.emptyKey = "SVA.UI.Browser.EmptyBranch";
      }
      this.viewState.page = page.page;

      context.cards = toCards(page.items, {
        favourites,
        pickMode: !!this.onPick,
        resolveThumbnail: (p) => db.resolve?.(p)?.thumbnail ?? null
      });
      // Frames captured earlier this session stand in for missing thumbnails.
      const captured = frameCapture();
      for (const card of context.cards) {
        if (card.isLeaf && !card.thumbnail) card.thumbnail = captured.peek(card.path) ?? null;
      }
      this.#refreshWhenIndexed(db);
      context.pager = {
        hasPrev: page.hasPrev,
        hasNext: page.hasNext,
        label: page.pageCount
          ? t("SVA.UI.Browser.PageOf", { page: page.page + 1, pages: page.pageCount })
          : t("SVA.UI.Browser.Page", { page: page.page + 1 })
      };
      return context;
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;
      const input = root.querySelector(".sva-browser-header input[name=query]");
      if (input && !input.dataset.svaBound) {
        input.dataset.svaBound = "1";
        input.addEventListener("input", () => {
          clearTimeout(this.#searchTimer);
          this.#searchTimer = setTimeout(() => {
            this.viewState.query = input.value;
            this.viewState.page = 0;
            this.render({ parts: ["grid"] });
          }, SEARCH_DEBOUNCE_MS);
        });
      }
      this.#watchThumbnails(root);
      for (const card of root.querySelectorAll(".sva-card")) {
        if (card.dataset.svaBound) continue;
        card.dataset.svaBound = "1";
        card.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", card.dataset.path);
        });
        if (card.dataset.leaf !== "true") continue;
        card.addEventListener("pointerenter", () => this.#startPreview(card));
        card.addEventListener("pointerleave", () => this.#stopPreview(card));
        card.addEventListener("dblclick", (event) => {
          if (this.onPick) SvaAnimationBrowser.#onPick.call(this, event, card);
          else SvaAnimationBrowser.#onPlay.call(this, event, card);
        });
      }
    }

    /** Re-render the grid once a thumbnail index that is being built is ready. */
    #refreshWhenIndexed(db) {
      const thumbnails = db?.thumbnails;
      if (thumbnails?.status !== "building" || this.#awaitingThumbnails) return;
      this.#awaitingThumbnails = true;
      Promise.resolve(thumbnails.ready).then((ok) => {
        this.#awaitingThumbnails = false;
        if (ok && this.rendered) this.render({ parts: ["grid"] });
      });
    }

    /**
     * Cards without a thumbnail (or whose thumbnail fails to load) get a captured
     * video frame once they scroll into view; the placeholder stays otherwise.
     */
    #watchThumbnails(root) {
      this.#thumbObserver?.disconnect();
      this.#thumbObserver = null;
      const grid = root.querySelector(".sva-grid");
      if (!grid) return;
      const missing = [];
      for (const card of grid.querySelectorAll(".sva-card-leaf")) {
        const img = card.querySelector(".sva-card-media img");
        if (!img) {
          missing.push(card);
          continue;
        }
        if (img.dataset.svaWatched) continue;
        img.dataset.svaWatched = "1";
        img.addEventListener(
          "error",
          () => {
            img.remove();
            this.#captureCard(card);
          },
          { once: true }
        );
      }
      if (!missing.length) return;
      if (typeof IntersectionObserver !== "function") {
        for (const card of missing) this.#captureCard(card);
        return;
      }
      this.#thumbObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            this.#captureCard(entry.target);
          }
        },
        { root: grid, rootMargin: "150px" }
      );
      for (const card of missing) this.#thumbObserver.observe(card);
    }

    async #captureCard(card) {
      const media = card.querySelector(".sva-card-media");
      const path = card.dataset.path;
      if (!media || !path || media.querySelector("img")) return;
      let file = null;
      try {
        file = getApi()?.db?.resolve?.(path)?.file ?? null;
      } catch (err) {
        log.debug("Thumbnail resolve failed", err);
      }
      if (!file) return media.classList.add("sva-thumb-none");
      media.classList.add("sva-thumb-pending");
      const url = await frameCapture().capture(path, file);
      media.classList.remove("sva-thumb-pending");
      if (!card.isConnected || media.querySelector("img")) return;
      if (!url) return media.classList.add("sva-thumb-none");
      const img = document.createElement("img");
      Object.assign(img, { src: url, alt: "" });
      media.prepend(img);
    }

    /** Hover preview: swap the thumbnail for a muted looping video. */
    #startPreview(card) {
      card._svaTimer = setTimeout(() => {
        let file = null;
        try {
          file = getApi()?.db?.resolve?.(card.dataset.path)?.file ?? null;
        } catch (err) {
          log.debug("Preview resolve failed", err);
        }
        const media = card.querySelector(".sva-card-media");
        if (!file || !media || media.querySelector("video")) return;
        const video = document.createElement("video");
        Object.assign(video, { src: file, muted: true, loop: true, autoplay: true, playsInline: true });
        video.className = "sva-card-video";
        media.append(video);
        video.play?.().catch(() => {});
      }, PREVIEW_DELAY_MS);
    }

    #stopPreview(card) {
      clearTimeout(card._svaTimer);
      for (const video of card.querySelectorAll("video")) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
    }

    async close(options) {
      clearTimeout(this.#searchTimer);
      this.#thumbObserver?.disconnect();
      this.#thumbObserver = null;
      if (sharedBrowser === this) sharedBrowser = null;
      return super.close(options);
    }

    static #onToggleNode(_event, target) {
      const path = pathOf(target);
      if (!path) return;
      this.viewState.expanded = toggleInSet(this.viewState.expanded, path);
      this.render({ parts: ["tree"] });
    }

    static #onSelectNode(_event, target) {
      const path = pathOf(target);
      if (path === null) return;
      Object.assign(this.viewState, { selected: path || null, query: "", page: 0, favourites: false });
      if (path) this.viewState.expanded = expandTo(this.viewState.expanded, `${path}.x`);
      this.render();
    }

    static async #onPlay(event, target) {
      const path = pathOf(target);
      const api = getApi();
      if (typeof api?.sequence !== "function") return notify("warn", "SVA.UI.Browser.NoSequence");
      const sources = controlledTokens();
      if (!sources.length) return notify("warn", "SVA.UI.Browser.NoTokens");
      try {
        await playOnTokens(api, path, { sources, targets: targetedTokens(), broadcast: !!event?.shiftKey });
      } catch (err) {
        log.error("Could not play animation", err);
        notify("error", "SVA.UI.Browser.PlayFailed", { path });
      }
    }

    static #onCopy(_event, target) {
      const path = pathOf(target);
      if (path) copyText(path);
    }

    static async #onFavourite(_event, target) {
      const path = pathOf(target);
      if (!path) return;
      await game.settings.set(MODULE_ID, FAVOURITES_SETTING, toggleFavourite(getFavourites(), path));
      this.render({ parts: ["grid"] });
    }

    static #onPick(_event, target) {
      const path = pathOf(target);
      if (!path || !this.onPick) return;
      try {
        this.onPick(path);
      } finally {
        this.close();
      }
    }

    static #onPagePrev() {
      this.viewState.page = Math.max(0, this.viewState.page - 1);
      this.render({ parts: ["grid"] });
    }

    static #onPageNext() {
      this.viewState.page += 1;
      this.render({ parts: ["grid"] });
    }

    static #onShowFavourites() {
      Object.assign(this.viewState, { favourites: !this.viewState.favourites, query: "", page: 0 });
      this.render({ parts: ["header", "grid"] });
    }

    static #onClearSearch() {
      Object.assign(this.viewState, { query: "", page: 0 });
      this.render({ parts: ["header", "grid"] });
    }
  };
  return BrowserClass;
}

/**
 * Open the animation browser. Without `onPick`, a single shared window is reused.
 * @param {{onPick?: (path: string) => void, path?: string}} [options]
 */
export function openBrowser({ onPick, path } = {}) {
  const Browser = getBrowserClass();
  if (!Browser) {
    log.warn("The animation browser needs Foundry VTT ApplicationV2");
    return null;
  }
  if (!onPick && sharedBrowser) {
    if (path) sharedBrowser.reveal(path);
    sharedBrowser.render({ force: true });
    sharedBrowser.bringToFront?.();
    return sharedBrowser;
  }
  const app = new Browser({ onPick, path });
  if (!onPick) sharedBrowser = app;
  app.render({ force: true });
  return app;
}
