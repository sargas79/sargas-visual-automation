import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants.js";
import { resetFoundryMock } from "./setup/foundry-mock.js";

async function loadModule() {
  resetFoundryMock({ modules: [{ id: MODULE_ID, version: "1.2.3" }] });
  vi.resetModules();
  await import("../src/main.js");
}

describe("module entry point", () => {
  it("exposes the API on init", async () => {
    await loadModule();
    Hooks.callAll("init");
    const api = game.modules.get(MODULE_ID).api;
    expect(api).toMatchObject({ version: "1.2.3", ready: false });
  });

  it("publishes the API as globalThis.SVA", async () => {
    await loadModule();
    Hooks.callAll("init");
    expect(globalThis.SVA).toBe(game.modules.get(MODULE_ID).api);
  });

  it("registers the debug setting on init", async () => {
    await loadModule();
    Hooks.callAll("init");
    expect(game.settings.get(MODULE_ID, "debug")).toBe(false);
  });

  it("marks the API ready and fires the module ready hook", async () => {
    await loadModule();
    const onReady = vi.fn();
    Hooks.on(`${MODULE_ID}.ready`, onReady);
    Hooks.callAll("init");
    Hooks.callAll("ready");
    const api = game.modules.get(MODULE_ID).api;
    await vi.waitFor(() => expect(api.ready).toBe(true));
    expect(onReady).toHaveBeenCalledWith(api);
  });
});
