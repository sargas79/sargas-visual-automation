import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SOCKET_NAME } from "../../src/constants.js";
import * as netArea from "../../src/net/index.js";
import {
  applyReducedMotion,
  canTrigger,
  filterEffect,
  getVolume,
  NET_SETTINGS,
  registerNetSettings,
  resolveSender,
  senderAllowed
} from "../../src/net/preferences.js";
import { createPayload } from "../../src/net/protocol.js";
import { createSocketHub, flush } from "./helpers/socket.js";

const player = (id, role = 1) => ({ id, isGM: false, role });

describe("settings", () => {
  it("registers world and client settings with defaults", () => {
    registerNetSettings();
    const cfg = game.settings._configs;
    expect(cfg.get(`${MODULE_ID}.${NET_SETTINGS.MIN_TRIGGER_ROLE}`).scope).toBe("world");
    for (const key of [NET_SETTINGS.EFFECTS_DISABLED, NET_SETTINGS.REDUCED_MOTION, NET_SETTINGS.VOLUME]) {
      expect(cfg.get(`${MODULE_ID}.${key}`).scope).toBe("client");
    }
    expect(game.settings.get(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE)).toBe(1);
    expect(game.settings.get(MODULE_ID, NET_SETTINGS.VOLUME)).toBe(1);
  });

  it("falls back to defaults when settings are not registered", () => {
    expect(getVolume()).toBe(1);
    expect(filterEffect({ id: "a" })).toEqual({ id: "a" });
  });
});

describe("permissions", () => {
  beforeEach(() => registerNetSettings());

  it("lets GMs always trigger and checks player roles", async () => {
    expect(canTrigger({ isGM: true })).toBe(true);
    expect(canTrigger(player("p"))).toBe(true);
    await game.settings.set(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE, 2);
    expect(canTrigger(player("p", 1))).toBe(false);
    expect(canTrigger(player("p", 2))).toBe(true);
    expect(canTrigger({ isGM: false, hasRole: (r) => r <= 3 })).toBe(true);
    expect(canTrigger(null)).toBe(false);
  });

  it("checks the sender against game.users", async () => {
    game.users = new Map([
      ["low", player("low", 1)],
      ["high", player("high", 3)]
    ]);
    await game.settings.set(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE, 2);
    expect(senderAllowed("low")).toBe(false);
    expect(senderAllowed("high")).toBe(true);
    expect(senderAllowed("ghost")).toBe(false);
    // A client-claimed (unverified) id must also be a connected user.
    expect(senderAllowed("high", { verified: false })).toBe(false);
    game.users.get("high").active = true;
    expect(senderAllowed("high", { verified: false })).toBe(true);
  });

  it("grants GM rights only to a server-verified GM sender", () => {
    const users = new Map([
      ["gm", { id: "gm", isGM: true, active: true }],
      ["away", { id: "away", isGM: false, active: false }]
    ]);
    expect(resolveSender({ senderId: "gm", verified: true }, users)).toMatchObject({ privileged: true });
    expect(resolveSender({ senderId: "gm", verified: false }, users)).toMatchObject({
      user: users.get("gm"),
      verified: false,
      privileged: false
    });
    expect(resolveSender({ senderId: "away", verified: false }, users).user).toBeNull();
    expect(resolveSender({ senderId: "away", verified: true }, users).user).toBe(users.get("away"));
    expect(resolveSender({ senderId: "ghost", verified: true }, users).user).toBeNull();
    expect(resolveSender({ senderId: "gm", verified: true }, null).user).toBeNull();
  });
});

describe("client preferences", () => {
  beforeEach(() => registerNetSettings());

  it("disabling effects filters everything", async () => {
    await game.settings.set(MODULE_ID, NET_SETTINGS.EFFECTS_DISABLED, true);
    expect(filterEffect({ id: "a", persist: true })).toBeNull();
  });

  it("reduced motion drops flourishes but keeps essential effects", async () => {
    await game.settings.set(MODULE_ID, NET_SETTINGS.REDUCED_MOTION, true);
    expect(filterEffect({ id: "a", layer: "screen" })).toBeNull();
    expect(filterEffect({ id: "b", returnTrip: true, scaleIn: { value: 0, duration: 100 } })).toEqual({ id: "b" });
    const aura = { id: "c", persist: true, layer: "screen" };
    expect(applyReducedMotion(aura)).toBe(aura);
  });

  it("reduced motion honours the essential flag (#66)", async () => {
    await game.settings.set(MODULE_ID, NET_SETTINGS.REDUCED_MOTION, true);
    const essential = { id: "a", essential: true, layer: "screen", returnTrip: true };
    expect(filterEffect(essential)).toBe(essential);
    expect(filterEffect({ id: "b", essential: false })).toBeNull();
    const aura = { id: "c", persist: true, essential: false };
    expect(filterEffect(aura)).toBe(aura);
    await game.settings.set(MODULE_ID, NET_SETTINGS.REDUCED_MOTION, false);
    expect(filterEffect({ id: "d", essential: false })).toEqual({ id: "d", essential: false });
  });

  it("clamps the volume", async () => {
    await game.settings.set(MODULE_ID, NET_SETTINGS.VOLUME, 3);
    expect(getVolume()).toBe(1);
  });
});

describe("net area with permissions", () => {
  let hub;
  beforeEach(() => {
    hub = createSocketHub();
    game.socket = hub.createSocket("user1");
    game.users = new Map([
      ["low", player("low", 1)],
      ["gm", { id: "gm", isGM: true }]
    ]);
  });
  afterEach(() => {
    delete game.users;
  });

  it("drops messages from senders below the minimum role", async () => {
    const api = { engine: { endAll: vi.fn(), preload: vi.fn(async () => {}) } };
    netArea.init(api);
    await game.settings.set(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE, 2);
    const handler = vi.fn();
    api.net.on("play", handler);
    const low = hub.createSocket("low");
    const gm = hub.createSocket("gm");
    low.emit(SOCKET_NAME, createPayload("play", { n: 1 }, "low"));
    // A spoofed senderId is replaced by the id the server reports.
    low.emit(SOCKET_NAME, createPayload("play", { n: 3 }, "gm"));
    gm.emit(SOCKET_NAME, createPayload("play", { n: 2 }, "gm"));
    // preload follows the same role check.
    low.emit(SOCKET_NAME, createPayload("preload", { files: ["f"] }, "low"));
    gm.emit(SOCKET_NAME, createPayload("preload", { files: ["g"] }, "gm"));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ n: 2 });
    expect(api.engine.preload).toHaveBeenCalledTimes(1);
    expect(api.engine.preload).toHaveBeenCalledWith(["g"]);
  });

  it("accepts single ends and stored deletions from senders below the minimum role", async () => {
    const api = { engine: { endAll: vi.fn() } };
    netArea.init(api);
    await game.settings.set(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE, 2);
    const ends = vi.fn();
    const writes = vi.fn();
    api.net.on("end", ends);
    api.net.on("effectsWrite", writes);
    const low = hub.createSocket("low");
    const ghost = hub.createSocket("ghost");
    low.emit(SOCKET_NAME, createPayload("end", { sceneId: "s", name: "aura:a:x" }, "low"));
    low.emit(SOCKET_NAME, createPayload("end", { sceneId: "s", all: true }, "low"));
    low.emit(SOCKET_NAME, createPayload("effectsWrite", { op: "delete", sceneId: "s", ids: ["a"] }, "low"));
    low.emit(SOCKET_NAME, createPayload("effectsWrite", { op: "set", sceneId: "s", effects: [] }, "low"));
    // Unknown users are still dropped.
    ghost.emit(SOCKET_NAME, createPayload("end", { sceneId: "s", name: "x" }, "ghost"));
    await flush();
    expect(ends).toHaveBeenCalledTimes(1);
    expect(ends.mock.calls[0][0]).toEqual({ sceneId: "s", name: "aura:a:x" });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ op: "delete" });
  });

  it("ends local effects when effects get disabled", async () => {
    const api = { engine: { endAll: vi.fn() } };
    netArea.init(api);
    await game.settings.set(MODULE_ID, NET_SETTINGS.EFFECTS_DISABLED, true);
    expect(api.engine.endAll).toHaveBeenCalled();
  });
});
