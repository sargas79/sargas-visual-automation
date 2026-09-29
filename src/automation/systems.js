import { SystemAdapter } from "../shared/adapter.js";
import { log } from "../logger.js";

/**
 * System adapter registry - `api.systems`.
 *
 * Adapters are registered as classes (built-ins from src/systems/index.js,
 * third-party ones through `api.systems.register`). During the automation
 * area's `init`, `initAll()` calls every class's static `init(api)` (classes
 * registered after that are initialized as soon as they are registered). On `ready` the first
 * registered class whose static `isActive()` returns true is instantiated with
 * `{ api, emit }` and its `register()` is called. `emit` forwards (partial)
 * AutomationEvents to `api.automation.handle`, filling in `systemId`.
 *
 * The registry never imports a concrete system: it only knows SystemAdapter.
 */
export function createSystemsRegistry(api) {
  /** @type {Array<typeof SystemAdapter>} */
  const classes = [];
  /** @type {SystemAdapter|null} */
  let active = null;
  let started = false;
  let initialized = false;
  /** Classes whose static init() already ran. */
  const initializedClasses = new Set();

  function initClass(AdapterClass) {
    if (initializedClasses.has(AdapterClass)) return;
    initializedClasses.add(AdapterClass);
    if (typeof AdapterClass.init !== "function") return;
    try {
      AdapterClass.init(api);
    } catch (err) {
      log.error(`System adapter "${AdapterClass.id}" init() failed`, err);
    }
  }

  function makeEmit(adapterId) {
    return (partial) => {
      const event = { ...partial, systemId: partial?.systemId ?? adapterId };
      const handler = api.automation?.handle;
      if (typeof handler !== "function") {
        log.warn("Automation is not available; dropping event", event);
        return undefined;
      }
      return Promise.resolve()
        .then(() => handler(event))
        .catch((err) => log.error("Automation event failed", err));
    };
  }

  function instantiate(AdapterClass) {
    const adapter = new AdapterClass({ api, emit: makeEmit(AdapterClass.id) });
    adapter.register();
    return adapter;
  }

  function isActiveClass(AdapterClass) {
    try {
      return AdapterClass.isActive() === true;
    } catch (err) {
      log.error(`Adapter "${AdapterClass.id}" isActive() failed`, err);
      return false;
    }
  }

  const registry = {
    /**
     * Register an adapter class. When called after `ready` and no adapter is
     * active yet, the class is activated immediately if it matches the system.
     * @param {typeof SystemAdapter} AdapterClass
     * @returns {boolean} true when the class was added.
     */
    register(AdapterClass) {
      if (typeof AdapterClass !== "function" || !(AdapterClass.prototype instanceof SystemAdapter)) {
        throw new TypeError("api.systems.register expects a class extending SystemAdapter");
      }
      if (!AdapterClass.id) throw new Error("System adapters need a static `id`");
      if (classes.some((c) => c.id === AdapterClass.id)) {
        log.warn(`System adapter "${AdapterClass.id}" is already registered`);
        return false;
      }
      classes.push(AdapterClass);
      if (initialized) initClass(AdapterClass);
      if (started && !active && isActiveClass(AdapterClass) && registry.activate()) {
        Promise.resolve(api.automation?.reloadRulePack?.()).catch((err) => log.error("Rule pack failed to load", err));
      }
      return true;
    },

    /** The active adapter instance, or null. */
    get active() {
      return active;
    },

    /** Registered adapter classes (copy). */
    list() {
      return [...classes];
    },

    /**
     * Call the static `init(api)` of every registered class (once per class). Called by the automation area's
     * `init`; later registrations are initialized immediately.
     */
    initAll() {
      initialized = true;
      for (const AdapterClass of classes) initClass(AdapterClass);
    },

    /** Find a registered class by id. */
    get(id) {
      return classes.find((c) => c.id === id) ?? null;
    },

    /**
     * Pick and start the adapter for the current system. Called on `ready`.
     * @returns {SystemAdapter|null}
     */
    activate() {
      started = true;
      if (active) return active;
      const AdapterClass = classes.find(isActiveClass);
      if (!AdapterClass) {
        log.info(`No system adapter for "${globalThis.game?.system?.id}"; only manual automation is available`);
        return null;
      }
      try {
        active = instantiate(AdapterClass);
        log.info(`System adapter "${AdapterClass.id}" active`);
      } catch (err) {
        active = null;
        log.error(`System adapter "${AdapterClass.id}" failed to start`, err);
      }
      return active;
    },

    /** Stop the active adapter (tests, hot reload). */
    deactivate() {
      try {
        active?.unregister();
      } finally {
        active = null;
        started = false;
      }
    }
  };
  return registry;
}
