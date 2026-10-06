import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBackend } from "./helpers/fake-backend.js";

const backend = vi.hoisted(() => ({ current: null }));
vi.mock("../../src/engine/video-backend.js", () => ({
  get foundryTextureBackend() {
    return backend.current;
  }
}));

describe("engine area lifecycle", () => {
  let hooks;
  beforeEach(() => {
    backend.current = createFakeBackend();
    hooks = {};
    globalThis.Hooks = { on: vi.fn((name, fn) => (hooks[name] = fn)) };
    globalThis.game = { settings: { register: vi.fn(), get: vi.fn(() => undefined) } };
  });
  afterEach(() => {
    delete globalThis.Hooks;
    delete globalThis.game;
  });

  it("keeps cached prototypes across a scene change and only drains idle clones", async () => {
    const { init } = await import("../../src/engine/index.js");
    const api = {};
    init(api);
    await api.engine.preload(["modules/x/a.webm"]);
    expect(api.engine.debug.stats().textures.cached).toBe(1);
    hooks.canvasTearDown();
    expect(api.engine.debug.stats().textures.cached).toBe(1);
    expect(backend.current.unload).not.toHaveBeenCalled();
    await api.engine.preload(["modules/x/a.webm"]);
    expect(backend.current.load).toHaveBeenCalledTimes(1);
  });
});
