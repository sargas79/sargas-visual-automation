import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNet } from "../../src/net/channel.js";
import * as sequenceArea from "../../src/sequence/index.js";
import { createSocketHub, flush } from "../net/helpers/socket.js";
import { createMockEngine } from "./helpers/engine.js";

/** One simulated client: its own api, engine and socket on a shared hub. */
function createClient(hub, userId) {
  const socket = hub.createSocket(userId);
  const net = createNet({ getSocket: () => socket, getUserId: () => userId });
  net.listen();
  const api = { engine: createMockEngine({ autoFinishMs: 10 }), net };
  sequenceArea.init(api);
  return { api, socket };
}

describe("api.playSequence", () => {
  beforeEach(() => {
    globalThis.canvas = { scene: { id: "scene1" } };
  });
  afterEach(() => {
    delete globalThis.canvas;
  });

  it("broadcasts and runs on every client", async () => {
    const hub = createSocketHub();
    const gm = createClient(hub, "user1");
    const player = createClient(hub, "user2");
    await gm.api.sequence().effect().file("jb2a.fire_bolt.orange").atLocation({ x: 1, y: 2 }).play();
    await flush();
    expect(gm.api.engine.play).toHaveBeenCalledTimes(1);
    expect(player.api.engine.play).toHaveBeenCalledTimes(1);
    expect(gm.socket.emitted[0].payload).toMatchObject({ v: 1, type: "play", senderId: "user1" });
  });

  it("runs only locally without broadcast", async () => {
    const hub = createSocketHub();
    const gm = createClient(hub, "user1");
    const player = createClient(hub, "user2");
    await gm.api.sequence().effect().file("a").atLocation("t").play({ broadcast: false });
    await flush();
    expect(gm.api.engine.play).toHaveBeenCalledTimes(1);
    expect(player.api.engine.play).not.toHaveBeenCalled();
  });

  it("hands broadcast sequences to api.effects.store", async () => {
    const hub = createSocketHub();
    const { api } = createClient(hub, "user1");
    api.effects = { store: vi.fn(async () => {}) };
    const desc = api.sequence().effect().file("a").atLocation("t").persist().toDescriptor();
    await api.playSequence(desc);
    expect(api.effects.store).toHaveBeenCalledWith(desc);
    await api.playSequence(desc, { broadcast: false });
    expect(api.effects.store).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid descriptors", async () => {
    const { api } = createClient(createSocketHub(), "user1");
    await expect(api.playSequence({})).rejects.toThrow();
    await expect(api.playSequence({ version: 2, steps: [] })).rejects.toThrow();
  });
});
