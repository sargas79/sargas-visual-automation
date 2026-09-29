import { MODULE_ID } from "../constants.js";

/** Engine settings (client scope: they tune this machine's rendering). */
export const ENGINE_SETTINGS = {
  CACHE_SIZE: "engineCacheSize"
};

export const DEFAULTS = {
  [ENGINE_SETTINGS.CACHE_SIZE]: 30
};

export function registerEngineSettings({ onChange } = {}) {
  game.settings.register(MODULE_ID, ENGINE_SETTINGS.CACHE_SIZE, {
    name: "SVA.Engine.Settings.CacheSize.Name",
    hint: "SVA.Engine.Settings.CacheSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 5, max: 200, step: 5 },
    default: DEFAULTS[ENGINE_SETTINGS.CACHE_SIZE],
    onChange: (value) => onChange?.(ENGINE_SETTINGS.CACHE_SIZE, value)
  });
}

/** Read a setting, falling back to its default when settings are not available (tests, early calls). */
export function getEngineSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return DEFAULTS[key];
  }
}
