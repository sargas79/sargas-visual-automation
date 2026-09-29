/**
 * EffectSprite (#14): one playing effect on the canvas. PIXI glue around the pure helpers in math.js, timeline.js,
 * stretch.js, layers.js and visibility.js.
 *
 * Lifecycle, driven by the engine:
 *   mount()        create the display object, start the video
 *   update(dtMs)   once per canvas tick; returns false when the effect is over
 *   requestEnd()   start ending (fade out)
 *   destroy()      remove the display object (the engine gives the texture back to the cache)
 */
import { log } from "../logger.js";
import { LAYERS } from "../shared/descriptors.js";
import { effectElevation } from "./layers.js";
import { addOffset, angleTo, computeScale, parseTint, resolveAnchor, templateOf, toRadians } from "./math.js";
import { computeStretch, missedOffset, seededRandom } from "./stretch.js";
import {
  computeTimeline,
  DEFAULT_END_FADE,
  endRequestedAt,
  hasOutro,
  legAt,
  sampleEnvelope,
  videoStep
} from "./timeline.js";
import { isEffectVisible, tokenState } from "./visibility.js";

/** How often (ms) a point-anchored effect re-tests the user's vision. */
const VISION_TEST_INTERVAL = 250;

/**
 * Canvas accessors the sprite needs; the environment builds it from `canvas`.
 * @typedef {object} SpriteContext
 * @property {(tokenId: string) => object|null} getToken
 * @property {() => number} gridSize
 * @property {import("./layers.js").LayerManager} layers
 * @property {() => boolean} isGM
 * @property {() => boolean} tokenVision
 * @property {(point: {x: number, y: number}) => boolean} pointVisible
 * @property {() => number} levelBase                 Elevation base of the viewed level.
 * @property {(point: {x: number, y: number}) => {x: number, y: number}} toScreen  Canvas → screen px.
 */

/** Rendered center of a token (follows its movement animation). */
export function tokenCenter(token) {
  // VERIFY(v14): Token#_refreshPosition sets mesh.position to the (animated) center.
  const p = token?.mesh?.position ?? token?.center;
  return p ? { x: p.x, y: p.y } : null;
}

/** Rendered rotation of a token in radians. */
function tokenRotation(token) {
  if (Number.isFinite(token?.mesh?.rotation)) return token.mesh.rotation;
  return toRadians(token?.document?.rotation ?? 0);
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
    this.timeline = computeTimeline(descriptor, instance.duration, resolved?.markers);
    this.elapsed = 0;
    this.endAt = this.timeline.total;
    this.fadeOut = descriptor.fadeOut;
    this.ending = false;
    this.display = null;
    this.leg = 0;
    this.missOffset = null;
    this.isScreen = descriptor.layer === LAYERS.SCREEN;
    this.visionCheckAt = -Infinity;
    this.visionResult = true;
    // Database files follow the JB2A grid convention; direct URLs (and screen effects) are drawn at native size.
    this.template = !this.isScreen && (resolved?.template || resolved?.path) ? templateOf(resolved) : null;
  }

  get video() {
    return this.instance.video;
  }

  #token(id) {
    return id ? this.ctx.getToken(id) : null;
  }

  #anchorPoint(anchor) {
    const p = resolveAnchor(anchor, (id) => tokenCenter(this.#token(id)));
    // Screen effects: raw {x, y} are screen px already; token anchors are converted.
    if (p && this.isScreen && anchor.tokenId) {
      const base = this.ctx.toScreen(tokenCenter(this.#token(anchor.tokenId)));
      return addOffset(base, anchor.offset);
    }
    return p;
  }

  /** The token the effect sits on (attached or located), for scaleToObject and followRotation. */
  #hostToken() {
    const d = this.descriptor;
    return this.#token(d.attachTo?.tokenId ?? d.atLocation?.tokenId);
  }

  /**
   * Current point of the effect, or null when its token is gone.
   * Attached effects follow their token (plus the atLocation offset, if any).
   */
  position() {
    const d = this.descriptor;
    if (d.attachTo?.tokenId) return this.#anchorPoint({ tokenId: d.attachTo.tokenId, offset: d.atLocation?.offset });
    return this.#anchorPoint(d.atLocation);
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
    const step = videoStep(this.timeline, video.currentTime * 1000, { ending: this.ending });
    if (!step) return;
    if (step.seek !== undefined) video.currentTime = step.seek / 1000;
    if (step.play && video.paused) video.play().catch(() => {});
    if (step.pause && !video.paused) video.pause();
  }

  /**
   * Apply transform, opacity, depth and visibility for the current time.
   * @returns {boolean} false when an anchor disappeared (e.g. its token was deleted).
   */
  refresh() {
    const d = this.descriptor;
    const pos = this.position();
    if (!pos) return false;
    const env = sampleEnvelope({
      elapsed: this.elapsed,
      endAt: this.endAt,
      fadeIn: d.fadeIn,
      fadeOut: this.fadeOut,
      scaleIn: d.scaleIn,
      scaleOut: d.scaleOut
    });
    const ok = d.stretchTo ? this.#refreshStretch(pos, env) : this.#refreshPlaced(pos, env);
    if (!ok) return false;
    this.display.alpha = (d.opacity ?? 1) * env.alpha;
    this.#refreshDepth();
    this.display.visible = this.#isVisible(pos);
    return true;
  }

  #refreshPlaced(pos, env) {
    const d = this.descriptor;
    const host = this.#hostToken();
    const scale = computeScale({
      texture: this.instance,
      gridSizePx: this.ctx.gridSize(),
      template: this.template,
      size: d.size,
      scaleToObject: d.scaleToObject,
      objectSize: host ? { width: host.w, height: host.h } : null,
      scale: d.scale,
      mirrorX: d.mirrorX,
      mirrorY: d.mirrorY
    });
    let rotation = toRadians(d.rotation);
    if (d.rotateTowards) {
      const target = this.#anchorPoint(d.rotateTowards);
      if (target) rotation += angleTo(pos, target);
    }
    if (d.attachTo?.followRotation && host) rotation += tokenRotation(host);
    const display = this.display;
    display.position.set(pos.x, pos.y);
    display.rotation = rotation;
    display.scale.set(scale.x * env.scale, scale.y * env.scale);
    return true;
  }

  /** Point the stretched effect flies to (the target, or beside it when missed). */
  #stretchTarget(source) {
    const d = this.descriptor;
    const target = this.#anchorPoint(d.stretchTo);
    if (!target) return null;
    if (!d.missed) return target;
    if (!this.missOffset) {
      const token = this.#token(d.stretchTo.tokenId);
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
    return true;
  }

  /** Tokens the effect is anchored to (not the attachTo token). */
  #anchorTokens() {
    const d = this.descriptor;
    const ids = [d.atLocation?.tokenId, d.stretchTo?.tokenId, d.rotateTowards?.tokenId];
    return [...new Set(ids.filter(Boolean))].map((id) => this.#token(id)).filter(Boolean);
  }

  #refreshDepth() {
    if (this.display.svaGroup !== "primary") return;
    const d = this.descriptor;
    const tokens = this.#anchorTokens();
    const host = this.#hostToken();
    if (host && !tokens.includes(host)) tokens.push(host);
    const elevation = effectElevation({
      layer: d.layer,
      base: this.ctx.levelBase(),
      tokenElevations: tokens.map((t) => t.document?.elevation)
    });
    this.ctx.layers.setElevation(this.display, elevation);
  }

  #isVisible(pos) {
    const d = this.descriptor;
    const attached = d.attachTo?.tokenId ? tokenState(this.#token(d.attachTo.tokenId)) : null;
    return isEffectVisible({
      isGM: this.ctx.isGM(),
      layer: d.layer,
      attached,
      tokens: this.#anchorTokens().map(tokenState),
      tokenVision: this.ctx.tokenVision(),
      pointVisible: () => {
        if (this.elapsed - this.visionCheckAt >= VISION_TEST_INTERVAL) {
          this.visionCheckAt = this.elapsed;
          this.visionResult = this.ctx.pointVisible(pos);
        }
        return this.visionResult;
      }
    });
  }

  /** Start ending: fade out (or stop right away when immediate). */
  requestEnd({ immediate = false } = {}) {
    // Marker loops end with their outro (plus fadeOut if the effect has one); others fade out.
    if (!hasOutro(this.timeline) && !(this.fadeOut?.duration > 0)) this.fadeOut = { duration: DEFAULT_END_FADE };
    this.endAt = endRequestedAt({
      elapsed: this.elapsed,
      endAt: this.endAt,
      immediate,
      fadeOut: this.fadeOut,
      timeline: this.timeline,
      videoTime: this.video ? this.video.currentTime * 1000 : undefined
    });
    this.ending = true;
    // Leave the loop: let the video run into the outro.
    if (this.video?.paused && hasOutro(this.timeline)) this.video.play().catch(() => {});
  }

  destroy() {
    this.video?.pause();
    this.ctx.layers.release(this.display);
    this.display = null;
  }
}
