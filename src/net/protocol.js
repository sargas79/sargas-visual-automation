/**
 * Socket payload schema (#21). Every message on the module channel is
 * `{ v: 1, type, data, senderId }`. Messages with another `v` are ignored so
 * mixed module versions in one world never misinterpret each other.
 */

export const NET_VERSION = 1;

/** Message types understood by this version. */
export const MESSAGE_TYPES = Object.freeze({
  /** data: { sequence: SequenceDescriptor } - run the sequence locally. */
  PLAY: "play",
  /** data: { sceneId, id?, name?, all? } - end matching live effects locally. */
  END: "end",
  /** data: { files: string[] } - warm the engine cache. */
  PRELOAD: "preload",
  /** data: { op: "set"|"delete"|"clear", sceneId, effects?, ids? } - request to the active GM to write scene flags. */
  EFFECTS_WRITE: "effectsWrite"
});

/**
 * @typedef {object} NetPayload
 * @property {number} v          NET_VERSION.
 * @property {string} type       One of MESSAGE_TYPES (unknown types are delivered to nobody).
 * @property {*} data            Plain JSON.
 * @property {string|null} senderId  User id of the emitting client.
 */

/** @returns {NetPayload} */
export function createPayload(type, data, senderId) {
  if (typeof type !== "string" || !type) throw new Error("Net message requires a type");
  return { v: NET_VERSION, type, data: data ?? null, senderId: senderId ?? null };
}

/**
 * Validate an incoming payload.
 * @returns {NetPayload|null} the payload, or null when it must be ignored.
 */
export function parsePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.v !== NET_VERSION) return null;
  if (typeof payload.type !== "string" || !payload.type) return null;
  return payload;
}
