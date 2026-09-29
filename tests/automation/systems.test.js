import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SystemAdapter } from "../../src/shared/adapter.js";
import { createSystemsRegistry } from "../../src/automation/systems.js";
import TemplateAdapter from "../../src/systems/_template/index.js";
import { DummyAdapter } from "./helpers/dummy-adapter.js";

function setup() {
  game.system.id = "dummy";
  const api = { automation: { handle: vi.fn() } };
  api.systems = createSystemsRegistry(api);
  return api;
}

describe("api.systems registry", () => {
  it("registers classes and lists them", () => {
    const api = setup();
    expect(api.systems.register(DummyAdapter)).toBe(true);
    expect(api.systems.register(DummyAdapter)).toBe(false);
    expect(api.systems.list()).toEqual([DummyAdapter]);
    expect(api.systems.active).toBeNull();
  });

  it("rejects classes that do not extend SystemAdapter or lack an id", () => {
    const api = setup();
    expect(() => api.systems.register(class {})).toThrow(TypeError);
    expect(() => api.systems.register(class extends SystemAdapter {})).toThrow();
  });

  it("activates the adapter whose isActive() is true and calls register()", () => {
    const api = setup();
    class Other extends SystemAdapter {
      static id = "other";
    }
    api.systems.register(Other);
    api.systems.register(DummyAdapter);
    const adapter = api.systems.activate();
    expect(adapter).toBeInstanceOf(DummyAdapter);
    expect(adapter.registered).toBe(true);
    expect(api.systems.active).toBe(adapter);
    expect(adapter.ctx.api).toBe(api);
  });

  it("returns null when no adapter matches", () => {
    const api = setup();
    game.system.id = "gurps";
    api.systems.register(DummyAdapter);
    expect(api.systems.activate()).toBeNull();
  });

  it("activates a late registration after ready", () => {
    const api = setup();
    api.systems.activate();
    api.systems.register(DummyAdapter);
    expect(api.systems.active).toBeInstanceOf(DummyAdapter);
  });

  it("emit forwards to api.automation.handle with systemId", async () => {
    const api = setup();
    api.systems.register(DummyAdapter);
    const adapter = api.systems.activate();
    await adapter.fire({ type: "attack" });
    expect(api.automation.handle).toHaveBeenCalledWith({ type: "attack", systemId: "dummy" });
  });

  it("calls every class's static init(api) once during init, and later registrations immediately", () => {
    const api = setup();
    const calls = [];
    class Early extends SystemAdapter {
      static id = "early";
      static init(a) {
        calls.push(["early", a]);
      }
    }
    class Late extends SystemAdapter {
      static id = "late";
      static init(a) {
        calls.push(["late", a]);
      }
    }
    class Broken extends SystemAdapter {
      static id = "broken";
      static init() {
        throw new Error("boom");
      }
    }
    api.systems.register(Early);
    api.systems.register(Broken);
    expect(calls).toEqual([]);
    api.systems.initAll();
    api.systems.initAll();
    expect(calls).toEqual([["early", api]]);
    api.systems.register(Late);
    expect(calls).toEqual([
      ["early", api],
      ["late", api]
    ]);
  });

  it("deactivate calls unregister", () => {
    const api = setup();
    api.systems.register(DummyAdapter);
    const adapter = api.systems.activate();
    api.systems.deactivate();
    expect(adapter.registered).toBe(false);
    expect(api.systems.active).toBeNull();
  });
});

describe("template adapter", () => {
  it("is a SystemAdapter that is never active by default", () => {
    expect(TemplateAdapter.prototype).toBeInstanceOf(SystemAdapter);
    expect(TemplateAdapter.isActive()).toBe(false);
    const a = new TemplateAdapter({});
    expect(a.getItemDescriptors({ name: "Long Sword", type: "weapon" })).toMatchObject({
      key: "long-sword",
      type: "weapon"
    });
  });
});

describe("core isolation", () => {
  it("src/automation never imports a concrete system", () => {
    const dir = join(import.meta.dirname, "../../src/automation");
    for (const file of readdirSync(dir, { recursive: true })) {
      if (!String(file).endsWith(".js")) continue;
      const source = readFileSync(join(dir, String(file)), "utf8");
      expect(source, String(file)).not.toMatch(/systems\/(?!index\.js)[\w-]+\//);
    }
  });
});
