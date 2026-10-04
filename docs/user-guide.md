# User guide

Sargas Visual Automation (SVA) plays [JB2A](https://jb2a.com) animations in Foundry VTT and triggers them automatically from your game system. It replaces **Sequencer** and **Automated Animations**: you only need SVA and a JB2A module.

- [Requirements](#requirements)
- [Installation](#installation)
- [First steps](#first-steps)
- [Automation](#automation)
- [Configuring an item](#configuring-an-item)
- [Rules manager](#rules-manager)
- [Animation browser](#animation-browser)
- [Example macros](#example-macros)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

## Requirements

|             |                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry VTT | **v14**                                                                                                                                                                                |
| Game system | **Pathfinder 2e**, **D&D 5e** (dnd5e 6.x) or **GURPS 4e Game Aid** (`gurps`, v0.18+) for automation. Macros and the animation browser work in any system.                              |
| JB2A        | **Required.** Either [JB2A Patreon](https://www.patreon.com/JB2A) (`jb2a_patreon`, the full collection) or the free [JB2A](https://foundryvtt.com/packages/JB2A_DnD5e) (`JB2A_DnD5e`). |

SVA ships **no animation files**. It reads the database of the JB2A module you have installed and plays its files. With the free module some animations (and some colours) are missing; SVA falls back to what exists and tells you in the console when a path is unavailable. If both JB2A modules are active, the Patreon one is used.

You do **not** need Sequencer, Automated Animations, Tagger or libWrapper. If Automated Animations is also active, both modules will animate the same rolls: disable automation in one of them.

## Installation

1. In Foundry's setup screen: **Add-on Modules → Install Module**, paste the manifest URL and install:
   ```
   https://github.com/sargas79/sargas-visual-automation/releases/latest/download/module.json
   ```
2. Install a JB2A module (Patreon or free) the same way.
3. In your world: **Game Settings → Manage Modules**, enable **Sargas Visual Automation** and your JB2A module, and save.
4. Reload. The console shows a `Ready` line from Sargas Visual Automation. If JB2A is missing you get a warning notification.

JB2A's own setting for a custom asset location (S3, a CDN or a renamed folder) is respected automatically.

## First steps

1. Place two tokens on a scene. Select one and target the other (`T` key).
2. **PF2e**: make a Strike with the selected token. **D&D 5e**: use a weapon's attack. The weapon animation plays from your token to the target, on every player's screen.
   **GURPS**: click a melee or ranged attack's skill level on the character sheet (or roll an OtF such as `[M:Broadsword]`).
3. Open the **Animation browser** (see [below](#animation-browser)), search for "fire bolt", and click **Play on selected token**.
4. Import the **SVA Example Macros** compendium and run **Arrows and Bolts**.

## Automation

When something happens in your game system (an attack, a spell cast, a saving throw, a template placed, an effect applied or removed, healing), the system adapter tells SVA, and SVA finds a **recipe** for the item and plays it.

### How an item's animation is chosen

SVA looks for a recipe in this order and uses the first one it finds:

1. **Item**: a recipe configured on the item itself ([item configuration](#configuring-an-item)).
2. **World rules**: rules you create in the [rules manager](#rules-manager).
3. **System rule pack**: the defaults shipped with SVA for your game system (`rules/pf2e.json`: common spells, cantrips and every weapon group; `rules/dnd5e.json`: SRD spells, every base weapon, healing potions, spell effects and conditions; `rules/gurps.json`: weapon families, unarmed and natural attacks, firearms and common GURPS Magic spells).
4. **Generic fallback**: based on what the item is (melee, ranged or thrown attack, damage type, healing).

If the item's **Disable automation** box is ticked, nothing plays for it, whatever the rules say.

To see why an item plays what it plays, use **Which rule matches?** in the rules manager, or in the console:

```js
SVA.automation.explain(item);
```

### Recipes and presets

A recipe picks a **preset** and a JB2A animation:

| Preset     | Used for                                                          | Plays                                                                                      |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `melee`    | Melee strikes, unarmed and natural attacks                        | A swing from the attacker onto each target                                                 |
| `ranged`   | Bows, crossbows, thrown weapons, spell attacks, rays, projectiles | A projectile from the source to each target, scaled to the distance                        |
| `onToken`  | Save spells, buffs, healing                                       | An effect on each target (or on the caster)                                                |
| `area`     | Bursts, cones, lines and emanations                               | An animation fitted to the placed template / area                                          |
| `aura`     | Effects and conditions that last                                  | A looping effect on the affected token, kept until the effect is removed (once, on a cast) |
| `teleport` | Misty Step, Translocate and similar                               | A vanish, the token moves to the destination (click it on the canvas), then an appear      |

Recipes can add **stages** (`cast` on the caster, `projectile`, `impact`, `onSource`, `onTarget`) and **per-outcome overrides**: a different animation on a critical hit, a miss that lands beside the target, no impact on a failure, and so on.

### GURPS

GURPS Game Aid has no item "activities": attacks, spells and skills are rows of the character sheet, and every roll is a chat card. SVA reads those cards:

| You roll                                         | Event   | Plays (default rules)                                                                  |
| ------------------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| A melee or ranged attack (`M:`, `R:`, `A:` OtF)  | attack  | The weapon animation to your targets; a miss or critical miss lands beside the target. |
| A spell (`Sp:`, or `S:` naming a spell you know) | cast    | The spell's animation (missile spells: a charge-up on the caster).                     |
| A healing spell or First Aid / Esoteric Medicine | healing | A healing animation on your targets, or on yourself when nobody is targeted.           |
| Damage (the damage link of an attack, or `D:`)   | damage  | Nothing by default. Rules can react with `"triggers": ["damage"]`.                     |

- The outcome is the roll's result: critical success, success, failure or critical failure. Blind rolls play without revealing it.
- **Missile spells** (Fireball, Lightning, Ice Dart, Stone Missile…) animate twice on purpose: once when you cast (charge-up on the caster) and once when you throw the missile with its ranged attack row.
- Parry, block and dodge rolls don't animate.
- Rules match attacks and spells by **name** (`regex`), because GURPS has no slugs. The weapon group comes from the name (a "Thrusting Broadsword" is a sword), and damage types from GURPS codes (`cut`, `imp`, `cr`, `pi+`, `burn`, `cor`, `tox`, `fat`), which are also available as **traits** (`"traits": "burn"`). Spells have their college and class as traits (`fire`, `missile`…).

### Who triggers what

- Only the client of the player who rolled runs the automation; the result is sent to every client, so each animation plays exactly once per screen.
- Clients on a different scene don't see the animation.
- Players below the world setting **minimum role to trigger** can't broadcast animations.

### D&D 5e notes

- Using an activity posts a usage card (**cast**), then its rolls: **attack** (hit or miss per target against its AC; a natural 20 is a critical, a natural 1 always misses), **damage**, **healing** and one **save** per creature that rolls from the card. Placing the activity's template (a Region on Foundry v14) is **areaPlaced**.
- Default rules listen to one of these per action: attack spells and weapons to the attack roll, healing to the healing roll, area spells to the placed template, other spells to the usage card. Don't make a recipe listen to both `cast` and `attack` (or `healing`), or the action animates twice.
- Concentration drives auras: a rule with the `aura` preset on a concentration spell (Spirit Guardians) starts when you begin concentrating and ends when concentration ends. Effects applied from a card (for example "Blessed") and conditions (`prone`, `frightened`…) are matched by their name / status id with type `effect` / `condition`.
- **Teleport** spells (Misty Step) move your token themselves: click the destination when asked, and don't also use dnd5e's own **Teleport** button on the card.

## Configuring an item

Open an item sheet (for PF2e: weapon, spell, action, consumable, effect or condition; for D&D 5e: weapon, spell, feature or consumable; for GURPS: equipment, spell, skill or attack items) and click the **Animation** control in the sheet header. In GURPS, attacks and spells that exist only on the character sheet (no item) are configured with a rule in the [rules manager](#rules-manager) instead.

1. **Preset**: pick one of the presets above.
2. **Animation**: type a JB2A path or click the picker to choose one in the animation browser. Pick a **colour** variant if the animation has several.
3. **Options**: scale, layer, delay, and the preset's own options.
4. **Outcomes**: optional overrides for critical success, success, failure and critical failure.
5. **Stages**: optional cast, projectile, impact, on-source and on-target animations. Under **Sound**, the file button opens Foundry's file browser to pick an audio file.
6. **Preview**: select a token and target others, then click Preview. Only you see the preview.
7. **Save**. The next use of the item plays the new animation, no reload needed.

If the item is changed elsewhere while the window is open (another user, a macro), the editor reloads it. When you have unsaved edits it keeps them and asks instead: **Reload** discards your edits, **Keep my edits** lets you save over the other change.

Tick **Disable automation** to silence an item. Click **Reset** to remove the item's own recipe and go back to the rules.

The recipe is stored in the item's flags, so it travels with the item when you copy it to another actor or export it to a compendium.

## Animation overview

See at a glance which animation every spell, strike, action, consumable and effect of a character plays, and change it.

Open it for an actor (you must own it, or be the GM) in any of these ways:

- **Token HUD**: right-click the token, then click the **Animation overview** button (wand icon) in the right column.
- **Actor sheet**: the **Animations** control in the sheet header.
- **Token controls** (left toolbar): select a token, then click **Animation overview of the selected token**.
- Macro: `SVA.ui.openActorOverview(actor)`, for example `SVA.ui.openActorOverview(canvas.tokens.controlled[0].actor)`.

Items are grouped (spells, strikes and weapons, actions, feats, consumables, effects, conditions). Each row shows the JB2A thumbnail and path of the animation that plays, its preset, **where it comes from** (item recipe, world rule, system rule pack, generic fallback, or no recipe; hover the badge for the reason), and the **trigger** that fires it (attack, cast, area placed…). A warning icon next to the path means that path isn't in your JB2A database (for example a Patreon-only animation with the free JB2A).

Use the search box (name, path, preset, source or trigger) and the **Show** filter (with animation, without animation, own item recipe, disabled). **Include other items** also lists equipment and other items that usually never animate.

Row buttons:

- **Preview**: plays the animation locally (only you see it) from this actor's selected token, or one of its tokens on the scene, to your current targets.
- **Change**: opens the animation browser; the animation you pick is saved as the item's own recipe. The preset, options and stages that applied before are kept, only the animation changes. If nothing applied, SVA creates a recipe that fits the item (ranged for ranged attacks, area for area spells, on-token otherwise).
- **Edit**: opens the full item configuration (see above).
- **Reset**: removes the item's own recipe; rules apply again.
- **Disable / Enable** automation for that item.

The list updates by itself when items or world rules change. The token HUD button can be turned off per client in the settings (**Animation overview button on the token HUD**).

## Rules manager

**Game Settings → Configure Settings → Sargas Visual Automation → Rules manager** (GM only).

A world rule matches items and gives them a recipe. Use rules to change the default animation of many items at once (all fire spells, all bows, one spell by its slug).

| Field    | Meaning                                                                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label    | Your name for the rule.                                                                                                                                                                                                                                                                                                                  |
| Enabled  | Disabled rules are ignored.                                                                                                                                                                                                                                                                                                              |
| Priority | Higher wins when several world rules match.                                                                                                                                                                                                                                                                                              |
| Match    | Any combination of: **key** (PF2e slug, D&D 5e identifier or GURPS name slug, e.g. `electric-arc`, `fire-bolt`, `fireball`), exact **name**, **regex** on the name, item **type**, **traits** (all must be present), **attack kind** (melee/ranged/thrown), **weapon group**, **base item** (e.g. `longsword`: every longsword variant). |
| Recipe   | Same editor as the item configuration.                                                                                                                                                                                                                                                                                                   |

- **Which rule matches?** Drop an item on the manager (or pick one) to see the winning recipe and every candidate.
- **Export** saves all world rules to a JSON file; **Import** loads such a file (share rule sets between worlds). Rules round-trip without changes.
- World rules always win over the system rule pack, and lose to an item's own recipe.

## Animation browser

Open it from the **Animation browser** button in the module settings (and in the item configuration's animation picker). With a macro: `SVA.ui.openBrowser()`.

- Browse the JB2A tree on the left or **search** by name.
- Thumbnails show every animation; **hover** one to preview the video. JB2A's own thumbnails are indexed the first time the browser is used after installing or updating JB2A (a few seconds, in the background, then cached in your browser). Animations without one get a preview frame captured from the video when they scroll into view; if that isn't possible (for example JB2A on S3 without CORS), a "No preview" placeholder is shown.
- **Copy path** copies the database path (`jb2a.fire_bolt.orange`) for macros and recipes.
- **Play on selected token** plays it on the selected token (and to the target, for projectiles).
- **Favourites** keep the animations you use most at the top.

## Example macros

The compendium **SVA Example Macros** contains 16 ready-to-use macros that show what the [macro API](api.md) can do: projectiles and thrown weapons, flasks and bombs, melee attacks, toggleable auras and shields, and a spike trap. Import them (right-click the compendium → Import All) and read each macro's header comment for what to select or target. They work without Sequencer. See [Example macros](macros.md) for the full list.

## Settings

Settings live in **Game Settings → Configure Settings → Sargas Visual Automation**. The exact labels are shown with a hint in the settings panel.

| Setting                 | Scope  | What it does                                                                                       |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Automation enabled      | World  | Master switch for automatic animations. Macros keep working when it is off.                        |
| System rule pack        | World  | Use the defaults shipped for your system (`rules/<system>.json`).                                  |
| Minimum role to trigger | World  | Users below this role can't broadcast animations (automation or macros).                           |
| Max concurrent effects  | Client | Upper limit of effects on screen at once, to protect slower machines.                              |
| Disable effects         | Client | You see no SVA animations at all. Other players are unaffected.                                    |
| Reduced motion          | Client | Skip decorative effects (cast, screen effects); hits, misses, areas, impacts and auras still play. |
| Volume                  | Client | Volume of SVA sounds on your machine.                                                              |
| Condition markers       | World  | Show JB2A markers for conditions (PF2e, and D&D 5e: "animate conditions").                         |
| GURPS: failed casts     | World  | Animate spell and healing rolls that fail (GURPS). Failed attacks always play as misses.           |
| Debug logging           | Client | Detailed logs in the browser console (F12), including why a recipe matched.                        |

## Troubleshooting

| Symptom                                    | What to check                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "JB2A is not installed" warning            | Enable `jb2a_patreon` or `JB2A_DnD5e` in **Manage Modules** and reload. In the console, `SVA.db.provider` should not be `null`.                                                                                                     |
| Nothing plays for anyone                   | **Automation enabled** is on; the item isn't disabled; `SVA.automation.explain(item)` returns a recipe; your role is at least **minimum role to trigger**; turn on **Debug logging** and look for errors.                           |
| It plays for me but not for another player | That player turned on **Disable effects** or **Reduced motion**; or they are on another scene; or the effect was restricted with `forUsers`; or the token is hidden from them.                                                      |
| An animation plays twice                   | Automated Animations (or another animation module) is also active. Disable automation in one of them.                                                                                                                               |
| "Path not found" in the console            | The path doesn't exist in your JB2A collection (common with the free module). Pick another one in the animation browser.                                                                                                            |
| Projectile is too short / too long         | The scene's grid distance and units are used to pick the distance variant. Check **Scene → Grid** (size, distance, units).                                                                                                          |
| Persistent aura disappeared after reload   | A player created it while no GM was connected, so it couldn't be saved. Recreate it with a GM online.                                                                                                                               |
| Aura stays after the effect was removed    | End it with `SVA.effects.end({ name: "aura:<actorId>:<key>", sceneId: canvas.scene.id })`, or `SVA.effects.endAll({ sceneId: canvas.scene.id })`, and report it with the item's name. `<actorId>` is the actor carrying the effect. |
| Stuttering with many effects               | Lower **Max concurrent effects**, or turn on **Reduced motion** on slow machines.                                                                                                                                                   |

When you report a bug, include your Foundry, system, JB2A and SVA versions, the output of `SVA.automation.explain(item)` for the item, and the console log with **Debug logging** on: <https://github.com/sargas79/sargas-visual-automation/issues>.

## Credits

- Animations: **JB2A - Jules & Ben's Animated Assets** (<https://jb2a.com>), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). SVA does not include or redistribute any JB2A files; it plays the files of the JB2A module you install. Please support JB2A on [Patreon](https://www.patreon.com/JB2A).
- The example macros are original SVA code written for the same use cases as JB2A's bundled Sequencer macros; they contain no JB2A code.
- SVA's code is MIT licensed.
