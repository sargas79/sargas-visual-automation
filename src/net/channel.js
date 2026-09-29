import { SOCKET_NAME } from "../constants.js";
import { log } from "../logger.js";
import { createPayload, parsePayload } from "./protocol.js";

/**
 * A single module socket channel with typed handlers.
 *
 * `emit` only reaches the OTHER clients (Foundry never echoes a socket message
 * back to its sender); callers that also need the effect locally run it themselves.
 *
 * @param {object} [options]
 * @param {() => object|null} [options.getSocket]   Defaults to `game.socket`.
 * @param {() => string|null} [options.getUserId]   Defaults to `game.user.id`.
 * @param {(payload: object) => boolean} [options.accept] Extra filter for incoming payloads (permissions).
 */
export function createNet({
  getSocket = () => globalThis.game?.socket ?? null,
  getUserId = () => globalThis.game?.user?.id ?? globalThis.game?.userId ?? null,
  accept = () => true
} = {}) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();
  let listening = false;

  const net = {
    channel: SOCKET_NAME,

    /**
     * Send a message to every other connected client.
     * @returns {object} the payload that was sent (or would have been, without a socket).
     */
    emit(type, data) {
      const payload = createPayload(type, data, getUserId());
      const socket = getSocket();
      if (socket) socket.emit(SOCKET_NAME, payload);
      else log.warn(`No socket available, "${type}" not sent`);
      return payload;
    },

    /**
     * Register a handler for a message type.
     * @param {string} type
     * @param {(data: *, payload: object) => void|Promise<void>} handler
     * @returns {() => void} unsubscribe
     */
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => net.off(type, handler);
    },

    off(type, handler) {
      handlers.get(type)?.delete(handler);
    },

    /** Start listening on the socket. Safe to call more than once. */
    listen() {
      if (listening) return true;
      const socket = getSocket();
      if (!socket) return false;
      // VERIFY(v14): module socket handlers receive (data, senderUserId); we prefer the server-provided id when present.
      socket.on(SOCKET_NAME, (payload, senderUserId) => net.receive(payload, senderUserId));
      listening = true;
      return true;
    },

    /** Dispatch an incoming payload (exposed for tests and local loopback). */
    async receive(raw, senderUserId) {
      const parsed = parsePayload(raw);
      if (!parsed) {
        log.debug("Ignoring socket message", raw);
        return;
      }
      const payload = typeof senderUserId === "string" ? { ...parsed, senderId: senderUserId } : parsed;
      const self = getUserId();
      if (self && payload.senderId === self) return;
      if (!accept(payload)) {
        log.debug(`Rejected "${payload.type}" from ${payload.senderId}`);
        return;
      }
      const list = [...(handlers.get(payload.type) ?? [])];
      for (const handler of list) {
        try {
          await handler(payload.data, payload);
        } catch (err) {
          log.error(`Socket handler for "${payload.type}" failed`, err);
        }
      }
    }
  };
  return net;
}
