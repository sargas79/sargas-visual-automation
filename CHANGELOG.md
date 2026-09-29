# Changelog

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
