import { describe, expect, it, vi } from "vitest";
import { SOCKET_NAME } from "../../src/constants.js";
import { createNet } from "../../src/net/channel.js";
import { createPayload, MESSAGE_TYPES, NET_VERSION, parsePayload } from "../../src/net/protocol.js";
import * as netArea from "../../src/net/index.js";
import { createSocketHub, flush } from "./helpers/socket.js";

function twoClients() {
  const hub = createSocketHub();
  const a = hub.createSocket("userA");
  const b = hub.createSocket("userB");
  const netA = createNet({ getSocket: () => a, getUserId: () => "userA" });
  const netB = createNet({ getSocket: () => b, getUserId: () => "userB" });
  netA.listen();
  netB.listen();
  return { a, b, netA, netB };
}

describe("protocol", () => {
  it("builds versioned payloads", () => {
    expect(createPayload("play", { x: 1 }, "u")).toEqual({
      v: NET_VERSION,
      type: "play",
      data: { x: 1 },
      senderId: "u"
    });
    expect(() => createPayload("")).toThrow();
  });

  it("rejects unknown versions and malformed payloads", () => {
    expect(parsePayload({ v: 2, type: "play" })).toBeNull();
    expect(parsePayload({ v: 1 })).toBeNull();
    expect(parsePayload("nope")).toBeNull();
    expect(parsePayload({ v: 1, type: "play", data: null })).not.toBeNull();
  });

  it("lists the contract message types", () => {
    expect(Object.values(MESSAGE_TYPES).sort()).toEqual(["effectsWrite", "end", "play", "preload"]);
  });
});

describe("createNet", () => {
  it("emits on the module channel and delivers to other clients", async () => {
    const { a, netB, netA } = twoClients();
    const handler = vi.fn();
    netB.on("play", handler);
    netA.emit("play", { sequence: { id: "s" } });
    await flush();
    expect(a.emitted[0].name).toBe(SOCKET_NAME);
    expect(a.emitted[0].payload).toEqual({
      v: 1,
      type: "play",
      data: { sequence: { id: "s" } },
      senderId: "userA"
    });
    expect(handler).toHaveBeenCalledWith({ sequence: { id: "s" } }, expect.objectContaining({ senderId: "userA" }));
  });

  it("does not deliver to the sender itself", async () => {
    const { netA } = twoClients();
    const handler = vi.fn();
    netA.on("play", handler);
    await netA.receive(createPayload("play", {}, "userA"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores unknown versions and unknown types", async () => {
    const { netB } = twoClients();
    const handler = vi.fn();
    netB.on("play", handler);
    await netB.receive({ v: 99, type: "play", data: {}, senderId: "userA" });
    await netB.receive({ v: 1, type: "mystery", data: {}, senderId: "userA" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes handlers", async () => {
    const { netB } = twoClients();
    const handler = vi.fn();
    const off = netB.on("end", handler);
    off();
    await netB.receive(createPayload("end", {}, "userA"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates handler errors", async () => {
    const { netB } = twoClients();
    const second = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    netB.on("end", () => {
      throw new Error("boom");
    });
    netB.on("end", second);
    await netB.receive(createPayload("end", {}, "userA"));
    expect(second).toHaveBeenCalled();
  });

  it("prefers the server-provided sender id", async () => {
    const { netB } = twoClients();
    const handler = vi.fn();
    netB.on("end", handler);
    await netB.receive(createPayload("end", {}, "spoofed"), "userA");
    expect(handler.mock.calls[0][1]).toMatchObject({ senderId: "userA", verified: true });
  });

  it("marks a client-claimed sender id as unverified", async () => {
    const { netB } = twoClients();
    const handler = vi.fn();
    netB.on("end", handler);
    await netB.receive({ ...createPayload("end", {}, "userA"), verified: true });
    expect(handler.mock.calls[0][1]).toMatchObject({ senderId: "userA", verified: false });
  });

  it("applies the accept filter", async () => {
    const net = createNet({ getSocket: () => null, getUserId: () => "me", accept: (p) => p.senderId === "ok" });
    const handler = vi.fn();
    net.on("end", handler);
    await net.receive(createPayload("end", {}, "bad"));
    await net.receive(createPayload("end", {}, "ok"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("net area", () => {
  it("attaches api.net, listens on game.socket and handles preload", async () => {
    const hub = createSocketHub();
    game.socket = hub.createSocket("user1");
    const other = hub.createSocket("user2");
    const api = { engine: { preload: vi.fn(async () => {}) } };
    netArea.init(api);
    expect(api.net.channel).toBe(SOCKET_NAME);
    expect(game.socket._listeners.has(SOCKET_NAME)).toBe(true);

    other.emit(SOCKET_NAME, createPayload("preload", { files: ["jb2a.a", 3] }, "user2"));
    await flush();
    expect(api.engine.preload).toHaveBeenCalledWith(["jb2a.a"]);

    await api.net.preload(["jb2a.b"]);
    expect(api.engine.preload).toHaveBeenLastCalledWith(["jb2a.b"]);
    expect(game.socket.emitted.at(-1).payload).toMatchObject({ type: "preload", data: { files: ["jb2a.b"] } });
  });

  it("caps incoming preload lists and splits outgoing ones", async () => {
    const hub = createSocketHub();
    game.socket = hub.createSocket("user1");
    const other = hub.createSocket("user2");
    const api = { engine: { preload: vi.fn(async () => {}) } };
    netArea.init(api);
    const many = Array.from({ length: 120 }, (_, i) => `jb2a.f${i}`);

    other.emit(SOCKET_NAME, createPayload("preload", { files: many }, "user2"));
    await flush();
    expect(api.engine.preload).toHaveBeenCalledWith(many.slice(0, netArea.PRELOAD_MAX_FILES));

    await api.net.preload(many);
    const sent = game.socket.emitted.map((e) => e.payload.data.files);
    expect(sent.map((f) => f.length)).toEqual([50, 50, 20]);
    expect(sent.flat()).toEqual(many);
  });
});
