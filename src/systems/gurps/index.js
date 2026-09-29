/**
 * GURPS 4e Game Aid (GGA) adapter - the only code that knows GURPS data.
 * Targets `game.system.id === "gurps"` (https://github.com/crnormand/gurps), verified against tag v0.18.23
 * (Foundry v13-v14, verified 14.368).
 *
 * Integration point: GGA fires no roll hooks and puts no flags on roll cards, so the adapter watches
 * `createChatMessage` on the rolling client and parses GGA's own chat cards (see ./messages.js):
 * attack rolls → ATTACK, spell rolls → CAST (HEALING for healing spells/skills), damage rolls → DAMAGE.
 * Defense rolls (parry, block, dodge) are ignored: the event contract has no defense event.
 */
import { MODULE_ID } from "../../constants.js";
import { EVENT_TYPES } from "../../shared/events.js";
import { SystemAdapter } from "../../shared/adapter.js";
import { describeItem, itemKey } from "./descriptors.js";
import { eventFromMessage } from "./messages.js";
import { registerSheetControls } from "./sheet.js";

/** World setting: animate failed / critically failed spell casts and healing rolls. */
export const SETTING_FAILED_CASTS = "gurpsAnimateFailedCasts";

/** A damage roll within this delay of the actor's attack roll is described as that attack. */
export const LAST_ATTACK_WINDOW_MS = 120_000;

const SEEN_LIMIT = 200;

export function registerSettings() {
  game.settings?.register(MODULE_ID, SETTING_FAILED_CASTS, {
    name: "SVA.Gurps.Settings.FailedCasts.Name",
    hint: "SVA.Gurps.Settings.FailedCasts.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    svaGroup: "systems"
  });
}

export default class GurpsAdapter extends SystemAdapter {
  static id = "gurps";
  static label = "GURPS 4e Game Aid";

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
    /** actorId → { descriptors, itemUuid, at } of the actor's last attack roll. */
    this._lastAttacks = new Map();
  }

  register() {
    if (this._hooks.length) return;
    this._on("createChatMessage", (message, options, userId) => this.onCreateChatMessage(message, options, userId));
    this._unregisterSheet = registerSheetControls(this.ctx?.api);
  }

  unregister() {
    for (const [hook, fn] of this._hooks) Hooks.off?.(hook, fn);
    this._hooks = [];
    this._unregisterSheet?.();
    this._unregisterSheet = null;
    this._seen.clear();
    this._lastAttacks.clear();
  }

  _on(hook, fn) {
    Hooks.on(hook, fn);
    this._hooks.push([hook, fn]);
  }

  _animateFailedCasts() {
    try {
      return game.settings.get(MODULE_ID, SETTING_FAILED_CASTS) !== false;
    } catch {
      return true;
    }
  }

  _markSeen(id) {
    if (!id) return true;
    if (this._seen.has(id)) return false;
    this._seen.add(id);
    if (this._seen.size > SEEN_LIMIT) this._seen.delete(this._seen.values().next().value);
    return true;
  }

  lastAttack(actorId) {
    const entry = this._lastAttacks.get(actorId);
    if (!entry || Date.now() - entry.at > LAST_ATTACK_WINDOW_MS) return null;
    return entry;
  }

  onCreateChatMessage(message, _options, userId) {
    // Only the client that created the message emits (GGA creates roll cards on the roller's client).
    // VERIFY(gurps): chat-command rolls (/r [M:Sword]) are also created locally by ChatProcessors.
    if (!userId || userId !== game.user?.id) return;
    if (!this._markSeen(`msg:${message?.id}`)) return;
    let event;
    try {
      event = eventFromMessage(message, {
        userId,
        lastAttack: (actorId) => this.lastAttack(actorId),
        animateFailedCasts: this._animateFailedCasts()
      });
    } catch (err) {
      console.error("Sargas Visual Automation | GURPS adapter could not read a chat message", err);
      return;
    }
    if (!event) return;
    if (event.type === EVENT_TYPES.ATTACK && event.source?.actorId) {
      this._lastAttacks.set(event.source.actorId, {
        descriptors: event.descriptors,
        itemUuid: event.itemUuid,
        at: Date.now()
      });
    }
    try {
      this.ctx?.emit?.(event);
    } catch (err) {
      console.error("Sargas Visual Automation | GURPS adapter failed to emit", err);
    }
  }

  getItemKey(item) {
    return itemKey(item);
  }

  getItemDescriptors(item) {
    return describeItem(item);
  }
}
