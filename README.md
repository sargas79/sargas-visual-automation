# Sargas Visual Automation

A [Foundry VTT](https://foundryvtt.com) module that plays and automates [JB2A](https://jb2a.com) animations **on its own**. It replaces both **Sequencer** and **Automated Animations**: install SVA and a JB2A module, and attacks, spells, areas and effects animate automatically, on every player's screen.

[![Latest release](https://img.shields.io/github/v/release/sargas79/sargas-visual-automation)](https://github.com/sargas79/sargas-visual-automation/releases/latest)
[![CI](https://github.com/sargas79/sargas-visual-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/sargas79/sargas-visual-automation/actions/workflows/ci.yml)

## Features

- **Automatic animations:** strikes, spell attacks, saves, damage, healing, spell areas, and effects or auras that stay while the effect lasts. Hits, misses and critical hits animate differently.
- **Animation overview:** for any character, see which JB2A animation every spell, strike, action and effect plays, and why. Preview it, or change it with a few clicks.
- **Animation browser:** search and preview all JB2A animations (thumbnails, hover preview), play one on a token, or pick one for an item.
- **Rules:** set animations per item, with world-wide rules (by name, trait, weapon group, base weapon…), or rely on the built-in defaults of each game system.
- **Macro API:** `SVA.sequence()` builds your own animations (projectiles, auras, traps). An **SVA Example Macros** compendium ships 16 ready-made ones.
- **Multiplayer:** animations are synced to every client. Persistent effects survive a reload. Per-player options to disable animations, reduce motion or set the volume.

## Requirements

|                 |                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundry VTT** | v14                                                                                                                                         |
| **Animations**  | [JB2A Patreon](https://www.patreon.com/JB2A) (`jb2a_patreon`) or the free [JB2A](https://foundryvtt.com/packages/JB2A_DnD5e) (`JB2A_DnD5e`) |
| **Not needed**  | Sequencer, Automated Animations, Tagger, libWrapper                                                                                         |

### Game systems

| System                                | Status                                                              | Default rules |
| ------------------------------------- | ------------------------------------------------------------------- | ------------- |
| **Pathfinder 2e** (pf2e 8.x)          | Tested in a live Foundry v14 world                                  | 187           |
| **D&D 5e** (dnd5e 6.x)                | New in 0.3.0, not yet tested live. Please report problems           | 212           |
| **GURPS 4e Game Aid** (`gurps` 0.18+) | New in 0.3.0, not yet tested live. Please report problems           | 128           |
| Any other system                      | Animation browser, macros and the macro API work; no automation yet | -             |

The core is system-agnostic. New systems are added as adapters (see the [adapter guide](docs/adapter-guide.md)).

## Installation

1. In Foundry: **Add-on Modules → Install Module**, and paste this manifest URL:
   ```
   https://github.com/sargas79/sargas-visual-automation/releases/latest/download/module.json
   ```
2. Enable **Sargas Visual Automation** and your **JB2A** module in the world.
3. If **Automated Animations** is still enabled, disable it (or its automation). Otherwise both modules animate the same rolls.

## Quick start

- **Attack or cast as usual.** The default rules for your system pick an animation, and everyone sees it.
- **See or change what a spell plays:** right-click a token and click the wand button on the token HUD. You can also use the wand button in the token controls (left toolbar) or **Animations** in the character sheet header. Each row has **Preview**, **Change**, **Edit**, **Reset** and **Disable**.
- **Browse animations:** use the film button in the token controls, or **Configure Settings → Sargas Visual Automation**.
- **Fine-tune one item:** click **Animation** in the item sheet header for the full editor (preset, colors, stages, hit/miss/critical variants, sound).
- **World-wide rules:** use the rules manager (GM) in the module settings.

The [user guide](docs/user-guide.md) covers all of it, plus settings and troubleshooting.

## Documentation

- [User guide](docs/user-guide.md): installation, the animation overview, configuring items, rules manager, settings, troubleshooting
- [Macro & module API](docs/api.md): `SVA.sequence()`, `SVA.effects`, `SVA.db`, `SVA.engine`, `SVA.automation`, hooks
- [Example macros](docs/macros.md): the 16 macros of the SVA Example Macros compendium
- [Adapter guide](docs/adapter-guide.md): adding support for another game system
- [Manual QA checklist](docs/testing.md): in-Foundry test script for releases
- [Architecture & contracts](docs/architecture.md): for contributors
- [Changelog](CHANGELOG.md)

## How it works

```
JB2A module (assets + database)
        │  read directly - no Sequencer
        ▼
db/          catalog of every animation + metadata (sizes, loop points, ranged padding, thumbnails)
engine/      PIXI playback on the canvas
net/         socket sync to every client, permissions, per-player preferences
effects/     persistent effects stored in the scene, restored on reload
automation/  system-agnostic rules: item → animation recipe
systems/     adapters that turn system events (PF2e strikes, dnd5e activities, GURPS rolls…) into generic events
ui/          animation overview, animation browser, item editor, rules manager, settings
```

## Licensing

- The code in this repository is [MIT](LICENSE).
- **JB2A assets are not part of this repository and never will be.** They are licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) by Jules & Ben's Animated Assets, and the Patreon collection is for patrons only. SVA only references the files of the JB2A module you have installed, at runtime. `.gitignore` blocks media files as a safeguard.

## Support

Found a bug or a wrong animation? [Open an issue](https://github.com/sargas79/sargas-visual-automation/issues) with your game system and version, what you did, and the browser console output (F12). Turn on the module's **Debug logging** setting for more detail. The roadmap is on the [project board](https://github.com/users/sargas79/projects/7).

## Development

```bash
npm install
npm run link -- "C:/Users/<you>/AppData/Local/FoundryVTT/Data"   # junction repo -> Data/modules
npm run build:packs   # compile the example-macros compendium into packs/ (needed once when running from source)
npm test              # unit tests (Vitest)
npm run lint          # ESLint + Prettier
npm run build         # installable module in dist/ (also builds the compendium)
```

With the repo linked, Foundry loads `src/main.js` directly, so a browser refresh picks up your changes. See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are published from GitHub Releases (`vX.Y.Z` tags); the workflow attaches `module.zip` and `module.json`.
