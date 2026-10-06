/**
 * Persistent effects manager (#17).
 *
 * Storage: `scene.flags["sargas-visual-automation"].effects[id]` holds the descriptor
 * of every live `persist: true` effect. Only a GM writes it: GMs write directly,
 * players send an `effectsWrite` request that the active GM applies. With no GM
 * online the write is dropped and the user is warned (the effect still plays).
 *
 * Ending (the chosen mechanism): the FLAG UPDATE is authoritative for stored effects.
 * Every client diffs the viewed scene's stored ids on `updateScene` and ends, in its
 * local engine, the ids that disappeared - whoever removed them (api.effects.end,
 * token deletion, a GM editing flags). In addition `api.effects.end/endAll` emit an
 * `end` message so live effects that were never stored (named transient effects,
 * or effects whose write is still in flight) end everywhere too.
 *
 * Replay: on `canvasReady` every stored effect of the scene is played again locally.
 *
 * Write permissions (requests from other clients, checked by the active GM): each stored
 * effect records the `userId` that created it. `set` may not overwrite, nor `delete` remove,
 * another user's effect (or a legacy one without `userId`) unless the requester is a GM;
 * `clear` is GM-only. GM rights need a server-verified sender id (net `resolveSender`).
 * Ids ended in the last ENDED_TTL_MS are remembered so a `set` still in flight when the
 * effect was ended does not store it again.
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import { resolveSender } from "../net/preferences.js";
import { resolveEffect } from "../sequence/runner.js";
import { FLAG_KEY, collectPersistent, getStored, matches, referencesToken } from "./store.js";

/** How long the active GM ignores `set` requests for an id that was just ended. */
export const ENDED_TTL_MS = 10000;

/**
 * @param {object} api  Module api (engine, net).
 * @param {object} [deps]  Injectable Foundry accessors (tests).
 */
export function createEffectsManager(api, deps = {}) {
  const {
    getScene = (id) => globalThis.game?.scenes?.get(id) ?? null,
    getViewedScene = () => globalThis.canvas?.scene ?? null,
    getUser = () => globalThis.game?.user ?? null,
    getActiveGM = () => globalThis.game?.users?.activeGM ?? null,
    getUsers = () => globalThis.game?.users ?? null,
    now = () => Date.now(),
    warn = (key, fallback) => {
      const i18n = globalThis.game?.i18n;
      globalThis.ui?.notifications?.warn(i18n?.has?.(key) ? i18n.localize(key) : fallback);
    }
  } = deps;

  /** Ids stored on the viewed scene at the last check. */
  let snapshot = new Set();
  let snapshotSceneId = null;
  /** Ids this client already asked its engine to end. */
  const ending = new Set();
  /** Recently ended ids → expiry time (see ENDED_TTL_MS). */
  const ended = new Map();

  function rememberEnded(ids) {
    const until = now() + ENDED_TTL_MS;
    for (const id of ids) if (id) ended.set(id, until);
  }

  function recentlyEnded(id) {
    const t = now();
    for (const [key, until] of ended) if (until <= t) ended.delete(key);
    return ended.has(id);
  }

  const viewedSceneId = () => getViewedScene()?.id ?? null;
  const isActiveGM = () => {
    const user = getUser();
    const gm = getActiveGM();
    return !!user?.isGM && (!gm || gm.id === user.id);
  };

  function takeSnapshot(scene) {
    snapshotSceneId = scene?.id ?? null;
    snapshot = new Set(Object.keys(getStored(scene)));
  }

  /** End effects in the local engine (idempotent per id). */
  function endLocalIds(ids) {
    for (const id of ids) {
      if (ending.has(id) || !api.engine?.get?.(id)) continue;
      ending.add(id);
      Promise.resolve(api.engine.end(id))
        .catch((err) => log.error(`Could not end effect ${id}`, err))
        .finally(() => ending.delete(id));
    }
  }

  /** End live local effects matching a selector on the viewed scene. */
  function endLocal({ sceneId, id, name, all = false, tokenId } = {}) {
    if (id) rememberEnded([id]);
    const viewed = viewedSceneId();
    if (sceneId && viewed && sceneId !== viewed) return;
    const ids = [];
    for (const handle of api.engine?.active?.() ?? []) {
      const d = handle.descriptor ?? {};
      if (d.sceneId && sceneId && d.sceneId !== sceneId) continue;
      if (tokenId) {
        if (referencesToken(d, tokenId)) ids.push(handle.id);
      } else if (all || ((id || name) && matches(d, { id, name }))) ids.push(handle.id);
    }
    rememberEnded(ids);
    endLocalIds(ids);
  }

  // ---- GM-authoritative writes -------------------------------------------

  /**
   * Apply a write on this (GM) client, on behalf of `userId`.
   * @param {object} op
   * @param {{userId?: string|null, privileged?: boolean}} [by] privileged: GM rights (any effect, `clear`).
   */
  async function applyWrite(op, { userId = getUser()?.id ?? null, privileged = true } = {}) {
    const scene = getScene(op?.sceneId);
    if (!scene) return;
    const stored = getStored(scene);
    const mayChange = (id) => privileged || (!!userId && stored[id]?.userId === userId);
    const path = `flags.${MODULE_ID}.${FLAG_KEY}`;
    const update = {};
    if (op.op === "set") {
      for (const effect of op.effects ?? []) {
        if (!effect?.id || !effect.file || (effect.id in stored && !mayChange(effect.id))) continue;
        update[`${path}.${effect.id}`] = { ...effect, userId: stored[effect.id]?.userId ?? userId };
      }
    } else if (op.op === "delete") {
      const ids = (op.ids ?? []).filter((id) => id in stored && mayChange(id));
      rememberEnded(ids);
      // VERIFY(v14): "-=key" deletes a key in Document#update (all ids in one update).
      for (const id of ids) update[`${path}.-=${id}`] = null;
    } else if (op.op === "clear") {
      if (!privileged || !Object.keys(stored).length) return;
      rememberEnded(Object.keys(stored));
      update[`flags.${MODULE_ID}.-=${FLAG_KEY}`] = null;
    }
    if (Object.keys(update).length) await scene.update(update);
  }

  /** Write directly as GM, or ask the active GM. @returns {Promise<boolean>} whether it was sent/applied. */
  async function write(op) {
    const user = getUser();
    if (user?.isGM) {
      await applyWrite(op, { userId: user.id ?? null, privileged: true });
      return true;
    }
    if (!getActiveGM()) {
      warn("SVA.Net.NoGM", "No GM is connected: persistent animation changes cannot be saved.");
      return false;
    }
    api.net?.emit("effectsWrite", op);
    return true;
  }

  /** effectsWrite handler; `payload` is the net payload (sender id, `verified`). */
  async function onWriteRequest(data, payload) {
    if (!isActiveGM()) return;
    if (!data || !["set", "delete", "clear"].includes(data.op) || typeof data.sceneId !== "string") return;
    // Unknown scene: nothing to write (and no flag created for a made-up id).
    if (!getScene(data.sceneId)) return;
    const { user, privileged } = resolveSender(payload, getUsers());
    if (!user) {
      log.debug(`Rejected "${data.op}" write from unknown or disconnected user ${payload?.senderId}`);
      return;
    }
    let op = data;
    if (data.op === "set") {
      const effects = (Array.isArray(data.effects) ? data.effects : []).filter((e) => !recentlyEnded(e?.id));
      if (!effects.length) return;
      op = { ...data, effects };
    }
    await applyWrite(op, { userId: user.id, privileged });
  }

  // ---- public surface -----------------------------------------------------

  const effects = {
    /** Stored descriptors of a scene (default: viewed), optionally filtered by name. */
    list({ sceneId, name } = {}) {
      const scene = getScene(sceneId ?? viewedSceneId()) ?? (sceneId ? null : getViewedScene());
      return Object.values(getStored(scene))
        .filter((e) => matches(e, { name }))
        .map((e) => structuredClone(e));
    },

    /** Remove matching stored effects and end matching live effects on all clients. */
    async end({ id, name, sceneId } = {}) {
      if (!id && !name) throw new Error("api.effects.end requires an id or a name");
      sceneId ??= viewedSceneId();
      const ids = effects
        .list({ sceneId })
        .filter((e) => matches(e, { id, name }))
        .map((e) => e.id);
      const message = { sceneId, id: id ?? null, name: name ?? null };
      api.net?.emit("end", message);
      endLocal(message);
      if (ids.length) await write({ op: "delete", sceneId, ids });
    },

    /** Remove every stored effect of a scene and end its live effects on all clients. */
    async endAll({ sceneId } = {}) {
      sceneId ??= viewedSceneId();
      const message = { sceneId, all: true };
      api.net?.emit("end", message);
      endLocal(message);
      if (effects.list({ sceneId }).length) await write({ op: "clear", sceneId });
    },

    /**
     * Store the persistent effects of a sequence (called by api.playSequence on the
     * triggering client when broadcasting). Not part of the architecture contract.
     */
    async store(sequence) {
      for (const [sceneId, list] of collectPersistent(sequence, resolveEffect)) {
        await write({ op: "set", sceneId, effects: list });
      }
    }
  };

  // ---- hooks --------------------------------------------------------------

  /** canvasReady: replay stored effects of the new scene. */
  async function replay(scene = getViewedScene()) {
    takeSnapshot(scene);
    if (!scene) return;
    const filter = api.net?.prefs?.filterEffect ?? ((e) => e);
    for (const stored of Object.values(getStored(scene))) {
      if (api.engine?.get?.(stored.id)) continue;
      const effect = filter({ ...stored, sceneId: stored.sceneId ?? scene.id });
      if (!effect) continue;
      try {
        await api.engine?.play(effect);
      } catch (err) {
        log.error(`Could not restore effect ${stored.id}`, err);
      }
    }
  }

  /** updateScene: end effects whose flag disappeared. */
  function onSceneUpdate(scene) {
    if (!scene || scene.id !== viewedSceneId()) return;
    const before = snapshotSceneId === scene.id ? snapshot : new Set();
    takeSnapshot(scene);
    endLocalIds([...before].filter((id) => !snapshot.has(id)));
  }

  /** deleteToken: end live effects tied to the token; the active GM removes stored ones. */
  async function onTokenDeleted(tokenDoc) {
    const tokenId = tokenDoc?.id;
    const sceneId = tokenDoc?.parent?.id ?? null;
    if (!tokenId) return;
    endLocal({ sceneId, tokenId });
    if (!sceneId || !isActiveGM()) return;
    const ids = Object.values(getStored(getScene(sceneId)))
      .filter((e) => referencesToken(e, tokenId))
      .map((e) => e.id);
    if (ids.length) await applyWrite({ op: "delete", sceneId, ids });
  }

  return {
    effects,
    endLocal,
    replay,
    onSceneUpdate,
    onTokenDeleted,
    onWriteRequest,
    applyWrite
  };
}
