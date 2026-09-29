# Sargas Visual Automation

A [Foundry VTT](https://foundryvtt.com) module that plays and automates [JB2A](https://jb2a.com) animations **on its own**. You don't need Sequencer or Automated Animations: install this module and JB2A, and attacks, spells and effects animate automatically.

> **Status: early development.** Nothing is playable yet. Progress is tracked in the [issues](https://github.com/sargas79/sargas-visual-automation/issues) and [milestones](https://github.com/sargas79/sargas-visual-automation/milestones).

## Requirements

|             |                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry VTT | **v14**                                                                                                                                     |
| Game system | **Pathfinder 2e** and **GURPS 4e Game Aid** (`gurps`). The core is system-agnostic, and a D&D 5e adapter is planned                         |
| Animations  | [JB2A Patreon](https://www.patreon.com/JB2A) (`jb2a_patreon`) or the free [JB2A](https://foundryvtt.com/packages/JB2A_DnD5e) (`JB2A_DnD5e`) |

## Installation

In Foundry: **Add-on Modules → Install Module**, and paste this manifest URL:

```
https://github.com/sargas79/sargas-visual-automation/releases/latest/download/module.json
```

## Documentation

- [User guide](docs/user-guide.md): installation, JB2A, configuring items, rules manager, settings, troubleshooting
- [Macro & module API](docs/api.md): `SVA.sequence()`, `SVA.effects`, `SVA.db`, `SVA.engine`, `SVA.automation`, hooks
- [Adapter guide](docs/adapter-guide.md): adding a game system (D&D 5e, GURPS, …)
- [Example macros](docs/macros.md): the 16 macros of the SVA Example Macros compendium
- [Manual QA checklist](docs/testing.md): in-Foundry test script for releases
- [Architecture & contracts](docs/architecture.md): for contributors

## How it works

```
JB2A module (assets + database)
        │  read directly - no Sequencer
        ▼
db/          catalog of every animation + metadata (sizes, loop points, ranged padding)
engine/      PIXI playback on the canvas, synced to all clients (net/)
automation/  system-agnostic rules: item → animation recipe
systems/     adapters that turn system events (PF2e strikes, GURPS rolls…) into generic events
ui/          animation browser, item-sheet tab, rules manager
```

## Licensing

- The code in this repository is [MIT](LICENSE).
- **JB2A assets are not part of this repository and never will be.** They are licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) by Jules & Ben's Animated Assets, and the Patreon collection is for patrons only. SVA only references the files of the JB2A module you have installed, at runtime. `.gitignore` blocks media files as a safeguard.

## Development

```bash
npm install
npm run link -- "C:/Users/<you>/AppData/Local/FoundryVTT/Data"   # junction repo -> Data/modules
npm test        # unit tests (Vitest)
npm run lint    # ESLint + Prettier
npm run build   # installable module in dist/
```

With the repo linked, Foundry loads `src/main.js` directly, so a browser refresh picks up your changes. See [CONTRIBUTING.md](CONTRIBUTING.md).
