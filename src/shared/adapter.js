import { MODULE_ID } from "../constants.js";

/**
 * Base class for game-system adapters. An adapter is the ONLY place that
 * knows about a system's data model and hooks. It translates system activity
 * into normalized AutomationEvents (see ./events.js) and describes items in
 * system-agnostic terms.
 *
 * Built-in adapters are listed in src/systems/index.js; third-party modules
 * can register their own with `game.modules.get("sargas-visual-automation").api.systems.register(MyAdapter)`.
 *
 * Owned by the core: change only through a reviewed PR to docs/architecture.md.
 */
export class SystemAdapter {
  /** Foundry `game.system.id` this adapter handles. */
  static id = "";
  static label = "";

  static isActive() {
    return globalThis.game?.system?.id === this.id;
  }

  /**
   * Optional init-time hook, called once for every registered class during the automation area's `init`
   * (or right away when the class is registered after that), whether or not the adapter is active. Register
   * settings here so they exist before the settings UI is built; check `this.isActive()` first to skip work
   * in other systems. No instance exists yet: `register()` runs later, on `ready`, for the active adapter only.
   * @param {object} _api the shared SVA api
   */
  static init(_api) {}

  /**
   * @param {{api: object, emit: (event: object) => void}} ctx
   *   emit: hand a (partial) AutomationEvent to the core; `systemId` is filled in automatically.
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  get id() {
    return this.constructor.id;
  }

  /** Attach system hooks. Called once on `ready` when this adapter is active. */
  register() {}

  /** Detach hooks (tests, hot reload). */
  unregister() {}

  /** Stable rule key for an item (e.g. PF2e slug). */
  getItemKey(item) {
    return item?.name
      ? item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      : null;
  }

  /** @returns {import("./events.js").ItemDescriptors} */
  getItemDescriptors(item) {
    return {
      name: item?.name ?? "",
      key: this.getItemKey(item),
      type: "other",
      traits: [],
      attackKind: null,
      weaponGroup: null,
      baseItem: null,
      range: null,
      area: null,
      damageTypes: [],
      isHealing: false
    };
  }

  /** URL of this system's default rule pack (rules/<id>.json), or null for none. */
  get rulePackUrl() {
    return `modules/${MODULE_ID}/rules/${this.id}.json`;
  }
}
