/**
 * In-memory stand-in for `game.socket`. Several mock sockets can share a hub
 * to simulate multiple clients: a message emitted by one is delivered to all
 * the others (never echoed back), like Foundry's server relay.
 */
export function createSocketHub() {
  const sockets = [];
  return {
    sockets,
    createSocket(userId) {
      const listeners = new Map();
      const socket = {
        userId,
        emitted: [],
        emit(name, payload) {
          socket.emitted.push({ name, payload });
          for (const other of sockets) if (other !== socket) other._deliver(name, payload, userId);
        },
        on(name, fn) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(fn);
        },
        _deliver(name, payload, senderId) {
          for (const fn of listeners.get(name) ?? []) fn(structuredClone(payload), senderId);
        },
        _listeners: listeners
      };
      sockets.push(socket);
      return socket;
    }
  };
}

/** Let queued handlers and timers of 0 ms run. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
