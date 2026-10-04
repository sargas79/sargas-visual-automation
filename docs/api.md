# Macro & module API reference

Everything SVA offers to macros and other modules hangs off one object:

```js
const SVA = game.modules.get("sargas-visual-automation").api;
// Also available as the global `SVA` once the module has initialized.
```

This page is for **macro and module authors**. The internal contracts between SVA's own areas are in [architecture.md](architecture.md); where the two disagree, `architecture.md` wins and this page is a bug.

- [Getting started](#getting-started)
- [Anchors](#anchors)
- [`SVA.sequence()` - the sequence builder](#svasequence---the-sequence-builder)
- [`SVA.playSequence()` and descriptors](#svaplaysequence-and-descriptors)
- [`SVA.effects` - persistent effects](#svaeffects---persistent-effects)
- [`SVA.db` - the JB2A catalog](#svadb---the-jb2a-catalog)
- [`SVA.engine` - local rendering](#svaengine---local-rendering)
- [`SVA.net` - sockets](#svanet---sockets)
- [`SVA.automation` and `SVA.systems`](#svaautomation-and-svasystems)
- [`SVA.ui`](#svaui)
- [Hooks](#hooks)
- [Coming from Sequencer](#coming-from-sequencer)

## Getting started

```js
// Macro: fire bolt from the selected token to every target.
const SVA = game.modules.get("sargas-visual-automation").api;
for (const target of game.user.targets) {
  await SVA.sequence().effect().file("jb2a.fire_bolt.orange").atLocation(token).stretchTo(target).play();
}
```

- **Wait for readiness** in world scripts and other modules: SVA is complete after the Foundry `ready` hook. Use the [`sargas-visual-automation.ready`](#hooks) hook, or `SVA.ready === true`. The JB2A catalog has its own promise, `await SVA.db.ready`.
- **Files** are JB2A **database paths** (`"jb2a.fire_bolt.orange"`) or direct URLs (anything containing `/`). Paths are resolved on each client through `SVA.db`, so they work for both the Patreon and the free JB2A module, and with JB2A's custom asset location. Browse paths with the [animation browser](user-guide.md#animation-browser).
- **Everything is synchronized**: `play()` broadcasts the sequence to every connected client on the same scene, and each client renders it locally.

## Anchors

Every location argument (`atLocation`, `stretchTo`, `rotateTowards`) accepts:

| Value                              | Meaning                                    |
| ---------------------------------- | ------------------------------------------ |
| a `Token` (e.g. `token`, a target) | The token's center, follows the token's id |
| a `TokenDocument`                  | Same                                       |
| a token id string                  | A token on the sequence's scene            |
| `{ x, y }`                         | Canvas pixel coordinates                   |
| `{ tokenId, offset: { x, y } }`    | A token, shifted by `offset` pixels        |
| `{ x, y, offset: { x, y } }`       | A point, shifted by `offset` pixels        |

Tiles, templates and regions are not anchors; pass their center as `{ x, y }`:

```js
const tile = canvas.tiles.controlled[0];
const center = { x: tile.document.x + tile.document.width / 2, y: tile.document.y + tile.document.height / 2 };
```

## `SVA.sequence()` - the sequence builder

`SVA.sequence()` returns a **SequenceBuilder**. Steps run in order; an effect step does **not** wait for its effect to finish unless you call `waitUntilFinished()`.

```js
const seq = SVA.sequence();
seq.effect().file("jb2a.magic_signs.circle.02.evocation.complete.red").atLocation(token).waitUntilFinished(-500);
seq.effect().file("jb2a.fire_bolt.orange").atLocation(token).stretchTo(target);
await seq.play();
```

The same sequence as one chain (the effect builder hands `.effect()`, `.wait()`, `.sound()`, `.play()` and `.toDescriptor()` back to its sequence, like Sequencer):

```js
await SVA.sequence()
  .effect()
  .file("jb2a.magic_signs.circle.02.evocation.complete.red")
  .atLocation(token)
  .waitUntilFinished(-500)
  .effect()
  .file("jb2a.fire_bolt.orange")
  .atLocation(token)
  .stretchTo(target)
  .play();
```

> The example macros use the first style (`const seq = SVA.sequence(); seq.effect()...`). It reads well when an effect is conditional (`if (crit) seq.effect()...`).

### SequenceBuilder

| Method                            | Description                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `.effect()`                       | Add an effect step and return its **EffectBuilder**.                                                                                           |
| `.wait(ms)`                       | Pause the sequence.                                                                                                                            |
| `.sound(file, { volume, delay })` | Play an audio file (URL). `volume` 0..1 is multiplied by each client's SVA volume preference; `delay` in ms. JB2A ships no sounds.             |
| `.toDescriptor()`                 | Return the plain-JSON [`SequenceDescriptor`](#svaplaysequence-and-descriptors).                                                                |
| `.play({ broadcast = true })`     | Play it. With `broadcast`, send it to every client, then run it locally. Returns `Promise<void>` that resolves when the sequence has finished. |

### EffectBuilder

Setters mirror the fields of an `EffectDescriptor` (see `src/shared/descriptors.js`). All are chainable.

| Method                                             | Field / effect                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.file(path)`                                      | JB2A path or URL. A partial path (`"jb2a.explosion.01"`) or an array picks a random leaf.                                                                                                 |
| `.atLocation(anchor)`                              | Where the effect starts or sits. Required unless `attachTo` is set.                                                                                                                       |
| `.stretchTo(anchor)`                               | Stretch from `atLocation` to this anchor (projectiles, rays, melee swings). Uses JB2A's `_templates` padding and picks the distance variant (`05ft`…`90ft`) closest to the real distance. |
| `.rotateTowards(anchor)`                           | Face this anchor.                                                                                                                                                                         |
| `.attachTo(tokenId, { followRotation })`           | Follow a token while it moves (and rotates, if `followRotation`). Pass `token.id`.                                                                                                        |
| `.scale(n)` / `.scale({ x, y })`                   | Scale factor.                                                                                                                                                                             |
| `.scaleToObject(n)`                                | Fit to the located/attached token's size, times `n`.                                                                                                                                      |
| `.size(width, height, { gridUnits })`              | Explicit size in pixels, or in grid squares with `gridUnits: true`.                                                                                                                       |
| `.rotate(deg)`                                     | Extra rotation.                                                                                                                                                                           |
| `.mirrorX()` / `.mirrorY()`                        | Flip horizontally / vertically.                                                                                                                                                           |
| `.opacity(n)`                                      | 0..1, default 1.                                                                                                                                                                          |
| `.tint(hex)`                                       | CSS hex colour, e.g. `"#92cbff"`.                                                                                                                                                         |
| `.fadeIn(ms, { ease })` / `.fadeOut(ms, { ease })` | Fade. `ease` names follow the usual `easeInOutSine` family.                                                                                                                               |
| `.scaleIn(value, ms, { ease })` / `.scaleOut(…)`   | Grow from / shrink to `value` times the final scale.                                                                                                                                      |
| `.duration(ms)`                                    | Force a duration (otherwise the video length).                                                                                                                                            |
| `.playbackRate(r)`                                 | Video speed.                                                                                                                                                                              |
| `.startTime(ms)` / `.endTime(ms)`                  | Skip the first `ms` / stop `ms` before the end.                                                                                                                                           |
| `.delay(ms)`                                       | Wait before starting (does not delay the next step).                                                                                                                                      |
| `.layer(name)`                                     | `"belowTiles"`, `"belowTokens"`, `"aboveTokens"` (default), `"aboveLighting"`, `"screen"`.                                                                                                |
| `.zIndex(n)`                                       | Order within the layer.                                                                                                                                                                   |
| `.missed(bool)`                                    | Land beside the target instead of on it (with `stretchTo`).                                                                                                                               |
| `.returnTrip(bool)`                                | After a stretched effect, play it back to the source (thrown weapons).                                                                                                                    |
| `.persist(bool)`                                   | Keep until ended. Loops using JB2A's `_markers` (intro → loop → outro on end) and is [stored in the scene](#svaeffects---persistent-effects).                                             |
| `.essential(bool = true)`                          | Reduced motion: `true` always plays it unchanged, `false` skips it; `null` clears it. Unset effects use the fallback (skip `screen` layer, drop `returnTrip`/`scaleIn`/`scaleOut`).       |
| `.name(tag)`                                       | Tag used to find and end effects.                                                                                                                                                         |
| `.forUsers(ids)`                                   | Only these user ids see it (empty = everyone).                                                                                                                                            |
| `.waitUntilFinished(offsetMs = 0)`                 | The sequence waits for this effect to end before the next step. A negative offset continues that many ms **before** the end (good for overlapping intro → loop).                          |

### Examples

**Projectile with impact, crit variant and a miss:**

```js
const SVA = game.modules.get("sargas-visual-automation").api;
const [target] = game.user.targets;
const outcome = "criticalSuccess"; // "success" | "failure" | ...

const seq = SVA.sequence();
seq
  .effect()
  .file("jb2a.arrow.physical.white.02")
  .atLocation(token)
  .stretchTo(target)
  .missed(outcome === "failure")
  .waitUntilFinished(-300);
if (outcome !== "failure") seq.effect().file("jb2a.impact.001.orange").atLocation(target).scaleToObject(1.2);
if (outcome === "criticalSuccess")
  seq.effect().file("jb2a.liquid.splash_side.red").atLocation(target).rotateTowards(token).rotate(180);
await seq.play();
```

**Toggleable persistent aura:**

```js
const SVA = game.modules.get("sargas-visual-automation").api;
const name = `my-aura:${token.id}`;
const sceneId = canvas.scene.id;
if (SVA.effects.list({ sceneId, name }).length) {
  await SVA.effects.end({ name, sceneId });
} else {
  const seq = SVA.sequence();
  seq
    .effect()
    .file("jb2a.energy_field.02.below.blue")
    .attachTo(token.id)
    .scaleToObject(1.6)
    .layer("belowTokens")
    .fadeIn(800)
    .fadeOut(800)
    .persist(true)
    .name(name);
  await seq.play();
}
```

**Only the GM sees it:**

```js
const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
await SVA.sequence().effect().file("jb2a.markers.light_orb.loop.white").atLocation(token).forUsers(gmIds).play();
```

## `SVA.playSequence()` and descriptors

```js
await SVA.playSequence(descriptor, { broadcast = true });
```

Plays a **SequenceDescriptor** (plain JSON, what `toDescriptor()` returns). Use it to store sequences in flags or settings and replay them later:

```js
const desc = SVA.sequence().effect().file("jb2a.explosion.01.orange").atLocation({ x: 1000, y: 1000 }).toDescriptor();
await game.user.setFlag("world", "boom", desc);
// later
await SVA.playSequence(game.user.getFlag("world", "boom"));
```

```js
SequenceDescriptor = {
  id,
  version: 1,
  sceneId, // clients on other scenes ignore it
  userId, // who triggered it
  users: [], // visibility whitelist for every step (empty = everyone)
  steps: [
    { type: "effect", effect: EffectDescriptor, waitUntilFinished: null | number },
    { type: "wait", ms },
    { type: "sound", file, volume, delay, waitUntilFinished }
  ]
};
```

Anchors inside a descriptor are always normalized to `{ tokenId }` or `{ x, y }`. The full field list is the JSDoc of `EffectDescriptor` in `src/shared/descriptors.js`.

**Permissions:** before broadcasting, SVA checks the world setting "minimum role to trigger". A user below it gets a warning and nothing is sent. Clients that disabled effects, or reduced motion, filter what they render locally. With reduced motion, mark effects that carry information (hits, misses, impacts) with `.essential()` and decorative ones with `.essential(false)`.

## `SVA.effects` - persistent effects

An effect with `persist: true` is stored in `scene.flags["sargas-visual-automation"].effects[id]` and replayed on every client on `canvasReady` (scene load, reload, scene switch). Only the GM writes the flags; players' requests are forwarded to the active GM over the socket, so **a GM must be connected** for a player's persistent effect to be saved.

```js
SVA.effects.list({ sceneId, name }); // → EffectDescriptor[] stored on that scene (filters optional)
await SVA.effects.end({ id, name, sceneId }); // remove matching flags and end them on every client
await SVA.effects.endAll({ sceneId });
```

- Ending a persistent effect plays its outro (the part after `_markers.loop`) or its `fadeOut`.
- Deleting a token ends every persistent effect anchored or attached to it.
- Automation names aura effects `aura:<actorId>:<itemKey>`; avoid that prefix in your macros.

## `SVA.db` - the JB2A catalog

```js
await SVA.db.ready; // resolves after "ready" once the catalog is built (or JB2A is missing)
SVA.db.available; // boolean
SVA.db.provider; // "jb2a_patreon" | "JB2A_DnD5e" | null
SVA.db.has("jb2a.fire_bolt.orange"); // true
SVA.db.resolve("jb2a.fire_bolt.orange", { distance: 30 }); // → ResolvedFile | null
SVA.db.getEntry("jb2a.fire_bolt"); // → CatalogEntry | null (leaf or branch)
SVA.db.list("jb2a.fire_bolt", { depth: 1 }); // → children
SVA.db.search("fire bolt", { limit: 20 }); // → leaves, ranked
```

```js
ResolvedFile = {
  path: "jb2a.fire_bolt.orange.30ft",   // the leaf that was picked
  file: "modules/jb2a_patreon/Library/Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange_30ft_1600x400.webm",
  thumbnail: "…_Thumb.webp" | null,
  size: { width: 1600, height: 400 } | null,
  template: { gridSize: 200, startPad: 200, endPad: 200 } | null,
  markers: { loop: { start, end } } | null,
  distance: "30ft" | null
}
CatalogEntry = { path, name, isLeaf, children?, thumbnail? }
```

- `distance` is in scene units (feet on most scenes); the closest of `05ft`, `15ft`, `30ft`, `60ft`, `90ft` is picked.
- Some paths only exist in the Patreon collection. Check with `SVA.db.has(path)` and fall back:

```js
const file = SVA.db.has("jb2a.energy_strands.complete.dark_red.01")
  ? "jb2a.energy_strands.complete.dark_red.01"
  : "jb2a.energy_field.02.below.blue";
```

## `SVA.engine` - local rendering

The engine only draws on **this** client. It never sends sockets and never writes documents. Use it for previews or client-only effects; use `SVA.sequence()` for anything other players should see.

```js
const handle = await SVA.engine.play(effectDescriptor); // resolves once the sprite is on the canvas
await handle.finished; // resolves when the effect is removed for any reason
SVA.engine.get(id); // EffectHandle | undefined
SVA.engine.active(); // EffectHandle[]
await SVA.engine.end(id, { immediate: false }); // fade out unless immediate
SVA.engine.endAll();
await SVA.engine.preload(["jb2a.fireball.explosion.orange"]); // warm the local cache
```

```js
EffectHandle = { id, descriptor, finished: Promise<void>, end(opts) }
```

Effects for another scene, or whose `users` don't include you, resolve immediately with an already-finished handle.

## `SVA.net` - sockets

One channel, `module.sargas-visual-automation`, payload `{ v: 1, type, data, senderId }`. You rarely need it directly.

```js
SVA.net.emit(type, data);
SVA.net.on(type, handler); // handler(data, payload)
SVA.net.preload(files); // preload on this client and every other client
```

Built-in types: `play`, `end`, `preload`, `effectsWrite`. Use your own prefixed type names (e.g. `"my-module:ping"`) if you piggyback on the channel.

## `SVA.automation` and `SVA.systems`

Automation turns game-system events (a PF2e Strike, a spell cast, an effect being applied) into sequences. See the [user guide](user-guide.md#automation) for how items are matched, and the [adapter guide](adapter-guide.md) to add a game system.

```js
// Which recipe would this item use, and why?
SVA.automation.resolveRecipe(item, { eventType: "attack" });
// → { recipe, source: "item" | "world" | "system" | "fallback", ruleId, reason } | null
SVA.automation.explain(item); // same, plus every candidate rule

// Preview a recipe on the canvas without rolling (local only).
SVA.automation.preview(recipe, { sourceToken: token, targetTokens: [...game.user.targets] });

// Compile a recipe for an event into SequenceDescriptors (then SVA.playSequence each).
SVA.automation.compile(recipe, event);

// Per-item configuration (stored in item flags).
SVA.automation.getItemRecipe(item);
await SVA.automation.setItemRecipe(item, recipe);
await SVA.automation.setItemDisabled(item, true);

// Per-actor switch (actor flag, settable by the actor's owner): nothing the actor does animates,
// and nothing lands on its tokens.
await SVA.automation.setActorDisabled(actor, true);
SVA.automation.isActorDisabled(actor); // → boolean

// World rules.
SVA.automation.rules.list();
await SVA.automation.rules.save(rule);
await SVA.automation.rules.delete(ruleId);
SVA.automation.rules.exportJSON();
await SVA.automation.rules.importJSON(json);

SVA.automation.presets; // { melee, ranged, onToken, area, aura, teleport } with labels and option schemas
SVA.automation.soundName(descriptors, { eventType: "attack", outcome: "criticalSuccess" }); // → "crit-bow" | null

// Teleport helpers used by the teleport preset.
const point = await SVA.automation.teleport.pickCanvasPoint(); // {x, y} canvas px, or null (right-click/Escape)
await SVA.automation.teleport.moveToken({ sceneId, tokenId, x, y }); // top-left px, no slide; players go through the GM
// → { ok: true } | { ok: false, reason: "noGM" | "denied" | "missing" | "invalid" | "failed" }

// Feed an event yourself (e.g. from a module for a system without an adapter).
SVA.automation.handle({
  type: "attack",
  source: { tokenId: token.id, actorId: actor.id },
  targets: [{ tokenId: target.id }],
  outcome: "success",
  descriptors: {
    name: "Longsword",
    key: "longsword",
    type: "weapon",
    attackKind: "melee",
    weaponGroup: "sword",
    traits: [],
    damageTypes: ["slashing"],
    range: null,
    area: null,
    isHealing: false
  }
});
```

A **Recipe** is plain JSON:

```js
{
  version: 1,
  preset: "ranged",                      // melee | ranged | onToken | area | aura | teleport
  animation: "jb2a.fire_bolt.orange",
  options: { scale: 1 },                 // preset-specific
  stages: { cast: { animation: "jb2a.magic_signs.circle.02.evocation.complete.red" }, impact: { animation: "jb2a.explosion.01.orange" } },
  outcomes: { criticalSuccess: { options: { scale: 1.5 } }, failure: { stages: { impact: null } } },
  sound: { file: "sounds/fire.ogg", volume: 0.6, delay: 0 },
  triggers: ["attack"]                   // default depends on the preset
}
```

Systems:

```js
SVA.systems.active; // the active SystemAdapter instance, e.g. SVA.systems.active.id === "pf2e"
SVA.systems.list(); // registered adapter classes
SVA.systems.register(MyAdapterClass); // see adapter-guide.md
```

## `SVA.ui`

```js
SVA.ui.openBrowser({ onPick: (path) => console.log(path) }); // animation browser, optionally as a picker
SVA.ui.openItemConfig(item); // the item's Animation configuration
SVA.ui.openRulesManager(); // world rules
SVA.ui.openSettings(); // grouped settings panel
SVA.ui.openActorOverview(actor); // every item of an actor: its animation, source and trigger; preview/change/reset
SVA.ui.openActorOverview(canvas.tokens.controlled[0]?.actor); // e.g. for the selected token
```

`openActorOverview` returns the window (one per actor; calling it again focuses it) or `null` without an actor. It uses `SVA.automation.explain` for every item, so it works for any system with an adapter.

## Hooks

| Hook                             | Arguments | When                                                                                                     |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `sargas-visual-automation.ready` | `api`     | Every area has started (after Foundry `ready`). Register adapters, presets or macros that need SVA here. |

```js
Hooks.once("sargas-visual-automation.ready", async (SVA) => {
  await SVA.db.ready;
  console.log("JB2A provider:", SVA.db.provider);
});
```

## Coming from Sequencer

| Sequencer                                                                        | SVA                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `new Sequence()`                                                                 | `SVA.sequence()`                                                                                                          |
| `.effect().file(…).atLocation(…).stretchTo(…)`                                   | same                                                                                                                      |
| `.belowTokens()`                                                                 | `.layer("belowTokens")`                                                                                                   |
| `.scale(0.5)`, `.scaleToObject(1.5)`, `.rotateTowards`                           | same                                                                                                                      |
| `.size({ width, height })`                                                       | `.size(width, height)` (add `{ gridUnits: true }` for squares)                                                            |
| `.attachTo(token)`                                                               | `.attachTo(token.id, { followRotation })`                                                                                 |
| `.persist().name("x")`                                                           | `.persist(true).name("x")`                                                                                                |
| `.randomRotation()`                                                              | `.rotate(Math.random() * 360)`                                                                                            |
| `.sound().file(f)`                                                               | `.sound(f, { volume, delay })` on the sequence                                                                            |
| `Sequencer.EffectManager.getEffects({ name })`                                   | `SVA.effects.list({ sceneId: canvas.scene.id, name })` (persistent) or `SVA.engine.active()` (local)                      |
| `Sequencer.EffectManager.endEffects({ name })`                                   | `SVA.effects.end({ name, sceneId: canvas.scene.id })`                                                                     |
| `Sequencer.Preloader.preloadForClients(files)`                                   | `SVA.net.preload(files)`                                                                                                  |
| `Sequencer.Helpers.wait(ms)`                                                     | `await new Promise((r) => setTimeout(r, ms))`                                                                             |
| `Sequencer.Database.getEntry(path)`                                              | `SVA.db.getEntry(path)` / `SVA.db.resolve(path)`                                                                          |
| `.animateProperty`, `.loopProperty`, `.from(token)`, `.animation()`, `.playIf()` | Not supported. Use a plain `if` around the step for `playIf`.                                                             |
| Tagger `Tagger.getByTag("x")`                                                    | Use selected tiles/tokens, or a flag: `canvas.tiles.placeables.filter((t) => t.document.getFlag("world", "tag") === "x")` |
