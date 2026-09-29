/**
 * Rendering engine (local PIXI playback): api.engine
 * Implemented in #13-#17, #19 - see docs/architecture.md for the contract.
 *
 * Lifecycle (called by src/main.js, all optional):
 *   init(api)   - Foundry "init": register settings, attach to the api object
 *   setup(api)  - Foundry "setup"
 *   ready(api)  - Foundry "ready" (may be async; areas run in order)
 */
import { EffectEngine } from "./engine.js";
import { ENGINE_SETTINGS, getEngineSetting, registerEngineSettings } from "./settings.js";
import { TextureCache } from "./texture-cache.js";
import { foundryTextureBackend } from "./video-backend.js";

/** @type {EffectEngine|null} */
let engine = null;

export function init(api) {
  registerEngineSettings({
    onChange: (key, value) => {
      if (key === ENGINE_SETTINGS.CACHE_SIZE) engine?.textures.resize(value);
    }
  });
  const textures = new TextureCache({
    backend: foundryTextureBackend,
    max: getEngineSetting(ENGINE_SETTINGS.CACHE_SIZE)
  });
  engine = new EffectEngine({ api, textures });
  api.engine = {
    preload: (pathsOrFiles) => engine.preload(pathsOrFiles)
  };
}
