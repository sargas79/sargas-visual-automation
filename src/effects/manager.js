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
 * A user may also delete the stored auras of actors they own.
 *
 * Ending races: one client's socket messages arrive in order, so a `set` can only overtake an
 * `end` sent by ANOTHER user. Ids ended in the last ENDED_TTL_MS are remembered per scene with
 * the user who ended them; the active GM drops a `set` for such an id from anyone else, while
 * the ender's own later `set` is a new store. An `end` that reaches the active GM also deletes
 * the matching stored effects its sender may delete, in case the sender's own `delete` listed
 * nothing because the effect was not stored yet when it ended it.
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import { resolveSender } from "../net/preferences.js";
import { resolveEffect } from "../sequence/runner.js";
import { FLAG_KEY, collectPersistent, getStored, matches, referencesToken } from "./store.js";

/** How long the active GM ignores another user's `set` requests for an id that was just ended. */
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
    getActor = (id) => globalThis.game?.actors?.get?.(id) ?? null,
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
  /** Recently ended "sceneId/id" → {until, by: user who ended it} (see ENDED_TTL_MS). */
  const ended = new Map();
  const endedKey = (sceneId, id) => `${sceneId ?? ""}/${id}`;

  function pruneEnded(t = now()) {
    for (const [key, entry] of ended) if (entry.until <= t) ended.delete(key);
  }

  function rememberEnded(sceneId, ids, by = getUser()?.id ?? null) {
    const t = now();
    pruneEnded(t);
    for (const id of ids) if (id) ended.set(endedKey(sceneId, id), { until: t + ENDED_TTL_MS, by });
  }

  /** Was `id` just ended on `sceneId` by someone other than `userId`? Their own later `set` is a new store. */
  function endedByOther(sceneId, id, userId) {
    pruneEnded();
    for (const key of [endedKey(sceneId, id), endedKey(null, id)]) {
      const entry = ended.get(key);
      if (!entry) continue;
      if (entry.by !== userId) return true;
      ended.delete(key);
    }
    return false;
  }

  /** Does `user` own the actor an automation aura (`aura:<actorId>:<key>`) belongs to? */
  function ownsAuraActor(effect, user) {
    const actorId = /^aura:([^:]+):/.exec(effect?.name ?? "")?.[1];
    if (!actorId || !user) return false;
    try {
      return !!getActor(actorId)?.testUserPermission?.(user, "OWNER");
    } catch {
      return false;
    }
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

  /**
   * End live local effects matching a selector on the viewed scene.
   * @param {object} selector
   * @param {object} [payload]  Net payload when the selector came from another client's `end` message.
   */
  function endLocal({ sceneId, id, name, all = false, tokenId } = {}, payload = null) {
    const by = payload ? (payload.senderId ?? null) : (getUser()?.id ?? null);
    if (id) rememberEnded(sceneId, [id], by);
    if (payload && (id || name) && !all && !tokenId) {
      deleteEndedRemotely({ sceneId, id, name }, payload).catch((err) =>
        log.error("Could not remove ended persistent effects", err)
      );
    }
    const viewed = viewedSceneId();
    if (sceneId && viewed && sceneId !== viewed) return;
    const ids = [];
    for (const handle of api.engine?.active?.() ?? []) {
      const d = handle.descriptor ?? {};
      if (d.sceneId && sceneId && d.sceneId !== sceneId) continue;
      if (tokenId) {
        if (referencesToken(d, tokenId)) ids.push(handle.id);
      } else if (all || ((id || name) && matches(d, { id, name }))) {
        rememberEnded(d.sceneId ?? sceneId, [handle.id], by);
        ids.push(handle.id);
      }
    }
    endLocalIds(ids);
  }

  /** Active GM: delete the stored effects another client's `end` matched, within that sender's rights. */
  async function deleteEndedRemotely({ sceneId, id, name }, payload) {
    if (!isActiveGM() || typeof sceneId !== "string") return;
    const ids = Object.values(getStored(getScene(sceneId)))
      .filter((e) => matches(e, { id, name }))
      .map((e) => e.id);
    if (!ids.length) return;
    const { user, privileged } = resolveSender(payload, getUsers());
    if (user) await applyWrite({ op: "delete", sceneId, ids }, { user, privileged });
  }

  // ---- GM-authoritative writes -------------------------------------------

  /**
   * Apply a write on this (GM) client, on behalf of `userId`.
   * @param {object} op
   * @param {{user?: object|null, userId?: string|null, privileged?: boolean}} [by] privileged: GM rights (any
   *   effect, `clear`). Without them a user may change the effects they created, and also delete the auras of
   *   actors they own (an aura stored by someone else, or before creators were recorded, still has to end).
   */
  async function applyWrite(op, { user = null, userId = user?.id ?? getUser()?.id ?? null, privileged = true } = {}) {
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
      const ids = (op.ids ?? []).filter((id) => id in stored && (mayChange(id) || ownsAuraActor(stored[id], user)));
      rememberEnded(op.sceneId, ids, userId);
      // VERIFY(v14): "-=key" deletes a key in Document#update (all ids in one update).
      for (const id of ids) update[`${path}.-=${id}`] = null;
    } else if (op.op === "clear") {
      if (!privileged || !Object.keys(stored).length) return;
      rememberEnded(op.sceneId, Object.keys(stored), userId);
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
      const effects = (Array.isArray(data.effects) ? data.effects : []).filter(
        (e) => !endedByOther(data.sceneId, e?.id, user.id)
      );
      if (!effects.length) return;
      op = { ...data, effects };
    }
    await applyWrite(op, { user, privileged });
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
      // Only a GM may clear a scene: a player's request would end everything live but leave it all stored.
      if (!getUser()?.isGM) {
        warn("SVA.Net.EndAllGMOnly", "Only a GM can end all persistent animations of a scene.");
        return;
      }
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
