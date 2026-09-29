import { createSequence } from "../shared/descriptors.js";
import { toAnchor, toTokenId, toUserIds } from "./anchors.js";

/**
 * Chainable builder for one effect step. Every setter returns the builder;
 * the sequence-level methods (`effect`, `wait`, `sound`, `toDescriptor`, `play`)
 * are forwarded to the parent sequence so a macro can keep chaining:
 *
 * ```js
 * await SVA.sequence()
 *   .effect().file("jb2a.fire_bolt.orange").atLocation(source).stretchTo(target).waitUntilFinished(-500)
 *   .effect().file("jb2a.explosion.01.orange").atLocation(target)
 *   .play();
 * ```
 */
export class EffectBuilder {
  /**
   * @param {SequenceBuilder} sequence
   * @param {object} [initial]  Partial EffectDescriptor (anchors are converted).
   */
  constructor(sequence, initial = {}) {
    this._sequence = sequence;
    /** @type {Record<string, *>} */
    this._data = {};
    /** @type {number|null} */
    this._waitUntilFinished = null;
    for (const [key, value] of Object.entries(initial ?? {})) {
      if (value === undefined) continue;
      if (["atLocation", "stretchTo", "rotateTowards"].includes(key)) this._data[key] = toAnchor(value);
      else if (key === "attachTo") this.attachTo(value, value);
      else if (key === "users") this.forUsers(value);
      else if (key === "waitUntilFinished") this.waitUntilFinished(value);
      else this._data[key] = structuredClone(value);
    }
  }

  _set(key, value) {
    if (value === undefined) delete this._data[key];
    else this._data[key] = value;
    return this;
  }

  /** JB2A database path ("jb2a.fire_bolt.orange") or a direct file URL. */
  file(file) {
    return this._set("file", file);
  }
  /** Explicit effect id (useful for persistent effects you want to end by id). */
  id(id) {
    return this._set("id", id);
  }
  atLocation(anchor, { offset } = {}) {
    return this._set("atLocation", toAnchor(anchor, { offset }));
  }
  stretchTo(anchor, { offset } = {}) {
    return this._set("stretchTo", toAnchor(anchor, { offset }));
  }
  rotateTowards(anchor, { offset } = {}) {
    return this._set("rotateTowards", toAnchor(anchor, { offset }));
  }
  /** @param {*} token  Token, TokenDocument or token id. */
  attachTo(token, { followRotation } = {}) {
    const tokenId = toTokenId(token);
    if (!tokenId) throw new Error("attachTo requires a token, token document or token id");
    const attach = { tokenId };
    if (followRotation !== undefined) attach.followRotation = !!followRotation;
    return this._set("attachTo", attach);
  }
  /** @param {number|{x:number,y:number}} scale */
  scale(scale) {
    return this._set("scale", typeof scale === "object" ? { x: scale.x, y: scale.y } : scale);
  }
  scaleToObject(factor = 1) {
    return this._set("scaleToObject", factor);
  }
  size(width, height, { gridUnits } = {}) {
    const size = { width, height: height ?? width };
    if (gridUnits) size.gridUnits = true;
    return this._set("size", size);
  }
  rotate(degrees) {
    return this._set("rotation", degrees);
  }
  mirrorX(value = true) {
    return this._set("mirrorX", !!value);
  }
  mirrorY(value = true) {
    return this._set("mirrorY", !!value);
  }
  opacity(value) {
    return this._set("opacity", value);
  }
  tint(hex) {
    return this._set("tint", hex);
  }
  fadeIn(duration, { ease } = {}) {
    return this._set("fadeIn", withEase({ duration }, ease));
  }
  fadeOut(duration, { ease } = {}) {
    return this._set("fadeOut", withEase({ duration }, ease));
  }
  scaleIn(value, duration, { ease } = {}) {
    return this._set("scaleIn", withEase({ value, duration }, ease));
  }
  scaleOut(value, duration, { ease } = {}) {
    return this._set("scaleOut", withEase({ value, duration }, ease));
  }
  duration(ms) {
    return this._set("duration", ms);
  }
  playbackRate(rate) {
    return this._set("playbackRate", rate);
  }
  startTime(ms) {
    return this._set("startTime", ms);
  }
  endTime(ms) {
    return this._set("endTime", ms);
  }
  delay(ms) {
    return this._set("delay", ms);
  }
  layer(name) {
    return this._set("layer", name);
  }
  zIndex(value) {
    return this._set("zIndex", value);
  }
  missed(value = true) {
    return this._set("missed", !!value);
  }
  returnTrip(value = true) {
    return this._set("returnTrip", !!value);
  }
  persist(value = true) {
    return this._set("persist", !!value);
  }
  name(tag) {
    return this._set("name", tag);
  }
  /** Only these users see the effect (User documents or ids). Empty = everyone. */
  forUsers(users) {
    return this._set("users", toUserIds(users));
  }
  /** Scene the effect plays on (defaults to the sequence scene). */
  onScene(sceneId) {
    return this._set("sceneId", sceneId);
  }
  /**
   * Wait for this effect to end before the next step.
   * @param {number} [offsetMs=0]  Negative continues that many ms before the end.
   */
  waitUntilFinished(offsetMs = 0) {
    this._waitUntilFinished = offsetMs === null ? null : Number(offsetMs) || 0;
    return this;
  }

  /** @returns {import("../shared/descriptors.js").EffectStep} */
  toStep() {
    const step = { type: "effect", effect: structuredClone(this._data) };
    if (this._waitUntilFinished !== null) step.waitUntilFinished = this._waitUntilFinished;
    return step;
  }

  // Forwarded to the sequence so chains read naturally.
  effect(initial) {
    return this._sequence.effect(initial);
  }
  wait(ms) {
    return this._sequence.wait(ms);
  }
  sound(file, options) {
    return this._sequence.sound(file, options);
  }
  toDescriptor() {
    return this._sequence.toDescriptor();
  }
  play(options) {
    return this._sequence.play(options);
  }
}

function withEase(data, ease) {
  return ease ? { ...data, ease } : data;
}

/** Chainable sequence builder returned by `api.sequence()`. */
export class SequenceBuilder {
  /**
   * @param {object} api  The module api (needs `playSequence`).
   * @param {{sceneId?: string, userId?: string, users?: Array<string|object>}} [options]
   */
  constructor(api, { sceneId, userId, users } = {}) {
    this._api = api;
    this._options = { sceneId, userId, users: users ? toUserIds(users) : undefined };
    /** @type {Array<EffectBuilder|object>} */
    this._steps = [];
  }

  /** @param {object} [initial] Partial EffectDescriptor. */
  effect(initial) {
    const builder = new EffectBuilder(this, initial);
    this._steps.push(builder);
    return builder;
  }

  wait(ms) {
    this._steps.push({ type: "wait", ms: Math.max(0, Number(ms) || 0) });
    return this;
  }

  /**
   * @param {string} file  Audio file URL.
   * @param {{volume?: number, delay?: number, waitUntilFinished?: number|null}} [options]
   */
  sound(file, { volume, delay, waitUntilFinished } = {}) {
    if (!file) throw new Error("sound() requires a file");
    const step = { type: "sound", file };
    if (volume !== undefined) step.volume = volume;
    if (delay !== undefined) step.delay = delay;
    if (waitUntilFinished !== undefined && waitUntilFinished !== null) step.waitUntilFinished = waitUntilFinished;
    this._steps.push(step);
    return this;
  }

  /** Scene the sequence plays on (default: the viewed scene). */
  onScene(sceneId) {
    this._options.sceneId = sceneId;
    return this;
  }

  /** Visibility whitelist for every step. */
  forUsers(users) {
    this._options.users = toUserIds(users);
    return this;
  }

  /** @returns {import("../shared/descriptors.js").SequenceDescriptor} */
  toDescriptor() {
    const steps = this._steps.map((s) => (s instanceof EffectBuilder ? s.toStep() : { ...s }));
    return createSequence(steps, this._options);
  }

  /** Play everywhere (or only here with `broadcast: false`). */
  play({ broadcast = true } = {}) {
    return this._api.playSequence(this.toDescriptor(), { broadcast });
  }
}
