/**
 * Socket sync and client preferences: api.net
 * Implemented in #21, #22 - see docs/architecture.md for the contract.
 *
 * One channel (`module.sargas-visual-automation`), payload `{ v: 1, type, data, senderId }`.
 * Handlers for `play` live in src/sequence, `end` / `effectsWrite` in src/effects,
 * `preload` here. Incoming messages are dropped when the sender's role is below the
 * `netMinTriggerRole` world setting (removals excepted, see isRemoval). Handlers get `payload.verified` (see ./channel.js)
 * and use `resolveSender` before granting GM rights.
 */
import { log } from "../logger.js";
import { createNet } from "./channel.js";
import * as prefs from "./preferences.js";
import { MESSAGE_TYPES } from "./protocol.js";

export { MESSAGE_TYPES, NET_VERSION } from "./protocol.js";
export { NET_SETTINGS, resolveSender } from "./preferences.js";

/** Most files one `preload` message may ask for. */
export const PRELOAD_MAX_FILES = 50;

/**
 * Ending one effect and deleting stored ones are accepted from users below the minimum trigger role, so an aura
 * stored before the role was raised can still end. The effects manager decides which deletions are allowed.
 */
function isRemoval({ type, data } = {}) {
  if (type === MESSAGE_TYPES.END) return !data?.all;
  return type === MESSAGE_TYPES.EFFECTS_WRITE && data?.op === "delete";
}

/** @param {object} api */
export function init(api) {
  prefs.registerNetSettings({
    onEffectsDisabled: (disabled) => {
      if (disabled) api.engine?.endAll?.();
    }
  });

  const net = createNet({
    accept: (payload) =>
      prefs.senderAllowed(payload.senderId, { verified: payload.verified, anyRole: isRemoval(payload) })
  });
  net.types = MESSAGE_TYPES;

  /** Client preferences and permission helpers (read live from settings). */
  net.prefs = {
    canTrigger: prefs.canTrigger,
    effectsDisabled: prefs.effectsDisabled,
    reducedMotion: prefs.reducedMotion,
    volume: prefs.getVolume,
    filterEffect: prefs.filterEffect
  };

  /** Preload files locally and on every other client. */
  net.preload = async (files, { broadcast = true } = {}) => {
    const list = [files].flat().filter(Boolean);
    if (!list.length) return;
    if (broadcast) {
      // Receivers ignore anything past PRELOAD_MAX_FILES in one message.
      for (let i = 0; i < list.length; i += PRELOAD_MAX_FILES) {
        net.emit(MESSAGE_TYPES.PRELOAD, { files: list.slice(i, i + PRELOAD_MAX_FILES) });
      }
    }
    if (!prefs.effectsDisabled()) await api.engine?.preload?.(list);
  };

  net.on(MESSAGE_TYPES.PRELOAD, async (data) => {
    const files = Array.isArray(data?.files)
      ? data.files.filter((f) => typeof f === "string" && f).slice(0, PRELOAD_MAX_FILES)
      : [];
    if (files.length && !prefs.effectsDisabled()) await api.engine?.preload?.(files);
  });

  api.net = net;
  // VERIFY(v14): game.socket is created before the "init" hook; retried on "ready" otherwise.
  net.listen();
}

/** @param {object} api */
export function ready(api) {
  if (!api.net?.listen()) log.warn("Socket unavailable: effects will not be synchronized");
}
