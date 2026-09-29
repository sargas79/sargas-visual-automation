# Writing a system adapter

SVA's automation core knows nothing about any game system. A **system adapter** is the small piece of code that watches one system (PF2e, D&D 5e, GURPS…), turns what happens there into **normalized automation events**, and describes items in system-agnostic terms. Everything else (rule matching, recipes, sequences, sockets, persistence, rendering, UI) is shared.

This guide takes you from nothing to a working adapter. It uses D&D 5e as the running example (the finished adapter is in [`src/systems/dnd5e/`](../src/systems/dnd5e/); PF2e's is in [`src/systems/pf2e/`](../src/systems/pf2e/)), and ends with notes for GURPS.

- [How the pieces fit](#how-the-pieces-fit)
- [Step 1: create the adapter](#step-1-create-the-adapter)
- [Step 2: describe items](#step-2-describe-items)
- [Step 3: emit events](#step-3-emit-events)
- [Step 4: write a rule pack](#step-4-write-a-rule-pack)
- [Step 5: register the adapter](#step-5-register-the-adapter)
- [Step 6: item sheet integration](#step-6-item-sheet-integration)
- [Step 7: test it](#step-7-test-it)
- [Worked example: a minimal D&D 5e adapter](#worked-example-a-minimal-dd-5e-adapter)
- [Notes for GURPS](#notes-for-gurps)
- [Checklist](#checklist)

## How the pieces fit

```
system hooks ──► YourAdapter ──this.ctx.emit(event)──► api.automation.handle(event)
 (chat cards,     │                                        │ resolve recipe for the item:
  item updates,   │ getItemKey(item)                       │   item flag → world rules → rules/<id>.json → fallback
  templates…)     │ getItemDescriptors(item) ◄─────────────┘ compile recipe → SequenceDescriptor → play on all clients
```

Three shared files are your whole contract. Import them; never import anything else from SVA's `src/`:

| File                     | What you use                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/adapter.js`  | `SystemAdapter`, the base class: `static id`, `static label`, `static isActive()`, `static init(api)`, `register()`, `unregister()`, `getItemKey(item)`, `getItemDescriptors(item)`, `rulePackUrl`, `this.ctx` |
| `src/shared/events.js`   | `EVENT_TYPES`, `OUTCOMES`, `AREA_SHAPES`, `ATTACK_KINDS`, `createAutomationEvent`, and the `AutomationEvent` / `ItemDescriptors` typedefs                                                                      |
| `rules/<system-id>.json` | Your default rule pack (plain JSON)                                                                                                                                                                            |

Rules for adapters:

- The adapter is the **only** code allowed to read the system's data model (chat message flags, `item.system.*`, activities, traits, slugs).
- It talks to the core **only** through `this.ctx.emit(event)`.
- The core must not change to support your system. If you need something the contract doesn't offer, open an issue to change `docs/architecture.md` first.

## Step 1: create the adapter

Copy the skeleton: `src/systems/_template/` → `src/systems/<system-id>/`. The folder name and `static id` must equal Foundry's `game.system.id` (`dnd5e`, `gurps`, `pf2e`…).

```js
import { SystemAdapter } from "../../shared/adapter.js";
import { ATTACK_KINDS, AREA_SHAPES, EVENT_TYPES, OUTCOMES } from "../../shared/events.js";

export default class Dnd5eAdapter extends SystemAdapter {
  static id = "dnd5e"; // === game.system.id
  static label = "D&D 5e";

  register() {} // attach hooks (Step 3)
  unregister() {} // detach them
}
```

- `static isActive()` defaults to `game.system.id === this.id`. Override it only if you need to check a system version, for example `return super.isActive() && foundry.utils.isNewerVersion(game.system.version, "4.99")`.
- Optional `static init(api)`: called once for **every** registered adapter class during Foundry's `init` (by the automation area; a class registered later is initialized as soon as it is registered). No instance exists yet. Register your system's settings here (keys prefixed with your system id, e.g. `dnd5eFoo`, optionally `svaGroup: "systems"`), and return early when `!this.isActive()` so other systems' worlds don't get them. The PF2e adapter registers `pf2eConditionEvents` this way.
- The core constructs your class with `ctx = { api, emit }` on Foundry's `ready`, then calls `register()` once. `ctx.api` is the full SVA API; `ctx.emit` forwards events to the automation core and fills `systemId` for you.
- Keep every hook id you register so `unregister()` can remove it (tests and hot reload call it). The template shows a `#on(hook, fn)` helper for this.

## Step 2: describe items

Rules match items through two methods. Both must work for **any** item of your system, including items without the fields you expect: never throw, fall back to the base implementation.

### `getItemKey(item)`

A **stable identifier** that doesn't change with translation or renaming. Rule packs match on it (`match.key`).

| System | Good key                                       |
| ------ | ---------------------------------------------- |
| PF2e   | `item.system.slug` (`"electric-arc"`)          |
| dnd5e  | `item.system.identifier` (`"fire-bolt"`)       |
| GURPS  | a slug of the attack/spell name (`"fireball"`) |

The base class returns a slug of `item.name` (`"Fire Bolt"` → `"fire-bolt"`), so return `super.getItemKey(item)` when your field is empty.

### `getItemDescriptors(item)`

Returns `ItemDescriptors` (see `src/shared/events.js`). Start from `super.getItemDescriptors(item)` and fill in what your system knows:

| Field         | Type                           | Notes                                                                                                                                                                          |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`, `key` | string                         | From the base class.                                                                                                                                                           |
| `type`        | string                         | `"weapon"`, `"spell"`, `"action"`, `"consumable"`, `"effect"`, `"condition"`, `"feat"` or `"other"`. Map your system's item types onto these.                                  |
| `traits`      | string[]                       | Lower-case tags rules can match: `"fire"`, `"cantrip"`, `"thrown"`, `"finesse"`, spell school…                                                                                 |
| `attackKind`  | `ATTACK_KINDS` value or `null` | `melee`, `ranged` or `thrown`. Decides between the `melee` and `ranged` fallback presets.                                                                                      |
| `weaponGroup` | string or `null`               | Normalized group/base weapon (`"sword"`, `"bow"`, `"axe"`, `"hammer"`, `"dagger"`…). Use the **same vocabulary as PF2e** where it exists so fallbacks and rules can be shared. |
| `baseItem`    | string or `null`               | Base weapon/item this is a variant of (`"longsword"` for a +1 Striking Longsword or a named magic longsword). Rules match it with `match.baseItem`.                            |
| `range`       | number or `null`               | In scene distance units.                                                                                                                                                       |
| `area`        | `{ shape, size }` or `null`    | `shape` from `AREA_SHAPES` (`burst`, `cone`, `line`, `emanation`, `square`); `size` in scene units (radius for bursts/emanations, length for cones/lines).                     |
| `damageTypes` | string[]                       | Lower-case (`"fire"`, `"cold"`, `"piercing"`). The generic fallback uses these to colour animations.                                                                           |
| `isHealing`   | boolean                        | True for healing items; the fallback plays a healing animation.                                                                                                                |

## Step 3: emit events

Watch your system's hooks and call `this.ctx.emit(partialEvent)`. `createAutomationEvent` in `events.js` shows the defaults; you only need to set what you know.

| Field         | Set it to                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Optional but recommended: a stable id of the occurrence, e.g. `` `${message.id}:${type}` ``. The core drops events whose `id` was already handled. |
| `type`        | One of `EVENT_TYPES`: `attack`, `damage`, `cast`, `save`, `healing`, `areaPlaced`, `effectApplied`, `effectRemoved`.                               |
| `source`      | `{ tokenId, actorId }` of whoever acts (a token on the current scene if possible).                                                                 |
| `targets`     | `[{ tokenId, outcome? }]`. Per-target outcome when the system has one (attacks vs AC, saves per target).                                           |
| `outcome`     | Overall `OUTCOMES` value: `criticalSuccess`, `success`, `failure`, `criticalFailure`, `none` (no roll).                                            |
| `itemUuid`    | The item's UUID.                                                                                                                                   |
| `descriptors` | `this.getItemDescriptors(item)`. Fill it even though the core could look it up: the event must be self-contained.                                  |
| `area`        | For `areaPlaced` (and optionally area spells): `{ shape, origin: {x, y} (canvas px), direction (deg), distance, width?, documentUuid? }`.          |
| `effectUuid`  | For `effectApplied` / `effectRemoved`: the effect's UUID.                                                                                          |
| `userId`      | The user whose client produced the event. **Only that client runs automation**, and it broadcasts the result, so every animation plays once.       |

### Outcomes

Map your system's result onto the four degrees:

| System  | criticalSuccess           | success           | failure            | criticalFailure    |
| ------- | ------------------------- | ----------------- | ------------------ | ------------------ |
| PF2e    | critical success          | success           | failure            | critical failure   |
| dnd5e   | natural 20 / critical hit | hit / save passed | miss / save failed | natural 1 (fumble) |
| GURPS   | critical success          | success           | failure            | critical failure   |
| no roll | `none`                    |                   |                    |                    |

For saves, the outcome is **from the target's point of view** as the system reports it; recipes decide what a failed save looks like.

### Deduplication

Most systems fire hooks on every client (`createChatMessage`, `createItem`…). Emit only on **one** client:

- For rolls and chat cards: only when `message.author.id === game.user.id` (the roller).
- For document changes (effects applied/removed, templates placed): only on the client that made the change (the `userId` argument of `create*`/`delete*` hooks), or on the active GM when the change came from the server.
- Don't emit the same roll twice: if a system posts an attack card and then updates it with the result, emit on the update that has the result, once. The core also drops exact duplicates, but don't rely on it.
- Give each event an `id` that identifies the occurrence, for example `` `${message.id}:${type}` `` or `` `${item.id}:effectApplied` ``. The core never plays two events with the same `id`, and two events with different ids always both play (two quick identical strikes). Without an `id`, identical events within 1 s are dropped.

### Which events to emit

| Your system does…                        | Emit                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| An attack roll (weapon or spell attack)  | `attack` with outcome per target                                  |
| A damage roll                            | `damage` (recipes play on it only if their `triggers` include it) |
| Casting a spell with no attack roll      | `cast` (targets from `game.user.targets`)                         |
| A saving throw requested/rolled          | `save` with per-target outcomes when known                        |
| Healing                                  | `healing`                                                         |
| A template / region is placed            | `areaPlaced` with `area`                                          |
| An effect / condition is added / removed | `effectApplied` / `effectRemoved` with `effectUuid`               |

## Step 4: write a rule pack

Create `rules/<system-id>.json`. The adapter's `rulePackUrl` (default `modules/sargas-visual-automation/rules/<id>.json`) is fetched when the adapter becomes active. If the file doesn't exist, only the generic fallback is used.

```json
{
  "system": "dnd5e",
  "version": 1,
  "rules": [
    {
      "id": "dnd5e.fire-bolt",
      "label": "Fire Bolt",
      "enabled": true,
      "priority": 100,
      "match": { "key": "fire-bolt" },
      "recipe": {
        "version": 1,
        "preset": "ranged",
        "animation": "jb2a.fire_bolt.orange",
        "outcomes": { "failure": { "options": { "missed": true } } }
      }
    },
    {
      "id": "dnd5e.group.bow",
      "label": "Bows",
      "enabled": true,
      "priority": 10,
      "match": { "attackKind": "ranged", "weaponGroup": "bow" },
      "recipe": { "version": 1, "preset": "ranged", "animation": "jb2a.arrow.physical.white.02" }
    }
  ]
}
```

- `match` fields combine with AND: `key`, `name` (exact), `regex` (on the name), `type`, `traits` (all required), `attackKind`, `weaponGroup`, `baseItem`.
- Prefer `key` matches for specific spells, `baseItem` for base weapons (it covers every variant) and `weaponGroup`/`traits` matches for families. Give specific rules a higher `priority`.
- Use **real JB2A database paths** (check them in the animation browser) and prefer paths that exist in the free JB2A module too. For 5e, JB2A has 5e cone variants (`template_cone_5e`); for PF2e, `template_cone_PF2e`.
- Recipe fields (`preset`, `animation`, `options`, `stages`, `outcomes`, `sound`, `triggers`) are documented in [api.md](api.md#svaautomation-and-svasystems) and `docs/architecture.md`.

## Step 5: register the adapter

**Built into SVA:** add the class to `BUILTIN_ADAPTERS` in `src/systems/index.js`:

```js
import Dnd5eAdapter from "./dnd5e/index.js";
export const BUILTIN_ADAPTERS = [Pf2eAdapter, Dnd5eAdapter];
```

**From another module** (no SVA fork): call `SVA.systems.register(MyAdapter)` from the `sargas-visual-automation.ready` hook. A class registered after `ready` is activated immediately if it matches the current system and no other adapter is active.

```js
Hooks.once("sargas-visual-automation.ready", (SVA) => {
  SVA.systems.register(MyAdapter); // MyAdapter must extend SVA's SystemAdapter class
});
```

> Limitation in 0.1.0: `register()` requires a class that extends SVA's own `SystemAdapter`, but the release bundle (`scripts/main.js`) does not export it and the API does not expose it yet. Until it does, ship new adapters inside SVA (built-in route above).

Only one adapter is active per world: the first registered class whose `isActive()` returns `true`. `SVA.systems.active` returns it.

## Step 6: item sheet integration

Users configure per-item animations through `SVA.ui.openItemConfig(item)`. Your adapter adds a way to open it from the system's item sheet, for example a header control, in `register()`:

```js
// ApplicationV2 fires getHeaderControls<ClassName> for every class in the sheet's inheritance chain, so
// "getHeaderControlsDocumentSheetV2" reaches every V2 item sheet (dnd5e's ItemSheet5e included).
this.#on("getHeaderControlsDocumentSheetV2", (sheet, controls) => {
  if (sheet.document?.documentName !== "Item") return;
  controls.push({
    icon: "fa-solid fa-wand-sparkles",
    label: "Animation",
    action: "svaAnimation",
    onClick: () => this.ctx.api.ui.openItemConfig(sheet.document)
  });
});
```

See `src/systems/dnd5e/sheet.js` (V2) and `src/systems/pf2e/sheet.js` (V1 `getItemSheetHeaderButtons` + V2) for complete versions.

Keep this optional: automation must work even if the sheet button is missing.

## Step 7: test it

**Unit tests** (`tests/systems/<system-id>/*.test.js`, Vitest, no Foundry): build fake items and chat messages as plain objects, call `getItemDescriptors`, and call your hook handlers directly with a fake `ctx`:

```js
import { describe, expect, it, vi } from "vitest";
import Dnd5eAdapter from "../../../src/systems/dnd5e/index.js";

describe("Dnd5eAdapter", () => {
  it("maps a longbow to a ranged bow", () => {
    const adapter = new Dnd5eAdapter({ api: {}, emit: vi.fn() });
    const item = {
      name: "Longbow",
      type: "weapon",
      system: {
        identifier: "longbow",
        type: { value: "martialR", baseItem: "longbow" },
        properties: new Set(),
        damage: { base: { types: new Set(["piercing"]) } }
      }
    };
    expect(adapter.getItemDescriptors(item)).toMatchObject({
      key: "longbow",
      type: "weapon",
      attackKind: "ranged",
      weaponGroup: "bow",
      damageTypes: ["piercing"]
    });
  });
});
```

A dummy adapter that drives the core is in `tests/automation/helpers/dummy-adapter.js`; reuse its pattern.

**In Foundry**: add a section for your system to [testing.md](testing.md) (attack hit/miss/crit, ranged, thrown, spell attack, save spell, each area shape, effect on/off, healing, multi-target) and run it with two clients.

## Worked example: a minimal D&D 5e adapter

> **The real D&D 5e adapter ships with SVA in [`src/systems/dnd5e/`](../src/systems/dnd5e/)** (dnd5e 6.x on Foundry v14, verified against dnd5e `release-6.0.5`). Read it next to this guide; every file cites the dnd5e source files it relies on:
>
> | File             | What it does                                                                                                                                                          |
> | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `index.js`       | `Dnd5eAdapter`: hooks, only-the-creating-user filter, id de-duplication, `static init` (the `dnd5eConditionEvents` setting)                                           |
> | `messages.js`    | Typed chat messages → events: `usage` → cast, `attack` → attack (hit/miss/crit vs each target's AC), `damage` → damage or healing, `healing` → healing, `save` → save |
> | `areas.js`       | Template **Regions** (dnd5e 6 creates Regions, not MeasuredTemplates, on v14) → `areaPlaced`; deleted regions → `effectRemoved`                                       |
> | `effects.js`     | ActiveEffects → `effectApplied` / `effectRemoved`; concentration carries the concentrated spell's descriptors                                                         |
> | `descriptors.js` | `system.identifier` keys, base weapons (`DND5E.weaponIds`) → PF2e weapon groups, attack modes, activity templates, damage / healing types                             |
> | `sheet.js`       | "Animation" header control (`getHeaderControlsDocumentSheetV2`, dnd5e 6 sheets are ApplicationV2)                                                                     |
>
> Its rule pack is [`rules/dnd5e.json`](../rules/dnd5e.json) and its tests are in `tests/systems/dnd5e/`. It listens to `createChatMessage` rather than `dnd5e.rollAttackV2` because the typed messages carry a stable id, the stored targets with their AC and the creating user; `dnd5e.postUseActivity` is only used for activities used without a chat card.

The sketch below is a deliberately small version of the same idea: it animates weapon and spell **attacks** and marks every other activity as a `cast`. It is kept as a minimal illustration of the contract, not as a reference for dnd5e data paths (for those, read the real adapter).

`src/systems/dnd5e/index.js`:

```js
import { SystemAdapter } from "../../shared/adapter.js";
import { ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../../shared/events.js";

const RANGED_GROUPS = {
  longbow: "bow",
  shortbow: "bow",
  lightcrossbow: "crossbow",
  handcrossbow: "crossbow",
  heavycrossbow: "crossbow",
  sling: "sling",
  dart: "dart"
};
const MELEE_GROUPS = {
  longsword: "sword",
  shortsword: "sword",
  greatsword: "sword",
  scimitar: "sword",
  rapier: "sword",
  dagger: "dagger",
  handaxe: "axe",
  battleaxe: "axe",
  greataxe: "axe",
  warhammer: "hammer",
  lighthammer: "hammer",
  mace: "club",
  club: "club",
  spear: "spear",
  unarmed: "brawling"
};

export default class Dnd5eAdapter extends SystemAdapter {
  static id = "dnd5e";
  static label = "D&D 5e";

  #hooks = [];

  register() {
    // VERIFY(dnd5e 5.x): fired after an attack roll, with the rolls and the activity that made them.
    this.#on("dnd5e.rollAttack", (rolls, data) => this.#onAttack(rolls, data));
    // VERIFY(dnd5e 5.x): fired after any activity is used.
    this.#on("dnd5e.postUseActivity", (activity) => this.#onUse(activity));
  }

  unregister() {
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  getItemKey(item) {
    return item?.system?.identifier || super.getItemKey(item);
  }

  getItemDescriptors(item) {
    const base = super.getItemDescriptors(item);
    const sys = item?.system ?? {};
    const properties = [...(sys.properties ?? [])];
    const baseItem = sys.type?.baseItem ?? "";
    let attackKind = null;
    if (item?.type === "weapon") {
      if (properties.includes("thr")) attackKind = ATTACK_KINDS.THROWN;
      else attackKind = sys.type?.value?.endsWith("R") ? ATTACK_KINDS.RANGED : ATTACK_KINDS.MELEE;
    }
    const damageTypes = [...(sys.damage?.base?.types ?? [])].map((t) => String(t).toLowerCase());
    return {
      ...base,
      type: { weapon: "weapon", spell: "spell", consumable: "consumable", feat: "feat" }[item?.type] ?? "other",
      traits: [...properties, sys.school].filter(Boolean).map((t) => String(t).toLowerCase()),
      attackKind,
      weaponGroup: RANGED_GROUPS[baseItem] ?? MELEE_GROUPS[baseItem] ?? null,
      range: sys.range?.value ?? null,
      damageTypes,
      isHealing: damageTypes.includes("healing")
    };
  }

  #on(hook, fn) {
    this.#hooks.push([hook, Hooks.on(hook, fn)]);
  }

  #sourceOf(actor) {
    const token = actor?.getActiveTokens?.()[0] ?? null;
    return { tokenId: token?.id ?? null, actorId: actor?.id ?? null };
  }

  #onAttack(rolls, data) {
    const activity = data?.subject; // VERIFY: the AttackActivity
    const item = activity?.item;
    if (!item || !rolls?.length) return;
    const roll = rolls[0];
    const targets = [...game.user.targets];
    const outcomeFor = (target) => {
      if (roll.isCritical) return OUTCOMES.CRITICAL_SUCCESS;
      if (roll.isFumble) return OUTCOMES.CRITICAL_FAILURE;
      const ac = target.actor?.system?.attributes?.ac?.value;
      if (ac == null) return OUTCOMES.SUCCESS;
      return roll.total >= ac ? OUTCOMES.SUCCESS : OUTCOMES.FAILURE;
    };
    const perTarget = targets.map((t) => ({ tokenId: t.id, outcome: outcomeFor(t) }));
    this.ctx.emit({
      type: EVENT_TYPES.ATTACK,
      source: this.#sourceOf(item.actor),
      targets: perTarget,
      outcome: perTarget[0]?.outcome ?? outcomeFor({}),
      itemUuid: item.uuid,
      descriptors: this.getItemDescriptors(item),
      userId: game.user.id
    });
  }

  #onUse(activity) {
    if (activity?.type === "attack") return; // handled by #onAttack
    const item = activity?.item;
    if (!item) return;
    this.ctx.emit({
      type: EVENT_TYPES.CAST,
      source: this.#sourceOf(item.actor),
      targets: [...game.user.targets].map((t) => ({ tokenId: t.id })),
      outcome: OUTCOMES.NONE,
      itemUuid: item.uuid,
      descriptors: this.getItemDescriptors(item),
      userId: game.user.id
    });
  }
}
```

Then:

1. Add `rules/dnd5e.json` (Step 4).
2. Add `Dnd5eAdapter` to `BUILTIN_ADAPTERS`.
3. Add a `lang/en/dnd5e.json` if you add UI strings (keys `SVA.Dnd5e.*`) and list it in `module.json`.
4. Write the unit tests (Step 7) and a `testing.md` section.
5. In a dnd5e world, check `SVA.systems.active.id === "dnd5e"`, attack with a longbow, and verify `SVA.automation.explain(item)`.

All five steps are done for the shipped adapter: `rules/dnd5e.json`, `src/systems/index.js`, `lang/en/dnd5e.json`, `tests/systems/dnd5e/` and [testing.md § 11](testing.md#11-dd-5e-adapter).

Neither `src/automation`, `src/engine` nor `src/db` changed: that is the acceptance test for a new adapter.

## Notes for GURPS

The real GURPS Game Aid adapter lives in [`src/systems/gurps/`](../src/systems/gurps/) (target: GGA v0.18.23, Foundry v13-v14). Read it next to the PF2e one: it shows how to support a system where attacks are **not items**.

- **Integration point**: GGA fires no roll hooks (only `gurpsinit`, `gurpsready`, `updateLastActorGURPS`) and sets no flags on roll cards, so [`messages.js`](../src/systems/gurps/messages.js) parses GGA's own chat cards in `createChatMessage`. Every targeted roll posts `die-roll-chat-message.hbs`, whose rolled OtF (`[@<actorId>@M:"Broadsword (Swing)"]`) GGA's `preCreateChatMessage` hook turns into `<span class='gurpslink' data-action='<base64 JSON>'>`. The adapter decodes that action (`type`, `name`, `isMelee`/`isRanged`, `isSpellOnly`, `sourceId`), falls back to `data-otf`, then to the `3d6[<name>]` roll flavor, and reads the outcome from the card's `crit success` / `success` / `failure` / `crit failure` span. Damage cards carry `flags.gurps.transfer` (`type: "damageItem"`).
- **Events**: attack roll → `attack`; spell roll → `cast`, or `healing` for healing spells and First Aid (never both); damage roll → `damage`, described as the actor's last attack if it was rolled within two minutes. Parry, block and dodge are ignored: the contract has no defense event.
- **Descriptors without items**: [`descriptors.js`](../src/systems/gurps/descriptors.js) builds `ItemDescriptors` from the actor's `system.melee` / `system.ranged` / `system.spells` / `system.skills` entries: `key` is the slug of the name, `attackKind` comes from the list (a ranged row whose mode says "Thrown" is `thrown`), `weaponGroup` from the weapon name, `damageTypes` from GURPS damage codes (`cut` → slashing, `imp`/`pi*` → piercing, `cr` → bludgeoning, `burn` → fire, `cor` → acid, `tox` → poison), and the raw codes, usage mode, spell college and class become `traits`. `itemUuid` is set when the entry comes from an Item (`fromItem` / `itemid`), so per-item recipes still work.
- **Rule pack**: [`rules/gurps.json`](../rules/gurps.json) matches by `regex` on names, weapon groups and damage-code traits. Missile spells get two rules, one on `cast` (type `spell`) and one on `attack` (`attackKind: ranged`), because casting and throwing are two rolls.

## Checklist

- [ ] `static id` equals `game.system.id`; folder is `src/systems/<id>/`.
- [ ] No imports from SVA outside `src/shared/`.
- [ ] `getItemKey` and `getItemDescriptors` never throw on odd items.
- [ ] Every event is emitted exactly once, from the acting user's client, with `userId`.
- [ ] Outcomes are mapped per target when the system provides them.
- [ ] `unregister()` removes every hook.
- [ ] `rules/<id>.json` uses real JB2A paths; the free JB2A module is considered.
- [ ] Unit tests with fake items/messages; a `testing.md` section run with two clients.
- [ ] No change to `src/automation`, `src/engine` or `src/db` was needed.
