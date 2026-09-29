import { MODULE_ID } from "../constants.js";

/** Engine settings (client scope: they tune this machine's rendering). */
export const ENGINE_SETTINGS = {
  MAX_EFFECTS: "engineMaxEffects",
  CACHE_SIZE: "engineCacheSize",
  DEBUG_OVERLAY: "engineDebugOverlay"
};

export const DEFAULTS = {
  [ENGINE_SETTINGS.MAX_EFFECTS]: 50,
  [ENGINE_SETTINGS.CACHE_SIZE]: 30,
  [ENGINE_SETTINGS.DEBUG_OVERLAY]: false
};

export function registerEngineSettings({ onChange } = {}) {
  const changed = (key) => (value) => onChange?.(key, value);
  game.settings.register(MODULE_ID, ENGINE_SETTINGS.MAX_EFFECTS, {
    name: "SVA.Engine.Settings.MaxEffects.Name",
    hint: "SVA.Engine.Settings.MaxEffects.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 5, max: 200, step: 5 },
    default: DEFAULTS[ENGINE_SETTINGS.MAX_EFFECTS],
    onChange: changed(ENGINE_SETTINGS.MAX_EFFECTS)
  });
  game.settings.register(MODULE_ID, ENGINE_SETTINGS.CACHE_SIZE, {
    name: "SVA.Engine.Settings.CacheSize.Name",
    hint: "SVA.Engine.Settings.CacheSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 5, max: 200, step: 5 },
    default: DEFAULTS[ENGINE_SETTINGS.CACHE_SIZE],
    onChange: changed(ENGINE_SETTINGS.CACHE_SIZE)
  });
  game.settings.register(MODULE_ID, ENGINE_SETTINGS.DEBUG_OVERLAY, {
    name: "SVA.Engine.Settings.DebugOverlay.Name",
    hint: "SVA.Engine.Settings.DebugOverlay.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS[ENGINE_SETTINGS.DEBUG_OVERLAY],
    onChange: changed(ENGINE_SETTINGS.DEBUG_OVERLAY)
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
