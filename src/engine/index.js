/**
 * Rendering engine (local PIXI playback): api.engine
 * Implemented in #13-#17, #19 - see docs/architecture.md for the contract.
 *
 * Lifecycle (called by src/main.js, all optional):
 *   init(api)   - Foundry "init": register settings, attach to the api object
 *   setup(api)  - Foundry "setup"
 *   ready(api)  - Foundry "ready" (may be async; areas run in order)
 */
import { DebugOverlay } from "./debug-overlay.js";
import { EffectEngine } from "./engine.js";
import { createFoundryEnvironment } from "./environment.js";
import { LayerManager } from "./layers.js";
import { ENGINE_SETTINGS, getEngineSetting, registerEngineSettings } from "./settings.js";
import { TextureCache } from "./texture-cache.js";
import { foundryTextureBackend } from "./video-backend.js";

/** On a scene change, cached files unused for this long are unloaded. */
export const SCENE_CHANGE_KEEP_MS = 10 * 60_000;

/** @type {EffectEngine|null} */
let engine = null;
/** @type {LayerManager|null} */
let layers = null;
/** @type {DebugOverlay|null} */
let overlay = null;

export function init(api) {
  registerEngineSettings({
    onChange: (key, value) => {
      if (key === ENGINE_SETTINGS.CACHE_SIZE) engine?.textures.resize(value);
      if (key === ENGINE_SETTINGS.DEBUG_OVERLAY) overlay?.setEnabled(value);
    }
  });
  const textures = new TextureCache({
    backend: foundryTextureBackend,
    max: getEngineSetting(ENGINE_SETTINGS.CACHE_SIZE)
  });
  layers = new LayerManager();
  engine = new EffectEngine({
    api,
    textures,
    env: createFoundryEnvironment(layers),
    maxEffects: () => getEngineSetting(ENGINE_SETTINGS.MAX_EFFECTS)
  });
  overlay = new DebugOverlay(() => engine.stats());
  overlay.enabled = !!getEngineSetting(ENGINE_SETTINGS.DEBUG_OVERLAY);

  api.engine = {
    play: (effect, options) => engine.play(effect, options),
    get: (id) => engine.get(id),
    active: () => engine.active(),
    end: (id, options) => engine.end(id, options),
    endAll: (options) => engine.endAll(options),
    preload: (pathsOrFiles) => engine.preload(pathsOrFiles),
    /** Debug helpers (not part of the cross-area contract). */
    debug: {
      stats: () => engine.stats(),
      overlay: (enabled = true) => overlay.setEnabled(enabled)
    }
  };

  // Scene change: remove effects before Foundry destroys the canvas groups, free sprites and idle video elements.
  // Recently used prototypes stay cached (bounded by the LRU) so returning to a scene does not download its videos
  // again; the others are unloaded, and failed files are retried on the new scene.
  Hooks.on("canvasTearDown", () => {
    engine.tearDown();
    layers.tearDown();
    overlay.tearDown();
    engine.textures.drainPools();
    engine.textures.pruneIdle(SCENE_CHANGE_KEEP_MS);
  });
  Hooks.on("canvasReady", () => overlay.show());
}
