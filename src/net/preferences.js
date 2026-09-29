/**
 * Permissions and client preferences (#22).
 *
 * - `netMinTriggerRole` (world): minimum user role allowed to play/broadcast sequences.
 *   Checked by api.playSequence on the triggering client, and again by receivers
 *   against the sender's role (a lower-role client cannot force effects on others).
 * - `netEffectsDisabled` (client): this client renders no effects (sounds still follow `netVolume`).
 * - `netReducedMotion` (client): skip non-essential motion, see `applyReducedMotion`.
 * - `netVolume` (client): multiplier for sequence sounds (0 mutes them).
 */
import { MODULE_ID } from "../constants.js";
import { LAYERS } from "../shared/descriptors.js";

export const NET_SETTINGS = Object.freeze({
  MIN_TRIGGER_ROLE: "netMinTriggerRole",
  EFFECTS_DISABLED: "netEffectsDisabled",
  REDUCED_MOTION: "netReducedMotion",
  VOLUME: "netVolume"
});

/** Foundry CONST.USER_ROLES values (fallback when CONST is unavailable). */
const ROLES = { PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 };

/** @param {{onEffectsDisabled?: (disabled: boolean) => void}} [callbacks] */
export function registerNetSettings({ onEffectsDisabled } = {}) {
  const roles = globalThis.CONST?.USER_ROLES ?? ROLES;
  game.settings.register(MODULE_ID, NET_SETTINGS.MIN_TRIGGER_ROLE, {
    name: "SVA.Net.Settings.MinTriggerRole.Name",
    hint: "SVA.Net.Settings.MinTriggerRole.Hint",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      [roles.PLAYER]: "SVA.Net.Roles.Player",
      [roles.TRUSTED]: "SVA.Net.Roles.Trusted",
      [roles.ASSISTANT]: "SVA.Net.Roles.Assistant",
      [roles.GAMEMASTER]: "SVA.Net.Roles.Gamemaster"
    },
    default: roles.PLAYER
  });
  game.settings.register(MODULE_ID, NET_SETTINGS.EFFECTS_DISABLED, {
    name: "SVA.Net.Settings.EffectsDisabled.Name",
    hint: "SVA.Net.Settings.EffectsDisabled.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => onEffectsDisabled?.(value)
  });
  game.settings.register(MODULE_ID, NET_SETTINGS.REDUCED_MOTION, {
    name: "SVA.Net.Settings.ReducedMotion.Name",
    hint: "SVA.Net.Settings.ReducedMotion.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, NET_SETTINGS.VOLUME, {
    name: "SVA.Net.Settings.Volume.Name",
    hint: "SVA.Net.Settings.Volume.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 1
  });
}

/** Read a setting, falling back when it is not registered (tests, early hooks). */
function read(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export const getMinTriggerRole = () => Number(read(NET_SETTINGS.MIN_TRIGGER_ROLE, ROLES.PLAYER));
export const effectsDisabled = () => !!read(NET_SETTINGS.EFFECTS_DISABLED, false);
export const reducedMotion = () => !!read(NET_SETTINGS.REDUCED_MOTION, false);
export function getVolume() {
  const v = Number(read(NET_SETTINGS.VOLUME, 1));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/** Whether `user` (default: current user) may trigger sequences. */
export function canTrigger(user = globalThis.game?.user) {
  if (!user) return false;
  if (user.isGM) return true;
  const min = getMinTriggerRole();
  if (typeof user.hasRole === "function") return user.hasRole(min);
  return (user.role ?? 0) >= min;
}

/**
 * Whether an incoming message from `senderId` should be honoured.
 * Unknown senders are accepted when the users collection is not available (tests).
 */
export function senderAllowed(senderId) {
  const users = globalThis.game?.users;
  if (!users?.get) return true;
  const sender = users.get(senderId);
  return !!sender && canTrigger(sender);
}

/**
 * Reduced motion keeps the information and drops the flourish:
 * screen-space effects are skipped, return trips and scale-in/out animations removed.
 * Persistent effects (auras, conditions) are always kept.
 * @returns {object|null} the adjusted effect, or null to skip it.
 */
export function applyReducedMotion(effect) {
  if (effect.persist) return effect;
  if (effect.layer === LAYERS.SCREEN) return null;
  const out = { ...effect };
  delete out.returnTrip;
  delete out.scaleIn;
  delete out.scaleOut;
  return out;
}

/** Apply this client's preferences to an effect; null = do not render. */
export function filterEffect(effect) {
  if (effectsDisabled()) return null;
  return reducedMotion() ? applyReducedMotion(effect) : effect;
}
