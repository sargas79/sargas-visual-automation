import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import { createNet } from "../../src/net/channel.js";
import * as prefs from "../../src/net/preferences.js";
import * as sequenceArea from "../../src/sequence/index.js";
import { createSocketHub, flush } from "../net/helpers/socket.js";
import { createMockEngine } from "./helpers/engine.js";

/**
 * Simulated client. Settings are global in the mock, so each client gets its
 * own preference overrides instead of reading game.settings.
 */
function createClient(hub, userId, { disabled = false, volume = 1 } = {}) {
  const socket = hub.createSocket(userId);
  const net = createNet({ getSocket: () => socket, getUserId: () => userId });
  net.listen();
  net.prefs = {
    canTrigger: prefs.canTrigger,
    filterEffect: (effect) => (disabled ? null : effect),
    volume: () => volume
  };
  const api = { engine: createMockEngine({ autoFinishMs: 5 }), net };
  sequenceArea.init(api);
  return { api, socket };
}

describe("playSequence with preferences", () => {
  beforeEach(() => {
    globalThis.canvas = { scene: { id: "scene1" } };
    prefs.registerNetSettings();
  });
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.ui;
  });

  it("a client with effects disabled sees nothing; others are unaffected", async () => {
    const hub = createSocketHub();
    const gm = createClient(hub, "user1");
    const off = createClient(hub, "user2", { disabled: true });
    const on = createClient(hub, "user3");
    await gm.api.sequence().effect().file("a").atLocation("t").play();
    await flush();
    expect(gm.api.engine.play).toHaveBeenCalledTimes(1);
    expect(on.api.engine.play).toHaveBeenCalledTimes(1);
    expect(off.api.engine.play).not.toHaveBeenCalled();
  });

  it("blocks users below the minimum role, with a warning", async () => {
    globalThis.ui = { notifications: { warn: vi.fn() } };
    await game.settings.set(MODULE_ID, prefs.NET_SETTINGS.MIN_TRIGGER_ROLE, 2);
    game.user = { id: "user2", isGM: false, role: 1 };
    const hub = createSocketHub();
    const client = createClient(hub, "user2");
    await client.api.sequence().effect().file("a").atLocation("t").play();
    expect(client.socket.emitted).toHaveLength(0);
    expect(client.api.engine.play).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalled();
  });

  it("scales sound volume by the client volume", async () => {
    const hub = createSocketHub();
    const client = createClient(hub, "user1", { volume: 0.5 });
    const play = vi.fn(() => null);
    globalThis.foundry = { audio: { AudioHelper: { play } } };
    await client.api.sequence().sound("s.ogg", { volume: 0.8 }).play({ broadcast: false });
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ src: "s.ogg", volume: 0.4 }), false);
    delete globalThis.foundry;
  });
});
