/**
 * End-to-end: GGA chat card → GurpsAdapter (via the createChatMessage hook) → automation (GURPS rule pack) →
 * playSequence → engine.play, with the real module boot. Only Foundry, the socket and PIXI are mocked.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../../src/constants.js";
import { resetFoundryMock } from "../../setup/foundry-mock.js";
import {
  attackAction,
  hero as makeHero,
  installCanvas,
  orc as makeOrc,
  rollMessage,
  skillSpellAction
} from "./helpers/fixtures.js";

const gurpsPack = JSON.parse(readFileSync(new URL("../../../rules/gurps.json", import.meta.url), "utf8"));

async function boot() {
  resetFoundryMock({ modules: [{ id: MODULE_ID, version: "0.0.0" }] });
  game.system.id = "gurps";
  game.socket = { on: vi.fn(), emit: vi.fn() };
  game.users = [];
  game.user.role = 4;
  globalThis.fetch = vi.fn(async (url) =>
    String(url).endsWith("rules/gurps.json")
      ? { ok: true, json: async () => structuredClone(gurpsPack) }
      : { ok: false, status: 404, json: async () => ({}) }
  );
  globalThis.fromUuid = async () => null;
  vi.resetModules();
  await import("../../../src/main.js");
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
  await vi.waitFor(() => expect(api.automation.rules.all().some((r) => r.source === "system")).toBe(true));
  return { api, played };
}

describe("GURPS automation pipeline", () => {
  it("activates the GURPS adapter and loads its rule pack", async () => {
    const { api } = await boot();
    expect(api.systems.active?.id).toBe("gurps");
  });

  it("a broadsword attack card plays a sword animation on the target", async () => {
    const { played } = await boot();
    const hero = makeHero();
    const orc = makeOrc();
    installCanvas({ actors: [hero, orc], targets: ["tok-orc"] });
    const msg = rollMessage({
      actor: hero,
      action: attackAction(hero, "M", "Broadsword (Swing)"),
      thing: "Broadsword"
    });
    Hooks.callAll("createChatMessage", msg, {}, game.user.id);
    await vi.waitFor(() => expect(played.length).toBeGreaterThan(0));
    expect(played[0].file).toBe("jb2a.sword.melee.01");
    expect(JSON.stringify(played)).toContain("tok-orc");
  });

  it("a Minor Healing roll plays the healing rule on the caster", async () => {
    const { played } = await boot();
    const hero = makeHero();
    installCanvas({ actors: [hero], targets: [] });
    const msg = rollMessage({
      actor: hero,
      action: skillSpellAction(hero, "Sp", "Minor Healing"),
      thing: "Minor Healing"
    });
    Hooks.callAll("createChatMessage", msg, {}, game.user.id);
    await vi.waitFor(() => expect(played.length).toBeGreaterThan(0));
    expect(played[0].file).toBe("jb2a.healing_generic.200px.green");
    expect(JSON.stringify(played)).toContain("tok-hero");
  });
});
