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
api.systems.initAll(); // automation init: calls every class's optional static init(api) once
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
Rule = { id, label, enabled, priority, match: { key?, name?, regex?, type?, traits?, attackKind?, weaponGroup?, baseItem? }, recipe }
RulePack (rules/<system>.json) = { system, version: 1, rules: Rule[] }
```

Persistent recipes (`aura`) name their effect `aura:<actorId>:<itemKey>` (the actor carrying the effect) and are only persistent on `effectApplied` / `areaPlaced`, the events that have a matching `effectRemoved`. On a `cast` the aura plays once (or for `options.duration`).

## PF2e adapter (#29–#34)

`src/systems/pf2e/index.js` default-exports `class Pf2eAdapter extends SystemAdapter` (`static id = "pf2e"`). It is listed in `src/systems/index.js`. It is the only code that reads `message.flags.pf2e`, PF2e item data, traits and slugs. It emits `AutomationEvent`s through `this.ctx.emit(event)`. The sheet integration adds a header control on PF2e item sheets that calls `api.ui.openItemConfig(item)`.

## UI (#36–#39)

ApplicationV2 + `HandlebarsApplicationMixin`, templates in `templates/`, CSS in `styles/sva.css` (prefix `.sva-`).

```js
api.ui.openBrowser({ onPick }); // animation browser; onPick(path) for pickers
api.ui.openItemConfig(item); // per-item recipe editor (uses api.automation.*)
api.ui.openRulesManager();
api.ui.openActorOverview(actor); // every item's animation for one actor (#74)
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
  - `api.db.findThumbnail(pathOrFile)` (async): answers from the thumbnail index when it is ready, else probes candidate names.
  - `api.db.thumbnails` (#67): `{status, ready, count, find(file), build({force}), clearCache()}`. JB2A doesn't list its thumbnails, so after the catalog loads the JB2A `Library` folder is walked once with the FilePicker (`data` or `s3`), cached in the browser's localStorage per JB2A version and install location, and videos are matched to thumbnails by normalized name (`src/db/thumbnail-index.js`). `thumbnail` comes from the index when it is ready (then `null` means none exists), otherwise it is the name guess. The animation browser captures a video frame for cards without a thumbnail and shows placeholder art when that fails too.
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
  - Duplicate events: an event with an `id` is dropped when that id was already handled (the last 500 ids are remembered); an event without an `id` is dropped when an identical one arrived within 1 s.
- **events:**
  - `area.origin` is the centre for burst/emanation/square and the apex for cone/line; `area.angle` (degrees) for cones.
  - Adapters include at least `descriptors.key` on `effectRemoved`, because the item is usually already deleted.
  - Optional `AutomationEvent.id`: a stable id of the occurrence (PF2e: `<messageId>:<type>`, `<regionId>:<type>`, `<effectItemUuid>:<type>`), used for de-duplication.
  - `ItemDescriptors.baseItem` (PF2e weapons), matched by `Rule.match.baseItem` (specificity between `name` and `regex`).
- **teleport:** the `teleport` preset moves the source token between the vanish and the appear (on the automation client): destination = `event.area.origin` → `options.destination` → a canvas click (`options.pickDestination`); `options.moveToken: false` keeps animation only. The GM updates the token with `animate: false`; players send `teleportMove` `{requestId, sceneId, tokenId, x, y}` over `api.net`, the active GM applies it when the sender owns the token and answers `teleportMoved` `{requestId, ok, reason?}` (types added through `api.net.on/emit`, protocol `v: 1` unchanged). `api.automation.teleport.{moveToken, pickCanvasPoint}`.
- **systems:** optional `static init(api)` on `SystemAdapter`, called once per registered class during the automation area's `init` (immediately for classes registered later), active or not. Adapters register their settings there; PF2e registers `pf2eConditionEvents`.
- **ui:** `api.ui.openSettings()`. Settings may declare `svaGroup` to choose their group in the SVA settings panel.
- **ui (#74):** `api.ui.openActorOverview(actor)`: every item of an actor with the animation it resolves to (`api.automation.explain`; when that finds nothing, the event types the item's descriptors suggest are probed so fallback recipes show too), its source and triggers, with Preview / Change (browser picker → item recipe keeping the resolved preset/options/stages) / Edit / Reset / Disable. Entry points live in `src/ui/entry-points.js` (system-agnostic): token HUD button (`renderTokenHUD`, client setting `uiTokenHud`), actor sheet header control (`getActorSheetHeaderButtons` for V1, `getHeaderControlsActorSheetV2` for V2) and a token-controls button for the controlled token. Foundry has no generic hook for item context menus on actor sheets; adapters may add one that calls `api.ui.openActorOverview`.

### Open follow-ups

None. New ones are tracked as GitHub issues.
