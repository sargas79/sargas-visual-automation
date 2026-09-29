/**
 * Pathfinder Second Edition adapter - the only code that knows PF2e data.
 * Targets the PF2e system for Foundry v14 (pf2e 8.x, verified against tag pf2e-8.5.1 of
 * https://github.com/foundryvtt/pf2e). See ./messages.js for the message → event table.
 */
import { MODULE_ID } from "../../constants.js";
import { EVENT_TYPES } from "../../shared/events.js";
import { SystemAdapter } from "../../shared/adapter.js";
import { describeItem, itemKey } from "./descriptors.js";
import { eventFromMessage } from "./messages.js";
import { eventFromRegion, eventFromTemplate, removalFromRegion } from "./areas.js";
import { registerSheetControls } from "./sheet.js";
import { EFFECT_ITEM_TYPES, eventFromEffectItem } from "./effects.js";

/** World setting: animate PF2e conditions (effects are always animated). */
export const SETTING_CONDITIONS = "pf2eConditionEvents";

/** How many handled ids to remember for de-duplication. */
const SEEN_LIMIT = 200;

export default class Pf2eAdapter extends SystemAdapter {
  static id = "pf2e";
  static label = "Pathfinder Second Edition";

  constructor(ctx) {
    super(ctx);
    /** @type {Array<[string, Function]>} */
    this._hooks = [];
    this._unregisterSheet = null;
    this._seen = new Set();
  }

  register() {
    if (this._hooks.length) return;
    this._on("createChatMessage", (message, options, userId) => this.onCreateChatMessage(message, options, userId));
    // v14: PF2e places spell areas as Regions (item/helpers.ts#placeRegionFromItem)
    this._on("createRegion", (doc, options, userId) => this.onCreateArea(doc, options, userId, eventFromRegion));
    this._on("deleteRegion", (doc, options, userId) => {
      if (this._isOwnAction(userId)) this._emit(removalFromRegion(doc, { userId }));
    });
    // Legacy / third-party MeasuredTemplates carrying PF2e origin flags
    this._on("createMeasuredTemplate", (doc, options, userId) =>
      this.onCreateArea(doc, options, userId, eventFromTemplate)
    );
    // Effects & conditions embedded on actors
    this._on("createItem", (item, options, userId) =>
      this.onEffectItem(item, options, userId, EVENT_TYPES.EFFECT_APPLIED)
    );
    this._on("deleteItem", (item, options, userId) =>
      this.onEffectItem(item, options, userId, EVENT_TYPES.EFFECT_REMOVED)
    );
    this._registerSettings();
    this._unregisterSheet = registerSheetControls(this.ctx?.api);
  }

  _registerSettings() {
    const settings = game.settings;
    if (!settings) return;
    try {
      settings.get(MODULE_ID, SETTING_CONDITIONS);
      return; // already registered
    } catch {
      // not registered yet
    }
    // VERIFY(v14): register() runs on "ready"; registering a world setting this late works but it is only listed in
    // the settings config after this point (fine: the dialog is opened later).
    settings.register(MODULE_ID, SETTING_CONDITIONS, {
      name: "SVA.Pf2e.Settings.ConditionEvents.Name",
      hint: "SVA.Pf2e.Settings.ConditionEvents.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  _conditionsEnabled() {
    try {
      return game.settings.get(MODULE_ID, SETTING_CONDITIONS) !== false;
    } catch {
      return true;
    }
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
      console.error("Sargas Visual Automation | PF2e adapter failed to emit", err);
    }
  }

  onCreateChatMessage(message, _options, userId) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`msg:${message?.id}`)) return;
    this._emit(eventFromMessage(message, { userId }));
  }

  onCreateArea(doc, _options, userId, build) {
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`area:${doc?.uuid ?? doc?.id}`)) return;
    this._emit(build(doc, { userId }));
  }

  onEffectItem(item, _options, userId, type) {
    if (!EFFECT_ITEM_TYPES.includes(item?.type)) return;
    if (!this._isOwnAction(userId)) return;
    if (!this._markSeen(`${type}:${item.uuid ?? item.id}`)) return;
    this._emit(eventFromEffectItem(item, type, { userId, conditions: this._conditionsEnabled() }));
  }

  getItemKey(item) {
    return itemKey(item);
  }

  getItemDescriptors(item) {
    return describeItem(item);
  }
}
