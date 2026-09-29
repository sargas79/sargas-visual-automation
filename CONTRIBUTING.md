# Contributing

## Workflow

- Work is planned as **epics** with **sub-issues** on GitHub. Pick a sub-issue.
- One branch and one PR per sub-issue: `feat/<issue-id>-<slug>`, for example `feat/2.1-jb2a-loader`.
- Put `Closes #<n>` in the PR body. CI (lint, tests, build) must be green.

## Rules

- **Never commit JB2A media** (`.webm`/`.webp`) or JB2A source files. Test fixtures may contain database _paths_, never media.
- **No Sequencer or Automated Animations dependency**, not even optional.
- **Keep the core system-agnostic.** Anything specific to a game system lives in `src/systems/<system-id>/` and talks to the core only through the adapter interface. Code in `src/automation`, `src/engine` and `src/db` must not import from `src/systems`.
- Target Foundry **v14** APIs (ApplicationV2, `foundry.*` namespaces). Don't use deprecated globals.

## Commands

| Command                                  | What it does                                                  |
| ---------------------------------------- | ------------------------------------------------------------- |
| `npm test`                               | Unit tests (Vitest, Foundry globals mocked in `tests/setup/`) |
| `npm run lint` / `npm run format`        | ESLint + Prettier check / fix                                 |
| `npm run build` / `npm run watch`        | Build `dist/` (installable module)                            |
| `npm run link -- <FoundryData> [--dist]` | Junction the repo (or `dist/`) into `Data/modules`            |

## Releasing

Publish a GitHub Release with a tag `vX.Y.Z`. The release workflow builds the module and attaches `module.zip` and `module.json`.
