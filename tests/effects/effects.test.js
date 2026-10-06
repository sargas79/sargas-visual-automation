import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import * as effectsArea from "../../src/effects/index.js";
import { createEffectsManager } from "../../src/effects/manager.js";
import { collectPersistent, getStored, matches, referencesToken } from "../../src/effects/store.js";
import { createNet } from "../../src/net/channel.js";
import { resolveEffect } from "../../src/sequence/runner.js";
import * as sequenceArea from "../../src/sequence/index.js";
import { createSequence } from "../../src/shared/descriptors.js";
import { createSocketHub, flush } from "../net/helpers/socket.js";
import { createMockEngine } from "../sequence/helpers/engine.js";
import { createMockScene } from "./helpers/scene.js";

const aura = (id, extra = {}) => ({
  id,
  file: "jb2a.aura",
  atLocation: { tokenId: "tok1" },
  persist: true,
  sceneId: "scene1",
  name: `aura:${id}`,
  ...extra
});

/**
 * A small world: one shared scene, several clients (own engine, net, manager).
 * Scene updates are fanned out to every client like the updateScene hook.
 */
function createWorld(users) {
  const hub = createSocketHub();
  const clients = [];
  const scene = createMockScene("scene1", { onUpdate: (s) => clients.forEach((c) => c.manager.onSceneUpdate(s)) });
  const world = { hub, scene, clients, activeGM: users.find((u) => u.isGM) ?? null, warn: vi.fn(), time: 0 };
  const userMap = new Map(users.map((u) => [u.id, u]));
  for (const user of users) {
    const socket = hub.createSocket(user.id);
    const net = createNet({ getSocket: () => socket, getUserId: () => user.id });
    net.listen();
    const api = { engine: createMockEngine(), net };
    const manager = createEffectsManager(api, {
      getScene: (id) => (id === scene.id ? scene : null),
      getViewedScene: () => scene,
      getUser: () => user,
      getActiveGM: () => world.activeGM,
      getUsers: () => userMap,
      now: () => world.time,
      warn: world.warn
    });
    api.effects = manager.effects;
    net.on("effectsWrite", (d, payload) => manager.onWriteRequest(d, payload));
    net.on("end", (d) => manager.endLocal(d));
    const client = { user, api, manager, socket };
    clients.push(client);
  }
  return world;
}

const GM = { id: "gm", isGM: true, active: true };
const P1 = { id: "p1", isGM: false, active: true };
const P2 = { id: "p2", isGM: false, active: true };
/** Net payload as handlers receive it. */
const from = (senderId, verified = true) => ({ senderId, verified });

describe("store helpers", () => {
  it("reads the flag and matches selectors", () => {
    const scene = createMockScene();
    expect(getStored(scene)).toEqual({});
    scene._store(aura("a"));
    expect(Object.keys(getStored(scene))).toEqual(["a"]);
    expect(matches(aura("a"), { name: "aura:a" })).toBe(true);
    expect(matches(aura("a"), { id: "b" })).toBe(false);
    expect(referencesToken({ attachTo: { tokenId: "t" } }, "t")).toBe(true);
    expect(referencesToken({ atLocation: { x: 1, y: 1 } }, "t")).toBe(false);
  });

  it("collects persistent effects with scene and users inherited", () => {
    const seq = createSequence(
      [
        { type: "effect", effect: { id: "a", file: "f", atLocation: { x: 0, y: 0 }, persist: true } },
        { type: "effect", effect: { id: "b", file: "f", atLocation: { x: 0, y: 0 } } }
      ],
      { sceneId: "scene1", users: ["u"] }
    );
    const byScene = collectPersistent(seq, resolveEffect);
    expect([...byScene.keys()]).toEqual(["scene1"]);
    expect(byScene.get("scene1")).toEqual([expect.objectContaining({ id: "a", sceneId: "scene1", users: ["u"] })]);
  });
});

describe("persistence writes", () => {
  it("a GM writes the scene flag directly", async () => {
    const world = createWorld([GM]);
    const [gm] = world.clients;
    await gm.api.effects.store(createSequence([{ type: "effect", effect: aura("a") }], { sceneId: "scene1" }));
    expect(world.scene.flags[MODULE_ID].effects.a).toMatchObject({ id: "a", persist: true, sceneId: "scene1" });
    expect(gm.api.effects.list()).toHaveLength(1);
    expect(gm.api.effects.list({ name: "aura:zzz" })).toHaveLength(0);
  });

  it("players ask the active GM over the socket; only the active GM writes", async () => {
    const GM2 = { id: "gm2", isGM: true };
    const world = createWorld([GM, GM2, P1]);
    const [, , player] = world.clients;
    await player.api.effects.store(createSequence([{ type: "effect", effect: aura("a") }], { sceneId: "scene1" }));
    await flush();
    expect(player.socket.emitted[0].payload).toMatchObject({ type: "effectsWrite", data: { op: "set" } });
    expect(world.scene.update).toHaveBeenCalledTimes(1);
    expect(getStored(world.scene).a).toMatchObject({ id: "a", userId: "p1" });
  });

  it("warns when no GM is connected", async () => {
    const world = createWorld([P1]);
    world.activeGM = null;
    await world.clients[0].api.effects.store(
      createSequence([{ type: "effect", effect: aura("a") }], { sceneId: "scene1" })
    );
    expect(world.warn).toHaveBeenCalledWith("SVA.Net.NoGM", expect.any(String));
    expect(world.clients[0].socket.emitted).toHaveLength(0);
  });

  it("ignores malformed write requests", async () => {
    const world = createWorld([GM]);
    await world.clients[0].manager.onWriteRequest({ op: "drop tables", sceneId: "scene1" });
    await world.clients[0].manager.onWriteRequest({ op: "set", sceneId: "scene1", effects: [{ id: "x" }] });
    expect(world.scene.update).not.toHaveBeenCalled();
  });
});

describe("ending effects", () => {
  let world;
  beforeEach(async () => {
    world = createWorld([GM, P1, P2]);
    world.scene._store(aura("a", { userId: "p1" }), aura("b"));
    for (const c of world.clients) await c.manager.replay(world.scene);
  });

  it("replays stored effects on canvasReady, once", async () => {
    const [gm] = world.clients;
    expect(gm.api.engine.play).toHaveBeenCalledTimes(2);
    await gm.manager.replay(world.scene);
    expect(gm.api.engine.play).toHaveBeenCalledTimes(2);
  });

  it("end by name removes the flag and ends the effect on all clients", async () => {
    const [, player, other] = world.clients;
    await player.api.effects.end({ name: "aura:a" });
    await flush();
    expect(getStored(world.scene).a).toBeUndefined();
    expect(getStored(world.scene).b).toBeDefined();
    for (const c of world.clients) {
      expect(c.api.engine.end).toHaveBeenCalledWith("a");
      expect(c.api.engine.end).not.toHaveBeenCalledWith("b");
    }
    expect(other.api.engine.end).toHaveBeenCalledTimes(1);
  });

  it("the flag update alone ends effects everywhere", async () => {
    const [gm, , other] = world.clients;
    await gm.manager.applyWrite({ op: "delete", sceneId: "scene1", ids: ["b"] });
    expect(other.api.engine.end).toHaveBeenCalledWith("b");
  });

  it("endAll clears the scene", async () => {
    const [gm, player] = world.clients;
    await gm.api.effects.endAll();
    await flush();
    expect(getStored(world.scene)).toEqual({});
    expect(player.api.engine.handles.size).toBe(0);
  });

  it("deleting a token ends its effects and removes them from the flag", async () => {
    world.scene._store(aura("c", { atLocation: { x: 0, y: 0 }, attachTo: undefined }));
    const tokenDoc = { id: "tok1", parent: { id: "scene1" } };
    for (const c of world.clients) await c.manager.onTokenDeleted(tokenDoc);
    expect(getStored(world.scene)).toEqual({ c: expect.objectContaining({ id: "c" }) });
    for (const c of world.clients) expect([...c.api.engine.handles.keys()]).toEqual([]);
  });

  it("requires an id or a name", async () => {
    await expect(world.clients[0].api.effects.end({})).rejects.toThrow();
  });
});

describe("write permissions", () => {
  const set = (...effects) => ({ op: "set", sceneId: "scene1", effects });
  let world;
  let gm;
  beforeEach(() => {
    world = createWorld([GM, P1, P2]);
    [gm] = world.clients;
    world.scene._store(aura("mine", { userId: "p1" }), aura("legacy"));
  });

  it("records the creator; only the creator or a GM may overwrite or delete", async () => {
    await gm.manager.onWriteRequest(set(aura("new")), from("p2"));
    expect(getStored(world.scene).new.userId).toBe("p2");
    await gm.manager.onWriteRequest(set(aura("mine", { file: "jb2a.other" })), from("p2"));
    await gm.manager.onWriteRequest({ op: "delete", sceneId: "scene1", ids: ["mine", "legacy"] }, from("p2"));
    expect(getStored(world.scene).mine.file).toBe("jb2a.aura");
    expect(getStored(world.scene).legacy).toBeDefined();

    await gm.manager.onWriteRequest({ op: "delete", sceneId: "scene1", ids: ["mine", "legacy"] }, from("p1"));
    expect(Object.keys(getStored(world.scene))).toEqual(["legacy", "new"]);
    await gm.manager.onWriteRequest({ op: "delete", sceneId: "scene1", ids: ["legacy", "new"] }, from("gm"));
    expect(getStored(world.scene)).toEqual({});
  });

  it("deletes several ids in one scene update", async () => {
    await gm.manager.applyWrite({ op: "delete", sceneId: "scene1", ids: ["mine", "legacy", "ghost"] });
    expect(world.scene.update).toHaveBeenCalledTimes(1);
    expect(world.scene.update).toHaveBeenCalledWith({
      [`flags.${MODULE_ID}.effects.-=mine`]: null,
      [`flags.${MODULE_ID}.effects.-=legacy`]: null
    });
    expect(world.scene.unsetFlag).not.toHaveBeenCalled();
  });

  it("clear is GM-only and needs a verified GM", async () => {
    const clear = { op: "clear", sceneId: "scene1" };
    await gm.manager.onWriteRequest(clear, from("p1"));
    await gm.manager.onWriteRequest(clear, from("gm", false));
    expect(Object.keys(getStored(world.scene))).toHaveLength(2);
    await gm.manager.onWriteRequest(clear, from("gm"));
    expect(getStored(world.scene)).toEqual({});
  });

  it("an unverified GM claim is treated like that user without GM rights", async () => {
    await gm.manager.onWriteRequest({ op: "delete", sceneId: "scene1", ids: ["mine"] }, from("gm", false));
    expect(getStored(world.scene).mine).toBeDefined();
  });

  it("rejects unknown or disconnected senders and unknown scenes", async () => {
    world.clients[2].user.active = false;
    try {
      await gm.manager.onWriteRequest(set(aura("x")), from("p2", false));
      await gm.manager.onWriteRequest(set(aura("y")), from("ghost"));
      await gm.manager.onWriteRequest({ ...set(aura("z")), sceneId: "nowhere" }, from("p1"));
      expect(world.scene.update).not.toHaveBeenCalled();
      // The server vouches for the id: connection state does not matter.
      await gm.manager.onWriteRequest(set(aura("x")), from("p2"));
      expect(getStored(world.scene).x).toBeDefined();
    } finally {
      world.clients[2].user.active = true;
    }
  });
});

describe("end while a set is in flight", () => {
  it("the GM drops a set for an id ended in the last 10 s", async () => {
    const world = createWorld([GM, P1]);
    const [gm, player] = world.clients;
    // The end reaches the GM before the player's earlier set request.
    gm.manager.endLocal({ sceneId: "scene1", id: "late" });
    await gm.manager.onWriteRequest({ op: "set", sceneId: "scene1", effects: [aura("late")] }, from("p1"));
    expect(getStored(world.scene).late).toBeUndefined();

    // Ids matched by name on the GM's live effects count too.
    await gm.api.engine.play(aura("named"));
    await player.api.effects.end({ name: "aura:named" });
    await flush();
    await gm.manager.onWriteRequest({ op: "set", sceneId: "scene1", effects: [aura("named")] }, from("p1"));
    expect(getStored(world.scene).named).toBeUndefined();

    world.time += 10_000;
    await gm.manager.onWriteRequest({ op: "set", sceneId: "scene1", effects: [aura("late")] }, from("p1"));
    expect(getStored(world.scene).late).toBeDefined();
  });
});

describe("replay filters", () => {
  it("skips replay when this client disabled effects", async () => {
    const world = createWorld([GM]);
    const [gm] = world.clients;
    gm.api.net.prefs = { filterEffect: () => null };
    world.scene._store(aura("a"));
    await gm.manager.replay(world.scene);
    expect(gm.api.engine.play).not.toHaveBeenCalled();
  });
});

describe("effects area wiring", () => {
  beforeEach(() => {
    globalThis.canvas = { scene: null };
  });
  afterEach(() => {
    delete globalThis.canvas;
    delete game.scenes;
  });

  it("attaches api.effects, registers hooks and stores through playSequence", async () => {
    const scene = createMockScene("scene1");
    game.scenes = new Map([["scene1", scene]]);
    game.user = { id: "gm", isGM: true };
    canvas.scene = scene;
    const api = { engine: createMockEngine({ autoFinishMs: 5 }) };
    sequenceArea.init(api);
    effectsArea.init(api);
    expect(Object.keys(api.effects)).toEqual(expect.arrayContaining(["list", "end", "endAll"]));
    for (const hook of ["canvasReady", "updateScene", "deleteToken"]) {
      expect(Hooks._handlers.get(hook)).toHaveLength(1);
    }

    await api.sequence().effect().file("jb2a.aura").atLocation("tok1").persist().name("aura:x").play();
    expect(api.effects.list({ name: "aura:x" })).toHaveLength(1);

    const [stored] = api.effects.list();
    api.engine.handles.clear();
    Hooks.callAll("canvasReady", { scene });
    await flush();
    expect(api.engine.play).toHaveBeenLastCalledWith(expect.objectContaining({ id: stored.id, persist: true }));
  });
});
