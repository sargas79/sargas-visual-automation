/**
 * Teleport: the `teleport` preset plays the vanish, moves the source token, then plays the appear.
 *
 * Flow (on the client that runs automation, i.e. `event.userId`):
 *   1. destination: `event.area.origin` → `recipe.options.destination` ({x, y} canvas px) → an interactive click
 *      (`options.pickDestination`, default true). Right-click / Escape cancels (nothing plays).
 *   2. departure sequence (sound, cast, vanish on the token), broadcast; locally awaited until the vanish ends.
 *   3. token move with `animate: false`. The GM moves it directly; a player sends a `teleportMove` request over
 *      `api.net` and the active GM applies it if that player owns the token, then answers with `teleportMoved`.
 *   4. arrival sequence (appear at the destination), broadcast.
 * Without a canvas (or with `options.moveToken: false`) the caller falls back to the animation-only compile.
 *
 * The message types live here (module-level `api.net.on/emit`); the net protocol version is unchanged.
 */
import { log } from "../logger.js";
import { resolveSender } from "../net/preferences.js";
import { compileTeleportPhases } from "./compile.js";
import { teleportDestination } from "./presets.js";
import { recipeForOutcome } from "./steps.js";

export const TELEPORT_MESSAGES = Object.freeze({
  /** data: { requestId, sceneId, tokenId, x, y } - player → active GM: move this token (top-left px). */
  MOVE: "teleportMove",
  /** data: { requestId, ok, reason? } - active GM → everyone: result of a MOVE request. */
  MOVED: "teleportMoved"
});

/** How long a player waits for the GM to answer a move request. */
export const MOVE_TIMEOUT_MS = 5000;
/** How long the destination click is awaited. */
export const PICK_TIMEOUT_MS = 30000;

const REASON_KEYS = {
  noGM: "SVA.Automation.Teleport.NoGM",
  denied: "SVA.Automation.Teleport.Denied",
  missing: "SVA.Automation.Teleport.Denied",
  invalid: "SVA.Automation.Teleport.Denied",
  failed: "SVA.Automation.Teleport.Denied"
};

function notify(level, key) {
  const text = globalThis.game?.i18n?.localize?.(key) ?? key;
  globalThis.ui?.notifications?.[level]?.(text);
}

function randomRequestId() {
  return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 12);
}

/** True when the canvas can be clicked to pick a point. */
export function canPickPoint() {
  const c = globalThis.canvas;
  return !!(
    c?.ready &&
    c.stage &&
    (typeof c.stage.addEventListener === "function" || typeof c.stage.on === "function")
  );
}

/**
 * Let the user click a point on the canvas.
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<{x: number, y: number}|null>} canvas px, or null when cancelled / timed out / no canvas.
 */
export function pickCanvasPoint({ timeout = PICK_TIMEOUT_MS } = {}) {
  if (!canPickPoint()) return Promise.resolve(null);
  const c = globalThis.canvas;
  const stage = c.stage;
  notify("info", "SVA.Automation.Teleport.Pick");
  return new Promise((resolve) => {
    let timer = null;
    // VERIFY(v14): PIXI v7 federated events support capture listeners on canvas.stage; capturing and stopping the
    // event keeps the click from also selecting/deselecting placeables. Falls back to a plain `on` listener.
    const capture = typeof stage.addEventListener === "function";
    const onDown = (event) => {
      const button = event?.button ?? 0;
      event?.stopPropagation?.();
      if (button === 2) return finish(null);
      if (button !== 0) return undefined;
      // VERIFY(v14): FederatedPointerEvent#getLocalPosition(canvas.stage) → canvas (scene) coordinates;
      // canvas.mousePosition is the fallback.
      const p = event?.getLocalPosition?.(stage) ?? c.mousePosition ?? null;
      return finish(
        p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : null
      );
    };
    const onKey = (event) => {
      if (event?.key !== "Escape") return;
      event.stopPropagation?.();
      finish(null);
    };
    function finish(point) {
      if (capture) stage.removeEventListener("pointerdown", onDown, { capture: true });
      else stage.off?.("pointerdown", onDown);
      globalThis.removeEventListener?.("keydown", onKey, true);
      if (timer) clearTimeout(timer);
      resolve(point);
    }
    if (capture) stage.addEventListener("pointerdown", onDown, { capture: true });
    else stage.on("pointerdown", onDown);
    globalThis.addEventListener?.("keydown", onKey, true);
    timer = setTimeout(() => finish(null), timeout);
  });
}

function sceneOf(sceneId) {
  const scenes = globalThis.game?.scenes;
  return (sceneId ? scenes?.get?.(sceneId) : null) ?? globalThis.canvas?.scene ?? null;
}

function tokenDocument(sceneId, tokenId) {
  return sceneOf(sceneId)?.tokens?.get?.(tokenId) ?? null;
}

/**
 * Top-left position that puts the token's centre on `center`, snapped to the grid.
 * VERIFY(v14): TokenDocument width/height are in grid units; Token#getSnappedPosition(position) snaps a top-left.
 */
export function topLeftFor(doc, center, gridSize) {
  const size = gridSize ?? globalThis.canvas?.grid?.size ?? sceneOf(doc?.parent?.id)?.grid?.size ?? 100;
  const w = Number(doc?.width ?? 1) * size;
  const h = Number(doc?.height ?? 1) * size;
  const raw = { x: center.x - w / 2, y: center.y - h / 2 };
  const token = doc?.object ?? globalThis.canvas?.tokens?.get?.(doc?.id);
  const snapped = token?.getSnappedPosition?.(raw) ?? raw;
  return { x: Math.round(snapped.x), y: Math.round(snapped.y) };
}

/**
 * True when a wall blocks sight between the token's centre and `point`.
 * VERIFY(v14): CONFIG.Canvas.polygonBackends.sight.testCollision(origin, destination, {type, mode}).
 */
export function sightBlocked(doc, point) {
  const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
  const token = doc?.object ?? globalThis.canvas?.tokens?.get?.(doc?.id);
  const origin = token?.center;
  if (!backend?.testCollision || !origin) return false;
  try {
    return !!backend.testCollision(origin, point, { type: "sight", mode: "any" });
  } catch (err) {
    log.debug("Sight test failed", err);
    return false;
  }
}

/**
 * Ownership granted explicitly (own id or default level) on the token's actor, or the token itself, ignoring the
 * implicit GM ownership that testUserPermission adds. VERIFY(v14): Document#ownership, DOCUMENT_OWNERSHIP_LEVELS.
 */
function explicitOwner(doc, user) {
  const levels = (doc.actor ?? doc).ownership ?? {};
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return Number(levels[user?.id] ?? levels.default ?? 0) >= owner;
}

/**
 * Apply a move as the GM. Players may only move tokens they own.
 * @param {{trustGM?: boolean}} [opts] trustGM: false when `user` is only a claimed (unverified) sender, so a
 *   GM id gets no bypass and must own the token explicitly.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function applyMove({ sceneId, tokenId, x, y }, user, { trustGM = true } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "invalid" };
  const doc = tokenDocument(sceneId, tokenId);
  if (!doc) return { ok: false, reason: "missing" };
  // VERIFY(v14): Document#testUserPermission(user, "OWNER").
  const allowed = user?.isGM ? trustGM || explicitOwner(doc, user) : !!doc.testUserPermission?.(user, "OWNER");
  if (!allowed) return { ok: false, reason: "denied" };
  try {
    // VERIFY(v14): update({x, y}, {animate: false}) moves without the slide animation. The v13+ movement API
    // (TokenDocument#move with a "blink"/"displace" action) is an alternative if plain updates get constrained.
    await doc.update({ x, y }, { animate: false });
    return { ok: true };
  } catch (err) {
    log.error("Teleport move failed", err);
    return { ok: false, reason: "failed" };
  }
}

/** The single GM that answers move requests. VERIFY(v14): game.users.activeGM. */
function isResponsibleGM() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const gm = globalThis.game?.users?.activeGM;
  return !gm || gm.id === user.id;
}

/**
 * @param {object} api the shared module api
 * @param {{playAll: (sequences: object[]) => Promise<boolean>}} deps
 */
export function createTeleport(api, { playAll }) {
  /** requestId → resolve */
  const pending = new Map();

  api.net?.on?.(TELEPORT_MESSAGES.MOVE, async (data, payload) => {
    if (!isResponsibleGM() || !data?.requestId) return;
    const { user, privileged } = resolveSender(payload);
    const result = user ? await applyMove(data, user, { trustGM: privileged }) : { ok: false, reason: "denied" };
    api.net.emit(TELEPORT_MESSAGES.MOVED, { requestId: data.requestId, ...result });
  });

  api.net?.on?.(TELEPORT_MESSAGES.MOVED, (data) => {
    const done = pending.get(data?.requestId);
    if (!done) return;
    pending.delete(data.requestId);
    done({ ok: !!data.ok, reason: data.reason });
  });

  /** Move a token (GM directly, players through the active GM). */
  async function moveToken({ sceneId, tokenId, x, y }) {
    const user = globalThis.game?.user;
    if (user?.isGM) return applyMove({ sceneId, tokenId, x, y }, user);
    if (!api.net?.emit || !globalThis.game?.users?.activeGM) return { ok: false, reason: "noGM" };
    const requestId = randomRequestId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({ ok: false, reason: "noGM" });
      }, MOVE_TIMEOUT_MS);
      pending.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      api.net.emit(TELEPORT_MESSAGES.MOVE, { requestId, sceneId, tokenId, x, y });
    });
  }

  /**
   * Play a teleport recipe and move the source token.
   * @returns {Promise<boolean|null>} true/false like `handle()`, or null when the token is not moved (the caller
   *   then plays the animation-only version).
   */
  async function run(recipe, event) {
    const opts = recipeForOutcome(recipe, event.outcome).options ?? {};
    const tokenId = event.source?.tokenId ?? null;
    if (opts.moveToken === false || !tokenId) return null;
    const doc = tokenDocument(event.sceneId, tokenId);
    if (!doc) return null;
    if (api.net?.prefs?.canTrigger && !api.net.prefs.canTrigger()) return false;

    let dest = teleportDestination(event, opts);
    if (!dest) {
      if (opts.pickDestination === false || !canPickPoint()) return null;
      dest = await pickCanvasPoint();
      if (!dest) {
        notify("info", "SVA.Automation.Teleport.Cancelled");
        return false;
      }
    }
    if (opts.requireSight && sightBlocked(doc, dest)) {
      notify("warn", "SVA.Automation.Teleport.Blocked");
      return false;
    }

    const withDest = { ...recipe, options: { ...recipe.options, destination: dest } };
    const { departure, arrival } = compileTeleportPhases(withDest, { ...event, area: null });
    if (departure) await playAll([departure]);
    const target = topLeftFor(doc, dest);
    const moved = await moveToken({ sceneId: event.sceneId ?? doc.parent?.id ?? null, tokenId, ...target });
    if (!moved.ok) {
      notify("warn", REASON_KEYS[moved.reason] ?? REASON_KEYS.failed);
      return !!departure;
    }
    if (arrival) await playAll([arrival]);
    return true;
  }

  return { run, moveToken, pickCanvasPoint, pending };
}
