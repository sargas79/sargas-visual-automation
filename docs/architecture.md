# Architecture & contracts

This document is the **source of truth** for how the areas of Sargas Visual Automation (SVA) talk to each other. Every area is built against these contracts. If you need to change a contract, change this file and `src/shared/*` in a PR of its own.

## Runtime flow

```
PF2e hooks ──► systems/pf2e (adapter) ──emit──► automation (match item → recipe → compile)
                                                        │ SequenceDescriptor
                                                        ▼
macros / UI ──► api.sequence() builder ──────► api.playSequence(desc)
                                                        │ broadcast (net) + run locally on every client
                                                        ▼
                                        sequence runner ──► api.engine.play(effect)   (PIXI, local)
                                                        └─► api.effects (persist:true → scene flags)
                                        api.engine resolves `file` via api.db (JB2A catalog)
```

## Areas, owners and public surface

Every area is a folder with an `index.js` exporting optional `init(api)`, `setup(api)` and `ready(api)`. `src/main.js` calls them in this order: **db → engine → net → sequence → effects → automation → ui**. An area attaches its public surface to the shared `api` object, which is also `globalThis.SVA` and `game.modules.get("sargas-visual-automation").api`.

| Area                       | Folder(s)                                                    | Issues             | Attaches                                                     |
| -------------------------- | ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------ |
| JB2A database              | `src/db/`                                                    | #8–#11             | `api.db`                                                     |
| Rendering engine           | `src/engine/`                                                | #13–#16, #19       | `api.engine`                                                 |
| Sequence, persistence, net | `src/sequence/`, `src/effects/`, `src/net/`                  | #17, #18, #21, #22 | `api.sequence`, `api.playSequence`, `api.effects`, `api.net` |
| Automation core            | `src/automation/`, `src/systems/_template/`, `rules/` format | #24–#27            | `api.automation`, `api.systems`                              |
| PF2e adapter               | `src/systems/pf2e/`, `rules/pf2e.json`                       | #29–#34            | (registered adapter)                                         |
| UI                         | `src/ui/`, `templates/`, `styles/`                           | #36–#39            | `api.ui`                                                     |
| Docs & examples            | `docs/`, `packs/` / macro sources                            | #41–#43            | -                                                            |

**Shared, core-owned files:** `src/shared/*`, `src/main.js`, `src/api.js`, `src/constants.js`, `src/systems/index.js`, `docs/architecture.md`, `tests/setup/foundry-mock.js`. Don't change these inside an area PR. Put test helpers for an area in `tests/<area>/helpers/`.

**Localization:** every area has its own file `lang/en/<area>.json`, merged by Foundry. Keys are namespaced `SVA.<Area>.*`, for example `SVA.Db.Missing`.

**Settings:** registered by the area in its `init`, with keys prefixed by area in camelCase: `engineMaxEffects`, `netMinTriggerRole`, `automationEnabled`.

## Shared contracts (`src/shared/`)

- `descriptors.js`: `EffectDescriptor`, `SequenceDescriptor`, `LAYERS`, `normalizeEffect`, `createSequence`. Plain JSON only; these objects travel over sockets and are stored in flags.
- `events.js`: `AutomationEvent`, `ItemDescriptors`, `EVENT_TYPES`, `OUTCOMES`, `AREA_SHAPES`, `ATTACK_KINDS`, `createAutomationEvent`.
- `adapter.js`: `SystemAdapter` base class.

## `api.db` - JB2A database (#8–#11)

```js
api.db.ready; // Promise<void>, resolves after the Foundry "ready" hook once the catalog is built (or JB2A is missing)
api.db.available; // boolean
api.db.provider; // "jb2a_patreon" | "JB2A_DnD5e" | null
api.db.resolve(path, { distance }); // → ResolvedFile | null. Random leaf for partial paths and arrays.
//   distance (scene units): when the node has distance variants (05ft, 15ft, 30ft, 60ft, 90ft), pick the closest.
api.db.has(path); // boolean
api.db.getEntry(path); // → CatalogEntry | null   (a single node, leaf or branch)
api.db.list(prefix, { depth }); // → CatalogEntry[] (children of a branch)
api.db.search(query, { limit }); // → CatalogEntry[] (leaves), ranked
```

```js
ResolvedFile = {
  path: "jb2a.fire_bolt.orange",     // full dot path of the chosen leaf
  file: "modules/jb2a_patreon/Library/.../FireBolt_01_Regular_Orange_30ft_1600x400.webm",
  thumbnail: ".../..._Thumb.webp" | null,
  size: { width: 1600, height: 400 } | null,        // parsed from the file name
  template: { gridSize: 200, startPad: 200, endPad: 200 } | null,  // from _templates, e.g. ranged: [200,200,200]
  markers: { loop: { start: 3000, end: 5958 } } | null,            // from _markers
  distance: "30ft" | null
}
CatalogEntry = { path, name, isLeaf, children?: string[], thumbnail?: string|null }
```

The catalog is read from `game.modules.get("jb2a_patreon" | "JB2A_DnD5e").api.patreonDatabase` (set by JB2A on `ready`). Paths start with `jb2a.`. Keys starting with `_` are metadata, not nodes; the nearest ancestor's `_template` / `_markers` applies.

## `api.engine` - local rendering (#13–#16, #19)

The engine **only renders on the local client**. It never sends sockets and never writes documents.

```js
api.engine.play(effect: EffectDescriptor) // → Promise<EffectHandle>; resolves once the sprite is on the canvas
api.engine.get(id)                        // → EffectHandle | undefined
api.engine.active()                       // → EffectHandle[]
api.engine.end(id, { immediate })         // fade out unless immediate; Promise<void>
api.engine.endAll()
api.engine.preload(pathsOrFiles)          // Promise<void>
EffectHandle = { id, descriptor, finished: Promise<void>, end(opts) }
```

- `file` is resolved through `api.db.resolve` (use `distance` when `stretchTo` is set). A value containing `/` is used as a direct URL.
- Anchors: `{tokenId}` refers to a token on the current scene, `{x, y}` to canvas pixels, and `offset` adds pixels.
- Skip an effect (resolve immediately with an already-finished handle) when `effect.sceneId` / the sequence's scene is not the viewed scene, or when `users` doesn't include `game.user.id`.
- `persist: true` loops forever (intro → `_markers.loop` → outro on end) until `end()`.
- Tear everything down on `canvasTearDown`. `finished` resolves when the effect is removed for any reason.

## Sequence, persistence, net (#17, #18, #21, #22)

```js
api.sequence()                         // → SequenceBuilder
  .effect()                            // → EffectBuilder; chain setters mirror EffectDescriptor:
     .file(f).atLocation(a).stretchTo(a).rotateTowards(a).attachTo(tokenId, {followRotation})
     .scale(n).scaleToObject(n).size(w, h, {gridUnits}).rotate(deg).mirrorX().mirrorY().opacity(n).tint(hex)
     .fadeIn(ms, {ease}).fadeOut(ms, {ease}).scaleIn(v, ms, {ease}).scaleOut(v, ms, {ease})
     .duration(ms).playbackRate(r).startTime(ms).endTime(ms).delay(ms).layer(name).zIndex(n)
     .missed(bool).returnTrip(bool).persist(bool).essential(bool).name(tag).forUsers(ids)
     .waitUntilFinished(offsetMs = 0)
  .wait(ms)
  .sound(file, { volume, delay })
  .toDescriptor()                      // → SequenceDescriptor
  .play({ broadcast = true })          // → Promise<void>
api.playSequence(descriptor, { broadcast = true })  // Promise<void>
```

- Anchors accept a `Token`, a `TokenDocument`, a token id, `{x, y}` or an `Anchor`, and are converted to an `Anchor`.
- `playSequence` with `broadcast`: emit it over the socket, then run it locally. Every client runs its own runner, which calls `api.engine.play`.
- **Persistence (`api.effects`)**: an effect with `persist: true` is also stored in `scene.flags["sargas-visual-automation"].effects[id]` (descriptor). Only the GM writes flags; players ask the GM over the socket. On `canvasReady`, every stored effect for the scene is re-played. Deleting a token ends effects anchored to or attached to it.
  ```js
  api.effects.list({ sceneId, name }); // stored descriptors
  api.effects.end({ id, name, sceneId }); // removes flag + ends on all clients
  api.effects.endAll({ sceneId });
  ```
- **Net (`api.net`)**: one channel `module.sargas-visual-automation`. Payload `{ v: 1, type, data, senderId }`, with types `play`, `end`, `preload`, `effectsWrite`.
  ```js
  api.net.emit(type, data)  api.net.on(type, handler)
  ```
- **Client preferences (#22):** effects disabled and reduced motion (skip non-essential effects). The world setting "minimum role to trigger" is checked before `playSequence` broadcasts.

## Automation core (#24–#27)

```js
api.systems.register(AdapterClass); // built-ins come from src/systems/index.js BUILTIN_ADAPTERS
api.systems.active; // the active SystemAdapter instance | null
api.systems.list(); // registered adapter classes

api.automation.handle(event); // entry point called by adapter ctx.emit (normalizes, dedupes, runs)
api.automation.resolveRecipe(item, { eventType }); // → { recipe, source: "item"|"world"|"system"|"fallback", ruleId, reason } | null
api.automation.explain(item); // same, plus the full list of candidate rules (for UI/debug)
api.automation.compile(recipe, event); // → SequenceDescriptor[]
api.automation.preview(recipe, { sourceToken, targetTokens }); // play locally without an event
api.automation.getItemRecipe(item) / setItemRecipe(item, recipe) / setItemDisabled(item, bool);
api.automation.rules.list() / save(rule) / delete id / exportJSON() / importJSON(json);
api.automation.presets; // { [presetId]: { label, stages, optionsSchema } } for UI forms
```

Only the client whose `game.user.id === event.userId` runs automation; the resulting sequence is broadcast.

**Resolution priority:** item flag `flags["sargas-visual-automation"].recipe` → world rules (setting) → active system's rule pack (`rules/<systemId>.json`, loaded with `fetch(adapter.rulePackUrl)`) → generic fallback by `descriptors` (attackKind, damageTypes, isHealing). `flags["sargas-visual-automation"].disabled === true` turns automation off for that item.

```js
Recipe = {
  version: 1,
  preset: "melee" | "ranged" | "onToken" | "area" | "aura" | "teleport",
  animation: "jb2a.…",            // main db path
  options: { … },                 // preset-specific (color, scale, layer, …)
  stages?: { cast?, projectile?, impact?, onSource?, onTarget? },  // each: { animation, options }
  outcomes?: { criticalSuccess?, success?, failure?, criticalFailure? }, // partial Recipe overrides
  sound?: { file, volume, delay },
  triggers?: ["attack", "damage", "cast", "save", "healing", "areaPlaced", "effectApplied"] // default per preset
}
Rule = { id, label, enabled, priority, match: { key?, name?, regex?, type?, traits?, attackKind?, weaponGroup? }, recipe }
RulePack (rules/<system>.json) = { system, version: 1, rules: Rule[] }
```

Persistent recipes (`aura`) name their effect `aura:<actorId>:<itemKey>`. They end on `effectRemoved`.

## PF2e adapter (#29–#34)

`src/systems/pf2e/index.js` default-exports `class Pf2eAdapter extends SystemAdapter` (`static id = "pf2e"`). It is listed in `src/systems/index.js`. It is the only code that reads `message.flags.pf2e`, PF2e item data, traits and slugs. It emits `AutomationEvent`s through `this.ctx.emit(event)`. The sheet integration adds a header control on PF2e item sheets that calls `api.ui.openItemConfig(item)`.

## UI (#36–#39)

ApplicationV2 + `HandlebarsApplicationMixin`, templates in `templates/`, CSS in `styles/sva.css` (prefix `.sva-`).

```js
api.ui.openBrowser({ onPick }); // animation browser; onPick(path) for pickers
api.ui.openItemConfig(item); // per-item recipe editor (uses api.automation.*)
api.ui.openRulesManager();
```

Settings submenu entries are registered in `ui` `init`.

## Testing rules

- Unit tests (Vitest) live in `tests/<area>/*.test.js`. They must not need Foundry, JB2A or network access.
- Mock other areas through the `api` object. Don't import another area's internals; only use its public surface from this document.
- Anything that can only be checked in a real Foundry v14 world goes into `docs/testing.md`.

## Contract additions from implementation

These were added while the areas were built, and are part of the contract from now on.

- **API root:** `SVA.SystemAdapter`, `SVA.LAYERS`, `SVA.EVENT_TYPES`, `SVA.OUTCOMES`, `SVA.AREA_SHAPES`, `SVA.ATTACK_KINDS`. Third-party adapters extend `SVA.SystemAdapter`.
- **db:**
  - `api.db.findThumbnail(pathOrFile)` (async, probes candidate names). JB2A doesn't list thumbnails, so `thumbnail` is a best guess.
  - `CatalogEntry.label` and `CatalogEntry.distances` (on distance groups); `ResolvedFile.template.name`.
  - `resolve(path, {distance, gridDistance})`.
  - `search` returns distance groups rather than each `05ft`/`15ft`/… variant.
  - Distance variant: closest in grid squares, ties go to the longer one, default 30 ft.
- **engine:**
  - `EffectHandle.duration`: wall ms, `Infinity` when persistent, set once the video is known.
  - `play()` resolves after `delay`; `endAll({immediate})`.
  - `api.engine.debug.{stats, overlay}`.
  - Settings `engineMaxEffects`, `engineCacheSize`, `engineDebugOverlay`.
- **sequence / effects / net:**
  - `api.effects.store(sequence)` (called by `playSequence`).
  - `api.net.off`, `api.net.preload(files)`, `api.net.prefs`.
  - Ending a stored effect is driven by the scene flag update; `end`/`endAll` also broadcast `end` so unstored named effects end everywhere.
  - Reduced motion (#66): persistent effects are always kept; `EffectDescriptor.essential: true` effects are kept unchanged and `essential: false` effects are skipped. Only effects that don't set `essential` use the fallback heuristic: skip `screen`-layer effects and drop `returnTrip`, `scaleIn` and `scaleOut`. Builder: `.essential(bool = true)` (`null` clears it). Automation presets mark the effects that convey the result (attack / projectile including misses, onToken, area, impact, onTarget) essential, and cast / onSource not.
- **automation:**
  - World rules are stored as `{version: 1, rules: []}`.
  - `explain(item, opts)` returns a trace `{descriptors, disabled, result, candidates[{source, ruleId, label, priority, matched, reasons[]}], reasons}`, where `result` is the `resolveRecipe` shape.
  - `setItemRecipe(item, null)` clears the item recipe; `rules.importJSON` accepts a string or an object; `rules.exportJSON` returns a string.
  - Extras: `api.automation.schema`, `reloadRulePack`, `isItemDisabled`, `rules.all/systemRules/setSystemRules`.
  - Duplicate events are dropped within 1 s.
- **events:**
  - `area.origin` is the centre for burst/emanation/square and the apex for cone/line; `area.angle` (degrees) for cones.
  - Adapters include at least `descriptors.key` on `effectRemoved`, because the item is usually already deleted.
  - `ItemDescriptors.baseItem` (PF2e weapons).
- **ui:** `api.ui.openSettings()`. Settings may declare `svaGroup` to choose their group in the SVA settings panel.

### Open follow-ups

- An optional `AutomationEvent.id` (for example the chat message id), to replace the 1 s duplicate window.
- `Rule.match.baseItem`.
- A static adapter `init()` hook, so adapters can register settings during `init` (PF2e currently registers on `ready`).
