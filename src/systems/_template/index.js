/**
 * Skeleton system adapter - copy this folder to src/systems/<system-id>/ to
 * add support for a new game system (D&D 5e, GURPS, ...).
 *
 * NOT registered: it is a template only. To enable a copy, add the class to
 * BUILTIN_ADAPTERS in src/systems/index.js (or, from another module, call
 * `game.modules.get("sargas-visual-automation").api.systems.register(MyAdapter)`).
 *
 * Rules of the road:
 * - This folder is the ONLY place allowed to read the system's data model
 *   (chat message flags, item system data, traits, slugs...).
 * - Talk to the core only through `this.ctx.emit(event)` with a (partial)
 *   AutomationEvent (src/shared/events.js). `systemId` is filled in for you,
 *   and only the client whose `game.user.id === event.userId` runs automation,
 *   so emit from the client that produced the roll/message.
 * - Describe items in system-agnostic terms through getItemDescriptors().
 * - Default rules for the system live in rules/<system-id>.json (see
 *   rules/README.md); `rulePackUrl` points there by default.
 */
import { SystemAdapter } from "../../shared/adapter.js";
import { ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../../shared/events.js";

export default class TemplateAdapter extends SystemAdapter {
  /** Must equal Foundry's `game.system.id`. */
  static id = "template-system";
  static label = "Template System";

  /** Hook ids registered in register(), removed in unregister(). */
  #hooks = [];

  /** Attach system hooks. Called once on `ready` when this adapter is active. */
  register() {
    this.#on("createChatMessage", (message) => this.#onChatMessage(message));
    // Examples of other hooks a system typically needs:
    // this.#on("createMeasuredTemplate", (doc) => this.#onTemplate(doc)); // VERIFY(v14): template document/hook name
    // this.#on("createActiveEffect", (effect) => this.#onEffect(effect, EVENT_TYPES.EFFECT_APPLIED));
    // this.#on("deleteActiveEffect", (effect) => this.#onEffect(effect, EVENT_TYPES.EFFECT_REMOVED));
  }

  unregister() {
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  /** Stable rule key; prefer a system identifier (slug) over the display name. */
  getItemKey(item) {
    return item?.system?.slug ?? super.getItemKey(item);
  }

  /** Translate the system's item data into ItemDescriptors. */
  getItemDescriptors(item) {
    const base = super.getItemDescriptors(item);
    // Replace these placeholders with reads from the system's data model.
    return {
      ...base,
      type: item?.type ?? "other",
      traits: [],
      attackKind: null, // ATTACK_KINDS.MELEE | ATTACK_KINDS.RANGED | ATTACK_KINDS.THROWN
      weaponGroup: null,
      baseItem: null, // base weapon/item this is a variant of, e.g. "longsword"
      range: null,
      area: null, // { shape: AREA_SHAPES.BURST, size: 20 }
      damageTypes: [],
      isHealing: false
    };
  }

  #on(hook, fn) {
    this.#hooks.push([hook, Hooks.on(hook, fn)]);
  }

  /** Example: turn an attack chat card into an AutomationEvent. */
  async #onChatMessage(message) {
    if (message.author?.id !== game.user.id) return; // only the author's client emits
    const item = null; // e.g. await fromUuid(message.flags[<system>].origin.uuid)
    if (!item) return;
    const descriptors = this.getItemDescriptors(item);
    this.ctx.emit({
      id: `${message.id}:${EVENT_TYPES.ATTACK}`, // stable occurrence id: the core never plays the same id twice
      type: EVENT_TYPES.ATTACK,
      source: { tokenId: message.speaker?.token ?? null, actorId: message.speaker?.actor ?? null },
      targets: [...game.user.targets].map((t) => ({ tokenId: t.id, outcome: OUTCOMES.SUCCESS })),
      outcome: OUTCOMES.SUCCESS,
      itemUuid: item.uuid,
      descriptors: { ...descriptors, attackKind: descriptors.attackKind ?? ATTACK_KINDS.MELEE },
      userId: game.user.id
    });
  }
}
