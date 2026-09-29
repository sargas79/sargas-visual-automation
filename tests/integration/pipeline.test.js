/**
 * End-to-end wiring across areas with the real module boot:
 * PF2e chat message -> Pf2eAdapter -> automation (PF2e rule pack) -> playSequence -> runner -> engine.play.
 * Only Foundry, the socket and the engine's PIXI side are mocked.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import { eventFromMessage } from "../../src/systems/pf2e/messages.js";
import { resetFoundryMock } from "../setup/foundry-mock.js";
import {
  checkContext,
  installCanvas,
  mockActor,
  mockMessage,
  spells,
  weapons
} from "../systems/pf2e/helpers/fixtures.js";

const pf2ePack = JSON.parse(readFileSync(new URL("../../rules/pf2e.json", import.meta.url), "utf8"));

async function boot() {
  resetFoundryMock({ modules: [{ id: MODULE_ID, version: "0.0.0" }] });
  game.socket = { on: vi.fn(), emit: vi.fn() };
  game.users = [];
  game.user.role = 4;
  globalThis.fetch = vi.fn(async (url) =>
    String(url).endsWith("rules/pf2e.json")
      ? { ok: true, json: async () => structuredClone(pf2ePack) }
      : { ok: false, status: 404, json: async () => ({}) }
  );
  vi.resetModules();
  await import("../../src/main.js");
  Hooks.callAll("init");
  const api = game.modules.get(MODULE_ID).api;
  const played = [];
  api.engine.play = vi.fn(async (effect) => {
    played.push(effect);
    return { id: effect.id, descriptor: effect, finished: Promise.resolve(), duration: 100, end: vi.fn() };
  });
  Hooks.callAll("setup");
  Hooks.callAll("ready");
  await vi.waitFor(() => expect(api.ready).toBe(true));
  return { api, played };
}

describe("automation pipeline", () => {
  beforeEach(() => vi.useRealTimers());

  it("activates the PF2e adapter and loads its rule pack", async () => {
    const { api } = await boot();
    expect(api.systems.active?.id).toBe("pf2e");
    expect(api.automation.rules.all().some((r) => r.source === "system")).toBe(true);
  });

  it("a PF2e longsword strike plays a JB2A effect on the target", async () => {
    const { api, played } = await boot();
    const item = weapons.longsword();
    const hero = mockActor("hero", { items: [item] });
    const goblin = mockActor("goblin");
    installCanvas({ actors: [hero, goblin] });
    const context = checkContext("attack-roll", { actor: hero, target: goblin, outcome: "success" });
    const event = eventFromMessage(mockMessage({ actor: hero, item, context }), { userId: game.user.id });
    globalThis.fromUuid = async (uuid) => (uuid === item.uuid ? item : null);

    await api.automation.handle(event);
    await vi.waitFor(() => expect(played.length).toBeGreaterThan(0));
    expect(played.every((e) => e.file.startsWith("jb2a."))).toBe(true);
    expect(JSON.stringify(played)).toContain(goblin.tokens[0].id);
    expect(game.socket.emit).toHaveBeenCalled();
  });

  it("a spell attack resolves through the PF2e pack, not the generic fallback", async () => {
    const { api } = await boot();
    const spellFactory = Object.values(spells)[0];
    const spell = spellFactory();
    const hero = mockActor("hero", { items: [spell] });
    installCanvas({ actors: [hero] });
    const res = api.automation.resolveRecipe(spell, {});
    expect(res?.source).toBe("system");
  });
});
