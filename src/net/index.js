/**
 * Socket sync and client preferences: api.net
 * Implemented in #21, #22 - see docs/architecture.md for the contract.
 *
 * One channel (`module.sargas-visual-automation`), payload `{ v: 1, type, data, senderId }`.
 * Handlers for `play` live in src/sequence, `end` / `effectsWrite` in src/effects,
 * `preload` here.
 */
import { log } from "../logger.js";
import { createNet } from "./channel.js";
import { MESSAGE_TYPES } from "./protocol.js";

export { MESSAGE_TYPES, NET_VERSION } from "./protocol.js";

/** @param {object} api */
export function init(api) {
  const net = createNet();
  net.types = MESSAGE_TYPES;

  /** Preload files locally and on every other client. */
  net.preload = async (files, { broadcast = true } = {}) => {
    const list = [files].flat().filter(Boolean);
    if (!list.length) return;
    if (broadcast) net.emit(MESSAGE_TYPES.PRELOAD, { files: list });
    await api.engine?.preload?.(list);
  };

  net.on(MESSAGE_TYPES.PRELOAD, async (data) => {
    const files = Array.isArray(data?.files) ? data.files.filter((f) => typeof f === "string") : [];
    if (files.length) await api.engine?.preload?.(files);
  });

  api.net = net;
  // VERIFY(v14): game.socket is created before the "init" hook; retried on "ready" otherwise.
  net.listen();
}

/** @param {object} api */
export function ready(api) {
  if (!api.net?.listen()) log.warn("Socket unavailable: effects will not be synchronized");
}
