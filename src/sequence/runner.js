import { log } from "../logger.js";

/** Promise-based sleep; resolves immediately for ms <= 0. */
export const sleep = (ms) => new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : resolve()));

/** Whether `userId` may see something restricted to `users` (empty/missing = everyone). */
export function isVisibleTo(users, userId) {
  return !Array.isArray(users) || users.length === 0 || users.includes(userId);
}

/**
 * Play an audio file on this client only.
 * @returns {Promise<void>} resolves when playback ends (or right away if it can't be tracked).
 */
export async function playLocalSound(file, { volume = 1 } = {}) {
  const AudioHelper = globalThis.foundry?.audio?.AudioHelper;
  if (!AudioHelper) return;
  // A sound shipped by a module that is not installed (rule packs use SoundFx Library): stay silent.
  const owner = /^\/?modules\/([^/]+)\//.exec(String(file))?.[1];
  if (owner && globalThis.game?.modules && !globalThis.game.modules.get(owner)) return;
  // v14: AudioHelper.play(data, socketOptions) - socketOptions false = local only; channel defaults to "interface".
  const sound = await AudioHelper.play({ src: file, volume, autoplay: true, loop: false }, false);
  if (!sound) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    // VERIFY(v14): foundry.audio.Sound emits "end" via addEventListener; duration is in seconds.
    sound.addEventListener?.("end", finish, { once: true });
    const seconds = Number(sound.duration);
    setTimeout(finish, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 50 : 0);
  });
}

/**
 * Local sequence runner. Runs steps in order on THIS client; never broadcasts.
 *
 * @param {import("../shared/descriptors.js").SequenceDescriptor} sequence
 * @param {object} deps
 * @param {{play: Function}} deps.engine                 api.engine
 * @param {string|null} deps.userId                      current user id
 * @param {string|null} deps.viewedSceneId               canvas.scene.id
 * @param {(file: string, opts: {volume: number}) => Promise<void>} [deps.playSound]
 * @param {(effect: object) => object|null} [deps.filterEffect]  Client preferences hook; return null to skip.
 * @param {number} [deps.volume=1]                        Client volume multiplier for sounds.
 * @returns {Promise<void>}
 */
export async function runSequence(sequence, deps) {
  const { engine, userId, viewedSceneId, playSound = playLocalSound, filterEffect = (e) => e, volume = 1 } = deps;
  if (!sequence || !Array.isArray(sequence.steps)) throw new Error("Invalid sequence descriptor");
  if (sequence.sceneId && viewedSceneId !== sequence.sceneId) return;
  if (!isVisibleTo(sequence.users, userId)) return;

  const pending = [];
  for (const step of sequence.steps) {
    try {
      if (step.type === "wait") await sleep(step.ms);
      else if (step.type === "sound") {
        const task = runSound(step, { playSound, volume });
        if (step.waitUntilFinished !== undefined && step.waitUntilFinished !== null) {
          await task;
          await sleep(step.waitUntilFinished);
        } else pending.push(task);
      } else if (step.type === "effect") {
        const task = runEffect(step, sequence, { engine, userId, filterEffect });
        if (step.waitUntilFinished !== undefined && step.waitUntilFinished !== null) await task;
        else {
          // engine.play() resolves only after the file loads and the effect's delay elapses: don't block the next step
          // on it (`.delay()` staggers effects in parallel, see docs/api.md).
          pending.push(task.catch((err) => log.error(`Sequence ${sequence.id} step failed`, err)));
        }
      } else log.debug(`Unknown sequence step "${step.type}"`);
    } catch (err) {
      log.error(`Sequence ${sequence.id} step failed`, err);
    }
  }
  await Promise.allSettled(pending);
}

async function runSound(step, { playSound, volume }) {
  if (step.delay) await sleep(step.delay);
  const v = Math.max(0, Math.min(1, (step.volume ?? 1) * volume));
  if (v <= 0) return;
  await playSound(step.file, { volume: v });
}

/** Effect as the engine should receive it: scene and visibility inherited from the sequence. */
export function resolveEffect(effect, sequence) {
  const out = { ...effect };
  if (!out.sceneId && sequence.sceneId) out.sceneId = sequence.sceneId;
  if (!(out.users?.length > 0) && sequence.users?.length) out.users = [...sequence.users];
  return out;
}

async function runEffect(step, sequence, { engine, userId, filterEffect }) {
  const resolved = resolveEffect(step.effect, sequence);
  if (!isVisibleTo(resolved.users, userId)) return;
  const effect = filterEffect(resolved);
  if (!effect) return;
  if (!engine?.play) {
    log.warn("Rendering engine unavailable, skipping effect");
    return;
  }
  const handle = await engine.play(effect);
  const offset = step.waitUntilFinished;
  if (offset === undefined || offset === null) return;
  if (effect.persist) {
    log.debug("waitUntilFinished ignored on a persistent effect");
    return;
  }
  if (offset >= 0) {
    await handle?.finished;
    await sleep(offset);
    return;
  }
  // Negative offset: continue |offset| ms before the end. Only possible when the length is known.
  // engine.play() resolves once the effect is mounted, i.e. after its delay: the remaining time is just the duration.
  if (Number.isFinite(effect.duration)) {
    await Promise.race([handle?.finished, sleep(effect.duration + offset)]);
  } else {
    // EffectHandle.duration (wall ms) is set by the engine once the video length is known.
    const known = Number(handle?.duration);
    if (Number.isFinite(known) && known > 0) await Promise.race([handle.finished, sleep(known + offset)]);
    else await handle?.finished;
  }
}
