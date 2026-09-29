/**
 * Minimal stand-ins for the Foundry VTT globals used by the module.
 * Only what unit tests need - extend as sub-systems grow.
 */
import { beforeEach } from "vitest";

function createHooks() {
  const handlers = new Map();
  const add = (event, fn, once) => {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push({ fn, once });
  };
  return {
    on: (event, fn) => add(event, fn, false),
    once: (event, fn) => add(event, fn, true),
    callAll(event, ...args) {
      const list = handlers.get(event) ?? [];
      handlers.set(
        event,
        list.filter((h) => !h.once)
      );
      for (const h of list) h.fn(...args);
      return true;
    },
    _handlers: handlers
  };
}

function createSettings() {
  const configs = new Map();
  const values = new Map();
  return {
    register(namespace, key, config) {
      configs.set(`${namespace}.${key}`, config);
    },
    get(namespace, key) {
      const id = `${namespace}.${key}`;
      if (!configs.has(id)) throw new Error(`Setting ${id} is not registered`);
      return values.has(id) ? values.get(id) : configs.get(id).default;
    },
    async set(namespace, key, value) {
      const id = `${namespace}.${key}`;
      values.set(id, value);
      configs.get(id)?.onChange?.(value);
      return value;
    },
    _configs: configs
  };
}

export function resetFoundryMock({ modules = [] } = {}) {
  globalThis.Hooks = createHooks();
  globalThis.game = {
    modules: new Map(modules.map((m) => [m.id, { active: true, ...m }])),
    settings: createSettings(),
    system: { id: "pf2e" },
    user: { id: "user1", isGM: true }
  };
}

beforeEach(() => resetFoundryMock());
