/**
 * Effect timing (pure): which part of the video plays, for how long, and the fade / scale envelope.
 *
 * Two clocks are involved:
 * - **video time** (ms into the file) drives which frames show: [playStart, playEnd] after startTime / endTime;
 * - **wall time** (`elapsed`, ms since the effect appeared) drives the lifetime, fades and scale-in/out.
 *   One pass of the clip lasts `segment = (playEnd - playStart) / playbackRate` wall ms.
 */
import { easedProgress } from "./easing.js";

/** Lifetime of a static image without an explicit duration. */
export const DEFAULT_IMAGE_DURATION = 1000;
/** Fade used when a persistent effect without fadeOut is ended (so it does not pop). */
export const DEFAULT_END_FADE = 500;
/** Tolerance when comparing video time with segment boundaries (a frame at 60 fps). */
export const VIDEO_EPSILON = 17;

/**
 * @typedef {object} Timeline
 * @property {boolean} isStatic   Image (or a video with unknown length): no video control.
 * @property {number} rate        Playback rate (> 0).
 * @property {number} playStart   Video ms where playback starts.
 * @property {number} playEnd     Video ms where playback stops.
 * @property {number} segment     Wall ms of one pass of [playStart, playEnd].
 * @property {number} total       Wall ms until the effect ends on its own (Infinity when persistent).
 * @property {boolean} repeat     Restart at playStart when playEnd is reached (forced long duration, persist).
 * @property {boolean} persist
 */

/**
 * @param {import("../shared/descriptors.js").EffectDescriptor} effect
 * @param {number} videoDuration  Length of the file in ms (0 for images).
 * @returns {Timeline}
 */
export function computeTimeline(effect, videoDuration) {
  const rate = effect.playbackRate > 0 ? effect.playbackRate : 1;
  const persist = !!effect.persist;
  const forced = effect.duration > 0 ? effect.duration : null;
  const isStatic = !(videoDuration > 0) || !Number.isFinite(videoDuration);
  if (isStatic) {
    const total = persist ? Infinity : (forced ?? DEFAULT_IMAGE_DURATION);
    return { isStatic, rate, playStart: 0, playEnd: 0, segment: total, total, repeat: false, persist };
  }
  const playStart = clamp(effect.startTime ?? 0, 0, videoDuration);
  const playEnd = clamp(videoDuration - (effect.endTime ?? 0), playStart, videoDuration);
  const segment = (playEnd - playStart) / rate;
  const total = persist ? Infinity : (forced ?? segment);
  const repeat = persist || total > segment + VIDEO_EPSILON;
  return { isStatic, rate, playStart, playEnd, segment, total, repeat, persist };
}

/**
 * What to do with the video this frame.
 * @param {Timeline} timeline
 * @param {number} videoTime  Current video time in ms.
 * @returns {{seek?: number, play?: boolean, pause?: boolean}|null}  null = nothing to do.
 */
export function videoStep(timeline, videoTime) {
  if (timeline.isStatic) return null;
  if (videoTime < timeline.playEnd - 1) return null;
  if (timeline.repeat) return { seek: timeline.playStart, play: true };
  return { pause: true };
}

/**
 * Wall time at which an effect should disappear after end() is requested.
 * @param {object} params
 * @param {number} params.elapsed        Now (wall ms).
 * @param {number} params.endAt          Current planned end (wall ms, may be Infinity).
 * @param {boolean} [params.immediate]
 * @param {{duration: number}} [params.fadeOut]
 * @returns {number}
 */
export function endRequestedAt({ elapsed, endAt, immediate, fadeOut }) {
  if (immediate) return elapsed;
  const fade = fadeOut?.duration > 0 ? fadeOut.duration : DEFAULT_END_FADE;
  return Math.min(endAt, elapsed + fade);
}

/**
 * Opacity and scale multipliers at `elapsed`.
 *   fadeIn   0 → 1 over its duration from the start
 *   fadeOut  1 → 0 over its duration before `endAt`
 *   scaleIn  value → 1 over its duration from the start
 *   scaleOut 1 → value over its duration before `endAt`
 * @returns {{alpha: number, scale: number}}
 */
export function sampleEnvelope({ elapsed, endAt, fadeIn, fadeOut, scaleIn, scaleOut }) {
  let alpha = 1;
  let scale = 1;
  const remaining = endAt - elapsed;
  if (fadeIn?.duration > 0 && elapsed < fadeIn.duration) {
    alpha *= easedProgress(elapsed, fadeIn.duration, fadeIn.ease);
  }
  if (fadeOut?.duration > 0 && remaining < fadeOut.duration) {
    alpha *= 1 - easedProgress(fadeOut.duration - remaining, fadeOut.duration, fadeOut.ease);
  }
  if (scaleIn?.duration > 0 && elapsed < scaleIn.duration) {
    const from = scaleIn.value ?? 0;
    scale *= from + (1 - from) * easedProgress(elapsed, scaleIn.duration, scaleIn.ease);
  }
  if (scaleOut?.duration > 0 && remaining < scaleOut.duration) {
    const to = scaleOut.value ?? 0;
    scale *= 1 + (to - 1) * easedProgress(scaleOut.duration - remaining, scaleOut.duration, scaleOut.ease);
  }
  return { alpha: clamp(alpha, 0, 1), scale };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
