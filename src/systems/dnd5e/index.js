/**
 * D&D Fifth Edition adapter - the only code that knows dnd5e data.
 * Targets the dnd5e system for Foundry v14 (dnd5e 6.x "activities", verified against tag release-6.0.5 of
 * https://github.com/foundryvtt/dnd5e, system.json compatibility minimum 14.367). See ./messages.js for the
 * message → event table, ./areas.js for template regions and ./effects.js for active effects.
 */
import { MODULE_ID } from "../../constants.js";
import { EVENT_TYPES } from "../../shared/events.js";
import { SystemAdapter } from "../../shared/adapter.js";
import { describeItem, itemKey } from "./descriptors.js";
import { eventFromActivityUse, eventFromMessage } from "./messages.js";
import { eventFromTemplate, eventsFromRegion, removalFromRegion } from "./areas.js";
import { eventFromEffect } from "./effects.js";
import { registerSheetControls } from "./sheet.js";

/** World setting: animate dnd5e status conditions (other effects and concentration are always animated). */
export const SETTING_CONDITIONS = "dnd5eConditionEvents";

/** Register the dnd5e world settings. Called from Dnd5eAdapter.init during Foundry's `init`. */
export function registerSettings() {
  game.settings?.register(MODULE_ID, SETTING_CONDITIONS, {
    name: "SVA.Dnd5e.Settings.ConditionEvents.Name",
    hint: "SVA.Dnd5e.Settings.ConditionEvents.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    svaGroup: "systems"
  });
}

/** How many handled ids to remember for de-duplication. */
const SEEN_LIMIT = 200;

export default class Dnd5eAdapter extends SystemAdapter {
  static id = "dnd5e";
  static label = "Dungeons & Dragons Fifth Edition";

  /** Init-time hook (SystemAdapter.init): register dnd5e settings while Foundry's `init` hook runs. */
  static init() {
    if (!this.isActive()) return;
    registerSettings();
  }

  constructor(ctx) {
    super(ctx);
    /** @type {Array<[string, Function]>} */
    this._hooks = [];
    this._unregisterSheet = null;
    this._seen = new Set();
    this._useSeq = 0;
    this._toggleSeq = 0;
  }

  register() {
    if (this._hooks.length) return;
    // Usage cards, attack / damage / healing rolls and activity saves are typed chat messages (./messages.js).
    this._on("createChatMessage", (message, options, userId) => this.onCreateChatMessage(message, options, userId));
    // Activities used without a usage card. `dnd5e.postUseActivity` is a Hooks.call: never return false from it.
    this._on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      this.onPostUseActivity(activity, usageConfig, results);
    });
    // v14: dnd5e 6 places activity templates as Regions (canvas/template-placement.mjs)
    this._on("createRegion", (doc, options, userId) => this.onCreateRegion(doc, options, userId));
    this._on("deleteRegion", (doc, options, userId) => {
      if (this._isOwnAction(userId)) this._emit(removalFromRegion(doc, { userId }));
    });
    // Deprecated MeasuredTemplates (dnd5e 5.x AbilityTemplate, third-party modules)
    this._on("createMeasuredTemplate", (doc, options, userId) => this.onCreateTemplate(doc, options, userId));
    // Active effects on actors: spell effects, conditions, concentration
    this._on("createActiveEffect", (effect, options, userId) =>
      this.onEffect(effect, options, userId, EVENT_TYPES.EFFECT_APPLIED)
    );
    this._on("deleteActiveEffect", (effect, options, userId) =>
      this.onEffect(effect, options, userId, EVENT_TYPES.EFFECT_REMOVED)
    );
    // Toggling `disabled` on an existing effect: enabling animates like a creation, disabling ends like a deletion.
    this._on("updateActiveEffect", (effect, changes, options, userId) =>
      this.onEffectToggled(effect, changes, options, userId)
    );
    this._unregisterSheet = registerSheetControls(this.ctx?.api);
  }

  unregister() {
    for (const [hook, fn] of this._hooks) Hooks.off?.(hook, fn);
    this._hooks = [];
    this._unregisterSheet?.();
    this._unregisterSheet = null;
    this._seen.clear();
  }

  _on(hook, fn) {
    Hooks.on(hook, fn);
    this._hooks.push([hook, fn]);
  }

  _conditionsEnabled() {
    try {
      return game.settings.get(MODULE_ID, SETTING_CONDITIONS) !== false;
    } catch {
      return true;
    }
  }

  /** True when this client created the document: only the originating user emits. */
  _isOwnAction(userId) {
    return !!userId && userId === game.user?.id;
  }

  /** Remember an id; returns false if it was already handled. */
  _markSeen(id) {
    if (!id) return true;
    if (this._seen.has(id)) return false;
    this._seen.add(id);
    if (this._seen.size > SEEN_LIMIT) this._seen.delete(this._seen.values().next().value);
    return true;
  }

  _emit(event) {
    if (!event) return;
    try {
      this.ctx?.emit?.(event);
    } catch (err) {
      console.error("Sargas Visual Automation | dnd5e adapter failed to emit", err);
    }
  }

  onCreateChatMessage(message, _options, userId) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`msg:${message?.id}`)) return;
    this._emit(eventFromMessage(message, { userId }));
  }

  /** `dnd5e.postUseActivity` runs only on the user's own client (a local Hooks.call). */
  onPostUseActivity(activity, _usageConfig, results) {
    try {
      this._useSeq += 1;
      this._emit(eventFromActivityUse(activity, results, { userId: game.user?.id, seq: this._useSeq }));
    } catch (err) {
      console.error("Sargas Visual Automation | dnd5e adapter failed on postUseActivity", err);
    }
  }

  onCreateRegion(doc, _options, userId) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`area:${doc?.uuid ?? doc?.id}`)) return;
    for (const event of eventsFromRegion(doc, { userId })) this._emit(event);
  }

  onCreateTemplate(doc, _options, userId) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`area:${doc?.uuid ?? doc?.id}`)) return;
    this._emit(eventFromTemplate(doc, { userId }));
  }

  onEffect(effect, _options, userId, type) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`${type}:${effect?.uuid ?? effect?.id}`)) return;
    this._emit(eventFromEffect(effect, type, { userId, conditions: this._conditionsEnabled() }));
  }

  onEffectToggled(effect, changes, _options, userId) {
    if (typeof changes?.disabled !== "boolean" || !this._isOwnAction(userId)) return;
    const type = changes.disabled ? EVENT_TYPES.EFFECT_REMOVED : EVENT_TYPES.EFFECT_APPLIED;
    // Every toggle is a new event (creation / deletion ids are used once); the modified time dedupes repeated hook
    // calls for the same update. VERIFY(v14): Document#_stats.modifiedTime is bumped on each update.
    this._toggleSeq += 1;
    const stamp = effect?._stats?.modifiedTime ?? `n${this._toggleSeq}`;
    const id = `toggle:${type}:${effect?.uuid ?? effect?.id}:${stamp}`;
    if (!this._markSeen(id)) return;
    const event = eventFromEffect(effect, type, { userId, conditions: this._conditionsEnabled() });
    if (event) this._emit({ ...event, id });
  }

  getItemKey(item) {
    return itemKey(item);
  }

  getItemDescriptors(item) {
    return describeItem(item);
  }
}
