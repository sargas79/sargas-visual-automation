import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileTeleportPhases } from "../../src/automation/compile.js";
import { TELEPORT_MESSAGES, applyMove, createTeleport, topLeftFor } from "../../src/automation/teleport.js";
import { EVENT_TYPES } from "../../src/shared/events.js";
import { fakeItem } from "./helpers/dummy-adapter.js";
import { bootAutomation, flagged } from "./helpers/setup.js";

const RECIPE = {
  version: 1,
  preset: "teleport",
  animation: "jb2a.misty_step.01.blue",
  stages: { onTarget: { animation: "jb2a.misty_step.02.blue" } }
};

const cast = (extra = {}) => ({
  type: EVENT_TYPES.CAST,
  source: { tokenId: "tok1", actorId: "a1" },
  targets: [],
  itemUuid: "Item.tp",
  userId: "user1",
  sceneId: "scene1",
  ...extra
});

/** Fake scene with one 1x1 token, a canvas with a 100 px grid and a clickable stage. */
function installWorld({ owner = true } = {}) {
  const log = [];
  const doc = {
    id: "tok1",
    width: 1,
    height: 1,
    parent: { id: "scene1" },
    testUserPermission: vi.fn(() => owner),
    update: vi.fn(async (data, options) => {
      log.push(["update", data, options]);
    })
  };
  const scene = { id: "scene1", tokens: new Map([["tok1", doc]]), grid: { size: 100 } };
  game.scenes = new Map([["scene1", scene]]);
  game.users = new Map([
    ["user1", game.user],
    ["gm", { id: "gm", isGM: true }]
  ]);
  const listeners = new Map();
  globalThis.canvas = {
    ready: true,
    scene,
    grid: { size: 100, distance: 5 },
    tokens: { get: () => null },
    stage: {
      addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
      removeEventListener: vi.fn((type) => listeners.delete(type))
    }
  };
  globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
  const click = (x, y, button = 0) =>
    listeners.get("pointerdown")?.({ button, stopPropagation: vi.fn(), getLocalPosition: () => ({ x, y }) });
  return { doc, log, click, listeners };
}

function bootWithTeleport(recipe = RECIPE) {
  const item = fakeItem({ name: "Translocate", uuid: "Item.tp", flags: flagged({ recipe }), type: "spell" });
  const ctx = bootAutomation({ items: [item] });
  return ctx;
}

afterEach(() => {
  delete globalThis.canvas;
  delete globalThis.ui;
  vi.useRealTimers();
});

describe("compileTeleportPhases", () => {
  it("splits vanish (waits until finished) and appear (no arrival delay)", () => {
    const { departure, arrival } = compileTeleportPhases(
      { ...RECIPE, options: { destination: { x: 300, y: 400 } } },
      cast(),
      { grid: { size: 100, distance: 5 }, getTokenSize: () => 1 }
    );
    expect(departure.steps).toEqual([
      expect.objectContaining({
        waitUntilFinished: 0,
        effect: expect.objectContaining({ file: "jb2a.misty_step.01.blue", atLocation: { tokenId: "tok1" } })
      })
    ]);
    expect(arrival.steps[0].effect).toMatchObject({ file: "jb2a.misty_step.02.blue", atLocation: { x: 300, y: 400 } });
    expect(arrival.steps[0].effect.delay).toBeUndefined();
  });
});

describe("teleport preset moves the token", () => {
  let world;
  beforeEach(() => {
    world = installWorld();
  });

  it("GM: vanish → move (animate: false) → appear, at the placed area's origin", async () => {
    const { api } = bootWithTeleport();
    api.playSequence.mockImplementation(async (seq) => world.log.push(["play", seq.steps[0].effect.file]));
    const ok = await api.automation.handle(cast({ area: { shape: "burst", origin: { x: 450, y: 250 }, distance: 0 } }));
    expect(ok).toBe(true);
    expect(world.log).toEqual([
      ["play", "jb2a.misty_step.01.blue"],
      ["update", { x: 400, y: 200 }, { animate: false }],
      ["play", "jb2a.misty_step.02.blue"]
    ]);
    expect(api.playSequence.mock.calls[1][0].steps[0].effect.atLocation).toEqual({ x: 450, y: 250 });
  });

  it("picks the destination with a click when the event has none", async () => {
    const { api } = bootWithTeleport();
    const done = api.automation.handle(cast());
    await vi.waitFor(() => expect(world.listeners.has("pointerdown")).toBe(true));
    expect(api.playSequence).not.toHaveBeenCalled();
    world.click(250, 350);
    expect(await done).toBe(true);
    expect(world.doc.update).toHaveBeenCalledWith({ x: 200, y: 300 }, { animate: false });
    expect(world.listeners.has("pointerdown")).toBe(false);
  });

  it("right-click cancels: nothing plays, nothing moves", async () => {
    const { api } = bootWithTeleport();
    const done = api.automation.handle(cast());
    await vi.waitFor(() => expect(world.listeners.has("pointerdown")).toBe(true));
    world.click(0, 0, 2);
    expect(await done).toBe(false);
    expect(api.playSequence).not.toHaveBeenCalled();
    expect(world.doc.update).not.toHaveBeenCalled();
  });

  it("moveToken: false keeps the animation-only behaviour", async () => {
    const { api } = bootWithTeleport({ ...RECIPE, options: { moveToken: false } });
    expect(await api.automation.handle(cast({ area: { origin: { x: 450, y: 250 } } }))).toBe(true);
    expect(api.playSequence).toHaveBeenCalledTimes(1);
    expect(world.doc.update).not.toHaveBeenCalled();
  });
});

describe("player requests go through the GM", () => {
  function fakeNet() {
    const handlers = new Map();
    return {
      handlers,
      on: vi.fn((type, fn) => handlers.set(type, fn)),
      emit: vi.fn(),
      prefs: { canTrigger: () => true }
    };
  }

  it("a player asks the active GM and waits for the answer", async () => {
    installWorld();
    game.user = { id: "user1", isGM: false };
    game.users.activeGM = { id: "gm" };
    const net = fakeNet();
    const teleport = createTeleport({ net }, { playAll: vi.fn() });
    const moving = teleport.moveToken({ sceneId: "scene1", tokenId: "tok1", x: 100, y: 200 });
    expect(net.emit).toHaveBeenCalledWith(TELEPORT_MESSAGES.MOVE, expect.objectContaining({ tokenId: "tok1", x: 100 }));
    const { requestId } = net.emit.mock.calls[0][1];
    net.handlers.get(TELEPORT_MESSAGES.MOVED)({ requestId: "other", ok: false });
    net.handlers.get(TELEPORT_MESSAGES.MOVED)({ requestId, ok: true });
    expect(await moving).toEqual({ ok: true, reason: undefined });
  });

  it("without a GM the request fails and the arrival is not played", async () => {
    const world = installWorld();
    game.user = { id: "user1", isGM: false };
    game.users.activeGM = null;
    const playAll = vi.fn(async () => true);
    const teleport = createTeleport({ net: fakeNet() }, { playAll });
    const result = await teleport.run(RECIPE, cast({ area: { origin: { x: 450, y: 250 } } }));
    expect(result).toBe(true);
    expect(playAll).toHaveBeenCalledTimes(1);
    expect(world.doc.update).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledWith("SVA.Automation.Teleport.NoGM");
  });

  it("times out when the GM never answers", async () => {
    vi.useFakeTimers();
    installWorld();
    game.user = { id: "user1", isGM: false };
    game.users.activeGM = { id: "gm" };
    const teleport = createTeleport({ net: fakeNet() }, { playAll: vi.fn() });
    const moving = teleport.moveToken({ sceneId: "scene1", tokenId: "tok1", x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await moving).toEqual({ ok: false, reason: "noGM" });
  });

  it("the active GM moves tokens the sender owns and answers", async () => {
    const world = installWorld({ owner: true });
    game.users.activeGM = { id: "user1" };
    const player = { id: "p1", isGM: false };
    game.users.set("p1", player);
    const net = fakeNet();
    createTeleport({ net }, { playAll: vi.fn() });
    await net.handlers.get(TELEPORT_MESSAGES.MOVE)(
      { requestId: "r1", sceneId: "scene1", tokenId: "tok1", x: 100, y: 200 },
      { senderId: "p1", verified: true }
    );
    expect(world.doc.testUserPermission).toHaveBeenCalledWith(player, "OWNER");
    expect(world.doc.update).toHaveBeenCalledWith({ x: 100, y: 200 }, { animate: false });
    expect(net.emit).toHaveBeenCalledWith(TELEPORT_MESSAGES.MOVED, { requestId: "r1", ok: true });
  });

  it("the GM refuses tokens the sender does not own; other GMs stay silent", async () => {
    const world = installWorld({ owner: false });
    game.users.set("p1", { id: "p1", isGM: false });
    game.users.activeGM = { id: "user1" };
    const net = fakeNet();
    createTeleport({ net }, { playAll: vi.fn() });
    const request = { requestId: "r2", sceneId: "scene1", tokenId: "tok1", x: 1, y: 2 };
    await net.handlers.get(TELEPORT_MESSAGES.MOVE)(request, { senderId: "p1", verified: true });
    expect(world.doc.update).not.toHaveBeenCalled();
    expect(net.emit).toHaveBeenCalledWith(TELEPORT_MESSAGES.MOVED, { requestId: "r2", ok: false, reason: "denied" });

    net.emit.mockClear();
    game.users.activeGM = { id: "gm" };
    await net.handlers.get(TELEPORT_MESSAGES.MOVE)(request, { senderId: "p1", verified: true });
    expect(net.emit).not.toHaveBeenCalled();
  });

  it("an unverified sender id never gets the GM bypass", async () => {
    const world = installWorld({ owner: true });
    game.users.activeGM = { id: "user1" };
    game.users.set("gm", { id: "gm", isGM: true, active: true });
    game.users.set("p1", { id: "p1", isGM: false, active: false });
    const net = fakeNet();
    createTeleport({ net }, { playAll: vi.fn() });
    const move = (requestId, payload) =>
      net.handlers.get(TELEPORT_MESSAGES.MOVE)({ requestId, sceneId: "scene1", tokenId: "tok1", x: 1, y: 2 }, payload);

    // A player claiming to be the GM (no server-provided id): the GM has no explicit ownership of the token.
    await move("r1", { senderId: "gm", verified: false });
    expect(net.emit).toHaveBeenLastCalledWith(TELEPORT_MESSAGES.MOVED, {
      requestId: "r1",
      ok: false,
      reason: "denied"
    });
    // A claimed user that is not connected is rejected outright.
    await move("r2", { senderId: "p1", verified: false });
    expect(net.emit).toHaveBeenLastCalledWith(TELEPORT_MESSAGES.MOVED, {
      requestId: "r2",
      ok: false,
      reason: "denied"
    });
    expect(world.doc.update).not.toHaveBeenCalled();
    // The same GM id vouched for by the server keeps the bypass.
    await move("r3", { senderId: "gm", verified: true });
    expect(net.emit).toHaveBeenLastCalledWith(TELEPORT_MESSAGES.MOVED, { requestId: "r3", ok: true });
  });
});

describe("helpers", () => {
  it("topLeftFor centres the token on the point", () => {
    expect(topLeftFor({ width: 2, height: 2 }, { x: 500, y: 500 }, 100)).toEqual({ x: 400, y: 400 });
  });

  it("applyMove without GM trust needs explicit ownership", async () => {
    const world = installWorld({ owner: true });
    const gm = { id: "gm", isGM: true };
    const move = { sceneId: "scene1", tokenId: "tok1", x: 0, y: 0 };
    expect(await applyMove(move, gm, { trustGM: false })).toEqual({ ok: false, reason: "denied" });
    world.doc.actor = { ownership: { default: 0, gm: 3 } };
    expect(await applyMove(move, gm, { trustGM: false })).toEqual({ ok: true });
  });

  it("applyMove rejects invalid coordinates and unknown tokens", async () => {
    installWorld();
    expect(await applyMove({ sceneId: "scene1", tokenId: "tok1", x: NaN, y: 0 }, game.user)).toEqual({
      ok: false,
      reason: "invalid"
    });
    expect(await applyMove({ sceneId: "scene1", tokenId: "nope", x: 0, y: 0 }, game.user)).toEqual({
      ok: false,
      reason: "missing"
    });
  });
});
