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
import { computeStretch, missedOffset, seededRandom } from "./stretch.js";
import { computeTimeline, DEFAULT_END_FADE, endRequestedAt, legAt, sampleEnvelope, videoStep } from "./timeline.js";

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
    this.leg = 0;
    this.missOffset = null;
    // Database files follow the JB2A grid convention; direct URLs are drawn at their native size.
    this.template = resolved?.template || resolved?.path ? templateOf(resolved) : null;
  }

  get video() {
    return this.instance.video;
  }

  #anchorPoint(anchor) {
    return resolveAnchor(anchor, (id) => tokenCenter(this.ctx.getToken(id)));
  }

  /** Current canvas point of the effect, or null when its token is gone. */
  position() {
    return this.#anchorPoint(this.descriptor.atLocation);
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
    const leg = legAt(this.timeline, this.elapsed);
    if (leg !== this.leg) {
      // Return trip: replay the clip from the target back to the source.
      this.leg = leg;
      if (this.video) {
        this.video.currentTime = this.timeline.playStart / 1000;
        if (this.video.paused) this.video.play().catch(() => {});
      }
    }
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
    if (d.stretchTo) return this.#refreshStretch(pos, env);
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
      const target = this.#anchorPoint(d.rotateTowards);
      if (target) rotation += angleTo(pos, target);
    }
    display.position.set(pos.x, pos.y);
    display.rotation = rotation;
    display.scale.set(scale.x * env.scale, scale.y * env.scale);
    display.alpha = (d.opacity ?? 1) * env.alpha;
    return true;
  }

  /** Point the stretched effect flies to (the target, or beside it when missed). */
  #stretchTarget(source) {
    const d = this.descriptor;
    const target = this.#anchorPoint(d.stretchTo);
    if (!target) return null;
    if (!d.missed) return target;
    if (!this.missOffset) {
      const token = d.stretchTo.tokenId ? this.ctx.getToken(d.stretchTo.tokenId) : null;
      const gridSizePx = this.ctx.gridSize();
      this.missOffset = missedOffset({
        source,
        target,
        radius: token ? Math.max(token.w, token.h) / 2 : gridSizePx / 2,
        gridSizePx,
        rng: seededRandom(d.id)
      });
    }
    return { x: target.x + this.missOffset.x, y: target.y + this.missOffset.y };
  }

  /** Stretch from source to target (swapped on the return leg). See ./stretch.js for the math. */
  #refreshStretch(pos, env) {
    const d = this.descriptor;
    const target = this.#stretchTarget(pos);
    if (!target) return false;
    const [from, to] = this.leg === 1 ? [target, pos] : [pos, target];
    const s = computeStretch({
      source: from,
      target: to,
      texture: this.instance,
      template: this.template,
      gridSizePx: this.ctx.gridSize(),
      scale: d.scale,
      mirrorY: d.mirrorY
    });
    const display = this.display;
    display.anchor.set(s.anchorX, s.anchorY);
    display.position.set(from.x, from.y);
    display.rotation = s.rotation + toRadians(d.rotation);
    display.scale.set(s.scaleX, s.scaleY * env.scale);
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
