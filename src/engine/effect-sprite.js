/**
 * EffectSprite (#14): one playing effect on the canvas. PIXI glue around the pure helpers in math.js / timeline.js.
 *
 * Lifecycle, driven by the engine:
 *   mount()        create the display object, start the video
 *   update(dtMs)   once per canvas tick; returns false when the effect is over
 *   requestEnd()   start ending (fade out)
 *   destroy()      remove the display object and give the texture back to the cache
 */
import { log } from "../logger.js";
import { angleTo, computeScale, parseTint, resolveAnchor, templateOf, toRadians } from "./math.js";
import { computeTimeline, DEFAULT_END_FADE, endRequestedAt, sampleEnvelope, videoStep } from "./timeline.js";

/**
 * Canvas accessors the sprite needs; the engine builds it from `canvas`.
 * @typedef {object} SpriteContext
 * @property {(tokenId: string) => object|null} getToken
 * @property {() => number} gridSize
 * @property {import("./layers.js").LayerManager} layers
 */

/** Rendered center of a token (follows its movement animation). */
export function tokenCenter(token) {
  const p = token?.mesh?.position ?? token?.center;
  return p ? { x: p.x, y: p.y } : null;
}

export class EffectSprite {
  /**
   * @param {object} params
   * @param {object} params.descriptor   Normalized EffectDescriptor.
   * @param {object} params.resolved     ResolvedFile.
   * @param {import("./texture-cache.js").TextureInstance} params.instance
   * @param {SpriteContext} params.context
   */
  constructor({ descriptor, resolved, instance, context }) {
    this.descriptor = descriptor;
    this.resolved = resolved;
    this.instance = instance;
    this.ctx = context;
    this.timeline = computeTimeline(descriptor, instance.duration);
    this.elapsed = 0;
    this.endAt = this.timeline.total;
    this.fadeOut = descriptor.fadeOut;
    this.ending = false;
    this.display = null;
    // Database files follow the JB2A grid convention; direct URLs are drawn at their native size.
    this.template = resolved?.template || resolved?.path ? templateOf(resolved) : null;
  }

  get video() {
    return this.instance.video;
  }

  /** Current canvas point of the effect, or null when its token is gone. */
  position() {
    return resolveAnchor(this.descriptor.atLocation, (id) => tokenCenter(this.ctx.getToken(id)));
  }

  async mount() {
    this.display = this.ctx.layers.create(this.instance.texture, this.descriptor);
    const tint = parseTint(this.descriptor.tint);
    if (tint !== null) this.display.tint = tint;
    this.refresh();
    const video = this.video;
    if (video) {
      video.loop = false;
      video.playbackRate = this.timeline.rate;
      video.currentTime = this.timeline.playStart / 1000;
      // Muted clones may autoplay before the first user gesture.
      await video.play().catch((err) => log.warn("Effect video could not start", err));
    }
  }

  /**
   * Advance by `dt` wall ms.
   * @returns {boolean} false when the effect is over and should be destroyed.
   */
  update(dt) {
    if (!this.display || this.display.destroyed) return false;
    this.elapsed += dt;
    if (this.elapsed >= this.endAt) return false;
    this.#stepVideo();
    return this.refresh();
  }

  #stepVideo() {
    const video = this.video;
    if (!video) return;
    const step = videoStep(this.timeline, video.currentTime * 1000);
    if (!step) return;
    if (step.seek !== undefined) video.currentTime = step.seek / 1000;
    if (step.play && video.paused) video.play().catch(() => {});
    if (step.pause && !video.paused) video.pause();
  }

  /**
   * Apply transform, opacity and scale for the current time.
   * @returns {boolean} false when an anchor disappeared.
   */
  refresh() {
    const d = this.descriptor;
    const pos = this.position();
    if (!pos) return false;
    const display = this.display;
    const env = sampleEnvelope({
      elapsed: this.elapsed,
      endAt: this.endAt,
      fadeIn: d.fadeIn,
      fadeOut: this.fadeOut,
      scaleIn: d.scaleIn,
      scaleOut: d.scaleOut
    });
    const token = d.atLocation?.tokenId ? this.ctx.getToken(d.atLocation.tokenId) : null;
    const scale = computeScale({
      texture: this.instance,
      gridSizePx: this.ctx.gridSize(),
      template: this.template,
      size: d.size,
      scaleToObject: d.scaleToObject,
      objectSize: token ? { width: token.w, height: token.h } : null,
      scale: d.scale,
      mirrorX: d.mirrorX,
      mirrorY: d.mirrorY
    });
    let rotation = toRadians(d.rotation);
    if (d.rotateTowards) {
      const target = resolveAnchor(d.rotateTowards, (id) => tokenCenter(this.ctx.getToken(id)));
      if (target) rotation += angleTo(pos, target);
    }
    display.position.set(pos.x, pos.y);
    display.rotation = rotation;
    display.scale.set(scale.x * env.scale, scale.y * env.scale);
    display.alpha = (d.opacity ?? 1) * env.alpha;
    return true;
  }

  /** Start ending: fade out (or stop right away when immediate). */
  requestEnd({ immediate = false } = {}) {
    if (!(this.fadeOut?.duration > 0)) this.fadeOut = { duration: DEFAULT_END_FADE };
    this.endAt = endRequestedAt({ elapsed: this.elapsed, endAt: this.endAt, immediate, fadeOut: this.fadeOut });
    this.ending = true;
  }

  destroy() {
    this.video?.pause();
    this.ctx.layers.release(this.display);
    this.display = null;
  }
}
