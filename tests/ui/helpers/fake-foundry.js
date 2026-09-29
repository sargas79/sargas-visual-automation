import { vi } from "vitest";

/**
 * Installs a minimal `foundry.applications.api` so the UI app classes can be
 * defined and their `_prepareContext` exercised without Foundry.
 */
export function installFakeFoundry() {
  class ApplicationV2 {
    constructor(options = {}) {
      this.options = options;
      this.rendered = false;
      this.renderCalls = [];
    }
    get title() {
      return this.constructor.DEFAULT_OPTIONS?.window?.title ?? "";
    }
    async _prepareContext() {
      return {};
    }
    render(options) {
      this.rendered = true;
      this.renderCalls.push(options);
      return this;
    }
    async close() {
      this.rendered = false;
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

export function uninstallFakeFoundry() {
  delete globalThis.foundry;
  delete globalThis.ui;
  delete globalThis.canvas;
}
