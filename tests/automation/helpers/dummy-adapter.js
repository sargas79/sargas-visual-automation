import { vi } from "vitest";
import { SystemAdapter } from "../../../src/shared/adapter.js";

/**
 * Minimal adapter used to drive the automation core in tests. It reads a fake
 * item shape `{ name, sva: ItemDescriptors-partial }` and exposes `fire()` to
 * emit events like a real system would.
 */
export class DummyAdapter extends SystemAdapter {
  static id = "dummy";
  static label = "Dummy";
  static registered = 0;

  register() {
    DummyAdapter.registered += 1;
    this.registered = true;
  }

  unregister() {
    this.registered = false;
  }

  getItemDescriptors(item) {
    return { ...super.getItemDescriptors(item), ...(item?.sva ?? {}) };
  }

  /** Emit an event exactly like a system hook would. */
  fire(partial) {
    return this.ctx.emit(partial);
  }
}

/** Build a fake Foundry item. */
export function fakeItem({ name = "Item", uuid = "Item.x", flags = {}, sva = {}, type = "weapon" } = {}) {
  const item = {
    name,
    uuid,
    type,
    flags: structuredClone(flags),
    sva,
    async setFlag(scope, key, value) {
      item.flags[scope] ??= {};
      item.flags[scope][key] = value;
      return item;
    },
    async unsetFlag(scope, key) {
      if (item.flags[scope]) delete item.flags[scope][key];
      return item;
    },
    /** Dot-path update; a "-=key" segment deletes that key (Foundry deletion syntax), applied in key order. */
    update: vi.fn(async (changes) => {
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split(".");
        const last = keys.pop();
        let node = item;
        for (const key of keys) node = node[key] ??= {};
        if (last.startsWith("-=")) delete node[last.slice(2)];
        else node[last] = structuredClone(value);
      }
      return item;
    })
  };
  return item;
}
