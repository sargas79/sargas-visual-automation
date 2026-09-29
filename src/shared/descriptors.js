/**
 * Serializable effect / sequence descriptors - the contract between the
 * sequence builder, the automation compiler, the socket layer, persistence
 * and the rendering engine. Everything here must stay plain JSON.
 *
 * Owned by the core: change only through a reviewed PR to docs/architecture.md.
 */

export const DESCRIPTOR_VERSION = 1;

/** Canvas depth at which an effect is drawn. */
export const LAYERS = Object.freeze({
  BELOW_TILES: "belowTiles",
  BELOW_TOKENS: "belowTokens",
  ABOVE_TOKENS: "aboveTokens",
  ABOVE_LIGHTING: "aboveLighting",
  SCREEN: "screen"
});

/**
 * A point on the current scene. Either a token reference or raw coordinates.
 * @typedef {{tokenId: string, offset?: {x: number, y: number}} | {x: number, y: number, offset?: {x: number, y: number}}} Anchor
 */

/**
 * @typedef {object} EffectDescriptor
 * @property {string} id                 Unique id (generated if missing).
 * @property {string} file               JB2A database path ("jb2a.fire_bolt.orange") or a direct file URL.
 * @property {Anchor} atLocation         Where the effect starts / sits.
 * @property {Anchor} [stretchTo]        Stretch from atLocation to this anchor (projectiles, rays). Uses JB2A `_templates` padding and picks the closest distance variant.
 * @property {Anchor} [rotateTowards]    Rotate to face this anchor.
 * @property {{tokenId: string, followRotation?: boolean}} [attachTo] Follow a token while it moves.
 * @property {boolean} [missed]          Land beside the target instead of on it.
 * @property {boolean} [returnTrip]      Play stretched effect back to the source afterwards (thrown weapons).
 * @property {number|{x:number,y:number}} [scale]
 * @property {number} [scaleToObject]    Fit to the attached/located token's size times this factor.
 * @property {{width:number, height:number, gridUnits?: boolean}} [size] Explicit size in px, or in grid squares if gridUnits.
 * @property {number} [rotation]         Extra rotation in degrees.
 * @property {boolean} [mirrorX]
 * @property {boolean} [mirrorY]
 * @property {number} [opacity]          0..1, default 1.
 * @property {string} [tint]             CSS hex color.
 * @property {{duration:number, ease?:string}} [fadeIn]
 * @property {{duration:number, ease?:string}} [fadeOut]
 * @property {{value:number, duration:number, ease?:string}} [scaleIn]
 * @property {{value:number, duration:number, ease?:string}} [scaleOut]
 * @property {number} [duration]         Force a duration in ms (otherwise the video length).
 * @property {number} [playbackRate]
 * @property {number} [startTime]        ms into the video.
 * @property {number} [endTime]          ms before the end of the video.
 * @property {number} [delay]            ms before the effect starts.
 * @property {string} [layer]            One of LAYERS, default ABOVE_TOKENS.
 * @property {number} [zIndex]
 * @property {boolean} [persist]         Keep until ended (loops using JB2A `_markers`). Stored in scene flags by the effects manager.
 * @property {string} [name]             Tag used to find / end effects ("aura:<actorId>:<key>").
 * @property {string[]} [users]          Only these user ids see it (empty = everyone).
 * @property {string} [sceneId]          Defaults to the sequence scene.
 * @property {boolean} [essential]      Reduced motion: true = always kept, false = skipped, unset = fallback heuristic (net/preferences.js).
 */

/**
 * @typedef {{type: "effect", effect: EffectDescriptor, waitUntilFinished?: number|null}} EffectStep
 *   waitUntilFinished: null/undefined = continue immediately; a number = wait for the effect to end, offset by that many ms (negative = earlier).
 * @typedef {{type: "wait", ms: number}} WaitStep
 * @typedef {{type: "sound", file: string, volume?: number, delay?: number, waitUntilFinished?: number|null}} SoundStep
 * @typedef {EffectStep|WaitStep|SoundStep} SequenceStep
 */

/**
 * @typedef {object} SequenceDescriptor
 * @property {string} id
 * @property {number} version            DESCRIPTOR_VERSION.
 * @property {string|null} sceneId       Scene the sequence plays on; clients on other scenes ignore it.
 * @property {string|null} userId        User who triggered it.
 * @property {string[]} [users]          Visibility whitelist for every step (empty = everyone).
 * @property {SequenceStep[]} steps
 */

export function randomId() {
  if (globalThis.foundry?.utils?.randomID) return foundry.utils.randomID();
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** Fill defaults on a partial effect. Does not validate anchors against the canvas. */
export function normalizeEffect(partial) {
  if (!partial?.file) throw new Error("Effect descriptor requires a `file`");
  if (!partial.atLocation && !partial.attachTo)
    throw new Error("Effect descriptor requires `atLocation` or `attachTo`");
  return {
    opacity: 1,
    layer: LAYERS.ABOVE_TOKENS,
    ...partial,
    id: partial.id ?? randomId()
  };
}

/** Build a sequence descriptor from steps (effect steps are normalized). */
export function createSequence(steps = [], { sceneId, userId, users } = {}) {
  return {
    id: randomId(),
    version: DESCRIPTOR_VERSION,
    sceneId: sceneId ?? globalThis.canvas?.scene?.id ?? null,
    userId: userId ?? globalThis.game?.user?.id ?? null,
    users: users ?? [],
    steps: steps.map((step) => (step.type === "effect" ? { ...step, effect: normalizeEffect(step.effect) } : step))
  };
}
