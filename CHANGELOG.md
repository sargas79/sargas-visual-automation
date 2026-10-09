# Changelog

## 0.6.2 - 2026-10-09

### Fixed

- Sequences wait for each effect's file to load again before the next step, without waiting for its delay. Later `wait` and `sound` steps are timed from when the effect can show, and effects appear in order even when an earlier file is slow to load. Delays still stagger instead of adding up.
- A file that failed to load because of a network hiccup or a server error is retried on the next play. Only missing or broken files are remembered, for a minute.
- On a scene change, cached animations not used for 10 minutes are unloaded, and failed files are retried on the new scene. Recently used files stay cached, so returning to a scene is still fast.
- Ending and replaying a persistent effect with the same id within 10 seconds stores it again. Only a store from another user is still ignored after an end. An end on another scene no longer blocks it.
- An effect played and ended before the GM had stored it no longer comes back on reload.

## 0.6.1 - 2026-10-09

### Fixed

- Removing an effect that someone else put on your character, or one stored before 0.6.0, ends its aura for good: a player may remove the stored auras of actors they own. In 0.6.0 the aura ended but came back on reload.
- `SVA.effects.endAll` warns and does nothing for players. In 0.6.0 it ended every effect live while the GM kept them stored, so they came back on reload.
- Users below the minimum trigger role can end their stored auras: their removals were dropped by the other clients.
- Ended effect ids are no longer kept for the whole session on player clients.

## 0.6.0 - 2026-10-09

### Changed

- **Buttons no longer clip their text.** One consistent button style across every window: icon buttons are centred squares, text buttons size to their label, and toolbars and footers wrap instead of cutting labels off in narrow windows. The sound browse button matches the other browse buttons.
- **Item editor:** the disable switch is now a button that applies at once, like the one in the animation overview, and keeps unsaved edits.
- **Rules manager:** search and sort the rule list, a warning before unsaved edits are discarded, and a rule needs at least one match criterion to save.
- **JSON option fields** are checked as you type and highlighted when invalid.
- **Animation browser:** the clear-search button no longer jumps in and out, the play hint moved to an info icon, and in narrow windows the folder tree folds behind a button. The rules manager stacks its columns in narrow windows.
- Icon-only buttons have accessible labels; form labels are linked to their fields.
- Textures stay cached across scene changes, so coming back to a scene no longer downloads its animations again. Failed loads are retried after a minute instead of on every play.

### Fixed

- Effects of a sequence no longer wait for the previous effect to load and finish its delay: multi-target projectiles fire in order with their stagger, and impacts no longer pile up their delays. A negative `waitUntilFinished` no longer counts the effect's delay twice.
- Unloading a cached animation no longer breaks a tile, token or scene image that uses the same file.
- Players below the minimum trigger role no longer get a warning on every attack or cast.
- D&D 5e: effects enabled after they were created now animate, and end when disabled again.
- An effect ended while it was still being stored no longer comes back on reload.
- Effects whose animation path leaves a choice open (for example an aura without a fixed colour) were resolved separately on every client, so each player could see a different colour or variant of the same effect. The pick is now seeded by the effect's id, so every client (including ones that reload or join later and see persisted effects) shows the same variant.

### Security

- Socket messages whose sender the server did not confirm never get GM rights: no teleporting other players' tokens and no clearing scenes by impersonating a GM.
- Persistent effects remember who created them; only that user or a GM can replace or remove them, and only a GM can clear a scene's effects. Writes to unknown scenes are dropped.
- Preload messages are role-checked and limited to 50 files.

## 0.5.0 - 2026-10-05

### Added

- **Sounds from SoundFx Library.** The default rules of the PF2e, D&D 5e and GURPS packs now carry a `sound` from the [SoundFx Library](https://github.com/sargas79/sargas-SoundFxLibrary) module (listed as recommended; it only needs to be installed, not enabled): slash, pierce and blunt melee hits with a heavier critical and a whoosh on a miss, bites and claws, arrows and bolts, thrown weapons, fire and lightning spells and a generic cast for untyped magic. Damage types and actions the library has no fitting recording for (healing, buffs, firearms, cold, acid…) stay silent.
- Sounds that point into a module that is not installed are skipped instead of requesting a missing file, so the packs stay silent without the library.

## 0.4.2 - 2026-10-04

### Removed

- **Automatic sounds.** The default sound bank added in 0.4.0 (attacks, criticals, misses, magic, healing and buffs) is gone, along with the **Automatic sounds** and **Sound folder** world settings, the `sounds/` folder and `SVA.automation.soundName`. Automatic animations are silent again unless their recipe or rule has a `sound` of its own, which works as before.

## 0.4.1 - 2026-10-04

### Fixed

- Animations placed on a point or a token (bursts, explosions, auras, area effects) were drawn half their own size down and to the right of where they belonged the first time a display object was used: a Fireball landed four squares off its area. Effects are now always centered on their point.
- Effects attached to or placed on a token now use the token's document center at rest, and follow the mesh with the offset measured at rest while it moves. The previous correction assumed Foundry's texture-anchor formula; on tokens with offset or scaled art it could still draw effects beside the token.

## 0.4.0 - 2026-10-04

### Added

- **Creature attacks set up by type.** Natural attacks of creatures (jaws, claws, stings, tails, wings, slams… by name) are reported with the weapon group `natural` instead of `brawling`, so they no longer play as unarmed strikes, and get an animation on their own: bites and claws are sized to the creature (200px up to Medium, 400px from Large) and coloured by the attack's energy damage (fire, cold, acid, electricity…) or, failing that, by the creature type (undead, fiend, fey, dragon…). The three fixed-colour natural attack rules of the PF2e pack are gone (184 rules).
- **Sounds for attacks, criticals and magic.** Automatic animations without a sound of their own now play one: attacks by weapon type (slash, pierce, blunt, unarmed, bite, claw, bow, crossbow, firearm, thrown), a heavier variant on a critical, a whoosh on a miss, magic by damage type (fire, cold, electricity, acid…), healing and buffs. A synthesized 36-file bank ships in `sounds/`; world settings **Automatic sounds** and **Sound folder** (use your own files with the same names). Recipes with their own `sound` are untouched; `"sound": null` keeps one silent.
- **Creature traits in rules.** `match.actorTraits` (rules manager: "Creature traits") matches the traits of the creature using the item, such as `dragon`, `undead` or `size:large`. Adapters fill `ItemDescriptors.actorTraits` (PF2e: actor traits and size).

- **Turn animations off for a character.** A button in the animation overview header (owner or GM) silences the character: nothing it does animates and nothing lands on its tokens, while other characters keep animating. Also `SVA.automation.setActorDisabled(actor, true)` / `isActorDisabled(actor)`.

## 0.3.2 - 2026-10-04

### Fixed

- PF2e: an effect applied to another creature (Haste, Heroism or Courageous Anthem on an ally) animated its aura around the caster instead of the affected creature, and one aura was shared by every creature the caster buffed. The affected actor is now the source of effect events, as in the other adapters, so each creature gets its own aura and it ends when its own effect is removed.
- An aura started by a `cast` trigger (the default Bless rule) never ended: nothing removes it, since effect removals carry another name. Auras are now persistent only on `effectApplied` / `areaPlaced`; on a cast the loop plays once (or for `options.duration`).
- An aura that was never saved on the scene (no GM online, or the save still in flight) could not be ended by the effect's removal. The removal now also ends matching live effects.
- Effects attached to a token whose art is offset (token texture anchor other than the center) were drawn at the anchor point instead of the token's center.
- PF2e: emanation areas placed as Regions on Foundry v14 could animate in the wrong place. The emanation's center is now computed for any base shape (token, circle, rectangle, polygon) whether its size is stored in grid squares or pixels, and falls back to the caster's token when the base has no usable coordinates.

## 0.3.1 - 2026-09-29

### Fixed

- The animation overview and the animation browser no longer crash on open in Foundry v14 ("Cannot set property state of #<ApplicationV2> which has only a getter").

## 0.3.0 - 2026-09-29

> PF2e has been tested live on Foundry v14. The animation overview and the D&D 5e and GURPS adapters are new and not yet tested in Foundry; checklist in `docs/testing.md` (9.14-9.26, sections 11 and 12).

### Added

- **Animation overview** (#74): see and change the animation of every spell, strike, action and effect of a character.
  - Shows the JB2A thumbnail and path, the preset, where the animation comes from and what triggers it.
  - Per item: Preview, Change (pick in the animation browser), Edit, Reset, Disable/Enable.
  - Opens from the token HUD, the actor sheet header, the token controls, or `SVA.ui.openActorOverview(actor)`.
- **D&D 5e adapter** (#46) for dnd5e 6.x on Foundry 14.
  - Events: casts (usage cards), attacks (hit/miss/crit per target against AC), damage and healing, saves, spell areas (Regions) and active effects, including concentration.
  - Default rule pack of 212 rules (SRD spells, all base weapons, potions, class features, conditions).
- **GURPS adapter** (#47) for GURPS Game Aid 0.18.
  - Reads GGA's chat cards: melee/ranged/thrown attacks, spells, healing, and damage linked to the previous attack.
  - Default rule pack of 128 rules (weapon families, unarmed and natural attacks, firearms, common GURPS Magic spells).

## 0.2.1 - 2026-09-29

### Fixed

- Installing the module no longer opens Foundry's "Install Package Dependencies" dialog asking for the free `JB2A_DnD5e`. The manifest no longer lists JB2A as a recommended dependency; SVA detects the Patreon or free JB2A module at runtime and warns the GM if neither is active.
- A flaky timing limit in the animation browser tests no longer fails CI.

## 0.2.0 - 2026-09-29

> Still not tested in a live Foundry world: 560 unit and integration tests pass, but the `docs/testing.md` checklist has not been run.

### Added

- **Teleport moves the token** (#65). Vanish, then the move (no slide), then appear. The destination is the placed area, `options.destination`, or a click on the canvas (right-click or Escape cancels). Players' moves are applied by the GM, only for tokens they own. New PF2e rules: Translocate, Dimension Door, Abundant Step, Dimensional Assault, Dimensional Disappearance.
- **Essential effects** (#66): `EffectDescriptor.essential` and a `.essential()` builder setter. Reduced motion keeps the effects that show the result and skips decorative ones.
- **Rule matching by base item** (#63): `match.baseItem`. The PF2e weapon rules use it, so named magic weapons get their base weapon's animation.
- **Thumbnail index** (#67): coverage in the animation browser goes from 64% to 83.5%. Other cards show a captured video frame or a placeholder.
- **Item editor sync** (#68): the editor reloads when the item changes elsewhere, or keeps your edits with a notice. The sound field has a file picker.
- **Adapter `static init(api)`** (#64) so adapters register settings during Foundry `init`.

### Fixed

- Duplicate events: events now carry ids, so a repeated or late message never animates the same action twice (#62).
- Healing spells (Heal, Soothe, Breath of Life, Lay on Hands) and Spiritual Armament no longer animate twice. PF2e sends a cast card and a roll for one action, and both used to trigger the animation.

## 0.1.0 - 2026-09-29

First release. Sargas Visual Automation plays and automates JB2A animations on Foundry VTT **v14** without Sequencer or Automated Animations.

> **Not yet tested in a live Foundry world.** Everything below is covered by unit and integration tests (485 tests), but the in-Foundry checklist in `docs/testing.md` has not been run. Please report problems in [issues](https://github.com/sargas79/sargas-visual-automation/issues).

### Added

- **JB2A database** (`SVA.db`): reads the installed JB2A module (Patreon or free) directly. It supports dot paths, search, distance variants, loop markers and ranged padding.
- **Rendering engine** (`SVA.engine`): PIXI playback of JB2A WebM files. It covers stretch-to-target, missed shots, return trips, layers (below tiles, below tokens, above tokens, above lighting, screen), token attachment, loops, a texture cache and an effect budget.
- **Sequences** (`SVA.sequence()`): a chainable macro API. Sequences are synced to every client over one socket channel.
- **Persistent effects** (`SVA.effects`): stored in scene flags (GM-authoritative), restored on reload, and cleaned up when their token is deleted.
- **Permissions and preferences**: minimum role to trigger, plus per-client disable, reduced motion and volume.
- **Automation core**: system-agnostic recipes (melee, ranged, onToken, area, aura, teleport) with per-outcome variants. Recipes come from, in order: per-item flags, world rules, the system rule pack, then a generic fallback.
- **PF2e adapter**: strikes (melee, ranged, thrown, unarmed, natural), spells (casts, attacks, saves, Region-based areas), effects and conditions, healing and multi-target actions. The default rule pack has 184 rules.
- **UI**: an animation browser, a per-item animation editor with live preview, a rules manager (import/export) and a grouped settings panel.
- **SVA Macros** compendium: 16 original example macros.
- **Docs**: user guide, API reference, adapter guide (for D&D 5e, GURPS, …) and QA checklist.

### Known limitations

- Duplicate events are detected with a 1 s window (#62).
- The teleport preset doesn't move the token (#65).
- About a quarter of animations have no thumbnail in the browser (#67).
