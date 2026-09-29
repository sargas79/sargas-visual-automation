import { vi } from "vitest";

/**
 * Installs a minimal `foundry.applications.api` so the UI app classes can be
 * defined and their `_prepareContext` exercised without Foundry.
 *
 * Like the real Foundry v14 ApplicationV2, `state`, `rendered` and `element` are
 * read-only getters: a subclass assigning them throws here exactly as it does in
 * Foundry ("Cannot set property state of #<ApplicationV2> which has only a getter").
 * Tests provide an element with `setFakeElement(app, el)`.
 */
export function installFakeFoundry() {
  class ApplicationV2 {
    static RENDER_STATES = { NONE: 0, RENDERED: 2, CLOSED: -1 };
    #state = 0;
    #element = null;
    constructor(options = {}) {
      this.options = options;
      this.renderCalls = [];
    }
    get state() {
      return this.#state;
    }
    get rendered() {
      return this.#state === ApplicationV2.RENDER_STATES.RENDERED;
    }
    get element() {
      return this.#element;
    }
    /** Test hook (not in Foundry). */
    _fakeSetElement(element) {
      this.#element = element;
    }
    get id() {
      return this.options.id;
    }
    get title() {
      return this.constructor.DEFAULT_OPTIONS?.window?.title ?? "";
    }
    async _prepareContext() {
      return {};
    }
    render(options) {
      this.#state = ApplicationV2.RENDER_STATES.RENDERED;
      this.renderCalls.push(options);
      return this;
    }
    async close() {
      this.#state = ApplicationV2.RENDER_STATES.CLOSED;
    }
  }
  const HandlebarsApplicationMixin = (Base) => class extends Base {};
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2, HandlebarsApplicationMixin, DialogV2: { confirm: vi.fn(async () => true) } }
    },
    utils: { randomID: () => "rnd123", saveDataToFile: vi.fn() }
  };
  globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  return globalThis.foundry;
}

/** Give a fake application an element (the real `element` is read-only). */
export function setFakeElement(app, element) {
  app._fakeSetElement(element);
}

export function uninstallFakeFoundry() {
  delete globalThis.foundry;
  delete globalThis.ui;
  delete globalThis.canvas;
}
