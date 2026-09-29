# Changelog

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
