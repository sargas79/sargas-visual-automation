/**
 * Should this client see an effect right now? (#16) Pure: token state is passed in.
 *
 * Effects must not reveal what the player cannot see:
 * - attached effects (auras...) are visible exactly when their token is (`token.visible`, which Foundry computes
 *   from hidden state, vision, detection and level culling);
 * - an effect referencing a GM-hidden token (source, target) is hidden from players;
 * - otherwise it is visible when one of its tokens is visible, or - with token vision on - when its position is
 *   inside the player's vision.
 * GMs see everything that is not attached to a token they cannot see; screen-space effects are always visible.
 */
import { LAYERS } from "../shared/descriptors.js";

/**
 * @param {object} params
 * @param {boolean} params.isGM
 * @param {string} [params.layer]
 * @param {{hidden: boolean, visible: boolean}|null} [params.attached]  State of the attachTo token.
 * @param {{hidden: boolean, visible: boolean}[]} [params.tokens]       Other tokens the effect is anchored to.
 * @param {boolean} [params.tokenVision]   canvas.visibility.tokenVision
 * @param {() => boolean} [params.pointVisible]  Is the effect position inside the user's vision? (called lazily)
 * @returns {boolean}
 */
export function isEffectVisible({ isGM, layer, attached, tokens = [], tokenVision = false, pointVisible }) {
  if (layer === LAYERS.SCREEN) return true;
  if (attached) return !!attached.visible;
  if (isGM) return true;
  if (tokens.some((t) => t.hidden)) return false;
  if (tokens.some((t) => t.visible)) return true;
  if (!tokenVision) return true;
  return pointVisible ? !!pointVisible() : true;
}

/** Token state for isEffectVisible from a Token placeable. */
export function tokenState(token) {
  if (!token) return null;
  return { hidden: !!token.document?.hidden, visible: !!token.visible };
}
