import { vi } from "vitest";
import { MODULE_ID } from "../../../src/constants.js";
import { init } from "../../../src/automation/index.js";
import { DummyAdapter } from "./dummy-adapter.js";

/**
 * Boot the automation area against the Foundry mock with the dummy adapter
 * active, a mocked api.playSequence and an in-memory fromUuid.
 */
export function bootAutomation({ items = [], effects = null } = {}) {
  game.system.id = "dummy";
  const byUuid = new Map(items.map((i) => [i.uuid, i]));
  globalThis.fromUuid = vi.fn(async (uuid) => byUuid.get(uuid) ?? null);
  const api = { playSequence: vi.fn(async () => {}) };
  if (effects) api.effects = effects;
  init(api);
  api.systems.register(DummyAdapter);
  const adapter = api.systems.activate();
  return { api, adapter, byUuid };
}

export const flagged = (extra) => ({ [MODULE_ID]: extra });
