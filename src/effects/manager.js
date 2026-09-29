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
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import { resolveEffect } from "../sequence/runner.js";
import { FLAG_KEY, collectPersistent, getStored, matches, referencesToken } from "./store.js";

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
    endLocalIds(ids);
  }

  // ---- GM-authoritative writes -------------------------------------------

  /** Apply a write on this (GM) client. */
  async function applyWrite(op) {
    const scene = getScene(op?.sceneId);
    if (!scene) return;
    if (op.op === "set") {
      const update = {};
      for (const effect of op.effects ?? []) {
        if (effect?.id && effect.file) update[`flags.${MODULE_ID}.${FLAG_KEY}.${effect.id}`] = effect;
      }
      if (Object.keys(update).length) await scene.update(update);
    } else if (op.op === "delete") {
      const stored = getStored(scene);
      // VERIFY(v14): unsetFlag deletes one nested key per update; fine for the few ids involved.
      for (const id of op.ids ?? []) if (id in stored) await scene.unsetFlag(MODULE_ID, `${FLAG_KEY}.${id}`);
    } else if (op.op === "clear") {
      if (Object.keys(getStored(scene)).length) await scene.unsetFlag(MODULE_ID, FLAG_KEY);
    }
  }

  /** Write directly as GM, or ask the active GM. @returns {Promise<boolean>} whether it was sent/applied. */
  async function write(op) {
    if (getUser()?.isGM) {
      await applyWrite(op);
      return true;
    }
    if (!getActiveGM()) {
      warn("SVA.Net.NoGM", "No GM is connected: persistent animation changes cannot be saved.");
      return false;
    }
    api.net?.emit("effectsWrite", op);
    return true;
  }

  async function onWriteRequest(data) {
    if (!isActiveGM()) return;
    if (!data || !["set", "delete", "clear"].includes(data.op) || typeof data.sceneId !== "string") return;
    await applyWrite(data);
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
