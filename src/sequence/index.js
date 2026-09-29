/**
 * Sequence builder and runner: api.sequence(), api.playSequence()
 * Implemented in #18 - see docs/architecture.md for the contract.
 *
 * `playSequence(desc, { broadcast: true })` on the triggering client:
 *   1. emits `play` over api.net (other clients run it with their own runner),
 *   2. hands persistent effects to `api.effects.store` (scene flags, GM-written),
 *   3. runs the sequence locally.
 * With `broadcast: false` only step 3 happens (previews, replays).
 * Users below the `netMinTriggerRole` world setting cannot play sequences at all;
 * the runner applies this client's preferences (effects disabled, reduced motion, volume).
 */
import { DESCRIPTOR_VERSION } from "../shared/descriptors.js";
import { log } from "../logger.js";
import { SequenceBuilder } from "./builder.js";
import { runSequence } from "./runner.js";

export { EffectBuilder, SequenceBuilder } from "./builder.js";
export { toAnchor } from "./anchors.js";

function validate(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || !Array.isArray(descriptor.steps)) {
    throw new Error("playSequence requires a SequenceDescriptor");
  }
  if (descriptor.version !== DESCRIPTOR_VERSION) {
    throw new Error(`Unsupported sequence descriptor version ${descriptor.version}`);
  }
}

/** Run a sequence on this client only. */
export function runLocal(api, sequence) {
  const prefs = api.net?.prefs;
  return runSequence(sequence, {
    engine: api.engine,
    userId: globalThis.game?.user?.id ?? null,
    viewedSceneId: globalThis.canvas?.scene?.id ?? null,
    filterEffect: prefs?.filterEffect ?? ((effect) => effect),
    volume: prefs?.volume?.() ?? 1
  });
}

function notifyNotAllowed() {
  const key = "SVA.Sequence.NotAllowed";
  const i18n = globalThis.game?.i18n;
  const message = i18n?.has?.(key) ? i18n.localize(key) : "You are not allowed to trigger animations.";
  globalThis.ui?.notifications?.warn(message);
}

/** @param {object} api */
export function init(api) {
  api.sequence = (options) => new SequenceBuilder(api, options);

  api.playSequence = async (descriptor, { broadcast = true } = {}) => {
    validate(descriptor);
    // #22: the world "minimum role to trigger" gates local and broadcast playback alike.
    if (api.net?.prefs && !api.net.prefs.canTrigger()) {
      notifyNotAllowed();
      return;
    }
    if (broadcast) {
      api.net?.emit("play", { sequence: descriptor });
      try {
        await api.effects?.store?.(descriptor);
      } catch (err) {
        log.error("Could not store persistent effects", err);
      }
    }
    await runLocal(api, descriptor);
  };

  api.net?.on("play", async (data) => {
    const sequence = data?.sequence;
    if (sequence?.version !== DESCRIPTOR_VERSION || !Array.isArray(sequence.steps)) return;
    await runLocal(api, sequence);
  });
}
