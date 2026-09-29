# Manual QA checklist (Foundry v14 + PF2e + JB2A)

Unit tests (`npm test`) cover everything that can run without Foundry. This checklist covers what can only be checked in a real Foundry v14 world: rendering, sockets, flags, PF2e hooks and the UI. Run it before every release and paste the [results table](#results-table-template) into the release PR.

Each check has an **expected result**. Tick the box only when you saw that result. If a check fails, write the issue number next to it.

> Tip: open the browser console (F12) on every client during the run, and turn on **Debug logging** in the module settings. Any red error from `sargas-visual-automation` is a failure, even if the effect looked right.

## 0. Setup

### 0.1 Environment

- [ ] Foundry VTT **v14** (note the exact build in the results table).
- [ ] Game system **Pathfinder 2e** (note the version).
- [ ] JB2A installed and active: **`jb2a_patreon`** for the full run. Repeat section 1 with the free **`JB2A_DnD5e`** module once per release.
- [ ] **Sequencer and Automated Animations are NOT installed** (or at least disabled). SVA must work without them.
- [ ] SVA installed in one of these ways:
  - Development: `npm run build:packs` then `npm run link -- "<Foundry Data path>"` (junctions the repo; Foundry loads `src/main.js`).
  - Release candidate: `npm run build`, then `npm run link -- "<Foundry Data path>" --dist`, or install `module.zip` from the draft release.

### 0.2 Test world

Create a world `sva-qa` (PF2e) with:

- A scene **QA Grid**: square grid, 100 px per square, 5 ft per square, at least 30 x 30 squares, no walls, global illumination on.
- A scene **QA Other**: any second scene (for scene-switch checks).
- Actors (PC type unless noted), each with a token on **QA Grid**:
  - **Fighter** (owned by the player): longsword, shortbow, dagger (thrown), fist (unarmed), Battle Medicine feat, Healing Potion (minor).
  - **Caster** (owned by the player): Electric Arc, Ignition, Ray of Frost, Force Barrage, Fireball, Breathe Fire, Lightning Bolt, Heal, Bless, Shield (Shield cantrip).
  - **Beast** (NPC, GM only): a Jaws and a Claw strike (e.g. a wolf from the bestiary).
  - **Target A**, **Target B**, **Target C** (NPCs, GM only), placed 1, 6 and 18 squares east of Fighter.
- One **Tile** anywhere on QA Grid (for the Spike Trap macro).

### 0.3 Two clients

- [ ] **Client 1 (GM)**: normal browser window, user `Gamemaster`.
- [ ] **Client 2 (Player)**: a second browser profile or private window, user `Player` (role Player), owner of Fighter and Caster.
- [ ] Both clients are on **QA Grid**.
- [ ] In module settings, SVA is enabled and the "minimum role to trigger" is **Player**.

### 0.4 Sanity

| #   | Check                                                                   | Expected result                                                                                       |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0.a | [ ] Reload both clients, open the console.                              | A `Ready` info line from Sargas Visual Automation is logged. No errors.                               |
| 0.b | [ ] Console: `SVA.version`, `SVA.ready`                                 | Module version string, `true`.                                                                        |
| 0.c | [ ] Console: `game.modules.get("sargas-visual-automation").api === SVA` | `true`.                                                                                               |
| 0.d | [ ] Console: `Object.keys(SVA)`                                         | Contains `db`, `engine`, `sequence`, `playSequence`, `effects`, `net`, `automation`, `systems`, `ui`. |
| 0.e | [ ] Console: `SVA.systems.active?.id`                                   | `"pf2e"`.                                                                                             |

## 1. JB2A database (`api.db`)

| #   | Check                                                                                      | Expected result                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | [ ] `await SVA.db.ready; SVA.db.available, SVA.db.provider`                                | `true`, `"jb2a_patreon"` (or `"JB2A_DnD5e"` on the free run).                                                                    |
| 1.2 | [ ] `SVA.db.resolve("jb2a.fire_bolt.orange")`                                              | A `ResolvedFile` whose `file` starts with `modules/jb2a_patreon/` (or the JB2A custom location) and ends in `.webm`.             |
| 1.3 | [ ] Run `SVA.db.resolve("jb2a.explosion.01")` five times.                                  | A valid leaf each time; the `path` varies (random leaf of a partial path).                                                       |
| 1.4 | [ ] `SVA.db.resolve("jb2a.arrow.physical.white.02", { distance: 5 })`, then `distance: 60` | `distance` is `"05ft"` then `"60ft"`; `template` is `{ gridSize: 200, startPad: 200, endPad: 200 }` or the entry's own template. |
| 1.5 | [ ] `SVA.db.resolve("jb2a.shield.01.complete.01.blue").markers`                            | Has `loop.start` and `loop.end` in ms.                                                                                           |
| 1.6 | [ ] `SVA.db.resolve("jb2a.bless.200px.loop.yellow").size`                                  | `{ width: 200, height: 200 }` (parsed from the file name).                                                                       |
| 1.7 | [ ] `SVA.db.search("fire bolt", { limit: 5 })`                                             | Up to 5 leaves, the fire bolt entries first.                                                                                     |
| 1.8 | [ ] `SVA.db.resolve("jb2a.does_not_exist")`                                                | `null`, no exception.                                                                                                            |
| 1.9 | [ ] Disable every JB2A module, reload.                                                     | A clear warning notification that JB2A is missing. `SVA.db.available === false`. No console errors. Re-enable JB2A afterwards.   |

## 2. Rendering engine (`api.engine`)

Select **Fighter**, target **Target A** (1 square), unless noted. Run the snippets in the console of **Client 1**.

| #    | Check                                                                                                                                                                                | Expected result                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 2.1  | [ ] `SVA.engine.play({ file: "jb2a.explosion.01.orange", atLocation: { tokenId: token.id } })`                                                                                       | Explosion centered on Fighter, plays once and disappears. The returned handle's `finished` resolves.          |
| 2.2  | [ ] Same with `atLocation: { x: 1500, y: 1500 }`                                                                                                                                     | Explosion at that canvas point.                                                                               |
| 2.3  | [ ] **Stretch, 1 square**: `SVA.engine.play({ file: "jb2a.fire_bolt.orange", atLocation: { tokenId: token.id }, stretchTo: { tokenId: game.user.targets.first().id } })` targeting A | The bolt starts at Fighter's center and ends on Target A's center. Shortest distance variant (`05ft`/`15ft`). |
| 2.4  | [ ] **Stretch, 6 squares**: repeat targeting **Target B**.                                                                                                                           | Starts at Fighter, ends on Target B, `30ft` variant, not visibly squashed.                                    |
| 2.5  | [ ] **Stretch, 18 squares**: repeat targeting **Target C**.                                                                                                                          | Starts at Fighter, ends on Target C, `90ft` variant.                                                          |
| 2.6  | [ ] Stretch with `missed: true` on Target B.                                                                                                                                         | The projectile lands beside Target B, not on it.                                                              |
| 2.7  | [ ] `rotateTowards`, `rotation: 45`, `mirrorX`, `mirrorY`                                                                                                                            | Orientation changes as requested.                                                                             |
| 2.8  | [ ] `scale: 2`, then `scaleToObject: 1.5`, then `size: { width: 2, height: 2, gridUnits: true }`                                                                                     | Twice as large; 1.5 x the token; exactly 2 x 2 squares.                                                       |
| 2.9  | [ ] `opacity: 0.4`, `tint: "#00ff00"`                                                                                                                                                | Half-transparent, green tinted.                                                                               |
| 2.10 | [ ] `fadeIn: { duration: 1000 }`, `fadeOut: { duration: 1000 }`, `scaleIn: { value: 0, duration: 500, ease: "easeOutCubic" }`                                                        | Smooth fade in and out, grows from nothing.                                                                   |
| 2.11 | [ ] `duration: 5000` on a short effect; `playbackRate: 0.5`; `startTime: 500`                                                                                                        | Lasts 5 s; plays at half speed; skips the first 0.5 s.                                                        |
| 2.12 | [ ] `delay: 2000`                                                                                                                                                                    | Starts after 2 s.                                                                                             |
| 2.13 | [ ] Play the same file twice in a row, check the Network tab.                                                                                                                        | The `.webm` is downloaded once (cache).                                                                       |
| 2.14 | [ ] Play 20 effects at once: `for (let i = 0; i < 20; i++) SVA.engine.play({ file: "jb2a.explosion.01.orange", atLocation: { x: 300 + i * 100, y: 800 } })`                          | All 20 play; no noticeable frame drop on a mid-range PC. `SVA.engine.active().length` returns to `0`.         |
| 2.15 | [ ] Set "max concurrent effects" to 5, repeat 2.14.                                                                                                                                  | At most 5 play at a time; no errors.                                                                          |
| 2.16 | [ ] Start a persistent effect, then switch to **QA Other** and back.                                                                                                                 | No leaked sprites or videos on QA Other (`SVA.engine.active()` is empty there).                               |
| 2.17 | [ ] `SVA.engine.play({ file: "modules/jb2a_patreon/Library/Generic/Explosion/Explosion_01_Orange_400x400.webm", atLocation: { tokenId: token.id } })` (direct URL)                   | Plays (a value containing `/` is a direct URL).                                                               |

## 3. Layers

Place a Tile under Fighter first.

| #   | Check                                                          | Expected result                                                             |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 3.1 | [ ] `layer: "belowTiles"` on Fighter                           | Drawn under the tile.                                                       |
| 3.2 | [ ] `layer: "belowTokens"`                                     | Above the tile, under the token image.                                      |
| 3.3 | [ ] `layer: "aboveTokens"` (default)                           | Above the token.                                                            |
| 3.4 | [ ] `layer: "aboveLighting"` on a dark scene                   | Not darkened by the scene lighting.                                         |
| 3.5 | [ ] `layer: "screen"`                                          | Fixed on screen; does not move when panning the canvas.                     |
| 3.6 | [ ] Two effects on the same layer, `zIndex: 1` and `zIndex: 2` | The `zIndex: 2` one is on top.                                              |
| 3.7 | [ ] Hide Fighter (GM), play an effect attached to it.          | GM sees it; **Player does not** (hidden tokens don't reveal their effects). |

## 4. Attach

| #   | Check                                                                  | Expected result                                                                    |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 4.1 | [ ] Persistent aura `attachTo: { tokenId }`, then drag Fighter around. | The aura follows the token **while dragging** and after it drops, on both clients. |
| 4.2 | [ ] Same with `followRotation: true`, rotate the token.                | The aura rotates with the token. Without `followRotation` it does not.             |
| 4.3 | [ ] Move the token with the keyboard (animated movement).              | The aura follows the animation smoothly.                                           |

## 5. Persistence (`api.effects`)

| #   | Check                                                                                                                                                                                                          | Expected result                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 5.1 | [ ] As **GM**: `SVA.sequence().effect().file("jb2a.shield.01.complete.01.blue").attachTo(token.id).scaleToObject(1.5).persist(true).name("qa-shield").play()` (use the same builder style as in `docs/api.md`) | Intro plays, then loops forever on both clients.                                                       |
| 5.2 | [ ] `SVA.effects.list({ sceneId: canvas.scene.id, name: "qa-shield" })`                                                                                                                                        | One stored descriptor. `canvas.scene.flags["sargas-visual-automation"].effects` contains it.           |
| 5.3 | [ ] **Reload** both clients (F5).                                                                                                                                                                              | The shield is back on Fighter on both clients after `canvasReady`.                                     |
| 5.4 | [ ] Switch to QA Other and back.                                                                                                                                                                               | The shield is only on QA Grid, and is restored on return.                                              |
| 5.5 | [ ] `SVA.effects.end({ name: "qa-shield", sceneId: canvas.scene.id })`                                                                                                                                         | Outro plays (or fade out) and it disappears on **both** clients; the flag entry is gone.               |
| 5.6 | [ ] As **Player** (Client 2): start a persistent effect on Fighter.                                                                                                                                            | It plays on both clients and is stored in the scene flags (written by the GM on the player's request). |
| 5.7 | [ ] Repeat 5.6 with the GM client closed.                                                                                                                                                                      | It plays locally, a warning explains that no GM is connected to save it. No uncaught error.            |
| 5.8 | [ ] Start a persistent aura on Target A, then **delete Target A**.                                                                                                                                             | The aura ends on both clients and its flag entry is removed.                                           |
| 5.9 | [ ] `SVA.effects.endAll({ sceneId: canvas.scene.id })`                                                                                                                                                         | Every persistent effect of the scene ends on both clients.                                             |

## 6. Sockets, permissions and client preferences

| #   | Check                                                                                                                              | Expected result                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 6.1 | [ ] Player runs the **Arrows - Bolts** macro (Fighter selected, Target B targeted).                                                | The arrow plays on **Player and GM** at the same time.                                                        |
| 6.2 | [ ] GM runs the same macro.                                                                                                        | Plays on both.                                                                                                |
| 6.3 | [ ] GM on QA Other, Player on QA Grid; Player runs the macro.                                                                      | Player sees it; GM does not (other scene). No errors on the GM client.                                        |
| 6.4 | [ ] Console on GM: `SVA.sequence().effect().file("jb2a.explosion.01.orange").atLocation(token).forUsers([game.user.id])` then play | Only the GM sees it.                                                                                          |
| 6.5 | [ ] Set "minimum role to trigger" to **Trusted Player**, Player runs the macro.                                                    | Nothing is broadcast; the player gets a permission warning. GM sees nothing. Reset the setting to **Player**. |
| 6.6 | [ ] On the Player client, turn on the client setting **disable effects**. GM plays an effect.                                      | **Player sees nothing**; GM sees it. Automation still broadcasts for others.                                  |
| 6.7 | [ ] On the Player client, turn on **reduced motion** instead.                                                                      | Non-essential effects (auras, ambient loops, screen effects) are skipped; attack/impact effects still play.   |
| 6.8 | [ ] Set the Player's effect **volume** to 0, play a macro with a sound.                                                            | Player hears nothing; GM hears the sound.                                                                     |
| 6.9 | [ ] Console on Player: `SVA.engine.preload(["jb2a.fireball.explosion.orange"])`                                                    | Resolves; a later Fireball starts without a visible loading pause.                                            |

## 7. Automation core: resolution priority

Use the **Caster**'s **Electric Arc** (PF2e rule pack has a mapping for it).

| #   | Check                                                                                                                              | Expected result                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 7.1 | [ ] `SVA.automation.resolveRecipe(item)` (item = Electric Arc)                                                                     | `source: "system"`, a `ruleId` from `rules/pf2e.json`, and a `reason`.                                  |
| 7.2 | [ ] In the **Rules manager**, add a world rule matching key `electric-arc` with a different animation.                             | `resolveRecipe` now returns `source: "world"`; casting uses the world animation.                        |
| 7.3 | [ ] In the item's **Animation** tab, set a custom recipe.                                                                          | `source: "item"`; the item recipe wins over the world rule.                                             |
| 7.4 | [ ] Tick **disable automation** in the item tab.                                                                                   | `resolveRecipe` returns `null` (or explains it is disabled) and casting plays nothing.                  |
| 7.5 | [ ] Untick it, remove the item recipe and the world rule. Create a homebrew weapon "QA Zapper" with the `electricity` damage type. | `source: "fallback"`; a generic electricity animation plays on a Strike.                                |
| 7.6 | [ ] `SVA.automation.explain(item)`                                                                                                 | Lists every candidate rule and why the winner won.                                                      |
| 7.7 | [ ] Turn off the world setting **automation enabled**.                                                                             | No automatic animations; macros still work. Turn it back on.                                            |
| 7.8 | [ ] Two clients: Player rolls a Strike.                                                                                            | The animation plays **once** on each client (only the rolling client runs automation, then broadcasts). |

## 8. PF2e adapter

Roll everything from the **Player** client unless noted, with the named tokens selected/targeted. Force the degree of success when needed (for example with a roll modifier or by editing the target's AC).

### 8.1 Strikes

| #      | Check                                                    | Expected result                                                                                             |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 8.1.1  | [ ] Fighter **longsword** Strike vs Target A, **hit**.   | Sword swing from Fighter onto Target A.                                                                     |
| 8.1.2  | [ ] Same, **miss**.                                      | Swing that visibly misses (lands beside / no impact).                                                       |
| 8.1.3  | [ ] Same, **critical hit**.                              | Critical variant (bigger / extra impact).                                                                   |
| 8.1.4  | [ ] **Shortbow** vs Target B (6 squares), hit then miss. | Arrow from Fighter to Target B; the miss lands beside it.                                                   |
| 8.1.5  | [ ] **Dagger thrown** vs Target B.                       | Thrown dagger travels to the target **and returns** to Fighter.                                             |
| 8.1.6  | [ ] **Dagger melee** vs Target A.                        | Melee dagger animation, no projectile.                                                                      |
| 8.1.7  | [ ] **Fist** (unarmed) vs Target A.                      | Unarmed strike animation.                                                                                   |
| 8.1.8  | [ ] GM: **Beast** Jaws and Claw vs Fighter.              | Bite and claw animations.                                                                                   |
| 8.1.9  | [ ] Strike with the 2nd and 3rd MAP variants.            | Same animation as the first attack (MAP-independent).                                                       |
| 8.1.10 | [ ] Roll **damage** after a hit.                         | Only what the recipe's `triggers` allow (no duplicate swing unless configured). Exactly one event per roll. |

### 8.2 Spells

| #      | Check                                                                                | Expected result                                                         |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 8.2.1  | [ ] **Electric Arc** (basic Reflex save cantrip) on Targets A and B, roll the saves. | Cast on Caster, arc to each target.                                     |
| 8.2.2  | [ ] **Ray of Frost** (spell attack) vs Target B: hit, miss, crit.                    | Ray from Caster to target; miss lands beside; crit variant.             |
| 8.2.3  | [ ] **Ignition** (spell attack) melee and ranged.                                    | Appropriate fire animation.                                             |
| 8.2.4  | [ ] **Force Barrage** with 3 missiles split over Targets A, B, C.                    | **3 projectiles**, one per target, slightly staggered.                  |
| 8.2.5  | [ ] Save spell: **Fear** or **Heal** used offensively vs undead; roll the saves.     | Effect on each target, per-target outcome respected.                    |
| 8.2.6  | [ ] **Burst**: Fireball, place the template.                                         | Projectile to the burst center, explosion sized to the 20 ft burst.     |
| 8.2.7  | [ ] **Cone**: Breathe Fire, place the template in 4 directions.                      | Cone animation (PF2e cone variant) aligned with the template each time. |
| 8.2.8  | [ ] **Line**: Lightning Bolt.                                                        | Line animation from the caster along the template, full length.         |
| 8.2.9  | [ ] **Emanation**: an emanation spell/aura around the caster.                        | Centered on the caster, sized to the emanation.                         |
| 8.2.10 | [ ] Delete the placed template (area) right after placing.                           | The one-shot animation finishes; no error.                              |

### 8.3 Effects, auras, healing, multi-target

| #      | Check                                                                               | Expected result                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 8.3.1  | [ ] Cast **Bless** (effect applied to Caster).                                      | Persistent aura on Caster, sized to the emanation, on both clients.                                                                 |
| 8.3.2  | [ ] Reload both clients.                                                            | The Bless aura is restored.                                                                                                         |
| 8.3.3  | [ ] Remove the Bless effect from the actor.                                         | The aura ends on both clients; its name was `aura:<actorId>:bless`.                                                                 |
| 8.3.4  | [ ] Cast the **Shield** cantrip, then let the effect expire / remove it.            | Shield starts and stops with the effect.                                                                                            |
| 8.3.5  | [ ] Apply a condition (e.g. Frightened) with condition markers enabled/disabled.    | Marker only when the setting is on.                                                                                                 |
| 8.3.6  | [ ] **Heal** (1 action) on Fighter; **Heal** 3-action burst on several allies.      | Healing animation on each healed token.                                                                                             |
| 8.3.7  | [ ] **Battle Medicine** and **Healing Potion**.                                     | Healing animation on the healed token.                                                                                              |
| 8.3.8  | [ ] Strike or spell with **3 targets** selected.                                    | One sequence per target with a small stagger.                                                                                       |
| 8.3.9  | [ ] Area spell with 3 tokens inside the area.                                       | Area animation once, plus an impact on each token inside.                                                                           |
| 8.3.10 | [ ] GM: cast **Translocate** from Caster, click a free square.                      | "Click the destination" notice; vanish on Caster, the token jumps (no slide) to the clicked square, appear there - on both clients. |
| 8.3.11 | [ ] Player client: cast **Translocate** with the player's own token (GM connected). | Same as 8.3.10; the GM applies the move.                                                                                            |
| 8.3.12 | [ ] Player: cast it again, right-click (or Escape) instead of clicking.             | "Teleport cancelled"; nothing plays, the token stays.                                                                               |
| 8.3.13 | [ ] Player: cast it with no GM connected.                                           | Vanish plays, warning "No GM is connected", the token stays.                                                                        |

## 9. UI

| #    | Check                                                                                           | Expected result                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 9.1  | [ ] Open the **Animation browser** (`SVA.ui.openBrowser()` or its toolbar/settings button).     | Tree + search + thumbnail grid.                                                                 |
| 9.2  | [ ] Search "fire bolt", hover a thumbnail.                                                      | Hover plays a video preview.                                                                    |
| 9.3  | [ ] Find `jb2a.shield.01.complete.01.blue` in < 3 clicks, **Copy path**.                        | Clipboard contains the dot path.                                                                |
| 9.4  | [ ] **Play on selected token**.                                                                 | Plays on the selected token.                                                                    |
| 9.5  | [ ] Add and remove a favourite, reopen the window.                                              | Favourites persist.                                                                             |
| 9.6  | [ ] Open a PF2e item sheet (longsword): header control **Animation**.                           | Opens the item config.                                                                          |
| 9.7  | [ ] Pick a preset, a JB2A path (via the browser picker), a colour, per-outcome overrides; save. | Next Strike uses the new animation **without reload**.                                          |
| 9.8  | [ ] **Preview** button with a token selected and one targeted.                                  | Plays locally only.                                                                             |
| 9.9  | [ ] **Rules manager**: add, edit, disable, delete a world rule.                                 | Changes apply immediately.                                                                      |
| 9.10 | [ ] Rules manager "which rule matches" for an item.                                             | Same answer as `SVA.automation.explain(item)`.                                                  |
| 9.11 | [ ] **Export** rules, delete them all, **Import** the file.                                     | Rules are identical after the round-trip.                                                       |
| 9.12 | [ ] **Settings** submenu.                                                                       | Performance, permissions, client preferences and system-pack toggles; every setting has a hint. |
| 9.13 | [ ] Check the UI with the Player client.                                                        | Player cannot edit world rules or world settings.                                               |

## 10. Example macros compendium

Open the compendium **SVA Example Macros** and import all macros. For each macro, read the header comment for what to select/target.

| #     | Macro                                                    | Expected result                                                                                    |
| ----- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 10.1  | [ ] Spike Trap (10 ft)                                   | Select the tile: first run springs the trap and leaves the deployed spikes; second run re-arms it. |
| 10.2  | [ ] Melee Attack (Advanced)                              | Swing (with trail and impact) on each target; switches to a thrown weapon beyond reach.            |
| 10.3  | [ ] Launched Missile                                     | Smoke puff at the launcher, missile, explosion and ground crack on each target.                    |
| 10.4  | [ ] Flask Throw                                          | Flask, glass shatter and icy burst on each target.                                                 |
| 10.5  | [ ] Bless Toggle                                         | Intro then looping bless on each target; run again to end it.                                      |
| 10.6  | [ ] Whirl Toggle                                         | Intro, loop, and outro when toggled off.                                                           |
| 10.7  | [ ] Vortex Toggle                                        | Same as Whirl with the vortex.                                                                     |
| 10.8  | [ ] Magic Circle Toggle                                  | Persistent magic circle under the token; toggles off.                                              |
| 10.9  | [ ] Shield Toggle                                        | Persistent shield attached to the token; toggles off.                                              |
| 10.10 | [ ] Energy Field Toggle                                  | Two layers (below + above token); both end together.                                               |
| 10.11 | [ ] Molten Earth Shield Toggle                           | Two layers; both end together.                                                                     |
| 10.12 | [ ] Bomb Throw                                           | Bomb, shrapnel, explosion, ground crack.                                                           |
| 10.13 | [ ] Arrows and Bolts                                     | Arrow (or bolt) to each target, correct distance variant.                                          |
| 10.14 | [ ] Dodecahedron Toggle                                  | Two layers; toggles off.                                                                           |
| 10.15 | [ ] Energy Strands Toggle                                | Two layers; toggles off.                                                                           |
| 10.16 | [ ] Weapon Throw and Return                              | Dagger thrown to each target and returns to the thrower.                                           |
| 10.17 | [ ] Run all of the above **with Sequencer uninstalled**. | Everything works. No `Sequencer is not defined` errors.                                            |

## Results table template

Copy this into the release PR and fill it in. Use `PASS`, `FAIL (#issue)` or `N/A (reason)`.

```markdown
### QA results - SVA vX.Y.Z

| Field         | Value                                 |
| ------------- | ------------------------------------- |
| Date          | YYYY-MM-DD                            |
| Tester        |                                       |
| Foundry build | 14.xxx                                |
| PF2e version  |                                       |
| JB2A          | jb2a_patreon x.y.z / JB2A_DnD5e x.y.z |
| Browser / OS  |                                       |
| SVA build     | dev link / dist / release zip         |

| Section                          | GM client | Player client | Notes |
| -------------------------------- | --------- | ------------- | ----- |
| 0. Setup & sanity                |           |               |       |
| 1. JB2A database (Patreon)       |           |               |       |
| 1. JB2A database (free)          |           |               |       |
| 2. Engine (stretch 1/6/18 sq.)   |           |               |       |
| 3. Layers                        |           |               |       |
| 4. Attach                        |           |               |       |
| 5. Persistence                   |           |               |       |
| 6. Sockets / permissions / prefs |           |               |       |
| 7. Automation priority           |           |               |       |
| 8.1 PF2e strikes                 |           |               |       |
| 8.2 PF2e spells & areas          |           |               |       |
| 8.3 PF2e effects, healing, multi |           |               |       |
| 9. UI                            |           |               |       |
| 10. Example macros               |           |               |       |

**Failures:** list issue numbers.
**Blockers for release:** yes / no.
```
